# Hover Preview After First Dwell Regression - Handoff (2026-02-20)

## Problem Summary
We are trying to support two hover behaviors on map areas:
1. Instant, subtle traversal hover (area fill/outline only, no heavy info updates).
2. Full hover details (area label pills + extrema tooltip) only after a short dwell.

Current user-reported regression:
- Traversal hover works initially.
- After the first dwell reveals area pills + extrema tooltip, fast movement across other areas no longer shows the traversal hover effect.
- Traversal hover returns only after moving pointer outside all Oklahoma areas and back in.

## Repro Steps (from user)
1. Move cursor across areas: subtle preview hover appears as expected.
2. Pause briefly over one area: detailed hover pills + extrema tooltip appear.
3. Move quickly across other areas.
4. Expected: subtle traversal hover resumes until next pause.
5. Actual: traversal hover appears stuck/off until cursor leaves all areas and re-enters.

## Current Code State
### Modified files in this workstream
- `src/react/imperative/mapView.ts`
- `src/react/imperative/layers/boundaries.ts`

### Related already-committed context
- `39bd89c`: tooltip/pill hover interaction refinements in `src/react/imperative/components/zipLabels.ts`.
- `80fff53`: hover behavior/fade refinements.

### Current uncommitted files in repo
- Hover work: `src/react/imperative/mapView.ts`, `src/react/imperative/layers/boundaries.ts`
- Handoff notes file: `handoff/2026-02-20_hover_preview_after_dwell_regression_handoff.md` (untracked)

## What Was Implemented
### 1) Traversal preview state model in map controller
In `src/react/imperative/mapView.ts`:
- Added separate preview hover state (zip/county):
  - `hoveredZipPreviewFromMap`, `hoveredZipPreviewTrailFromMap`
  - `hoveredCountyPreviewFromMap`, `hoveredCountyPreviewTrailFromMap`
- Added short trail timer (`HOVER_PREVIEW_TRAIL_MS = 120`) to keep a soft transition from previous area.
- Added clear/set helpers for preview timers/state.

Refs:
- `src/react/imperative/mapView.ts:569`
- `src/react/imperative/mapView.ts:1806`
- `src/react/imperative/mapView.ts:1823`

### 2) Hover renderer supports preview-only mode + trailing area
In `src/react/imperative/layers/boundaries.ts`:
- Added `PREVIEW_HOVER_OPACITY_MULTIPLIER = 0.42`.
- Added `buildHoverFilter(...)` for primary + trailing id.
- Extended hover update signatures to accept options:
  - `previewOnly?: boolean`
  - trailing area id (`trailingZipId` / `trailingCountyId`)

Refs:
- `src/react/imperative/layers/boundaries.ts:24`
- `src/react/imperative/layers/boundaries.ts:90`
- `src/react/imperative/layers/boundaries.ts:741`
- `src/react/imperative/layers/boundaries.ts:821`

### 3) ZIP/County hover handler parity and stale-pill clearing attempts
In `src/react/imperative/mapView.ts`:
- Added ZIP event wiring on hover fill layer (previous asymmetry with county):
  - `mouseenter/mouseleave/mousemove` on `BOUNDARY_HOVER_FILL_LAYER_ID`.
- In map area mousemove, clear pill-hover precedence when map-layer hover resumes.

Refs:
- `src/react/imperative/mapView.ts:3766`
- `src/react/imperative/mapView.ts:3772`
- `src/react/imperative/mapView.ts:3902`
- `src/react/imperative/mapView.ts:3908`

### 4) Rolled back uncertain experiment
A temporary global `map.on("mousemove", ...)` fallback was tested and then removed because it did not fix the issue and could add duplicate hover processing.

## What Is Still Broken
Even with preview state + layer parity + stale-pill clear logic, user still reports:
- After first dwell reveal, traversal preview does not return until leaving all areas and re-entering.

