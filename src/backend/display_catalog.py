"""Human-readable names for fields in the Starman feature datasets."""

from __future__ import annotations

import json
from functools import lru_cache
import re
from pathlib import Path


_ROOT = Path(__file__).parent
_CATALOG = _ROOT / "catalog"


def _read_options(filename: str) -> list[dict]:
    data = json.loads((_CATALOG / filename).read_text())
    if filename == "comparison_families.json":
        return [option for family in data.values() for option in family["options"]]
    return [option for family in data.values() for option in family["options"]]


def _base_fields() -> dict[str, dict]:
    fields: dict[str, dict] = {}
    for option in _read_options("comparison_families.json"):
        header = option["header"]
        fields[header] = {
            "header": header,
            "label": _option_label(header, option["meaning"]),
            "unit": _unit(header),
            "data_type": _type(header),
            "description": _description(header) or option.get("caution") or option["meaning"],
            "source": ", ".join(sorted(set(option.get("layers", {}).values()))),
            "sources": option.get("sources", {}),
            "planets": sorted(option.get("sources", option.get("layers", {}))),
            "capabilities": ["comparison"],
            "category": _category(header),
            "definition": _description(header) or option.get("caution") or option["meaning"],
        }
    for option in _read_options("filter_families.json"):
        header = option["header"]
        meaning = option.get("meaning") or _filter_label(header)
        if header in fields:
            fields[header]["capabilities"].append("filter")
            fields[header]["planets"] = sorted(set(fields[header]["planets"]) | set(option.get("sources", option.get("layers", {}))))
            fields[header]["sources"].update(option.get("sources", {}))
            continue
        fields[header] = {
            "header": header,
            "label": _filter_label(header) if _filter_label(header) != header else _label(header),
            "unit": _unit(header),
            "data_type": _type(header),
            "description": option.get("caution") or meaning,
            "source": ", ".join(sorted(set(option.get("layers", {}).values()))),
            "sources": option.get("sources", {}),
            "planets": sorted(option.get("sources", option.get("layers", {"earth": ""}))),
            "capabilities": ["filter"],
            "category": _category(header),
            "definition": option.get("caution") or meaning,
        }
    for item in fields.values():
        header = item["header"]
        item.setdefault("definition", item.get("description") or item["label"])
        item.setdefault("category", _category(header))
        item.setdefault("capabilities", [])
        item.setdefault("planets", sorted(item.get("sources", {})) or ["earth", "mars"])
        item.setdefault("sources", {})
        if _true_fraction(header):
            item["display_unit"] = "%"
            item["display_scale"] = 100
    return fields


def _filter_label(header: str) -> str:
    return {
        "tree_frac": "Tree cover fraction",
        "shrub_frac": "Shrub cover fraction",
        "grass_frac": "Grass cover fraction",
        "crop_frac": "Crop cover fraction",
        "built_frac": "Built cover fraction",
        "bare_frac": "Bare ground fraction",
        "snow_frac": "Snow cover fraction",
        "water_frac": "Water cover fraction",
        "wetland_frac": "Wetland cover fraction",
        "mangrove_frac": "Mangrove cover fraction",
        "moss_frac": "Moss cover fraction",
        "water_mask_frac": "Mapped surface-water fraction",
        "sand_pct": "Sand content by mass",
        "silt_pct": "Silt content by mass",
        "clay_pct": "Clay content by mass",
        "rock_frac_pct": "Coarse rock-fragment volume percentage of soil",
        "min_abund_feoxide": "EMIT ferric-oxide abundance estimate",
        "min_abund_al_clay": "EMIT aluminum-clay abundance estimate",
        "min_abund_femg_clay": "EMIT iron-magnesium-clay abundance estimate",
        "min_abund_sulfate": "EMIT sulfate abundance estimate",
        "min_abund_carbonate": "EMIT carbonate abundance estimate",
        "ndvi_mean": "Mean normalized difference vegetation index",
        "ndvi_max": "Maximum normalized difference vegetation index",
    }.get(header, header)


