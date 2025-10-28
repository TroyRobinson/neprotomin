// Migration script to populate createdOn, lastUpdated, and statTitle fields
// Run this once after schema update to backfill existing data
//
// Usage:
//   npm run ne:migrate:timestamps
//   npm run ne:migrate:timestamps:dry  (preview changes without writing)

import 'dotenv/config';
import { init as initAdmin, tx } from '@instantdb/admin';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [arg.replace(/^--/, ''), true];
  }),
);

const DRY = args.dry === '1' || args.dry === true;
const DEBUG = !!process.env.DEBUG || args.debug === '1' || args.debug === true;

const APP_ID = process.env.VITE_INSTANT_APP_ID || process.env.INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_APP_ADMIN_TOKEN;
if (!APP_ID) throw new Error('Missing VITE_INSTANT_APP_ID/INSTANT_APP_ID');
if (!ADMIN_TOKEN) throw new Error('Missing INSTANT_APP_ADMIN_TOKEN');

const db = initAdmin({ appId: APP_ID, adminToken: ADMIN_TOKEN });

async function main() {
  console.log(DRY ? 'Mode: DRY (preview only)' : 'Mode: WRITE');

  const now = Date.now();

  // Fetch all stats
  const statsResp = await db.query({ stats: {} });
  const stats = statsResp?.data?.stats || [];
  console.log(`Found ${stats.length} stats to process`);

  const statById = new Map();
  for (const s of stats) {
    statById.set(s.id, s);
  }

  const statsTxs = [];
  for (const s of stats) {
    const updates = {};
    let needsUpdate = false;

    if (!s.createdOn) {
      updates.createdOn = now;
      needsUpdate = true;
    }
    if (!s.lastUpdated) {
      updates.lastUpdated = now;
      needsUpdate = true;
    }

    if (needsUpdate) {
      statsTxs.push(tx.stats[s.id].update(updates));
      if (DEBUG) {
        console.log(`[stats] ${s.name} (${s.id}): ${JSON.stringify(updates)}`);
      }
    }
  }

  console.log(`Stats: ${statsTxs.length} need timestamp updates`);

  // Fetch all statData
  const statDataResp = await db.query({ statData: {} });
  const statData = statDataResp?.data?.statData || [];
  console.log(`Found ${statData.length} statData entries to process`);

  const statDataTxs = [];
  for (const sd of statData) {
    const updates = {};
    let needsUpdate = false;

    // Populate statTitle from the associated stat
    if (!sd.statTitle && sd.statId) {
      const stat = statById.get(sd.statId);
      if (stat && stat.name) {
        updates.statTitle = stat.name;
        needsUpdate = true;
      }
    }

    if (!sd.createdOn) {
      updates.createdOn = now;
      needsUpdate = true;
    }
    if (!sd.lastUpdated) {
      updates.lastUpdated = now;
      needsUpdate = true;
    }

    if (needsUpdate) {
      statDataTxs.push(tx.statData[sd.id].update(updates));
      if (DEBUG) {
        console.log(`[statData] ${sd.name} (${sd.id}): ${JSON.stringify(updates)}`);
      }
    }
  }

  console.log(`StatData: ${statDataTxs.length} need updates (statTitle and/or timestamps)`);

  if (DRY) {
    console.log('\nDry run complete. No changes written.');
    return;
  }

  // Execute updates
  if (statsTxs.length > 0) {
    console.log(`Writing ${statsTxs.length} stats updates...`);
    await db.transact(statsTxs);
  }
  if (statDataTxs.length > 0) {
    console.log(`Writing ${statDataTxs.length} statData updates...`);
    await db.transact(statDataTxs);
  }

  console.log('Migration complete!');
}

main().catch((e) => {
  console.error('Migration failed:', e.message || e);
  process.exit(1);
});
