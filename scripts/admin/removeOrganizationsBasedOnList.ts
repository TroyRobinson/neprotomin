#!/usr/bin/env tsx
/**
 * Update `moderationStatus` to "removed" for specific organizations whose ids
 * are listed in a newline-delimited file.
 *
 * Usage:
 *   npx tsx scripts/admin/deleteOrganizationsFromList.ts [path/to/id-list.txt]
 *
 * Defaults to `to_delete.txt` at the repository root when no file path is provided.
 */

import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { init, tx } from "@instantdb/admin";

import { initInstantAdmin } from "../_shared/etlUtils.js";

const DEFAULT_LIST_PATH = path.resolve(process.cwd(), "to_delete.txt");
const INPUT_PATH = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : DEFAULT_LIST_PATH;

const CHUNK_SIZE = 50;
const REMOVED_STATUS = "removed";

const readIdsFromFile = (filePath: string): string[] => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`ID list file not found: ${filePath}`);
  }
  const contents = fs.readFileSync(filePath, "utf8");
  return Array.from(
    new Set(
      contents
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ),
  );
};

const splitValidIds = (ids: string[]) => {
  const matchUuid =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const id of ids) {
    if (matchUuid.test(id)) {
      valid.push(id);
    } else {
      invalid.push(id);
    }
  }
  return { valid, invalid };
};

const markOrganizationsRemoved = async (
  db: ReturnType<typeof initInstantAdmin>,
  ids: string[],
) => {
  let processed = 0;
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const slice = ids.slice(i, i + CHUNK_SIZE);
    if (slice.length === 0) continue;
    const timestamp = Date.now();
    const txs = slice.map((id) =>
      tx.organizations[id].update({
        moderationStatus: REMOVED_STATUS,
        moderationChangedAt: timestamp,
      }),
    );
    await db.transact(txs);
    processed += slice.length;
    console.log(
      `[update] marked chunk ${i / CHUNK_SIZE + 1} (${slice.length} records)`,
    );
  }
  return processed;
};

const main = async () => {
  const ids = readIdsFromFile(INPUT_PATH);
  if (ids.length === 0) {
    console.log("[update] no ids found in input file. nothing to do.");
    return;
  }

  const { valid: validIds, invalid: invalidIds } = splitValidIds(ids);
  if (invalidIds.length > 0) {
    console.warn(
      `[update] skipped ${invalidIds.length} invalid ids: ${invalidIds.join(
        ", ",
      )}`,
    );
  }
  if (validIds.length === 0) {
    console.log("[update] no valid ids to process after validation.");
    return;
  }
  console.log(
    `[update] loaded ${validIds.length} valid ids from ${INPUT_PATH}`,
  );

  const db = initInstantAdmin(init);
  const totalUpdated = await markOrganizationsRemoved(db, validIds);

  console.log(
    `[update] completed. set moderationStatus="${REMOVED_STATUS}" for ${totalUpdated} organizations.`,
  );
};

main().catch((error) => {
  console.error("[update] fatal error:", error);
  process.exit(1);
});
