// Performance comparison test: NE API vs InstantDB
// Tests the speed of loading 10 stats details + full ZIP values for one stat
// from both data sources
//
// Usage:
//   npm run ne:speed:test:staging
//   npm run ne:speed:test:prod
//   node scripts/ne-speed-test.js --limit=10 --stat=wOGzD8ZD

import 'dotenv/config';
import { init as initAdmin } from '@instantdb/admin';
import {
  parseArgs,
  isDebug,
  getNeBase,
  urlWithQuery,
  getJson,
  inTulsaBbox,
  initInstantAdmin,
} from './_shared/etlUtils.js';

const args = parseArgs();

const base = args.base || getNeBase();
const limit = Number(args.limit || 10);
const testStatId = args.stat; // Optional: specific stat to test ZIP values
const DEBUG = isDebug(args);

const db = initInstantAdmin(initAdmin);

// ============================================================================
// Utility: High-resolution timer
// ============================================================================

function startTimer() {
  return process.hrtime.bigint();
}

function endTimer(start) {
  const end = process.hrtime.bigint();
  const diffNs = end - start;
  return Number(diffNs) / 1_000_000; // Convert to milliseconds
}

// ============================================================================
// NE API Tests
// ============================================================================

async function testNeApiStats(count) {
  const start = startTimer();

  // Fetch stats from the points endpoint (similar to ne-etl-preview)
  const features = [];
  const seenIds = new Set();
  let page = 1;
  const maxPages = 5;

  while (features.length < count && page <= maxPages) {
    const url = urlWithQuery('/api/statistic_map_points/', {
      geometry: 'zip',
      start_date: '2023-01-01',
      end_date: '2025-12-31',
      page,
    }, base);

    const json = await getJson(url, DEBUG).catch(async () => {
      const alt = new URL('/api/statistic_map_points.json', base.replace(/\/$/, ''));
      alt.searchParams.set('geometry', 'zip');
      alt.searchParams.set('start_date', '2023-01-01');
      alt.searchParams.set('end_date', '2025-12-31');
      alt.searchParams.set('page', String(page));
      return getJson(alt.toString(), DEBUG);
    });

    const feats = json?.results?.features || json?.features || [];
    for (const f of feats) {
      if (!f || seenIds.has(f.id)) continue;
      const coords = f?.geometry?.coordinates;
      const isZip = (f?.properties?.geometry_type || '').toLowerCase() === 'zip';
      if (!isZip || !coords || !inTulsaBbox(coords)) continue;
      features.push(f);
      seenIds.add(f.id);
      if (features.length >= count) break;
    }

    if (!json?.next || features.length >= count) break;
    page += 1;
  }

  const elapsed = endTimer(start);
  return { features, elapsed };
}

async function getAdapter(statId) {
  const url = `${base.replace(/\/$/, '')}/api/statistic_map/${statId}/?format=json`;
  return getJson(url, DEBUG);
}

async function getAreaInfo(areaHash) {
  const url = `${base.replace(/\/$/, '')}/api/areas/${areaHash}.json`;
  return getJson(url, DEBUG);
}

function findDateIndex(dates, targetISO) {
  const idxEntries = Object.entries(dates || {});
  const exact = idxEntries.find(([, iso]) => String(iso).slice(0, 10) === targetISO);
  if (exact) return exact[0];
  // Fallback: take the first date
  return idxEntries.length > 0 ? idxEntries[0][0] : null;
}

function parseValue(v) {
  if (Array.isArray(v)) return Number(v[1]);
  return Number(v);
}

