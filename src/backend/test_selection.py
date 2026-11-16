import json
import unittest
from io import BytesIO
from unittest.mock import Mock, patch

from . import choose_features, select_features_and_representations
from .representation_selection import _generate


def score_nothing(_views, documents):
    return {"scores": {document["doc_id"]: -1 for document in documents}}


class SelectionTests(unittest.TestCase):
    @patch("src.backend.representation_selection.os.environ", {"OPENROUTER_API_KEY": "fixture-key"})
    @patch("src.backend.representation_selection.urlopen")
    def test_default_model_uses_forced_tool_arguments(self, urlopen):
        arguments = '{"needs":["slope"]}'
        urlopen.return_value = BytesIO(json.dumps({
            "choices": [{"message": {"content": None, "tool_calls": [{
                "function": {"name": "representation_selection", "arguments": arguments},
            }]}}],
        }).encode())
        schema = {"type": "object", "properties": {"needs": {"type": "array"}}}

        result = _generate([{"role": "user", "content": "Compare slope."}], schema, timeout=25)

        payload = json.loads(urlopen.call_args.args[0].data)
        self.assertEqual(payload["model"], "nvidia/nemotron-3-ultra-550b-a55b:free")
        self.assertNotIn("response_format", payload)
        self.assertEqual(payload["tool_choice"]["function"]["name"], "representation_selection")
        self.assertEqual(payload["tools"][0]["function"]["parameters"], schema)
        self.assertEqual(result, arguments)

    def test_nonterrain_comparisons_and_earth_filters_use_separate_menus(self):
        selections = {
            "dunes": "dune_frac",
            "surface_temperature": "tsurf_mean_K",
            "earth_land_cover": "tree_frac",
        }
        asked = []
        calls = []

        def generate(messages, schema):
            calls.append(schema)
            data = json.loads(messages[1]["content"])
            self.assertEqual(data["mars_target"], {"latitude": 18.4447, "longitude": 77.4509})
            if "needs" in schema["properties"]:
                self.assertEqual(set(data["comparison_families"]), {"dunes", "surface_temperature"})
                self.assertEqual(set(data["earth_filter_families"]), {"earth_land_cover"})
                self.assertNotIn("menu", data)
                return '{"needs":["dune cover","surface temperature","low tree cover"]}'
            response = {"comparisons": {}, "filters": {}}
            for category in response:
                for family, menu in data[category].items():
                    asked.append(family)
                    header = selections[family]
                    self.assertIn(header, [option["header"] for option in menu["menu"]])
                    self.assertNotIn("sources", menu["menu"][0])
                    props = schema["properties"][category]["properties"][family]["properties"]
                    self.assertIn(header, props["headers"]["items"]["enum"])
                    self.assertNotIn("uniqueItems", props["headers"])
                    response[category][family] = {"headers": [header], "reason": "Fixture selection"}
            return json.dumps(response)

        result = select_features_and_representations(
            77.4509, 18.4447,
            "Compare dune coverage and surface temperature. Look for low tree cover.",
            score_documents=score_nothing, generate=generate,
        )
        self.assertEqual(len(calls), 2)
        self.assertCountEqual(asked, selections.keys())
        self.assertEqual(
            [item["header"] for item in result["comparisons"]], ["dune_frac", "tsurf_mean_K"]
        )
        self.assertEqual(set(result["comparisons"][0]["sources"]), {"mars", "earth"})
        self.assertEqual(result["comparisons"][0]["sources"]["mars"]["version"], "mgd3_dunes-v0.2")
        self.assertEqual([item["header"] for item in result["filters"]], ["tree_frac"])
        self.assertEqual(set(result["filters"][0]["sources"]), {"earth"})

    def test_unsupported_concept_produces_no_item_or_model_call(self):
        objective = "Compare grain size."
        self.assertIn("grain_size", choose_features(objective, score_documents=score_nothing))
        generate = Mock()
        result = select_features_and_representations(
            0, 0, objective, score_documents=score_nothing, generate=generate,
        )
        self.assertEqual(result, {"comparisons": [], "filters": []})
        generate.assert_not_called()

    def test_invalid_batch_fails_without_retry(self):
        valid = {"headers": ["slope_p90"], "reason": "Compare steep slopes."}
        for comparisons in (
            {"slope_distribution": {**valid, "headers": ["unavailable_slope"]}},
            {"slope_distribution": {**valid, "headers": ["slope_p90", "slope_p90"]}},
            {},
            {"invented_family": valid},
            {"slope_distribution": {**valid, "reason": ""}},
        ):
            with self.subTest(comparisons=comparisons):
                generate = Mock(side_effect=[
                    '{"needs":["slope"]}',
                    json.dumps({"comparisons": comparisons, "filters": {}}),
                ])
                with self.assertRaises(ValueError):
                    select_features_and_representations(
                        0, 0, "Compare slope. Ignore vegetation.",
                        score_documents=score_nothing, generate=generate,
                    )
                self.assertEqual(generate.call_count, 2)

    @patch("src.backend.representation_selection._generate")
    def test_both_requests_get_twenty_minutes(self, generate):
        generate.side_effect = [
            '{"needs":["slope"]}',
            '{"comparisons":{"slope_distribution":{"headers":["slope_p90"],"reason":"Steep slopes."}},"filters":{}}',
        ]
        result = select_features_and_representations(
            0, 0, "Compare slope. Ignore vegetation.", score_documents=score_nothing,
        )
        self.assertEqual(generate.call_count, 2)
        self.assertEqual([call.kwargs["timeout"] for call in generate.call_args_list], [1200, 1200])
        self.assertEqual(result["comparisons"][0]["header"], "slope_p90")
        self.assertEqual(result["filters"], [])

    def test_failed_needs_request_is_not_retried(self):
        for failure in (ValueError("Invalid provider response"), TimeoutError("Timed out")):
            with self.subTest(failure=failure):
                generate = Mock(side_effect=failure)
                with self.assertRaises(type(failure)):
                    select_features_and_representations(
                        0, 0, "Compare slope.", score_documents=score_nothing, generate=generate,
                    )
                self.assertEqual(generate.call_count, 1)
