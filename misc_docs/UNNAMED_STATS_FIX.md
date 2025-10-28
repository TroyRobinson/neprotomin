# Fix for Unnamed Stats Issue

## The Problem

Stats were appearing in your database with placeholder names like:
- "Stat eRGj2qGP"
- "Stat gDZxaV9J"
- "Stat OQGN6lGE"

Instead of proper titles like:
- "Housing: Density"
- "Crime: Exposure Rate"
- "Median Income"

Also, most stats had no `category` field populated.

## Root Cause

The ETL script was trying to fetch stat names from the **paginated** `/api/statistic_map_points/` endpoint, which only returns the first page of results. If your stat wasn't on page 1, the script couldn't find the name and used a placeholder.

## The Fixes

### 1. **Better Name Resolution** (Automatic)

The scripts now use a 3-tier name resolution strategy:

**For Bulk Imports:**
1. `ne-bulk-zip-import.js` searches up to 10 pages of `/api/statistic_map_points/` to find stat names
2. It passes the discovered name to child processes via `--name=` argument
3. Child processes (`ne-geo-series.js`) use the provided name directly (most reliable!)

**For Single-Stat Imports:**
1. **First tries** `--name=` flag if provided (from bulk script or manual)
2. **Then tries** `/api/statistics/{id}/` endpoint (gets name directly for that stat)
3. **Fallback to** `/api/statistic_map_points/` if detail endpoint fails
4. Uses placeholder only as last resort

This means **new imports will get proper names** automatically, especially when using bulk import!

### 2. **Skip Unnamed Flag** (Optional)

Add `--skip-unnamed=1` to skip stats without proper names:

```bash
# Single stat import - skip if no name
npm run ne:geo:series:staging -- --stat=<HASH> --skip-unnamed=1

# Bulk import - only import stats with proper names
npm run ne:bulk:zip:import:staging -- --limit=50 --skip-unnamed=1
```

**When to use:**
- ✅ Bulk imports (highly recommended!)
- ✅ When you only want clean, properly-named data
- ❌ When you specifically need a stat regardless of name

### 3. **Cleanup Script** (Clean Existing Data)

Remove stats that already have placeholder names:

```bash
# Preview what would be deleted
npm run ne:clean:unnamed:dry

# Actually delete them
npm run ne:clean:unnamed
```

**What it deletes:**
- All stats where `name` starts with "Stat "
- All statData associated with those stats
- Preserves stats with proper names

## Recommended Workflow

### For Clean Imports (Going Forward)

**Always use `--skip-unnamed=1` for bulk imports:**

```bash
npm run ne:bulk:zip:import:staging -- --limit=100 --years=3 --skip-unnamed=1
```

This prevents unnamed stats from being imported in the first place!

### For Existing Data (One-Time Cleanup)

**Step 1: Preview the damage**
```bash
npm run ne:clean:unnamed:dry
```

Look at how many unnamed stats you have.

**Step 2: Delete them**
```bash
npm run ne:clean:unnamed
```

**Step 3: Re-import with proper names**
```bash
npm run ne:bulk:zip:import:staging -- --limit=100 --years=3 --skip-unnamed=1
```

The scripts will now fetch proper names via the detail endpoint!

## Why This Happened

### Before the Fix:
```javascript
// Old approach - only checked page 1 of results
const pts = await getJson('/api/statistic_map_points/?geometry=zip');
const hit = pts.results.features.find(f => f.id === statId); // Might not find it!
const statName = hit?.properties?.name || `Stat ${statId}`; // Placeholder if not found
```

### After the Fix:
```javascript
// New approach - 3-tier resolution
// 1. Bulk script searches 10 pages, finds name
// 2. Passes name to child via --name=
if (args.name && !args.name.startsWith('Stat ')) {
  statName = args.name; // Use the name we already found!
} else {
  // 3. Try direct lookup if no name provided
  const detail = await getJson(`/api/statistics/${statId}/`);
  const statName = detail.name || `Stat ${statId}`;
}

// Plus the --skip-unnamed flag:
if (SKIP_UNNAMED && statName.startsWith('Stat ')) {
  console.warn('Skipping unnamed stat');
  exit(0); // Don't import it!
}
```

## Statistics

Looking at your screenshot, you had:
- **~25 total stats** in database
- **~15-20 unnamed** ("Stat ..." placeholders)
- **~5-10 properly named** (actual titles)

After cleanup + re-import with `--skip-unnamed=1`:
- ✅ Only stats with proper names
- ✅ No placeholder entries
- ✅ Categories populated (when available from NE)

## FAQ

### Q: Will I lose data if I delete unnamed stats?
**A:** You'll lose those specific stats and their data. BUT they had placeholder names anyway, so you probably don't want them. You can re-import the same stats with proper names afterward.

### Q: Why not just update the names instead of deleting?
**A:** The stat name is the primary identifier. If we couldn't get the name during import, we don't know what the stat actually is. Better to delete and re-import with proper metadata.

### Q: What if NE truly doesn't have a name for a stat?
**A:** Very rare. The `/api/statistics/{id}/` endpoint should always have a name if the stat exists. If both endpoints fail, the stat might be deleted/archived in NE.

### Q: Should I use `--skip-unnamed=1` for all imports?
**A:** **Yes for bulk imports**, optional for single-stat imports (where you know the stat ID and want it regardless).

### Q: What about stats imported before this fix?
**A:** They might have placeholder names. Use `npm run ne:clean:unnamed` to remove them, then re-import.

## Commands Quick Reference

```bash
# Clean up existing unnamed stats
npm run ne:clean:unnamed:dry  # Preview
npm run ne:clean:unnamed      # Delete

# Import with skip-unnamed (recommended)
npm run ne:bulk:zip:import:staging -- --limit=100 --skip-unnamed=1

# Single stat (will try harder to get name, warn if fails)
npm run ne:geo:series:staging -- --stat=<HASH> --skip-unnamed=1
```

## Technical Details

### What Changed in the Code

**File:** `scripts/ne-geo-series.js`

1. Added `getStatisticDetail()` function
2. Added `SKIP_UNNAMED` flag support
3. **Added `--name=` flag support** (accepts pre-resolved name from parent process)
4. Changed name resolution order:
   - **Try `--name=` flag first (from bulk script)**
   - Try detail endpoint → fallback to points → placeholder
5. Exit with warning if `--skip-unnamed=1` and no name found

**File:** `scripts/ne-bulk-zip-import.js`

1. Added `SKIP_UNNAMED` flag support
2. Filter unnamed stats from bulk list before importing
3. **Pass discovered stat name to child processes via `--name=` argument**
4. Pass flag through to child processes

**New File:** `scripts/ne-clean-unnamed.js`

1. Finds stats with names starting with "Stat "
2. Deletes them and their statData
3. Dry-run support

---

**Bottom line:** The fix is in place. New imports will get proper names. Use `npm run ne:clean:unnamed` to clean up old data, then re-import with `--skip-unnamed=1` for best results! ✨