def _option_label(header: str, meaning: str) -> str:
    labels = {
        "tsurf_mean_K": "Mean surface temperature",
        "tsurf_min_K": "Minimum surface temperature",
        "tsurf_max_K": "Maximum surface temperature",
        "tsurf_diurnal_K": "Day–night surface temperature range",
        "tsurf_seasonal_K": "Seasonal surface temperature range",
        "elev_range": "Elevation range",
        "elev_range_robust": "Robust elevation range",
        "local_relief_1km": "Local relief (1 km)",
        "slope_mean": "Mean slope",
        "slope_median": "Median slope",
        "slope_std": "Slope variability",
        "slope_p90": "90th-percentile slope",
        "slope_p99": "99th-percentile slope",
        "roughness_detrended_std": "Detrended roughness",
        "tri_p50": "Median terrain ruggedness",
        "tri_p90": "90th-percentile terrain ruggedness",
        "tpi_mean": "Mean topographic position",
        "tpi_p10": "10th-percentile topographic position",
        "tpi_p90": "90th-percentile topographic position",
        "dune_frac": "Mapped dune area fraction",
        "dist_dune_km": "Distance to nearest mapped dune",
        "drain_dens_km_km2": "Mapped drainage density",
        "dist_channel_km": "Distance to nearest mapped channel",
        "ice_wt_pct": "Estimated near-surface ice content",
        "ice_frac": "Source-specific ice/permafrost indicator",
        "water_mask_frac": "Mapped surface-water fraction",
    }
    if header.startswith("slope_frac_gt_"):
        return f"Area above {header.removeprefix('slope_frac_gt_')}° slope"
    return labels.get(header, meaning)


def _unit(header: str) -> str:
    if header == "ati_inv_K":
        return "1/K"
    if header.startswith(("ti_tiu_", "ti_day_tiu_")):
        return "tiu (J m⁻² K⁻¹ s⁻½)"
    if header.startswith("grain_eff_um"):
        return "µm"
    if header.startswith("ice_wt_pct_frend"):
        return "wt%"
    if header.startswith("mapped_unit_fraction_"):
        return "fraction (0–1)"
    if header == "surface_temp_seasonal_diurnal_ratio":
        return "unitless"
    if header.endswith(("_deg", "_lat", "_lon")) or header in {"lat", "lon", "center_lat", "center_lon"}:
        return "degrees"
    if header.startswith("ice_wt_pct"):
        return "wt%"
    if header.endswith(("_K", "_deg")):
        return "K" if header.endswith("_K") else "degrees"
    if header.endswith("_Pa"):
        return "Pa"
    if header.endswith("_kg_m2"):
        return "kg/m²"
    if header.endswith("_W_m2"):
        return "W/m²"
    if header.endswith("_ms"):
        return "m/s"
    if header.endswith("_m") or header in {"elev_min", "elev_max", "elev_mean", "elev_p05", "elev_p95", "elev_range", "elev_range_robust", "roughness_detrended_std", "local_relief_1km"}:
        return "m"
    if header.startswith("slope_"):
        return "degrees" if "frac" not in header else "fraction (0–1)"
    if header in {"valid_frac_200m"}:
        return "fraction (0–1)"
    if header.endswith("_km") or header.endswith("_km_km2"):
        return "km" if header.endswith("_km") else "km/km²"
    if header in {"ice_wt_pct", "ice_wt_pct_sigma"} or header.startswith("ice_wt_pct_frend"):
        return "wt%"
    if header in {"sand_pct", "silt_pct", "clay_pct"}:
        return "wt%"
    if header in {"rock_frac_pct", "rock_frac_pct_std"}:
        return "vol%"
    if header.endswith(("_pct", "_pct_std")):
        return "%"
    if "coverage" in header or "_frac_" in header or header.endswith(("_frac", "_share", "_ratio")):
        return "fraction (0–1)"
    if header.startswith(("n_", "ew_samples_", "ns_samples_")) or header in {"n_samples_200m", "n_valid_samples_200m"}:
        return "samples"
    return "unitless"


