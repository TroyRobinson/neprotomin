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
  - `phone` (string, optional).
  - `hours` (json) storing normalized weekly schedule (e.g., array of `{ day, open, close, isOvernight }`).
  - `website` (string, optional) — replace current required `url` or make `url` optional alias.
  - `lastSyncedAt` (number, indexed) for freshness tracking.
  - `raw` (json, optional) to preserve source metadata (types, attribution, etc.) for debugging.
- Update seed routines, hooks, and map controllers to accept optional fields gracefully.

## Google Places Ingestion Strategy
1. **Discovery (Search)**
   - Use Places API (New) `places:searchText` with targeted phrases (`"food bank"`, `"food pantry"`, `"hunger relief"`, etc.) and enforce `locationBias` circles centered on a statewide H3 grid (e.g., resolution 6) to cover all of Oklahoma, including rural regions.
   - Supplement with `places:searchNearby` for specific Place Types (`FOOD_BANK`, `MEAL_DELIVERY`, `MEAL_TAKEAWAY`, `MEAL_PREP`, `NON_PROFIT`) where text search underperforms.
   - Configure result limits (20 per call) and paginate until exhaustion. Record request metadata (center, phrase, page) to ensure deterministic reruns.
   - Maintain an on-disk cache (JSON) keyed by (searchType, lat, lon, radius, keyword) to support dry runs and replay while respecting quota.

2. **Enrichment (Details)**
   - For each unique `place_id`, call `places:lookup` (or `placeDetails` for legacy) requesting `displayName`, `formattedAddress`, `addressComponents`, `nationalPhoneNumber`, `internationalPhoneNumber`, `websiteUri`, `regularOpeningHours`, `types`, `businessStatus`, and `location` (lat/lng).
   - Throttle to stay within 5 qps baseline; batch requests with exponential backoff on `RESOURCE_EXHAUSTED`.
   - Normalize:
     - Prefer `regularOpeningHours.periods` → convert to per-day schedule.
     - Derive `city`, `state`, `postalCode` from address components.
     - Validate coordinates fall within Oklahoma; discard or flag otherwise.

3. **Transform**
   - Map all qualifying entries to our canonical shape:
     - `category = "food"`.
     - `website` fallback to empty string when absent; `phone` to E.164 if possible.
     - Set `hours` JSON to `{ periods: [...], weekday_text: [...] }` for easy rendering.
     - Add `sourceTags` (keywords/types that surfaced the place) in `raw` for auditing.
   - Apply filters:
     - Exclude closed (`businessStatus === "CLOSED_PERMANENTLY"`) or generic grocery-only hits unless flagged as assistance.
     - Optional manual inclusion allow-list for known pantries missing from Google (future enhancement).

4. **Load (ETL)**
   - Write scripts under `scripts/google-places/` following existing ETL conventions:
     1. `collect-food-places.ts` — discovery + enrichment, outputs `tmp/food_places_{timestamp}.json`.
     2. `preview-food-orgs.ts` — summarize counts/coverage, list new vs existing InstantDB records (dry run).
     3. `load-food-orgs.ts` — upsert into InstantDB using admin SDK:
        - Lookup by `placeId` first, fallback to `(normalizedName, city)` for legacy/manual entries.
        - Update changed fields, set `lastSyncedAt = Date.now()`.
        - Deactivate (set `isActive = false` or add `inactiveReason`) for orgs no longer returned (requires new field if we choose to track this).
   - Ensure scripts are idempotent, support `--since` / `--dry-run` args, and write audit logs.

5. **Scheduling & Monitoring**
   - Store API keys in environment (`GOOGLE_PLACES_API_KEY`). Allow configurable quotas (max requests per run) to avoid overruns.
   - Track metrics: total fetched, new, updated, filtered out. Persist a summary markdown/csv in `docs/data-audits/`.
   - Plan for monthly refresh cadence with optional manual trigger.

## Implementation Plan
1. **Preparation**
   - Obtain/confirm Google Places quota and add `.env` entries.
   - Define search keyword list, grid resolution, and radius constants in a shared config module.
2. **Schema Migration (InstantDB + Types)**
   - Update Instant schema, regenerate types if needed, adjust `Organization` model and UI consumers for optional fields.
   - Backfill existing records with placeholder data (`source = "seed"`, `lastSyncedAt = Date.now()`).
3. **ETL Scripts**
   - Implement collectors and loaders per strategy, with unit tests around normalization helpers (hours parsing, address formatting).
   - Add documentation to `ETL_USER_GUIDE.md` referencing new commands.
4. **QA & Launch**
   - Run dry-run to inspect sample output.
   - Load into staging InstantDB, verify UI renders, map chip includes Food, and filters behave.
   - Establish monitoring (log stash or simple JSON summary) and document retry process.

## Status Tracking
- **Completed**: Reviewed codebase organization model; analyzed existing Google Places prototype notes; drafted ingestion & schema strategy.
- **Upcoming**:
  1. Align on schema changes and optional/deprecation strategy for `url` → `website`.
  2. Implement InstantDB schema migration + type updates.
  3. Build Google Places ETL collectors, detail enrichment, and loader scripts.
  4. Run initial statewide import and QA results.
- **Open Questions**:
  - Should we preserve historical manual organizations or replace entirely? Need merge rules.
  - Do we require multi-category support (e.g., org spans food + health)? If so, schema needs relational mapping.
  - Preferred representation for hours (structured vs formatted strings) for UI components.
  - Required refresh frequency and alerting; align with ops.
