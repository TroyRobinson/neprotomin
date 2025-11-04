#!/usr/bin/env tsx
/**
 * Scan InstantDB organizations and append records whose names do not look
 * food-related to a review file for manual follow-up.
 *
 * Usage:
 *   npx tsx scripts/admin/findNonFoodOrganizations.ts [--batchSize=250] [--output=tmp/non-food-organizations.txt]
 */

import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { init } from "@instantdb/admin";

import { initInstantAdmin, parseArgs } from "../_shared/etlUtils.js";

type OrganizationSummary = {
  id: string;
  name: string | null;
  category?: string | null;
  googleCategory?: string | null;
  keywordFound?: string | null;
  source?: string | null;
};

const DEFAULT_BATCH_SIZE = 200;
const DEFAULT_OUTPUT_PATH = path.resolve(
  process.cwd(),
  "tmp/non-food-organizations.txt",
);

// Simple heuristics catch words strongly associated with food assistance.
const NAME_KEYWORDS = [
  "food",
  "pantry",
  "kitchen",
  "meal",
  "meals",
  "feed",
  "feeds",
  "feeding",
  "hunger",
  "hungry",
  "grocer",
  "grocery",
  "market",
  "nutrition",
  "produce",
  "harvest",
  "farm",
  "farmer",
  "farmers",
  "loaves",
  "fishes",
  "soup",
  "bread",
  "lunch",
  "dinner",
  "breakfast",
  "snack",
  "snacks",
  "cafe",
  "caf\u00e9",
  "culinary",
  "veggie",
  "veggies",
  "garden",
  "gardens",
  "veg",
  "kettle",
  "nourish",
  "grill",
  "butcher",
  "bodega",
  "foodbank",
  "food-bank",
  "food pantry",
  "meals on wheels",
  "community kitchen",
  "community meal",
];

const CATEGORY_KEYWORDS = [
  "food",
  "pantry",
  "meal",
  "nutrition",
  "grocery",
  "market",
  "soup",
  "harvest",
  "farm",
  "produce",
];

const SOURCE_KEYWORDS = ["food", "pantry", "feed", "hunger"];

const normalize = (value: string | null | undefined): string =>
  (value ?? "").toLowerCase();

const containsKeyword = (value: string, keywords: string[]): boolean => {
  if (!value) return false;
  for (const keyword of keywords) {
    if (!keyword) continue;
    if (value.includes(keyword)) return true;
  }
  return false;
};

const looksFoodRelated = (org: OrganizationSummary): boolean => {
  const name = normalize(org.name);
  if (containsKeyword(name, NAME_KEYWORDS)) return true;

  const category = normalize(org.category);
  if (containsKeyword(category, CATEGORY_KEYWORDS)) return true;

  const googleCategory = normalize(org.googleCategory);
  if (containsKeyword(googleCategory, CATEGORY_KEYWORDS)) return true;

  const keywordFound = normalize(org.keywordFound);
  if (containsKeyword(keywordFound, CATEGORY_KEYWORDS)) return true;

  const source = normalize(org.source);
  if (containsKeyword(source, SOURCE_KEYWORDS)) return true;

  return false;
};

const sanitizeForOutput = (value: string | null | undefined): string =>
  (value ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const fetchBatch = async (
  db: ReturnType<typeof initInstantAdmin>,
  offset: number,
  limit: number,
): Promise<OrganizationSummary[]> => {
  const resp = await db.query({
    organizations: {
      $: {
        limit,
        offset,
        order: { name: "asc" },
        fields: [
          "id",
          "name",
          "category",
          "googleCategory",
          "keywordFound",
          "source",
        ],
      },
    },
  });
  const page = (resp?.data?.organizations ??
    resp.organizations ??
    []) as OrganizationSummary[];
  return page;
};

const loadExistingIds = (outputPath: string): Set<string> => {
  const ids = new Set<string>();
  if (!fs.existsSync(outputPath)) return ids;
  const contents = fs.readFileSync(outputPath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const [id] = line.split("\t");
    if (!id) continue;
    if (id.startsWith("#")) continue;
    if (id) ids.add(id.trim());
  }
  return ids;
};

const ensureOutputFile = (outputPath: string, isNew: boolean) => {
  if (isNew) {
    const header = `# Non-food organization candidates\n# Generated: ${new Date().toISOString()}\n`;
    fs.writeFileSync(outputPath, header, "utf8");
  }
};

const main = async () => {
  const args = parseArgs();
  const batchSize = Number.parseInt(String(args.batchSize ?? ""), 10);
  const effectiveBatch =
    Number.isFinite(batchSize) && batchSize > 0 ? batchSize : DEFAULT_BATCH_SIZE;
  const outputArg = args.output ? String(args.output) : null;
  const outputPath = path.resolve(
    process.cwd(),
    outputArg ?? DEFAULT_OUTPUT_PATH,
  );

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const outputExists = fs.existsSync(outputPath);
  const existingIds = loadExistingIds(outputPath);

  ensureOutputFile(outputPath, !outputExists);

  const db = initInstantAdmin(init);

  let offset = 0;
  let processed = 0;
  let flagged = 0;

  for (;;) {
    const batch = await fetchBatch(db, offset, effectiveBatch);
    if (batch.length === 0) break;
    processed += batch.length;

    const lines: string[] = [];

    for (const org of batch) {
      if (!org.id) continue;
      if (looksFoodRelated(org)) continue;
      if (existingIds.has(org.id)) continue;
      const name = sanitizeForOutput(org.name) || "(no name)";
      const category = sanitizeForOutput(org.category);
      const googleCategory = sanitizeForOutput(org.googleCategory);
      const source = sanitizeForOutput(org.source);
      lines.push(
        [
          org.id,
          name,
          category ? `category=${category}` : "",
          googleCategory ? `google=${googleCategory}` : "",
          source ? `source=${source}` : "",
        ]
          .filter(Boolean)
          .join("\t"),
      );
      existingIds.add(org.id);
    }

    if (lines.length > 0) {
      fs.appendFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
      flagged += lines.length;
    }

    if (batch.length < effectiveBatch) break;
    offset += batch.length;
    console.log(
      `Processed ${processed} organizations so far; flagged ${flagged} candidates.`,
    );
  }

  console.log(
    `Done. Processed ${processed} organizations, flagged ${flagged}. Output: ${outputPath}`,
  );
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
