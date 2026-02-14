# 2026-02-13 Advanced StatViz Restart Handoff

## Purpose
You plan to clear current pending changes and restart.  
This file preserves the key findings from:
- `handoff/vgxmmmjjmlldqydh_advanced_statviz_stability.md`
- `handoff/jexkzp5nmlldilyt_statviz_loading_stability.md`
- `handoff/630dypihmllcfrtt_statviz_zero_data.md`
- current uncommitted diff (6 files)

## Current Blocker (latest user retest)
Primary unresolved bug is still a crash in Advanced StatViz flows.

Latest sequence reported by user (2026-02-13):
1. Select a stat.
2. StatViz shows loading for a while.
3. Chart finally renders.
4. App crashes shortly after render.

Interpretation: crash is likely near the loading -> resolved chart transition boundary, not only from rapid switching volume.

## User-Observed Problem Set
- StatViz initially showing `0` values instead of loading UI.
- Some selected stats eventually stop loading after repeated switching.
- Returning to previously viewed stats often reloads slowly (warm cache miss behavior).
- Eventual app crash after prolonged interaction.
- Intermittent false "no area-level values" state before real data appears.

## Scope: Where This Bug Actually Lives
Primary path is React stats pipeline, not vanilla map store:
- `src/react/hooks/useStats.ts`
- `src/react/ReactMapApp.tsx`
- `src/react/components/StatList.tsx`
- `src/react/components/StatViz.tsx`
- `src/react/components/Sidebar.tsx` (prop pass-through only)

Not primary target for this bug:
- `src/state/statData.ts` (imperative map pipeline, separate from embedded React StatViz rendering)

## Regression/Context Commits To Review First
Likely relevant window from `git log` on affected files:
- `aac0957` mobile crash / memory overload
- `d8bc25d` disable statData maps in useStats on mobile
- `3e396a3` time-series loads only in advanced + stats tab
- `348c8c6` selected stat loading text + retry button
- `5c45932` selected stat header context average

## What Was in Pending Changes (will be lost after reset)
Uncommitted files:
- `src/lib/env.ts`
- `src/react/ReactMapApp.tsx`
- `src/react/components/Sidebar.tsx`
- `src/react/components/StatList.tsx`
- `src/react/components/StatViz.tsx`
- `src/react/hooks/useStats.ts`

### 1) Loading UX and rendering safeguards
- Added explicit loading/resolution props from `ReactMapApp` -> `Sidebar` -> `StatList` -> `StatViz`.
- Embedded StatViz loading placeholder with spinner + area label placeholders.
- Removed bar-mode unresolved-value fallback to `0`; unresolved values are skipped.
- Added embedded "no data" fallback card instead of returning `null`.

### 2) useStats batch/load semantics
- Replaced one-shot processed key with response-signature-aware key (`batchKey + responseSignature`) so streamed updates can reprocess.
- Loaded ID marking changed from "mark all requested" to:
  - mark IDs with returned rows
  - mark explicit no-data IDs only when summary coverage is ready
- Added summary coverage derivation for no-data confirmation.

### 3) Cache/revisit behavior tuning
- Added recent stat MRU protection (`recentStatIds`) to reduce fast revisit refetches.
- Advanced desktop cache caps increased (medium/high tiers).
- During active Advanced Stats session (`showAdvanced && sidebarTab === "stats"`), broad background prefetch is reduced and cache capped lower to shed load.

### 4) Crash hardening attempts
- Hover update dedupe in line chart and StatViz hover dispatch path.
- Finite-only segmented line rendering (skip NaN/non-finite path points).
- `StatVizErrorBoundary` around embedded chart region in `StatList`.
- Cycle-safe parent traversal in `StatList` with depth/visited guards and redundant `onStatSelect` dedupe.
- Telemetry moved from always-on dev to explicit debug flag (`debug:statvizTelemetry`).

### 5) Telemetry gating
- `src/lib/env.ts` added `isDebugFlagEnabled(flag)`:
  - checks `localStorage["debug:<flag>"]`
  - checks URL query params `debug:<flag>` or `<flag>`
  - dev-only
- `useStats` and `ReactMapApp` telemetry now require `debug:statvizTelemetry`.

## What Improved vs What Failed
What improved:
- Zero-first chart illusion reduced (loading placeholders instead of immediate zero bars).
- Some hover/render churn reduced via dedupe.
- Build remained green after each patch (`npm run build`).

What did not resolve:
- Final crash still reproduced by user after chart resolves.
- Crash persisted across multiple patch rounds, including load-shedding and traversal guards.
- Earlier false no-data flashes were reduced but not sufficient to eliminate crash path.

## Highest-Value Remaining Hypotheses
1. Render transition instability:
- data flips from unresolved to resolved and chart mounts with unstable/invalid or rapidly mutating series payload.

2. State oscillation at resolve boundary:
- loading/resolved signal can bounce quickly, causing mount/unmount churn and high-frequency chart lifecycle work.

3. Residual high-churn interaction path:
- nested stat family switching still creates heavy query + render + selection churn not fully contained by current guards.

4. Error boundary coverage gap:
- crash may originate outside embedded StatViz subtree (or from async/unhandled rejection not caught by React boundary).

## Immediate Next Debug Steps (recommended order)
1. Add persistent runtime crash recorder (top priority)
- In `src/react/main.tsx`, capture:
  - `window.onerror`
  - `window.onunhandledrejection`
  - React error boundary catches
- Store ring buffer on `window.__statvizCrashDump` with last 30-50 transitions.

2. Record transition timeline around selected stat resolution
- Include:
  - selected stat id
  - selected area counts
  - `areStatsLoading`
  - selected-stat-resolved flag
  - chart mode + series/point counts
- Keep this independent of devtools so data survives UI crash.

3. Add strict pre-render guardrails in StatViz
- Hard clamp max points/series per frame.
- Abort render branch if transformed coordinates contain non-finite values.
- Log guard-trigger reason into crash recorder.

4. Reproduce against known problematic nested stat families
- Example user-reported family: Median Household Income variants.
- Focus on loading -> rendered -> crash moment, not only rapid-switch loops.

## Suggested Validation Matrix
- Scenario A: Advanced on, 3+ ZIPs selected, switch stats rapidly (15+ changes).
- Scenario B: Switch `stats <-> orgs` tabs while Advanced stays on.
- Scenario C: Return to prior stat within 10-30s and confirm warm reuse behavior.
- Scenario D: 5-10 minute soak, monitor crash recorder for transition chronology.

## Practical Notes
- This pass was investigation + pending-code review; no new runtime repro in CLI.
- `npm run build` passed during prior patch cycles; environment warning observed that Node `22.11.0` is below Vite's recommended `22.12+`.
- `docs/census_etl_handoff.md` exists but is unrelated to this StatViz crash path.
