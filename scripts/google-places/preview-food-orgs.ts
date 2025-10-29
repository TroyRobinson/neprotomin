#!/usr/bin/env tsx
/**
 * Preview normalized Google Places collection prior to InstantDB load.
 *
 * Usage:
 *   tsx scripts/google-places/preview-food-orgs.ts --file=tmp/food_places_2025-10-28T00-00-00.json
 */

import fs from "node:fs/promises";
import path from "node:path";

import { args, resolveTmpPath } from "./shared.ts";
import type { CollectionPayload } from "./shared.ts";

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
    throw new Error("No collection files found in tmp/. Run collect-food-places first or pass --file=path.");
  }
  return path.resolve(tmpDir, matches[0]!);
}

function formatCountMap(counts: Map<string, number>, limit = 5): string {
  const entries = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  return entries.map(([key, value]) => `  • ${key}: ${value}`).join("\n");
}

async function main() {
  const file = await resolveFileFromArgs();
  const raw = await fs.readFile(file, "utf8");
  const payload = JSON.parse(raw) as CollectionPayload;

  const total = payload.places.length;
  const statusCounts = new Map<string, number>();
  const cityCounts = new Map<string, number>();
  const keywordCounts = new Map<string, number>();

  for (const place of payload.places) {
    const status = place.status ?? "unknown";
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);

    if (place.city) {
      cityCounts.set(place.city, (cityCounts.get(place.city) ?? 0) + 1);
    }
    if (place.keywordFound) {
      keywordCounts.set(place.keywordFound, (keywordCounts.get(place.keywordFound) ?? 0) + 1);
    }
  }

  console.log(`File: ${file}`);
  console.log(`Generated: ${new Date(payload.generatedAt).toISOString()}`);
  console.log(`Total normalized places: ${total}`);
  console.log(`Excluded place ids: ${payload.excludedPlaceIds.length}`);
  console.log("\nStatus counts:");
  console.log(formatCountMap(statusCounts, statusCounts.size || 5));
  console.log("\nTop cities:");
  console.log(formatCountMap(cityCounts));
  console.log("\nKeyword coverage:");
  console.log(formatCountMap(keywordCounts, keywordCounts.size || 10));

  const sample = payload.places.slice(0, 3);
  if (sample.length > 0) {
    console.log("\nSample records:");
    for (const entry of sample) {
      console.log(
        `  - ${entry.name} (${entry.city ?? "Unknown city"}) • status=${entry.status} • keyword=${entry.keywordFound}`,
      );
      if (entry.hours?.weekdayText?.length) {
        console.log(`      hours: ${entry.hours.weekdayText.slice(0, 2).join(" | ")}`);
      }
      if (entry.website) {
        console.log(`      website: ${entry.website}`);
      }
    }
  }
}

main().catch((error) => {
  console.error("[preview] fatal error:", error);
  process.exitCode = 1;
});