async function testNeApiZipValues(statId) {
  const start = startTimer();

  const adapter = await getAdapter(statId);
  const { dates } = adapter;

  // Find a date that has data (prefer most recent)
  const dateEntries = Object.entries(dates || {});
  if (dateEntries.length === 0) {
    throw new Error('No dates available for this stat');
  }

  // Use the most recent date
  const dateIdx = dateEntries[dateEntries.length - 1][0];
  const row = (adapter.area_values || {})[dateIdx];

  if (!row || !row.values) {
    throw new Error('No area values for this date');
  }

  // Resolve all areas to get ZIP codes
  const entries = Object.entries(row.values);
  const limit = 10; // Concurrency
  const zipData = [];

  for (let i = 0; i < entries.length; i += limit) {
    const slice = entries.slice(i, i + limit);
    const batch = await Promise.all(slice.map(async ([hash, v]) => {
      const value = parseValue(v);
      if (!isFinite(value)) return null;
      try {
        const info = await getAreaInfo(hash);
        if (String(info.geometry_type).toLowerCase() === 'zip') {
          return { zip: info.identity, value };
        }
      } catch {
        return null;
      }
      return null;
    }));
    for (const b of batch) if (b) zipData.push(b);
  }

  const elapsed = endTimer(start);
  return { zipData, elapsed };
}

// ============================================================================
// InstantDB Tests
// ============================================================================

async function testInstantDbStats(count) {
  const start = startTimer();

  // Query stats from InstantDB (similar to useStats hook)
  const result = await db.query({
    stats: {
      $: {
        order: { name: 'asc' },
        limit: count,
      },
    },
  });

  if (DEBUG) {
    console.log('InstantDB query result:', JSON.stringify(result, null, 2));
  }

  // Admin SDK returns data directly in result.stats, not result.data.stats
  const stats = result?.stats || [];
  const elapsed = endTimer(start);

  return { stats, elapsed, result };
}

