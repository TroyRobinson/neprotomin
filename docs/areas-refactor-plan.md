# Areas Refactor – Working Plan & Handoff Guide

 _Last updated: 2025‑10‑22_

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
| Phase 1 | Schema + seed alignment | Added `areas` entity, populated centroids/bounds, updated seed scripts, normalised selection payloads |
| Phase 2 | Shared data plumbing | `useAreas`, `useStats`, `useDemographics` return per‑kind snapshots; sidebar/toolbar now consume unified selections |
| Phase 3 | Unified demographics & sidebar | Map emits camera defaults, `useDemographics` blends selection + viewport defaults, single sidebar card with “no data” messaging |

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
3. ✔️ Mirror secondary stat overlay for counties (currently ZIP-only); county centroid layer now resets its filter like the ZIP overlay.
4. ✔️ Report composer iterates `AreaId[]` and now aggregates/export county selections alongside ZIP rows.

### C. Current blockers & questions
- Need QA to ensure the new county filter reset survives style swaps (`styledata`/`idle` re-entry) and doesn’t flicker during hover transitions.
- Do we want a separate translate/offset for counties, or should we share the ZIP offset so mixed selections feel consistent? Needs design confirmation.
- Should the county centroid source be pruned to active counties only, or is the full statewide feature set required for future expansion?
- Validate county-weight weighting (population vs. simple average) and confirm numbers align with analytics expectations.
- Report currently prioritises ZIP selections when both ZIPs and counties are pinned; document whether mixed reports should show both or split into sections.

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
1. QA the county secondary stat overlay (hover/pin transitions, style swaps).
2. Sanity check county aggregation/export figures against source dashboards (confirm weighting + labels).
3. Run `npm run build` and manually test zoom/selection edge cases.
