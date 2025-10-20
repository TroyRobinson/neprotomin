# Areas Abstraction Phase 2 — Retro & Self‑Assessment

## What Went Well

- Unified area model: added `AreaKind` and `AreaId` primitives (`src/types/areas.ts`) and a single area registry (`src/react/imperative/areas/registry.ts`) that describes feature keys, bounds, centroid sources, and layer ids per kind.
- Consistent interactions: the map now emits unified area selection/hover events; toolbar reads one consolidated snapshot and bulk actions operate across all selected items of a kind.
- Style parity: county hover/selection/pin states use the same palette logic as ZIPs (`src/react/imperative/layers/boundaries.ts`).
- Safe rollout: preserved behavior by layering the abstraction on top of existing code paths before removing old branches; easy to continue iterating.

## What Changed (High‑Level)

- Types/registry: `src/types/areas.ts`, `src/react/imperative/areas/registry.ts`.
- Map controller: registry‑driven layer orders, feature keys, bounds; emits `onAreaSelectionChange`/`onAreaHoverChange` alongside legacy ZIP/COUNTY hooks (`src/react/imperative/mapView.ts`).
- React app state: single `areaSelections` store + helper actions (`src/react/ReactMapApp.tsx`).
- Map wrapper: forwards unified callbacks with feedback‑loop guards (`src/react/components/MapLibreMap.tsx`).
- Toolbar: consumes unified selections; “pin all/clear pins” fixed to act on the full selection (`src/react/components/BoundaryToolbar.tsx`).
- County styles: hover/selection/pin parity with ZIPs (`src/react/imperative/layers/boundaries.ts`).

## What’s Missing / TBD

- Secondary stat overlay parity for Counties (currently ZIP‑first).
- Full internal unification of `mapView` selection state (still maintains ZIP/County internals; external API is unified).
- Sidebar/timelines/reports support for mixed area kinds (ZIP + County, future Tracts) — data joins and aggregations still ZIP‑focused.
- Label helper is still named/structured around ZIPs; works for counties via hooks but could be clarified.

## Rough Edges to Refine

- Base (non‑selected) county fill is intentionally lighter than ZIPs to reduce statewide visual noise; confirm this design choice. If absolute parity is desired, move base paints to the registry and align defaults.
- Auto boundary‑mode switching (by zoom) is still special‑cased; could be expressed via registry thresholds later.
- Some legacy props remain on components that now consume unified area events (kept for stability during transition).

## Improvements I’d Make Next (Order of Impact)

1) Extend secondary stat overlays to Counties
- Add COUNTY path in `overlays/stats.ts` similar to ZIPs for secondary dots/hover.

2) Sidebar + Timelines + Reports for any area kind
- Generalize org‑in‑area membership and stat lookups to respect `AreaKind` and feature keys.
- Reports: accept `AreaId[]`, aggregate by kind, optionally render per‑kind sections.

3) Consolidate selection internals in `mapView`
- Replace parallel ZIP/COUNTY sets with a generic map keyed by `AreaKind`; rely on registry for filters and layer ids.

4) Labels module clarity
- Rename `zipLabels` → `areaLabels` or wrap to reduce cognitive load when adding Tracts.

## Cleanup & Refactors (Quick Wins → Maybe)

- Quick wins
  - [x] Remove no‑longer‑used ZIP/COUNTY props/callbacks from `BoundaryToolbar` and `ReactMapApp` (migration is complete).
  - [x] Prune dead imports and ZIP/COUNTY conditionals that the registry supersedes.
- High‑impact
  - [x] Promote base paint (non‑selected fills/lines) into the registry so each kind can be themed consistently in one place.
  - [x] Extract shared “area selection state” helpers inside `mapView.ts` to remove duplication.
- Maybe worthwhile
  - Parameterize auto boundary‑mode thresholds (zoom levels) per kind in the registry.
  - Collapse label logic into a single factory taking centroids + label strategy from the registry.

## Consolidation Snapshot (ZIPs vs. Counties)

- Consolidated
  - Selection/hover event surface (map → React → toolbar).
  - Bulk pin/unpin (“pin all”, “clear pins”) for the current kind.
  - Hover/selection/pin styling logic and colors.
  - Feature keys, layer ordering, and bounds via registry.
- Still unique (by choice or pending)
  - Base county fills lighter for low‑zoom clarity (intentional). Can be aligned if desired.
  - Secondary stat overlays for Counties (pending).
  - Auto boundary switching logic tied to zoom thresholds (special‑cased).

## Why County Borders Look Different

- Historically counties used darker outlines and lighter fills to keep statewide views legible. We aligned hover/selection/pin styling with ZIPs; the remaining base difference is intentional for readability. If design prefers strict parity, unify base paints via the registry.

## Confidence & Risks

- Confidence: high for toolbar bulk actions, parity in hover/selection/pin, and unified event plumbing.
- Risks: legacy props lingering during transition; ensure downstream components don’t rely on removed hooks when you prune. Extending overlays/reports requires careful schema/index alignment for county data.

## Quick Verify Checklist

- Select multiple ZIPs/Counties → “pin all” pins everything; “clear pins” unpins all.
- Hover on map and chips shows consistent outlines/pills for both kinds.
- Switching boundary mode preserves selections/pins; labels behave as expected.
- Selecting a stat updates choropleth and pills for ZIPs and Counties.

## Open Questions

- Keep county base fills lighter than ZIPs, or unify base paints completely?
- For future mixed selections, should the toolbar offer one combined “pin all/clear all” (across kinds) or remain per‑kind based on active boundary mode?
- Confirm expectation for secondary stat overlays on Counties (same as ZIPs?).
- Reports: mixed table with a “kind” column vs. per‑kind sections?
