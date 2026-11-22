# Martwin developer reference

Feature selection runs the pinned INDUS encoder with ONNX Runtime; serving does
not need PyTorch. Export it once with the `export` dependency group:

```sh
uv run --no-sync python tools/export_encoder_onnx.py data/encoder
```

The export writes `model.onnx`, the tokenizer and `encoder.json` (model revision
and checksums) to `data/encoder`, or to the directory named by
`MARTWIN_ENCODER_DIR`. The server checks the revision and checksums on load.
The Docker image runs this export in a separate build stage, so the final image
has no PyTorch. OpenRouter receives the objective, Mars coordinates, and relevant
catalog descriptions. Set `OPENROUTER_MODEL` before launching the app to override
the default model.

## Find Earth matches

1. Enter a Mars latitude, longitude, and objective, then choose **Select features**.
2. Review the suggested comparisons. Adjust their weights and activate any Earth
   filters you want to apply.
3. Choose **Find Earth matches** to rank eligible Earth locations and view them on the map.

To inspect a previously saved run, choose **Import recorded result**. Imported
locations are displayed as supplied and labeled unverified.

## API

Send JSON to `POST /api/select` with signed longitude and latitude in decimal degrees:

```json
{"longitude":77.4509,"latitude":18.4447,"objective":"Compare dune coverage and temperature. Look for low tree cover."}
```

The response has `comparisons` and `filters` arrays. Items carry the selected
column name, reasons, source metadata, and comparison caveats. `GET /healthz`
checks that the web server is responding. Invalid input returns 422. A busy
selector or OpenRouter rate limit returns 429. Provider or configuration failures
return a 5xx status with a short message.

The website uses `POST /api/select/stream` with the same input. Each newline-delimited
JSON event names the actual running stage: `features`, `features_selected` (actual returned families), `representations`,
then `done` with `result`, or `error` with `detail`. Default weights total 1.00 with two decimal places, split evenly with any
rounding remainder assigned in catalog-selection order. No model call is made for weights. `GET /api/catalog` supplies additions to the editor.

`POST /api/score` accepts the reviewed input and individual comparisons:

```json
{"longitude":77.4509,"latitude":18.4447,"objective":"Compare slopes","comparisons":[{"feature_id":"slope_distribution","header":"slope_mean","weight":3}],"filters":[]}
```

Use the catalog's exact `feature_id` for the header. Weights must be positive;
Method D normalizes them once. Each header is its own weighted block instead of
sharing a family weight. The distance formula inside each block is unchanged.
Unavailable comparison fields must be removed explicitly before scoring. Earth
filter fields remain inactive until an operator is chosen. Active rules are combined with AND
and run on raw source values before scoring. Operators: `>`, `>=`, `<`, `<=`, `==`,
`!=`, `between` (inclusive), `has_data`, `missing`. Categories support `==`, `!=`,
and `in` (a nonempty string list); booleans use `==` with a JSON boolean. A rule contains `feature_id`,
`header`, `operator` and, when required, `value` / `value_max`. Use `dataset_field`
for a field listed in `dataset_fields`; availability is explicit in the catalog.
Ordinary comparisons exclude missing values. Category choices come from actual
prepared Unicode arrays; boolean sidecars use bool or 0/1 (other values are missing).
The basic terrain bundle has numeric filters. Category and boolean controls
become available when matching sidecars are prepared.

The compact review displays weights as integer percentages and sends fractions.
True fraction fields display percentages and convert thresholds back to raw 0–1 values.
Selection trace, scientific details, continent settings and raw responses are collapsed
until requested. Geist Sans and Geist Mono are self-hosted under their OFL license.

Results default to `result_count: 10` and `min_separation_km: 25`. A greedy scan of
the complete score ordering selects sites separated from every previously chosen
site. Scores and original ranks are preserved. Fewer sites are returned if the
constraints cannot be met. Map markers number the displayed sites, not raw ranks.

Optional `selected_continents` lists eligible continents. An empty list permits
no cells; omission retains compatibility with bundles without continent masks.
The browser selects all seven when a prepared mask is available. Only cells whose
whole footprint belongs to a selected continent pass. Cross-boundary and coastal
partial cells are excluded. The fixed reference population is never refitted.

## Prepare local scoring data

The server reads an existing prepared terrain bundle through `GUARDIANS_TERRAIN_DIR`.
The basic terrain bundle supports slope mean, five slope-threshold fractions,
local relief, robust elevation range, and detrended roughness. See the
[Starman integration guide](starman-integration.md) for the expanded bundle.

Prepare the bundle using the research checkout's existing Python environment and
its completed `data/scoring-abcd/global-terrain-v1` artifacts plus local terrain
Parquets. This does not download data or launch a cloud job:

```sh
PYTHONPATH=/path/to/research-repo /path/to/research-repo/.venv/bin/python \
  tools/prepare_terrain.py /path/to/research-repo /path/to/new-terrain-bundle
GUARDIANS_TERRAIN_DIR=/path/to/new-terrain-bundle \
  uv run --no-sync uvicorn src.backend.web:app --host 127.0.0.1 --port 8080
```

To extend an existing frozen bundle with raw numeric terrain filters, append
`--from-bundle /path/to/existing-bundle` to the preparation command. The new bundle
links existing scoring arrays and writes aligned raw filter arrays plus provenance.
Keep the source bundle available while those links are in use.

To add continent filtering, provide local copies of Natural Earth's 1:10m
`ne_10m_geography_regions_polys.geojson` and `ne_10m_admin_0_map_units.geojson`:

```sh
/path/to/research-repo/.venv/bin/python -m tools.prepare_continents \
  /path/to/new-terrain-bundle /path/to/geography_regions.geojson /path/to/map_units.geojson
```

This preparation step uses the research environment's existing Shapely installation;
the web server still needs only its existing dependencies. Membership uses the exact
grid footprint, physical continent/island polygons and detailed land polygons.
The manifest records source hashes, the seam convention, excluded cells and per-continent
counts. Boundaries and island assignments are a cartographic convention, not inferred
from feature values. No Hugging Face dataset is modified. The displayed ASCII map uses
a separate, lower-resolution outline; it is never used for filtering.

The output directory must be new. The manifest records the fixed reference and
data provenance. Serving requires NumPy, already included in the `indus` dependency
group. Without a configured bundle, scoring returns 503.

## Run the fixture checks

```sh
uv sync --locked
uv run --no-sync python -m unittest src.backend.test_selection src.backend.test_web
```

With the existing `indus` group installed, run the complete backend suite with
`uv run --no-sync python -m unittest discover -s src/backend -t .`.

## Purpose

Martwin helps researchers explore Earth analogs for locations on Mars. It turns
a research objective into a reviewable set of comparisons and ranks eligible
Earth cells using Method D on prepared data. The chosen measurements, weights,
and filters define what counts as a match for each search.
