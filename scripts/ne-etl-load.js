// Neighborhood Explorer → InstantDB ETL Loader (server-side)
// Prereqs:
//  - Node 20+
//  - env: VITE_INSTANT_APP_ID, INSTANT_APP_ADMIN_TOKEN
//  - optional: NE_BASE (defaults to staging), NE_TOKEN for NE auth
// Usage:
//  npm run ne:etl:load:staging
//  npm run ne:etl:load:prod
//  NE_BASE=... node scripts/ne-etl-load.js --limit=10

import 'dotenv/config';
import { init as initAdmin, id, tx } from '@instantdb/admin';
import {
  parseArgs,
  isDebug,
  getNeBase,
  urlWithQuery,
  getJson,
  inTulsaBbox,
  mapUnitToType,
  desiredToGoodIfUp,
  fetchCategoriesMap,
  initInstantAdmin,
} from './_shared/etlUtils.js';

const args = parseArgs();

const base = args.base || getNeBase();
const limit = Number(args.limit || 10);
const startDate = args.start || '2023-01-01';
const endDate = args.end || '2025-12-31';
const DRY = args.dry === '1' || args.dry === true;
const DEBUG = isDebug(args);

const db = initInstantAdmin(initAdmin);

async function fetchZipFeatures({ startDate, endDate }) {
  const out = [];
  const seenIds = new Set();
  let page = 1;
  const maxPages = 25;
  while (out.length < limit && page <= maxPages) {
    const url = urlWithQuery('/api/statistic_map_points/', {
      geometry: 'zip',
      start_date: startDate,
      end_date: endDate,
      page,
    }, base);
    const json = await getJson(url, DEBUG).catch(async () => {
      const alt = new URL('/api/statistic_map_points.json', base.replace(/\/$/, ''));
      alt.searchParams.set('geometry', 'zip');
      alt.searchParams.set('start_date', startDate);
      alt.searchParams.set('end_date', endDate);
      alt.searchParams.set('page', String(page));
      return getJson(alt.toString(), DEBUG);
    });
    const features = json?.results?.features || json?.features || [];
    if (DEBUG) console.log(`page ${page}: got ${features.length}`);
    for (const f of features) {
      if (!f || seenIds.has(f.id)) continue;
      const isZip = (f?.properties?.geometry_type || '').toLowerCase() === 'zip';
      const coords = f?.geometry?.coordinates;
      if (!isZip || !coords || !inTulsaBbox(coords)) continue;
      out.push(f);
      seenIds.add(f.id);
      if (out.length >= limit) break;
    }
    if (!json?.next || out.length >= limit) break;
    page += 1;
  }
  return out;
}

function featureToInstant(f, opts) {
  const areaKey = String(f?.properties?.area?.identity || '').trim();
  const zip = /\d{5}/.test(areaKey) ? areaKey : undefined;
  const name = f?.properties?.name || 'Unknown';
  const unit = f?.properties?.unit || null;
  const dateYear = (f?.properties?.date || '').slice(0, 4) || '2025';
  const value = typeof f?.properties?.area_value === 'number' ? f.properties.area_value : Number(f?.properties?.area_value) || null;
  const categoryId = (f?.properties?.category ?? null);
  const categoryStr = categoryId == null ? '' : (opts?.categoryMap?.get?.(categoryId) || String(categoryId));
  return {
    stat: {
      name,
      category: categoryStr,
      neId: f?.id || undefined,
      goodIfUp: desiredToGoodIfUp(f?.properties?.desired),
    },
    statData: {
      name: 'root',
      statTitle: name,
      area: 'Tulsa',
      boundaryType: 'ZIP',
      date: dateYear,
      type: mapUnitToType(unit),
      data: zip && value != null ? { [zip]: value } : {},
    },
  };
}

