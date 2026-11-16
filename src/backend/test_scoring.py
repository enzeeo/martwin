import json
import unittest

import numpy as np

from .scoring import fit_reference, score_candidates


class MethodDTests(unittest.TestCase):
    def test_weighted_distances_and_candidate_pool_invariance(self):
        reference = fit_reference(
            {"slope": [1, 3, 5, 4, 8], "tail": [0, 1, 1, 2, 3], "relief": [0, 1, 2, 3, 4]},
            {"slope": {"slope": 2, "tail": 1}, "relief": {"relief": 4}},
            reference_id="fixture:1",
        )
        mars = {"slope": 3, "tail": 1, "relief": 2}
        earth = {"slope": [5, 3, 6], "tail": [2, 1, np.nan], "relief": [3, 2, 2]}
        result = score_candidates(["A", "B", "C"], earth, mars,
                                  reference=reference, weights={"slope": 3, "relief": 1})
        best, analog = result["ranked"]
        self.assertEqual((best["region_id"], best["score"], result["n_incomplete"]), ("B", 0, 1))
        factor = reference.groups[0].factor
        residual = np.array([1.0, 1.0])
        slope = np.sqrt(residual @ np.linalg.solve(factor @ factor.T, residual) / 2)
        relief = 1 / np.sqrt(2)
        self.assertGreater(reference.groups[0].shrinkage, 0)
        self.assertAlmostEqual(analog["score"], 0.75 * slope + 0.25 * relief)
        self.assertAlmostEqual(analog["score"], sum(analog["group_contributions"].values()))
        subset = score_candidates(["A"], {k: v[:1] for k, v in earth.items()}, mars,
                                  reference=reference, weights={"slope": 3, "relief": 1})
        self.assertEqual(analog["score"], subset["ranked"][0]["score"])
        reweighted = score_candidates(["A"], {k: v[:1] for k, v in earth.items()}, mars,
                                      reference=reference, weights={"slope": 1, "relief": 3})
        self.assertAlmostEqual(reweighted["ranked"][0]["score"], 0.25 * slope + 0.75 * relief)

    def test_shared_mars_delta_and_partial_coverage(self):
        reference = fit_reference({"x": [0, 1, 2, 3]}, {"slope": {"x": 1}}, reference_id="fixture:2")
        args = (["A", "B", "C"], {"x": [1, 1, 1.5]}, {"x": 1})
        options = {"reference": reference, "weights": {"slope": 1}}
        nominal = score_candidates(*args, **options)
        deltas = {"source": "Synthetic slope uncertainty", "mars": {"x": 0.5}}
        result = score_candidates(*args, **options, deltas=deltas)
        self.assertEqual(result["ranked"], nominal["ranked"])
        report = result["rank_stability"]
        self.assertEqual(report["status"], "partial")
        self.assertEqual(report["missing_deltas"], {"earth": ["x"], "mars": []})
        a, b, _ = report["rankings"]
        self.assertEqual(a["score_95pct"], b["score_95pct"])
        self.assertEqual(a["rank_95pct"], b["rank_95pct"])
        self.assertLess(*a["rank_95pct"])
        json.dumps(result, allow_nan=False)

    def test_unavailable_covariance_and_mars_measurement(self):
        groups = {"slope": {"x": 1}}
        with self.assertRaisesRegex(ValueError, "degenerate"):
            fit_reference({"x": [1, 1]}, groups, reference_id="fixture:3")
        reference = fit_reference({"x": [0, 1, 2]}, groups, reference_id="fixture:3")
        with self.assertRaisesRegex(ValueError, "Mars target"):
            score_candidates(["A"], {"x": [1]}, {}, reference=reference, weights={"slope": 1})