async function testInstantDbZipValues(statId) {
  const start = startTimer();

  // Query statData for this stat (get all years/ZIP data)
  const result = await db.query({
    statData: {
      $: {
        where: {
          and: [
            { statId },
            { name: 'root' },
            { area: 'Tulsa' },
            { boundaryType: 'ZIP' },
          ],
        },
        order: { date: 'desc' },
      },
    },
  });

  // Admin SDK returns data directly in result.statData, not result.data.statData
  const statDataRecords = result?.statData || [];

  // Get the most recent year's data
  const mostRecent = statDataRecords[0];
  const zipData = mostRecent?.data || {};

  // Convert to array format
  const zipArray = Object.entries(zipData).map(([zip, value]) => ({ zip, value }));

  const elapsed = endTimer(start);
  return { zipData: zipArray, elapsed };
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function main() {
  console.log('='.repeat(80));
  console.log('PERFORMANCE TEST: NE API vs InstantDB');
  console.log('='.repeat(80));
  console.log(`Base: ${base}`);
  console.log(`Test: Load ${limit} stats details + full ZIP values for one stat`);
  console.log('='.repeat(80));
  console.log();

  // -------------------------------------------------------------------------
  // Test 1: Load 10 stats from NE API
  // -------------------------------------------------------------------------
  console.log(`[1/4] Loading ${limit} stats from NE API...`);
  const neStatsResult = await testNeApiStats(limit);
  console.log(`✓ Loaded ${neStatsResult.features.length} stats from NE API`);
  console.log(`   Time: ${neStatsResult.elapsed.toFixed(2)}ms`);
  console.log();

  // -------------------------------------------------------------------------
  // Test 2: Load 10 stats from InstantDB
  // -------------------------------------------------------------------------
  console.log(`[2/4] Loading ${limit} stats from InstantDB...`);
  const instantStatsResult = await testInstantDbStats(limit);
  console.log(`✓ Loaded ${instantStatsResult.stats.length} stats from InstantDB`);
  console.log(`   Time: ${instantStatsResult.elapsed.toFixed(2)}ms`);
  console.log();

  // -------------------------------------------------------------------------
  // Test 3: Load ZIP values from NE API
  // -------------------------------------------------------------------------
  let neStatId = testStatId;
  if (!neStatId) {
    // Use the first stat we found
    if (neStatsResult.features.length > 0) {
      neStatId = neStatsResult.features[0].id;
      console.log(`[3/4] No --stat provided, using first stat: ${neStatId}`);
    } else {
      console.log('[3/4] Skipping ZIP values test (no stats found)');
      return;
    }
  }

  let neZipResult = null;
  console.log(`[3/4] Loading ZIP values for stat ${neStatId} from NE API...`);
  try {
    neZipResult = await testNeApiZipValues(neStatId);
    console.log(`✓ Loaded ${neZipResult.zipData.length} ZIP values from NE API`);
    console.log(`   Time: ${neZipResult.elapsed.toFixed(2)}ms`);
    console.log();
  } catch (err) {
    console.log(`✗ Failed to load ZIP values from NE API: ${err.message}`);
    console.log();
  }

  // -------------------------------------------------------------------------
  // Test 4: Load ZIP values from InstantDB
  // -------------------------------------------------------------------------
  // Need to find the corresponding stat in InstantDB
  console.log(`[4/4] Loading ZIP values from InstantDB...`);

  // Find stat by neId
  const statLookup = await db.query({
    stats: {
      $: {
        where: { neId: neStatId },
      },
    },
  });

  // Admin SDK returns data directly in statLookup.stats
  const instantStat = statLookup?.stats?.[0];
  let instantZipResult = null;
  if (!instantStat) {
    console.log(`✗ Stat ${neStatId} not found in InstantDB (not yet ETL'd)`);
    console.log('   Run: npm run ne:geo:series:staging -- --stat=' + neStatId + ' --geometry=zip');
    console.log();
  } else {
    try {
      instantZipResult = await testInstantDbZipValues(instantStat.id);
      console.log(`✓ Loaded ${instantZipResult.zipData.length} ZIP values from InstantDB`);
      console.log(`   Time: ${instantZipResult.elapsed.toFixed(2)}ms`);
      console.log();
    } catch (err) {
      console.log(`✗ Failed to load ZIP values from InstantDB: ${err.message}`);
      console.log();
    }
  }

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));

  const neStatsTime = neStatsResult.elapsed;
  const instantStatsTime = instantStatsResult.elapsed;
  const statsSpeedup = neStatsTime / instantStatsTime;

  console.log();
  console.log('Stats Loading (10 stats):');
  console.log(`  NE API:      ${neStatsTime.toFixed(2)}ms (${(neStatsTime / 1000).toFixed(2)}s)`);
  console.log(`  InstantDB:   ${instantStatsTime.toFixed(2)}ms`);
  console.log(`  Speedup:     ${statsSpeedup.toFixed(2)}x faster with InstantDB`);
  console.log();

  if (neZipResult && instantZipResult) {
    const neZipTime = neZipResult.elapsed;
    const instantZipTime = instantZipResult.elapsed;
    const zipSpeedup = neZipTime / instantZipTime;

    console.log('ZIP Values Loading (42 ZIPs for one stat):');
    console.log(`  NE API:      ${neZipTime.toFixed(2)}ms (${(neZipTime / 1000).toFixed(2)}s)`);
    console.log(`  InstantDB:   ${instantZipTime.toFixed(2)}ms (${(instantZipTime / 1000).toFixed(2)}s)`);
    console.log(`  Speedup:     ${zipSpeedup.toFixed(2)}x faster with InstantDB`);
    console.log();

    const neTotalTime = neStatsTime + neZipTime;
    const instantTotalTime = instantStatsTime + instantZipTime;
    const totalSpeedup = neTotalTime / instantTotalTime;

    console.log('Total Time (10 stats + 42 ZIP values):');
    console.log(`  NE API:      ${neTotalTime.toFixed(2)}ms (${(neTotalTime / 1000).toFixed(2)}s)`);
    console.log(`  InstantDB:   ${instantTotalTime.toFixed(2)}ms (${(instantTotalTime / 1000).toFixed(2)}s)`);
    console.log(`  Speedup:     ${totalSpeedup.toFixed(2)}x faster with InstantDB`);
    console.log();
  } else {
    console.log('Note: ZIP values comparison requires the stat to be ETL\'d into InstantDB first.');
    console.log('      Use: npm run ne:geo:series:staging -- --stat=<HASH> --geometry=zip');
    console.log();
  }
}

main().catch((e) => {
  console.error('Speed test failed:', e.message || e);
  if (DEBUG) console.error(e);
  process.exit(1);
});
