import json
import unittest
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from fastapi.testclient import TestClient

from .web import app
from .terrain_features import TERRAIN_FEATURES


class WebTests(unittest.TestCase):
    def setUp(self):
        backend = patch("src.backend.web.scoring_backend", return_value=None)
        backend.start()
        self.addCleanup(backend.stop)
        self.client = TestClient(app)
        self.request = {"longitude": 77.4509, "latitude": 18.4447, "objective": "Compare dunes."}

    def test_serves_frontend_and_selection_at_one_origin(self):
        self.assertIn('id="searchForm"', self.client.get("/").text)
        self.assertIn("/api/select", self.client.get("/selection.js").text)
        self.assertEqual(self.client.get("/healthz").json(), {"status": "ok"})
        response = {"comparisons": [{"header": "dune_frac"}], "filters": []}
        with patch("src.backend.web.select_features_and_representations", return_value=response) as select:
            result = self.client.post("/api/select", json=self.request)
        select.assert_called_once_with(77.4509, 18.4447, "Compare dunes.", available={"comparisons": set(), "filters": ()})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json(), response)

    def test_invalid_coordinates_do_not_start_selection(self):
        with patch("src.backend.web.select_features_and_representations") as select:
            result = self.client.post("/api/select", json={**self.request, "latitude": 91})
        self.assertEqual(result.status_code, 422)
        select.assert_not_called()

    def test_rate_limit_maps_to_public_error_and_next_request_can_run(self):
        failure = HTTPError("https://openrouter.ai", 429, "Limited", {}, None)
        success = {"comparisons": [], "filters": []}
        with patch("src.backend.web.select_features_and_representations", side_effect=[failure, success]):
            response = self.client.post("/api/select", json=self.request)
            next_response = self.client.post("/api/select", json=self.request)
        self.assertEqual(response.status_code, 429)
        self.assertIn("request limit", response.json()["detail"])
        self.assertEqual(next_response.status_code, 200)

    def test_stream_exposes_real_stage_order_and_weights(self):
        response = {"comparisons": [{"header": "slope_mean"}, {"header": "local_relief_1km"}, {"header": "dune_frac"}], "filters": []}
        with (patch("src.backend.web.prepared_comparison_headers", return_value=TERRAIN_FEATURES),
              patch("src.backend.web.choose_features", return_value=["slope"]) as features,
              patch("src.backend.web.choose_representations", return_value=response),
              patch("src.backend.representation_selection._generate") as model):
            stream = self.client.post("/api/select/stream", json=self.request)

        features.assert_called_once_with("Compare dunes.")
        self.assertEqual(stream.headers["content-type"].split(";")[0], "application/x-ndjson")
        events = [json.loads(line) for line in stream.text.splitlines()]
        self.assertEqual([item["stage"] for item in events],
                         ["features", "features_selected", "representations", "done"])
        self.assertEqual(events[1]["concepts"], ["slope"])
        self.assertEqual([row["feature_id"] for row in events[1]["families"]["comparisons"]],
                         ["slope_distribution"])
        comparisons = events[-1]["result"]["comparisons"]
        self.assertEqual([(item["header"], item["score_available"], item.get("weight")) for item in comparisons],
                         [("slope_mean", True, 0.5), ("local_relief_1km", True, 0.5)])
        self.assertTrue(comparisons[0]["label"])
        model.assert_not_called()

    def test_three_default_weights_total_one_at_two_decimal_places(self):
        response = {"comparisons": [{"header": header} for header in
                    ("slope_mean", "local_relief_1km", "roughness_detrended_std")], "filters": []}
        with (patch("src.backend.web.prepared_comparison_headers", return_value=TERRAIN_FEATURES),
              patch("src.backend.web.choose_features", return_value=[]),
              patch("src.backend.web.choose_representations", return_value=response)):
            stream = self.client.post("/api/select/stream", json=self.request)
        result = json.loads(stream.text.splitlines()[-1])["result"]
        self.assertEqual([item["weight"] for item in result["comparisons"]], [0.34, 0.33, 0.33])

    def test_stream_provider_failure_releases_shared_selection_lock(self):
        failure = HTTPError("https://openrouter.ai", 429, "Limited", {}, None)
        with (patch("src.backend.web.prepared_comparison_headers", return_value=TERRAIN_FEATURES),
              patch("src.backend.web.choose_features", return_value=[]),
              patch("src.backend.web.choose_representations", side_effect=failure)):
            stream = self.client.post("/api/select/stream", json=self.request)
        error = json.loads(stream.text.splitlines()[-1])
        self.assertEqual((error["stage"], error["status"]), ("error", 429))
        with patch("src.backend.web.select_features_and_representations", return_value={}):
            self.assertEqual(self.client.post("/api/select", json=self.request).status_code, 200)


