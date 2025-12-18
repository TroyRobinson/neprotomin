# Data caching + loading ideas (and what we shipped)

This doc tracks decisions and UX goals around “big number” stat data and Admin workflows, with an emphasis on refresh/new-tab performance and reliability.

## Status (implemented)

As of **2025-12-18**, we implemented a first full pass of stat caching + load-on-demand:

- **IndexedDB persistent cache** for `statDataSummaries` and full `statData` maps (`src/lib/persistentStatsCache.ts`).
- **Fast cold start**: `statDataSummaries` hydrate from IndexedDB immediately so sidebar numbers render on refresh/new tab (`src/react/hooks/useStats.ts`).
- **Map load-on-demand**: choropleth maps are fetched only for the active stat(s) + relevant scope(s), not via an “all statData” subscription (`src/state/statData.ts`, `src/react/imperative/mapView.ts`).
- **TTL + eviction**: 2h refresh TTL + LRU cap (by entry count) for heavy maps.
- **Cross-tab behavior**:
  - BroadcastChannel events for cache clears and updates.
  - A `localStorage` lock to prevent duplicate refresh work across tabs (`acquireCacheLock`).
- **UX controls**:
  - “Clear cached data” in Map Settings (`src/react/components/MapSettingsModal.tsx`).
  - Optional “Preload recent stats when idle” toggle (off by default).

## 1) Persisting heavy data across refresh / new tabs

### Why we do it

Our heaviest payload is per-stat `statData` (ZIP/county maps). Instant’s client cache is good *within a tab*, but a refresh/new tab starts cold. Persisting the right pieces improves perceived load and reduces `operation-timed-out` risk.

### What we store (current)

Store *only what improves UX most per byte*:

1. **Stat summaries** (`statDataSummaries`)

- Small; makes “no selection” list values quick on reload.
- Cached in IndexedDB keyed by `(parentArea, boundaryType)`.

2. **Full stat maps** (`statData`) selectively

- Cached in IndexedDB keyed by `(statId, parentArea, boundaryType)` storing the latest `date` map + metadata.
- Hydrated immediately on selection to make switch-back fast.

3. **Metadata**

- Cache schema version (invalidate when the app changes).
- `savedAt`/`lastAccessedAt` for TTL and eviction.
- Optional `summaryUpdatedAt` (used to skip redundant refreshes).

### How the app decides what to fetch (current)

- Prefer `statDataSummaries` to identify the latest `date` per `(statId,parentArea,boundaryType)` and fetch only those full maps.
- If summaries are missing or don’t match, fall back to querying `statData` directly and selecting the latest date client-side (slower, but avoids “blank choropleth” failures).
- Normalize/alias parent areas to tolerate historical naming differences (e.g. `Tulsa` vs `Tulsa County`).

### Guardrails (current)

- **Storage**: IndexedDB (avoid `localStorage` for large payloads).
- **TTL**: 2 hours; refresh is background/best-effort (stale-while-revalidate).
- **Eviction**: LRU by entry count for cached maps (future: add a byte-size cap if needed).
- **Cross-tab**: one tab performs refresh work; other tabs rehydrate on cache-update events.

## 2) Admin screen & modals: loading UX + data optimizations

### Current assessment

Admin reliability issues usually come from two places:

- **Unbounded reads** (scanning `statData` when a summary would do).
- **Retry UX** that can spam queries (e.g. “summaries unavailable \[retry\]” loops).

With the `statDataSummaries` split and load-on-demand for map choropleths, Admin does not *need* major new caching—but it does benefit from a disciplined “summary-first, maps only on demand” approach and better retry/progress UX.

### Recommendations (concise, technical)

**Admin stat cards / tables**

- Default to **summary-only reads**:
  - Query `statDataSummaries` with tight `fields` and targeted `where`.
  - Show `updatedAt`, `date`, `count`, and a representative metric (`avg`/`sum` depending on stat type) without loading maps.
- Use a **two-stage render**:
  - Stage 1: skeleton while summaries load.
  - Stage 2: show summary metrics; only load maps for an explicit “Preview”/expand action.

**Derived stat modal**

- Modal open should be cheap:
  - On open: load `stats` + the relevant `statDataSummaries` needed for dropdown options (boundary availability, years).
  - On “Run”: fetch only the exact `statData` maps required by the chosen inputs (statId + parentArea + boundaryType + date).
- Use `queryOnce` for the heavy “Run” phase; avoid background subscriptions that can compete with import work.

**Import preview / import queue / admin workflows**

- Avoid turning a “Preview” screen into a data scan:
  - Prefer server-side summaries generated during import.
  - If a preview needs sampling, cap it (limit) and render progressively.
- Make statuses explicit:
  - `starting` → `running` → `success/error` with timestamps and a stable “Retry” button.
  - Don’t auto-retry aggressively; use exponential backoff + jitter.

**Fixing “summaries unavailable / retry”**

- Treat missing summaries as **recoverable**, not an immediate hard error:
  - If prior summary exists, render it with “Updating…” and keep the UI usable.
  - Only show an error after a small number of failures or a time budget.
- Provide explicit recovery actions:
  - “Backfill summaries” (admin-only) using `scripts/admin/backfillStatDataSummaries.ts`.
  - Optional “Rebuild summaries for this stat” if we add a targeted backfill path later.
- Avoid silent fallback to scanning `statData` across the whole dataset:
  - If falling back, keep it scoped (statId + parentArea + boundaryType) and make it user-triggered if it might be large.

### When Admin doesn’t need major changes

If Admin is already summary-first (cards/tables) and only pulls full maps at “Run/Preview” time, then remaining wins are mostly UX polish (skeletons, debounced retries, explicit actions).

## 3) Org data: do we need similar optimizations?

Organizations are typically much smaller per row than stat maps. Unless we’re pulling large optional fields for every org (e.g. `raw`, long text) in the main list query, org performance is usually fine.

If org loading ever becomes a bottleneck:

- Split “list” vs “details” queries (list uses minimal fields; details fetched on expand).
- Use Instant `$: { fields: [...] }` to keep payload lean.
- Debounce expensive derived computations (e.g. search index building) and cache results in memory.