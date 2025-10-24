# Areas Refactor – Working Brief

_Snapshot: 2025-10-22_

## Project Goals
- Unify area handling (ZIP, County, future Tract) so map, sidebar, reports, and exports share the same data plumbing.
- Keep MapLibre layers registry-driven and style-aware; avoid DOM markers for overlays.
- Ensure React surfaces (sidebar, report, data views) consume InstantDB via `@instantdb/react` hooks with per-area-kind snapshots.

## Current Focus
- Align report + sidebar aggregates with the Areas dropdown (single “active” area kind driven by zoom or manual override).
- Allow highlights/timeline charts to sprinkle in extra pinned areas from other kinds for context.
- Add a “control by zoom” option so users can hand the dropdown back to auto-mode after manually choosing an area type.

## Status Overview
- ✅ Demographics, stats hooks, and overlays support both ZIP and county data.
- ✅ Reports/export already accept `AreaId[]` and produce county-only outputs when counties are active.
- 🔄 Upcoming work (next iteration) tracks dropdown control state, filters report/sidebar to the active kind, and refines toolbar chips.
- ⚠️ Node 22.11.0 triggers a Vite warning (needs ≥22.12.0).

## Open Questions
1. Should counties use their own circle translate offsets or share the ZIP offsets? (Design decision pending.)
2. Do we prune the county centroid source to active areas only, or keep the full statewide set for future use?
3. When a user mixes ZIPs/counties, how do we message that only the active kind is in the report (copy review)?

## QA Checklist (post-iteration)
- Mixed selections: verify report + sidebar follow the Areas dropdown while highlights show extra context.
- County secondary overlay: hover/pin behavior survives style reloads.
- Export CSV reflects the active area kind only.
- Manual zoom toggles: “control by zoom” option returns dropdown to auto mode cleanly.

## Useful References
- Detailed plan: `docs/areas-refactor-plan.md`
- Historical notes: `docs/areas-refactor-retro.md`, `docs/areas-status-notes.md`
- InstantDB schema/seed: `src/instant.schema.ts`, `scripts/seed.ts`
