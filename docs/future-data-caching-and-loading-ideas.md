# Future data caching + loading ideas

This doc summarizes possible next steps to make the app feel faster and more reliable, especially around “big number” stat data and Admin workflows.

---

## 1) Persisting heavy data across refresh / new tabs

### Does it make sense?

Often yes—because our heaviest payload is per‑stat `statData` (ZIP/county maps). Instant’s client cache is great *within a tab*, but a new tab/refresh starts “cold”, so the user sees placeholders and we re-download large payloads.

**Benefits**

- Faster perceived load when opening a new tab or refreshing.
- Fewer large Instant queries → fewer `operation-timed-out` failures.
- Better UX for “selection mode” (values for selected ZIPs/counties require full maps).

**Costs / risks**

- Complexity: storage, invalidation, versioning, edge cases.
- Disk/quota: storing ZIP maps for many stats can be large.
- Staleness: user may see cached values briefly until background refresh completes.
- Consistency: Instant is realtime; local persistence can diverge if we don’t refresh.

### What to store locally (suggested)

Store *only what improves UX most per byte*:

1. **Stat summaries** (`statDataSummaries`) for the current map mode (ZIP or COUNTY)

- Small, fast to store, makes “no selection” list values instant on reload.

2. **Full stat maps** (`statData`) selectively

- Always cache:
  - currently selected primary stat (+ secondary stat if set)
  - last N “recently viewed” stats (LRU)
- Optionally cache:
  - “top visible” stats in the sidebar (first page) after idle

3. **Small metadata**

- Last refresh timestamp
- Cache schema version (so we can invalidate when the app changes)
- The scopes used (e.g., ZIP parent scope label), so we can decide if cached data is relevant

### How to manage it (guardrails)

**Storage choice**

- Use **IndexedDB** (best for large structured data).
- Avoid `localStorage` for big payloads (small quota + blocks UI thread).

**TTL + refresh policy**

- TTL: 2 hours is reasonable.
- On app start:
  - hydrate UI from cache immediately
  - in the background, refresh only if TTL expired (or if the user explicitly refreshes)

**Size limits**

- Hard cap: e.g. max \~10–25MB, or max N stats.
- Eviction: LRU (least recently used) for `statData` maps.

**Correctness**

- Validate payload shape before using cached data.
- Key by `(statId, boundaryType, parentArea, date)` (or an equivalent stable composite).
- If cache schema version changes, clear old cache.

**UX controls**

- Add a small “Clear cached data” action in Settings for troubleshooting.
- Prefer showing “Using cached values…” + a subtle “Updating…” indicator during background refresh.

---

## 2) Admin screen: should it use summaries/batching too?

### Where it can help

The Admin screen does heavy work (imports, derived-stat generation) and historically had to “turn off” heavy live stat subscriptions to avoid timeouts. With the recent split between:

- lightweight `statDataSummaries` (rollups)
- heavy `statData` (ZIP/county maps)
- “load-on-demand” batching for `statData`

…Admin can often be made faster and more reliable by leaning on summaries + smaller targeted queries.

**Potential improvements**

1. **Admin stat cards**

- Use `statDataSummaries` to show “latest value/coverage/updatedAt” without loading full maps.
- Show “years available” from summary dates (or a small per-stat query for distinct dates if needed).

2. **Derived stat modal**

- Populate “years available” and boundary availability from summaries first.
- Only fetch full `statData` maps for the selected source stats when the user actually runs the derivation.

3. **Fixing “summaries unavailable / retry”**

- Most of that pain comes from schema mismatch (summaryKey not unique) or relying on heavy queries during imports.
- If Admin always prefers summaries for display and only pulls full maps at “run” time, it should reduce retry loops.

### When changes may be unnecessary

If Admin already:

- disables heavy subscriptions during import (good)
- uses the Admin SDK server-side for imports (good)
- writes/upserts `statDataSummaries` during import (good)

…then the biggest remaining Admin wins are mostly UX + targeted reads (avoid scanning full `statData` for “preview” purposes).

---

## 3) Org data: do we need similar optimizations?

### Current state (relative)

Organizations can be numerous, but each org row is typically much smaller than `statData` maps. So the org side is *usually* in a better spot than stats—unless we’re fetching large optional fields for every org (e.g., `raw`, `hours`, long text) in the main query.

### Potential optimizations (if needed)

1. **Split “list” vs “details”**

- List query: only fields required for map + sidebar list (id, name, lat/lon, category, status, maybe hours summary).
- Details query: fetch heavier fields only when an org is expanded or opened.

2. **Limit fields**

- Use Instant’s `$: { fields: [...] }` where possible to keep payload lean.

3. **Avoid re-fetch loops**

- Keep a stable subscription alive for org list data (avoid turning it on/off).
- Debounce expensive derived computations (search index building) and cache results in memory.

4. **Optional persistence**

- Persist lightweight org list results in IndexedDB (similar TTL rules), but this is usually lower priority than stat maps.

### When org changes are probably not worth it

If org performance is already acceptable and the main timeouts are from `statData`/summaries, focus first on:

- summaries query size/reliability
- selection-mode behavior (only fetch full maps when required)
- caching selected/recent stat maps