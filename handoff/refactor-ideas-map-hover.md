# Refactor Ideas: Map Hover Architecture

Context: The hover-preview-after-dwell regression (fixed in `a0880dc`) took
multiple developer sessions to diagnose. The root cause was a React feedback
loop, but the difficulty came from several compounding design patterns that made
the bug hard to trace. These refactors would reduce the surface area for
similar issues.

---

## 1. Eliminate the hover echo-back loop

**Problem**: The map fires `onZipHoverChange(A)` → React stores `hoveredArea`
→ React passes `hoveredZip="A"` back as a prop → `useEffect` calls
`mapController.setHoveredZip("A")` → latches `hoveredZipFromToolbar`.

This bidirectional flow exists because `hoveredZip`/`hoveredCounty` props on
`MapLibreMap` serve two purposes: (a) sidebar-initiated hover and (b) keeping
the map "in sync" with React state. But the map already *is* the source of
truth for map-originated hover — echoing it back is unnecessary and created the
feedback loop.

**Suggestion**: Split the prop into `sidebarHoveredZip` (sidebar → map only)
and remove the echo-back. The `useEffect` in `MapLibreMap.tsx:391` that calls
`setHoveredZip(hoveredZip)` would only fire for sidebar-originated hovers. The
map's own hover state would flow outward only (map → React via callbacks),
never back.

**Files**: `MapLibreMap.tsx` (useEffect), `ReactMapApp.tsx` (prop wiring),
`mapView.ts` (`setHoveredZip`/`setHoveredCounty`).

---

## 2. Consolidate hover ownership into an explicit state machine

**Problem**: Hover is determined by a priority chain of four mutable variables:
`hoveredZipFromToolbar || hoveredZipFromPill || hoveredZipFromMap` plus
`hoveredZipPreviewFromMap` as a visual fallback. Each variable is set/cleared
in different event handlers with different timing (sync map events, async React
effects, debounced timers, pointer DOM events). Reasoning about which variable
"wins" at any moment requires tracing through ~200 lines of scattered
set/clear logic.

**Suggestion**: Replace the four variables with a single discriminated state:
```ts
type HoverState =
  | { source: 'none' }
  | { source: 'toolbar'; areaId: string }
  | { source: 'pill'; areaId: string; pillKey: string | null }
  | { source: 'map'; areaId: string }
  | { source: 'preview'; areaId: string; trailingId: string | null };
```
Transitions would be explicit functions (`transitionHover(nextState)`) that
handle clearing the previous state and updating visuals in one place. This
makes the priority rules visible and testable without running the full map.

**Files**: `mapView.ts` (hover state + all set/clear sites).

---

## 3. Don't register mouse events on dynamically-filtered layers

**Problem**: `mouseenter`/`mouseleave`/`mousemove` were registered on
`BOUNDARY_HOVER_FILL_LAYER_ID`, whose filter changes on every area transition.
Each filter change causes a `mouseleave` for the old area, which schedules a
boundary-leave-clear timer that can race with the next `mousemove` on the base
fill layer.

**Suggestion**: As a rule, only register pointer event handlers on layers with
stable filters (the base fill and statdata fill layers that cover all areas).
Dynamically-filtered layers (hover, highlight, pinned) should be render-only.
This is already done after the fix — just documenting the principle so it
doesn't regress.

**Files**: `mapView.ts` (event registration block).

---

## 4. Kill pointer-events on all interactive children during label exit

**Problem**: `removeLabelWithRowTransition` sets `pointer-events: none` on the
container, but CSS `pointer-events: auto` on children (bridge, dropdown, row
pills) overrides the parent. During the 85ms fade-out, these children can still
intercept pointer events and re-latch `hoveredFromPill`.

**Suggestion**: When a label exits, set `pointer-events: none` on every
interactive descendant, not just the container and conditionally on row pills.
A helper like `element.querySelectorAll('[style*="pointer-events: auto"]')` or
a data attribute scan would be more robust than targeting individual selectors.

**Files**: `zipLabels.ts` (`removeLabelWithRowTransition`).
