import { id } from "@instantdb/core";

import { organizationSeedData } from "../data/organizations";
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
