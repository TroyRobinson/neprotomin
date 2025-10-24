# Outstanding Fixes – Areas Refactor

_Created: 2025-10-22_

This note captures the remaining edge cases we identified while testing the new Areas dropdown + report alignment work. Each item includes the scope we validated today, and the follow-up needed for the next iteration.

---

## 1. County (and future area kinds) stat-hover overlays
**Observed:** ZIPs display transient hover labels for both the primary stat and the secondary stat overlays. Counties now render secondary stat dots, but hovering a county centroid does not surface the stat tooltip.

**Likely work:**
- Generalise the existing ZIP hover controller (currently lives in `src/react/imperative/components/zipLabels.ts` and related overlay code) so it can be parameterised by area kind.
- Ensure `updateSecondaryStatOverlay` injects the hover metadata for the active kind, not hard-coded to ZIP properties.
- Update `mapView` hover handlers to emit the area kind + id to the shared hover renderer.

**Context:** secondary overlay dots now render for counties, so the remaining gap is purely the tooltip plumbing.

## 2. CSV export only handles ZIP selections
**Observed:** `handleExport` in `src/react/ReactMapApp.tsx` still short-circuits when the active kind is counties; only ZIP rows appear in the download.

**Expected behaviour:**
- When the Areas dropdown is set to counties, the export should emit county rows (plus any pinned areas from other kinds as context, similar to the highlight charts).
- When ZIPs are active, keep existing behaviour (but also append pinned counties/other kinds if we want parity with the highlights).

**Likely work:**
- Refactor the export builder to iterate over the active kind’s `selected` list, not just ZIP arrays.
- Add a helper to map area ids → stat lookups by kind, mirroring the highlight logic.
- Include optional context rows (pinned other kinds) with a `kind` column so downstream tooling can differentiate them.

## 3. QA follow-up
- Re-run Mixed selections, Auto/Manual dropdown control, highlight context colouring after the fixes above.
- Update `docs/areas-refactor-plan.md` and this brief once the fixes land.
