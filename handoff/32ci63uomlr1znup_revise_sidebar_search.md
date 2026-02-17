# 32ci63uomlr1znup Revise Sidebar Search

## Objective
Revise the map sidebar UI to include an always-expanded search bar on desktop. This search bar should support fuzzy searching for Organizations, Statistics, and Cities, as well as direct lookup for Addresses and ZIP codes.

## Current State
*   **Sidebar (`src/react/components/Sidebar.tsx`)**: Contains tabs for "Orgs" and "Stats" and a category filter. No global search input. Receives `organizations` (with `.all` list) and `statsById` (Map<string, Stat>) as props.
*   **TopBar (`src/react/components/TopBar.tsx`)**: Contains a mobile-only search bar. Desktop TopBar has navigation links but no search. On submit it calls `onMobileLocationSearch`.
*   **ReactMapApp (`src/react/ReactMapApp.tsx`)**: `handleMobileLocationSearch` is the main search handler. It tries: city targets → ZIP match → county match → org fuzzy match → address geocode. Also has `findOrganizationMatches(query, maxResults)` which uses `organizationSearchIndex` (pre-normalized org names) and `computeSimilarityFromNormalized`.
*   **Fuzzy Matching (`src/react/lib/fuzzyMatch.ts`)**: Exports `normalizeForSearch`, `computeStringSimilarity`, `computeSimilarityFromNormalized`. Levenshtein-based with substring/prefix bonuses.
*   **City Targets (`src/react/lib/citySearchTargets.ts`)**: `CITY_SEARCH_TARGETS` array with 30 Oklahoma cities. `findCitySearchTarget(query)` does exact alias matching (not fuzzy). Each has `name`, `aliases`, `center`, `bounds`.
*   **Geocoding (`src/react/lib/geocoding.ts`)**: `looksLikeAddress(input)` returns true if input has digits or address suffixes. `geocodeAddress()` for actual geocoding.
*   **Stat type (`src/types/stat.ts`)**: `{ id, name, label?, category, ... }` — label is human-friendly display name.

## InstantDB Considerations
*   **No native fuzzy search.** InstantDB only supports `$like`/`$ilike` (SQL LIKE with `%` wildcards), not fuzzy/Levenshtein matching.
*   **Strategy: Client-side fuzzy search** using existing `fuzzyMatch.ts`. All org and stat data is already loaded in Sidebar props. City targets are a static array. This is the correct approach — no DB query needed for search-as-you-type.

## Requirements Summary

### UI Changes
1. **Desktop only:** Always-visible search input at top of sidebar (above tabs).
2. **Dropdown:** When typing, a floating results list (~4 items max) overlays below the input.
3. **Icons:** Each result type gets a distinct muted icon (building/org, chart-bar/stat, map-pin/city, map/address).

### Search Behavior
- **Organizations:** Fuzzy match on `name` (and optionally `category` label). Uses existing `normalizeForSearch` + `computeSimilarityFromNormalized`.
- **Statistics:** Fuzzy match on `label` (fallback to `name`).
- **Cities:** Fuzzy match on city names from `CITY_SEARCH_TARGETS` array (not just exact alias matching — upgrade to fuzzy so partial typing like "Tul" returns "Tulsa").
- **Address/ZIP:** If `looksLikeAddress(input)` or `/^\d{3,5}$/.test(input)`, show a single "Go to [input]" item. No fuzzy search for this case.

### Selection Actions
| Type | Sidebar Action | Map Action |
|------|---------------|------------|
| **Organization** | Switch to Orgs tab, select + expand org | Highlight + zoom to org (existing `onOrganizationClick`) |
| **Statistic** | Switch to Stats tab, select stat | Load stat choropleth on map (`onStatSelect`) |
| **City** | No sidebar change | Zoom to city bounds (delegate to `handleMobileLocationSearch`) |
| **Address/ZIP** | No sidebar change | Geocode + zoom (delegate to `handleMobileLocationSearch`) |