def _type(header: str) -> str:
    if header.endswith(("_status", "_flag")) or header in {"quality_flags", "interp_flag"}:
        return "quality_flag"
    if "pct" in header or header == "ti_pct":
        return "percentage"
    if "frac" in header or header.endswith("_share") or "coverage" in header:
        return "fraction"
    if header in {"dune_type", "geomorphon_major", "lc_major", "feature_type", "feature_class", "dominant_mapped_unit", "broad_age_class"}:
        return "categorical"
    if header in {"max_order", "priority"}:
        return "ordinal"
    if header.endswith(("_n_50km", "_count")) or header == "crater_n_50km":
        return "count"
    if header.startswith(("n_", "ew_samples_", "ns_samples_")) or header in {"n_samples_200m", "n_valid_samples_200m"}:
        return "count"
    if header in {"surface_not_ground", "has_emit", "emit_l3_valid", "is_exact_duplicate_row"}:
        return "boolean"
    if header in {"comment"}:
        return "text"
    if header in {"priority", "max_order"}:
        return "ordinal"
    if header in {"dune_type", "geomorphon_major", "lc_major", "feature_type", "feature_class", "dominant_mapped_unit", "broad_age_class", "LithMajor", "LithMinor", "LithCntact", "PrdContact", "glim_class_code", "glim_class_id"} or header.startswith(("Eon", "Era", "Prd")):
        return "categorical"
    return "continuous"


def _documented_headers() -> set[str]:
    return set(json.loads((_CATALOG / "display_fields.json").read_text()))


