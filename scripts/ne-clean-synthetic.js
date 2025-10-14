// Clean up synthetic data (stats without neId and their associated statData)
// Run this once to remove old synthetic seed data

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
  console.log(DRY ? 'Mode: DRY (preview only)' : 'Mode: WRITE (will delete synthetic data)');
  console.log('');

  // Find all stats WITHOUT neId (these are synthetic)
  const allStats = await db.query({ stats: {} });
  const syntheticStats = (allStats?.data?.stats || []).filter(s => !s.neId);
  
  console.log(`Found ${allStats?.data?.stats?.length || 0} total stats`);
  console.log(`Found ${syntheticStats.length} synthetic stats (no neId)`);
  
  if (syntheticStats.length > 0) {
    console.log('\nSynthetic stats to be deleted:');
    console.table(syntheticStats.map(s => ({ 
      id: s.id.slice(0, 8), 
      name: s.name, 
      category: s.category 
    })));
  }

  // Find all statData for synthetic stats
  const allStatData = await db.query({ statData: {} });
  const syntheticStatIds = new Set(syntheticStats.map(s => s.id));
  const syntheticStatData = (allStatData?.data?.statData || []).filter(
    sd => syntheticStatIds.has(sd.statId)
  );

  console.log(`\nFound ${syntheticStatData.length} statData entries for synthetic stats`);

  if (syntheticStatData.length > 0) {
    console.log('\nSample synthetic statData (first 5):');
    console.table(syntheticStatData.slice(0, 5).map(sd => ({
      id: sd.id.slice(0, 8),
      statId: sd.statId.slice(0, 8),
      date: sd.date,
      areas: Object.keys(sd.data || {}).length
    })));
  }

  if (DRY) {
    console.log('\n--- DRY RUN COMPLETE ---');
    console.log('Re-run without --dry=1 to actually delete this data');
    return;
  }

  // Delete synthetic statData first
  if (syntheticStatData.length > 0) {
    console.log(`\nDeleting ${syntheticStatData.length} synthetic statData entries...`);
    const deleteTxs = syntheticStatData.map(sd => tx.statData[sd.id].delete());
    await db.transact(deleteTxs);
    console.log('✓ Deleted synthetic statData');
  }

  // Delete synthetic stats
  if (syntheticStats.length > 0) {
    console.log(`\nDeleting ${syntheticStats.length} synthetic stats...`);
    const deleteTxs = syntheticStats.map(s => tx.stats[s.id].delete());
    await db.transact(deleteTxs);
    console.log('✓ Deleted synthetic stats');
  }

  console.log('\n✓ Cleanup complete!');
  console.log('\nReal data (with neId) has been preserved.');
}

main().catch((e) => {
  console.error('Cleanup failed:', e.message || e);
  process.exit(1);
});
