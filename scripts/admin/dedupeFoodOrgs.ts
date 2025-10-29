#!/usr/bin/env tsx
/**
 * Identify and remove duplicate food organizations in InstantDB.
 *
 * Duplicates are detected by normalized name + location signature.
 * Default mode is dry-run; pass `--dry=0` to apply deletions.
 */

import "dotenv/config";

import { init, tx } from "@instantdb/admin";

import {
  initInstantAdmin,
  parseArgs,
} from "../_shared/etlUtils.js";

type OrganizationRecord = {
  id: string;
  name: string;
  placeId?: string | null;
  source?: string | null;
  category?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  lastSyncedAt?: number | null;
};

type DuplicateGroup = {
  signature: string;
  keep: OrganizationRecord;
  duplicates: OrganizationRecord[];
};

const normalizeName = (value: string | null | undefined): string => {
  if (!value) return "";
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
};

const normalizePhone = (value: string | null | undefined): string => {
  if (!value) return "";
  return value.replace(/\D+/g, "");
};

const toCoordKey = (value: number | null | undefined): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // Rounded to ~1m precision to collapse trivial jitter.
  return value.toFixed(5);
};

const makeLocationSignature = (org: OrganizationRecord): string | null => {
  const nameKey = normalizeName(org.name);
  if (!nameKey) return null;

  const latKey = toCoordKey(org.latitude ?? null);
  const lngKey = toCoordKey(org.longitude ?? null);
  if (latKey && lngKey) {
    const cityKey = (org.city ?? "").toLowerCase().trim();
    return `${nameKey}::${latKey}::${lngKey}::${cityKey}`;
  }

  const addressKey = (org.address ?? "").toLowerCase().trim();
  const cityKey = (org.city ?? "").toLowerCase().trim();
  const postalKey = (org.postalCode ?? "").toLowerCase().trim();
  if (!addressKey && !cityKey && !postalKey) return null;
  return `${nameKey}::${addressKey}::${cityKey}::${postalKey}`;
};

const fetchAllFoodOrganizations = async (
  db: ReturnType<typeof initInstantAdmin>,
  pageSize: number,
): Promise<OrganizationRecord[]> => {
  const results: OrganizationRecord[] = [];
  let offset = 0;
  for (;;) {
    const resp = await db.query({
      organizations: {
        $: {
          where: { category: "food" },
          limit: pageSize,
          offset,
          order: { name: "asc" },
        },
      },
    });
    const rows = (resp?.data?.organizations ?? resp.organizations ?? []) as OrganizationRecord[];
    if (rows.length === 0) break;
    results.push(...rows);
    if (rows.length < pageSize) break;
    offset += rows.length;
  }
  return results;
};

const recordComparator = (a: OrganizationRecord, b: OrganizationRecord): number => {
  const placeIdDiff = Number(Boolean(b.placeId)) - Number(Boolean(a.placeId));
  if (placeIdDiff !== 0) return placeIdDiff;
  const lastSyncedA = typeof a.lastSyncedAt === "number" ? a.lastSyncedAt : 0;
  const lastSyncedB = typeof b.lastSyncedAt === "number" ? b.lastSyncedAt : 0;
  if (lastSyncedB !== lastSyncedA) return lastSyncedB - lastSyncedA;
  return a.id.localeCompare(b.id);
};

const describeRecord = (org: OrganizationRecord): string => {
  const parts = [
    org.id,
    org.name,
    org.city ?? "",
    toCoordKey(org.latitude) ?? "?",
    toCoordKey(org.longitude) ?? "?",
    normalizePhone(org.phone),
  ];
  return parts.join(" | ");
};

