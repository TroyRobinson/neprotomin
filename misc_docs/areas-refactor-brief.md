# Areas Refactor – Working Brief

_Snapshot: 2025-10-22_

## Project Goals
- Unify area handling (ZIP, County, future Tract) so map, sidebar, reports, and exports share the same data plumbing.
- Keep MapLibre layers registry-driven and style-aware; avoid DOM markers for overlays.
- Ensure React surfaces (sidebar, report, data views) consume InstantDB via `@instantdb/react` hooks with per-area-kind snapshots.

## Current Focus
- Final QA sweep on the new Areas dropdown flow (manual vs auto) and highlight context rules.
- Generalise transient stat-hover labels so counties (and future kinds) show the same tooltip detail as ZIPs.
- Generalise CSV export so active kind + pinned cross-kind context are included (ZIPs already working; counties pending).
- Prep handoff notes + screenshots if any issues surface during QA.

## Status Overview
- ✅ Demographics, stats hooks, and overlays support both ZIP and county data.
- ✅ Reports/export mirror the active Areas dropdown (ZIP or county).
- ✅ Areas dropdown supports Auto (control by zoom) vs manual mode; sidebar/report panels stay in sync.
- ✅ Highlights show selected areas, pinned cross-kind context (grey), and top remaining active-kind areas.
- 🔄 Final QA + copy polish underway.
- ⚠️ Node 22.11.0 triggers a Vite warning (needs ≥22.12.0).

## Open Questions
1. Should counties use their own circle translate offsets or share the ZIP offsets? (Design decision pending.)
2. Do we prune the county centroid source to active areas only, or keep the full statewide set for future use?
3. When a user mixes ZIPs/counties, how do we message that only the active kind is in the report (copy review on new chips)?
4. Highlight extras: confirm the card limit logic feels right when selected + pinned + highest-value areas compete for slots.

## QA Checklist (current)
- Mixed selections: verify report + sidebar follow the Areas dropdown; highlights show selected areas in color, other pinned areas in grey, and top remaining active-kind entries.
- County secondary overlay: hover/pin behavior survives style reloads.
- Export CSV reflects the active area kind only.
- Manual zoom toggles: Auto (control by zoom) returns dropdown to auto mode cleanly.
- Toolbar chips: confirm only the active kind’s chips render and bulk actions operate on that set.

## Useful References
- Detailed plan: `docs/areas-refactor-plan.md`
- Historical notes: `docs/areas-refactor-retro.md`, `docs/areas-status-notes.md`
- InstantDB schema/seed: `src/instant.schema.ts`, `scripts/seed.ts`
