#!/usr/bin/env node
/**
 * Backfill `statDataSummaries` from existing `statData` rows.
 *
 * This creates/updates one summary row per (statId, name, parentArea, boundaryType),
 * representing the latest `date` for that key.
 *
 * Usage:
 *   npx tsx scripts/admin/backfillStatDataSummaries.ts
 *
 * Requires env vars: VITE_INSTANT_APP_ID, INSTANT_APP_ADMIN_TOKEN
 */
import "dotenv/config";

import { init as initAdmin, lookup, tx } from "@instantdb/admin";
import { getInstantAppId, getInstantAdminToken } from "../_shared/etlUtils.js";

const PAGE_SIZE = 25;
const UPSERT_CHUNK_SIZE = 50;

const buildSummaryKey = (row: {
  statId: string;
  name: string;
  parentArea: string;
  boundaryType: string;
}) => `${row.statId}::${row.name}::${row.parentArea}::${row.boundaryType}`;

const computeNumericSummary = (data: unknown) => {
  const values = Object.values((data ?? {}) as Record<string, unknown>);
  let count = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    count += 1;
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (count === 0) return { count: 0, sum: 0, avg: 0, min: 0, max: 0 };
  return { count, sum, avg: sum / count, min, max };
};

const unwrap = (resp: any, key: string): any[] => {
  if (!resp) return [];
  if (Array.isArray(resp[key])) return resp[key];
  if (resp.data && Array.isArray(resp.data[key])) return resp.data[key];
  return [];
};

async function main(): Promise<void> {
  const db = initAdmin({
    appId: getInstantAppId(),
    adminToken: getInstantAdminToken(),
  });

  console.log("[backfill:statDataSummaries] Scanning statData…");

  const latestByKey = new Map<
    string,
    {
      summaryKey: string;
      statId: string;
      name: string;
      parentArea: string;
      boundaryType: string;
      date: string;
      minDate: string;
      maxDate: string;
      type: string;
      summary: { count: number; sum: number; avg: number; min: number; max: number };
    }
  >();

  let offset = 0;
  while (true) {
    const resp = await db.query({
      statData: {
        $: {
          where: { name: "root" },
          fields: ["statId", "name", "parentArea", "boundaryType", "date", "type", "data"],
          order: { statId: "asc" },
          limit: PAGE_SIZE,
          offset,
        },
      },
    });
    const rows = unwrap(resp, "statData");
    if (rows.length === 0) break;

    for (const row of rows) {
      const statId = typeof row?.statId === "string" ? row.statId : null;
      const name = typeof row?.name === "string" ? row.name : null;
      const parentArea = typeof row?.parentArea === "string" ? row.parentArea : null;
      const boundaryType = typeof row?.boundaryType === "string" ? row.boundaryType : null;
      const date = typeof row?.date === "string" ? row.date : typeof row?.date === "number" ? String(row.date) : null;
      const type = typeof row?.type === "string" ? row.type : "count";
      if (!statId || !name || !parentArea || !boundaryType || !date) continue;

      const summaryKey = buildSummaryKey({ statId, name, parentArea, boundaryType });
      const existing = latestByKey.get(summaryKey);
      if (existing) {
        if (date.localeCompare(existing.minDate) < 0) existing.minDate = date;
        if (date.localeCompare(existing.maxDate) > 0) existing.maxDate = date;
        if (date.localeCompare(existing.date) < 0) continue;
      }

      latestByKey.set(summaryKey, {
        summaryKey,
        statId,
        name,
        parentArea,
        boundaryType,
        date,
        minDate: existing?.minDate ?? date,
        maxDate: existing?.maxDate ?? date,
        type,
        summary: computeNumericSummary(row?.data),
      });
    }

    offset += rows.length;
    if (offset % (PAGE_SIZE * 20) === 0) {
      console.log(`[backfill:statDataSummaries] scanned ${offset} rows…`);
    }
  }

  console.log(`[backfill:statDataSummaries] Found ${latestByKey.size} latest keys. Upserting…`);

  const keys = Array.from(latestByKey.keys());
  const now = Date.now();

  for (let i = 0; i < keys.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = keys.slice(i, i + UPSERT_CHUNK_SIZE);
    const txs: any[] = [];
    for (const summaryKey of chunk) {
      const entry = latestByKey.get(summaryKey);
      if (!entry) continue;
      const record = {
        statId: entry.statId,
        name: entry.name,
        parentArea: entry.parentArea,
        boundaryType: entry.boundaryType,
        date: entry.date,
        minDate: entry.minDate,
        maxDate: entry.maxDate,
        type: entry.type,
        count: entry.summary.count,
        sum: entry.summary.sum,
        avg: entry.summary.avg,
        min: entry.summary.min,
        max: entry.summary.max,
        updatedAt: now,
        createdAt: now,
      };
      // Upsert by unique `summaryKey` so this script is idempotent and doesn't
      // require managing deterministic IDs.
      txs.push(tx.statDataSummaries[lookup("summaryKey", summaryKey)].update(record));
    }
    if (txs.length) {
      await db.transact(txs);
    }
    console.log(`[backfill:statDataSummaries] Upserted ${Math.min(i + UPSERT_CHUNK_SIZE, keys.length)}/${keys.length}`);
  }

  console.log("[backfill:statDataSummaries] Done.");
}

main().catch((error) => {
  console.error("[backfill:statDataSummaries] Failed:", error);
  process.exit(1);
});
