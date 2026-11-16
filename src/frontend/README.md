# Martwin frontend

Served by the FastAPI application (`uv run uvicorn src.backend.web:app`). Enter Mars latitude, longitude and an objective; review the selected comparisons and filters, then request Earth matches. Selection and scoring use the configured backend. There is no demo replay or reference-result fallback.

The decorative background uses `cosmic-background.js`: sparse twinkling ASCII stars, softly lit character planets and an occasional rocket. It respects reduced motion and pauses when the tab is hidden. The procedural character-pool and glow style follows the supplied glow-ascii-art skill, inspired by JIN2 (@jin_22ee). No rendering dependencies are added.

The ASCII Earth map provides geographic context; it does not represent terrain values. Imported results remain explicitly labelled unverified. External map links require network access.

## Verification

Run `tools/test_frontend.cjs` with an existing Playwright installation and Chrome through `PLAYWRIGHT_PATH` and `CHROME_PATH`. The test uses fixture API responses; it does not verify live model or data-provider availability.

## Point details and place labels

Hover a result pin to preview details; click to pin the bar open. Close it with ×, Escape or a blank map click. The result list also opens pinned details. Defaults are 10 results with 25 km minimum center-to-center spacing.

`places.js` contains 7,342 Natural Earth 1:10m populated places, reduced to latitude, longitude, name, administrative region and country. Labels give the great-circle distance to the nearest place in this dataset, not an exact address or the result cell's country. Remote sites can be far from a listed place. It works offline with no geocoding service or added dependencies.

Source: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson (retrieved 2026-11-15, public domain). Source SHA-256: `fd3fa867a320cbd5c5b6bb5bc550afeec2939fb2cef688e508007282a55ac42f`.

Focused map regression: run `tools/test_map_details.cjs` with the same existing Playwright/Chrome environment variables as the full frontend suite.
