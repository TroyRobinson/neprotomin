#!/usr/bin/env tsx
/**
 * Generate a newline-delimited list of organization ids to remove for
 * same-name, nearby duplicates. For each proximity group we keep the record
 * with the richest metadata and mark the least-informative record for removal
 * (ties fall back to lexical id order).
 *
 * Usage:
 *   npx tsx scripts/admin/generateSameNameDuplicateRemovalList.ts [--meters=200] [--output=tmp/remove.txt]
 */

import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { init } from "@instantdb/admin";

import { initInstantAdmin, parseArgs } from "../_shared/etlUtils.js";

type OrganizationRecord = {
  id: string;
  name: string | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  website?: string | null;
  phone?: string | null;
  hours?: Record<string, unknown> | null;
  googleCategory?: string | null;
  keywordFound?: string | null;
  status?: string | null;
  lastSyncedAt?: number | null;
  raw?: Record<string, unknown> | null;
  moderationStatus?: string | null;
  moderationChangedAt?: number | null;
  submittedAt?: number | null;
  queueSortKey?: number | null;
  issueCount?: number | null;
  ownerEmail?: string | null;
  placeId?: string | null;
  source?: string | null;
};

type ProximateGroup = {
  normalizedName: string;
  organizations: OrganizationRecord[];
};

const DEFAULT_THRESHOLD_METERS = 200;
const DEFAULT_OUTPUT_PATH = path.resolve(
  process.cwd(),
  "tmp/same-name-proximity-remove.txt",
);

const EARTH_RADIUS_METERS = 6_371_000;

const ATTRIBUTES_TO_SCORE: (keyof OrganizationRecord)[] = [
  "website",
  "address",
  "city",
  "state",
  "postalCode",
  "phone",
  "hours",
  "googleCategory",
  "keywordFound",
  "status",
  "lastSyncedAt",
  "raw",
  "moderationStatus",
  "moderationChangedAt",
  "submittedAt",
  "queueSortKey",
  "issueCount",
  "ownerEmail",
  "placeId",
  "source",
];

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const haversineMeters = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number => {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
};

const normalizeName = (raw: string): string =>
  raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();

const fetchAllOrganizations = async (
  db: ReturnType<typeof initInstantAdmin>,
  pageSize = 500,
): Promise<OrganizationRecord[]> => {
  const rows: OrganizationRecord[] = [];
  let offset = 0;
  for (;;) {
    const resp = await db.query({
      organizations: {
        $: {
          limit: pageSize,
          offset,
          order: { name: "asc" },
        },
      },
    });
    const page = (resp?.data?.organizations ??
      resp.organizations ??
      []) as OrganizationRecord[];
    if (page.length === 0) break;
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }
  return rows;
};

const groupSameNameNearby = (
  records: OrganizationRecord[],
  thresholdMeters: number,
): ProximateGroup[] => {
  const byName = new Map<string, OrganizationRecord[]>();
  for (const record of records) {
    const name = (record.name ?? "").trim();
    if (!name) continue;
    if (typeof record.latitude !== "number" || typeof record.longitude !== "number") {
      continue;
    }
    const normalized = normalizeName(name);
    if (!normalized) continue;
    const bucket = byName.get(normalized) ?? [];
    bucket.push(record);
    byName.set(normalized, bucket);
  }

  const groups: ProximateGroup[] = [];

  for (const [normalizedName, bucket] of byName.entries()) {
    if (bucket.length < 2) continue;
    const adjacency = new Map<string, Set<string>>();

    for (let i = 0; i < bucket.length; i += 1) {
      const orgA = bucket[i];
      for (let j = i + 1; j < bucket.length; j += 1) {
        const orgB = bucket[j];
        const distance = haversineMeters(
          orgA.latitude!,
          orgA.longitude!,
          orgB.latitude!,
          orgB.longitude!,
        );
        if (distance <= thresholdMeters) {
          const listA = adjacency.get(orgA.id) ?? new Set<string>();
          listA.add(orgB.id);
          adjacency.set(orgA.id, listA);
          const listB = adjacency.get(orgB.id) ?? new Set<string>();
          listB.add(orgA.id);
          adjacency.set(orgB.id, listB);
        }
      }
    }

    const idToOrg = new Map(bucket.map((org) => [org.id, org]));
    const visited = new Set<string>();

    for (const org of bucket) {
      if (visited.has(org.id)) continue;
      const neighbors = adjacency.get(org.id);
      if (!neighbors || neighbors.size === 0) {
        visited.add(org.id);
        continue;
      }

      const queue = [org.id];
      const component: OrganizationRecord[] = [];
      visited.add(org.id);

      while (queue.length > 0) {
        const current = queue.shift()!;
        const currentOrg = idToOrg.get(current);
        if (currentOrg) component.push(currentOrg);
        const nextNeighbors = adjacency.get(current);
        if (!nextNeighbors) continue;
        for (const neighbor of nextNeighbors) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }

      if (component.length > 1) {
        groups.push({
          normalizedName,
          organizations: component,
        });
      }
    }
  }

  return groups;
};

const valueHasContent = (value: unknown): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
};

const scoreOrganization = (org: OrganizationRecord): number => {
  let score = 0;
  for (const field of ATTRIBUTES_TO_SCORE) {
    if (valueHasContent(org[field])) {
      score += 1;
    }
  }
  return score;
};

const selectRemovalCandidate = (group: ProximateGroup): {
  id: string;
  score: number;
  keepers: { id: string; score: number }[];
} => {
  const scored = group.organizations.map((org) => ({
    id: org.id,
    score: scoreOrganization(org),
  }));

  scored.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  const candidate = scored[0];
  return {
    id: candidate.id,
    score: candidate.score,
    keepers: scored,
  };
};

const main = async () => {
  const args = parseArgs();
  const thresholdRaw =
    args.meters ?? args.radius ?? args.threshold ?? args.distance;
  let thresholdMeters = Number(thresholdRaw);
  if (!Number.isFinite(thresholdMeters) || thresholdMeters <= 0) {
    thresholdMeters = DEFAULT_THRESHOLD_METERS;
  }

  const outputPathRaw = args.output ?? args.out ?? args.o;
  const outputPath = outputPathRaw
    ? path.resolve(process.cwd(), String(outputPathRaw))
    : DEFAULT_OUTPUT_PATH;

  console.log(
    `[generate] proximity threshold: ${thresholdMeters} meters | output: ${outputPath}`,
  );

  const db = initInstantAdmin(init);
  const records = await fetchAllOrganizations(db);
  console.log(`[generate] fetched ${records.length} organizations.`);

  const groups = groupSameNameNearby(records, thresholdMeters);
  console.log(
    `[generate] found ${groups.length} proximity groups with same names.`,
  );

  const removalIds: string[] = [];
  for (const group of groups) {
    const { id, score, keepers } = selectRemovalCandidate(group);
    removalIds.push(id);
    const keepSummary = keepers
      .map((entry) => `${entry.id}:${entry.score}`)
      .join(", ");
    console.log(
      `[generate] group "${group.organizations[0]?.name ?? group.normalizedName
      }" -> removing ${id} (score=${score}) | scores: ${keepSummary}`,
    );
  }

  if (removalIds.length === 0) {
    console.log("[generate] no duplicates detected; nothing to write.");
    return;
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${removalIds.join("\n")}\n`, "utf8");
  console.log(
    `[generate] wrote ${removalIds.length} ids to ${outputPath}.`,
  );
};

main().catch((error) => {
  console.error(
    "[generate] failed to build removal list:",
    error,
  );
  process.exit(1);
});