---

## Implementation Plan (3 Slices)

### Slice 1: Search input + hook + dropdown UI (core feature)

**Goal:** Desktop sidebar gets an always-visible search input with a fuzzy-find dropdown showing mixed results.

**Files to create:**
- `src/react/hooks/useSidebarSearch.ts` — New hook encapsulating all search logic

**Files to modify:**
- `src/react/components/Sidebar.tsx` — Add search input and dropdown to top of sidebar

**Detailed steps:**

1. **Create `useSidebarSearch` hook** (`src/react/hooks/useSidebarSearch.ts`):
   ```
   interface SidebarSearchResult {
     type: "org" | "stat" | "city" | "address";
     id: string;          // org id, stat id, city name, or raw query
     label: string;       // display name
     sublabel?: string;   // e.g. org category, stat category, "Go to address"
     score: number;       // for ranking
   }

   useSidebarSearch({
     query: string,
     organizations: Organization[],
     statsById: Map<string, Stat>,
     maxResults?: number  // default 5
   }): SidebarSearchResult[]
   ```

   **Logic (inside useMemo, debounced with query length check):**
   - If `query.trim().length < 2`, return `[]`.
   - Check `looksLikeAddress(query)` or `/^\d{3,5}$/.test(query.trim())`:
     - If true: return `[{ type: "address", id: query, label: query, sublabel: "Go to location", score: 1 }]` as the only result.
   - Otherwise, run fuzzy matches in parallel:
     - **Orgs:** Iterate `organizations`, compute `computeSimilarityFromNormalized(normalizedQuery, normalizeForSearch(org.name))`, filter score > 0.3, take top 3.
     - **Stats:** Iterate `statsById.values()`, match on `stat.label || stat.name`, filter score > 0.3, take top 2.
     - **Cities:** Iterate `CITY_SEARCH_TARGETS`, match on `target.name` (and aliases), filter score > 0.3, take top 2.
   - Merge all results, sort by score descending, limit to `maxResults`.
   - Pre-normalize the search index for orgs/stats using `useMemo` to avoid re-normalizing on every keystroke.

2. **Add search UI to `Sidebar.tsx`**:
   - Add `searchText` state.
   - **Search input:** Render above the tabs row (desktop variant only). Simple `<input>` with a search icon, rounded border, placeholder "Search orgs, stats, cities...".
   - **Dropdown:** When `searchResults.length > 0`, render an absolutely-positioned `<ul>` below the input. Each `<li>` shows:
     - Left: muted icon (use inline SVGs from HeroIcons — `BuildingOfficeIcon` for org, `ChartBarIcon` for stat, `MapPinIcon` for city, `MapIcon` for address).
     - Center: `label` (bold) + `sublabel` (muted, smaller).
     - Clickable with hover highlight.
   - Style: `absolute left-0 right-0 z-50`, with `max-h-[12rem] overflow-y-auto`, white bg, shadow-lg, rounded-lg border.
   - Close dropdown on: blur (with small delay for click registration), Escape key, or selection.

3. **Wire up new Sidebar props** for search actions:
   - Add `onLocationSearch?: (query: string) => void` to `SidebarProps` — delegates to existing `handleMobileLocationSearch` in ReactMapApp.
   - Org selection: Call existing `onOrganizationClick(id)` + switch to orgs tab.
   - Stat selection: Call existing `onStatSelect(statId, {})` + switch to stats tab.
   - City/Address: Call `onLocationSearch(query)`.

4. **Wire in ReactMapApp:**
   - Pass `onLocationSearch={handleMobileLocationSearch}` to desktop `<Sidebar>`.

