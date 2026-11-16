# Starman integration (#79)

The website exposes prepared capabilities, not the entire conceptual catalog. A
comparison appears only when its reviewed operator, Earth and Mars arrays, and
usable frozen Earth reference are loaded. Model menus and the review editor use
that same availability. A selected Mars cell must also have a finite value.
Filters require populated, correctly shaped native-value arrays. Empty families
and unconfigured dataset fields are omitted. Native result context omits nulls.

## Audit and preparation

Pinned source: `enzeeoai/starman` at
`228b3b804868b8a660366c1d04ea61d9c85aa07d`.

`tools/audit_starman.py` inventories every current primary Parquet shard and one
representative schema for each superseded table. Archives, QA artifacts and
provenance are inventoried as files; they are not treated as additional current
measurement tables. Its receipt records source paths, hashes, schemas and row
counts. `tools/prepare_starman.py` verifies hashes and joins by exact region ID.
The generated `audit.json` gives each source column a disposition and reason.

Preparation preserves the existing 5,854,623 Earth candidate cells, 5,797,982
Mars cells and 18,333-cell frozen Earth reference. It does not silently expand
the benchmark population. Native filters use raw values, independently of any
scoring transform. Latent status codes mask invalid values. Categorical fields
retain source labels; zero/unknown land-cover and geomorphon codes remain missing.

Run these scripts with the existing research environment containing NumPy,
PyArrow and huggingface_hub. No serving dependency is added:

```sh
hf datasets info enzeeoai/starman --format json > info.json
python tools/audit_starman.py info.json source-directory
PYTHONPATH=. python tools/prepare_starman.py source-directory/source-receipt.json \
  frozen-base-bundle frozen-reference-plan.json new-output-directory
```

Keep the source revision pinned. Preparation requires the source receipt and base
bundle to agree. Copy generated `source_fields.json` to
`src/backend/catalog/source_fields.json`, then configure `GUARDIANS_TERRAIN_DIR`
or link the completed bundle at ignored `data/scoring`. Preparation creates a new
output directory, preserves existing scoring arrays via links to the base bundle,
and never overwrites the source data. Retain that base bundle while using its links.

## Verified release

The prepared release contains 20 comparisons, 203 Earth measurement filters
(plus latitude/longitude), 203 Earth context fields and 179 Mars context fields.
All 20 comparisons passed individual real-data scoring API requests. All 205
filter masks were exercised against the real candidate arrays; numeric, fraction,
boolean and categorical filters also passed scoring API requests. Detailed
results are in `starman-integration-verification.json`; source-column dispositions
are in `starman-integration-audit.json`.

Seven current aligned fields are entirely missing in this candidate population
and are hidden: Earth `min_frac_feoxide`, `min_frac_al_clay`, `min_frac_femg_clay`,
`min_frac_sulfate`, `min_frac_carbonate`, `kh_roughness__src_res_km`; Mars
`kh_roughness__n_px`. Mineral abundance fields remain available as native Earth
values where present; absent fraction fields are not substituted with abundance.

## Comparison policy

- Fourteen terrain operators: elevation range and robust range; mean, median,
  standard deviation, p90 and p99 slope; slope fractions above 2/5/10/20/30 degrees;
  detrended roughness; 1 km local relief.
- Five shared geomorphometry operators: TRI p50/p90 and TPI mean/p10/p90.
- Annual mean surface temperature: MCD `tsurf_mean_K` and ERA5 skin-temperature
  `tsurf_mean_K`. This is the already reviewed physical pair, enabled after the
  published Earth backfill passed its scientific review. Evidence:
  `releases/starman-backfill-20261114-01a1dc40/era5/qa/era5-final-scientific-review.json`
  and the adjacent ERA5 manifest. The comparison remains a climatological proxy
  across different planets and periods, not simultaneous observations.

The original nine transforms and scales remain unchanged. New one-variable
Method D blocks use native units with scale 1 and fit the same frozen Earth
reference. In one dimension the positive scale cancels against the reference
standard deviation. A missing/degenerate reference disables that comparison.
The score formula is unchanged. Missing selected Earth measurements exclude the
candidate; missing selected Mars measurements reject the request.

## Native fields and exclusions

Other populated aligned fields are available as Earth filters and/or result
context, including climate, land cover, mineral coverage, latent properties,
regional geology and measurement coverage. This does not make them equivalent
Earth/Mars representations. Source-specific duplicate names are qualified by
layer. Published metadata retains each planet's source table and revision.

No inferred comparisons are introduced for TES thermal inertia versus MODIS ATI,
SWIM consistency versus terrestrial ice fractions, mineral instrument products,
river/valley products, latent quantities or geomorphon fractions. Their scientific
mappings need separate review. Geology categories remain native categories.

Superseded versions, source bookkeeping, fields with no usable values in the
configured population, and tables lacking an aligned cell join stay hidden.
Native site, coarse-grid and window tables need a reviewed mapping before they
can become per-cell scorer inputs. Unavailable upstream layers remain unavailable;
no replacement measurements are fabricated. Archived footprint-offset sensitivity
is not silently converted to total measurement uncertainty.

The local bundle is not uploaded to HF or deployed remotely by this change.
