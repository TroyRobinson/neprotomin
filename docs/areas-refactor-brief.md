# Areas Refactor – Working Brief

_Snapshot: 2025-10-22_

## Project Goals
- Unify area handling (ZIP, County, future Tract) so map, sidebar, reports, and exports share the same data plumbing.
- Keep MapLibre layers registry-driven and style-aware; avoid DOM markers for overlays.
- Ensure React surfaces (sidebar, report, data views) consume InstantDB via `@instantdb/react` hooks with per-area-kind snapshots.

## Current Focus
- Extend highlights/timeline cards so they sprinkle in (1) active-kind selections, (2) pinned other kinds, **and** (3) top remaining areas of the active kind to fill the card limits.
- Tighten the boundary chips so the toolbar only shows chips for the active Areas dropdown selection.
- Polish QA + copy around the new manual/auto Areas control so zoom hand-offs feel predictable.

## Status Overview
- ✅ Demographics, stats hooks, and overlays support both ZIP and county data.
- ✅ Reports/export accept `AreaId[]` and now mirror whichever area kind the Areas dropdown is set to.
- ✅ Areas dropdown supports “Control by zoom” vs manual mode; sidebar/report headers follow the active kind.
- 🔄 Next up: highlights/toolbar chip tweaks + mixed-area context polish.
- ⚠️ Node 22.11.0 triggers a Vite warning (needs ≥22.12.0).

## Open Questions
1. Should counties use their own circle translate offsets or share the ZIP offsets? (Design decision pending.)
2. Do we prune the county centroid source to active areas only, or keep the full statewide set for future use?
3. When a user mixes ZIPs/counties, how do we message that only the active kind is in the report (copy review on new chips)?
4. Highlight extras: confirm the card limit logic feels right when selected + pinned + highest-value areas compete for slots.

## QA Checklist (post-iteration)
- Mixed selections: verify report + sidebar follow the Areas dropdown while highlights show extra context.
- County secondary overlay: hover/pin behavior survives style reloads.
- Export CSV reflects the active area kind only.
- Manual zoom toggles: “control by zoom” option returns dropdown to auto mode cleanly.

## Useful References
- Detailed plan: `docs/areas-refactor-plan.md`
- Historical notes: `docs/areas-refactor-retro.md`, `docs/areas-status-notes.md`
- InstantDB schema/seed: `src/instant.schema.ts`, `scripts/seed.ts`
