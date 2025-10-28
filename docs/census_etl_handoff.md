# Census ETL Living Handoff

> Status: in progress  
> Last updated: 2025-10-28

## Conversation & Decisions
- **Goal**: replace/augment the current Neighborhood Explorer (NE) ETL with a US Census (ACS) based pipeline targeting Oklahoma counties and ZCTAs.
- **Current app expectations**:
  - InstantDB `stats` and `statData` drive choropleths / charts, scoped by parent area labels (e.g. “Oklahoma”).
  - React hooks aggregate scoped blobs (see `useDemographics.ts`, `useStats.ts`).
  - ZIP/County geometries already bundled in `src/data` and `src/data/zcta`.
- **New metadata**:
  - `source` field on both `stats` and `statData` (string; get/set “Census”, “NE”, etc.).
  - Convenience alias `statNameHint` on `statData` (mirrors canonical `stats.name` but treated as secondary).
  - ACS-specific fields: `censusVariable` (e.g. `B22003_001E`), `censusSurvey` (e.g. `acs5`), optional `marginOfError`.
  - Additional optional metadata: `censusUniverse` text and `censusTableUrl` for UI tooltips/documentation.
- **Categories & years**:
  - All Census SNAP stats land in InstantDB category `health`.
  - StatData `date` reflects the ACS release year (calendar year encoded by the ACS dataset).
- **Legacy data**: backfill `source`/`statNameHint`/etc. for NE records only if effort is small; otherwise defer.

## Work Completed
- Created this living handoff document to capture decisions and open questions.
- Added schema fields for `source`, `statNameHint`, and Census metadata (variable, survey, universe, table URL, MOE).
- Added Census ETL tooling (`censusUtils`, probe/preview/load scripts + npm hooks).
- Updated ETL user guide with new environment variables, schema notes, and Census command docs.
- Implemented InstantDB batching in the Census loader so ZIP/County payloads upsert without timeout, and loaded B22003 (2021‑2023) successfully.
- Normalized `parentArea` labels when writing Census ZIP/COUNTY blobs so React scopes (map + StatViz) resolve series correctly.
- Backfilled duplicate B22003 stats from earlier runs and reran the loader to ensure a clean dataset.
- Added admin reset script (`npm run admin:reset`) with dry-run/force modes to wipe Census or NE datasets safely.
- Census loader now emits friendly stat names, writes full statewide + county ZIP buckets, and creates a derived percentage stat (`Households Receiving SNAP (Percent)`).
- Shared `scopeLabels` helper across ETL + React map so county-level ZIP scopes line up (“Tulsa County” etc.), restoring Tulsa ZIP StatViz + header behaviour.
- Added legacy alias matching so existing NE stats keyed to “Tulsa”/“Rogers” still hydrate scope-aware UI copy after standardising on “<County> County”.
- Census loader now renames ACS tables to friendly stats (`Population`, `Median Age`) and synthesises `Married Percent` while treating intermediate B12001 columns as derived-only so they don’t clutter the picker.

## Next Steps (Owner: current dev unless reassigned)
1. **Schema follow-up**
   - Ensure indexes/queries remain valid after new fields; document `statNameHint` expectations.
   - Scope effort for backfilling `source`/`statNameHint` on legacy NE rows.
2. **Census data run**
   - Execute `npm run census:preview` / `census:load:dry` to validate payloads with a real API key.
   - When ready, run `census:load` for B22003 (last 3 releases) and spot-check InstantDB.
3. **UI verification**
   - Confirm new stats appear in the app (map overlays, time series, demographics rollups).
   - After series generation lands (see follow-up tasks), verify ZIP-level StatViz plots render.
   - Capture any UI copy/tooltips needed for `source`, `censusUniverse`, etc.
4. **Legacy cleanup**
   - Backfill `source`/`statNameHint` on NE-imported records or log a follow-up task if deferred.
5. **Documentation refresh**
   - Update this handoff after the first production census load (notes on timing, issues, fixes).
6. **Admin reset tooling**
   - Build `scripts/admin/resetData.ts` supporting tiers (`--census`, `--ne`, `--all`, `--dry-run`, `--force`), with interactive confirmation defaulting to cancel.
   - Document usage and reseed workflow (`npm run seed`, ETL reruns) in `ETL_USER_GUIDE.md`.
7. **Series + derived stats**
   - Extend Census loader to synthesize yearly `series` rows (ZIP + COUNTY) alongside `statData`. (Pending.)
   - Derived percentage stat (`Households Receiving SNAP (Percent)`) now persists for each year; counts remain in `health`. Confirm UI consumption once series rows are generated.
   - Optionally aggregate ZIP totals to counties if the Census API ever omits county rows (guardrail).

## Open Questions / Watch Items
- Scope of NE backfill (needs an explicit call once effort understood).
- Rate limiting & attribution requirements for future Census tables (may require key management).
- Additional ACS metadata (MOE storage format, column selection) once more tables added.
- Generate InstantDB `series` rows alongside `statData` so StatViz time-lines plot more than the latest snapshot.
- Admin reset script design + documentation outstanding.
- Keep `src/lib/scopeLabels.ts` as the single source of truth for scope formatting; update dependents there when adding new geographies.
- Generate `series` rows for newly added Census demographics so StatViz + default trend cards can plot multi-year population/age/married bars by scope.

## Point of Contact
- Primary dev: _fill in when assigned_
- Product/Data stakeholders: _add as needed_

---

## Issue: Tulsa ZIP StatViz mismatch *(Resolved 2025-10-29)*

### Symptoms
- Tulsa ZIP selections showed empty StatViz charts and the sidebar header only displayed “ZIP Overview”.
- Other counties (e.g. Oklahoma County) continued to render data correctly.

### Root Cause
- The Census loader now writes ZIP `statData` grouped under normalized county scopes such as “Tulsa County”.
- Map state was still emitting “Tulsa” (no suffix) for the active ZIP scope because the manifest provides bare county names. After normalization the strings no longer matched, so StatViz lookups returned empty results and the header fell back to the generic label.

### Fix
- Introduced `src/lib/scopeLabels.ts` with `normalizeScopeLabel`/`formatCountyScopeLabel`.
- Updated the Census ETL, React hooks, map view, and state store to consume the shared helpers so both back-end imports and front-end scope logic generate identical county labels.
- Added `buildScopeLabelAliases` so legacy NE stats stored as “Tulsa” / “Rogers” continue to match the new “Tulsa County” scope strings until we re-run those loaders.

### Verification
- Tulsa ZIP selections now populate StatViz (counts + derived percent) and the sidebar headline reads “Tulsa ZIP Overview” / “Tulsa County ZIP Overview” as expected.
- Non-Tulsa counties and statewide fallbacks still resolve correctly because the helper only appends “County” when a county ID is present.

### Follow-up
- Continue with the planned `series` row generation so time-series charts plot yearly points rather than just the latest snapshot.
- When adding new geographies, extend `scopeLabels` instead of copying normalization code.

### SNAP Stat Strategy
- **Counts**: `B22003_002E` (“Households Receiving SNAP”) and companion metrics live in the `health` category with friendly labels.
- **Derived percentage**: Loader emits `Households Receiving SNAP (Percent)` using `B22003_002E / B22003_001E` per geography/year.
- **Series generation (pending)**: still need to synthesize yearly `series` rows (ZIP + COUNTY) so charts plot multi-year trends.
- **County aggregation safety net**: if a future ACS pull lacks county rows, aggregate ZIP totals before persisting derived stats to maintain parity across boundary modes.