async function ensureStatId({ neId, name: statName }, draft) {
  const now = Date.now();

  // Prefer lookup by NE id if provided
  if (neId) {
    const qByNe = { stats: { $: { where: { neId } } } };
    const rNe = await db.query(qByNe);
    const exNe = rNe?.data?.stats?.[0];
    if (exNe) {
      const updates = { lastUpdated: now };
      if (draft.category !== undefined && draft.category !== exNe.category) updates.category = draft.category;
      if (draft.goodIfUp !== undefined && draft.goodIfUp !== exNe.goodIfUp) updates.goodIfUp = draft.goodIfUp;
      if (!exNe.neId) updates.neId = neId;
      if (Object.keys(updates).length > 1) await db.transact(tx.stats[exNe.id].update(updates));
      return exNe.id;
    }
  }
  // Fallback: lookup by name
  const q = { stats: { $: { where: { name: statName } } } };
  const resp = await db.query(q);
  const existing = resp?.data?.stats?.[0];
  if (existing) {
    // Update category/goodIfUp if changed
    const updates = { lastUpdated: now };
    if (draft.category !== undefined && draft.category !== existing.category) updates.category = draft.category;
    if (draft.goodIfUp !== undefined && draft.goodIfUp !== existing.goodIfUp) updates.goodIfUp = draft.goodIfUp;
    if (!existing.neId && neId) updates.neId = neId;
    if (Object.keys(updates).length > 1) {
      await db.transact(tx.stats[existing.id].update(updates));
    }
    return existing.id;
  }
  const newId = id();
  await db.transact(tx.stats[newId].update({
    name: statName,
    category: draft.category,
    neId: neId || undefined,
    goodIfUp: draft.goodIfUp ?? undefined,
    createdOn: now,
    lastUpdated: now,
  }));
  return newId;
}

async function upsertStatData(statId, sd) {
  const now = Date.now();

  // Find by statId + name + area + boundaryType + date
  const where = { and: [ { statId }, { name: sd.name }, { area: sd.area }, { boundaryType: sd.boundaryType }, { date: sd.date } ] };
  const q = { statData: { $: { where } } };
  const resp = await db.query(q);
  const existing = resp?.data?.statData?.[0];
  if (existing) {
    const merged = { ...(existing.data || {}), ...(sd.data || {}) };
    const updates = { type: sd.type, data: merged, statTitle: sd.statTitle, lastUpdated: now };
    await db.transact(tx.statData[existing.id].update(updates));
    return existing.id;
  }
  const newId = id();
  await db.transact(
    tx.statData[newId].update({
      statId,
      name: sd.name,
      statTitle: sd.statTitle,
      area: sd.area,
      boundaryType: sd.boundaryType,
      date: sd.date,
      type: sd.type,
      data: sd.data || {},
      createdOn: now,
      lastUpdated: now,
    }),
  );
  return newId;
}

async function main() {
  console.log(`Base: ${base}`);
  console.log(`Window: ${startDate} → ${endDate}`);
  console.log(`Limit: ${limit} (distinct by stat name)`);
  console.log(DRY ? 'Mode: DRY (no writes)' : 'Mode: WRITE');

  const feats = await fetchZipFeatures({ startDate, endDate });
  if (!feats.length) {
    console.log('No Tulsa ZIP features found in this window.');
    return;
  }

  // Deduplicate by stat name, keep first occurrence
  const byName = new Map();
  for (const f of feats) {
    const name = f?.properties?.name || 'Unknown';
    if (!byName.has(name)) byName.set(name, f);
    if (byName.size >= limit) break;
  }

  const selected = Array.from(byName.values());
  console.log(`Selected ${selected.length} unique stats.`);

  // Build category crosswalk once
  const categoryMap = await fetchCategoriesMap(base, DEBUG).catch(() => new Map());

  // Preview
  for (const f of selected) {
    const row = featureToInstant(f, { categoryMap });
    console.dir(row, { depth: 3 });
  }

  if (DRY) return;

  // Upsert into Instant
  for (const f of selected) {
    const t = featureToInstant(f, { categoryMap });
    const statId = await ensureStatId({ neId: t.stat.neId, name: t.stat.name }, t.stat);
    await upsertStatData(statId, t.statData);
  }

  console.log('Done: upserted stats + statData for', selected.length, 'items.');
}

main().catch((e) => {
  console.error('ETL load failed:', e.message || e);
  process.exit(1);
});
