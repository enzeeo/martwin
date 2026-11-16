"""Project the Method D terrain benchmark and local Mars shards into a deploy bundle."""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

from pipeline.planetary_grid import PlanetBandGrid
from pipeline.test_scoring.starman import Starman, transform



def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def save(output, key, values):
    np.save(output / f"{key}.npy", values, allow_pickle=False)


def terrain_path(repo, planet, shard):
    return repo / f"data/processed/{planet}/terrain/terrain-v0.2/band_group={shard:03d}.parquet"


def check_versions(table, grid_version, path):
    if (set(table["grid_version"].unique().to_pylist()) != {grid_version}
        or set(table["feature_version"].unique().to_pylist()) != {"terrain-v0.2"}):
        raise ValueError(f"Unexpected terrain or grid version in {path}.")


def add_raw_filters(repo, output):
    """Align raw numeric terrain columns with the frozen candidate population."""
    manifest_path = output / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    ids = np.load(output / "earth_ids.npy", mmap_mode="r", allow_pickle=False)
    groups = np.fromiter((int(region[2:6]) // 100 for region in ids), dtype=np.int16, count=len(ids))
    shards = np.unique(groups)
    schema = pq.read_schema(terrain_path(repo, "earth", int(shards[0])))
    headers = [field.name for field in schema if pa.types.is_floating(field.type) or pa.types.is_integer(field.type)]
    arrays = {header: np.lib.format.open_memmap(output / f"filter_{header}.npy", mode="w+", dtype=np.float64, shape=ids.shape)
              for header in headers}
    hashes = {}
    for shard in shards:
        path = terrain_path(repo, "earth", int(shard))
        table = pq.read_table(path, columns=["grid_version", "feature_version", "region_id", *headers])
        check_versions(table, manifest["grid_version"], path)
        local_ids = np.asarray(table["region_id"].to_pylist(), dtype=str)
        order = np.argsort(local_ids)
        positions = np.flatnonzero(groups == shard)
        indices = np.searchsorted(local_ids[order], ids[positions])
        if (indices >= len(order)).any() or not np.array_equal(local_ids[order][indices], ids[positions]):
            raise ValueError(f"Raw filter terrain shard {shard} does not contain the frozen candidates.")
        rows = order[indices]
        for header, array in arrays.items():
            array[positions] = table[header].to_numpy()[rows]
        hashes[str(path.relative_to(repo))] = sha256(path)
    for array in arrays.values():
        array.flush()
    manifest["filter_headers"] = headers
    manifest["raw_filter_provenance"] = {"source": "local terrain-v0.2, raw units", "sha256": hashes}
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")


def extend_bundle(repo, source, output):
    """Create a separate filter-capable bundle without mutating the source."""
    output.mkdir(parents=True, exist_ok=False)
    for path in source.glob("*.npy"):
        if not path.name.startswith("filter_"):
            (output / path.name).symlink_to(path.resolve())
    (output / "manifest.json").write_text((source / "manifest.json").read_text())
    add_raw_filters(repo, output)


def main(repo, output):
    benchmark = repo / "data/scoring-abcd/global-terrain-v1"
    plan_path = benchmark / "terrain.global.v1.json"
    plan_bytes = plan_path.read_bytes()
    plan = json.loads(plan_bytes)
    stage = benchmark / "stage"
    receipt_path = stage / "input-receipt.json"
    receipt = json.loads(receipt_path.read_text())
    if sha256(receipt_path) != plan["input_receipt_sha256"] or receipt["revision"] != plan["revision"]:
        raise ValueError("The benchmark's pinned source receipt does not match its plan.")
    for relative, file in receipt["files"].items():
        if relative.startswith(("grid/planet=earth/", "terrain/planet=earth/")):
            if sha256(stage / relative) != file["sha256"]:
                raise ValueError(f"Pinned Earth benchmark file changed: {relative}")
    source = Starman(plan, stage)
    local_hashes = {}
    features = [feature for group in plan["groups"] for feature in group["features"]]
    names = [feature["earth"]["column"] for feature in features]
    scales = {name: feature["scale"] for name, feature in zip(names, features)}
    # The slope-mean follow-up used the untransformed measurement in degrees.
    scales["slope_mean"] = 1
    refs = np.array(plan["reference_ids"])
    reference_groups = np.array([int(region[2:6]) // 100 for region in refs])
    output.mkdir(parents=True, exist_ok=False)

    blocks = []
    reference_blocks = []
    for shard in plan["earth_shards"]:
        ids, columns = source.rows("earth", shard, [*features, *plan["filters"]])
        values = np.column_stack([
            transform(column, feature["transform"]) for column, feature in zip(columns, features)
        ])
        flags, coverage, water = columns[len(features):]
        excluded_flags = set(plan["filters"][0]["value"])
        eligible = np.fromiter(
            (not bool(set(str(flags_value).split(";")) & excluded_flags) for flags_value in flags),
            dtype=bool, count=len(ids),
        )
        eligible &= coverage >= plan["filters"][1]["value"]
        eligible &= (water <= plan["filters"][2]["value"]) | ~np.isfinite(water)
        path = terrain_path(repo, "earth", shard)
        local_hashes[str(path.relative_to(repo))] = sha256(path)
        table = pq.read_table(path, columns=["grid_version", "feature_version", "region_id", "slope_mean"])
        check_versions(table, plan["grid_version"], path)
        local_ids = np.asarray(table["region_id"].to_pylist(), dtype=str)
        order = np.argsort(local_ids)
        if not np.array_equal(local_ids[order], ids):
            raise ValueError(f"Local Earth terrain shard {shard} does not match the staged region IDs.")
        values = np.column_stack((values, table["slope_mean"].to_numpy()[order]))
        wanted = refs[reference_groups == shard]
        positions = np.searchsorted(ids, wanted)
        if not np.array_equal(ids[positions], wanted) or not eligible[positions].all():
            raise ValueError(f"Frozen references do not match eligible Earth terrain shard {shard}.")
        reference_blocks.append(values[positions])
        if plan["holdout_reference"]:
            eligible[positions] = False
        blocks.append((ids[eligible], values[eligible]))
    save(output, "earth_ids", np.concatenate([ids for ids, _ in blocks]))
    for index, name in enumerate(scales):
        save(output, f"earth_{name}", np.concatenate([values[:, index] for _, values in blocks]))
        save(output, f"reference_{name}", np.concatenate([values[:, index] for values in reference_blocks]))
    del blocks

    earth_grid = PlanetBandGrid.build("earth")
    mars_grid = PlanetBandGrid.build("mars")
    for planet, grid in (("earth", earth_grid), ("mars", mars_grid)):
        save(output, f"{planet}_edges", grid.edges_deg)
        save(output, f"{planet}_counts", grid.column_counts)
    offsets = np.r_[0, np.cumsum(mars_grid.column_counts)]
    mars_values = np.full((offsets[-1], len(scales)), np.nan)
    for shard in range((len(mars_grid.column_counts) + 99) // 100):
        path = terrain_path(repo, "mars", shard)
        local_hashes[str(path.relative_to(repo))] = sha256(path)
        table = pq.read_table(path, columns=["grid_version", "feature_version", "band", "column", *scales])
        check_versions(table, plan["grid_version"], path)
        band, col = table["band"].to_numpy(), table["column"].to_numpy()
        if (band < shard * 100).any() or (band >= min((shard + 1) * 100, len(mars_grid.column_counts))).any():
            raise ValueError(f"Mars terrain shard {shard} contains out-of-shard bands.")
        if (col < 0).any() or (col >= mars_grid.column_counts[band]).any():
            raise ValueError(f"Mars terrain shard {shard} contains invalid columns.")
        positions = offsets[band] + col
        if len(np.unique(positions)) != len(positions) or (
            positions.min() != offsets[shard * 100]
            or positions.max() != offsets[min((shard + 1) * 100, len(offsets) - 1)] - 1
            or len(positions) != positions.max() - positions.min() + 1
        ):
            raise ValueError(f"Mars terrain shard {shard} is incomplete or misaligned.")
        for index, (name, feature) in enumerate(zip(names, features)):
            mars_values[positions, index] = transform(table[name].to_numpy(), feature["transform"])
        mars_values[positions, -1] = table["slope_mean"].to_numpy()
    for index, name in enumerate(scales):
        save(output, f"mars_{name}", mars_values[:, index])
    manifest = {
        "grid_version": plan["grid_version"], "terrain_version": "terrain-v0.2",
        "starman_revision": plan["revision"], "tolerances": scales,
        "provenance": {
            "staged_earth_inputs_receipt_sha256": plan["input_receipt_sha256"],
            "local_inputs": "Earth slope_mean and all Mars columns from local terrain-v0.2 shards.",
            "local_inputs_sha256": local_hashes,
        },
        "reference_id": "terrain-global-v1:" + hashlib.sha256(plan_bytes).hexdigest(),
        "reference_count": len(refs),
        "earth_candidates": len(np.load(output / "earth_ids.npy", mmap_mode="r")),
        "mars_cells": int(offsets[-1]),
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    add_raw_filters(repo, output)
    print(json.dumps({key: value for key, value in manifest.items() if key != "provenance"}, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("research_repo", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--from-bundle", type=Path, help="Reuse frozen scoring arrays from an existing bundle; create a new raw-filter bundle.")
    args = parser.parse_args()
    if args.from_bundle:
        extend_bundle(args.research_repo, args.from_bundle, args.output)
    else:
        main(args.research_repo, args.output)