def _label(header: str) -> str:
    special = {
        "tsurf_mean_K": "Mean surface temperature",
        "tsurf_min_K": "Minimum surface temperature",
        "tsurf_max_K": "Maximum surface temperature",
        "tsurf_diurnal_K": "Day–night surface temperature range",
        "tsurf_seasonal_K": "Seasonal surface temperature range",
        "psurf_Pa": "Mean surface pressure",
        "h2o_col_kg_m2": "Mean total-column water vapour",
        "sw_down_W_m2": "Mean downwelling shortwave radiation",
        "wind_mean_ms": "Mean 10 m wind speed",
        "absorbed_shortwave_est_W_m2": "Estimated absorbed shortwave radiation",
        "al_clay": "Aluminum clay",
        "femg_clay": "Iron–magnesium clay",
        "feoxide": "Ferric oxide",
        "crater_dens_50km": "Impact crater density within 50 km",
        "crater_dmax_50km_km": "Largest impact crater diameter within 50 km",
        "crater_n_50km": "Impact crater count within 50 km",
        "dist_crater_km": "Distance to nearest impact crater rim",
        "dz_hyps_m": "Elevation difference used for pressure adjustment",
        "emit_l3_valid": "EMIT level 3 data valid",
        "era5_h2o": "ERA5 atmospheric water vapour",
        "era5_psurf": "ERA5 surface pressure",
        "era5_sw": "ERA5 shortwave radiation",
        "era5_tsurf": "ERA5 surface temperature",
        "era5_wind": "ERA5 wind",
        "extreme_slope_contrast_deg": "Extreme slope contrast",
        "geomorphon_major": "Dominant geomorphon class",
        "glim_class_code": "GLiM lithology class code",
        "glim_class_id": "GLiM lithology class identifier",
        "has_emit": "EMIT data available",
        "interp_flag": "Interpolation flag",
        "lc_major": "Dominant land-cover class",
        "max_order": "Maximum stream order",
        "region_id": "Region identifier",
        "src_res_km": "Source resolution",
        "rock_frac_pct_std": "Rock fragment content standard deviation",
        "surface_temp_seasonal_diurnal_ratio": "Seasonal-to-diurnal surface temperature variation ratio",
        "thermal_inertia_day_night_contrast": "Day–night thermal inertia contrast",
        "thermal_inertia_rel_spread": "Relative thermal inertia spread",
        "ice_wt_pct_sigma": "Estimated near-surface ice content uncertainty",
        "ice_wt_pct": "Estimated near-surface ice content",
        "elev_min": "Minimum terrain elevation",
        "elev_max": "Maximum terrain elevation",
        "elev_mean": "Mean terrain elevation",
        "elev_p05": "5th-percentile terrain elevation",
        "elev_p95": "95th-percentile terrain elevation",
        "elev_range": "Full terrain elevation range",
        "elev_range_robust": "Robust terrain relief (95th minus 5th percentile)",
        "rough_0p6": "K–H roughness at 0.6 km baseline (source-specific proxy)",
        "rough_2p4": "K–H roughness at 2.4 km baseline (source-specific proxy)",
        "rough_9p6": "K–H roughness at planet-specific baseline (source-specific proxy)",
        "dune_frac": "Mapped dune area fraction",
        "ice_frac": "Source-specific ice/permafrost indicator. Mars SWIM2 measures the fraction of valid pixels with modeled subsurface ice-consistency evidence; Earth Permafrost CCI measures permafrost area fraction. These are distinct quantities and must not be treated as equivalent.",
        "ferric_valid_coverage": "OMEGA valid-data coverage fraction",
        "cov_frac_emit": "EMIT acquisition footprint fraction",
        "ti_pct": "Thermal inertia percentile within Mars",
        "ati_inv_K": "Apparent thermal inertia (inverse kelvin proxy)",
        "albedo_snow_frac": "MODIS-derived snow-related albedo fraction.",
        "surface_not_ground": "Surface classified as not ground",
        "mapped_coverage": "Mapped geology coverage fraction",
        "LithMajor": "USGS regional major lithology class",
        "LithMinor": "USGS regional minor lithology class",
        "LithCntact": "USGS regional contact classification",
        "PrdContact": "USGS regional period contact classification",
        "band": "Grid band identifier",
        "column": "Grid column identifier",
        "n_samples_200m": "200 m samples",
        "n_valid_samples_200m": "Valid 200 m samples",
        "valid_frac_200m": "Valid 200 m sample fraction",
        "ew_samples_averaged": "East–west samples averaged",
        "n_native_samples": "Native-resolution samples",
        "n_valid_native_samples": "Valid native-resolution samples",
        "sample_spacing_m": "Native sample spacing",
        "ns_samples_averaged": "North–south samples averaged",
    }
    if header in special:
        return special[header].strip()
    if header.startswith("geom_frac_"):
        return f"Geomorphon {header.removeprefix('geom_frac_')} area fraction"
    if header.startswith("mapped_unit_fraction_"):
        return f"Mapped area fraction of geology unit {header.removeprefix('mapped_unit_fraction_')}"
    minerals = {"feoxide": "ferric oxide", "al_clay": "aluminum clay", "femg_clay": "iron–magnesium clay", "sulfate": "sulfate", "carbonate": "carbonate"}
    if header.startswith("min_abund_") or header.startswith("min_frac_"):
        abundance = header.startswith("min_abund_")
        name = header.removeprefix("min_abund_" if abundance else "min_frac_")
        bound = " lower bound" if name.endswith("_lo") else " upper bound" if name.endswith("_hi") else ""
        name = name.removesuffix("_lo").removesuffix("_hi")
        return f"EMIT {minerals.get(name, name.replace('_', ' '))} {'abundance estimate' if abundance else 'area fraction'}{bound}"
    if header.startswith("lst_"):
        labels = {"day": "Daytime", "day_max": "Maximum daytime", "night": "Nighttime", "night_min": "Minimum nighttime", "diurnal": "Day–night variation in", "seasonal_amp": "Seasonal amplitude of", "seasonal_range": "Seasonal range of"}
        key = header.removeprefix("lst_").removesuffix("_K")
        return f"{labels.get(key, key.replace('_', ' '))} MODIS land-surface temperature"
    if header.startswith("ice_consistency"):
        depths = {"": "all depths", "_0_1m": "0–1 m depth", "_1_5m": "1–5 m depth", "_gt5m": "greater than 5 m depth"}
        return f"SWIM2 ice-consistency index ({depths.get(header.removeprefix('ice_consistency'), header)})"
    if header.startswith("ti_tiu_") or header.startswith("ti_day_tiu_"):
        stat = header.removeprefix("ti_day_tiu_") if header.startswith("ti_day_tiu_") else header.removeprefix("ti_tiu_")
        statistic = {"mean": "Mean", "std": "Standard deviation of", "p10": "10th-percentile", "p50": "Median", "p90": "90th-percentile"}.get(stat, stat)
        return f"{statistic} {'daytime ' if header.startswith('ti_day_') else 'nighttime '}TES thermal inertia"
    if header.startswith("ice_wt_pct_frend"):
        suffix = header.removeprefix("ice_wt_pct_frend")
        return f"FREND {'minimum ' if suffix == '_min' else 'maximum ' if suffix == '_max' else ''}ground-hydrogen water-equivalent percentage"
    if header.startswith("grain_eff_um"):
        suffix = header.removeprefix("grain_eff_um")
        return f"{'10th-percentile ' if suffix == '_p10' else '90th-percentile ' if suffix == '_p90' else ''}effective grain size"
    if header.endswith("_status"):
        return f"Computation status for {header.removesuffix('_status').replace('_', ' ')}"
    if header in {"center_lat", "lat"}:
        return "Cell center latitude" if header == "center_lat" else "Latitude"
    if header in {"center_lon", "lon"}:
        return "Cell center longitude" if header == "center_lon" else "Longitude"
    if header == "elev_mean":
        return "Mean terrain elevation"
    readable = header.replace("_", " ").replace("km2", "km²").replace("kg m2", "kg/m²")
    readable = re.sub(r"\bfrac\b", "fraction", readable)
    readable = re.sub(r"\bpct\b", "percentage", readable)
    readable = re.sub(r"\btiu\b", "thermal inertia units", readable)
    for abbreviation, expansion in {"std": "standard deviation", "sigma": "standard deviation", "mean": "mean", "min": "minimum", "max": "maximum", "amp": "amplitude", "res": "resolution", "src": "source", "temp": "temperature", "rel": "relative", "eff": "effective", "diurnal": "day–night", "p05": "5th percentile", "p10": "10th percentile", "p50": "median", "p90": "90th percentile", "p95": "95th percentile", "p99": "99th percentile"}.items():
        readable = re.sub(rf"\b{abbreviation}\b", expansion, readable)
    return readable[0].upper() + readable[1:] if readable else header


