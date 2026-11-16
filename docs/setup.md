# Setup

Status: READY

Use the existing Python 3.12+ environment and installed project dependencies. No new runtime dependencies are required by issue #71. Never read credentials or environment files.

Selection tests use injected model outputs. Browser checks use fixture responses to verify progress, review, add/remove, weights and submission. Method D tests use numeric fixtures to verify the existing formula and the feature-weight adapter.

Real local scoring additionally uses a prepared data directory built from the existing terrain benchmark artifacts and fixed reference population. Preparation runs in the research environment that already has Parquet support; serving uses NumPy. The source revision, eligibility, reference IDs and supported representations must be retained in the prepared manifest. The README records the preparation and serving commands.

Live OpenRouter verification requires the user-configured server environment. Fixture verification must not be reported as a live provider run.

Python version: 3.12 or 3.13
Lockfile: uv.lock
Setup command: uv sync --locked --group indus
Test command: python -m unittest discover -s src/backend -t .
Lint command: git diff --check
Contract test command: python -m unittest src.backend.test_web
Smoke test command: node tools/test_frontend.cjs
Sample data: Numeric fixtures in backend tests and browser API fixtures in tools/test_frontend.cjs
Artifact storage: Local prepared terrain directory selected by GUARDIANS_TERRAIN_DIR
Artifact version: pixel-observatory-v1
Environment variables: GUARDIANS_TERRAIN_DIR, OPENROUTER_API_KEY, OPENROUTER_MODEL

Issue #76 verification uses injected responses to assert two calls, separate catalog menus, rejection of invalid output without retries, and a 1,200-second timeout on both requests.

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
