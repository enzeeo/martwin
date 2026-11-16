import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np

from .plan import ConfirmedPlan
from .terrain import TerrainBackend
from .terrain_features import TERRAIN_FEATURES


class TerrainTests(unittest.TestCase):
    def test_individual_weights_reorder_same_family_features(self):
        with TemporaryDirectory() as folder:
            path = Path(folder)
            (path / "manifest.json").write_text(json.dumps({
                "tolerances": dict.fromkeys(sorted(TERRAIN_FEATURES), 1),
                "reference_id": "fixture",
                "starman_revision": "fixture",
            }))
            arrays = {
                "earth_ids": ["E_0000_00001", "E_0001_00000"],
                "earth_edges": [-90, 0, 90],
                "earth_counts": [2, 2],
                "mars_edges": [-90, 0, 90],
                "mars_counts": [2, 2],
                "mars_slope_mean": [15, 15, 0, 15],
                "mars_slope_frac_gt_20": [15, 15, 0, 15],
                "earth_slope_mean": [0, 2],
                "earth_slope_frac_gt_20": [2, 0],
            }
            for header in TERRAIN_FEATURES:
                arrays[f"reference_{header}"] = [0, 2]
            for name, values in arrays.items():
                np.save(path / f"{name}.npy", values)

            plan = ConfirmedPlan(
                longitude=-90, latitude=12, objective="Compare steep slopes.",
                comparisons=[
                    {"feature_id": "slope_distribution", "header": "slope_mean", "weight": 3},
                    {"feature_id": "slope_distribution", "header": "slope_frac_gt_20", "weight": 1},
                ],
            )
            backend = TerrainBackend(path)
            initial = backend.score(plan, plan.weights())
            self.assertEqual(initial["mars_region_id"], "M_0001_00000")
            self.assertEqual(initial["effective_weights"], {"slope_mean": 0.75, "slope_frac_gt_20": 0.25})
            first, second = initial["ranked"]
            self.assertEqual((first["region_id"], first["latitude"], first["longitude"], first["score"]),
                             ("E_0000_00001", -45, 90, 0.5))
            self.assertEqual((second["region_id"], second["latitude"], second["longitude"], second["score"]),
                             ("E_0001_00000", 45, -90, 1.5))

            edited = backend.score(plan, {"slope_mean": 1, "slope_frac_gt_20": 3})
            self.assertEqual(edited["ranked"][0]["region_id"], second["region_id"])

    def test_defaults_return_ten_sites_at_least_25_km_apart(self):
        with TemporaryDirectory() as folder:
            backend, plan = self._prepare(Path(folder), list(range(40)), slope=list(range(40)))
            result = backend.score(plan, plan.weights())
            self.assertEqual(result["result_count"], 10)
            self.assertEqual(result["min_separation_km"], 25)
            # Equatorial centers are ~11.1 km apart: accept every third cell.
            self.assertEqual([row["rank"] for row in result["ranked"]], list(range(1, 29, 3)))

    def test_full_score_order_is_thinned_across_dateline_and_against_each_site(self):
        with TemporaryDirectory() as folder:
            # The first 22 ranks are within 250 km, including the second
            # candidate across the antimeridian. Rank 24 is near rank 23.
            columns = [0, 3599, *range(1, 21), 100, 101, 200]
            backend, plan = self._prepare(
                Path(folder), columns, slope=[0, 0, *range(2, len(columns))]
            )
            plan = plan.model_copy(update={"result_count": 5, "min_separation_km": 250})
            result = backend.score(plan, plan.weights())
            self.assertEqual(result["result_count"], 5)
            self.assertEqual(result["min_separation_km"], 250)
            self.assertEqual(result["n_scored"], 25)
            self.assertEqual([(row["rank"], row["region_id"], row["score"]) for row in result["ranked"]], [
                (1, "E_0001_00000", 0.0),
                (23, "E_0001_00100", 22.0),
                (25, "E_0001_00200", 24.0),
            ])

            unspaced = plan.model_copy(update={"min_separation_km": 0, "result_count": 2})
            self.assertEqual([row["region_id"] for row in backend.score(unspaced, unspaced.weights())["ranked"]],
                             ["E_0001_00000", "E_0001_03599"])

    def test_raw_filters_combine_before_ranking_without_refitting_reference(self):
        with TemporaryDirectory() as folder:
            backend, plan = self._prepare(
                Path(folder), [0, 100, 200, 300, 400],
                slope=[0, 1, 2, 3, 4],
                filters={"tree_frac": [np.nan, 0.1, 0.2, 0.3, np.inf],
                         "elev_mean": [np.nan, 100, 200, np.nan, 400]},
            )
            original = backend.score(plan, plan.weights())
            filters = [
                {"feature_id": "earth_land_cover", "header": "tree_frac", "operator": "between",
                 "value": 0.1, "value_max": 0.3},
                {"feature_id": "dataset_field", "header": "elev_mean", "operator": "has_data"},
                {"feature_id": "earth_land_cover", "header": "built_frac"},
            ]
            filtered = ConfirmedPlan.model_validate(plan.model_dump() | {"filters": filters})
            result = backend.score(filtered, filtered.weights())
            self.assertEqual(result["filters_applied"], filters[:2])
            self.assertEqual(result["n_filtered_out"], 3)
            self.assertEqual(result["n_scored"], 2)
            self.assertEqual(result["group_fits"], original["group_fits"])
            self.assertEqual(result["reference_id"], original["reference_id"])
            self.assertEqual([(row["rank"], row["score"], row["elevation_m"]) for row in result["ranked"]],
                             [(1, 1.0, 100.0), (2, 2.0, 200.0)])
            self.assertNotIn("elevation_m", original["ranked"][0])

    def test_filter_operators_and_unavailable_explicit_rule(self):
        with TemporaryDirectory() as folder:
            backend, plan = self._prepare(
                Path(folder), [0, 100, 200, 300], slope=[0, 1, 2, 3],
                filters={"tree_frac": [0.0, 0.2, 0.4, np.nan]},
            )
            rule = {"feature_id": "earth_land_cover", "header": "tree_frac"}
            expected = {
                ">": [2.0], ">=": [1.0, 2.0], "<": [0.0], "<=": [0.0, 1.0],
                "==": [1.0], "!=": [0.0, 2.0], "has_data": [0.0, 1.0, 2.0], "missing": [3.0],
            }
            for operator, scores in expected.items():
                with self.subTest(operator=operator):
                    selected = rule | {"operator": operator}
                    if operator not in {"has_data", "missing"}:
                        selected["value"] = 0.2
                    filtered = ConfirmedPlan.model_validate(plan.model_dump() | {"filters": [selected]})
                    self.assertEqual(
                        [row["score"] for row in backend.score(filtered, filtered.weights())["ranked"]], scores
                    )
            for value, expected in ((1, []), (0.4, [2.0])):
                filtered = ConfirmedPlan.model_validate(plan.model_dump() | {
                    "filters": [rule | {"operator": ">=", "value": value}]
                })
                self.assertEqual(
                    [row["score"] for row in backend.score(filtered, filtered.weights())["ranked"]], expected
                )
            unavailable = ConfirmedPlan.model_validate(plan.model_dump() | {
                "filters": [rule | {"header": "built_frac", "operator": "missing"}]
            })
            with self.assertRaisesRegex(ValueError, "built_frac.*unavailable"):
                backend.score(unavailable, unavailable.weights())

    def test_categorical_boolean_and_text_availability_filters(self):
        with TemporaryDirectory() as folder:
            backend, plan = self._prepare(
                Path(folder), [0, 100, 200, 300, 400], slope=[0, 1, 2, 3, 4],
                filters={
                    "earth_dunes_fraction__dune_type": ["linear", "star", "", "linear", "barchan"],
                    "emit_l3_valid": [0, 1, np.nan, 1, 0],
                    "quality_flags": ["fill", "", "water", "", ""],
                    "geomorphon_major": [1, 2, 3, 4, 5],
                },
            )
            self.assertEqual(backend.filter_choices["earth_dunes_fraction__dune_type"], [
                {"value": "barchan", "label": "barchan"},
                {"value": "linear", "label": "linear"},
                {"value": "star", "label": "star"},
            ])
            self.assertIs(backend.filter_choices, backend.filter_choices)
            self.assertNotIn("geomorphon_major", backend.filter_headers)

            def select(header, operator, value=None):
                rule = {"feature_id": "dataset_field", "header": header, "operator": operator}
                if value is not None:
                    rule["value"] = value
                return ConfirmedPlan.model_validate(plan.model_dump() | {"filters": [rule]})

            cases = [
                ("earth_dunes_fraction__dune_type", "==", "linear", [0, 3]),
                ("earth_dunes_fraction__dune_type", "!=", "star", [0, 3, 4]),
                ("earth_dunes_fraction__dune_type", "in", ["star", "barchan"], [1, 4]),
                ("earth_dunes_fraction__dune_type", "missing", None, [2]),
                ("earth_dunes_fraction__dune_type", "has_data", None, [0, 1, 3, 4]),
                ("emit_l3_valid", "==", True, [1, 3]),
                ("emit_l3_valid", "==", False, [0, 4]),
                ("emit_l3_valid", "missing", None, [2]),
                ("quality_flags", "has_data", None, [0, 2]),
            ]
            for header, operator, value, scores in cases:
                with self.subTest(header=header, operator=operator, value=value):
                    typed = select(header, operator, value)
                    result = backend.score(typed, typed.weights())
                    self.assertEqual([row["score"] for row in result["ranked"]], scores)
                    if value is not None:
                        self.assertEqual(result["filters_applied"][0]["value"], value)

            bad_category = select("earth_dunes_fraction__dune_type", "!=", "unknown type")
            with self.assertRaisesRegex(ValueError, "unknown category"):
                backend.score(bad_category, bad_category.weights())

            wrong_dtype = select("geomorphon_major", "has_data")
            with self.assertRaisesRegex(ValueError, "unavailable"):
                backend.score(wrong_dtype, wrong_dtype.weights())

    def test_continent_filter_skips_boundary_cells_and_intersects_numeric_rules(self):
        with TemporaryDirectory() as folder:
            backend, plan = self._prepare(
                Path(folder), [0, 100, 200, 300, 400],
                slope=[0, 1, 2, 3, 4],
                continents=[0, 1, 4, 1, 4],
            )
            original = backend.score(plan, plan.weights())
            self.assertEqual(original["n_scored"], 5)
            self.assertNotIn("selected_continents", original)
            selected = ConfirmedPlan.model_validate(plan.model_dump() | {
                "selected_continents": ["Africa"], "filters": [
                    {"feature_id": "dataset_field", "header": "slope_mean", "operator": ">", "value": 2},
                ],
            })
            result = backend.score(selected, selected.weights())
            self.assertEqual(result["selected_continents"], ["Africa"])
            self.assertEqual(result["n_filtered_out"], 4)
            self.assertEqual([(row["rank"], row["score"]) for row in result["ranked"]], [(1, 3.0)])

            all_covered = plan.model_copy(update={"selected_continents": ["Africa", "Europe"]})
            self.assertEqual(backend.score(all_covered, all_covered.weights())["n_scored"], 4)
            empty = plan.model_copy(update={"selected_continents": []})
            result = backend.score(empty, empty.weights())
            self.assertEqual((result["n_filtered_out"], result["n_scored"], result["ranked"]), (5, 0, []))

    def test_explicit_continent_filter_requires_prepared_mask(self):
        with TemporaryDirectory() as folder:
            backend, plan = self._prepare(Path(folder), [0], slope=[0])
            selected = plan.model_copy(update={"selected_continents": ["Africa"]})
            with self.assertRaisesRegex(ValueError, "Continent filtering is unavailable"):
                backend.score(selected, selected.weights())

    def _prepare(self, path, columns, *, slope, filters=None, continents=None):
        filters = filters or {}
        manifest = {
            "tolerances": dict.fromkeys(sorted(TERRAIN_FEATURES), 1),
            "reference_id": "fixture",
            "starman_revision": "fixture",
            "filter_headers": list(filters),
        }
        if continents is not None:
            manifest["continent_filter"] = {"source": "fixture", "policy": "full footprint"}
        (path / "manifest.json").write_text(json.dumps(manifest))
        arrays = {
            "earth_ids": [f"E_0001_{col:05d}" for col in columns],
            "earth_edges": [-90, -0.05, 0.05, 90],
            "earth_counts": [2, 3600, 2],
            "mars_edges": [-90, 0, 90],
            "mars_counts": [2, 2],
            "mars_slope_mean": [0] * 4,
            "earth_slope_mean": slope,
        }
        arrays.update({f"reference_{header}": [-1, 1] for header in TERRAIN_FEATURES})
        arrays.update({f"filter_{header}": values for header, values in filters.items()})
        if continents is not None:
            arrays["earth_continent"] = continents
        for name, values in arrays.items():
            np.save(path / f"{name}.npy", values)
        return TerrainBackend(path), ConfirmedPlan(
            longitude=0, latitude=0, objective="Compare slopes.",
            comparisons=[{"feature_id": "slope_distribution", "header": "slope_mean", "weight": 1}],
        )
