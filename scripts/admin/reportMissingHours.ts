#!/usr/bin/env tsx
/**
 * Report how many organizations are missing hours metadata.
 *
 * Usage:
 *   npx tsx scripts/admin/reportMissingHours.ts
 *
 * The script is read-only: it only issues queries to InstantDB.
 */

import "dotenv/config";

import { init } from "@instantdb/admin";

import { initInstantAdmin } from "../_shared/etlUtils.js";

type OrganizationHoursRecord = {
  id: string;
  hours?: Record<string, unknown> | null;
};

const BATCH_SIZE = 500;

const fetchBatch = async (
  db: ReturnType<typeof initInstantAdmin>,
  offset: number,
  limit: number,
): Promise<OrganizationHoursRecord[]> => {
  const resp = await db.query({
    organizations: {
      $: {
        limit,
        offset,
        order: { name: "asc" },
        fields: ["id", "hours"],
      },
    },
  });
  const page = (resp?.data?.organizations ??
    resp.organizations ??
    []) as OrganizationHoursRecord[];
  return page;
};

const isHoursMissing = (hours: OrganizationHoursRecord["hours"]) => {
  if (!hours) return true;
  if (typeof hours !== "object") return false;
  return Object.keys(hours).length === 0;
};

const main = async () => {
  const db = initInstantAdmin(init);

  let offset = 0;
  let total = 0;
  let missing = 0;

  for (;;) {
    const page = await fetchBatch(db, offset, BATCH_SIZE);
    if (page.length === 0) break;
    for (const org of page) {
      total += 1;
      if (isHoursMissing(org.hours)) {
        missing += 1;
      }
    }
    offset += page.length;
    if (page.length < BATCH_SIZE) break;
  }

  const percentMissing = total > 0 ? (missing / total) * 100 : 0;

  console.log("Organizations hours coverage");
  console.log("----------------------------------------");
  console.log(`Total organizations    : ${total}`);
  console.log(`Missing hours (count)  : ${missing}`);
  console.log(
    `Missing hours (percent): ${percentMissing.toFixed(2)}%`,
  );
};

main().catch((error) => {
  console.error("Failed to compute missing hours stats:");
  console.error(error);
  process.exitCode = 1;
});

