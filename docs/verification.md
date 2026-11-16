# Local verification · 2026-11-15

## Backend tests

All 19 tests passed with this command from the deploy checkout. The local Python 3.12 runtime used an existing cached NumPy build.

```sh
PYTHONPATH="$HOME/.cache/uv/archive-v0/WvXTRBTdLjWQ6cZo/lib/python3.12/site-packages" .venv/bin/python -m unittest discover -s src/backend -t .
```

## Jezero Method D request

The local FastAPI test client sent this request to `POST /api/score` with `GUARDIANS_TERRAIN_DIR=/private/tmp/guardians-terrain-71` and real prepared terrain inputs.

```json
{
  "longitude": 77.4509,
  "latitude": 18.4447,
  "objective": "Compare steep terrain and relief.",
  "comparisons": [
    {"feature_id": "slope_distribution", "header": "slope_mean", "weight": 3},
    {"feature_id": "slope_distribution", "header": "slope_frac_gt_20", "weight": 1},
    {"feature_id": "relief", "header": "local_relief_1km", "weight": 2}
  ]
}
```

HTTP 200 returned Mars target `M_1285_02895` and effective weights of 1/2, 1/6 and 1/3 in the order shown above. Method D scored 5,854,623 eligible Earth cells, with zero incomplete for these three headers. Rank 1 was `E_2824_03773` at latitude 37.20966875100901 and longitude 32.55828508840557, with score 0.000054431195941080575. Per-header contributions summed to the reported score for every returned candidate in the top 20.

The prepared bundle's `manifest.json` records 18,333 held-out Earth reference cells, 5,797,982 Mars grid cells, the validated Earth benchmark input receipt for Starman revision `228b3b804868b8a660366c1d04ea61d9c85aa07d`, and SHA-256 hashes for the 63 local terrain source shards used for Earth `slope_mean` and Mars values. The reference ID was `terrain-global-v1:d19d749af4d8af38ef4dd70aa8049c92daeb06ae9efea183b4e7d16a1241f8a1`.

## Browser interactions

`tools/test_frontend.cjs` passed in installed Chrome using the existing Playwright runtime and fixture API responses. It checked real DOM transitions for selection stages, replacement of the map, unavailable-feature blocking, add/remove controls, submitted individual weights, persistent ranked-result labels, invalidation after edits and stale-response cancellation. External network requests were blocked in this harness.

The live OpenRouter provider and remote deployment were outside this local verification.
