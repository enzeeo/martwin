"""Load frozen terrain data and rank a reviewed list of individual features."""

import json
import operator
from functools import cached_property

import numpy as np

from .continents import CONTINENTS
from .display_catalog import metadata
from .plan import NUMERIC_TYPES
from .scoring import MethodDReference, fit_reference, score_candidates
from .terrain_features import REVIEWED_COMPARISONS


EARTH_RADIUS_KM = 6371.0088
GRID_FIELDS = {"center_lat", "center_lon"}
FILTER_OPERATIONS = {
    ">": operator.gt, ">=": operator.ge, "<": operator.lt, "<=": operator.le,
    "==": operator.eq, "!=": operator.ne,
}


class TerrainBackend:
    def __init__(self, directory):
        self.directory = directory

    def _load(self, name):
        return np.load(self.directory / f"{name}.npy", mmap_mode="r", allow_pickle=False)

    @cached_property
    def manifest(self):
        manifest = json.loads((self.directory / "manifest.json").read_text(encoding="utf-8"))
        return manifest

    @cached_property
    def reference(self):
        groups = []
        for header, tolerance in self.manifest["tolerances"].items():
            if header not in REVIEWED_COMPARISONS:
                continue
            try:
                earth = self._load(f"earth_{header}")
                mars = self._load(f"mars_{header}")
                reference = self._load(f"reference_{header}")
                if (earth.shape != self.earth_ids.shape
                        or mars.shape != (int(self.mars_grid[2][-1]),)
                        or reference.ndim != 1
                        or ("reference_count" in self.manifest and len(reference) != self.manifest["reference_count"])
                        or not np.isfinite(earth).any() or not np.isfinite(mars).any()):
                    continue
                fit = fit_reference({header: reference}, {header: {header: tolerance}},
                                    reference_id=self.manifest["reference_id"])
                groups.extend(fit.groups)
            except (OSError, ValueError, TypeError):
                continue
        return MethodDReference(self.manifest["reference_id"], tuple(groups))

    @property
    def score_headers(self):
        return {group.name for group in self.reference.groups}

    def target_headers(self, latitude, longitude):
        row = self._target_row(latitude, longitude)[0]
        return {header for header in self.score_headers
                if np.isfinite(self._load(f"mars_{header}")[row])}

    def _target_row(self, latitude, longitude):
        edges, counts, offsets = self.mars_grid
        band = min(len(counts) - 1, int(np.searchsorted(edges, latitude, side="right")) - 1)
        longitude = (longitude + 180) % 360 - 180
        col = 0 if abs(latitude) == 90 else min(counts[band] - 1, int((longitude + 180) / 360 * counts[band]))
        return offsets[band] + col, band, col

    @cached_property
    def earth_ids(self):
        return self._load("earth_ids")

    @cached_property
    def earth_grid(self):
        return self._load("earth_edges"), self._load("earth_counts")

    @cached_property
    def mars_grid(self):
        edges, counts = self._load("mars_edges"), self._load("mars_counts")
        return edges, counts, np.r_[0, np.cumsum(counts)]

    @cached_property
    def filter_headers(self):
        available = set()
        prepared = self.manifest.get("filter_headers", [])
        for header in prepared:
            try:
                values = self._load(f"filter_{header}")
            except (ValueError, OSError):
                continue
            data_type = metadata(header)["data_type"]
            kind = values.dtype.kind
            allowed_kinds = {
                "categorical": "U",
                "boolean": "biuf",
            }.get(data_type, "iuf" if data_type in NUMERIC_TYPES else "biufU")
            count = self.manifest.get("filter_counts", {}).get(header)
            populated = (count > 0 if count is not None else
                         ((values != "").any() if kind == "U" else np.isfinite(values).any()))
            if kind in allowed_kinds and values.shape == self.earth_ids.shape and populated:
                available.add(header)
        if "slope_mean" not in prepared:
            try:
                values = self._load("earth_slope_mean")
                if values.shape == self.earth_ids.shape and np.isfinite(values).any():
                    available.add("slope_mean")
            except (OSError, ValueError):
                pass
        if all((self.directory / f"earth_{name}.npy").is_file() for name in ("edges", "counts")):
            available.update(GRID_FIELDS)
        return available

    @cached_property
    def filter_choices(self):
        choices = {}
        for header in sorted(self.filter_headers):
            if metadata(header)["data_type"] != "categorical":
                continue
            prepared = self.manifest.get("filter_choices", {}).get(header)
            if prepared is not None:
                choices[header] = [{"value": value, "label": value} for value in prepared]
                continue
            values = self._filter_values(header)
            unique = set()
            for start in range(0, len(values), 100_000):
                unique.update(np.unique(values[start:start + 100_000]).tolist())
            choices[header] = [{"value": value, "label": value} for value in sorted(unique - {""})]
        return choices

    @cached_property
    def continent_filter_available(self):
        provenance = self.manifest.get("continent_filter", {})
        return bool(provenance.get("source") and provenance.get("policy")
                    and (self.directory / "earth_continent.npy").is_file())

    def _earth_coordinates(self, ids):
        edges, counts = self.earth_grid
        band, col = np.fromiter(
            (tuple(map(int, region_id.split("_")[1:])) for region_id in ids),
            dtype=np.dtype((np.int32, 2)), count=len(ids),
        ).T
        return (edges[band] + edges[band + 1]) / 2, -180 + 360 * (col + 0.5) / counts[band]

    def _filter_values(self, header):
        if header == "slope_mean" and header not in self.manifest.get("filter_headers", []):
            return self._load("earth_slope_mean")
        return self._load(f"filter_{header}")

    def _filter_mask(self, rules, continents):
        if continents is None:
            eligible = np.ones(len(self.earth_ids), dtype=bool)
        else:
            if not self.continent_filter_available:
                raise ValueError("Continent filtering is unavailable in the prepared Earth data.")
            codes = [CONTINENTS.index(name) + 1 for name in continents]
            eligible = np.isin(self._load("earth_continent"), codes)

        coordinates = None
        for rule in rules:
            if rule.header not in self.filter_headers:
                raise ValueError(f"Filter {rule.header!r} is unavailable in the prepared Earth data.")
            if rule.header in GRID_FIELDS:
                if coordinates is None:
                    coordinates = dict(zip(("center_lat", "center_lon"), self._earth_coordinates(self.earth_ids)))
                values = coordinates[rule.header]
            else:
                values = self._filter_values(rule.header)
            data_type = metadata(rule.header)["data_type"]
            if values.dtype.kind == "U":
                present = values != ""
            elif data_type == "boolean":
                present = (values == 0) | (values == 1)
            else:
                present = np.isfinite(values)
            if rule.operator == "has_data":
                eligible &= present
            elif rule.operator == "missing":
                eligible &= ~present
            else:
                if data_type == "categorical":
                    choices = {entry["value"] for entry in self.filter_choices[rule.header]}
                    requested = rule.value if rule.operator == "in" else [rule.value]
                    if not choices.issuperset(requested):
                        raise ValueError(f"Filter {rule.header!r} has an unknown category in the prepared Earth data.")
                if rule.operator == "between":
                    matching = (values >= rule.value) & (values <= rule.value_max)
                elif rule.operator == "in":
                    matching = np.isin(values, rule.value)
                else:
                    matching = FILTER_OPERATIONS[rule.operator](values, rule.value)
                eligible &= present & matching
        return eligible

    def _separated_ranks(self, ids, positions, count, minimum_km):
        if count == 1 or minimum_km == 0:
            return range(min(count, len(positions)))
        if minimum_km > np.pi * EARTH_RADIUS_KM:
            return range(min(1, len(positions)))
        minimum = np.sin(minimum_km / (2 * EARTH_RADIUS_KM)) ** 2
        ranks = []
        accepted = []
        for start in range(0, len(positions), 4096):
            lat_deg, lon_deg = self._earth_coordinates(ids[positions[start:start + 4096]])
            lat, lon = np.radians(lat_deg), np.radians(lon_deg)
            cos_lat = np.cos(lat)
            available = np.ones(len(lat), dtype=bool)

            def exclude_nearby(site):
                site_lat, site_lon, site_cos_lat = site
                haversine = (np.sin((lat - site_lat) / 2) ** 2
                             + cos_lat * site_cos_lat * np.sin((lon - site_lon) / 2) ** 2)
                available[:] &= haversine >= minimum

            for site in accepted:
                exclude_nearby(site)
            for index in np.flatnonzero(available):
                if available[index]:
                    ranks.append(start + index)
                    if len(ranks) == count:
                        return ranks
                    site = (lat[index], lon[index], cos_lat[index])
                    accepted.append(site)
                    exclude_nearby(site)
        return ranks

    def native_context(self, planet, rows):
        """Return finite native values without adding them to the score."""
        result = [{} for _ in rows]
        for header, field in self.manifest.get("context_fields", {}).get(planet, {}).items():
            try:
                values = self._load(f"context_{planet}_{header}")[rows]
            except (OSError, ValueError):
                continue
            for item, value in zip(result, values):
                if np.isfinite(value):
                    item[header] = (field["categories"][int(value)] if "categories" in field else float(value))
        return result

    def score(self, plan, weights):
        edges, counts, offsets = self.mars_grid
        unavailable = set(weights) - self.score_headers
        if unavailable:
            raise ValueError(f"Unconfigured scoring measurements: {', '.join(sorted(unavailable))}.")
        target_row, band, col = self._target_row(plan.latitude, plan.longitude)
        mars_region_id = f"M_{band:04d}_{col:05d}"
        target = {header: self._load(f"mars_{header}")[target_row] for header in weights}
        reference = MethodDReference(self.reference.reference_id, tuple(
            group for group in self.reference.groups if group.name in weights
        ))
        ids = self.earth_ids
        earth = {header: self._load(f"earth_{header}") for header in weights}
        rules = [rule for rule in plan.filters if rule.operator is not None]
        continents = plan.selected_continents
        candidate_mask = self._filter_mask(rules, continents) if rules or continents is not None else None

        selected_rows = []

        def select_ranks(candidate_ids, ranked_rows):
            ranks = self._separated_ranks(
                candidate_ids, ranked_rows, plan.result_count, plan.min_separation_km
            )
            selected_rows.extend(ranked_rows[list(ranks)])
            return ranks

        result = score_candidates(
            ids,
            earth,
            target,
            reference=reference,
            weights=weights,
            select_ranks=select_ranks,
            candidate_mask=candidate_mask,
        )
        latitudes, longitudes = self._earth_coordinates(ids[selected_rows])
        for entry, latitude, longitude in zip(result["ranked"], latitudes, longitudes):
            entry["latitude"] = float(latitude)
            entry["longitude"] = float(longitude)
        if "elev_mean" in self.filter_headers:
            for entry, elevation in zip(result["ranked"], self._filter_values("elev_mean")[selected_rows]):
                if np.isfinite(elevation):
                    entry["elevation_m"] = float(elevation)
        result["mars_context"] = self.native_context("mars", [target_row])[0]
        for entry, context in zip(result["ranked"], self.native_context("earth", selected_rows)):
            entry["context"] = context
        result["context_metadata"] = self.manifest.get("field_metadata", {})
        result["mars_region_id"] = mars_region_id
        result["mars_location"] = {
            "latitude": float((edges[band] + edges[band + 1]) / 2),
            "longitude": float(-180 + 360 * (col + 0.5) / counts[band]),
        }
        if (self.directory / "mars_elev_mean.npy").is_file():
            elevation = self._load("mars_elev_mean")[target_row]
            if np.isfinite(elevation):
                result["mars_location"]["elevation_m"] = float(elevation)
        result["data_revision"] = self.manifest["starman_revision"]
        result["filters_applied"] = [rule.model_dump(exclude_none=True) for rule in rules]
        if continents is not None:
            result["selected_continents"] = continents
        result["n_filtered_out"] = 0 if candidate_mask is None else len(ids) - int(np.count_nonzero(candidate_mask))
        result["result_count"] = plan.result_count
        result["min_separation_km"] = plan.min_separation_km
        return result
