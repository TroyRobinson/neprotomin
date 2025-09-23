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

      const existingByName = new Set(
        (data.organizations ?? [])
          .map((org) => org?.name)
          .filter((name): name is string => Boolean(name)),
      );

      const missingSeeds = organizationSeedData.filter(
        (seed) => !existingByName.has(seed.name),
      );

      if (missingSeeds.length === 0) {
        return;
      }

      await db.transact(
        missingSeeds.map((org) =>
          db.tx.organizations[id()].update({
            name: org.name,
            url: org.url,
            latitude: org.latitude,
            longitude: org.longitude,
          }),
        ),
      );
    } catch (error) {
      console.warn(
        "InstantDB seed encountered an error (likely offline); skipping seed",
        error,
      );
    }
  })();

  return seedPromise;
};
