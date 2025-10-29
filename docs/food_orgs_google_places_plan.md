# Google Places Food Organizations Plan

## Background
- The current `organizations` entity in InstantDB stores `name`, `url`, `latitude`, `longitude`, and a required `category` (mapped through `Category` union and `CATEGORIES` UI definitions). All seeded orgs live in `src/data/organizations.ts` and are synthetic.
- React and imperative map layers consume organizations through `useOrganizations()` / `organizationStore`, expecting the above fields and ordering by `name`.
- No ETL exists today for organizations. Other ingest flows (Neighborhood Explorer stats) live under `scripts/` and use InstantDB's admin SDK with idempotent writes.
- Goal: ingest real food-assistance organizations from Google Places, categorize them under a new `food` category, and capture richer contact metadata for map display and reporting.

## Insights from `google_places_API_considerations.md`
Helpful:
- Batched `places:searchText` with `locationBias` per city ensures relevant results and avoids global noise.
- Deduplication by `place_id`, field masks, and client-side caching keep requests and billing manageable.
- Logging empty responses highlights geographic gaps that can guide supplemental sourcing.

Gaps / Naïveté:
- Limiting searches to ~25 cities misses rural Oklahoma; we need a statewide tiling strategy.
- Reliance on localStorage caches and client-side fetching is unsuitable for our server-side ETL; we should persist raw responses and audit logs instead.
- Marker-only usage skipped data normalization (address parts, hours format, phone validation) that we must handle for InstantDB storage.
- No plan for refresh cadence, quota monitoring, or reconciliation with manually curated orgs.

## Schema Updates Needed
- Extend `Category` union and `CATEGORIES` array to include `"food" | "Food"`.
- Add fields to `organizations` entity (InstantDB schema + `Organization` type):
  - `placeId` (string, unique, indexed) for dedupe/idempotency.
  - `source` (string, indexed, default `"google_places"`).
  - `address` (string) for formatted full address.
  - `city` / `state` / `postalCode` (strings, indexed where used for filtering/grouping).
  - `website` (string, optional) — replaces current required `url`.
  - `phone` (string, optional).
  - `hours` (json) storing normalized weekly schedule, including unverified periods when returned.
  - `googleCategory` (string, indexed) capturing Google primary/most-specific type.
  - `keywordFound` (string, optional) to record the first matching search phrase.
  - `status` (string, indexed) with enum such as `"active" | "moved" | "closed"` to drive map visibility.
  - `lastSyncedAt` (number, indexed) for freshness tracking.
  - `raw` (json, optional) to preserve source metadata (types, attributes, movedPlace info, etc.) for debugging.
- Update seed routines, hooks, and map controllers to accept optional fields gracefully.

## Google Places Ingestion Strategy
1. **Discovery (Search)**
   - Use Places API (New) `places:searchText` with a curated keyword set focused on community food support (e.g., `"food bank"`, `"food pantry"`, `"community food bank"`, `"church food pantry"`, `"food distribution center"`, `"soup kitchen"`).
   - Supplement with `places:searchNearby` for niche lookups if we spot county gaps.
   - Configure result limits (20 per call) and paginate until exhaustion. Record request metadata (center, phrase, page) to ensure deterministic reruns.
   - Maintain an on-disk cache (JSON) keyed by (searchType, lat, lon, radius, keyword) to support dry runs and replay while respecting quota.
   - Bound searches per county with `--bounds=minLat,minLng,maxLat,maxLng` so we can QA region-by-region before scaling.
   - Auto-seed discovery with manual include Place IDs (e.g., Beaver Street Baptist, Victory Christian) so critical orgs persist even if Google reclassifies them.
   - Apply type/name allowlists (food bank, non-profit, religious center, etc.) and deny lists (restaurant, hospital, meal prep, retail). Positive name heuristics rescue legit pantries when Google returns generic `food` types.

2. **Enrichment (Details)**
   - For each unique `place_id`, call `places:lookup` (or `placeDetails` for legacy) requesting `displayName`, `formattedAddress`, `addressComponents`, `nationalPhoneNumber`, `internationalPhoneNumber`, `websiteUri`, `regularOpeningHours`, `types`, `businessStatus`, and `location` (lat/lng).
   - Throttle to stay within 5 qps baseline; batch requests with exponential backoff on `RESOURCE_EXHAUSTED`.
   - Normalize:
     - Prefer `regularOpeningHours.periods` → convert to per-day schedule.
     - Derive `city`, `state`, `postalCode` from address components.
     - Validate coordinates fall within Oklahoma; discard or flag otherwise.
     - Capture `primaryType` or best matching type as `googleCategory`.
     - Detect `movedPlaceId` or `businessStatus` values indicating closures/relocations; store in `status` and `raw`.

3. **Transform**
   - Map all qualifying entries to our canonical shape:
     - `category = "food"`.
     - `website` fallback to empty string when absent; `phone` to E.164 if possible.
     - Set `hours` JSON to `{ periods: [...], weekdayText: [...], status: "unverified" | "verified" }` for easy rendering.
     - Capture the initial search phrase as `keywordFound`.
    - Add `sourceTags` (keywords/types that surfaced the place) in `raw` for auditing, plus `filterDecision` metadata (include/exclude reason, matched types).
   - Apply filters:
     - Exclude closed (`businessStatus === "CLOSED_PERMANENTLY"`) or generic grocery-only hits unless flagged as assistance.
     - Exclude organizations whose services are clearly tied to federal SNAP administration rather than direct community food aid.
     - Drop commercial venues by deny-type/keyword lists (`restaurant`, `hospital`, `meal prep`, etc.) unless a manual allow rule overrides.

