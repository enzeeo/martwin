# Shared contracts

Status: READY

Owner: @enzeeo. Scope: deploy website, issues #71 and #75.

- Selection accepts signed Mars longitude/latitude and an objective. Backend progress reports actual feature-selection and representation-selection stages; completion supplies the model-selected representations and evenly split default weights totaling 1.00, rounded to two decimals.
- The map area becomes the progress area, then the review editor. Users may add available representations, remove them, and edit their positive weights before explicitly submitting Find Earth matches.
- The confirmed plan identifies every selected representation and its weight. Weight keys identify individual catalog headers, not feature-family budgets. The server validates catalog membership and normalizes positive weights once for scoring.
- Each selected representation occupies one Method D weighted block. The existing Earth-reference fitting, Ledoit–Wolf shrinkage, distance calculation and fixed reference remain unchanged. User filters restrict candidates; spatial separation selects from the complete ordering. Removed representations do not contribute.
- These single-representation blocks have no cross-feature covariance terms. This is the intentional change in weighting granularity, not preservation of the former multi-feature block covariance.
- Real scoring requires prepared numeric Earth candidates, Mars targets, tolerances and the fixed Earth reference. Unsupported representations must be reported explicitly; they must never be silently dropped or replaced by demonstration results.
- Results include actual Method D ranks/scores, effective weights, candidate coordinates, reference provenance and candidate counts. The frontend displays those computed results using its existing map/result flow.
- Earth filter suggestions without thresholds remain suggestions; do not imply they were applied as numeric constraints.

Exact route and payload examples are documented with the implementation in README.md.

`POST /api/select/stream` takes the same `longitude`, `latitude`, and `objective` fields as `POST /api/select`. The new route sends newline-delimited JSON. Its `features` and `representations` stage events mark the start of real work. The `done` event carries `result.comparisons` and `result.filters`. Comparison rows include `score_available` and, where true, an editable two-decimal default `weight` (even split totaling 1.00; leading features receive rounding remainders); weights require no model call. The server sends `error` with `status` and `detail` for failures after the stream has started. The original synchronous route still returns its original selection shape.

`GET /api/catalog` marks supported comparison headers with `score_available`. `POST /api/score` accepts `longitude`, `latitude`, `objective`, `comparisons: [{feature_id, header, weight}]` and optional `filters: [{feature_id, header}]`. Each positive finite weight belongs to one unique header, and multiple distinct headers may share a family. Omit deleted headers. The Method D scorer normalizes weights once. The score response includes `ranked` records with `region_id`, `rank`, `score`, `latitude`, `longitude`, `group_distances` and `group_contributions`. Both breakdown objects and `effective_weights` use individual header keys. `filters_applied` refers to user-selected filters and is empty for suggestions without thresholds. The frozen Earth terrain eligibility rules apply before scoring. A target missing any selected measurement or a header outside the prepared data returns HTTP 422. Missing server data returns HTTP 503.

## Interface: Pixel observatory review and results
Producer: Selection API and prepared-data Method D adapter
Consumer: Same-origin browser review and map
Producer owner: @enzeeo
Consumer owner: @enzeeo
Input: Reviewed comparisons with positive individual weights, optional AND filter rules, result_count and min_separation_km.
Output: Actual selected feature events; catalog display names, units and availability; separated result rows preserving raw rank and score.
Signature: GET /api/catalog; POST /api/select/stream; POST /api/score
Errors: Invalid or unavailable explicit rules return 422; unavailable data returns 503; stream errors terminate the active visual state.
Input example: {"longitude":77.4509,"latitude":18.4447,"objective":"Compare slopes","comparisons":[{"feature_id":"slope_distribution","header":"slope_mean","weight":1}],"filters":[],"result_count":10,"min_separation_km":25}
Output example: {"ranked":[{"region_id":"E_0001_00001","rank":1,"score":0.2,"latitude":0,"longitude":0}]}
Artifact version: pixel-observatory-v1

### Rules