class ReviewStepTests(unittest.TestCase):
    def setUp(self):
        backend = patch("src.backend.web.scoring_backend", return_value=None)
        backend.start()
        self.addCleanup(backend.stop)
        self.client = TestClient(app)
        self.plan = {
            "longitude": 77.4509, "latitude": 18.4447, "objective": "Compare slope.",
            "comparisons": [{"feature_id": "slope_distribution", "header": "slope_mean", "weight": 3},
                            {"feature_id": "relief", "header": "local_relief_1km", "weight": 1}],
            "filters": [],
        }

    def test_catalog_lists_families_and_filters(self):
        with (patch("src.backend.web.prepared_comparison_headers", return_value=TERRAIN_FEATURES),
              patch("src.backend.web.prepared_filters", return_value=(
            {"slope_mean", "center_lat", "earth_dunes_fraction__dune_type"}, {"earth_dunes_fraction__dune_type": [{"value": "linear", "label": "linear"}]}
        ))):
            result = self.client.get("/api/catalog").json()
        comparisons = {family["feature_id"]: family["options"] for family in result["comparisons"]}
        self.assertIn("slope_distribution", comparisons)
        self.assertNotIn("earth_land_cover", {family["feature_id"] for family in result["filters"]})
        slope = next(option for option in comparisons["slope_distribution"] if option["header"] == "slope_mean")
        terrain_source = {"layer": "terrain", "version": "terrain-v0.2", "column": "slope_mean"}
        for source in slope["sources"].values():
            self.assertEqual(source["layer"], terrain_source["layer"])
            self.assertEqual(source["column"], terrain_source["column"])
        self.assertCountEqual(slope["planets"], ["earth", "mars"])
        availability = {row["header"]: row["filter_available"] for row in result["dataset_fields"]}
        self.assertTrue(availability["slope_mean"])
        self.assertTrue(availability["center_lat"])
        self.assertNotIn("tree_frac", availability)
        dune_type = next(row for row in result["dataset_fields"] if row["header"] == "earth_dunes_fraction__dune_type")
        self.assertEqual(dune_type["choices"], [{"value": "linear", "label": "linear"}])
        self.assertTrue(dune_type["filter_available"])
        self.assertFalse(dune_type["score_available"])
        self.assertFalse(result["continent_filter"]["available"])
        self.assertEqual(len(result["continent_filter"]["continents"]), 7)
        with patch("src.backend.web.scoring_backend", return_value=Mock(continent_filter_available=True, filter_headers=(), filter_choices={}, score_headers=set())):
            result = self.client.get("/api/catalog").json()
        self.assertTrue(result["continent_filter"]["available"])

    def test_score_without_backend_is_unavailable(self):
        plan = {**self.plan, "comparisons": self.plan["comparisons"][:1]}
        with patch("src.backend.web.scoring_backend", return_value=None):
            self.assertEqual(self.client.post("/api/score", json=plan).status_code, 503)

    def test_score_passes_individual_weights_to_scorer(self):
        self.plan["comparisons"].append(
            {"feature_id": "slope_distribution", "header": "slope_frac_gt_20", "weight": 2}
        )

        class Backend:
            def score(self, plan, weights):
                return {"weights": weights, "families": [item.feature_id for item in plan.comparisons],
                        "result_count": plan.result_count, "min_separation_km": plan.min_separation_km}

        with patch("src.backend.web.scoring_backend", return_value=Backend()):
            result = self.client.post("/api/score", json=self.plan)
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json()["weights"], {"slope_mean": 3, "local_relief_1km": 1, "slope_frac_gt_20": 2})
        self.assertEqual(result.json()["result_count"], 10)
        self.assertEqual(result.json()["min_separation_km"], 25)

    def test_invalid_plans_never_reach_the_scorer(self):
        backend = Mock()
        bad = {
            "unknown family": {"comparisons": [{"feature_id": "nope", "header": "x", "weight": 1}]},
            "unknown header": {"comparisons": [{"feature_id": "relief", "header": "nope", "weight": 1}]},
            "unsupported header": {
                "comparisons": [{"feature_id": "dunes", "header": "dune_frac", "weight": 1}]
            },
            "empty": {"comparisons": []},
            "invalid filter range": {"filters": [
                {"feature_id": "dataset_field", "header": "slope_mean", "operator": "between", "value": 10, "value_max": 1}
            ]},
            "missing comparison threshold": {"filters": [
                {"feature_id": "dataset_field", "header": "slope_mean", "operator": ">"}
            ]},
            "invalid site count": {"result_count": 0},
            "invalid separation": {"min_separation_km": -1},
            "invalid continent": {"selected_continents": ["Atlantis"]},
            "zero weight": {"comparisons": [{"feature_id": "relief", "header": "x", "weight": 0}]},
            "duplicate header": {"comparisons": self.plan["comparisons"][:1] * 2},
            "unknown filter": {"comparisons": self.plan["comparisons"][:1],
                               "filters": [{"feature_id": "earth_land_cover", "header": "nope"}]},
        }
        with patch("src.backend.web.scoring_backend", return_value=backend):
            for name, change in bad.items():
                with self.subTest(name):
                    self.assertEqual(self.client.post("/api/score", json={**self.plan, **change}).status_code, 422)
        backend.score.assert_not_called()

    def test_filter_types_reject_incompatible_payloads_before_scoring(self):
        backend = Mock()
        cases = [
            ("slope_mean", "==", "1"),
            ("slope_mean", "==", True),
            ("slope_mean", "in", ["1"]),
            ("earth_dunes_fraction__dune_type", "==", 1),
            ("earth_dunes_fraction__dune_type", "!=", False),
            ("earth_dunes_fraction__dune_type", "in", []),
            ("earth_dunes_fraction__dune_type", "in", ["linear", 1]),
            ("earth_dunes_fraction__dune_type", ">", "linear"),
            ("emit_l3_valid", "==", "false"),
            ("emit_l3_valid", "==", 0),
            ("emit_l3_valid", "!=", False),
            ("quality_flags", "==", "water"),
            ("earth_dunes_fraction__dune_type", "missing", "linear"),
        ]
        with patch("src.backend.web.scoring_backend", return_value=backend):
            for header, operator, value in cases:
                with self.subTest(header=header, operator=operator, value=value):
                    response = self.client.post("/api/score", json=self.plan | {"filters": [
                        {"feature_id": "dataset_field", "header": header, "operator": operator, "value": value},
                    ]})
                    self.assertEqual(response.status_code, 422)
        backend.score.assert_not_called()

    def test_busy_and_backend_errors_map_to_public_errors(self):
        plan = {**self.plan, "comparisons": self.plan["comparisons"][:1]}
        backend = Mock()
        backend.score.side_effect = [ValueError("Mars target is missing."), RuntimeError("secret detail")]
        with patch("src.backend.web.scoring_backend", return_value=backend):
            first = self.client.post("/api/score", json=plan)
            second = self.client.post("/api/score", json=plan)
            from src.backend.web import scoring_lock
            with scoring_lock:
                busy = self.client.post("/api/score", json=plan)
        self.assertEqual((first.status_code, first.json()["detail"]), (422, "Mars target is missing."))
        self.assertEqual(second.status_code, 503)
        self.assertNotIn("secret", second.text)
        self.assertEqual(busy.status_code, 429)