**Slice 1 completion (implemented 2026-02-17):**
- Status: `Completed`
- InstantDB note: kept fuzzy search entirely client-side (no new Instant queries), consistent with Instant limitations (`$like`/`$ilike` only, no Levenshtein fuzzy).
- Files created:
  - `src/react/hooks/useSidebarSearch.ts`
    - Added `useSidebarSearch(...)` hook and `SidebarSearchResult` type.
    - Implements mixed-result search with:
      - min query length guard (`<2` => no results),
      - address/ZIP short-circuit (`looksLikeAddress` or `^\d{3,5}$`) returning one address row,
      - fuzzy org/stat/city scoring via `computeSimilarityFromNormalized`,
      - per-type caps (org 3, stat 2, city 2), merged ranking, global cap (`maxResults`, default 5),
      - pre-normalized in-memory indexes via `useMemo`.
- Files modified:
  - `src/react/components/Sidebar.tsx`
    - Added desktop-only always-expanded search input above tabs.
    - Added dropdown UI (`max-h-[12rem]`, absolute overlay, muted type icons via Heroicons).
    - Added search state + close behavior (blur delay, Escape, selection, Enter selects first result).
    - Added `onLocationSearch?: (query: string) => void` to `SidebarProps`.
    - Wired result selection behavior:
      - org: switch to `orgs` tab + call `onOrganizationClick`.
      - stat: switch to `stats` tab + call `onStatSelect`.
      - city/address: call `onLocationSearch`.
  - `src/react/ReactMapApp.tsx`
    - Wired desktop `<Sidebar>` with `onLocationSearch={handleMobileLocationSearch}`.
  - `src/react/lib/citySearchTargets.ts`
    - Exported `CITY_SEARCH_TARGETS` so sidebar hook can fuzzy score city names/aliases.
- Verification run:
  - `npm run build` passed (`tsc && vite build`).
  - Environment warning observed only: local Node is `22.11.0` while Vite recommends `22.12+`.
- Context for next slice agent:
  - Slice 2 is partially satisfied by current click handler (`stat` already switches tab + calls `onStatSelect` + clears search), but needs explicit review against desired stat-list highlight UX in-app.
  - Slice 3 is not complete yet: org result currently switches to Orgs tab and triggers map select/zoom, but does **not** yet set `expandedOrgId` or scroll the org row into view after selection.
  - Dropdown behavior currently supports: click-select, Enter (first result), Escape, and outside blur close. Arrow-key list navigation is **not** implemented in this slice.
  - Address/ZIP detection is intentionally broad (`looksLikeAddress` OR `^\d{3,5}$`), so numeric prefixes like `741` surface the direct "Go to location" action instead of mixed fuzzy results.
  - Build validation snapshot for this slice: `npm run build` succeeds on 2026-02-17; Vite prints a Node advisory for `22.11.0` vs recommended `22.12+`, but build output is successful.

### Slice 2: Stat selection from search opens stat in sidebar

**Goal:** When a stat is selected from search, switch to Stats tab and select the stat so it loads on the map.

**Files to modify:**
- `src/react/components/Sidebar.tsx` — Handle stat search result click

**Detailed steps:**
1. On stat result click in dropdown:
   - Call `setActiveTabWithSync("stats")` to switch to Stats tab.
   - Call `onStatSelect?.(statId, {})` to select the stat.
   - Clear search text + close dropdown.
2. This should already cause the StatList to highlight the selected stat and ReactMapApp to load the choropleth (existing behavior when `selectedStatId` changes).

**Slice 2 completion (verified 2026-02-17):**
- Status: `Completed`
- Implementation verification:
  - `src/react/components/Sidebar.tsx` (`handleSearchResultSelect`) already executes the required stat flow:
    - switches to stats tab via `setActiveTabWithSync("stats")`,
    - selects stat via `onStatSelect?.(result.id, {})`,
    - clears/closes search via `setSearchText("")` and `setIsSearchDropdownOpen(false)`.
  - Existing `StatList` receives `selectedStatId`/`onStatSelect` as before, so selected stat highlighting + map choropleth load continues through existing app wiring.
- Files altered in this slice:
  - `handoff/32ci63uomlr1znup_revise_sidebar_search.md`
    - Updated Slice 2 section with completion status and verification notes.
  - No product source code changes were required for Slice 2 because required behavior was already implemented.
