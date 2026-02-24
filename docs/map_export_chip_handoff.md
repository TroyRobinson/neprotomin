# Map Export Chip Handoff

## Goal

Add an `Export` chip at the end of the desktop map chip row. On hover/click, it opens a dropdown (same interaction style as the `Showing` chip) with screenshot actions for clipboard copy and PNG download.

## Related Context

- `src/react/imperative/categoryChips.ts`
  - Owns the map chip row UI and the existing `Showing` hover/pinned dropdown pattern.
  - Best place to add the new `Export` chip/dropdown UI.
- `src/react/imperative/mapView.ts`
  - Creates the MapLibre instance and wires `categoryChips`.
  - Best place to implement map screenshot capture (has direct access to `map`).
- `src/react/components/MapLibreMap.tsx`
  - React wrapper around `createMapView`; no direct export logic needed for initial implementation.

## Constraints / Notes

- The map UI is mostly imperative DOM in `mapView` + `categoryChips`, so the export feature should follow that pattern.
- Reliable WebGL canvas export usually requires `preserveDrawingBuffer: true` on the MapLibre map.
- Clipboard image write depends on browser support + secure context (`https` / localhost) + user gesture.
- DOM screenshot libraries are not ideal here because WebGL map capture is less reliable than reading the MapLibre canvas directly.

## Recommended Approach (Implemented)

1. Add a desktop-only `Export` chip in `categoryChips` using the same hover/pinned dropdown mechanics as `Showing`.
2. Add `Screenshot: Copy` and `Screenshot: Download` actions inside the dropdown.
3. Wire a new `onExportScreenshot` callback from `mapView` into `categoryChips`.
4. In `mapView`, capture `map.getCanvas()` to PNG:
   - trigger repaint
   - wait a couple animation frames
   - call `canvas.toBlob(...)`
5. For `Copy`, use clipboard image write (`navigator.clipboard.write` + `ClipboardItem`) and show a temporary toast banner for success/error.
6. For `Download`, create and download a PNG directly.
7. Keep lightweight button busy states while the export is running.

## Why This Approach

- Most reliable with MapLibre-rendered layers (choropleth, pins, highlights).
- Minimal integration surface: one callback from `mapView` to `categoryChips`.
- No new React state plumbing required.
- Graceful fallback when clipboard image support is missing.

## What Is Included

- `Export` chip appended as the right-most trailing desktop chip.
- Hover + click-to-pin dropdown behavior matching existing chip UX.
- `Screenshot` button in the export dropdown.
- `Screenshot: Copy` action (clipboard image copy when supported).
- `Screenshot: Download` action (PNG download).
- Temporary toast banner feedback for copy success/error.

## What Is Not Included (Yet)

- Capturing DOM overlays (chips, legends, tooltips) in the screenshot.
- Multiple export formats/options (e.g., `Download PNG`, `Copy link`, `Share`).
- A global toast/notification for export status.

## Follow-Up Options

1. Add a second export action for explicit `Download PNG` (separate from clipboard-first screenshot).
2. Add a small non-blocking toast instead of button-label feedback.
3. Add a “composed export” mode (map + legend/title), if product wants presentation-ready images.
