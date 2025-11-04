#!/usr/bin/env tsx
/**
 * Scan InstantDB organizations and report groups of records whose names share
 * at least two "complex" words (length >= 4, excluding common stopwords).
 *
 * The goal is to surface likely duplicate organizations that differ only by
 * suffixes or additional qualifiers so reviewers can consolidate them.
 */

import "dotenv/config";

import { init } from "@instantdb/admin";

import { initInstantAdmin } from "../_shared/etlUtils.js";

type OrganizationRecord = {
  id: string;
  name: string | null;
};

const MIN_WORD_LENGTH = 4;
const MIN_SHARED_WORDS = 2;
const MAX_WORD_FREQUENCY = 25;
const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "that",
  "this",
  "have",
  "your",
  "our",
  "their",
  "shall",
  "will",
  "they",
  "them",
  "you",
  "she",
  "him",
  "her",
  "its",
  "a",
  "an",
  "of",
  "to",
  "in",
  "by",
  "on",
  "at",
  "llc",
  "inc",
  "corp",
  "co",
  "ltd",
  "pllc",
  "pc",
  "llp",
]);

type OrgWordIndex = {
  id: string;
  name: string;
  words: Set<string>;
};

const sanitizeName = (name: string): string =>
  name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const extractComplexWords = (name: string): Set<string> => {
  const sanitized = sanitizeName(name);
  if (!sanitized) return new Set();
  const words = sanitized.split(" ");
  const result = new Set<string>();
  for (const word of words) {
    if (!word) continue;
    if (STOP_WORDS.has(word)) continue;
    if (word.length < MIN_WORD_LENGTH) continue;
    result.add(word);
  }
  return result;
};

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

const buildWordIndex = (records: OrganizationRecord[]): OrgWordIndex[] => {
  const indexed: OrgWordIndex[] = [];
  for (const org of records) {
    const name = (org.name ?? "").trim();
    if (!name) continue;
    const words = extractComplexWords(name);
    if (words.size === 0) continue;
    indexed.push({ id: org.id, name, words });
  }
  return indexed;
};

type DuplicateGroupResult = {
  groups: OrgWordIndex[][];
  skippedHighFrequencyWords: number;
};

const findDuplicateGroups = (indexed: OrgWordIndex[]): DuplicateGroupResult => {
  const wordToOrg = new Map<string, string[]>();
  for (const { id, words } of indexed) {
    for (const word of words) {
      const bucket = wordToOrg.get(word) ?? [];
      bucket.push(id);
      wordToOrg.set(word, bucket);
    }
  }

  const pairCounts = new Map<string, number>();
  let skippedHighFrequencyWords = 0;
  for (const [word, orgIds] of wordToOrg.entries()) {
    if (orgIds.length < 2) continue;
    if (orgIds.length > MAX_WORD_FREQUENCY) {
      skippedHighFrequencyWords += 1;
      continue;
    }
    for (let i = 0; i < orgIds.length; i += 1) {
      for (let j = i + 1; j < orgIds.length; j += 1) {
        const idA = orgIds[i];
        const idB = orgIds[j];
        const key = idA < idB ? `${idA}:::${idB}` : `${idB}:::${idA}`;
        const next = (pairCounts.get(key) ?? 0) + 1;
        pairCounts.set(key, next);
      }
    }
  }

  const adjacency = new Map<string, Set<string>>();
  for (const [key, count] of pairCounts.entries()) {
    if (count < MIN_SHARED_WORDS) continue;
    const [idA, idB] = key.split(":::");
    const bucketA = adjacency.get(idA) ?? new Set<string>();
    bucketA.add(idB);
    adjacency.set(idA, bucketA);
    const bucketB = adjacency.get(idB) ?? new Set<string>();
    bucketB.add(idA);
    adjacency.set(idB, bucketB);
  }

  const idToOrg = new Map(indexed.map((org) => [org.id, org]));
  const visited = new Set<string>();
  const groups: OrgWordIndex[][] = [];

  for (const org of indexed) {
    if (visited.has(org.id)) continue;
    const neighbors = adjacency.get(org.id);
    if (!neighbors || neighbors.size === 0) continue;
    const queue = [org.id];
    const component: OrgWordIndex[] = [];
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
      groups.push(component);
    }
  }

  return { groups, skippedHighFrequencyWords };
};

const summarizeGroupWords = (group: OrgWordIndex[]): string[] => {
  const counts = new Map<string, number>();
  for (const org of group) {
    for (const word of org.words) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([word]) => word);
};

const formatGroupHeader = (
  index: number,
  group: OrgWordIndex[],
  sharedWords: string[],
) => {
  const headerParts = [`Group ${index + 1}: ${group.length} organizations`];
  if (sharedWords.length > 0) {
    headerParts.push(`shared words → ${sharedWords.slice(0, 6).join(", ")}`);
    if (sharedWords.length > 6) {
      headerParts[headerParts.length - 1] += `, …`;
    }
  }
  return headerParts.join(" | ");
};

const main = async () => {
  const db = initInstantAdmin(init);
  const records = await fetchAllOrganizations(db);
  console.log(
    `[scan] fetched ${records.length} organizations from InstantDB.`,
  );

  const indexed = buildWordIndex(records);
  console.log(
    `[scan] ${indexed.length} organizations have complex words for comparison.`,
  );

  const { groups: rawGroups, skippedHighFrequencyWords } =
    findDuplicateGroups(indexed);
  console.log(
    `[scan] skipped ${skippedHighFrequencyWords} high-frequency words (>${MAX_WORD_FREQUENCY} matches).`,
  );
  const groups = rawGroups.sort((a, b) => b.length - a.length);

  const involvedOrgIds = new Set<string>();
  let potentialDuplicateCount = 0;
  groups.forEach((group) => {
    group.forEach((org) => involvedOrgIds.add(org.id));
    potentialDuplicateCount += group.length - 1;
  });

  groups.forEach((group, index) => {
    const sharedWords = summarizeGroupWords(group);
    console.log(formatGroupHeader(index, group, sharedWords));
    const sorted = [...group].sort((a, b) =>
      a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
    );
    for (const org of sorted) {
      console.log(`  - ${org.id} :: ${org.name}`);
    }
  });

  console.log("");
  console.log(`[summary] duplicate groups: ${groups.length}`);
  console.log(`[summary] organizations flagged: ${involvedOrgIds.size}`);
  console.log(
    `[summary] potential duplicate records (beyond one per group): ${potentialDuplicateCount}`,
  );
};

main().catch((error) => {
  console.error("[error] failed to find name duplicates:", error);
  process.exit(1);
});
