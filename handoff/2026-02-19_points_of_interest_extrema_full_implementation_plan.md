# 2026-02-19 Points Of Interest (Extrema) Full Implementation Plan Handoff

## 0. Implementation Progress Update (2026-02-19)

Status summary:
- Slice 1 is complete (schema/perms + backend recompute/deactivate + admin toggle/status).
- Slice 2 (map no-stat POI rendering) is now complete as of 2026-02-20 with regression fixes.
- Section 0.7 captures earlier debugging notes from the failed attempt.
- Section 0.8 captures the final merged Slice 2 behavior and fixes.

### 0.1 Completed in code

Schema/perms:
- Added `stats.pointsOfInterestEnabled` in `src/instant.schema.ts`.
- Added `pointsOfInterest` entity in `src/instant.schema.ts` with indexed fields from this plan.
- Added `pointsOfInterest` rules in `instant.perms.ts` (`view=true`, writes admin-only).

Backend:
- Added compute module: `api/_shared/pointsOfInterest.ts`.
- Added endpoint: `api/points-of-interest-recompute.ts`.
- Added admin script: `scripts/admin/backfillPointsOfInterest.ts`.
- Added npm script: `admin:backfill:points-of-interest` in `package.json`.

Admin UI:
- Extended stat types + parsing for `pointsOfInterestEnabled`.
- Added POI checkbox/toggle and helper text in `src/react/components/AdminScreen.tsx`.
- Added POI save behavior:
  - OFF -> deactivate POIs for stat.
  - ON -> recompute POIs for stat.
  - If POI stays ON and key metadata changed (category/name/label/goodIfUp/visibility), recompute.
- Added "Recalculate now" button in edit form.
- Added per-stat inline POI status and summary badges in list rows (active count + last computed date).

Type/store plumbing:
- Added `pointsOfInterestEnabled?: boolean` in `src/types/stat.ts`.
- Plumbed into `src/state/stats.ts` and `src/react/hooks/useStats.ts`.

### 0.2 API behavior implemented

Endpoint:
- `POST /api/points-of-interest-recompute`
- Body:
  - `statId: string` (required)
  - `action?: "recompute" | "deactivate"` (default `recompute`)
  - `force?: boolean`
  - `callerEmail?: string` (used only by fallback auth path)
- Response includes:
  - `rowsUpserted`, `rowsDeactivated`, `runId`, `computedAt`, `skipped`, `reason`.

Recompute details:
- Uses `statDataSummaries` (`name="root"`) to identify latest context rows.
- Loads matching `statData` maps and merges by scope aliases.
- Computes extrema for 3 scopes x 2 boundaries x high/low.
- Tie-break is deterministic (lexical area code).
- If high and low are same area, only high row is kept.
- Existing stale POI rows are deactivated.

### 0.3 Auth hardening currently in place

`api/points-of-interest-recompute.ts` auth gate:
- If `POINTS_OF_INTEREST_API_KEY` (or `POI_RECOMPUTE_API_KEY`) is set:
  - requires header `x-poi-api-key` (or bearer token) to match.
- If no API key configured:
  - in non-production: allows fallback when `callerEmail` is admin email/domain.
  - in production: rejects.

Client behavior:
- Admin UI sends `x-poi-api-key` only when `VITE_POINTS_OF_INTEREST_API_KEY` is present.
- Otherwise it sends `callerEmail` fallback.

### 0.4 Runtime/import gotchas already fixed

These issues happened and were fixed:
- `Cannot find module ... api/_shared/pointsOfInterest`:
  - fixed by explicit `.ts` import in API/script files.
- `Cannot find module ... src/lib/scopeLabels` from API runtime:
  - fixed by removing `src/` import from API shared file and inlining local scope helpers.

Current imports are serverless-safe for the POI endpoint.

### 0.5 Current known behavior notes

- `rowsUpserted = 12` means all combinations were produced:
  - 3 scopes x 2 boundaries x 2 extrema.
- `goodIfUp` on POI rows is copied from the target stat only.
  - It does not inherit from parent/related stats when unset.
  - This is intentional for now, but can be changed if desired.

### 0.6 Verification performed for Slice 1

- Project type/build check passed (`npm run build`).
- Admin toggle now triggers recompute/deactivate endpoint calls.
- Endpoint module loads successfully in local runtime after import fixes.

