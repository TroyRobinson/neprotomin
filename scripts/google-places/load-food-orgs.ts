#!/usr/bin/env tsx
/**
 * Load Google Places collection into InstantDB organizations table.
 *
 * Usage:
 *   tsx scripts/google-places/load-food-orgs.ts --file=tmp/food_places_*.json
 *   tsx scripts/google-places/load-food-orgs.ts --dry=1
 */

import fs from "node:fs/promises";
import path from "node:path";

import { init as initAdmin, id, tx } from "@instantdb/admin";

import {
  args,
  resolveTmpPath,
} from "./shared.ts";
import type { CollectionPayload, NormalizedPlace } from "./shared.ts";
import {
  initInstantAdmin,
  parseArgs as legacyParseArgs,
} from "../_shared/etlUtils.js";

const DRY_RUN = args.dry === "1" || args.dry === true;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function resolveFileFromArgs(): Promise<string> {
  if (typeof args.file === "string" && args.file.length > 0) {
    return path.resolve(process.cwd(), args.file);
  }
  const tmpDir = resolveTmpPath();
  const entries = await fs.readdir(tmpDir, { withFileTypes: true }).catch(() => []);
  const matches = entries
    .filter((entry) => entry.isFile() && entry.name.startsWith("food_places_") && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort()
    .reverse();
  if (matches.length === 0) {
    throw new Error("No collection files found in tmp/. Provide --file=path.");
  }
  return path.resolve(tmpDir, matches[0]!);
}

async function loadPayload(): Promise<CollectionPayload> {
  const file = await resolveFileFromArgs();
  const raw = await fs.readFile(file, "utf8");
  const payload = JSON.parse(raw) as CollectionPayload;
  console.log(`[load] source file: ${file}`);
  console.log(`[load] records: ${payload.places.length}, excluded ids: ${payload.excludedPlaceIds.length}`);
  return payload;
}

type OrgRow = {
  id: string;
  placeId?: string | null;
  name: string;
  city?: string | null;
  state?: string | null;
  category?: string;
};

async function fetchExisting(db: ReturnType<typeof initInstantAdmin>, placeIds: string[]) {
  const existingByPlaceId = new Map<string, OrgRow>();
  const existingByNameCity = new Map<string, OrgRow>();

  const placeIdSubset = placeIds.filter((id) => id && id.length > 0);
  if (placeIdSubset.length > 0) {
    const resp = await db.query({
      organizations: {
        $: {
          where: { placeId: { $in: placeIdSubset } },
        },
      },
    });
    for (const row of resp?.data?.organizations ?? []) {
      if (!row?.id) continue;
      if (typeof row.placeId === "string") {
        existingByPlaceId.set(row.placeId, row as OrgRow);
      }
      const key = `${normalizeName(row.name ?? "")}::${(row.city ?? "").toLowerCase()}`;
      existingByNameCity.set(key, row as OrgRow);
    }
  }

  // Fallback: load existing food orgs for name/city matching
  const respAll = await db.query({
    organizations: {
      $: {
        where: { category: "food" },
      },
    },
  });
  for (const row of respAll?.data?.organizations ?? []) {
    if (!row?.id) continue;
    if (typeof row.placeId === "string" && !existingByPlaceId.has(row.placeId)) {
      existingByPlaceId.set(row.placeId, row as OrgRow);
    }
    const key = `${normalizeName(row.name ?? "")}::${(row.city ?? "").toLowerCase()}`;
    if (!existingByNameCity.has(key)) {
      existingByNameCity.set(key, row as OrgRow);
    }
  }

  return { existingByPlaceId, existingByNameCity };
}

function buildPayloadFromPlace(place: NormalizedPlace, now: number) {
  const address =
    place.formattedAddress ??
    place.shortAddress ??
    [place.city, place.state, place.postalCode].filter(Boolean).join(", ") ||
    null;
  return {
    name: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    category: "food",
    website: place.website ?? null,
    placeId: place.placeId,
    source: "google_places",
    address,
    city: place.city ?? null,
    state: place.state ?? null,
    postalCode: place.postalCode ?? null,
    phone: place.phone ?? null,
    hours: place.hours ?? null,
    googleCategory: place.googleCategory ?? null,
    keywordFound: place.keywordFound ?? null,
    status: place.status ?? "active",
    lastSyncedAt: now,
    raw: place.raw ?? null,
  };
}

async function main() {
  // Ensure legacy parse to satisfy shared script expectations (some scripts rely on parseArgs side-effects)
  legacyParseArgs();

  const payload = await loadPayload();
  if (payload.places.length === 0) {
    console.log("[load] nothing to import.");
    return;
  }

  const db = initInstantAdmin(initAdmin);

  const placeIds = payload.places.map((p) => p.placeId).filter(Boolean);
  const { existingByPlaceId, existingByNameCity } = await fetchExisting(db, placeIds);

  const txs: any[] = [];
  const created: NormalizedPlace[] = [];
  const updated: NormalizedPlace[] = [];
  const skipped: NormalizedPlace[] = [];

  const now = Date.now();

  for (const place of payload.places) {
    if (!place.placeId) {
      skipped.push(place);
      continue;
    }
    const payloadForDb = buildPayloadFromPlace(place, now);
    const existing =
      existingByPlaceId.get(place.placeId) ??
      existingByNameCity.get(`${normalizeName(place.name)}::${(place.city ?? "").toLowerCase()}`);

    if (existing) {
      updated.push(place);
      txs.push(
        tx.organizations[existing.id].update({
          ...payloadForDb,
        }),
      );
    } else {
      created.push(place);
      const newId = id();
      txs.push(tx.organizations[newId].update(payloadForDb));
    }
  }

  console.log(
    `[load] prepared ${txs.length} transactions (create ${created.length}, update ${updated.length}, skipped ${skipped.length})`,
  );

  if (DRY_RUN) {
    console.log("[load] dry run enabled; no writes performed.");
    return;
  }

  const chunkSize = 50;
  for (let i = 0; i < txs.length; i += chunkSize) {
    const slice = txs.slice(i, i + chunkSize);
    await db.transact(slice);
  }

  console.log("[load] done.");
}

main().catch((error) => {
  console.error("[load] fatal error:", error);
  process.exitCode = 1;
});
