// Neighborhood Explorer → InstantDB ETL Preview
// Node 20+ required (uses built-in fetch). ESM enabled via package.json type: module
// This script fetches 10 ZIP-level Tulsa-area stats (2023–2025) from NE and prints
// both the raw rows and the transformed shape we will write to InstantDB.

import {
  parseArgs,
  isDebug,
  getNeBase,
  urlWithQuery,
  getJson,
  inTulsaBbox,
  mapUnitToType,
  desiredToGoodIfUp,
} from './_shared/etlUtils.js';

const args = parseArgs();

const base = args.base || getNeBase();
const limit = Number(args.limit || 10);
const DEBUG = isDebug(args);

// Date window
const startDate = args.start || '2023-01-01';
const endDate = args.end || '2025-12-31';

async function fetchStatisticMapPoints({ startDate, endDate, geometry = 'zip' }) {
  const picked = [];
  const seenIds = new Set();
  let page = 1;
  let pageCountGuard = 0;
  const maxPages = 25; // sanity guard

  while (picked.length < limit && pageCountGuard < maxPages) {
    const url = urlWithQuery('/api/statistic_map_points/', {
      geometry,
      start_date: startDate,
      end_date: endDate,
      page,
    }, base);
    const pageJson = await getJson(url, DEBUG).catch(async (err) => {
      // Fallback to .json (non-DRF formatted) if needed
      const alt = new URL('/api/statistic_map_points.json', base.replace(/\/$/, ''));
      alt.searchParams.set('geometry', geometry);
      alt.searchParams.set('start_date', startDate);
      alt.searchParams.set('end_date', endDate);
      alt.searchParams.set('page', String(page));
      return getJson(alt.toString(), DEBUG);
    });

    // Expecting { count, results: { type: 'FeatureCollection', features: [] } }
    const features = pageJson?.results?.features || pageJson?.features || [];
    if (DEBUG) console.log(`page ${page}: got ${features.length} features, have ${picked.length}/${limit}`);
    for (const f of features) {
      if (!f || seenIds.has(f.id)) continue;
      const coords = f?.geometry?.coordinates;
      const isZip = (f?.properties?.geometry_type || '').toLowerCase() === 'zip';
      if (!isZip) continue;
      if (coords && inTulsaBbox(coords)) {
        picked.push(f);
        seenIds.add(f.id);
        if (picked.length >= limit) break;
      }
    }

    if (!pageJson?.next || picked.length >= limit) break;
    page += 1;
    pageCountGuard += 1;
  }

  return picked;
}

function summarizeFeature(f) {
  const [lon, lat] = Array.isArray(f?.geometry?.coordinates)
    ? f.geometry.coordinates
    : [null, null];
  return {
    id: f.id,
    name: f?.properties?.name,
    unit: f?.properties?.unit,
    desired: f?.properties?.desired,
    date: f?.properties?.date,
    area: f?.properties?.area?.identity || f?.properties?.area || null,
    area_value: f?.properties?.area_value,
    geometry_type: f?.properties?.geometry_type,
    lon,
    lat,
  };
}

function toInstantPreviewRow(f) {
  const areaKey = String(f?.properties?.area?.identity || '').trim();
  const zipKey = /\d{5}/.test(areaKey) ? areaKey : undefined;
  const name = f?.properties?.name || 'Unknown';
  const unit = f?.properties?.unit || null;
  const desired = f?.properties?.desired || null;
  const dateStr = (f?.properties?.date || '').slice(0, 4) || '2025'; // year only
  const value = typeof f?.properties?.area_value === 'number'
    ? f.properties.area_value
    : Number(f?.properties?.area_value) || null;

  return {
    stat: {
      name,
      category: String(f?.properties?.category ?? ''),
      goodIfUp: desiredToGoodIfUp(desired),
    },
    statData: {
      statId: '(placeholder-uuid)',
      name: 'root',
      statTitle: name,
      area: 'Tulsa',
      boundaryType: 'ZIP',
      date: dateStr,
      type: mapUnitToType(unit),
      data: zipKey && value != null ? { [zipKey]: value } : {},
    },
  };
}

async function main() {
  console.log(`Base: ${base}`);
  console.log(`Window: ${startDate} → ${endDate}`);
  console.log(`Geometry: zip | Tulsa bbox filter | limit=${limit}`);

  const features = await fetchStatisticMapPoints({ startDate, endDate, geometry: 'zip' });
  if (!features.length) {
    console.log('No features returned that match Tulsa ZIP + date window.');
    process.exit(0);
  }

  console.log(`\nRaw sample (${features.length}):`);
  const compact = features.map(summarizeFeature);
  console.table(
    compact.map((r) => ({ id: r.id, name: r.name?.slice(0, 40) || '', zip: r.area, date: r.date?.slice(0, 10), unit: r.unit, val: r.area_value, lon: r.lon?.toFixed?.(3), lat: r.lat?.toFixed?.(3) })),
  );

  console.log('\nTransform preview (Instant shapes):');
  for (const f of features) {
    const row = toInstantPreviewRow(f);
    console.dir(row, { depth: 4 });
  }

  console.log('\nNext step: Use @instantdb/admin to upsert 10 stats + statData in a server script.');
}

main().catch((e) => {
  console.error('ETL preview failed:', e.message || e);
  process.exit(1);
});
