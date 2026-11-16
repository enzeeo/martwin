# Errors

## 2026-11-15 — Concurrent frontend changes invalidate broad fixture expectations
- Context: point-detail implementation while another session changed map visibility during selection.
- Failed: full tools/test_frontend.cjs repeatedly expected the map to be hidden during selection; current selection code preserves it.
- Worked: focused tools/test_map_details.cjs drives the scoring flow and checks requested map behavior without imposing the old loading-flow expectation.
- Check next time: reconcile full-suite visibility assertions with the owning session before treating that failure as a map regression.
