#!/usr/bin/env node
/**
 * Remove orphaned `statRelations` rows where either parentStatId or childStatId
 * no longer exists in `stats`.
 *
 * Usage:
 *   npx tsx scripts/admin/cleanupOrphanedStatRelations.ts --dry-run=1
 *   npx tsx scripts/admin/cleanupOrphanedStatRelations.ts --force=1
 *
 * Requires env vars: VITE_INSTANT_APP_ID, INSTANT_APP_ADMIN_TOKEN
 */
import "dotenv/config";

import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { init, tx } from "@instantdb/admin";
import { initInstantAdmin, parseArgs, isDebug } from "../_shared/etlUtils.js";

interface Options {
  dryRun: boolean;
  force: boolean;
  debug: boolean;
  batchSize: number;
}

const parseOptions = (): Options => {
  const args = parseArgs();
  const dryRun =
    args.dry === "1" ||
    args.dry === true ||
    args["dry-run"] === "1" ||
    args["dry-run"] === true ||
    (!("force" in args) && !("dry" in args) && !("dry-run" in args));
  const force = args.force === "1" || args.force === true;
  const batchSizeRaw = args.batchSize ?? args.batch ?? "100";
  const batchSize = Number.isFinite(Number(batchSizeRaw)) ? Math.max(1, Number(batchSizeRaw)) : 100;
  return {
    dryRun: dryRun && !force,
    force,
    debug: isDebug(args),
    batchSize,
  };
};

const promptConfirm = async (message: string): Promise<boolean> => {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(`${message} (y/N): `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
};

const initDb = () => initInstantAdmin(init);

type StatRow = { id: string };
type StatRelationRow = { id: string; parentStatId: string; childStatId: string; relationKey?: string };

const chunk = <T,>(arr: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

async function run(): Promise<void> {
  const options = parseOptions();
  console.log(`[cleanup:statRelations] Dry run: ${options.dryRun ? "yes" : "no"}`);
  console.log(`[cleanup:statRelations] Force: ${options.force ? "yes" : "no"}`);
  console.log(`[cleanup:statRelations] Batch size: ${options.batchSize}`);

  const db = initDb();

  const statsResp = await db.query({ stats: {} });
  const statsRows: StatRow[] = (statsResp as any)?.stats ?? (statsResp as any)?.data?.stats ?? [];
  const statIds = new Set<string>(statsRows.map((s) => s?.id).filter((id): id is string => typeof id === "string"));
  console.log(`[cleanup:statRelations] Loaded ${statIds.size} stats`);

  const relResp = await db.query({ statRelations: {} });
  const relRows: StatRelationRow[] =
    (relResp as any)?.statRelations ?? (relResp as any)?.data?.statRelations ?? [];
  console.log(`[cleanup:statRelations] Loaded ${relRows.length} statRelations`);

  const orphaned = relRows.filter((r) => {
    if (!r || typeof r.id !== "string") return false;
    if (typeof r.parentStatId !== "string" || typeof r.childStatId !== "string") return false;
    return !statIds.has(r.parentStatId) || !statIds.has(r.childStatId);
  });

  const missingParent = orphaned.filter((r) => !statIds.has(r.parentStatId));
  const missingChild = orphaned.filter((r) => statIds.has(r.parentStatId) && !statIds.has(r.childStatId));

  console.log(
    `[cleanup:statRelations] Found ${orphaned.length} orphaned relations (${missingParent.length} missing parent, ${missingChild.length} missing child)`,
  );

  if (options.debug && orphaned.length > 0) {
    console.log("[cleanup:statRelations] Sample orphaned relation keys:");
    for (const r of orphaned.slice(0, 25)) {
      console.log(`- ${r.relationKey ?? r.id} (${r.parentStatId} -> ${r.childStatId})`);
    }
  }

  if (orphaned.length === 0) return;
  if (options.dryRun) {
    console.log("[cleanup:statRelations] Dry run enabled, no changes executed.");
    return;
  }

  if (!options.force) {
    const ok = await promptConfirm(`Delete ${orphaned.length} orphaned statRelations?`);
    if (!ok) {
      console.log("[cleanup:statRelations] Aborted.");
      return;
    }
  }

  const batches = chunk(orphaned, options.batchSize);
  for (const batch of batches) {
    await db.transact(batch.map((r) => tx.statRelations[r.id].delete()));
  }

  console.log("[cleanup:statRelations] Deletion complete.");
}

run().catch((error) => {
  console.error("[cleanup:statRelations] Failed:", error);
  process.exit(1);
});