## Follow-up Update (2026-02-20, later session)
Two additional fixes were tried and then reverted after user validation showed no improvement:

1) `zipLabels` hover de-latch hardening (reverted)
- Added `pointermove` revalidation of tooltip/pill ownership.
- Added deferred (`requestAnimationFrame`) re-check in `pointerout` path before preserving tooltip ownership.
- Result: user still reproduced the same regression.

2) `mapView` container pointer fallback (reverted)
- Added container-level `pointermove` fallback to run area hover resolution when layer `mousemove` might be missed.
- Guarded fallback to skip tooltip/pill DOM targets.
- Result: user still reproduced the same regression.

Net result after revert:
- No lasting code changes from these two follow-up experiments.
- Working tree remains focused on the original hover-preview work in `mapView.ts` + `boundaries.ts`.

## Strongest Current Hypothesis
Likely issue is in tooltip DOM pointer capture / pill-hover latching rather than area-layer paint logic.

Why:
- `zipLabels` uses map-container DOM listeners and tooltip elements with `pointer-events: auto` for bridge/dropdown/rows.
- Hover area may stay latched through tooltip-area logic and block map hover reclaim.
- If map area mousemove does not fire while over tooltip DOM, `hovered*FromPill` precedence may persist.

High-risk code path refs:
- Pointer hover emit/clear logic:
  - `src/react/imperative/components/zipLabels.ts:155`
  - `src/react/imperative/components/zipLabels.ts:193`
  - `src/react/imperative/components/zipLabels.ts:211`
  - `src/react/imperative/components/zipLabels.ts:248`
- Tooltip DOM with pointer capture:
  - `src/react/imperative/components/zipLabels.ts:382`
  - `src/react/imperative/components/zipLabels.ts:394`
  - `src/react/imperative/components/zipLabels.ts:406`
  - `src/react/imperative/components/zipLabels.ts:509`

## Updated Takeaways
- Tooltip/pill DOM arbitration alone is likely not the only root cause (because the `zipLabels` hardening did not change behavior).
- Missing layer `mousemove` alone is likely not the only root cause (container fallback did not change behavior).
- Most likely remaining issue is in map hover ownership transitions after first dwell commit (state can stay latched until explicit boundary leave clear).

## Suggested Next Debug Plan (for next developer)
1. Add temporary debug logs around all hover ownership transitions:
   - `hoveredZipFromPill`, `hoveredZipFromMap`, `hoveredZipPreviewFromMap`
   - same for county
   - log set/clear reason + source event (`pill over/out`, `map move`, `leave timer`).
2. Add temporary log in `zipLabels` pointer handlers showing `event.target`, `relatedTarget`, resolved area, and whether clear was skipped.
3. Verify in failing state whether map layer mousemove is firing at all while pointer is near/extending from tooltip.
4. If latching confirmed, consider making tooltip container pass-through except row pills (or narrowing bridge hitbox), and clear `onHoverPillChange(null, null)` whenever pointer is outside tooltip + pill targets for >N ms.
5. Keep preview pipeline in place (it is structurally sound) and focus on hover ownership arbitration between map and tooltip DOM.
6. Add logs directly in `onZipMouseMove` / `onCountyMouseMove` for:
   - queried area id
   - `hovered*FromMap` before/after
   - whether `set*PreviewHover` ran
   - whether clear path (`hovered*FromMap = null`) executed
7. Add logs around `onBoundaryMouseLeave` + leave timers to confirm whether the final recovery is always driven by leave-clear rather than normal move transitions.

## Verification Status
- Build passes: `npm run -s build`.
- Node warning present (non-blocking in current environment): Node `22.11.0`, Vite recommends `22.12+`.

## Notes
- As of this handoff update, `git status --short` shows only:
  - `src/react/imperative/mapView.ts`
  - `src/react/imperative/layers/boundaries.ts`
  - `handoff/2026-02-20_hover_preview_after_dwell_regression_handoff.md` (untracked)
