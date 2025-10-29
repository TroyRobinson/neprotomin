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
const PLACE_ID_QUERY_CHUNK = 100;
const EXISTING_PAGE_SIZE = 200;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return [items];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

function makeNameCityKey(name?: string | null, city?: string | null): string | null {
  if (!name || normalizeName(name).length === 0) return null;
  return `${normalizeName(name)}::${(city ?? "").toLowerCase().trim()}`;
}

function formatCoordinate(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(5) : null;
}

function makeLocationSignature(params: {
  name?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): string | null {
  const nameKey = makeNameCityKey(params.name ?? null, params.city ?? null);
  const latKey = formatCoordinate(params.latitude);
  const lngKey = formatCoordinate(params.longitude);
  if (!nameKey || !latKey || !lngKey) return null;
  return `${nameKey}::${latKey}::${lngKey}`;
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
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  lastSyncedAt?: number | null;
};

function toOrgRow(row: any): OrgRow | null {
  if (!row || typeof row.id !== "string") return null;
  return {
    id: row.id,
    placeId: typeof row.placeId === "string" ? row.placeId : null,
    name: typeof row.name === "string" ? row.name : "",
    city: typeof row.city === "string" ? row.city : null,
    state: typeof row.state === "string" ? row.state : null,
    category: typeof row.category === "string" ? row.category : null,
    latitude: typeof row.latitude === "number" ? row.latitude : null,
    longitude: typeof row.longitude === "number" ? row.longitude : null,
    address: typeof row.address === "string" ? row.address : null,
    postalCode: typeof row.postalCode === "string" ? row.postalCode : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    lastSyncedAt: typeof row.lastSyncedAt === "number" ? row.lastSyncedAt : null,
  };
}

function recordInMaps(
  maps: {
    byPlaceId: Map<string, OrgRow>;
    byNameCity: Map<string, OrgRow>;
    byLocation: Map<string, OrgRow>;
  },
  row: OrgRow,
  options: { override?: boolean } = {},
): void {
  const { override = false } = options;
  const placeKey = row.placeId && row.placeId.length > 0 ? row.placeId : null;
  if (placeKey) maps.byPlaceId.set(placeKey, row);

  const nameCityKey = makeNameCityKey(row.name, row.city);
  if (nameCityKey && (override || !maps.byNameCity.has(nameCityKey))) {
    maps.byNameCity.set(nameCityKey, row);
  }

  const locationKey = makeLocationSignature({
    name: row.name,
    city: row.city,
    latitude: row.latitude,
    longitude: row.longitude,
  });
  if (locationKey && (override || !maps.byLocation.has(locationKey))) {
    maps.byLocation.set(locationKey, row);
  }
}

function createPlaceholderRow(idValue: string, place: NormalizedPlace, now: number): OrgRow {
  return {
    id: idValue,
    placeId: place.placeId ?? null,
    name: place.name,
    city: place.city ?? null,
    state: place.state ?? null,
    category: "food",
    latitude: place.latitude,
    longitude: place.longitude,
    address: place.formattedAddress ?? place.shortAddress ?? null,
    postalCode: place.postalCode ?? null,
    phone: place.phone ?? null,
    lastSyncedAt: now,
  };
}

async function fetchExisting(db: ReturnType<typeof initInstantAdmin>, placeIds: string[]) {
  const existingByPlaceId = new Map<string, OrgRow>();
  const existingByNameCity = new Map<string, OrgRow>();
  const existingByLocation = new Map<string, OrgRow>();
  const seenIds = new Set<string>();

  const maps = { byPlaceId: existingByPlaceId, byNameCity: existingByNameCity, byLocation: existingByLocation };

  const addRows = (rows: any[]) => {
    for (const raw of rows) {
      const row = toOrgRow(raw);
      if (!row || seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      recordInMaps(maps, row);
    }
  };

  const placeIdSubset = placeIds.filter((id) => id && id.length > 0);
  if (placeIdSubset.length > 0) {
    for (const chunk of chunkArray(placeIdSubset, PLACE_ID_QUERY_CHUNK)) {
      const resp = await db.query({
        organizations: {
          $: {
            where: { placeId: { $in: chunk } },
            limit: Math.max(chunk.length, 1),
          },
        },
      });
      const rows = resp?.data?.organizations ?? resp.organizations ?? [];
      addRows(rows);
    }
  }

  // Fallback: load existing food orgs for name/city matching
  let offset = 0;
  for (;;) {
    const respAll = await db.query({
      organizations: {
        $: {
          where: { category: "food" },
          limit: EXISTING_PAGE_SIZE,
          offset,
          order: { name: "asc" },
        },
      },
    });
    const rows = respAll?.data?.organizations ?? respAll.organizations ?? [];
    if (rows.length === 0) break;
    addRows(rows);
    if (rows.length < EXISTING_PAGE_SIZE) break;
    offset += rows.length;
  }

  return { existingByPlaceId, existingByNameCity, existingByLocation };
}

function updateMapsWithPlace(
  maps: {
    byPlaceId: Map<string, OrgRow>;
    byNameCity: Map<string, OrgRow>;
    byLocation: Map<string, OrgRow>;
  },
  row: OrgRow,
) {
  recordInMaps(maps, row, { override: true });
}

function buildPayloadFromPlace(place: NormalizedPlace, now: number) {
  const fallbackAddressParts = [place.city, place.state, place.postalCode]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(", ");
  const fallbackAddress = fallbackAddressParts.length > 0 ? fallbackAddressParts : null;
  const address =
    place.formattedAddress ??
    place.shortAddress ??
    fallbackAddress;
  const googleMapsUri =
    typeof place.raw?.googleMapsUri === "string"
      ? (place.raw.googleMapsUri as string)
      : typeof place.raw?.googleMapsLinks === "object" &&
          place.raw.googleMapsLinks &&
          typeof (place.raw.googleMapsLinks as any).placeUri === "string"
        ? ((place.raw.googleMapsLinks as any).placeUri as string)
        : null;
  const websiteOrFallback =
    place.website ??
    googleMapsUri ??
    `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`;
  return {
    name: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    category: "food",
    website: websiteOrFallback,
    url: websiteOrFallback,
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
  const { existingByPlaceId, existingByNameCity, existingByLocation } = await fetchExisting(db, placeIds);
  const existingMaps = {
    byPlaceId: existingByPlaceId,
    byNameCity: existingByNameCity,
    byLocation: existingByLocation,
  };

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
    const nameCityKey = makeNameCityKey(place.name, place.city);
    const locationKey = makeLocationSignature({
      name: place.name,
      city: place.city,
      latitude: place.latitude,
      longitude: place.longitude,
    });
    const existing =
      existingByPlaceId.get(place.placeId) ??
      (locationKey ? existingByLocation.get(locationKey) : undefined) ??
      (nameCityKey ? existingByNameCity.get(nameCityKey) : undefined);

    if (existing) {
      updated.push(place);
      txs.push(
        tx.organizations[existing.id].update({
          ...payloadForDb,
        }),
      );
      const updatedRow: OrgRow = {
        ...existing,
        placeId: payloadForDb.placeId ?? existing.placeId ?? null,
        name: payloadForDb.name ?? existing.name,
        city: payloadForDb.city ?? existing.city ?? null,
        state: payloadForDb.state ?? existing.state ?? null,
        category: payloadForDb.category ?? existing.category,
        latitude: payloadForDb.latitude ?? existing.latitude ?? null,
        longitude: payloadForDb.longitude ?? existing.longitude ?? null,
        address: payloadForDb.address ?? existing.address ?? null,
        postalCode: payloadForDb.postalCode ?? existing.postalCode ?? null,
        phone: payloadForDb.phone ?? existing.phone ?? null,
        lastSyncedAt: payloadForDb.lastSyncedAt ?? existing.lastSyncedAt ?? now,
      };
      updateMapsWithPlace(existingMaps, updatedRow);
    } else {
      created.push(place);
      const newId = id();
      txs.push(tx.organizations[newId].update(payloadForDb));
      const placeholder = createPlaceholderRow(newId, place, now);
      updateMapsWithPlace(existingMaps, placeholder);
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
