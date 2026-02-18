# Handoff: StatViz Loading Robustness (Advanced Mode)

## Current Status (February 18, 2026)
- Phase 1 in this document is now implemented in the current working state.
- Granular UI loading wiring from commit `6d9d7b4` remains active.
- Remaining work is Phase 2 onward.

## Context
- Branch history reference:
  - `6d9d7b4` added granular StatViz loading signals.
  - `cd04da7` removed previous temporary handoff doc.
- User report:
  - On live (`map.neighborhoodexplorer.org`), selected-area rows can show temporary `0`s before real values arrive.
  - Localhost appears faster/more reliable.

## What Is Already Implemented
The following is in code and active now:

1. Per-row loading metadata in bar mode.
   - `src/react/components/StatViz.tsx:708`
   - Row is treated as loading when `selectedStatLoading && raw === undefined`.

2. Donut spinner when all selected rows are unresolved.
   - `src/react/components/StatViz.tsx:971`
   - `allSelectedBarsLoading` + `shouldShowLoadingDonut`.

3. Selected-stat loading wiring from `useStats` to `StatViz`.
   - `src/react/hooks/useStats.ts:763` (`pendingStatIds`)
   - `src/react/ReactMapApp.tsx:1248` (`isSelectedStatLoading`)
   - Prop pass-through via `Sidebar` and `StatList`.

4. Phase 1 pending bookkeeping fix in `useStats`.
   - Removed optimistic "requested IDs are loaded" behavior.
   - Added context-aware request completion tracking with:
     - `completedStatIdsByContext`
     - `emptyStatIdsByContext`
   - Added `queryContextKey` derived from:
     - time-series mode (`series` vs `snapshot`)
     - `statDataDateKey`
     - scoped parents (`statDataScopeParents`)
     - boundary type filters (`statDataBoundaryTypes`)
   - Pending now resolves per current batch + context:
     - Pending iff stat is in `batchIds` and not completed/empty in the active `queryContextKey`.
   - Empty/no-data IDs are treated as resolved for the active context so no infinite spinner on true no-data.
   - Retry + cache eviction now clear context completion/empty markers for affected IDs.

## Why It Can Still Show Temporary 0s
Main Phase 1 pending issue is fixed. Remaining temporary `0` risk is now primarily Phase 2 scope-awareness.

Current remaining design gap:
- Loaded tracking is by `statId` only, not by `(statId + scope/parentArea + boundaryType + date-context)`.
- Scope changes can require fresh data even when a stat is globally “loaded”.

## Likely Live vs Local Difference
Not just Wi-Fi.

Live variability can be amplified by:
1. Network latency/loss (especially first query and larger responses).
2. Different localStorage flags in browser profile (for example `settings.reducedDataLoading`).
   - `src/lib/settings.ts:2`
   - This can alter scope-limiting behavior and fetch patterns.
3. Existing cache/data shape differences between sessions.

## Proposed Implementation Plan

### Phase 1: Fix pending bookkeeping (highest priority)
Goal: stop clearing loading state prematurely.

Status: done on February 18, 2026.

1. In `useStats`, removed optimistic “requested IDs are loaded” behavior.
2. Request completion now tracked in a context-aware way:
   - Add a `queryContextKey` from relevant filters (`statDataDateKey`, `statDataScopeParents`, `statDataBoundaryTypes`, time-series mode).
   - Track `completedStatIdsByContext` and `emptyStatIdsByContext`.
3. `pendingStatIds` now computed from current batch/context:
   - Pending if in current `batchIds` and neither completed nor explicitly empty for this context.

### Phase 2: Make loading/cache scope-aware
Goal: selected stat always re-fetched when scope needs new data.

1. Move from `loadedStatIds: Set<statId>` to scope-aware loaded keying (at least internally), e.g.:
   - `${statId}::${parentArea}::${boundaryType}::${dateMode}`
2. Ensure selected stat remains in priority fetch when current scope data is missing, even if stat was loaded elsewhere.

### Phase 3: Improve UX messaging
Goal: manage expectations when backend/network is slow.

1. In `StatViz`, show progress copy:
   - `Loading X of Y selected areas...`
2. Add delayed state (e.g. after 5s):
   - `Still loading data...`
   - show a small `Retry` action wired to `retryStatData(selectedStatId)`.
3. Keep donut for “all selected unresolved”; row spinners for partial unresolved.

### Phase 4: Lightweight observability
Goal: quickly diagnose live-only slow states.

1. Add timing logs (dev + optional analytics event):
   - batch request start/end
   - rows returned
   - selected area count resolved vs unresolved
2. Add a debug flag in URL/localStorage to enable verbose stat-loading diagnostics.

## Acceptance Criteria
1. No temporary fallback `0` for unresolved selected rows while selected stat is still pending.
2. If all selected rows unresolved, donut spinner is shown.
3. If some rows resolved and some unresolved, resolved rows show values and unresolved rows show row spinner.
4. True loaded zeros display as `0` (no spinner).
5. Scope change triggers selected stat fetch for the new scope without manual retry.
6. No infinite spinner for true no-data cases.

## Suggested Test Matrix
1. Local: fast network, cold cache.
2. Local: throttled network (Fast 3G), cold cache.
3. Production domain with normal profile.
4. Production domain with `settings.reducedDataLoading=true`.
5. Switch county selections repeatedly with same selected stat.
6. Switch selected stat while same areas remain selected.

## Notes for Next Dev
- Keep using `@instantdb/react` query hooks; no custom store wrappers.
- Do not regress hover callback stability in `StatViz` (memoized handler pattern is intentional).
- Avoid broad global-loading gates for row-level loading UX.
