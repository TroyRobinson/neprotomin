#!/usr/bin/env node
/**
 * InstantDB data reset helper.
 *
 * Supports wiping Census-only stats, NE-only stats, or everything.
 * Includes dry-run previews and optional interactive confirmation.
 *
 * Usage examples:
 *   npm run admin:reset -- --scope=census --dry-run
 *   npm run admin:reset -- --scope=all --force
 */

import "dotenv/config";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { init, tx } from "@instantdb/admin";

import {
  initInstantAdmin,
  parseArgs,
  isDebug,
} from "../_shared/etlUtils.js";

type ResetScope = "census" | "ne" | "all";

const SUPPORTED_SCOPES: ResetScope[] = ["census", "ne", "all"];

interface Options {
  scope: ResetScope;
  dryRun: boolean;
  force: boolean;
  debug: boolean;
}

const parseOptions = (): Options => {
  const args = parseArgs();
  const scope = (args.scope || args.s || "census") as ResetScope;
  if (!SUPPORTED_SCOPES.includes(scope)) {
    throw new Error(`Unsupported scope "${scope}". Use one of: ${SUPPORTED_SCOPES.join(", ")}`);
  }
  return {
    scope,
    dryRun: args.dry === "1" || args.dry === true || args["dry-run"] === "1",
    force: args.force === "1" || args.force === true,
    debug: isDebug(args),
  };
};

const describeScope = (scope: ResetScope): string => {
  switch (scope) {
    case "census":
      return 'stats/statData where `source === "Census"`';
    case "ne":
      return 'stats/statData where `source === "NE"`';
    case "all":
      return "all stats/statData documents";
    default:
      return scope;
  }
};

const initDb = () => initInstantAdmin(init);

interface EntitiesToDelete {
  stats: string[];
  statData: string[];
}

const fetchIdsForScope = async (db: ReturnType<typeof initDb>, scope: ResetScope): Promise<EntitiesToDelete> => {
  if (scope === "all") {
    // I think that InstantDB doesn't support 'select' in queries, so we fetch all fields and extract ids
    const resp = await db.query({
      stats: {},
      statData: {},
    });
    const stats = (resp.stats ?? resp.data?.stats ?? []).map((row: any) => row.id);
    const statData = (resp.statData ?? resp.data?.statData ?? []).map((row: any) => row.id);
    return { stats, statData };
  }

  const source = scope === "census" ? "Census" : "NE";
  const resp = await db.query({
    stats: {
      $: {
        where: { source },
      },
    },
    statData: {
      $: {
        where: { source },
      },
    },
  });
  const stats = (resp.stats ?? resp.data?.stats ?? []).map((row: any) => row.id);
  const statData = (resp.statData ?? resp.data?.statData ?? []).map((row: any) => row.id);
  return { stats, statData };
};

const promptConfirm = async (message: string): Promise<boolean> => {
  const rl = readline.createInterface({ input, output });
  const answer = await rl.question(`${message} (y/N): `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
};

const deleteEntities = async (
  db: ReturnType<typeof initDb>,
  ids: EntitiesToDelete,
  options: Options,
) => {
  const { stats, statData } = ids;
  if (stats.length === 0 && statData.length === 0) {
    console.log("Nothing to delete for the selected scope.");
    return;
  }

  const batches: Array<() => Promise<void>> = [];

  for (const id of statData) {
    batches.push(async () => {
      await db.transact(tx.statData[id].delete());
      if (options.debug) console.log(`deleted statData ${id}`);
    });
  }

  for (const id of stats) {
    batches.push(async () => {
      await db.transact(tx.stats[id].delete());
      if (options.debug) console.log(`deleted stat ${id}`);
    });
  }

  for (const run of batches) {
    await run();
  }
};

const run = async () => {
  const options = parseOptions();

  console.log(`Reset scope: ${options.scope} (${describeScope(options.scope)})`);
  console.log(`Dry run: ${options.dryRun ? "yes" : "no"}`);
  console.log(`Force: ${options.force ? "yes" : "no"}`);

  const db = initDb();
  const ids = await fetchIdsForScope(db, options.scope);

  console.log(`Found ${ids.stats.length} stats and ${ids.statData.length} statData rows to delete.`);

  if (options.dryRun) {
    console.log("Dry run enabled, no changes executed.");
    return;
  }

  if (!options.force) {
    const confirmed = await promptConfirm("Proceed with deletion?");
    if (!confirmed) {
      console.log("Aborted.");
      return;
    }
  }

  await deleteEntities(db, ids, options);
  console.log("Deletion complete.");
};

run().catch((error) => {
  console.error("Reset script failed:", error);
  process.exit(1);
});