def _description(header: str) -> str:
    if header.startswith("rough_"):
        return "K–H roughness values are provisional planet-specific proxies; Mars registration, shot selection and cross-planet normalization remain open."
    if header == "ice_frac":
        return "Mars SWIM2 measures the fraction of valid pixels with modeled subsurface ice-consistency evidence; Earth Permafrost CCI measures permafrost area fraction. These are distinct quantities and must not be treated as equivalent."
    if header.startswith("min_frac_"):
        return "Documented EMIT area-fraction column; remains unpopulated in the current release."
    if header == "ti_pct":
        return "Percentile relative to the Mars thermal-inertia distribution; not an absolute physical measurement."
    if header == "dune_type":
        return "Dune classes are source-specific between Mars MGD3 and Earth Gunn/GSDP30."
    return ""


def _category(header: str) -> str:
    if header.startswith(("elev", "slope", "rough", "tri_", "tpi_", "local_relief", "geom_frac", "moderate_slope", "relative_terrain", "landform_", "low_position_", "relief_channel", "extreme_slope")):
        return "terrain"
    if header.startswith(("ice_", "shallow_deep_")):
        return "ice and volatile proxies"
    if header.startswith(("tsurf_", "psurf_", "h2o_col_", "sw_down_", "wind_", "lst_", "ndvi_", "albedo", "ati_", "thermal_inertia", "surface_temp_", "absorbed_shortwave", "atmospheric_column", "column_water")):
        return "climate and surface properties"
    if header.startswith(("dune", "dist_dune", "dist_channel", "drain_", "crater_", "dist_crater", "max_order", "feature_")):
        return "geomorphology and landforms"
    if header.startswith(("min_", "mapped_mineral", "ferric_", "hydrated_", "grain_eff", "sand_", "silt_", "clay_", "rock_frac", "fine_particle")):
        return "mineralogy and soil"
    if header.endswith("_frac") or header.endswith("_pct") or header.endswith("_share") or header == "mapped_coverage":
        return "coverage and composition"
    if header in {"lat", "lon", "center_lat", "center_lon", "band", "column", "planet", "region_id", "grid_version", "src_res_km"}:
        return "cell identifiers and coordinates"
    if header in {"quality_flags", "interp_flag", "emit_l3_valid", "has_emit", "surface_not_ground", "is_exact_duplicate_row"} or header.endswith("_status"):
        return "quality and provenance"
    if header in {"comment", "priority", "broad_age_class", "dominant_mapped_unit", "LithMajor", "LithMinor", "LithCntact", "PrdContact", "glim_class_code", "glim_class_id", "geomorphon_major", "lc_major", "dune_type", "feature_type", "feature_class"}:
        return "geology and class labels"
    return "dataset context"


