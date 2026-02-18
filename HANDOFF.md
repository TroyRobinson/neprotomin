# Frontend Handoff: Granular StatViz Loading States

## Goal
Prevent temporary fallback `0` values from looking like real data in advanced mode.

When selected areas are still loading, show loading UI instead of misleading `0`s:
- Per-area spinner for mixed states (some loaded, some pending).
- Global donut spinner when **all selected areas** are still unresolved.

## Why revise the prior plan
The previous plan (`isLoading && raw === undefined`) is directionally right, but it should be tightened in two ways:
1. Use a **selected-stat loading signal** (not a broad app/global loading boolean) to avoid false positives from unrelated background fetches.
2. Add a chart-level guard so when every selected entry is unresolved we keep the current donut spinner.

## Revised Plan

### 1. Expose selected-stat pending state from `useStats`
File: `src/react/hooks/useStats.ts`

- Keep existing `isLoading` return value.
- Add a stat-specific pending signal (recommended shape):
  - `pendingStatIds: Set<string>` (or helper `isStatPending(statId)`).
- Source of truth:
  - IDs requested in current batch but not yet marked loaded.
  - This is already derivable from `batchIds` and `loadedStatIds`.

This avoids using a broad loading flag when only unrelated stats are loading.

### 2. Pass selected-stat loading to StatViz
Files:
- `src/react/ReactMapApp.tsx`
- `src/react/components/Sidebar.tsx`
- `src/react/components/StatList.tsx`
- `src/react/components/StatViz.tsx`

- In `ReactMapApp`, derive:
  - `isSelectedStatLoading = !!selectedStatId && pendingStatIds.has(selectedStatId)`.
- Pass that boolean down to `StatViz` (through `Sidebar` and `StatList` props).

### 3. Add per-entry loading metadata in bar mode
File: `src/react/components/StatViz.tsx`

- Extend `BarChartEntry` with:
  - `isLoading?: boolean`
  - `isSelectedArea?: boolean` (exclude AVG rows from “all pending” logic)
- In `chartData` bar mapping:
  - `raw = boundary?.data?.[area.id]`
  - `isLoadingEntry = isSelectedStatLoading && raw === undefined`
  - `value = finite(raw) ? raw : 0`

Interpretation:
- `raw === 0` means loaded zero (show `0`, no spinner).
- `raw === undefined` while selected stat is pending means unresolved (spinner).

### 4. Preserve donut spinner when all selected rows are unresolved
File: `src/react/components/StatViz.tsx`

Add:
- `allSelectedBarsLoading = chartData.mode === "bar" && selectedAreaRows.length > 0 && selectedAreaRows.every(r => r.isLoading)`

Render priority:
1. If `isStatDataLoading` OR `allSelectedBarsLoading`: show donut spinner.
2. Else render chart.
3. In bar chart rendering, if `entry.isLoading`, show small inline spinner in that row.

This directly addresses the “all values currently 0 because still loading” case.

### 5. Line chart behavior
Keep current line behavior for now. Optional follow-up:
- if selected stat is pending and no resolved points for selected areas, show donut.

## Acceptance checks
1. Select areas in advanced mode; while fetch is pending, unresolved rows do not show `0`.
2. If **all** selected rows are unresolved, donut spinner shows.
3. If data resolves to true zeros, chart shows `0` (no spinner).
4. AVG rows never count as selected-area loading rows.
5. No regressions in non-advanced mode or when no areas are selected.