### 0.7 Slice 2 Debugging Findings (2026-02-20)

This section captures what was learned while debugging no-stat POI rendering, so the next dev can avoid repeating dead ends.
These are insights only; prior slice-2 code edits from this debugging session were intentionally cleared by the user.

What actually blocked POI visibility:
- Main blocker was stale live Instant config, not MapLibre rendering.
- Local `instant.perms.ts`/`src/instant.schema.ts` had POI rules/entity, but the app environment had not been pushed.
- Result in browser: POI subscription appeared empty (`storeRows=0`) even though admin table had rows.
- After `npx instant-cli push`, POIs became readable in client and markers appeared.

Important verification commands/patterns:
- Use guest impersonation to validate real client visibility:
  - `db.asUser({ guest: true }).debugQuery({ pointsOfInterest: { $: { where: { isActive: true }, limit: ... } } })`
- In debug output, check:
  - `program.code` and `check` for POI rows (should be `true`).
  - `result.pointsOfInterest` row count.
- Note: admin SDK responses can differ by call path; rows may be top-level (`resp.pointsOfInterest`) rather than always nested in `resp.data.pointsOfInterest`.

Data-shape findings that can look like rendering bugs:
- Existing active POI categories observed during debugging were only:
  - `housing`, `education`, `economy`.
- If user selects `food` or `health`, no markers is expected unless POI rows exist for those categories.

Query-shape finding:
- Avoid adding `order: { computedAt: "desc" }` to the client POI subscription for slice 2 v1.
- During debugging this caused query validation failures in environments where schema/index state was not fully synced.
- Safe v1 query: `where: { isActive: true }` + `limit`.

Implementation caution that caused map-load regression:
- Do not call map-dependent extrema refresh functions from chip callbacks before the MapLibre instance exists.
- `createCategoryChips(...)` callbacks are wired before `const map = new maplibregl.Map(...)`.
- Any eager callback path touching `map.*` before init can break map load.
- Safer approach:
  - Let the existing scheduled visual refresh path drive extrema updates after map init, or
  - Gate early refresh hooks behind a no-op ref that is assigned only after map/layers are ready.

Recommended re-implementation order for slice 2:
1. Implement POI store + map layer wiring per Section 16.
2. Confirm `instant-cli push` has been run in the target environment before UI debugging.
3. Verify no-stat markers with no category filter first.
4. Then verify category filtering and selected-stat hide/show transitions.
5. Only after stable behavior, add any optional debug instrumentation.

### 0.8 Slice 2 Completion Details (2026-02-20)

Implemented files:
- `src/state/pointsOfInterest.ts` (new):
  - Imperative subscription store for `pointsOfInterest` where `isActive=true`.
  - Normalizes and groups rows by boundary/category.
  - Includes `scopeKey` parsing for county-level scope filtering.
- `src/react/imperative/constants/map.ts`:
  - Added POI source and layer IDs for ZIP/COUNTY high+low symbol layers.
- `src/react/imperative/mapView.ts`:
  - Added POI source/layer creation and lifecycle wiring.
  - Added no-stat mode rendering path that uses POI rows.
  - Added category filtering via `selectedCategory`.
  - Added selected-stat override: when a stat is selected, POI layers are hidden and normal stat extrema behavior is used.
  - Added style-resilient source/layer ensure flow integration.

County/ZIP behavior now implemented:
- County/state view:
  - Only statewide county POIs render (`scopeKey === "oklahoma"`).
  - Tulsa/OKC county POI scopes are intentionally hidden to reduce clutter.
- ZIP/city view:
  - ZIP POIs remain visible at higher city zoom levels.
  - ZIP POIs are shown when zoom indicates ZIP context, including cases where boundary mode transitions lag.

Critical regression fixes applied:
- After ZCTA source sync, overlays are refreshed so POIs repopulate after chunk loads.
- ZIP POI centroid lookup uses live `getZctaCentroid(...)` values.
- Fixed zoom-out/zoom-in disappearance by:
  - Caching ZIP->chunk hints while chunks are loaded.
  - Re-ensuring POI ZIP chunks when centroids are missing, even if chunk key memo is unchanged.

Verification:
- `npm run build` passes after Slice 2 changes.

Notes for future devs:
- Active POI data currently exists for categories: `housing`, `education`, `economy`.
- If map category filter is set to another category, no POIs is expected.

