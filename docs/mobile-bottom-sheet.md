# Mobile Bottom Sheet Worklog

## Goals
- Introduce a mobile-first variant of the map + sidebar layout that mirrors the AirBnB inspiration flow.
- Hide heavy analytics (Demographics/StatViz) while keeping the organization + stats tabs available on small screens.
- Deliver a draggable bottom sheet that collapses to a peek state when the map is panned and expands to full height on drag/tap.
- Preserve existing desktop behaviour without duplicating sidebar logic.

## Implementation Snapshot
- **Breakpoint**: We treat viewports `<= 767px` as mobile (`MOBILE_MAX_WIDTH_QUERY` in `src/react/ReactMapApp.tsx`). Adjust this string if design wants a different cutoff; update the matching Tailwind classes (`md:`) for complementary style tweaks.
- **Layout**: `ReactMapApp` now renders the map first and conditionally mounts the sidebar:
  - Desktop (`!isMobile`): sidebar stays left-aligned with Demographics + StatViz.
  - Mobile: a bottom sheet (`variant="mobile"`) overlays the map. Demographics/StatViz are suppressed via `showInsights={false}`.
- **Bottom Sheet Mechanics**:
  - States: `"peek"` (drag handle + count) and `"expanded"` (full-height, scrollable list/tabs).
  - Dragging the handle or sheet content (when scrolled to top) interpolates `translateY` between the two states.
  - Map `dragstart` collapses the sheet by invoking the new `onMapDragStart` callback exposed from the imperative MapLibre controller.
- **Boundary Toolbar**: gains a `hideAreaSelect` prop to keep the Areas dropdown hidden on mobile while retaining search/pin controls. Applied to both the map view and report overlay.
- **Shared Sidebar Data**: organization partitioning moved out of JSX so both desktop + mobile variants share the same derived lists and counts.

## Testing Checklist
1. Narrow the browser to `<768px` (or use device emulation) and refresh to confirm:
   - Map renders above the collapsed sheet.
   - Header shows the grey drag bar and `{N} Organizations`.
2. Tap the sheet header → it should animate to fullscreen with the tabs visible.
3. Drag the handle downward while expanded to snap back to the peek state.
4. Scroll the expanded content to the top, then pull downward inside the list; the drag should hand off to the sheet collapse (threshold ≈72px).
5. Pan the map; the sheet should collapse automatically.
6. Switch back to a desktop-width viewport and ensure the legacy sidebar layout remains intact (Demographics + StatViz visible, areas dropdown restored).

## Adjustment Notes
- **Breakpoint tweaks**: edit `MOBILE_MAX_WIDTH_QUERY` and mirror the change in Tailwind utility usage (e.g., replace `md:` with a custom breakpoint if needed).
- **Drag sensitivity**: `MOBILE_SHEET_DRAG_THRESHOLD` controls how far the user must drag to toggle states.
- **Peek height**: `MOBILE_SHEET_PEEK_HEIGHT` defines the visible stubs height when collapsed.

## Follow-ups / Nice-to-haves
- Add inertial animation to the sheet for smoother transitions and bounce.
- Replace the future “add ZIP” flow with location search for mobile per roadmap.
- Consider persisting the last sheet state per session for returning users.
- Add automated interaction tests (Playwright) that exercise the drag states once the UX settles.*** End Patch