- Filter thresholds use raw source units, never transformed scoring columns. Numeric comparisons exclude missing values. Explicit missing-data rules are separate. All active rules must pass; reference fitting is fixed.
- Greedy separation scans the full eligible score ordering and accepts a site only when its center is at least the requested great-circle distance from every accepted site. It never changes scores, fabricates locations or silently relaxes separation.
- Friendly labels cover documented dataset fields; catalog coverage does not imply scoring or filtering availability. Original identifiers and scientific caveats remain accessible in details.
- The live diagram is populated only from returned selections. Original selection trace remains distinct from subsequent edits. Equal two-decimal default weights are retained; no weighting model call.
- While representations are chosen, the stage view shows every catalog option of each selected feature (from `GET /api/catalog`, loaded when the run starts) as a candidate. The pulsing and rewiring while waiting are decoration and treat every candidate alike. When `done` arrives, the kept and dropped options are replayed feature by feature in the order the model writes them (comparisons, then filters, each alphabetical); this is a compressed replay of one batched response, not live progress. A returned header missing from the catalog is still shown. Review opens after the replay ends or is skipped.

- `selected_continents` is optional: omitted bypasses continent masking; an empty array selects no cells. Supported names are Africa, Antarctica, Asia, Europe, North America, Oceania and South America. Explicit filtering without a prepared mask returns 422.
- Prepared `earth_continent.npy` aligns exactly to `earth_ids.npy`: 0 excluded/boundary/unassigned; codes 1–7 follow the continent order above. Manifest `continent_filter` records `source` and `policy`. Full footprint membership is required; centroid membership is insufficient.

Selection issue #76: for nonempty supported families, make one needs request then one batched representations request containing all comparison and Earth-filter menus. Each request has a 1,200-second timeout; there is no shared shorter deadline and no automatic retry. Invalid output fails selection. Public result shapes and scoring are unchanged.

### Compact editor and typed filters
- The UI displays integer percentage weights; API weights remain positive fractional values. Editing redistributes remaining weight. Original selection trace stays unchanged and collapsed by default.
- `dataset_fields` exposes curated label, definition, category, unit, data_type, source/planet metadata and capabilities. Capabilities describe intended use; `score_available`/`filter_available` describe actual prepared data.
- `display_scale: 100` and `display_unit: "%"` mark true fractions only. The browser divides display thresholds by this scale before submission.
- Numeric filters use finite raw numbers. Categories use `==`/`!=` with a nonempty string or `in` with a nonempty string array; choices come from prepared data. Booleans use `==` with a JSON boolean. `has_data`/`missing` need no value. Unsupported type/operator combinations return 422.
- Prepared `filter_<header>.npy` sidecars align with Earth IDs and are listed in manifest `filter_headers`. Category arrays are Unicode with empty string missing; boolean arrays contain bool or 0/1, with other values missing. Ordinary comparisons reject missing values, including `!=`. No category/boolean availability is advertised without a compatible sidecar.
- Clear flat glowing ASCII world map, no clouds; self-hosted Geist Sans/Mono; reduced-motion behavior remains supported.

## Issue #79: configured Starman capabilities

The prepared bundle is the authority for visible comparisons and Earth filters.
Comparison availability requires a reviewed Earth/Mars pair, aligned arrays, a
positive scale, and a usable fixed Earth reference. Both selection routes restrict
model menus before generation. Empty families and unconfigured dataset fields
are omitted. Explicit requests for unavailable measurements still fail clearly.
Native unmatched measurements remain filters/context, never fabricated twins.
Preparation records the pinned HF revision, source table/column, missingness and
exclusion reasons in an audit artifact. No new dependencies or scoring formula
changes. Verification includes catalog/selection/API fixtures and real-data probes
for every exposed comparison and filter.

Browser and API defaults: 10 results, minimum 25 km center-to-center separation. Map hover previews geographic details; clicking pins them until dismissed. Offline place labels report great-circle distance to a Natural Earth populated place, with that place's region/country; they do not assign administrative membership to the result cell.