- Verification run:
  - `npm run build` passed (`tsc && vite build`).
  - Advisory observed: local Node `22.11.0` is below Vite's recommended `22.12+`, but build completes successfully.
- Context for next slice agent:
  - Slice 3 remains open: org-result selection should additionally force open (`expandedOrgId`) and scroll selected org into view after switching tabs and map selection.

### Slice 3: Org selection from search opens org in sidebar

**Goal:** When an org is selected from search, switch to Orgs tab, expand the org card, and zoom to it on the map.

**Files to modify:**
- `src/react/components/Sidebar.tsx` — Handle org search result click

**Detailed steps:**
1. On org result click in dropdown:
   - Call `setActiveTabWithSync("orgs")` to switch to Orgs tab.
   - Call `onOrganizationClick?.(orgId)` to select + zoom on map.
   - Set `expandedOrgId` to the clicked org's id (so hours card opens).
   - Clear search text + close dropdown.
   - After a short delay, call `scrollOrgIntoView(orgId)` to scroll the org into view in the list.

**Slice 3 completion (implemented 2026-02-17):**
- Status: `Completed`
- Files altered in this slice:
  - `src/react/components/Sidebar.tsx`
    - Search selection state section (near existing search timeout refs):
      - Added `orgSearchScrollTimeoutRef` to track delayed org scroll timer.
      - Added `clearOrgSearchScrollTimeout` helper and included timer cleanup in unmount cleanup effect.
    - `handleSearchResultSelect` callback:
      - In `result.type === "org"` branch, now:
        - switches to org tab (`setActiveTabWithSync("orgs")`),
        - triggers existing map/org selection (`onOrganizationClick?.(result.id)`),
        - sets `expandedOrgId` to open the org card,
        - schedules delayed `scrollOrgIntoView(result.id, { padding: 24 })` after 120ms so list scroll happens after tab/content update.
      - Existing clear/close behavior remains (`setSearchText("")`, `setIsSearchDropdownOpen(false)`).
  - `handoff/32ci63uomlr1znup_revise_sidebar_search.md`
    - Updated Slice 3 section with completion details and verification context.
- Why these changes:
  - Guarantees org selections from dropdown visibly open the org card in the sidebar and bring it into view, matching requested UX and reducing reliance on indirect side effects from map-driven selection updates.
- Verification run:
  - `npm run build` passed (`tsc && vite build`).
  - Advisory observed: local Node `22.11.0` is below Vite recommended `22.12+`, but build completes successfully.
- Context for review agent:
  - Confirm org search selection behavior specifically when selected org is off-screen in a long list.
  - Confirm no regressions to existing map-originated auto-expansion behavior (`selectedOrgIdsFromMap`) since this slice only changes search-originated selection path.

**Post-slice follow-up (2026-02-17, user-reported UX bugfix):**
- Trigger: after Slice 3, user reported two behaviors:
  - selected org from search was highlighted on map but not reliably surfaced near top of sidebar list,
  - org list could no longer be scrolled in some desktop layouts.
- Additional UX request:
  - prefer structural “pinned to top” behavior for orgs chosen from sidebar search (not only scroll-to visibility).
- Files altered:
  - `src/react/components/Sidebar.tsx`
    - Search-org select behavior:
      - changed delayed scroll from visibility-only (`scrollOrgIntoView(..., { padding: 24 })`) to top-aligned (`scrollOrgIntoView(..., { alignTop: true, padding: 0 })`) so selected org is brought to top region more consistently.
      - added `searchPinnedOrgId` state set on org search selection.
      - added a top `SELECTED` section rendering the search-selected org at top of the org tab.
      - de-duplicated the pinned org from `RECENTLY ADDED`, `IN SELECTION`, and `ALL` sections while pinned.
      - when a search-pinned org is active, force the org tab into a clean two-section layout (`SELECTED` + `ALL`) by folding the remaining items into the `ALL` list.
      - auto-clears the pinned-search marker when selection changes away from that org.
      - updated delayed search-selection scroll to scroll the org list container to top so the `SELECTED` heading stays visible.
    - Scroll container/layout robustness:
      - added `min-h-0` across sidebar flex chain (`aside` container class, tab content wrapper, stats wrapper, org list scroll container) so `overflow-y-auto` on org list can shrink and scroll correctly with the new search header present.
