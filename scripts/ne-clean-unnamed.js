// Clean up stats with placeholder names (e.g., "Stat eRGj2qGP")
// Run this to remove stats that couldn't get proper names from NE API

import 'dotenv/config';
import { init as initAdmin, tx } from '@instantdb/admin';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [arg.replace(/^--/, ''), true];
  }),
);

const DRY = args.dry === '1' || args.dry === true;

const APP_ID = process.env.VITE_INSTANT_APP_ID || process.env.INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_APP_ADMIN_TOKEN;
if (!APP_ID) throw new Error('Missing VITE_INSTANT_APP_ID/INSTANT_APP_ID');
if (!ADMIN_TOKEN) throw new Error('Missing INSTANT_APP_ADMIN_TOKEN');

const db = initAdmin({ appId: APP_ID, adminToken: ADMIN_TOKEN });

async function main() {
  console.log(DRY ? 'Mode: DRY (preview only)' : 'Mode: WRITE (will delete unnamed stats)');
  console.log('');

  // Find all stats with placeholder names (starts with "Stat ")
  const allStats = await db.query({ stats: {} });
  const unnamedStats = (allStats?.data?.stats || []).filter(s =>
    s.name && s.name.startsWith('Stat ')
  );

  const totalStats = allStats?.data?.stats?.length || 0;
  console.log(`Found ${totalStats} total stats`);
  console.log(`Found ${unnamedStats.length} unnamed stats (placeholder names)`);

  if (unnamedStats.length > 0) {
    console.log('\nUnnamed stats to be deleted:');
    console.table(unnamedStats.map(s => ({
      id: s.id.slice(0, 8),
      name: s.name,
      neId: s.neId || '(none)',
      category: s.category || '(none)'
    })));
  }

  // Find all statData for unnamed stats
  const allStatData = await db.query({ statData: {} });
  const unnamedStatIds = new Set(unnamedStats.map(s => s.id));
  const unnamedStatData = (allStatData?.data?.statData || []).filter(
    sd => unnamedStatIds.has(sd.statId)
  );

  console.log(`\nFound ${unnamedStatData.length} statData entries for unnamed stats`);

  if (unnamedStatData.length > 0) {
    console.log('\nSample unnamed statData (first 5):');
    console.table(unnamedStatData.slice(0, 5).map(sd => ({
      id: sd.id.slice(0, 8),
      statId: sd.statId.slice(0, 8),
      statTitle: sd.statTitle || '(none)',
      date: sd.date,
      areas: Object.keys(sd.data || {}).length
    })));
  }

  if (DRY) {
    console.log('\n--- DRY RUN COMPLETE ---');
    console.log('Re-run without --dry=1 to actually delete this data');
    return;
  }

  // Delete unnamed statData first
  if (unnamedStatData.length > 0) {
    console.log(`\nDeleting ${unnamedStatData.length} unnamed statData entries...`);
    const deleteTxs = unnamedStatData.map(sd => tx.statData[sd.id].delete());
    await db.transact(deleteTxs);
    console.log('✓ Deleted unnamed statData');
  }

  // Delete unnamed stats
  if (unnamedStats.length > 0) {
    console.log(`\nDeleting ${unnamedStats.length} unnamed stats...`);
    const deleteTxs = unnamedStats.map(s => tx.stats[s.id].delete());
    await db.transact(deleteTxs);
    console.log('✓ Deleted unnamed stats');
  }

  console.log('\n✓ Cleanup complete!');
  console.log('\nProperly named stats (with real titles) have been preserved.');
}

main().catch((e) => {
  console.error('Cleanup failed:', e.message || e);
  process.exit(1);
});
