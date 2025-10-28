// Fetch full area series for a single NE stat id across a date window
// Attempts requested geometry (default: zip); falls back to actual geometry from adapter
// Writes to InstantDB (admin) using same idempotent rules as ne-etl-load
//
// Performance: hoisted area cache, concurrency pool for area resolution

import 'dotenv/config';
import { init as initAdmin, id as newId, tx } from '@instantdb/admin';
import {
  parseArgs,
  isDebug,
  getNeBase,
  getJson,
  mapUnitToType,
  desiredToGoodIfUp,
  fetchCategoriesMap,
  initInstantAdmin,
} from './_shared/etlUtils.js';

const args = parseArgs();

const base = args.base || getNeBase();
const startDate = args.start || '2023-01-01';
const endDate = args.end || '2025-12-31';
const wantGeom = (args.geometry || 'zip').toLowerCase();
const DRY = args.dry === '1' || args.dry === true;
const STRICT = args.strict === '1' || args.strict === true;
const SKIP_UNNAMED = args['skip-unnamed'] === '1' || args['skip-unnamed'] === true;
const DEBUG = isDebug(args);
const CONCURRENCY = Number(args.concurrency || 10); // Concurrent area resolutions

const db = initInstantAdmin(initAdmin);

async function getAdapter(statId) {
  const url = `${base.replace(/\/$/, '')}/api/statistic_map/${statId}/?format=json`;
  return getJson(url, DEBUG);
}

async function getStatisticDetail(statId) {
  const url = `${base.replace(/\/$/, '')}/api/statistics/${statId}/?format=json`;
  try {
    return await getJson(url, DEBUG);
  } catch (err) {
    if (DEBUG) console.log(`Failed to fetch statistic detail: ${err.message}`);
    return null;
  }
}

// Shared area info cache (hoisted across years for performance)
const areaInfoCache = new Map();

async function getAreaInfo(areaHash) {
  if (areaInfoCache.has(areaHash)) return areaInfoCache.get(areaHash);
  const url = `${base.replace(/\/$/, '')}/api/areas/${areaHash}.json`;
  try {
    const info = await getJson(url, DEBUG);
    areaInfoCache.set(areaHash, info);
    return info;
  } catch (err) {
    areaInfoCache.set(areaHash, null);
    return null;
  }
}

