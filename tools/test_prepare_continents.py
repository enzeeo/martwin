import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
from shapely.geometry import Polygon, box, mapping

from src.backend.continents import CONTINENTS
from tools.prepare_continents import assign_footprints, continent_regions


def geojson_feature(properties, geometry):
    return {"type": "Feature", "properties": properties, "geometry": mapping(geometry)}


class ContinentPreparationTests(unittest.TestCase):
    def test_full_footprint_handles_coasts_continent_crossings_and_holes(self):
        regions = {name: Polygon() for name in CONTINENTS}
        regions["Africa"] = box(0, 0, 1.75, 1)
        regions["Europe"] = box(2, 0, 3.75, 1)
        regions["Asia"] = box(3.75, 0, 5, 1)
        regions["Oceania"] = Polygon(box(5, 0, 7, 1).exterior.coords,
                                     holes=[box(5.05, 0.05, 5.15, 0.15).exterior.coords])
        ids = [f"E_0000_{col:05d}" for col in range(180, 187)]
        codes = assign_footprints(ids, np.array([0, 1]), np.array([360]), regions)
        self.assertEqual(codes.tolist(), [1, 0, 4, 0, 3, 0, 6])

    def test_map_unit_fallback_cannot_override_conflicting_physical_assignment(self):
        with TemporaryDirectory() as folder:
            physical = Path(folder) / "physical.geojson"
            map_units = Path(folder) / "map_units.geojson"
            physical_features = [
                geojson_feature({"REGION": name, "FEATURECLA": "Continent"}, box(10 * i, 0, 10 * i + 1, 1))
                for i, name in enumerate(CONTINENTS)
            ]
            map_features = [
                geojson_feature({"CONTINENT": name}, box(10 * i, 0, 10 * i + 2, 1))
                for i, name in enumerate(CONTINENTS)
                if name not in {"Europe", "Asia"}
            ]
            map_features.append(geojson_feature({"CONTINENT": "Europe"}, box(20, 0, 32, 1)))
            physical_features.append(geojson_feature(
                {"REGION": "South America", "FEATURECLA": "Island"}, box(41.999, 0, 42, 1)
            ))
            physical.write_text(json.dumps({"type": "FeatureCollection", "features": physical_features}))
            map_units.write_text(json.dumps({"type": "FeatureCollection", "features": map_features}))
            regions = continent_regions(physical, map_units)
            self.assertTrue(regions["Asia"].covers(box(20, 0, 21, 1)))
            self.assertTrue(regions["Europe"].covers(box(30, 0, 31, 1)))
            self.assertFalse(regions["Europe"].intersects(box(24, 0, 25, 1)))
            self.assertTrue(regions["North America"].covers(box(41, 0, 41.9, 1)))
            self.assertFalse(regions["North America"].covers(box(41, 0, 42, 1)))
            self.assertTrue(regions["South America"].covers(box(41.999, 0, 42, 1)))


if __name__ == "__main__":
    unittest.main()
