#!/usr/bin/env node
import "dotenv/config";

import { init as initAdmin } from "@instantdb/admin";

import { runPointsOfInterestRecompute } from "../../api/_shared/pointsOfInterest.ts";
import { getInstantAppId, getInstantAdminToken } from "../_shared/etlUtils.js";

type BackfillFlags = {
  all: boolean;
  force: boolean;
};

const parseFlags = (): BackfillFlags => {
  const flags = new Set(process.argv.slice(2));
  return {
    all: flags.has("--all"),
    force: flags.has("--force"),
  };
};

const unwrapRows = <T>(resp: unknown, key: string): T[] => {
  const asRecord = (resp && typeof resp === "object" ? resp : null) as
    | Record<string, unknown>
    | null;
  if (!asRecord) return [];
  const direct = asRecord[key];
  if (Array.isArray(direct)) return direct as T[];
  const nested = asRecord.data;
  if (nested && typeof nested === "object" && Array.isArray((nested as Record<string, unknown>)[key])) {
    return (nested as Record<string, unknown>)[key] as T[];
  }
  return [];
};

async function main(): Promise<void> {
  const { all, force } = parseFlags();
  const db = initAdmin({
    appId: getInstantAppId(),
    adminToken: getInstantAdminToken(),
  });

  console.log(
    `[backfill:poi] Loading stats (${all ? "all stats" : "only pointsOfInterestEnabled=true"})...`,
  );
  const resp = await db.query({
    stats: {
      $: {
        fields: ["id", "name", "pointsOfInterestEnabled"],
        order: { name: "asc" },
        limit: 4000,
      },
    },
  });

  const rows = unwrapRows<Array<{ id?: unknown; name?: unknown; pointsOfInterestEnabled?: unknown }>[number]>(
    resp,
    "stats",
  );
  const statIds = rows
    .filter((row) => typeof row?.id === "string")
    .filter((row) => all || row?.pointsOfInterestEnabled === true)
    .map((row) => row.id as string);

  if (statIds.length === 0) {
    console.log("[backfill:poi] No matching stats found.");
    return;
  }

  console.log(`[backfill:poi] Recomputing ${statIds.length} stats...`);
  let totalUpserts = 0;
  let totalDeactivations = 0;
  let successCount = 0;
  let failureCount = 0;

  for (const statId of statIds) {
    try {
      const result = await runPointsOfInterestRecompute(db as any, {
        statId,
        action: "recompute",
        force,
      });
      totalUpserts += result.rowsUpserted;
      totalDeactivations += result.rowsDeactivated;
      successCount += 1;
      console.log(
        `[backfill:poi] ${statId} -> upserted=${result.rowsUpserted} deactivated=${result.rowsDeactivated}${result.skipped ? " (skipped)" : ""}`,
      );
    } catch (error) {
      failureCount += 1;
      console.error(`[backfill:poi] ${statId} failed:`, error);
    }
  }

  console.log(
    `[backfill:poi] Complete. success=${successCount} failed=${failureCount} upserted=${totalUpserts} deactivated=${totalDeactivations}`,
  );
}

main().catch((error) => {
  console.error("[backfill:poi] Fatal error:", error);
  process.exit(1);
});
