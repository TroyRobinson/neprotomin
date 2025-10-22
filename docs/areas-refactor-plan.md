# Areas Refactor – Working Plan & Handoff Guide

_Last updated: 2025‑02‑20_

---

## Background & Goals

- Build a single “areas” pipeline (ZIPs, counties, future tracts) so every UI surface can mix and match area types without bespoke branches.
- Keep MapLibre layers registry‑driven so pins/choropleths react the same way for each kind.
- Collapse React data plumbing onto shared hooks that synthesise stats/demographics, defaulting to sensible viewport baselines when the user hasn’t selected anything.

---

## Completed Phases

| Phase | Focus | Highlights |
| ----- | ----- | ---------- |
| Phase 0 | Registry groundwork (pre‑existing) | `AreaKind`/`AreaId`, map registry, toolbar + selection plumbing |
| Phase 1 (current work) | Schema + seed alignment | Added `areas` entity, populated centroids/bounds, updated seed scripts, normalised selection payloads |
| Phase 2 | Shared data plumbing | `useAreas`, `useStats`, `useDemographics` return per‑kind snapshots; sidebar/toolbar now consume unified selections |
| Phase 3 | Unified demographics & sidebar | Map emits camera defaults, `useDemographics` blends selection + viewport defaults, single sidebar card with graceful “no data” messaging |

---

## Open Phases & Deliverables

1. **Map/report parity**
   - County choropleth legend + secondary stat overlay.
   - Report exports include counties, highlight missing metrics cleanly.
2. **Camera-driven QA & polish**
   - Manual smoke (selection, pinning, export, zoom states).
   - Copy/styling tweaks now that combined card is live.

---

## Latest Milestone – Unified Demographics Panel ✅

- Map now emits camera updates via `onCameraChange`, letting React infer the default demographic context (statewide vs. Tulsa vs. other counties).
- `useDemographics` accepts both selection + viewport defaults and returns a combined snapshot with missing‑data flags.
- Sidebar collapses to a single demographics card with blended stats, weighted breakdowns, and graceful fallback copy (“Data unavailable for this area”).

## Implementation Steps – Next Up

### A. Stats Integration Follow‑ups
1. ✔️ Update organisation sorting (stat weighting) to use the blended snapshot when counties are in play.
2. ✔️ Expose helper to get an area label (from `useAreas`) so stat/demographic UIs don’t repeat lookup logic.

### B. Prep for Phase 4 (map/report parity)
3. Mirror secondary stat overlay for counties (currently ZIP‑only).
4. Adjust report composer to iterate `AreaId[]` rather than ZIP strings.

---

## Gotchas & Watch‑outs

- **Missing data:** Counties outside Tulsa currently have no ZIP breakdowns. Aggregation helpers must guard against empty datasets and surface a consistent “No data yet” message rather than stale values.
- **Selection vs viewport defaults:** When the user clears selection, immediately fall back to the camera‑derived default. Avoid mixing stale selection data into the default snapshot.
- **Performance:** Blending large selections should avoid repeated JSON stringify—cache per‑kind aggregates where possible (e.g., memo keys on sorted area ids).
- **Tooling expectations:** `mapView` still emits legacy ZIP/County callbacks; ensure new hooks don’t inadvertently remove those until downstream consumers are updated.
- **Node version warning:** Vite expects ≥22.12.0 (current local is 22.11.0). Upgrade before CI or adjust tooling to avoid warnings.

---

## Handoff Checklist

- [x] Map exposes “default area” hint for demographics (zoom + camera derived).
- [x] `useDemographics` returns both `combinedSnapshot` and `byKind`, with missing‑data flags.
- [x] Sidebar uses unified demographics card; stat viz/list already consuming shared snapshots.
- [x] Organisation sort weighting reuses blended stat data.
- [ ] Documentation (this file + existing retros) updated after each milestone.

Optional niceties once core work lands:

- Add storybook or local debug toggles for “simulate missing data”.
- Document the blending algorithm (population sum, weighted averages) in `docs/areas-status-notes.md`.

---

## Contact & Context

- Recent commits touch `src/react/hooks/useDemographics.ts`, `useStats.ts`, and sidebar components.
- Legacy docs: `docs/areas-refactor-retro.md`, `docs/areas-status-notes.md`.
- Seed scripts: `scripts/seed.ts` ensures `areas` table stays in sync locally.

If you pick up from here:
1. Start with the camera default hook (most other steps depend on it).
2. Implement the demographic blending in `useDemographics`.
3. Wire the sidebar to the new combined snapshot.
4. Run `npm run build` and manually test zoom/selection edge cases.


## Plan Background Details:
Planning artifacts:

"Unified Areas Plan

Phase 1 – Schema & Seed Unification

Audit instant.schema.ts to ensure counties share the same entity + area-type discriminators used by ZIPs/tracts; add any missing indexes (e.g., type, name).
Extend src/lib/seed.ts to insert/update county records (use id() + name checks) and attach demographics/report metrics if available; clean up stale county placeholders.
Introduce an areaType enum/constant consumed across UI logic so new types flow automatically.
Tests after Phase 1: npm run seed (or seed script) against a clean DB; run schema checks or lint; verify counties appear in Instant dashboard.

Phase 2 – Shared Area Data Layer

Refactor area selectors/hooks (src/state/organizations.ts, src/react/hooks/useDemographics.ts, etc.) to return a single ordered list/map keyed by areaType instead of separate ZIP/county buckets.
Update normalization utilities to merge metrics and demographics generically (guard against missing fields with defaults like null + isMissing flags).
Add memoized helpers for chart/report datasets that filter purely on areaType rather than hard-coded namespaces.
Tests after Phase 2: run unit tests for hooks if present; otherwise add temporary console assertions/logging when loading the app to ensure ZIPs + counties appear together.

Phase 3 – UI Controls & Sidebar Updates

Boundaries toolbar (src/ui/boundariesToolbar.ts) becomes type-agnostic: swap multiple actions for universal Pin all / Clear all, reusing shared area list and ensuring MapLibre layers receive merged GeoJSON sources.
Sidebar charts (src/react/components/SidebarCharts.tsx or equivalent) consume the unified dataset; adjust legend/labels to include area type badges; ensure datasets skip missing metrics gracefully.
Demographics panel shows either the county/ZIP data or a friendly “Data unavailable” fallback using the isMissing flags; ensure we don’t render stale ZIP values when county data is absent.
Tests after Phase 3: in the running dev app, trigger toolbar buttons and confirm all areas toggle together; inspect charts/demographics for mixed area sets; verify counties without data show the fallback message.

Phase 4 – Reports & Cross-Feature Polish

Update reports generation modules (src/ui/reports/*.ts) to iterate over the unified area collection; ensure export formats and summaries note area type where relevant.
Review other UI surfaces (map popovers, hover states, search filters) to confirm counties are treated identically and missing data paths show clear messaging/tooltips.
Add minimal regression tests or storybook cases for mixed-area scenarios if the project supports them.
Tests after Phase 4: generate sample reports locally; cross-check exported data includes counties with correct metrics or “missing” flags; walkthrough UI for counties missing demographics to confirm graceful messaging."
