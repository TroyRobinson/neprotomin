# Troubleshooting: Synthetic Data Override Issue

## Problem

You imported real data from Neighborhood Explorer, but:
1. ❌ The data appears to be random/synthetic values
2. ❌ A 2025 year appears (which doesn't exist in NE yet)
3. ❌ Real data seems to be overridden by synthetic seed data

## Root Cause

**Old synthetic seed data exists in your database from before the guards were added.**

When you first ran the app in development mode (before the refactoring), the app automatically created:
- **Synthetic stats** (without `neId` field)
- **Synthetic statData** for years 2023, 2024, 2025
- Random values for demonstration purposes

Even though we added guards to prevent NEW synthetic seeding when real data exists, the OLD synthetic data is still in your database.

## The Fix

**Step 1: Preview what will be deleted**
```bash
npm run ne:clean:synthetic:dry
```

This shows you:
- How many synthetic stats exist (stats without `neId`)
- How many synthetic statData entries exist
- A table of what will be deleted

**Step 2: Delete the synthetic data**
```bash
npm run ne:clean:synthetic
```

This will:
- ✅ Delete all stats WITHOUT `neId` (synthetic)
- ✅ Delete all statData associated with those stats
- ✅ Preserve all real data (stats WITH `neId`)

**Step 3: Refresh your app**
```bash
# Stop the dev server (Ctrl+C)
# Start it again
npm run dev
```

**Step 4: Verify**
Open your app and check:
- ✅ Only real stats appear in the selector
- ✅ No 2025 data (unless NE actually has it)
- ✅ Data values match what you expect from NE

## Understanding the Cleanup Script

The cleanup script (`scripts/ne-clean-synthetic.js`) is **safe** because:

1. **It only deletes stats without `neId`**
   - Real NE imports always have `neId` (the NE hash ID)
   - Synthetic seed data never has `neId`
   - Therefore, it can safely distinguish between them

2. **It preserves all real data**
   - Any stat with `neId` is kept
   - All statData for real stats is kept

3. **It has a dry-run mode**
   - You can preview what will be deleted before committing

## Why This Happened

### Timeline of Events

1. **Before refactoring:**
   - You ran `npm run dev`
   - App detected no data in database
   - Synthetic seeding ran automatically
   - Created demo stats and data for 2023, 2024, 2025

2. **After refactoring (with guards added):**
   - You ran the ETL import: `npm run ne:geo:series:staging -- --stat=wOGzD8ZD`
   - Real stat was created WITH `neId`
   - Real statData was created for 2020-2024 (or whatever years exist in NE)

3. **Current state:**
   - Database has BOTH synthetic AND real data
   - Guards prevent NEW synthetic seeding
   - But OLD synthetic data remains

4. **What you see in the UI:**
   - Both synthetic and real stats appear
   - If you select a synthetic stat, you see random data + 2025
   - If you select the real stat, you might see mixed data

## Prevention (For the Future)

The guards we added will prevent this from happening again:

### In `src/lib/seed.ts`:
```typescript
// Skip synthetic seeding unless in dev mode or explicitly enabled
if (!import.meta.env.DEV && !import.meta.env.VITE_ENABLE_SYNTHETIC_SEED) {
  return;
}

// Safety check: if any stats have neId, skip synthetic seeding entirely
const hasRealData = (data.stats ?? []).some((s: any) => s?.neId);
if (hasRealData) {
  console.log('[seed] Real NE data detected (stats with neId); skipping synthetic seed');
  return;
}
```

**This means:**
- ✅ In production: synthetic seeding is disabled (unless explicitly enabled)
- ✅ In dev: if ANY real stat exists (with `neId`), synthetic seeding is skipped
- ✅ Synthetic data will never overwrite real data going forward

## Frequently Asked Questions

### Q: Will I lose any real data if I run the cleanup?
**A: No.** The cleanup only deletes stats without `neId`. All real NE imports have `neId`, so they're preserved.

### Q: What if I accidentally run it twice?
**A: It's safe.** After the first run, there's no synthetic data left, so the second run does nothing.

### Q: Can I keep some synthetic data for testing?
**A: Not recommended.** It will confuse the UI and mix with real data. Better to:
1. Clean all synthetic data
2. Import real data as needed
3. Use dry-run imports for testing

### Q: What if I want synthetic data in production?
**A: Set an environment variable:**
```bash
VITE_ENABLE_SYNTHETIC_SEED=1
```
But this is NOT recommended for production. Use real data imports instead.

### Q: How do I prevent this in a fresh setup?
**A: Import real data FIRST:**
```bash
# Fresh database - import real data immediately
npm run ne:bulk:zip:import:staging -- --limit=10 --years=3

# Then start dev server
npm run dev
```

The guards will detect real data and skip synthetic seeding.

## Manual Cleanup (Alternative)

If you prefer to manually inspect and delete via InstantDB dashboard:

1. Go to your InstantDB dashboard
2. Query `stats` entity
3. Filter for records where `neId` is `null` or missing
4. Delete those records
5. Query `statData` entity
6. Filter for records where `statId` matches deleted stat IDs
7. Delete those records

The script automates this process for you.

## Verification Steps

After cleanup, verify everything is clean:

```bash
# Check how many stats have neId
# (All remaining stats should have neId)
# You can verify this in your InstantDB dashboard

# Or run the dry-run again to confirm nothing left to clean
npm run ne:clean:synthetic:dry
# Should show: "Found 0 synthetic stats"
```

## Related Documentation

- **ETL User Guide**: `ETL_USER_GUIDE.md` - Complete guide to importing data
- **ETL Technical Docs**: `ETL_terminal_tools.md` - Implementation details
- **Schema**: `src/instant.schema.ts` - Database structure

## Need More Help?

If the cleanup doesn't resolve your issue:

1. **Check browser console** for errors
2. **Check InstantDB dashboard** to verify data state
3. **Run with DEBUG**: `DEBUG=1 npm run ne:clean:synthetic`
4. **Share the output** from the dry-run for further diagnosis

---

**Bottom line:** Run `npm run ne:clean:synthetic` to remove old synthetic data and start fresh with real NE imports only. ✨
