#!/usr/bin/env tsx

import 'dotenv/config';

import { init as initAdmin, tx } from '@instantdb/admin';

import { initInstantAdmin, parseArgs } from '../_shared/etlUtils.js';

const args = parseArgs();
const namesArg = args.names ?? args.name ?? '';
const names = typeof namesArg === 'string'
  ? namesArg.split(',').map((n) => n.trim()).filter(Boolean)
  : Array.isArray(namesArg)
  ? namesArg
  : [];

if (!names.length) {
  console.error('Usage: tsx scripts/admin/deleteStatsByName.ts --names="Stat A,Stat B"');
  process.exit(1);
}

const db = initInstantAdmin(initAdmin);

async function deleteByName(name: string) {
  const resp = await db.query({
    stats: {
      $: {
        where: { name },
      },
    },
  });
  const stats = (resp?.stats as any[]) ?? (resp?.data?.stats as any[]) ?? [];
  if (!stats.length) {
    console.log(`No stats found for "${name}"`);
    return;
  }

  for (const stat of stats) {
    const statId = stat?.id;
    if (!statId) continue;

    const statDataResp = await db.query({
      statData: {
        $: {
          where: { statId },
        },
      },
    });
    const statDataRows = (statDataResp?.statData as any[]) ?? (statDataResp?.data?.statData as any[]) ?? [];
    for (const row of statDataRows) {
      if (!row?.id) continue;
      await db.transact(tx.statData[row.id].delete());
    }
    await db.transact(tx.stats[statId].delete());
    console.log(`Deleted stat "${name}" (${statId}) with ${statDataRows.length} statData rows.`);
  }
}

async function main() {
  for (const name of names) {
    await deleteByName(name);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Failed to delete stats:', error);
    process.exit(1);
  });
