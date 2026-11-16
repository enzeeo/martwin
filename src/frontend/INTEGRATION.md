# Map-first integration update

The current UI no longer compares meshes. Its first production handoff needs Mars target coordinates and scored Earth candidate coordinates, names/IDs, real scores/ranks, geographic-list labels and provenance. DEM export is optional for this map-based milestone. The page's local import shape in README.md is proposed and must be adapted to the approved result/card output; it does not itself define a team contract.

The single-page process replay must be replaced by Priyanshu's actual streamed events, followed by validated plan/scorer events. Arbitrary typed coordinates/objectives must not silently display the reference catalog as calculated results. All-context queries should report no ranking. Reference-site display and imported recorded-run modes are already distinct.

The historical roadmap below predates the map-first revision. Treat its DEM and mesh recommendations as optional later work, not prerequisites for map results.

---

# Connecting the viewer to the scientific pipeline

This is an integration roadmap, not a production API contract. Coordinate interface changes with the relevant owners before implementation. The standalone viewer remains a synthetic interaction prototype.

## Current branch boundaries

- Enzo/Henry integration: `origin/main` includes the six-stage `pipeline/skeleton` and Caden's scoring adapters (PR #68). This UI branch has not merged that newer main history yet; preserve its uncommitted prototype edits before integrating.
- Caden: `pipeline/scoring` includes approved configs, masks, tolerances, geographic shortlists, result cards and real-run approval checks. Prefer the six-stage adapters and `run_e2e`, not the older standalone skeleton's separate scorer.
- Priyanshu: PR #69 proposes ontology selection plus SQL retrieval and the tracer/reasoning graph. It is not merged. PR #65's ontology mappings need domain review. The tracer's existing run/events/review/selection routes should be reused where possible, rather than inventing a second trace protocol.
- Brayden: PR #54's registry and measurement work are not merged; uncertainty support must be capability-gated. Missing covariance and base terms must not become zero error bars.
- Existing React placeholder PR #53 remains separate from this standalone prototype.

## Implementation sequence

1. Preserve these local edits and integrate reviewed main changes into the UI branch without rebasing shared history. Resolve PR #52/environment setup and the documented fixture/sample decisions with the team. Use a supported Python version and compatible pandas versions; prior branch reports identify pandas 3 compatibility failures.
2. Agree on one reviewed request/result contract: Mars region, objective, selected feature IDs, confirmed comparison plan, approved weights, constraints, missing-value policy, data revision and run ID. Distinguish draft user weights from approved real-run configurations. Do not bypass G0 to make sliders appear live.
3. Run the approved B0T-R2 baseline on small local fixtures, then a bounded authenticated real snapshot. Use a clean output directory; pin data revisions and layer versions. Record source/config/plan hashes, candidate counts, exclusions, timings and all warnings. Confirm the required derived ice-mask table exists.
4. Expose a backend job wrapper around the six-stage adapters: start a run, stream stage events, retrieve status/results, handle cancellation and errors. Reuse Priyanshu's tracer events for feature-selection review. Keep HF_TOKEN and model credentials on the backend. Browser code must never hold those secrets.
5. In the Process tab, replace scripted artifacts with server events and reviewed selection. Preserve the original model trace and user review edits separately. Unsupported features stay context-only; an all-context plan has no terrain ranking. Check result status before rendering a candidate list.
6. In the Terrain tab, load small result JSON/card sets and bounded real DEM patches. A backend conversion can turn the scientific DEM window into a heightfield/mesh. Record coordinate system, vertical units, source resolution, downsampling and exaggeration. Display terrain is distinct from the 5 km analysis support.
7. Use the actual group distances, effective weights, global ranks, geographic lists and data-coverage diagnostics. Sample rows from truncated ranked files are not search results. Do not infer population statistics from top-N files. Cache the Earth reference and data by pinned revision/config, not by query text alone.
8. Add reviewed literature evidence to selection explanations. Integrate new metrics and uncertainty only after scientific and shared-interface review, then rerun the pre-registered evaluation. Hosting follows local integration rather than preceding it.

## This session's sample-test outcome

Fresh raw-data scoring was NOT RUN. The scorer's pinned private dataset returned HTTP 401 to an unauthenticated API request. No local processed population or analysis packages are installed in the available Python environments. No credentials or environment files were opened and no dependencies were installed.

`access-check.json` records the attempt and two stdlib checks on committed, real-derived R2 metadata: the approved group weights sum to 1, and sequential mask removals reconcile 6,009,935 pre-mask cells to 5,320,516 eligible cells (689,419 removed). This does not reproduce a scorer run.

To proceed, the user configures HF_TOKEN themselves with read access to `guardians-of-a-galaxy/starman`; use the team's agreed Python environment and required local derived inputs. After the current main is integrated, the documented baseline command is:

```bash
python -m pipeline.scoring.run_e2e \
  pipeline/scoring/fixtures/e2e/jezero_floor_terrain_r2.comparison.json \
  /tmp/guardians-jezero-real-run \
  --selection pipeline/scoring/fixtures/e2e/jezero_floor_terrain_r2.selection.json \
  --target jezero_floor
```

The output directory must be new/empty. Leave approval gates enabled. This command loads the real population; a bounded sample harness needs agreement on its sampling and reference population, and its results must be labelled subset-relative rather than global.

## Recommended evaluation

- Feature selection: macro precision/recall over expert-labelled objectives, tier-aware recall, unsupported/unavailable-selection rate, and source-citation correctness. Hold out objectives and use spatial/site splits so nearby cells are not treated as independent examples.
- Retrieval: known-analog global percentile plus location-level Recall@k. Use nDCG@k only with human graded relevance judgements. Unlabelled new locations are not known negatives. Report top-k unique locations, not many adjacent cells of one site.
- Stability: tile Jaccard@k, rank-biased overlap, Spearman/Kendall on a stated common set, and retention under separately labelled weight and measurement perturbations. These assess stability, not geological truth.
- Integrity: mask survival of known sites, fraction with enough comparable groups, missingness by region, effective-weight changes, provenance completeness and out-of-distribution flags. Include zero-tolerance and NaN policy tests.
- Systems: cold and warm p50/p95 end-to-end and per-stage latency, peak memory, bytes read, cache hit rate, terrain payload size and browser frame time. Record population size, hardware and revision. No global runtime claim from a tiny fixture.

Previously recorded R2 evidence (from `pipeline/scoring/HANDOFF.md`, not rerun here): B0T-R2 remained preferred to expanded B0; paired-known-analog median percentiles were 62.7 versus 68.0 (lower is better), Jezero/Gale tile overlap 0.29 versus 0.03. Olympus analogs included Lanzarote at 0.1% and HI-SEAS at 1.3%. These are benchmark observations, not universal accuracy guarantees.

Metric references: [nDCG](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.ndcg_score.html), [Spearman](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.spearmanr.html), [Kendall](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.kendalltau.html).