- Verification run:
  - `npm run build` passed (`tsc && vite build`).
  - Node advisory unchanged: local `22.11.0` vs Vite recommended `22.12+`.
- Review focus:
  - Verify desktop org list is manually scrollable after performing a search and selecting an org.
  - Verify selected org from search appears in top `SELECTED` section, remains expanded, and is not duplicated lower in the list.

**Post-slice follow-up (2026-02-17, search comprehensiveness parity):**
- Trigger: user observed that some orgs were missing from the new sidebar search compared to prior map search behavior.
- Root cause:
  - Sidebar fuzzy org search indexed `rawAll` (viewport/source-limited sidebar list), not the full org dataset available in app state.
- Files altered:
  - `src/react/ReactMapApp.tsx`
    - Both desktop and mobile `<Sidebar />` mounts now pass `searchOrganizations={availableOrganizations}` so sidebar search can index all currently available orgs, not only viewport-limited sidebar sections.
  - `src/react/components/Sidebar.tsx`
    - Added optional prop `searchOrganizations?: Organization[]`.
    - Updated `useSidebarSearch` call to prefer `searchOrganizations` and fall back to `rawAll` if not provided.
  - `src/react/hooks/useSidebarSearch.ts`
    - Upgraded org scoring/indexing to align with existing old-map matcher patterns:
      - Pre-indexes normalized `name`, `city + name`, `name + address`, `address`, `city`.
      - Applies boosted exact/contains scores on primary name (`1.2` exact, `1.05` includes) before fuzzy fallback.
      - Uses org threshold `0.55` (matching old `ORGANIZATION_MATCH_THRESHOLD`) for better precision.
    - Stats/cities/address behavior remains unchanged.
- Why this approach:
  - Improves recall to match user expectation from old search behavior without adding network/database latency.
  - Maintains responsive UX by keeping all normalization in memoized in-memory indexes and preserving small dropdown result caps.
- Verification run:
  - `npm run build` passed (`tsc && vite build`).
  - Advisory remains: local Node `22.11.0` vs Vite recommended `22.12+`.

---

## Key Architecture Decisions

1. **Client-side only search** — no InstantDB queries needed. All data (orgs, stats, cities) is already in memory via props.
2. **Cities get fuzzy matching** — currently `findCitySearchTarget` only does exact alias lookup. The hook will use `computeStringSimilarity` against city names/aliases so typing "Tul" shows "Tulsa".
3. **Desktop only** — Mobile keeps existing TopBar search behavior. The new sidebar search input is `variant === "desktop"` only.
4. **Debounce not needed initially** — the datasets are small enough (hundreds of orgs, dozens of stats, 30 cities) that synchronous `useMemo` filtering on every keystroke should be fine. Add debounce later if perf degrades.
5. **Single new hook** — `useSidebarSearch` keeps search logic out of the already-large Sidebar component.

## Relevant Files
*   `src/react/components/Sidebar.tsx` — Primary modification target (search input + dropdown UI)
*   `src/react/hooks/useSidebarSearch.ts` — New file: search logic hook
*   `src/react/ReactMapApp.tsx` — Wire `onLocationSearch` prop to desktop Sidebar
*   `src/react/lib/fuzzyMatch.ts` — Existing fuzzy match utility (reuse as-is)
*   `src/react/lib/geocoding.ts` — `looksLikeAddress` for address detection
*   `src/react/lib/citySearchTargets.ts` — `CITY_SEARCH_TARGETS` for city fuzzy matching
*   `src/types/stat.ts` — Stat type definition
