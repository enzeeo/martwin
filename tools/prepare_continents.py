"""Build an Earth full-footprint continent mask for a prepared terrain bundle."""

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import shapely
from shapely.geometry import shape

from src.backend.continents import CONTINENTS, CONTINENT_POLICY

PHYSICAL_SOURCE = "https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_geography_regions_polys.geojson"
MAP_UNITS_SOURCE = "https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_10m_admin_0_map_units.geojson"
SOURCE_SEAM_FRACTION = 0.001


def polygon_parts(geometry):
    if geometry.geom_type == "Polygon":
        yield geometry
    elif geometry.geom_type in {"MultiPolygon", "GeometryCollection"}:
        for part in geometry.geoms:
            yield from polygon_parts(part)


def features(path):
    for feature in json.loads(path.read_bytes())["features"]:
        if feature["geometry"] is not None:
            yield feature["properties"], shapely.make_valid(shape(feature["geometry"]))


def continent_regions(physical_path, map_units_path):
    physical_parts = defaultdict(list)
    for properties, geometry in features(physical_path):
        name = properties["REGION"]
        if name in CONTINENTS and properties["FEATURECLA"] in {"Continent", "Island"}:
            physical_parts[name].extend(polygon_parts(geometry))
    if set(physical_parts) != set(CONTINENTS):
        raise ValueError("Expected a physical geography polygon for each continent.")

    map_units = [(properties["CONTINENT"], list(polygon_parts(geometry)))
                 for properties, geometry in features(map_units_path)]
    land = shapely.union_all([part for _, parts in map_units for part in parts])
    physical = {name: shapely.intersection(shapely.union_all(physical_parts[name]), land)
                for name in CONTINENTS}
    for region in physical.values():
        shapely.prepare(region)

    fallback = defaultdict(list)
    for name, parts in map_units:
        if name not in CONTINENTS:
            continue
        for part in parts:
            conflicting = [region.intersection(part) for other, region in physical.items()
                           if other != name and region.intersects(part)]
            overlap = shapely.union_all(conflicting)
            # A small cartographic seam must not disqualify an entire map unit.
            # Continental splits block fallback, and even slivers retain the physical assignment.
            if overlap.area < SOURCE_SEAM_FRACTION * part.area:
                fallback[name].append(part.difference(overlap))
    regions = {name: shapely.union_all([physical[name], *fallback[name]]) for name in CONTINENTS}
    # Inconsistent areas across the source polygons remain unassigned.
    return {
        name: region.difference(shapely.union_all([other for label, other in regions.items() if label != name]))
        for name, region in regions.items()
    }


def assign_footprints(ids, edges, counts, regions):
    band, col = np.fromiter(
        ((int(region[2:6]), int(region[7:])) for region in ids),
        dtype=np.dtype((np.int32, 2)), count=len(ids),
    ).T
    width = 360.0 / counts[band]
    lon_lo, lon_hi = -180 + width * col, -180 + width * (col + 1)
    lat_lo, lat_hi = edges[band], edges[band + 1]
    result = np.zeros(len(ids), dtype=np.uint8)
    for code, name in enumerate(CONTINENTS, start=1):
        region = regions[name]
        west, south, east, north = region.bounds
        matching_bounds = ((west <= lon_lo) & (south <= lat_lo) & (east >= lon_hi) & (north >= lat_hi))
        candidates = np.flatnonzero(matching_bounds)
        if len(candidates):
            rectangles = shapely.box(lon_lo[candidates], lat_lo[candidates], lon_hi[candidates], lat_hi[candidates])
            matched = candidates[shapely.covers(region, rectangles)]
            result[matched] = code
    return result


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def prepare(bundle, physical, map_units):
    manifest_path = bundle / "manifest.json"
    mask_path = bundle / "earth_continent.npy"
    if mask_path.exists():
        raise FileExistsError(f"Continent mask already exists at {mask_path}.")
    manifest = json.loads(manifest_path.read_text())
    ids = np.load(bundle / "earth_ids.npy", mmap_mode="r", allow_pickle=False)
    edges = np.load(bundle / "earth_edges.npy", allow_pickle=False)
    counts = np.load(bundle / "earth_counts.npy", allow_pickle=False)
    regions = continent_regions(physical, map_units)
    for region in regions.values():
        shapely.prepare(region)

    totals = np.zeros(1 + len(CONTINENTS), dtype=np.int64)
    with TemporaryDirectory(dir=bundle) as staging:
        temp = Path(staging)
        mask = np.lib.format.open_memmap(temp / mask_path.name, mode="w+", dtype=np.uint8, shape=ids.shape)
        for start in range(0, len(ids), 100_000):
            batch = slice(start, start + 100_000)
            mask[batch] = assign_footprints(ids[batch], edges, counts, regions)
            totals += np.bincount(mask[batch], minlength=len(totals))
        mask.flush()
        del mask
        if not all(totals[1:]) or sum(totals) != len(ids):
            raise ValueError(f"Invalid continent counts {totals.tolist()}.")
        manifest["continent_filter"] = {
            "source": "Natural Earth 1:10m physical geography regions and Admin-0 map units",
            "inputs": [
                {"url": PHYSICAL_SOURCE, "sha256": sha256(physical)},
                {"url": MAP_UNITS_SOURCE, "sha256": sha256(map_units)},
            ],
            "policy": CONTINENT_POLICY,
            "convention": (
                "Physical continent and island polygons clipped to map-unit land take precedence. "
                "Map-unit components fill gaps if conflicting physical coverage is under 0.1% of the component's "
                "planar area. Even those small overlaps are clipped out of the fallback. "
                "Ambiguous overlaps and incomplete footprints are excluded. "
                "Generalized source boundaries and island assignments are a dataset convention."
            ),
            "column_sha256": sha256(temp / mask_path.name),
            "codes": dict(enumerate(("Excluded", *CONTINENTS))),
            "counts": dict(zip(("Excluded", *CONTINENTS), totals.tolist())),
        }
        (temp / manifest_path.name).write_text(json.dumps(manifest, indent=2) + "\n")
        (temp / mask_path.name).replace(mask_path)
        (temp / manifest_path.name).replace(manifest_path)
    print(json.dumps(manifest["continent_filter"], indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("physical_geojson", type=Path)
    parser.add_argument("map_units_geojson", type=Path)
    args = parser.parse_args()
    prepare(args.bundle, args.physical_geojson, args.map_units_geojson)