const main = async () => {
  const args = parseArgs();
  const dryRun = !(args.dry === "0" || args.dry === 0);
  const sourceFilterRaw = typeof args.source === "string" ? args.source.trim() : "";
  const sourceFilter = sourceFilterRaw === "" || sourceFilterRaw === "any" || sourceFilterRaw === "all" ? null : sourceFilterRaw;
  const pageSize = Number(args.pageSize ?? args.limit ?? 200);
  if (!Number.isFinite(pageSize) || pageSize <= 0) {
    throw new Error("pageSize must be a positive number");
  }

  const db = initInstantAdmin(init);
  const allFoodOrgs = await fetchAllFoodOrganizations(db, pageSize);

  const bySignature = new Map<string, OrganizationRecord[]>();
  const byPlaceId = new Map<string, OrganizationRecord[]>();

  for (const org of allFoodOrgs) {
    if (sourceFilter && (org.source ?? null) !== sourceFilter) {
      continue;
    }

    if (org.placeId) {
      const bucket = byPlaceId.get(org.placeId) ?? [];
      bucket.push(org);
      byPlaceId.set(org.placeId, bucket);
    }

    const signature = makeLocationSignature(org);
    if (!signature) continue;
    const bucket = bySignature.get(signature) ?? [];
    bucket.push(org);
    bySignature.set(signature, bucket);
  }

  const duplicateGroups: DuplicateGroup[] = [];
  let duplicateTotal = 0;

  for (const [signature, records] of bySignature.entries()) {
    if (records.length <= 1) continue;
    const sorted = [...records].sort(recordComparator);
    const [keep, ...rest] = sorted;
    duplicateGroups.push({ signature, keep, duplicates: rest });
    duplicateTotal += rest.length;
  }

  const placeIdCollisions: DuplicateGroup[] = [];
  for (const [placeId, records] of byPlaceId.entries()) {
    if (records.length <= 1) continue;
    const sorted = [...records].sort(recordComparator);
    const [keep, ...rest] = sorted;
    placeIdCollisions.push({
      signature: `placeId:${placeId}`,
      keep,
      duplicates: rest,
    });
  }

  const toRemove = new Map<string, { reason: string; keepId: string }>();
  for (const group of duplicateGroups) {
    for (const dup of group.duplicates) {
      toRemove.set(dup.id, { reason: group.signature, keepId: group.keep.id });
    }
  }
  for (const group of placeIdCollisions) {
    for (const dup of group.duplicates) {
      toRemove.set(dup.id, { reason: group.signature, keepId: group.keep.id });
    }
  }

  console.log(`[dedupe] scanned ${allFoodOrgs.length} food organizations${sourceFilter ? ` (source=${sourceFilter})` : ""}.`);
  console.log(`[dedupe] detected ${duplicateGroups.length} duplicate location groups covering ${duplicateTotal} records.`);
  if (placeIdCollisions.length > 0) {
    console.log(`[dedupe] detected ${placeIdCollisions.length} placeId collision groups.`);
  }
  console.log(`[dedupe] ${toRemove.size} records marked for deletion.`);

  if (duplicateGroups.length > 0) {
    const preview = duplicateGroups.slice(0, 5);
    console.log("[dedupe] sample duplicate groups:");
    for (const group of preview) {
      console.log(`  keep -> ${describeRecord(group.keep)}`);
      for (const dup of group.duplicates) {
        console.log(`    drop -> ${describeRecord(dup)}`);
      }
    }
    if (duplicateGroups.length > preview.length) {
      console.log(`  …${duplicateGroups.length - preview.length} more groups`);
    }
  }

  if (toRemove.size === 0) {
    console.log("[dedupe] no duplicates to remove.");
    return;
  }

  if (dryRun) {
    console.log("[dedupe] dry run enabled; no records deleted.");
    return;
  }

  const deletions = Array.from(toRemove.entries());
  const chunkSize = 50;
  for (let i = 0; i < deletions.length; i += chunkSize) {
    const slice = deletions.slice(i, i + chunkSize);
    const txs = slice.map(([id]) => tx.organizations[id].delete());
    await db.transact(txs);
  }

  console.log(`[dedupe] deleted ${toRemove.size} duplicate records.`);
};

main().catch((error) => {
  console.error("[dedupe] fatal error:", error);
  process.exit(1);
});
