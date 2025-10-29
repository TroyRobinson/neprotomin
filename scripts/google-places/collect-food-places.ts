#!/usr/bin/env tsx
/**
 * Collect food-related community organizations across Oklahoma via Google Places API (New).
 *
 * Usage:
 *   tsx scripts/google-places/collect-food-places.ts
 *   tsx scripts/google-places/collect-food-places.ts --keywords="community food bank,free meal program" --radius=30000
 *
 * Environment:
 *   GOOGLE_PLACES_API_KEY   (required)
 */

import fs from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_KEYWORDS,
  DEFAULT_RADIUS_METERS,
  DEFAULT_GRID_STEP_DEGREES,
  CACHE_VERSION,
} from "./constants.ts";
import {
  args,
  DEBUG,
  ensureDir,
  generateSearchCenters,
  lookupPlace,
  normalizeHours,
  normalizePlace,
  resolveTmpPath,
  searchText,
  shouldExcludePlace,
  sleep,
  withCache,
  determineStatus,
  requireEnv,
  hashKey,
} from "./shared.ts";
import type { NormalizedPlace, CollectionPayload, SearchTask, SearchCenter } from "./shared.ts";

const apiKey = requireEnv("GOOGLE_PLACES_API_KEY");

const keywords =
  typeof args.keywords === "string" && args.keywords.length > 0
    ? args.keywords.split(",").map((s: string) => s.trim()).filter(Boolean)
    : Array.from(DEFAULT_KEYWORDS);

const radiusMeters = args.radius ? Number(args.radius) : DEFAULT_RADIUS_METERS;
const stepDegrees = args.step ? Number(args.step) : DEFAULT_GRID_STEP_DEGREES;
const useCache = !(args.cache === "refresh" || args["no-cache"] === true);
const searchDelayMs = args.searchDelay ? Number(args.searchDelay) : 800;
const detailsDelayMs = args.detailsDelay ? Number(args.detailsDelay) : 400;
const maxPagesPerTask = args.maxPages ? Number(args.maxPages) : 3;
const pageSize = args.pageSize ? Number(args.pageSize) : 20;

if (Number.isNaN(radiusMeters) || radiusMeters <= 0) {
  throw new Error("radius must be a positive number");
}
if (Number.isNaN(stepDegrees) || stepDegrees <= 0) {
  throw new Error("step must be a positive number");
}

const centers = generateSearchCenters(stepDegrees);

const tasks: SearchTask[] = [];
for (const keyword of keywords) {
  for (const center of centers) {
    tasks.push({ keyword, center });
  }
}

if (DEBUG) {
  console.log(`[collect] configured ${tasks.length} search tasks (${keywords.length} keywords x ${centers.length} centers)`);
}

interface DiscoveryMeta {
  keyword: string;
  keywords: Set<string>;
  centers: SearchCenter[];
  businessStatus?: string | null;
}

type DiscoveryMap = Map<string, DiscoveryMeta>;

async function runSearchTasks(): Promise<{
  discoveredPlaceIds: string[];
  discoveryMeta: DiscoveryMap;
}> {
  const discoveryMeta: DiscoveryMap = new Map();

  for (const [index, task] of tasks.entries()) {
    if (DEBUG) {
      console.log(
        `[collect] [${index + 1}/${tasks.length}] search "${task.keyword}" near (${task.center.latitude}, ${task.center.longitude})`,
      );
    }
    let page = 0;
    let pageToken: string | undefined;

    do {
      page += 1;
      const body = {
        textQuery: task.keyword,
        pageSize,
        pageToken,
        locationBias: {
          circle: {
            center: {
              latitude: task.center.latitude,
              longitude: task.center.longitude,
            },
            radius: radiusMeters,
          },
        },
      };
      const cacheKey = useCache
        ? hashKey({ task: { keyword: task.keyword, center: task.center }, page })
        : null;

      const response =
        cacheKey && useCache
          ? await withCache(cacheKey, () => searchText(apiKey, body, false))
          : await searchText(apiKey, body, useCache);

      for (const place of response.places ?? []) {
        if (!place?.id) continue;
        const meta = discoveryMeta.get(place.id);
        if (meta) {
          meta.keywords.add(task.keyword);
          const alreadySeenCenter = meta.centers.some(
            (c) => c.latitude === task.center.latitude && c.longitude === task.center.longitude,
          );
          if (!alreadySeenCenter) meta.centers.push(task.center);
          meta.businessStatus = place.businessStatus ?? meta.businessStatus;
        } else {
          discoveryMeta.set(place.id, {
            keyword: task.keyword,
            keywords: new Set([task.keyword]),
            centers: [task.center],
            businessStatus: place.businessStatus ?? null,
          });
        }
      }

      pageToken = response.nextPageToken;
      if (pageToken && page < maxPagesPerTask) {
        await sleep(searchDelayMs);
      } else {
        pageToken = undefined;
      }
    } while (pageToken);

    await sleep(searchDelayMs);
  }

  return { discoveredPlaceIds: Array.from(discoveryMeta.keys()), discoveryMeta };
}

