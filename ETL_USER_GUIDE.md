# ETL User Guide: Importing Neighborhood Explorer Data

A comprehensive guide for importing statistics from Neighborhood Explorer (NE) into your InstantDB-powered application.

## Table of Contents

- [Quick Start](#quick-start)
- [Prerequisites](#prerequisites)
- [Understanding the Data Flow](#understanding-the-data-flow)
- [Available Commands](#available-commands)
- [Testing with a Single Stat](#testing-with-a-single-stat)
- [Bulk Importing Many Stats](#bulk-importing-many-stats)
- [Migration and Maintenance](#migration-and-maintenance)
- [FAQ](#faq)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)

---

## Quick Start

**First-time setup:**
```bash
# 1. Ensure Node 20+ is installed
node --version  # Should be 20.x or higher

# 2. Install dependencies (if not already done)
npm install

# 3. Create .env file with required credentials
cp .env.example .env  # Then edit with your tokens

# 4. Test the connection
npm run ne:probe:staging

# 5. Preview some data
npm run ne:etl:preview:staging
```

**Quick import of 10 recent stats:**
```bash
npm run ne:bulk:zip:import:staging -- --limit=10 --years=3
```

---

## Prerequisites

### Required Software
- **Node.js 20+** (uses native fetch)
- **npm** (comes with Node)
- A terminal/command line

### Required Environment Variables

Create a `.env` file in the project root with:

```bash
# Required: InstantDB credentials
VITE_INSTANT_APP_ID=your_app_id_here
INSTANT_APP_ADMIN_TOKEN=your_admin_token_here

# Optional: Neighborhood Explorer API token
NE_TOKEN=your_ne_token_here
# Alternative token name (fallback)
VITE_NE_API_TOKEN=your_ne_token_here

# Optional: Override API base URL
# NE_BASE=https://neighborhood-explorer-staging.herokuapp.com

# Optional: Census Bureau API key (strongly recommended for production)
# Request one: https://api.census.gov/data/key_signup.html
CENSUS_API_KEY=your_census_api_key_here

# Optional: Admin reset helper config (none required; script uses Instant credentials)
# Provided for clarity – see "Resetting data" section below.
```

**Where to find these:**
- **InstantDB credentials**: Your InstantDB dashboard → Settings
- **NE_TOKEN**: Neighborhood Explorer admin → API Keys
- **NE_BASE**: Use staging (default) for testing; production for live data

### Understanding the Environments

| Environment | Base URL | Use Case |
|-------------|----------|----------|
| **Staging** (default) | `https://neighborhood-explorer-staging.herokuapp.com` | Testing, development, most reliable JSON endpoints |
| **Production** | `https://www.neighborhoodexplorer.org` | Live data (may have limited API access) |

All `:staging` npm scripts automatically use the staging environment.

---

## Understanding the Data Flow

### The Big Picture

```
Neighborhood Explorer API
         ↓
   [ETL Scripts]
         ↓
    InstantDB
         ↓
   Your React App
```

### Data Structure

**Neighborhood Explorer provides:**
- **Statistics**: Named metrics (e.g., "Median Income", "Crime Rate")
- **Areas**: Geographic regions (ZIP codes, Census tracts, counties)
- **Values**: Numbers for each stat/area/date combination

**Your InstantDB stores:**

1. **stats** entity:
   - `name`: "Median Income"
   - `category`: "economy"
   - `neId`: Original NE hash ID (unique)
   - `goodIfUp`: Boolean (true = higher is better)
   - `source`: "NE" | "Census" (helps track provenance)
   - `createdOn`, `lastUpdated`: Timestamps

2. **statData** entity:
   - `statId`: Links to stats
   - `statTitle`: Human-readable stat name (denormalized)
   - `name`: "root" (for main data) or "ethnicity:white" (for breakdowns)
   - `area`: "Tulsa"
   - `boundaryType`: "ZIP"
   - `date`: "2024"
   - `type`: "percent" | "currency" | "count" | "rate" | "years"
   - `data`: `{ "74133": 65420, "74114": 58900, ... }`
   - `source`: matches the upstream (`NE`, `Census`, etc.)
   - `statNameHint`: mirror of `stats.name` for quick lookup (secondary convenience)
   - `censusVariable`, `censusSurvey`: metadata for ACS imports (e.g., `B22003_001E`, `acs5`)
   - `censusUniverse`: population universe string when provided by the Census API
   - `censusTableUrl`: link to the Census table documentation page
   - `marginOfError`: optional map mirroring `data` for ACS margin-of-error values
   - `createdOn`, `lastUpdated`: Timestamps

### Idempotency (No Duplicates!)

All ETL scripts are **idempotent** — you can run them multiple times safely:

- **stats**: Looked up by `neId` first, then by `name`
  - Updates `category`, `goodIfUp`, `lastUpdated` if changed
  - Never creates duplicates

- **statData**: Looked up by composite key:
  - `(statId, name, area, boundaryType, date)`
  - Merges `data` maps (ZIP → value) on re-run
  - Updates `statTitle`, `lastUpdated`
  - Never creates duplicates

**This means:** Running an import twice won't double your data — it will only update what changed.

---

## Available Commands

### Discovery Commands

#### Probe the API
```bash
# Test staging API connection
npm run ne:probe:staging

# Test production API connection
npm run ne:probe:prod
```
**What it does:** Verifies API connectivity and shows available endpoints.

#### Preview Data (No Database Writes)
```bash
# Preview 10 Tulsa ZIP stats from staging
npm run ne:etl:preview:staging

# Preview with debug output (see all HTTP requests)
npm run ne:etl:preview:staging:debug

# Preview with custom limit
npm run ne:etl:preview:staging -- --limit=20

# Preview custom date range
npm run ne:etl:preview:staging -- --start=2020-01-01 --end=2024-12-31
```
**What it does:** Fetches data from NE and shows how it will be transformed, without writing to your database.

### Data Import Commands

#### Load Previewed Stats
```bash
# Dry run (shows what would be written)
npm run ne:etl:load:staging:dry

# Actually write to database
npm run ne:etl:load:staging

# Load from production
npm run ne:etl:load:prod

# Load custom number of stats
npm run ne:etl:load:staging -- --limit=20
```
**What it does:** Takes the preview data and writes it to InstantDB. Default: 10 unique stats.

#### Import Full Series for One Stat
```bash
# Dry run: preview all years for a specific stat
npm run ne:geo:series:staging:dry -- --stat=wOGzD8ZD --geometry=zip --start=2020-01-01 --end=2024-12-31

# Actually import
npm run ne:geo:series:staging -- --stat=wOGzD8ZD --geometry=zip --start=2020-01-01 --end=2024-12-31

# Import with more concurrency (faster)
npm run ne:geo:series:staging -- --stat=wOGzD8ZD --geometry=zip --concurrency=20

# Strict mode (skip years without ZIP data)
npm run ne:geo:series:staging -- --stat=wOGzD8ZD --geometry=zip --strict=1

# Skip stats without proper names (avoids "Stat eRGj2qGP" placeholders)
npm run ne:geo:series:staging -- --stat=wOGzD8ZD --geometry=zip --skip-unnamed=1
```
**What it does:** Imports all available years of data for a single statistic.

**Flags:**
- `--stat=<HASH>`: NE stat ID (find in URL on NE website)
- `--geometry=zip|tract|county`: Geographic boundary type
- `--start=YYYY-MM-DD`: Start date filter
- `--end=YYYY-MM-DD`: End date filter
- `--strict=1`: Skip years with no data for requested geometry
- `--skip-unnamed=1`: Skip stats without proper names (exits with warning if no name found)
- `--concurrency=N`: Number of parallel API requests (default: 10)

#### Bulk Import Many Stats
```bash
# Dry run: preview what would be imported
npm run ne:bulk:zip:import:staging:dry -- --limit=10 --years=3

# Import 10 most recent stats, last 3 years each
npm run ne:bulk:zip:import:staging -- --limit=10 --years=3

# Import 50 stats, last 5 years
npm run ne:bulk:zip:import:staging -- --limit=50 --years=5

# Skip stats without proper names (recommended!)
npm run ne:bulk:zip:import:staging -- --limit=50 --years=3 --skip-unnamed=1
```
**What it does:**
1. Finds the N most recently-updated stats with ZIP data
2. For each stat, imports the last K years of ZIP-level data
3. Orchestrates multiple `ne:geo:series` runs

**Flags:**
- `--limit=N`: Number of stats to import
- `--years=N`: How many years of history per stat
- `--skip-unnamed=1`: Skip stats without proper names (highly recommended to avoid "Stat eRGj2qGP" entries)

### Validation Commands

#### Inspect ZIP Values
```bash
# Show all ZIP codes and values for a stat on a specific date
npm run ne:zip:values:staging -- --stat=wOGzD8ZD --date=2024-01-01

# Compare production vs staging
npm run ne:zip:values:prod -- --stat=wOGzD8ZD --date=2024-01-01
```
**What it does:** Prints a table of ZIP code → value mappings. Useful for validating imports.

### Maintenance Commands

#### Migrate Existing Data
```bash
# Dry run: preview what would be updated
npm run ne:migrate:timestamps:dry

# Backfill timestamps and statTitle for all existing records
npm run ne:migrate:timestamps
```
**What it does:** Adds `createdOn`, `lastUpdated`, and `statTitle` fields to records that don't have them yet. **Run this once after upgrading to the new schema.**

#### Clean Up Problem Data

**Remove synthetic/demo data:**
```bash
# Dry run: preview what would be deleted
npm run ne:clean:synthetic:dry

# Actually delete synthetic data
npm run ne:clean:synthetic
```
**What it does:** Removes stats without `neId` (old synthetic seed data). See [TROUBLESHOOTING_SYNTHETIC_DATA.md](./TROUBLESHOOTING_SYNTHETIC_DATA.md) for details.

**Remove stats with placeholder names:**
```bash
# Dry run: preview unnamed stats
npm run ne:clean:unnamed:dry

# Delete stats with names like "Stat eRGj2qGP"
npm run ne:clean:unnamed
```
**What it does:** Removes stats that have placeholder names (e.g., "Stat eRGj2qGP") because the real name couldn't be fetched from NE API. These stats typically have no `category` either.

**Why do unnamed stats exist?**
- The NE API endpoint we query is paginated
- If a stat isn't on page 1 of results, we can't find its name
- The script now tries the `/api/statistics/{id}/` detail endpoint first (more reliable)
- Use `--skip-unnamed=1` flag when importing to automatically skip stats without proper names

### Resetting Data (Admin-only)

Use the reset helper when you need to wipe existing stats/statData before rerunning seeds or ETL scripts.

```bash
# Preview deletions without making changes
npm run admin:reset -- --scope=census --dry-run

# Delete Census-derived stats/statData (interactive confirmation)
npm run admin:reset -- --scope=census

# Delete NE-derived stats/statData
npm run admin:reset -- --scope=ne

# Full reset (all stats/statData) with explicit confirmation flag
npm run admin:reset -- --scope=all --force
```

**Notes:**
- Scopes: `census`, `ne`, or `all`. Default is `census`.
- `--dry-run` logs counts only; nothing is removed.
- Without `--force`, the script prompts for confirmation.
- After a reset, rerun seeds and imports:
  ```bash
  npm run seed
  # re-run NE ETL scripts as needed
  # re-run Census imports, e.g.:
  npm run census:load -- --year=2023 --years=3 --group=B22003 --includeMoe=1
  ```

### Census Commands

#### Probe Census connectivity
```bash
# Confirm credentials and metadata access (defaults to B22003, current ACS release)
npm run census:probe -- --year=2023 --group=B22003
```
**What it does:** Fetches group metadata plus a tiny sample of ZIP and county rows to ensure the Census API key works.

#### Preview Census data (no writes)
```bash
# Inspect the first 5 variables for the latest B22003 release
npm run census:preview -- --year=2023 --group=B22003 --limit=5 --includeMoe=1

# Preview a specific variable list
npm run census:preview -- --year=2023 --group=B22003 --variables=B22003_001E,B22003_002E
```
**What it does:** Downloads the requested ACS group, filters to Oklahoma ZIPs/counties, and prints summary counts plus sample values. No database writes.

#### Load Census data into InstantDB
```bash
# Dry run: show planned imports (no writes)
npm run census:load:dry -- --year=2023 --years=3 --group=B22003 --includeMoe=1

# Write the last three releases of B22003 into InstantDB (ZIP + county)
npm run census:load -- --year=2023 --years=3 --group=B22003 --includeMoe=1

# Load a single variable for one release
npm run census:load -- --year=2023 --group=B22003 --variables=B22003_001E
```
**What it does:**
1. Pulls ACS estimates (and optional margin-of-error columns) for every Oklahoma ZCTA and county.
2. Groups ZIP data by statewide scope plus per-county buckets.
3. Upserts stats (`source="Census"`, `neId="census:<variable>"`) and statData blobs with Census metadata fields populated.
4. Derives a percentage stat (`Households Receiving SNAP (Percent)`) using `B22003_002E / B22003_001E` for each geography and year.

**Common flags:**
- `--year=<YYYY>`: ACS release year to import.
- `--years=<N>`: Import a descending range (e.g., `--years=3` loads year, year-1, year-2).
- `--group=<Bxxxxx>`: ACS table/group identifier.
- `--variables=<comma list>`: Optional subset; defaults to all estimate columns (`*_E`).
- `--includeMoe=1`: Fetch and store matching `*_M` margin-of-error columns.
- `--dry=1`: Skip InstantDB writes.

> Tip: supply `CENSUS_API_KEY` to avoid the anonymous-rate-limit (keyless clients are capped at 500 requests/day).

---

## Testing with a Single Stat

**Recommended workflow when importing data for the first time:**

### Step 1: Pick a Test Stat

1. Go to the Neighborhood Explorer website (staging or production)
2. Browse to a statistic you want to test
3. Copy the hash ID from the URL

Example URL: `https://neighborhood-explorer-staging.herokuapp.com/map/wOGzD8ZD`
→ Hash ID: `wOGzD8ZD`

### Step 2: Verify the Data Exists

```bash
npm run ne:zip:values:staging -- --stat=wOGzD8ZD --date=2024-01-01
```

**Expected output:** A table showing ZIP codes and values.

**If empty:** Try a different date or check if the stat has ZIP-level data (some stats only have tract/county data).

### Step 3: Preview the Import (Dry Run)

```bash
npm run ne:geo:series:staging:dry -- \
  --stat=wOGzD8ZD \
  --geometry=zip \
  --start=2020-01-01 \
  --end=2024-12-31 \
  --strict=1
```

**Look for:**
- `Stat: wOGzD8ZD | requested geometry: zip`
- `Preview <StatName> 2024 (ZIP): 42 areas` (repeated for each year)
- `Summary: processed 5 year(s) for stat <StatName>`

### Step 4: Import the Data

Remove `:dry` from the command:

```bash
npm run ne:geo:series:staging -- \
  --stat=wOGzD8ZD \
  --geometry=zip \
  --start=2020-01-01 \
  --end=2024-12-31 \
  --strict=1
```

**Expected output:**
- `Upserted <StatName> 2024 (ZIP): 42 areas` (for each year)
- `Summary: processed 5 year(s)...`

### Step 5: Verify in Your App

1. Open your React app
2. The new stat should appear in your stats selector
3. Select it and verify the map shows data
4. Check that the sidebar shows the time series (multiple years)

### Step 6: Validate in Database (Optional)

If you have InstantDB dashboard access:

1. Go to your app's data explorer
2. Query `stats` → find your newly imported stat
3. Query `statData` → filter by `statId` → verify years and ZIP data

### Troubleshooting a Failed Import

**If no data appears:**
```bash
# Check if the stat was created
# (Look for your stat name in the output)
npm run ne:etl:preview:staging -- --limit=50 | grep "Housing"

# Try without --strict to see if data exists for other geometries
npm run ne:geo:series:staging:dry -- --stat=wOGzD8ZD --geometry=zip

# Check different date range
npm run ne:zip:values:staging -- --stat=wOGzD8ZD --date=2023-01-01
```

**If import succeeded but UI doesn't show it:**
- Check browser console for errors
- Verify synthetic seeding isn't overwriting it (it shouldn't if real `neId` exists)
- Try refreshing the page (data subscriptions should auto-update)

---

## Bulk Importing Many Stats

**Use this when you want to populate your database with lots of data quickly.**

### Understanding Bulk Import

The bulk import script:
1. Queries NE for all stats with ZIP-level data
2. Ranks them by "most recently updated" (using latest measurement date)
3. Takes the top N stats
4. For each stat, runs `ne:geo:series` to import the last K years

**Why "most recent"?** New and actively-maintained stats are more likely to have clean, complete data.

### Basic Bulk Import

```bash
# Import 10 stats, 3 years each (dry run)
npm run ne:bulk:zip:import:staging:dry -- --limit=10 --years=3
```

**Review the output:**
- Table showing which stats will be imported
- For each stat: expected year range

**If it looks good:**
```bash
# Actually import
npm run ne:bulk:zip:import:staging -- --limit=10 --years=3
```

### Scaling Up

**Small dataset (testing):**
```bash
npm run ne:bulk:zip:import:staging -- --limit=10 --years=2
```
- ~10-20 API requests
- ~1-2 minutes

[note: Selecting top 10 stats by latest ZIP measurement date]

**Medium dataset (typical use):**
```bash
npm run ne:bulk:zip:import:staging -- --limit=50 --years=3
```
- ~150+ API requests
- ~5-10 minutes

**Large dataset (full import):**
```bash
npm run ne:bulk:zip:import:staging -- --limit=200 --years=5
```
- ~1000+ API requests
- ~30-60 minutes
- **Recommended:** Run in a tmux/screen session in case of disconnection

### Monitoring Progress

The script outputs progress for each stat:
```
--- Importing ZIP series for <HASH> (window ending 2024-05-01) ---
Stat: <HASH> | requested geometry: zip
Window: 2020-01-01 → 2024-12-31
...
Upserted Housing: Density 2024 (ZIP): 42 areas
Upserted Housing: Density 2023 (ZIP): 42 areas
...
Summary: processed 5 year(s) for stat Housing: Density
```

### Resuming After Failure

**If the import fails partway through:**

The bulk script doesn't checkpoint, so you'll need to:

**Option 1: Run the remaining stats manually**
```bash
# Note which stats succeeded (check the output)
# Then import the remaining ones individually
npm run ne:geo:series:staging -- --stat=<HASH> --geometry=zip --years=3
```

**Option 2: Re-run the bulk import**
```bash
# Thanks to idempotency, this is safe!
# Already-imported stats will just update their lastUpdated timestamp
npm run ne:bulk:zip:import:staging -- --limit=50 --years=3
```

### Performance Tuning

**Increase concurrency** (if your network can handle it):
```bash
# Default concurrency is 10
# You can increase it by modifying the bulk script to pass --concurrency
# Or import stats individually with higher concurrency:
npm run ne:geo:series:staging -- --stat=<HASH> --concurrency=20
```

**Reduce years** (if you only need recent data):
```bash
# Just last year
npm run ne:bulk:zip:import:staging -- --limit=50 --years=1
```

---

## Migration and Maintenance

### One-Time Migration (After Schema Update)

**When to run:** After deploying the new schema with timestamps and statTitle.

```bash
# Preview what will be updated
npm run ne:migrate:timestamps:dry

# Actually update
npm run ne:migrate:timestamps
```

**What it does:**
- Adds `createdOn` and `lastUpdated` to all stats and statData records
- Adds `statTitle` to all statData records (copies from associated stat)
- Uses current timestamp for initial values

**Safe to re-run?** Yes! It only updates records missing the fields.

### Incremental Updates

**Scenario:** You imported data last month, now you want the latest data.

**Solution:** Just re-run the same import!

```bash
# Re-run bulk import with same parameters
npm run ne:bulk:zip:import:staging -- --limit=50 --years=3
```

**What happens:**
- Scripts check NE for latest data
- For each stat/year:
  - If data changed: updates the `data` map and `lastUpdated`
  - If data unchanged: skips (or only updates `lastUpdated`)
- New stats will be created
- Deleted stats remain in your DB (no automatic deletion)

### Cleaning Up Old Data

**The ETL scripts never delete data.** If you need to remove stats/statData:

**Option 1: InstantDB Dashboard**
- Go to your app's data explorer
- Filter and manually delete records

**Option 2: Admin Script** (you'd need to write this)
```javascript
// Example: Delete all data for a specific stat
import { init, tx } from '@instantdb/admin';
const db = init({ appId, adminToken });

const statId = 'stat-uuid-here';
const rows = await db.query({ statData: { $: { where: { statId } } } });
const deletes = rows.data.statData.map(row => tx.statData[row.id].delete());
await db.transact(deletes);
```

---

## FAQ

### General Questions

**Q: Can I import from production NE?**
A: Yes! Use `:prod` variants of commands (e.g., `npm run ne:etl:load:prod`). However, production may have more restrictive API access. Staging is recommended for bulk imports.

**Q: Will running imports in development mode conflict with synthetic seed data?**
A: No! The synthetic seeding now checks for real data (any stat with `neId`). If it finds real imports, it skips synthetic seeding automatically.

**Q: How do I know if data is synthetic vs. real?**
A: Real data has a `neId` field (NE hash). Synthetic data does not.

**Q: Can I import Census tract or county-level data?**
A: Yes! Change `--geometry=tract` or `--geometry=county` in the series import commands.

**Q: What if a stat has ZIP data in 2024 but only tract data in 2023?**
A: With `--strict=1`, the script will skip 2023. Without it, the script imports whatever geometry is available (might mix geometries, which could be confusing in your UI).

### Performance Questions

**Q: How long does a bulk import take?**
A: Depends on:
- Number of stats (--limit)
- Number of years (--years)
- Network speed
- Concurrency setting

Rule of thumb: ~10-30 seconds per stat-year.

**Q: Can I speed up imports?**
A: Yes! Increase `--concurrency` (default: 10):
```bash
# Per-stat series import
npm run ne:geo:series:staging -- --stat=<HASH> --concurrency=20
```

**Q: Will bulk imports overwhelm the NE API?**
A: The concurrency pool prevents hammering. Default settings (10 concurrent) are conservative. If you get rate-limited, reduce concurrency.

### Data Questions

**Q: Why are some ZIPs missing values?**
A: NE may not have data for all ZIPs in all years. This is expected. The map will show "no data" for those ZIPs.

**Q: Can I import demographic breakdowns (ethnicity, income, education)?**
A: Not automatically yet. The synthetic seeding creates these, but real NE import doesn't fetch breakdowns. You'd need to enhance the scripts to query sub-statistics.

**Q: What's the difference between `name` and `statTitle` in statData?**
A:
- `name`: Usually "root" (main data) or breakdown keys like "ethnicity:white"
- `statTitle`: Human-readable stat name, e.g., "Median Income"

**Q: Why do timestamps show the import time, not the data measurement time?**
A: `createdOn`/`lastUpdated` track when the record was created/modified in *your* database, not when NE measured the data. The measurement date is in the `date` field.

### Troubleshooting Questions

**Q: Import succeeded but I don't see data in my app?**
A: Check:
1. Browser console for errors
2. Network tab for failed InstantDB queries
3. InstantDB dashboard to verify data exists
4. That you're querying the right `boundaryType` ("ZIP" not "zip")

**Q: Getting "Missing INSTANT_APP_ADMIN_TOKEN" error?**
A: Add it to your `.env` file. This is sensitive — never commit it to git!

**Q: Getting HTTP 404 or 406 errors from NE?**
A: Try staging (`npm run <command>:staging`). Production endpoints may differ.

**Q: Script hangs or times out?**
A:
- Check your internet connection
- Reduce `--concurrency`
- Try a smaller `--limit` or `--years`

**Q: How do I see more debug info?**
A: Add `DEBUG=1` or use `:debug` variants:
```bash
DEBUG=1 npm run ne:geo:series:staging -- --stat=<HASH>
```

---

## Troubleshooting

### Common Errors and Solutions

#### Error: `Missing VITE_INSTANT_APP_ID`
**Cause:** `.env` file missing or not loaded.

**Solution:**
```bash
# 1. Ensure .env exists in project root
ls -la .env

# 2. Add the required variable
echo "VITE_INSTANT_APP_ID=your_app_id" >> .env

# 3. Restart your terminal/reload .env
```

#### Error: `HTTP 401` or `HTTP 403`
**Cause:** Invalid or missing NE API token.

**Solution:**
```bash
# Add to .env
echo "NE_TOKEN=your_token_here" >> .env
```

#### Error: `No features returned that match Tulsa ZIP`
**Cause:** Query returned no data for the date range.

**Solution:**
- Try a different date range (`--start`, `--end`)
- Check the NE website to confirm data exists
- Try removing Tulsa bbox filter (edit script to skip `inTulsaBbox` check)

#### Warning: `No 'zip' entries found for year YYYY; skipping due to --strict`
**Cause:** Stat has no ZIP data for that year.

**Solution:**
- Remove `--strict=1` to import whatever geometry exists
- Or accept that some years will be skipped

#### Import succeeded but UI shows old data
**Cause:** Frontend cache or subscription not updating.

**Solution:**
- Hard refresh browser (Cmd+Shift+R / Ctrl+Shift+F5)
- Check browser console for InstantDB connection errors
- Verify data in InstantDB dashboard

#### Script crashes with "Out of Memory"
**Cause:** Importing too much data at once.

**Solution:**
- Reduce `--limit` (fewer stats)
- Reduce `--years` (less history)
- Import in smaller batches

### Debug Mode

**Enable verbose logging:**
```bash
DEBUG=1 npm run ne:geo:series:staging -- --stat=<HASH>
```

**What it shows:**
- Every HTTP request URL
- API response summaries
- Cache hits/misses (for area lookups)

### Getting Help

**Check the logs:**
- Scripts output progress and errors to console
- Look for `Error:` or `Warning:` messages

**Verify data at each step:**
1. `ne:zip:values` → Raw NE data
2. `ne:geo:series:dry` → Transformed preview
3. InstantDB dashboard → Stored data
4. Your app's UI → Rendered data

**Still stuck?** File an issue with:
- Full error message
- Command you ran
- Stat hash (if applicable)
- Environment (staging vs prod)

---

## Best Practices

### Before You Start

1. **Test with staging first** — production API may behave differently
2. **Start small** — import 5-10 stats before attempting bulk imports
3. **Validate one stat end-to-end** — from API → DB → UI
4. **Backup your database** — though idempotency makes this less critical

### During Import

1. **Use dry runs** — always preview before writing
2. **Monitor progress** — watch for errors or warnings
3. **Use --strict for ZIP imports** — avoids mixed geometries
4. **Tune concurrency** — start at 10, increase if stable

### After Import

1. **Verify in UI** — check that stats appear and render correctly
2. **Check edge cases** — ZIPs with no data, outlier values
3. **Document what you imported** — stat hashes, date ranges
4. **Set up incremental updates** — weekly/monthly re-imports

### Production Checklist

Before importing to production database:

- [ ] Tested imports on staging database
- [ ] Verified data accuracy for 3-5 sample stats
- [ ] Confirmed UI renders correctly
- [ ] Tested performance with expected data volume
- [ ] Backed up production database (if critical)
- [ ] Scheduled import during low-traffic time
- [ ] Prepared rollback plan (if necessary)

### Incremental Update Strategy

**Recommended approach:**

```bash
# Weekly: Update top 50 stats with last year of data
npm run ne:bulk:zip:import:staging -- --limit=50 --years=1

# Monthly: Full refresh of top 100 stats, 3 years
npm run ne:bulk:zip:import:staging -- --limit=100 --years=3

# Quarterly: Deep refresh of 200+ stats, 5 years
npm run ne:bulk:zip:import:staging -- --limit=200 --years=5
```

**Why?** NE data updates over time. Regular refreshes keep your app current.

---

## Quick Reference

### Most Common Commands

```bash
# Preview 10 stats (no DB writes)
npm run ne:etl:preview:staging

# Import those 10 stats
npm run ne:etl:load:staging

# Bulk import 50 stats, 3 years each
npm run ne:bulk:zip:import:staging -- --limit=50 --years=3

# Import one stat's full series
npm run ne:geo:series:staging -- --stat=<HASH> --geometry=zip --start=2020-01-01 --end=2024-12-31

# Validate a stat's data
npm run ne:zip:values:staging -- --stat=<HASH> --date=2024-01-01

# Migrate existing data (one-time)
npm run ne:migrate:timestamps
```

### Essential Flags

| Flag | Values | Purpose |
|------|--------|---------|
| `--limit=N` | Number | How many stats to import |
| `--years=N` | Number | Years of history per stat |
| `--stat=<HASH>` | String | Specific stat ID from NE |
| `--geometry=<TYPE>` | zip/tract/county | Boundary type |
| `--start=<DATE>` | YYYY-MM-DD | Start of date range |
| `--end=<DATE>` | YYYY-MM-DD | End of date range |
| `--strict=1` | 1 or omit | Skip years without requested geometry |
| `--concurrency=N` | Number (default: 10) | Parallel API requests |
| `--dry=1` | 1 or omit | Preview mode (no DB writes) |
| `--debug=1` | 1 or omit | Verbose logging |

---

## Need More Help?

- **Technical Documentation**: See `ETL_terminal_tools.md` for implementation details
- **Schema Reference**: See `src/instant.schema.ts` for data structure
- **Code**: See `scripts/` directory for script source code
- **Tests**: Run `npm test` to see unit tests for transform functions

---

**Happy importing!** 🚀