### 0.9 Final First-Render Fix (2026-02-20)

Issue observed:
- POI extrema often did not appear on initial county/ZIP entry.
- They appeared only after an additional zoom/pan event.

Root cause:
- POI/extrema refresh work was still coupled to style-ready timing in a way that could skip the first boundary transition render pass.
- In logs, `boundary-mode-change` could fire without an immediate `extrema-refresh` on first ZIP entry, so POI source/layer state remained stale until a later camera event.

Fix that resolved it:
- Removed style-loaded gating from the POI/extrema refresh path so `updateStatExtremaArrows()` and follow-up visibility sync are allowed to run immediately during first transition.
- Kept immediate extrema refresh calls on mode/layer ensure paths so POI state is synchronized without waiting for another interaction.
- Retained repaint nudges and next-frame visibility reapply to avoid symbol-layer lag on first paint.

Post-fix logging cleanup:
- POI debug output was reduced to a minimal high-signal set:
  - `enabled`
  - `boundary-mode-change`
  - `extrema-refresh`
  - `poi-source-updated`
  - `poi-layers-updated`
  - `poi-zip-ensure-error`
- `window.__poiDebugSnapshot()` remains available for deep diagnostics.

Cleanup guidance:
- No further rollback is recommended right now.
- The retained safeguards (repaint nudges, next-frame visibility reapply, resilient refresh try/catch) are low-risk and help prevent similar first-frame regressions.
- If desired later, simplify incrementally behind verification, starting with optional repaint nudges (not core logic).

## 1. Objective
Implement a production-ready "Points of Interest" system for stat extrema so that:

1. Admin can toggle POI for a stat in the Admin stat editor.
2. When enabled, extrema are computed and stored for:
   1. All Oklahoma
   2. Tulsa Area
   3. Oklahoma City Area
3. Toggle OFF then ON recalculates.
4. When no stat is selected on the map, show active POIs for enabled stats.
5. If no stat is selected and a category is selected, POIs are filtered by stat category.

This doc is a full execution plan for another dev agent.

## 2. Original Planning Snapshot (Pre-Implementation Architecture)

Note:
- This section reflects the architecture at plan-writing time.
- For the latest implemented status, use Section 0 first.

### Schema + permissions
- `src/instant.schema.ts`: has `stats`, `statData`, `statDataSummaries`, `areas`; no POI namespace yet.
- `instant.perms.ts`: `stats`, `statData`, `statDataSummaries`, `areas` already configured; no POI rules yet.

### Admin stat editing
- `src/react/components/AdminScreen.tsx`: stat edit form already supports `goodIfUp`, visibility, featured flags.
- `handleSave` writes stat updates via `db.transact`.

### Map + extrema behavior today
- `src/react/imperative/mapView.ts`:
  - Already computes extrema for selected stat (`getExtremeAreaIds`).
  - Uses MapLibre symbol layers for extrema arrows (zip and county).
  - Hides extrema immediately when stat/boundary mode changes.
  - Has `selectedStatId` + `selectedCategory` handling and existing `setCategoryFilter`, `setSelectedStat`, `setBoundaryMode`.
- `src/react/imperative/constants/map.ts`: existing extrema layer IDs.

### React state wiring
- `src/react/ReactMapApp.tsx` passes `selectedStatId`, `categoryFilter`, `boundaryMode` into `MapLibreMap`.
- `src/react/components/MapLibreMap.tsx` forwards prop changes to imperative controller.
- `src/react/hooks/useStats.ts` handles visible stats and stat visibility logic.

### Area and scope metadata
- `src/react/hooks/useAreas.ts`: area records (ZIP/COUNTY), including `parentCode`, centroids, bounds.
- `scripts/admin/seedAreas.ts`: ZIP `parentCode` is county name (not county FIPS).
- `src/lib/scopeLabels.ts`: normalization and county alias helpers.

## 3. Recommended Solution (High Level)

Use a persisted InstantDB entity `pointsOfInterest` as the computed cache of extrema records.

Core behavior:
1. Admin toggles POI ON for a stat.
2. Recompute pipeline calculates extrema rows for that stat and writes/upserts `pointsOfInterest`.
3. Map uses `pointsOfInterest` only when `selectedStatId == null`.
4. Category chip filters POIs by stat category.
5. Boundary mode controls which POI boundary rows are rendered (ZIP vs COUNTY).

