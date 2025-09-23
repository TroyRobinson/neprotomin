import { id } from "@instantdb/core";

import { organizationSeedData } from "../data/organizations";
import { getAllZipCodes } from "./zipBoundaries";
import { db } from "./db";

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
        if (existing && existing.id) {
          // Update if any field differs or category missing
          const needsUpdate =
            existing.url !== seed.url ||
            existing.latitude !== seed.latitude ||
            existing.longitude !== seed.longitude ||
            existing.category !== seed.category;
          if (needsUpdate) {
            txs.push(
              db.tx.organizations[existing.id].update({
                name: seed.name,
                url: seed.url,
                latitude: seed.latitude,
                longitude: seed.longitude,
                category: seed.category,
              }),
            );
          }
        } else {
          // Create new
          txs.push(
            db.tx.organizations[id()].update({
              name: seed.name,
              url: seed.url,
              latitude: seed.latitude,
              longitude: seed.longitude,
              category: seed.category,
            }),
          );
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

let seedAreasPromise: Promise<void> | null = null;

// Deterministic pseudo-random generator from a string key
const hashToUnit = (key: string): number => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Xorshift
  h ^= h << 13;
  h ^= h >>> 17;
  h ^= h << 5;
  // Normalize to [0, 1)
  return ((h >>> 0) % 100000) / 100000;
};

export const ensureAreasSeeded = async (): Promise<void> => {
  if (seedAreasPromise) return seedAreasPromise;

  seedAreasPromise = (async () => {
    try {
      const { data } = await db.queryOnce({
        areas: {
          $: {
            order: { key: "asc" },
          },
        },
      });

      const existingByKey = new Map<string, any>();
      for (const row of data.areas ?? []) {
        if (row?.key) existingByKey.set(row.key, row);
      }

      // Build deterministic demo stats for all Tulsa ZIP codes
      const zips = getAllZipCodes();
      const txs: any[] = [];
      for (const zip of zips) {
        const r1 = hashToUnit(zip);
        const r2 = hashToUnit(zip + ":b");
        const r3 = hashToUnit(zip + ":c");

        // Population: 6k - 42k, rounded to nearest 100
        const populationRaw = 6000 + Math.round(r1 * 36000);
        const population = Math.round(populationRaw / 100) * 100;
        // Avg age: 28 - 44
        const avgAge = Math.round(28 + r2 * 16);
        // Married percent: 22% - 68%
        const marriedPercent = Math.round(22 + r3 * 46);

        const existing = existingByKey.get(zip);
        if (existing && existing.id) {
          const needsUpdate =
            existing.type !== "ZIP" ||
            existing.population !== population ||
            existing.avgAge !== avgAge ||
            existing.marriedPercent !== marriedPercent;
          if (needsUpdate) {
            txs.push(
              db.tx.areas[existing.id].update({
                key: zip,
                type: "ZIP",
                population,
                avgAge,
                marriedPercent,
              }),
            );
          }
        } else {
          txs.push(
            db.tx.areas[id()].update({
              key: zip,
              type: "ZIP",
              population,
              avgAge,
              marriedPercent,
            }),
          );
        }
      }

      if (txs.length > 0) {
        await db.transact(txs);
      }
    } catch (error) {
      console.warn(
        "InstantDB areas seed encountered an error (likely offline); skipping seed",
        error,
      );
    }
  })();

  return seedAreasPromise;
};
