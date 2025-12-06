#!/usr/bin/env node
/**
 * Seed the `categories` table in InstantDB with canonical category definitions.
 * Idempotent: upserts by slug, updates existing rows if changed.
 *
 * Usage:
 *   npx tsx scripts/admin/seedCategories.ts
 *
 * Requires env vars: VITE_INSTANT_APP_ID, INSTANT_APP_ADMIN_TOKEN
 */
import "dotenv/config";

import { init as initAdmin, id, tx } from "@instantdb/admin";
import { getInstantAppId, getInstantAdminToken } from "../_shared/etlUtils.js";

// Canonical category seed data
const CATEGORY_SEEDS = [
  {
    slug: "food",
    label: "Food",
    sortOrder: 1,
    active: true,
    forStats: true,
    forOrgs: true,
    showOnMap: true,
    showInSidebar: true,
  },
  {
    slug: "health",
    label: "Health",
    sortOrder: 2,
    active: true,
    forStats: true,
    forOrgs: true,
    showOnMap: true,
    showInSidebar: true,
  },
  {
    slug: "education",
    label: "Education",
    sortOrder: 3,
    active: true,
    forStats: true,
    forOrgs: true,
    showOnMap: true,
    showInSidebar: true,
  },
  {
    slug: "justice",
    label: "Justice",
    sortOrder: 4,
    active: true,
    forStats: true,
    forOrgs: true,
    showOnMap: true,
    showInSidebar: true,
  },
  {
    slug: "economy",
    label: "Economy",
    sortOrder: 5,
    active: true,
    forStats: true,
    forOrgs: true,
    showOnMap: true,
    showInSidebar: true,
  },
  {
    slug: "demographics",
    label: "Demographics",
    sortOrder: 6,
    active: true,
    forStats: true,
    forOrgs: false,
    showOnMap: false,
    showInSidebar: true,
  },
  {
    slug: "housing",
    label: "Housing",
    sortOrder: 7,
    active: true,
    forStats: true,
    forOrgs: false,
    showOnMap: false,
    showInSidebar: true,
  },
] as const;

type CategorySeed = (typeof CATEGORY_SEEDS)[number];

const initDb = () =>
  initAdmin({
    appId: getInstantAppId(),
    adminToken: getInstantAdminToken(),
  });

async function seedCategories(): Promise<void> {
  const db = initDb();

  console.log("[seed:categories] Loading existing categories…");
  const resp = await db.query({
    categories: {
      $: {
        order: { sortOrder: "asc" },
      },
    },
  });

  const existingRows: any[] =
    (resp as any)?.categories ?? (resp as any)?.data?.categories ?? [];

  const existingBySlug = new Map<string, any>();
  for (const row of existingRows) {
    const rowId = row?.id as string | undefined;
    const slug = typeof row?.slug === "string" ? row.slug : undefined;
    if (!rowId || !slug) continue;
    existingBySlug.set(slug, row);
  }

  console.log(
    `[seed:categories] Found ${existingBySlug.size} existing categories.`
  );

  const txs: any[] = [];
  const now = Date.now();

  for (const seed of CATEGORY_SEEDS) {
    const existing = existingBySlug.get(seed.slug);
    const payload = {
      slug: seed.slug,
      label: seed.label,
      sortOrder: seed.sortOrder,
      active: seed.active,
      forStats: seed.forStats,
      forOrgs: seed.forOrgs,
      showOnMap: seed.showOnMap,
      showInSidebar: seed.showInSidebar,
      updatedAt: now,
    };

    if (existing?.id) {
      // Check if update needed
      const needsUpdate =
        existing.label !== payload.label ||
        existing.sortOrder !== payload.sortOrder ||
        existing.active !== payload.active ||
        existing.forStats !== payload.forStats ||
        existing.forOrgs !== payload.forOrgs ||
        existing.showOnMap !== payload.showOnMap ||
        existing.showInSidebar !== payload.showInSidebar;

      if (needsUpdate) {
        console.log(`[seed:categories] Updating: ${seed.slug}`);
        txs.push(tx.categories[existing.id as string].update(payload));
      } else {
        console.log(`[seed:categories] Unchanged: ${seed.slug}`);
      }
    } else {
      console.log(`[seed:categories] Creating: ${seed.slug}`);
      txs.push(
        tx.categories[id()].update({
          ...payload,
          createdAt: now,
        })
      );
    }
  }

  if (txs.length === 0) {
    console.log("[seed:categories] No changes to apply.");
    return;
  }

  console.log(`[seed:categories] Applying ${txs.length} category updates…`);
  await db.transact(txs);
  console.log("[seed:categories] Seed completed successfully.");
}

seedCategories().catch((error) => {
  console.error("[seed:categories] Seed failed:", error);
  process.exit(1);
});
