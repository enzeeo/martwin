"""Method D scoring on prepared, comparable numeric representations."""

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class GroupFit:
    name: str
    columns: tuple[str, ...]
    tolerances: tuple[float, ...]
    factor: np.ndarray
    n_reference: int
    shrinkage: float
    ridge: float


@dataclass(frozen=True)
class MethodDReference:
    reference_id: str
    groups: tuple[GroupFit, ...]


def fit_reference(earth_reference, groups, *, reference_id: str) -> MethodDReference:
    """Fit once per group definition on a separate, versioned Earth reference.

    `groups` maps group names to {representation: tolerance}. Earth reference
    values are column vectors keyed by representation. Values and tolerances
    share units after any representation transforms.
    """
    if not groups or not reference_id:
        raise ValueError("Method D needs scoring groups and a pinned Earth reference ID.")
    columns = [column for group in groups.values() for column in group]
    if len(columns) != len(set(columns)):
        raise ValueError("Each representation must belong to one scoring group.")

    fits = []
    for name, tolerances in groups.items():
        scales = np.asarray(list(tolerances.values()), dtype=float)
        if not len(scales) or not np.isfinite(scales).all() or (scales <= 0).any():
            raise ValueError(f"{name}: expected positive finite tolerances.")
        values = np.column_stack([earth_reference[column] for column in tolerances]) / scales
        values = values[np.isfinite(values).all(axis=1)]
        n, width = values.shape
        if n < 2:
            raise ValueError(f"{name}: Method D needs at least two complete Earth reference rows.")
        values -= values.mean(axis=0)
        covariance = values.T @ values / n
        mean_variance = float(np.trace(covariance) / width)
        if not np.isfinite(mean_variance) or mean_variance <= 1e-9:
            raise ValueError(f"{name}: Method D covariance is degenerate.")

        # Caden's Ledoit–Wolf estimator shrinks toward trace(S) / k times identity.
        identity = np.eye(width)
        target = mean_variance * identity
        distance = np.square(covariance - target).sum()
        shrinkage = 0.0
        if distance > 0:
            row_norm_squared = np.square(values).sum(axis=1)
            noise = (np.square(row_norm_squared).sum() - n * np.square(covariance).sum()) / n**2
            shrinkage = float(np.clip(noise / distance, 0, 1))
            covariance = (1 - shrinkage) * covariance + shrinkage * target
        ridge = 1e-9 * mean_variance if np.linalg.eigvalsh(covariance)[0] <= 1e-9 * mean_variance else 0.0
        factor = np.linalg.cholesky(covariance + ridge * identity)
        factor.setflags(write=False)
        fits.append(GroupFit(name, tuple(tolerances), tuple(scales.tolist()), factor, n, shrinkage, ridge))
    return MethodDReference(reference_id, tuple(fits))


def _group_distance(residual, group):
    whitened = np.linalg.solve(group.factor, residual.T)
    return np.linalg.norm(whitened, axis=0) / np.sqrt(len(group.columns))


def _rank_stability(pool_ids, blocks, weights, deltas):
    columns = {column for group, _ in blocks for column in group.columns}
    if deltas is None:
        return {"status": "unavailable", "missing_deltas": {planet: sorted(columns) for planet in ("earth", "mars")}}
    if not isinstance(deltas.get("source"), str) or not deltas["source"].strip():
        raise ValueError("Provide a source for the delta inputs.")
    spreads = {planet: deltas.get(planet, {}) for planet in ("earth", "mars")}
    for planet, values in spreads.items():
        for column, value in values.items():
            if (column not in columns or isinstance(value, bool) or not isinstance(value, (int, float))
                    or not np.isfinite(value) or value < 0):
                raise ValueError(f"Invalid uncertainty for {planet}.{column}.")
    missing = {planet: sorted(columns - values.keys()) for planet, values in spreads.items()}
    if not any(spreads.values()) or not len(pool_ids):
        return {"status": "unavailable", "missing_deltas": missing}

    rng = np.random.default_rng(20261115)
    draws = 200
    simulated = np.zeros((draws, len(pool_ids)))
    for (group, shortlist), weight in zip(blocks, weights):
        earth_sigma, mars_sigma = (
            np.array([values.get(column, 0.0) for column in group.columns]) / group.tolerances
            for values in spreads.values()
        )
        for scores in simulated:
            earth_error = rng.standard_normal(shortlist.shape) * earth_sigma
            mars_error = rng.standard_normal(len(group.columns)) * mars_sigma
            scores += weight * _group_distance(shortlist + earth_error - mars_error, group)
    ranks = np.array([1 + np.searchsorted(np.sort(scores), scores, side="left") for scores in simulated])
    score_intervals = np.quantile(simulated, [0.025, 0.975], axis=0).T.tolist()
    rank_intervals = np.quantile(ranks, [0.025, 0.975], axis=0).T.tolist()
    top_five = (ranks <= 5).mean(axis=0).tolist()
    return {
        "status": "partial" if any(missing.values()) else "complete",
        "scope": "Nominal shortlist with fixed eligibility",
        "model": "Independent Gaussian Earth errors and one shared Gaussian Mars draw per replicate",
        "source": deltas["source"],
        "standard_uncertainties": spreads,
        "missing_deltas": missing,
        "candidate_count": len(pool_ids),
        "draws": draws,
        "seed": 20261115,
        "rankings": [
            {"region_id": region_id, "score_95pct": score, "rank_95pct": rank,
             "top5_frequency_with_ties": frequency}
            for region_id, score, rank, frequency in zip(pool_ids, score_intervals, rank_intervals, top_five)
        ],
    }