## 4. Data Model Changes

### 4.1 Extend `stats`
Add field:
- `pointsOfInterestEnabled: i.boolean().indexed().optional()`

Reason:
- Durable stat-level toggle.
- Indexed for admin and potential filtered queries.

### 4.2 New `pointsOfInterest` entity
Add entity in `src/instant.schema.ts`:

- `poiKey: string` unique indexed
- `statId: string` indexed
- `statCategory: string` indexed
- `statName: string` optional
- `boundaryType: string` indexed (`ZIP` | `COUNTY`)
- `scopeKey: string` indexed (`oklahoma` | `tulsa_area` | `okc_area`)
- `scopeLabel: string` optional
- `extremaKind: string` indexed (`high` | `low`)
- `areaCode: string` indexed
- `areaName: string` optional
- `value: number`
- `goodIfUp: boolean` optional
- `isActive: boolean` indexed
- `computedAt: number` indexed
- `sourceDate: string` optional
- `runId: string` indexed optional

`poiKey` recommendation:
- `${statId}::${scopeKey}::${boundaryType}::${extremaKind}`

Use `lookup("poiKey", poiKey)` for idempotent upsert.

### 4.3 Permission rules
Update `instant.perms.ts`:
- `pointsOfInterest.view = true`
- `create/update/delete = isAdmin`

This mirrors `statDataSummaries` pattern.

## 5. Scope Definitions (Oklahoma / Tulsa / OKC)

### 5.1 Canonical scope keys
- `oklahoma`
- `tulsa_area`
- `okc_area`

### 5.2 Region membership source
Use `areas` table + deterministic county lists:
- County area membership by county codes.
- ZIP membership by ZIP rows where `areas.kind == 'ZIP'` and ZIP `parentCode` county-name matches target counties.

### 5.3 County lists
Core counties:
- Tulsa County code: `40143`
- Oklahoma County code: `40109`

Neighbor counties from current zcta-neighbor model (`src/lib/zctaLoader.ts`, county IDs are 3-digit there):
- Tulsa neighbors: `037 Creek`, `111 Okmulgee`, `113 Osage`, `117 Pawnee`, `131 Rogers`, `145 Wagoner`, `147 Washington`
- Oklahoma neighbors: `017 Canadian`, `027 Cleveland`, `073 Kingfisher`, `081 Lincoln`, `083 Logan`, `125 Pottawatomie`

Important normalization note:
- `areas` county codes are 5-digit FIPS-like (`40143`), while zcta neighbor map uses 3-digit (`143`).
- Add conversion helper when/if using zcta neighbor utilities.

### 5.4 Recommendation
For v1, hardcode county-code lists in one shared module (explicit + stable), then optionally replace with dynamic neighbor derivation later.

## 6. Recompute Pipeline Design

## 6.1 Trigger semantics
- Toggle OFF:
  - set `stats.pointsOfInterestEnabled = false`
  - mark existing POI rows for that stat `isActive = false` (or delete)
- Toggle ON:
  - set `stats.pointsOfInterestEnabled = true`
  - recompute immediately for all 3 scopes + both boundaries
  - upsert rows and mark active

If user does OFF then ON, recompute naturally re-runs.

## 6.2 Compute algorithm (per stat)
Inputs:
- stat metadata (`goodIfUp`, `category`, visibility)
- areas metadata
- relevant stat maps (`statData` latest root rows by context)

Algorithm:
1. Build region membership sets:
   - `region.counties: Set<string>`
   - `region.zips: Set<string>`
2. Load latest usable stat maps for `statId` and boundary in (`ZIP`, `COUNTY`):
   - Prefer `statDataSummaries` -> then fetch matching `statData` rows for summary dates.
   - Include needed `parentArea` aliases (`Tulsa`, `Tulsa County`, etc.) via `normalizeScopeLabel` + county formatter.
3. Merge maps across matching parent areas (same pattern as map scope merging).
4. Filter merged map by region membership set.
5. Find extrema (high/low) with deterministic tie-break:
   - Tie-break on area code lexical asc.
6. Upsert two rows per boundary + scope (`high`, `low`).
7. Deactivate stale rows for that stat not in current run (`runId`).

