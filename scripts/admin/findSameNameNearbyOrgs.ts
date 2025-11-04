#!/usr/bin/env tsx
/**
 * Identify sets of organizations that share the same (normalized) name and
 * whose coordinates place them within a configurable proximity threshold.
 *
 * Usage:
 *   npx tsx scripts/admin/findSameNameNearbyOrgs.ts [--meters=200]
 *
 * Defaults to a 200 meter radius when no flag is provided.
 */

import "dotenv/config";

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
};

type ProximateGroup = {
  normalizedName: string;
  displayName: string;
  organizations: OrganizationRecord[];
  pairDistances: Map<string, number>;
};

const DEFAULT_THRESHOLD_METERS = 200;
const EARTH_RADIUS_METERS = 6_371_000;

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
          fields: [
            "id",
            "name",
            "latitude",
            "longitude",
            "address",
            "city",
            "state",
          ],
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

const buildGroups = (
  records: OrganizationRecord[],
  thresholdMeters: number,
) => {
  const byName = new Map<string, OrganizationRecord[]>();
  let missingCoordinates = 0;

  for (const record of records) {
    const name = (record.name ?? "").trim();
    if (!name) continue;
    const lat = record.latitude;
    const lon = record.longitude;
    if (typeof lat !== "number" || typeof lon !== "number") {
      missingCoordinates += 1;
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
    const pairDistances = new Map<string, number>();

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
          const key = orgA.id < orgB.id ? `${orgA.id}::${orgB.id}` : `${orgB.id}::${orgA.id}`;
          pairDistances.set(key, distance);
          const neighborsA = adjacency.get(orgA.id) ?? new Set<string>();
          neighborsA.add(orgB.id);
          adjacency.set(orgA.id, neighborsA);
          const neighborsB = adjacency.get(orgB.id) ?? new Set<string>();
          neighborsB.add(orgA.id);
          adjacency.set(orgB.id, neighborsB);
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
        const displayName =
          component[0]?.name ??
          bucket.find((o) => o.name)?.name ??
          normalizedName;
        groups.push({
          normalizedName,
          displayName,
          organizations: component,
          pairDistances,
        });
      }
    }
  }

  return { groups, missingCoordinates };
};

const formatAddress = (org: OrganizationRecord): string => {
  const parts = [org.address, org.city, org.state]
    .map((part) => (part ?? "").trim())
    .filter((part) => part.length > 0);
  return parts.join(", ");
};

const formatMeters = (value: number | undefined) =>
  typeof value === "number" ? `${value.toFixed(1)}m` : "n/a";

const nearestDistance = (
  org: OrganizationRecord,
  group: ProximateGroup,
): number | undefined => {
  let best: number | undefined;
  for (const other of group.organizations) {
    if (other.id === org.id) continue;
    const key =
      org.id < other.id ? `${org.id}::${other.id}` : `${other.id}::${org.id}`;
    const distance = group.pairDistances.get(key);
    if (typeof distance !== "number") continue;
    if (best === undefined || distance < best) {
      best = distance;
    }
  }
  return best;
};

const main = async () => {
  const args = parseArgs();
  const thresholdRaw =
    args.meters ?? args.radius ?? args.threshold ?? args.distance;
  let thresholdMeters = Number(thresholdRaw);
  if (!Number.isFinite(thresholdMeters) || thresholdMeters <= 0) {
    thresholdMeters = DEFAULT_THRESHOLD_METERS;
  }

  console.log(
    `[scan] using proximity threshold of ${thresholdMeters} meters for name matches.`,
  );

  const db = initInstantAdmin(init);
  const records = await fetchAllOrganizations(db);
  console.log(`[scan] fetched ${records.length} organizations.`);

  const { groups, missingCoordinates } = buildGroups(records, thresholdMeters);
  console.log(
    `[scan] identified ${groups.length} same-name proximity groups; skipped ${missingCoordinates} records missing coordinates.`,
  );

  const sortedGroups = groups.sort((a, b) =>
    a.displayName.localeCompare(b.displayName, "en", { sensitivity: "base" }),
  );

  let totalOrganizations = 0;
  sortedGroups.forEach((group, index) => {
    totalOrganizations += group.organizations.length;
    console.log(
      `Group ${index + 1}: "${group.displayName}" · ${group.organizations.length} organizations`,
    );
    const sortedOrgs = [...group.organizations].sort((a, b) =>
      formatAddress(a).localeCompare(formatAddress(b), "en", {
        sensitivity: "base",
      }),
    );
    for (const org of sortedOrgs) {
      const nearest = nearestDistance(org, group);
      const address = formatAddress(org) || "(address unknown)";
      console.log(
        `  - ${org.id} | ${address} | lat=${org.latitude?.toFixed(
          5,
        )}, lon=${org.longitude?.toFixed(5)} | nearest=${formatMeters(
          nearest,
        )}`,
      );
    }
  });

  const potentialDuplicates = totalOrganizations - sortedGroups.length;
  console.log("");
  console.log(`[summary] groups: ${sortedGroups.length}`);
  console.log(`[summary] organizations involved: ${totalOrganizations}`);
  console.log(
    `[summary] potential duplicate records (beyond one per group): ${potentialDuplicates}`,
  );
};

main().catch((error) => {
  console.error("[error] failed to find same-name nearby organizations:", error);
  process.exit(1);
});
