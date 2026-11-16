"""Terrain representations backed by the frozen Method D inputs."""

TERRAIN_FEATURES = frozenset({
    "slope_mean", "slope_frac_gt_2", "slope_frac_gt_5", "slope_frac_gt_10",
    "slope_frac_gt_20", "slope_frac_gt_30", "local_relief_1km", "elev_range_robust",
    "roughness_detrended_std",
})

# Reviewed shared operators; source-specific proxies are deliberately excluded.
# See docs/starman-integration.md for evidence and held comparisons.
REVIEWED_COMPARISONS = TERRAIN_FEATURES | frozenset({
    "elev_range", "slope_median", "slope_std", "slope_p90", "slope_p99",
    "tri_p50", "tri_p90", "tpi_mean", "tpi_p10", "tpi_p90", "tsurf_mean_K",
})
