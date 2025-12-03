#!/usr/bin/env node
import "dotenv/config";

import { init as initAdmin, id, tx } from "@instantdb/admin";

import {
  ensureAllZipDataLoaded,
  getAllZipCodes,
  getZipBounds,
  getZipCountyName,
} from "../../src/lib/zipBoundaries";
import { getAllCountyIds, getCountyBounds } from "../../src/lib/countyBoundaries";
import { ensureZipCentroidsLoaded, getZipCentroidsMap } from "../../src/lib/zipCentroids";
import { getCountyCentroidsMap, getCountyName } from "../../src/lib/countyCentroids";
import { DEFAULT_PARENT_AREA_BY_KIND } from "../../src/types/areas";
import { getInstantAppId, getInstantAdminToken } from "../_shared/etlUtils.js";

type AreaSeed = {
  kind: "ZIP" | "COUNTY";
  code: string;
  name: string;
  parentCode: string | null;
  centroid: [number, number] | null;
  bounds: [[number, number], [number, number]] | null;
};

const serialize = (value: unknown): string => JSON.stringify(value ?? null);

const initDb = () =>
  initAdmin({
    appId: getInstantAppId(),
    adminToken: getInstantAdminToken(),
  });

async function seedAreas(): Promise<void> {
  const db = initDb();

  console.log("[seed:areas] Loading existing areas…");
  const resp = await db.query({
    areas: {
      $: {
        order: { name: "asc" },
      },
    },
  });

  const existingRows: any[] =
    (resp as any)?.areas ??
    (resp as any)?.data?.areas ??
    [];

  const existingByKey = new Map<string, any>();
  for (const row of existingRows ?? []) {
    const idVal = row?.id as string | undefined;
    const code = typeof row?.code === "string" ? (row.code as string) : undefined;
    const kind = typeof row?.kind === "string" ? (row.kind as string) : undefined;
    if (!idVal || !code || !kind) continue;
    existingByKey.set(`${kind}::${code}`.toLowerCase(), row);
  }

  console.log("[seed:areas] Building seed set for ZIP + COUNTY…");
  const seeds: AreaSeed[] = [];

  await ensureAllZipDataLoaded();
  await ensureZipCentroidsLoaded();
  const zipCentroids = getZipCentroidsMap();

  for (const zip of getAllZipCodes()) {
    const centroid = zipCentroids.get(zip) ?? null;
    const bounds = getZipBounds(zip) ?? null;
    const countyName = getZipCountyName(zip) ?? DEFAULT_PARENT_AREA_BY_KIND.ZIP ?? null;
    seeds.push({
      kind: "ZIP",
      code: zip,
      name: zip,
      parentCode: countyName,
      centroid,
      bounds,
    });
  }

  const countyCentroids = getCountyCentroidsMap();
  for (const county of getAllCountyIds()) {
    const centroid = countyCentroids.get(county) ?? null;
    const bounds = getCountyBounds(county) ?? null;
    const name = getCountyName(county) ?? county;
    seeds.push({
      kind: "COUNTY",
      code: county,
      name,
      parentCode: DEFAULT_PARENT_AREA_BY_KIND.COUNTY ?? null,
      centroid,
      bounds,
    });
  }

  console.log(`[seed:areas] Prepared ${seeds.length} area seeds. Applying to InstantDB…`);
  const txs: any[] = [];
  const now = Date.now();
  const activeKeys = new Set<string>();

  for (const seed of seeds) {
    const key = `${seed.kind}::${seed.code}`.toLowerCase();
    activeKeys.add(key);
    const existing = existingByKey.get(key);
    const payload = {
      code: seed.code,
      kind: seed.kind,
      name: seed.name,
      parentCode: seed.parentCode,
      centroid: seed.centroid,
      bounds: seed.bounds,
      isActive: true,
      updatedAt: now,
    };

    if (existing?.id) {
      const needsUpdate =
        existing.code !== payload.code ||
        existing.kind !== payload.kind ||
        existing.name !== payload.name ||
        (existing.parentCode ?? null) !== (payload.parentCode ?? null) ||
        serialize(existing.centroid) !== serialize(payload.centroid) ||
        serialize(existing.bounds) !== serialize(payload.bounds) ||
        existing.isActive !== true;

      if (needsUpdate) {
        txs.push(tx.areas[existing.id as string].update(payload));
      }
    } else {
      txs.push(tx.areas[id()].update(payload));
    }
  }

  for (const [key, row] of existingByKey.entries()) {
    if (activeKeys.has(key)) continue;
    const rowId = row?.id as string | undefined;
    if (!rowId) continue;
    if (row.isActive === false) continue;
    txs.push(
      tx.areas[rowId].update({
        isActive: false,
        updatedAt: now,
      }),
    );
  }

  if (txs.length === 0) {
    console.log("[seed:areas] No changes to apply.");
    return;
  }

  console.log(`[seed:areas] Applying ${txs.length} area updates…`);
  await db.transact(txs);
  console.log("[seed:areas] Seed completed successfully.");
}

seedAreas().catch((error) => {
  console.error("[seed:areas] Seed failed:", error);
  process.exit(1);
});