// Concurrency pool: resolve area hashes in parallel batches
async function resolveAreasInBatches(hashes, concurrency) {
  const results = new Map();
  const queue = [...hashes];
  const workers = [];

  async function worker() {
    while (queue.length > 0) {
      const hash = queue.shift();
      if (!hash) continue;
      const info = await getAreaInfo(hash);
      if (info && info.identity && info.geometry_type) {
        results.set(hash, { code: info.identity, geom: info.geometry_type });
      }
    }
  }

  for (let i = 0; i < Math.min(concurrency, hashes.length); i++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

async function ensureStat({ neId, name, category, desired }) {
  const now = Date.now();

  // Look by neId first
  if (neId) {
    const byNe = await db.query({ stats: { $: { where: { neId } } } });
    const ex = byNe?.data?.stats?.[0];
    if (ex) {
      const updates = { lastUpdated: now };
      const giu = desiredToGoodIfUp(desired);
      if (category != null && ex.category !== category) updates.category = category;
      if (giu != null && ex.goodIfUp !== giu) updates.goodIfUp = giu;
      if (Object.keys(updates).length > 1) await db.transact(tx.stats[ex.id].update(updates));
      return ex.id;
    }
  }
  // Fallback by name
  const byName = await db.query({ stats: { $: { where: { name } } } });
  const exN = byName?.data?.stats?.[0];
  const newVals = {
    name,
    category,
    neId: neId || undefined,
    goodIfUp: desiredToGoodIfUp(desired) || undefined,
    lastUpdated: now,
  };
  if (exN) {
    newVals.createdOn = exN.createdOn || now;
    await db.transact(tx.stats[exN.id].update(newVals));
    return exN.id;
  }
  const newStatId = newId();
  newVals.createdOn = now;
  await db.transact(tx.stats[newStatId].update(newVals));
  return newStatId;
}

async function upsertStatData(statId, { boundaryType, date, type, data, statTitle }) {
  const now = Date.now();

  const where = { and: [ { statId }, { name: 'root' }, { area: 'Tulsa' }, { boundaryType }, { date } ] };
  const existing = (await db.query({ statData: { $: { where } } })).data?.statData?.[0];
  if (existing) {
    const merged = { ...(existing.data || {}), ...(data || {}) };
    await db.transact(tx.statData[existing.id].update({ type, data: merged, statTitle, lastUpdated: now }));
    return existing.id;
  }
  const newDataId = newId();
  await db.transact(tx.statData[newDataId].update({
    statId,
    name: 'root',
    statTitle,
    area: 'Tulsa',
    boundaryType,
    date,
    type,
    data,
    createdOn: now,
    lastUpdated: now,
  }));
  return newDataId;
}

function withinWindow(yearStr) {
  const y = Number(yearStr);
  const ys = Number(startDate.slice(0,4));
  const ye = Number(endDate.slice(0,4));
  return !isNaN(y) && y >= ys && y <= ye;
}

async function main() {
  const statId = args.stat;
  if (!statId) {
    console.error('Usage: node scripts/ne-geo-series.js --stat=<NE_STAT_HASHID> [--name=<STAT_NAME>] [--geometry=zip|tract] [--dry=1] [--skip-unnamed=1] [--concurrency=10]');
    process.exit(2);
  }
  console.log(`Base: ${base}`);
  console.log(`Stat: ${statId} | requested geometry: ${wantGeom}`);
  console.log(`Window: ${startDate} → ${endDate}`);
  console.log(`Concurrency: ${CONCURRENCY} (for area resolution)`);
  console.log(DRY ? 'Mode: DRY' : 'Mode: WRITE');

  const adapter = await getAdapter(statId);
  const dateIdxToIso = adapter.dates || {};
  const areaValues = adapter.area_values || {};
  const supportedGeoms = adapter.geometry_type_options || [];
  const fallbackGeom = adapter.default_geometry_type || 'tract';
  console.log('Supported geometries:', supportedGeoms.join(', '));

  // Try to get stat metadata
  // Priority: 1) provided via --name flag, 2) detail endpoint, 3) points endpoint
  let statName = `Stat ${statId}`;
  let unit = null;
  let desired = null;
  let categoryId = null;

  // If name was passed from bulk script, use it directly (most reliable!)
  if (args.name && !args.name.startsWith('Stat ')) {
    statName = args.name;
    if (DEBUG) console.log(`Using provided name from --name flag: ${statName}`);
  } else {
    // Otherwise, try API endpoints
    const detail = await getStatisticDetail(statId);
    if (detail) {
      statName = detail.name || statName;
      unit = detail.unit || null;
      desired = detail.desired || null;
      categoryId = detail.category ?? null;
      if (DEBUG) console.log(`Got stat details from /api/statistics/${statId}: ${statName}`);
    } else {
      // Fallback: try points endpoint (paginated, might miss it)
      if (DEBUG) console.log('Detail endpoint failed, trying points endpoint...');
      async function tryPointsForGeom(geom) {
        const url = `${base.replace(/\/$/, '')}/api/statistic_map_points/?format=json&geometry=${geom}`;
        return getJson(url, DEBUG).catch(() => null);
      }
      let pts = await tryPointsForGeom(wantGeom);
      if ((!pts || !pts.results || !pts.results.features) && !STRICT) {
        // try fallback geometry as last resort
        pts = await tryPointsForGeom(fallbackGeom);
      }
      if (pts && pts.results && pts.results.features) {
        const hit = pts.results.features.find((f) => f.id === statId);
        if (hit) {
          statName = hit.properties?.name || statName;
          unit = hit.properties?.unit || null;
          desired = hit.properties?.desired || null;
          categoryId = hit.properties?.category ?? null;
          if (DEBUG) console.log(`Found stat in points: ${statName}`);
        }
      }
    }
  }

  // Still try to get additional metadata from detail endpoint if we only have the name
  if (args.name && !unit && !desired && !categoryId) {
    const detail = await getStatisticDetail(statId);
    if (detail) {
      unit = detail.unit || null;
      desired = detail.desired || null;
      categoryId = detail.category ?? null;
      if (DEBUG) console.log(`Fetched additional metadata from detail endpoint`);
    }
  }

  // Check if we should skip stats without proper names
  if (SKIP_UNNAMED && statName.startsWith('Stat ')) {
    console.warn(`⚠️  Skipping stat ${statId}: No proper name found (use without --skip-unnamed to import anyway)`);
    process.exit(0);
  }
  const categoryMap = await fetchCategoriesMap(base, DEBUG);
  const category = categoryId == null ? '' : (categoryMap.get(categoryId) || String(categoryId));
  const statType = mapUnitToType(unit);

  // Ensure stat
  let statInstantId = null;
  if (!DRY) {
    statInstantId = await ensureStat({ neId: statId, name: statName, category, desired });
  }

  // Build and upsert per-year data
  const yearsToIdx = Object.entries(dateIdxToIso).filter(([, iso]) => withinWindow(String(iso).slice(0,4)));
  for (const [idx, iso] of yearsToIdx) {
    const year = String(iso).slice(0,4);
    const row = areaValues[idx];
    const kv = row?.values || {};

    // Collect all hashes for this year
    const hashes = Object.keys(kv).filter((h) => {
      const pair = kv[h];
      const value = Array.isArray(pair) ? pair[1] : pair;
      return value != null;
    });

    // Resolve in parallel batches
    const resolved = await resolveAreasInBatches(hashes, CONCURRENCY);

    // Build data object filtered to requested geometry
    const data = {};
    for (const h of hashes) {
      const pair = kv[h];
      const value = Array.isArray(pair) ? pair[1] : pair;
      const m = resolved.get(h);
      if (m && m.code && String(m.geom).toLowerCase() === wantGeom) {
        data[m.code] = Number(value);
      }
    }

    const boundaryType = wantGeom.toUpperCase();
    if (STRICT && Object.keys(data).length === 0) {
      console.warn(`No '${wantGeom}' entries found for year ${year}; skipping due to --strict.`);
      continue;
    }
    const payload = { boundaryType, date: year, type: statType, data, statTitle: statName };
    if (DRY) {
      console.log(`Preview ${statName} ${year} (${boundaryType}): ${Object.keys(data).length} areas`);
    } else {
      await upsertStatData(statInstantId, payload);
      console.log(`Upserted ${statName} ${year} (${boundaryType}): ${Object.keys(data).length} areas`);
    }
  }

  console.log(`\nSummary: processed ${yearsToIdx.length} year(s) for stat ${statName}`);
}

main().catch((e) => {
  console.error('geo-series failed:', e.message || e);
  process.exit(1);
});
