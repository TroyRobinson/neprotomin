import { id } from "@instantdb/core";

import { organizationSeedData } from "../data/organizations";
import { ensureAllZipDataLoaded, getAllZipCodes, getZipBounds, getZipCountyName } from "./zipBoundaries";
import { getAllCountyIds, getCountyBounds } from "./countyBoundaries";
import { db } from "./db";
import { ensureZipCentroidsLoaded, getZipCentroidsMap } from "./zipCentroids";
import { getCountyCentroidsMap, getCountyName } from "./countyCentroids";
import type { AreaKind } from "../types/areas";
import { DEFAULT_PARENT_AREA_BY_KIND } from "../types/areas";
import { isSyntheticSeedEnabled } from "./env";

let seedPromise: Promise<void> | null = null;

export const ensureOrganizationsSeeded = async (): Promise<void> => {
  if (seedPromise) {
    return seedPromise;
  }

  seedPromise = (async () => {
    try {
      const { data } = await db.queryOnce({
        organizations: {
          $: {
            order: { name: "asc" },
          },
        },
      });

      const existingByName = new Map<string, any>();
      for (const org of data.organizations ?? []) {
        if (org?.name) existingByName.set(org.name, org);
      }

      const txs: any[] = [];
      for (const seed of organizationSeedData) {
        const existing = existingByName.get(seed.name);
        const payload = {
          name: seed.name,
          website: seed.website ?? null,
          latitude: seed.latitude,
          longitude: seed.longitude,
          category: seed.category,
          status: seed.status ?? "active",
          source: "seed",
          address: seed.address ?? null,
          city: seed.city ?? null,
          state: seed.state ?? null,
          postalCode: seed.postalCode ?? null,
        };
        if (existing && existing.id) {
          const needsUpdate =
            existing.website !== payload.website ||
            existing.latitude !== payload.latitude ||
            existing.longitude !== payload.longitude ||
            existing.category !== payload.category ||
            (existing.status ?? "active") !== payload.status ||
            (existing.source ?? null) !== payload.source ||
            (existing.address ?? null) !== payload.address ||
            (existing.city ?? null) !== payload.city ||
            (existing.state ?? null) !== payload.state ||
            (existing.postalCode ?? null) !== payload.postalCode;
          if (needsUpdate) {
            txs.push(db.tx.organizations[existing.id].update(payload));
          }
        } else {
          txs.push(db.tx.organizations[id()].update(payload));
        }
      }

      if (txs.length > 0) {
        await db.transact(txs);
      }
    } catch (error) {
      console.warn(
        "InstantDB seed encountered an error (likely offline); skipping seed",
        error,
      );
    }
  })();

  return seedPromise;
};

type AreaSeed = {
  kind: AreaKind;
  code: string;
  name: string;
  parentCode: string | null;
  centroid: [number, number] | null;
  bounds: [[number, number], [number, number]] | null;
};

let seedAreasPromise: Promise<void> | null = null;

/**
 * Seed area metadata so ZIPs, counties, and future area kinds share one lookup table.
 * This keeps downstream queries simple once we mix area types in the UI.
 */
export const ensureAreasSeeded = async (): Promise<void> => {
  if (!isSyntheticSeedEnabled()) {
    return;
  }

  if (seedAreasPromise) return seedAreasPromise;

  seedAreasPromise = (async () => {
    try {
      const { data } = await db.queryOnce({
        areas: {
          $: { order: { name: "asc" } },
        },
      });

      const existingByKey = new Map<string, any>();
      for (const row of data.areas ?? []) {
        const id = row?.id as string | undefined;
        const code = typeof row?.code === "string" ? (row.code as string) : undefined;
        const kind = typeof row?.kind === "string" ? (row.kind as string) : undefined;
        if (!id || !code || !kind) continue;
        existingByKey.set(`${kind}::${code}`.toLowerCase(), row);
      }

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

      const txs: any[] = [];
      const now = Date.now();
      const activeKeys = new Set<string>();

      const serialize = (value: unknown) => JSON.stringify(value ?? null);

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
            txs.push(db.tx.areas[existing.id as string].update(payload));
          }
        } else {
          txs.push(db.tx.areas[id()].update(payload));
        }
      }

      for (const [key, row] of existingByKey.entries()) {
        if (activeKeys.has(key)) continue;
        const rowId = row?.id as string | undefined;
        if (!rowId) continue;
        if (row.isActive === false) continue;
        txs.push(
          db.tx.areas[rowId].update({
            isActive: false,
            updatedAt: now,
          }),
        );
      }

      if (txs.length > 0) {
        await db.transact(txs);
      }
    } catch (error) {
      console.warn("InstantDB area seed encountered an error (likely offline); skipping seed", error);
    }
  })();

  return seedAreasPromise;
};
