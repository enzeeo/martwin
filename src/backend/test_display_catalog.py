import json
import unittest
from pathlib import Path

from .display_catalog import dataset_fields, metadata


ROOT = Path(__file__).parent


class DisplayCatalogTests(unittest.TestCase):
    def test_every_comparison_and_filter_option_has_readable_metadata(self):
        headers = set()
        for filename in ("comparison_families.json", "filter_families.json"):
            data = json.loads((ROOT / "catalog" / filename).read_text())
            headers.update(option["header"] for family in data.values() for option in family["options"])
        for header in headers:
            item = metadata(header)
            self.assertTrue(item["label"])
            self.assertNotEqual(item["label"], header)
            self.assertNotEqual(item["data_type"], "unknown")
            self.assertTrue(item["unit"])

    def test_scientific_labels_and_units(self):
        self.assertEqual(metadata("ati_inv_K")["unit"], "1/K")
        self.assertEqual(metadata("ti_tiu_p50")["label"], "Median nighttime TES thermal inertia")
        self.assertIn("J m⁻² K⁻¹ s⁻½", metadata("ti_day_tiu_mean")["unit"])
        self.assertEqual(metadata("min_abund_femg_clay")["label"], "EMIT iron-magnesium-clay abundance estimate")
        self.assertEqual(metadata("min_frac_femg_clay")["label"], "EMIT iron–magnesium clay area fraction")
        self.assertEqual(metadata("mapped_unit_fraction_AHi")["label"], "Mapped area fraction of geology unit AHi")
        self.assertEqual(metadata("mapped_unit_fraction_AHi")["unit"], "fraction (0–1)")
        self.assertEqual(metadata("grain_eff_um_p90")["unit"], "µm")
        self.assertEqual(metadata("ice_wt_pct_frend")["unit"], "wt%")
        self.assertEqual(metadata("surface_temp_seasonal_diurnal_ratio")["unit"], "unitless")

    def test_documented_inventory_and_special_semantics(self):
        headers = {item["header"] for item in dataset_fields()}
        self.assertTrue({"center_lat", "center_lon", "elev_mean", "quality_flags", "mapped_unit_fraction_AHi"} <= headers)
        self.assertEqual(len(headers), len(dataset_fields()))
        self.assertTrue({"float32", "uint8", "latband5km-v1", "latent_properties-v0.1"}.isdisjoint(headers))
        self.assertIn("not be treated as equivalent", metadata("ice_frac")["description"])
        self.assertEqual(metadata("ferric_valid_coverage")["data_type"], "fraction")
        self.assertIn("percentile", metadata("ti_pct")["description"].lower())
        self.assertIn("unpopulated", metadata("min_frac_feoxide")["description"])

    def test_curated_meaning_scope_capabilities_and_display_scaling(self):
        temperature = metadata("tsurf_mean_K")
        self.assertEqual(temperature["label"], "Mean surface temperature")
        self.assertEqual(temperature["unit"], "K")
        self.assertEqual(temperature["category"], "climate and surface properties")
        ice = metadata("ice_wt_pct")
        self.assertEqual(ice["label"], "Estimated near-surface ice content")
        self.assertEqual(ice["unit"], "wt%")
        ice_fraction = metadata("ice_frac")
        self.assertEqual(ice_fraction["label"], "Source-specific ice/permafrost indicator")
        self.assertIn("distinct quantities", ice_fraction["description"])
        self.assertEqual(set(ice_fraction["planets"]), {"earth", "mars"})
        self.assertEqual(set(ice_fraction["sources"]), {"earth", "mars"})
        self.assertEqual(metadata("tree_frac")["display_unit"], "%")
        self.assertEqual(metadata("tree_frac")["display_scale"], 100)
        self.assertEqual(metadata("mapped_mineral_clay_share")["display_scale"], 100)
        self.assertEqual(metadata("ferric_valid_coverage")["display_scale"], 100)
        self.assertEqual(metadata("crater_n_50km")["data_type"], "count")
        for header in ("surface_temp_seasonal_diurnal_ratio", "ti_pct", "ndvi_mean", "ice_wt_pct", "rock_frac_pct"):
            self.assertNotIn("display_scale", metadata(header))
        self.assertEqual(metadata("rock_frac_pct")["unit"], "vol%")
        self.assertIn("comparison", metadata("slope_mean")["capabilities"])
        self.assertIn("filter", metadata("tree_frac")["capabilities"])
        self.assertIn("context", metadata("center_lat")["capabilities"])


if __name__ == "__main__":
    unittest.main()
