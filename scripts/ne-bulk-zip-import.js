// Bulk import: pick N most recent ZIP-available stats (by latest measurement date)
// and import ZIP series for last K years for Tulsa area into InstantDB (admin).
//
// Usage examples:
//   npm run ne:bulk:zip:import:staging:dry -- --limit=10 --years=3
//   npm run ne:bulk:zip:import:staging -- --limit=10 --years=3
//
// Notes:
// - NE API does not expose statistic "created" timestamps publicly on /api/statistics.
//   As an alternative, we rank by the latest measurement date from statistic_map_points
//   with geometry=zip, which is a good proxy for most-recent activity.

import 'dotenv/config';
import { spawn } from 'node:child_process';
import {
  parseArgs,
  isDebug,
  getNeBase,
  getJson,
  urlWithQuery,
} from './_shared/etlUtils.js';

const args = parseArgs();

const base = args.base || getNeBase();
const limit = Number(args.limit || 10);
const years = Number(args.years || 3);
const DRY = args.dry === '1' || args.dry === true;
const SKIP_UNNAMED = args['skip-unnamed'] === '1' || args['skip-unnamed'] === true;
const DEBUG = isDebug(args);

function urlPoints(page) {
  return urlWithQuery('/api/statistic_map_points/', {
    geometry: 'zip',
    page: String(page),
  }, base);
}

async function collectRecentStats(limit) {
  const items = [];
  const byId = new Map();
  let page = 1;
  // collect up to a few pages to get enough variety
  while (items.length < limit && page <= 10) {
    const json = await getJson(urlPoints(page), DEBUG);
    const feats = json?.results?.features || [];
    for (const f of feats) {
      const sid = f?.id;
      const iso = f?.properties?.date || null;
      if (!sid || !iso) continue;
      const rec = byId.get(sid);
      if (!rec) {
        byId.set(sid, { id: sid, name: f?.properties?.name || `Stat ${sid}`, latestDate: iso });
      } else {
        // keep the most recent date
        if (String(iso) > String(rec.latestDate)) rec.latestDate = iso;
      }
    }
    if (!json?.next) break;
    page += 1;
  }
  const list = Array.from(byId.values());
  list.sort((a, b) => String(b.latestDate).localeCompare(String(a.latestDate)));
  return list.slice(0, limit);
}

function runSeriesForStat(statId, latestIso, statName) {
  const y = Number(String(latestIso).slice(0, 4));
  const start = `${Math.max(1970, y - (years - 1))}-01-01`;
  const end = `${y}-12-31`;
  return new Promise((resolve, reject) => {
    const env = { ...process.env, NE_BASE: base };
    const args = [
      'scripts/ne-geo-series.js',
      ...(DRY ? ['--dry=1'] : []),
      ...(SKIP_UNNAMED ? ['--skip-unnamed=1'] : []),
      `--stat=${statId}`,
      ...(statName ? [`--name=${statName}`] : []), // Pass the name we already have!
      '--geometry=zip',
      '--strict=1',
      `--start=${start}`,
      `--end=${end}`,
    ];
    if (DEBUG) console.log('node', args.join(' '));
    const child = spawn('node', args, { stdio: 'inherit', env });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`series failed for ${statId} code=${code}`))));
  });
}

async function main() {
  console.log(`Base: ${base}`);
  console.log(`Mode: ${DRY ? 'DRY' : 'WRITE'}`);
  console.log(`Selecting top ${limit} stats by latest ZIP measurement date; importing last ${years} year(s).`);
  if (SKIP_UNNAMED) console.log(`Skip unnamed: YES (stats without proper names will be skipped)`);

  let picked = await collectRecentStats(limit);
  if (!picked.length) {
    console.log('No stats found via statistic_map_points at geometry=zip.');
    return;
  }

  // Filter out unnamed stats if flag is set
  if (SKIP_UNNAMED) {
    const beforeCount = picked.length;
    picked = picked.filter((s) => !s.name.startsWith('Stat '));
    const skipped = beforeCount - picked.length;
    if (skipped > 0) {
      console.log(`Filtered out ${skipped} stats with placeholder names`);
    }
    if (picked.length === 0) {
      console.log('No stats with proper names found.');
      return;
    }
  }

  console.table(picked.map((r) => ({ id: r.id, name: r.name, latest: r.latestDate })));

  for (const { id: statId, name: statName, latestDate } of picked) {
    console.log(`\n--- Importing ZIP series for ${statId} (${statName}) (window ending ${latestDate.slice(0,10)}) ---`);
    try {
      await runSeriesForStat(statId, latestDate, statName);
    } catch (e) {
      console.warn(`Failed for ${statId}:`, e.message);
    }
  }
}

main().catch((e) => {
  console.error('bulk-zip-import failed:', e.message || e);
  process.exit(1);
});