Output count per stat:
- 3 scopes x 2 boundaries x 2 extrema = 12 rows max.

## 6.3 Suggested backend entrypoint
Add:
- `api/points-of-interest-recompute.ts`

Request:
- `POST { statId: string, force?: boolean }`

Response:
- `ok`, `rowsUpserted`, `rowsDeactivated`, `runId`, timing summary.

## 6.4 Admin/security note
Current admin API patterns in this repo are not strongly authenticated by default. For this endpoint, add explicit auth gating (recommended), otherwise endpoint is abusable.

Minimum recommended:
- Verify caller is authenticated admin before compute.
- Do not trust client-provided email/role claims alone.

If robust auth is not feasible immediately, ship behind strict feature flag and internal environment only.

## 7. Admin UI Implementation Plan

Files:
- `src/react/components/AdminScreen.tsx`
- `src/types/stat.ts`

Changes:
1. Extend stat interfaces with `pointsOfInterestEnabled?: boolean | null`.
2. Edit form:
   - add checkbox/toggle `Points of Interest`.
   - add helper text: "Stores high/low map points for Oklahoma, Tulsa Area, OKC Area."
3. Save flow (`handleSave`):
   - persist toggle to `stats`.
   - on toggle ON transition, call recompute endpoint.
   - on toggle OFF transition, call deactivate endpoint or inline cleanup.
4. Show inline status:
   - idle / recalculating / last computed timestamp / error.
5. Optional: add explicit "Recalculate now" button to avoid requiring OFF->ON for manual refresh.

## 8. Map Integration Plan (No Selected Stat Mode)

## 8.1 Data source for POIs
Add imperative store:
- `src/state/pointsOfInterest.ts`

Pattern should mirror existing `statsStore`/`statDataStore`:
- `subscribe(listener)`
- query `pointsOfInterest where isActive=true`
- expose map grouped by `boundaryType`, `category`, etc.

## 8.2 Rendering behavior
In `src/react/imperative/mapView.ts`:

1. Add POI layer/source set (symbol layers, MapLibre-native; avoid DOM markers).
2. When `selectedStatId != null`:
   - keep current selected-stat extrema behavior only.
3. When `selectedStatId == null`:
   - render POI markers from `pointsOfInterest`.
   - apply boundary mode filter:
     - ZIP mode => only ZIP POIs (and hide at `CHOROPLETH_HIDE_ZOOM` same as current behavior)
     - COUNTY mode => only COUNTY POIs
   - apply category filter:
     - if `selectedCategory` set, keep only rows where `statCategory` matches.
4. Keep immediate hide behavior during transitions:
   - boundary mode switch
   - category change
   - stat selection change
   Then re-show after next POI render pass.

## 8.3 Marker color semantics (for POIs)
Reuse existing semantics:
- `goodIfUp == true`: high=green, low=red
- `goodIfUp == false`: high=red, low=green
- `goodIfUp unset`: both yellow (`#f8d837`)

Orientation:
- high marker up, low marker down.

## 8.4 Overlap/clutter handling
Potentially many rows overlap at same centroid (same area can be extreme for multiple stats/scopes). Decide now:

V1 recommendation:
- show all markers, allow overlap (`icon-allow-overlap` true), no labels.
- add hover tooltip in follow-up if needed.

## 9. Query/Performance Considerations

1. Indexes are mandatory for frequent filters:
   - `statId`, `isActive`, `boundaryType`, `scopeKey`, `statCategory`, `computedAt`.
2. Use summary-first strategy (`statDataSummaries`) to avoid full `statData` scans.
3. Chunk admin writes (`db.transact`) to keep request within limits.
4. Compute only one stat per toggle action to keep endpoint latency predictable.

## 10. Edge Cases and Rules

1. Missing data for a scope/boundary:
   - do not write row for missing extrema.
   - deactivate existing row for that key.
2. Equal high/low (single value or flat map):
   - write only one row (high), skip low or store low as inactive.
3. Stat visibility:
   - only compute/show for map-visible stats (public/effective visibility), unless admin-only mode is intentionally desired.
4. Category changes:
   - POI filter should key off stat category, not area category.
5. Stale rows:
   - always deactivate stale rows on each recompute run.

## 11. Implementation Sequence (Suggested)