4. **Load (ETL)**
   - Write scripts under `scripts/google-places/` following existing ETL conventions:
      1. `collect-food-places.ts` — discovery + enrichment, outputs `tmp/food_places_{timestamp}.json`.
      2. `preview-food-orgs.ts` — summarize counts/coverage, list new vs existing InstantDB records (dry run).
      3. `load-food-orgs.ts` — upsert into InstantDB using admin SDK:
        - Lookup by `placeId` first, fallback to `(normalizedName, city)` for legacy/manual entries.
        - Update changed fields, set `lastSyncedAt = Date.now()`, `googleCategory`, and `keywordFound` on first discovery.
        - Set `status = "moved"` when `movedPlaceId` is supplied, and `status = "closed"` for `CLOSED_PERMANENTLY` or `OUT_OF_BUSINESS` results; flag these so the map layer hides them while list views can optionally show with a badge.
        - Maintain an `active` boolean derived from `status === "active"` to simplify map filtering.
    - Ensure scripts are idempotent, support `--since` / `--dry-run` args, and write audit logs.

5. **Scheduling & Monitoring**
   - Store API keys in environment (`GOOGLE_PLACES_API_KEY`). Allow configurable quotas (max requests per run) to avoid overruns.
   - Track metrics: total fetched, new, updated, filtered out. Persist a summary markdown/csv in `docs/data-audits/`.
   - Plan for monthly refresh cadence with optional manual trigger.

## Script Usage
- `tsx scripts/google-places/collect-food-places.ts [--keywords=...] [--radius=40000] [--step=0.6] [--out=tmp/food_places_*.json]`
  - Produces normalized JSON with hours, status, keywords, and raw Google payload; respects local cache unless `--no-cache`/`--cache=refresh`.
  - Optional `--bounds=minLat,minLng,maxLat,maxLng` keeps search centers (and final data) inside a geographic box (used for county-by-county imports).
- `tsx scripts/google-places/preview-food-orgs.ts [--file=tmp/food_places_*.json]`
  - Summarizes totals by status/city/keyword before loading.
- `tsx scripts/google-places/load-food-orgs.ts [--file=...] [--dry=1]`
  - Upserts into InstantDB (category fixed to `"food"`, status tags propagate to UI). Use `--dry=1` for a no-write verification pass.
- `tsx scripts/google-places/run-counties.ts`
  - Drives county-by-county collection → preview → load, using dynamic bounds/radius heuristics and manual include fallback for high-priority food banks.

## Implementation Plan
1. **Preparation**
   - Obtain/confirm Google Places quota and add `.env` entries.
   - Define search keyword list, grid resolution, and radius constants in a shared config module.
2. **Schema Migration (InstantDB + Types)**
   - Update Instant schema, regenerate types if needed, adjust `Organization` model and UI consumers for optional fields.
   - Backfill existing records with placeholder data (`source = "seed"`, `lastSyncedAt = Date.now()`).
3. **ETL Scripts**
   - ✅ `scripts/google-places/collect-food-places.ts` orchestrates statewide keyword search + detail enrichment, persists normalized JSON in `tmp/`.
   - ✅ `scripts/google-places/preview-food-orgs.ts` surfaces status/city/keyword counts for a collected dataset.
   - ✅ `scripts/google-places/load-food-orgs.ts` upserts normalized payloads into InstantDB via admin SDK (`--dry=1` supported).
   - Add documentation to `ETL_USER_GUIDE.md` referencing new commands.
4. **QA & Launch**
   - Run dry-run to inspect sample output.
   - Load into staging InstantDB, verify UI renders, map chip includes Food, and filters behave.
   - Establish monitoring (log stash or simple JSON summary) and document retry process.

## Status Tracking
- **Completed**:
  - Reviewed codebase organization model; analyzed existing Google Places prototype notes; drafted ingestion & schema strategy.
  - Applied InstantDB schema + React UI updates (new fields surface once Google data is loaded; seed orgs still show legacy shape).
  - Added Google Places ETL toolchain (`collect`, `preview`, `load`) with allow/deny filtering, manual include rules, SNAP exclusion, moved/closed status handling, geographic bounds filter, and UI side-panel hours accordion.
  - Imported first Tulsa County tranche (106 orgs) via refined `--bounds` workflow; sample set (20) used for smoke testing.
- **Upcoming**:
  1. Document new scripts in `ETL_USER_GUIDE.md` and add runbooks for cache refresh + retry procedures.
  2. Roll county-by-county imports using refined filters (collect → preview → load) and log exclusion breakdowns for audit.
  3. QA food org visibility post-import (map pins, sidebar badges, report counts) and adjust filtering thresholds if needed.
  4. Decide on retention/merging strategy for legacy seed orgs vs. Google-derived listings.
- **Open Questions**:
  - Should we preserve historical manual organizations or replace entirely? Need merge rules.
  - Do we require multi-category support (e.g., org spans food + health)? If so, schema needs relational mapping.
  - Required refresh frequency and alerting; align with ops.