def score_candidates(region_ids, earth, mars, *, reference: MethodDReference, weights,
                     deltas=None, top_k: int = 20, select_ranks=None, candidate_mask=None) -> dict:
    """Rank an eligible Earth pool against one Mars target with Method D.

    `earth` and `mars` use the reference's representation keys and units.
    Earth columns align with `region_ids`. Mars values are scalars. `weights`
    maps fitted groups to positive weights, normalized once for the query.
    Optional `deltas={"source": "...", "earth": {...}, "mars": {...}}` gives
    standard uncertainties in transformed representation units by planet.
    The result is JSON-ready. Stability ranks are conditional on up to 1,000
    nominal candidates. Unavailable deltas are held fixed and identified.
    Optional select_ranks(ids, ranked_positions) chooses zero-based ranks
    from the full ordering and preserves those ranks in the returned records.
    Optional candidate_mask excludes Earth rows before scoring and ranking.
    """
    ids = np.asarray(region_ids, dtype=str)
    groups = reference.groups
    if set(weights) != {group.name for group in groups}:
        raise ValueError("Method D weights must name every fitted group.")
    group_weights = np.asarray([weights[group.name] for group in groups], dtype=float)
    if not np.isfinite(group_weights).all() or (group_weights <= 0).any():
        raise ValueError("Method D weights must be positive and finite.")
    group_weights /= group_weights.max()
    group_weights /= group_weights.sum()
    if isinstance(top_k, bool) or not isinstance(top_k, int) or top_k < 1:
        raise ValueError("top_k must be a positive integer.")

    complete = (np.ones(len(ids), dtype=bool) if candidate_mask is None
                else np.array(candidate_mask, dtype=bool, copy=True))
    n_candidates = int(np.count_nonzero(complete))
    distances = np.zeros(len(ids))
    blocks = []
    for group, weight in zip(groups, group_weights):
        target = np.asarray([mars.get(column, np.nan) for column in group.columns], dtype=float)
        if not np.isfinite(target).all():
            raise ValueError(f"{group.name}: Mars target is missing required measurements.")
        columns = [np.asarray(earth[column], dtype=float) for column in group.columns]
        if any(column.shape != ids.shape for column in columns):
            raise ValueError(f"{group.name}: Earth measurements must align with region IDs.")
        for start in range(0, len(ids), 100_000):
            batch = slice(start, start + 100_000)
            residual = (np.column_stack([column[batch] for column in columns]) - target) / group.tolerances
            eligible_batch = complete[batch]
            eligible_batch &= np.isfinite(residual).all(axis=1)
            batch_scores = distances[batch]
            batch_scores[eligible_batch] += weight * _group_distance(residual[eligible_batch], group)
        blocks.append((group, columns, target))

    eligible = np.flatnonzero(complete)
    ranked_positions = eligible[np.argsort(distances[eligible], kind="stable")]
    ranks = (np.arange(min(top_k, len(ranked_positions))) if select_ranks is None
             else np.asarray(select_ranks(ids, ranked_positions), dtype=int))
    top = ranked_positions[ranks]
    pool = ranked_positions[:1000] if deltas is not None else ranked_positions[:0]
    group_distances = {}
    shortlist = []
    for group, columns, target in blocks:
        residual = (np.column_stack([column[top] for column in columns]) - target) / group.tolerances
        group_distances[group.name] = _group_distance(residual, group)
        if deltas is not None:
            pool_residual = (np.column_stack([column[pool] for column in columns]) - target) / group.tolerances
            shortlist.append((group, pool_residual))
        else:
            shortlist.append((group, None))
    return {
        "method": "D",
        "reference_id": reference.reference_id,
        "group_fits": {group.name: {"n_reference": group.n_reference, "shrinkage": group.shrinkage,
                                   "ridge": group.ridge} for group in groups},
        "effective_weights": dict(zip((group.name for group in groups), group_weights.tolist())),
        "n_scored": len(eligible),
        "n_incomplete": n_candidates - len(eligible),
        "ranked": [
            {"region_id": str(ids[row]), "rank": int(ranks[i]) + 1, "score": float(distances[row]),
             "group_distances": {name: float(values[i]) for name, values in group_distances.items()},
             "group_contributions": {group.name: float(weight * group_distances[group.name][i])
                                     for group, weight in zip(groups, group_weights)}}
            for i, row in enumerate(top)
        ],
        "rank_stability": _rank_stability(ids[pool].tolist(), shortlist, group_weights, deltas),
    }