async function fetchDetails(
  placeIds: string[],
  meta: DiscoveryMap,
): Promise<{ places: NormalizedPlace[]; excluded: string[] }> {
  const out: NormalizedPlace[] = [];
  const excluded: string[] = [];

  let counter = 0;
  for (const placeId of placeIds) {
    counter += 1;
    const metaEntry = meta.get(placeId);
    const keyword = metaEntry?.keyword ?? keywords[0] ?? "food";
    try {
      const details = await lookupPlace(apiKey, placeId, useCache);
      if (shouldExcludePlace(details, keyword)) {
        excluded.push(placeId);
        continue;
      }

      const hours = normalizeHours(details.regularOpeningHours);
      const normalized = normalizePlace(
        {
          ...details,
          businessStatus: details.businessStatus ?? metaEntry?.businessStatus ?? undefined,
        },
        keyword,
        hours,
      );
      if (!normalized) {
        excluded.push(placeId);
        continue;
      }

      const raw = JSON.parse(JSON.stringify(details)) as Record<string, unknown>;
      raw.discoveredByKeywords = Array.from(metaEntry?.keywords ?? new Set([keyword]));
      raw.discoveryCenters = (metaEntry?.centers ?? []).map((c) => ({
        latitude: c.latitude,
        longitude: c.longitude,
      }));
      raw.discoveryStatus = metaEntry?.businessStatus ?? details.businessStatus ?? null;
      normalized.raw = raw;
      normalized.keywordFound = keyword;
      normalized.status = determineStatus(details);
      out.push(normalized);
    } catch (error) {
      console.warn(`[collect] failed to fetch details for ${placeId}:`, error);
      excluded.push(placeId);
    }

    if (counter % 5 === 0) {
      await sleep(detailsDelayMs * 2);
    } else {
      await sleep(detailsDelayMs);
    }
  }

  return { places: out, excluded };
}

async function main() {
  const { discoveredPlaceIds, discoveryMeta } = await runSearchTasks();
  if (discoveredPlaceIds.length === 0) {
    console.warn("[collect] no places discovered with current configuration.");
  } else {
    console.log(`[collect] discovered ${discoveredPlaceIds.length} unique place ids.`);
  }

  const { places, excluded } = await fetchDetails(discoveredPlaceIds, discoveryMeta);

  console.log(`[collect] normalized ${places.length} places (excluded ${excluded.length}).`);

  const payload: CollectionPayload = {
    generatedAt: Date.now(),
    cacheVersion: CACHE_VERSION,
    keywords,
    radiusMeters,
    stepDegrees,
    tasks: tasks.map((t) => ({ keyword: t.keyword, latitude: t.center.latitude, longitude: t.center.longitude })),
    places,
    excludedPlaceIds: excluded,
  };

  const outPath =
    typeof args.out === "string" && args.out.length > 0
      ? path.resolve(process.cwd(), args.out)
      : resolveTmpPath(`food_places_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);

  await ensureDir(path.dirname(outPath));
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), "utf8");
  console.log(`[collect] wrote ${places.length} records to ${outPath}`);
}

main().catch((error) => {
  console.error("[collect] fatal error:", error);
  process.exitCode = 1;
});
