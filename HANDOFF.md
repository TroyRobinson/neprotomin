# Handoff: StatViz Loading Robustness (Advanced Mode)

## Current Status (February 19, 2026)
- Phase 1 is implemented.
- Phase 2 is implemented.
- Selected-stat-first foreground loading is implemented (before family/background stats).
- Remaining work is Phase 3 and Phase 4.

## Context
- Original user report:
  - On live (`map.neighborhoodexplorer.org`), selected-area rows could show temporary `0`s before real values arrived.
  - Localhost appeared faster/more reliable.
- Additional field observation:
  - Perceived "not loading" after cache clear was reproduced under network throttling (3G), which can make first paint look stalled.

## What Is Implemented Now

1. Granular row-level loading UX in StatViz.
   - Selected rows are treated as loading when data is unresolved.
   - Donut spinner appears when all selected rows are unresolved.
   - Row-level spinners appear for partial unresolved states.

2. Context-aware pending bookkeeping in `useStats`.
   - Completion tracked by `queryContextKey` (`mode + date + parents + boundaries`).
   - `completedStatIdsByContext` and `emptyStatIdsByContext` prevent premature pending clear.
   - True no-data is treated as resolved for the active context (no infinite spinner).

3. Scope-aware loaded cache tracking in `useStats` (Phase 2).
   - Old global `loadedStatIds` behavior is replaced with scoped loaded keys.
   - Loaded keys are tracked by `loadedScopeKey` (`mode + parents + boundaries`).
   - Scope/boundary changes can trigger selected-stat fetch even if that stat loaded elsewhere.

4. Selected-stat-first fetch prioritization.
   - `priorityStatIds` order is now:
     - `selectedStatId`
     - `secondaryStatId`
     - `selectedStatChildren`
     - `reportPriorityStatIds`
   - Batch builder now pulls one unresolved priority stat first, then returns that batch immediately.
   - Family/background stats continue loading after foreground stat resolves.

5. Priority cache-miss protection.
   - If a priority stat has no cached rows, it is forced into the next batch even when context completion sets would otherwise skip it.

6. Retry + cache eviction coherence.
   - Retry clears cached rows and context completion/empty markers.
   - Eviction clears context bookkeeping and loaded-scope markers for evicted IDs.

## Important Behavioral Notes

1. Advanced vs non-advanced data loading is still separated.
   - Time-series is only enabled in advanced/report contexts.
   - Non-advanced mode remains snapshot/scoped.

2. "Clear localStorage" is not a full stat-data cache clear.
   - Persistent stat caches are stored in IndexedDB (`persistentStatsCache`), not localStorage.
   - Use Map Settings -> "Clear cached data" for actual stats cache reset.

3. Some instant-feeling switches are expected.
   - If required rows are already cached for current scope/boundary, UI updates can be near-instant.
   - This does not imply missing scope filtering; query filters still include `statId`, `parentArea`, `boundaryType`, and snapshot date where applicable.

## Remaining Work

### Phase 3: Improve UX messaging
Goal: set clearer expectations when backend/network is slow.

1. Add progress copy in StatViz:
   - `Loading X of Y selected areas...`
2. Add delayed state (for example after 5s):
   - `Still loading data...`
   - show `Retry` wired to `retryStatData(selectedStatId)`.
3. Keep donut/row spinner behavior unchanged.

### Phase 4: Lightweight observability
Goal: diagnose live-only slow/stalled states quickly.

1. Add timing logs (dev + optional analytics):
   - batch request start/end
   - rows returned
   - selected rows resolved vs unresolved
2. Add debug flag (URL/localStorage) for verbose stat-loading diagnostics.

## Acceptance Criteria (Updated)
1. No temporary fallback `0` for unresolved selected rows while selected stat is pending.
2. If all selected rows unresolved, donut spinner is shown.
3. If partially resolved, unresolved rows show row spinner while resolved rows show values.
4. True loaded zeros display as `0` (no spinner).
5. Scope change triggers selected stat fetch for the new scope without manual retry.
6. No infinite spinner for true no-data cases.
7. Selected stat is fetched before family/background stats when unresolved.

## Suggested Test Matrix
1. Local fast network, cold IndexedDB cache (clear via Map Settings).
2. Local throttled network (Fast 3G), cold IndexedDB cache.
3. Production domain, normal profile.
4. Production domain with `settings.reducedDataLoading=true`.
5. Switch county/ZIP scope repeatedly with same selected stat.
6. Switch selected stat repeatedly within a family (parent/children).
7. Verify selected stat paints before substats under throttling.

## Notes for Next Dev
- Keep using `@instantdb/react` hooks; do not introduce custom subscription stores.
- Avoid broad global loading gates; preserve row-level loading UX behavior.
- Keep hover callback stability in `StatViz` (memoized handler/ref pattern) to avoid update-depth loops.
