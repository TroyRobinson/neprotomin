// Print all ZIP values for a given NE stat + date if the adapter provides ZIP.
// Usage examples:
//   npm run ne:zip:values:staging -- --stat=wOGzD8ZD --date=2024-01-01
// Env:
//   NE_BASE=https://neighborhood-explorer-staging.herokuapp.com (default)
//   NE_TOKEN=Token xxxx (optional, if API requires auth)

import 'dotenv/config';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [arg.replace(/^--/, ''), true];
  }),
);

const DEFAULT_BASE = 'https://neighborhood-explorer-staging.herokuapp.com';
const base = args.base || process.env.NE_BASE || DEFAULT_BASE;
const token = process.env.NE_TOKEN || process.env.VITE_NE_API_TOKEN || '';
const statId = args.stat || args.id;
const targetDate = args.date || '2024-01-01';
const DEBUG = !!process.env.DEBUG || args.debug === '1' || args.debug === true;

if (!statId) {
  console.error('Usage: node scripts/ne-zip-values.js --stat=<NE_STAT_HASHID> [--date=YYYY-MM-DD]');
  process.exit(2);
}

function authHeaders() {
  const headers = { Accept: 'application/json' };
  if (token) headers['Authorization'] = token.startsWith('Token ') ? token : `Token ${token}`;
  return headers;
}

async function getJson(url) {
  if (DEBUG) console.log('GET', url);
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${url}: ${text || res.statusText}`);
  }
  return res.json();
}

async function getAdapter(statId) {
  const url = `${base.replace(/\/$/, '')}/api/statistic_map/${statId}/?format=json`;
  return getJson(url);
}

async function getAreaInfo(areaHash) {
  const url = `${base.replace(/\/$/, '')}/api/areas/${areaHash}.json`;
  return getJson(url);
}

function findDateIndex(dates, targetISO) {
  const idxEntries = Object.entries(dates || {});
  // Prefer exact ISO match; else match by year
  const exact = idxEntries.find(([, iso]) => String(iso).slice(0, 10) === targetISO);
  if (exact) return exact[0];
  const year = targetISO.slice(0, 4);
  const byYear = idxEntries.find(([, iso]) => String(iso).slice(0, 4) === year);
  return byYear ? byYear[0] : null;
}

function parseValue(v) {
  // Adapter formats vary: either number or [mappingId, number]
  if (Array.isArray(v)) return Number(v[1]);
  return Number(v);
}

async function main() {
  console.log(`Base: ${base}`);
  console.log(`Stat: ${statId}`);
  console.log(`Date: ${targetDate}`);

  const adapter = await getAdapter(statId);
  const { dates, default_geometry_type } = adapter;
  const dateIdx = findDateIndex(dates, targetDate);
  if (dateIdx == null) {
    console.log(`No adapter date found for ${targetDate}. Available:`, Object.values(dates || {}).join(', '));
    process.exit(0);
  }

  const row = (adapter.area_values || {})[dateIdx];
  if (!row || !row.values) {
    console.log('No area values present for that date.');
    process.exit(0);
  }

  // Resolve all areas; filter to ZIP
  const entries = Object.entries(row.values);
  // Concurrency limiter
  const limit = 10;
  const out = [];
  for (let i = 0; i < entries.length; i += limit) {
    const slice = entries.slice(i, i + limit);
    const batch = await Promise.all(slice.map(async ([hash, v]) => {
      const value = parseValue(v);
      if (!isFinite(value)) return null;
      try {
        const info = await getAreaInfo(hash);
        return { hash, value, geometry_type: info.geometry_type, code: info.identity };
      } catch {
        return null;
      }
    }));
    for (const b of batch) if (b) out.push(b);
  }

  const zips = out.filter((r) => String(r.geometry_type).toLowerCase() === 'zip');
  if (!zips.length) {
    console.log(`Adapter geometry appears to be '${default_geometry_type}'. No ZIP values exposed for this stat/date via the adapter API.`);
    console.log('Explanation: The public adapter JSON returns one geometry at a time and does not honor a geometry switch via query params.');
    console.log('The website may show ZIP via server-side reprojection not exposed in this JSON.');
    process.exit(0);
  }

  // Print a simple table: ZIP, value
  zips.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  console.table(zips.map(({ code, value }) => ({ zip: code, value })));
}

main().catch((e) => {
  console.error('zip-values failed:', e.message || e);
  process.exit(1);
});