def _planets(header: str) -> list[str]:
    earth_only_prefixes = ("tree_", "shrub_", "grass_", "crop_", "built_", "bare_", "snow_", "water_", "wetland_", "mangrove_", "moss_", "sand_", "silt_", "clay_", "rock_frac", "min_", "ndvi_", "lst_", "mapped_mineral", "fine_particle", "glim_", "Lith", "Prd", "emit_", "has_emit", "surface_not_ground")
    mars_only_prefixes = ("crater_", "dist_crater", "ice_consistency", "ice_wt_pct_frend", "ti_", "ferric_", "hydrated_", "mapped_unit_fraction_", "broad_age_class", "dominant_mapped_unit")
    if header.startswith(earth_only_prefixes):
        return ["earth"]
    if header.startswith(mars_only_prefixes) or header == "ti_pct":
        return ["mars"]
    return ["earth", "mars"]


def _true_fraction(header: str) -> bool:
    return (header.endswith(("_frac", "_share")) or "coverage" in header or "_frac_" in header or header.startswith(("mapped_unit_fraction_", "geom_frac_", "slope_frac_gt_"))) and not any(token in header for token in ("ratio", "index", "ndvi", "ti_pct", "_pct"))


@lru_cache(maxsize=1)
def _all_fields() -> dict[str, dict]:
    fields = _base_fields()
    extras = _documented_headers()
    # Schema prose contains dataset/version identifiers and storage types, not columns.
    extras.difference_update({"float32", "uint8", "latband5km-v1", "latent_properties-v0.1", "fe6a1d7853191bce0ee9b5288910df2a2aa521f1"})
    # Expand schema shorthand into concrete published column names.
    extras.update(f"ti_tiu_{stat}" for stat in ("mean", "std", "p10", "p50", "p90"))
    extras.update(f"slope_frac_gt_{n}" for n in (2, 5, 10, 20, 30))
    extras.update(f"min_frac_{name}" for name in ("feoxide", "al_clay", "femg_clay", "sulfate", "carbonate"))
    # Explicit row keys and quality metadata named in the schema.
    extras.update({"grid_version", "region_id", "planet", "band", "column", "src_res_km", "interp_flag", "quality_flags", "lat", "lon", "center_lat", "center_lon", "elev_mean"})
    for header in extras:
        if header in fields:
            continue
        data_type = "identifier" if header in {"grid_version", "region_id", "planet", "band", "column"} else "quality_flag" if header in {"quality_flags", "interp_flag"} else "coordinate" if header in {"lat", "lon", "center_lat", "center_lon"} else _type(header)
        unit = "degrees" if data_type == "coordinate" else "km" if header == "src_res_km" else "unitless" if data_type in {"identifier", "quality_flag"} else _unit(header)
        label = _label(header)
        desc = _description(header)
        fields[header] = {"header": header, "label": label, "unit": unit, "data_type": data_type, "description": desc, "definition": desc or label, "category": _category(header), "planets": _planets(header), "sources": {}, "capabilities": ["context"]}
        if _true_fraction(header):
            fields[header]["display_unit"] = "%"
            fields[header]["display_scale"] = 100
    published = _CATALOG / "source_fields.json"
    if published.is_file():
        for header, field in json.loads(published.read_text()).items():
            original = fields.get(field.get("native_column", header), {})
            fields[header] = {"label": _label(header), "unit": "native units", "description": "",
                              **original, **field}
    return fields


def metadata(header: str) -> dict:
    """Return display metadata for a known dataset column, or None fields if unknown."""
    item = _all_fields().get(header)
    if item is not None:
        return dict(item)
    return {"header": header, "label": header, "unit": "unitless", "data_type": "unknown", "description": "", "source": None}


def dataset_fields() -> list[dict]:
    """Return display metadata for every documented dataset field."""
    return [dict(item) for item in _all_fields().values()]