1. Schema + perms
   - add `stats.pointsOfInterestEnabled`
   - add `pointsOfInterest` entity
   - update `instant.perms.ts`
2. Backend recompute endpoint
   - build compute module + endpoint + auth check
   - add local script for backfill/recompute-all
3. Admin UI
   - toggle + save wiring + status UI
4. Map POI data store
   - add `pointsOfInterest` store subscription
5. Map rendering
   - add POI layers and mode/category filtering
   - integrate with existing extrema hide/show lifecycle
6. QA and polish
   - manual matrix below

## 12. Testing Matrix

## 12.1 Admin
1. Toggle ON for stat with goodIfUp true -> rows created.
2. Toggle OFF -> rows inactive.
3. Toggle ON again -> rows recomputed with new `computedAt`.

## 12.2 Map behavior
1. No selected stat + no category -> all active POIs show.
2. No selected stat + category selected -> POIs filtered by category.
3. Select a stat -> POI markers hide immediately; selected-stat extrema behavior works.
4. Clear stat -> POI markers return.
5. Switch ZIP/COUNTY modes -> markers hide immediately then show filtered boundary rows.
6. ZIP zoom past hide threshold -> ZIP POIs hide.

## 12.3 Correctness
1. Verify Tulsa area extrema only use Tulsa+neighbors membership.
2. Verify OKC area extrema only use Oklahoma County+neighbors membership.
3. Verify neutral yellow markers for stats without goodIfUp.
4. Verify low markers are down-facing.

## 13. Rollout Strategy

1. Ship backend + schema first with feature flag (UI toggle hidden).
2. Backfill POIs for currently-enabled stats.
3. Enable Admin toggle for internal users.
4. Enable map no-stat POI rendering.
5. Monitor query latency and marker count density.

## 14. Concrete File Touch List

Expected files:
- `src/instant.schema.ts`
- `instant.perms.ts`
- `src/types/stat.ts`
- `src/react/components/AdminScreen.tsx`
- `api/points-of-interest-recompute.ts` (new)
- `src/state/pointsOfInterest.ts` (new)
- `src/react/imperative/constants/map.ts`
- `src/react/imperative/mapView.ts`
- optional helper modules under `src/lib/` or `src/react/lib/`
- optional backfill script:
  - `scripts/admin/backfillPointsOfInterest.ts`

## 15. Open Decisions To Confirm Before Coding

1. Region definition source:
   - explicit hardcoded county lists (recommended v1) vs dynamic adjacency computation.
2. Stale row policy:
   - soft deactivate (`isActive=false`) vs hard delete.
3. Auth hardening level for recompute endpoint.
4. Whether to add a dedicated "Recalculate now" button in Admin.
5. Whether to display tooltip/metadata for overlapping POI markers in v1.

## 16. Next Slice Handoff (Map Integration)

Goal:
- Implement no-selected-stat POI rendering in MapLibre with category and boundary filtering.

Do next:
1. Add `src/state/pointsOfInterest.ts` (imperative store like `statsStore`).
   - Subscribe to `pointsOfInterest` where `isActive=true`.
   - Normalize rows for fast access by boundary/category.
2. Add POI layer IDs/constants in `src/react/imperative/constants/map.ts`.
3. In `src/react/imperative/mapView.ts`:
   - Add POI symbol layers (ZIP and COUNTY, high and low).
   - Reuse existing triangle icons + color semantics.
   - If `selectedStatId != null`: keep existing selected-stat extrema behavior only.
   - If `selectedStatId == null`: render POI rows.
   - Apply `selectedCategory` filter on `statCategory`.
   - Apply `boundaryMode` filter (`ZIP` vs `COUNTY`).
   - Keep immediate hide behavior on transitions (stat/category/boundary), then re-render.
   - Apply ZIP hide threshold (`CHOROPLETH_HIDE_ZOOM`) consistent with current zip extrema behavior.
4. Ensure style swap resilience:
   - On `setStyle()` re-add POI sources/layers in existing ensure flow.
5. QA matrix for slice 2:
   - no-stat + no-category -> all active POIs.
   - no-stat + category -> filtered POIs.
   - select stat -> POI hides, selected-stat extrema shows.
   - clear stat -> POI returns.
   - boundary switch and ZIP high zoom behavior correct.

Recommended stop point after slice 2:
- Pause for user UI verification before tooltip/clutter follow-ups.
