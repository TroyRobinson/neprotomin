import type { Feature, FeatureCollection, Position } from "geojson";

import { oklahomaZctaManifest } from "../data/zcta/oklahoma/manifest";
import type { OklahomaZctaChunkMeta } from "../data/zcta/oklahoma/manifest";

export type BoundsArray = [[number, number], [number, number]];

export type ZctaStateCode = "ok";

type ZctaFeature = Feature<
  GeoJSON.MultiPolygon | GeoJSON.Polygon,
  { zip: string; county?: string; name?: string; [key: string]: unknown }
>;

interface StateCache {
  chunksLoaded: Set<string>;
  featureCollection: FeatureCollection<GeoJSON.MultiPolygon | GeoJSON.Polygon, { zip: string }>;
  featuresByZip: Map<string, ZctaFeature>;
  boundsByZip: Map<string, BoundsArray>;
  centroidsByZip: Map<string, [number, number]>;
  countyNameByZip: Map<string, string>;
  countyIdByZip: Map<string, string>;
  chunkZips: Map<string, Set<string>>;
  zipToChunkId: Map<string, string>;
  manifestById: Map<string, OklahomaZctaChunkMeta>;
  countyIdToChunkIds: Map<string, Set<string>>;
  neighborsByCountyId: Map<string, Set<string>>;
  countyIdToName: Map<string, string>;
}

const EMPTY_FC: FeatureCollection<GeoJSON.MultiPolygon | GeoJSON.Polygon, { zip: string }> = {
  type: "FeatureCollection",
  features: [],
};

const stateCaches = new Map<ZctaStateCode, StateCache>();

const manifests: Record<ZctaStateCode, typeof oklahomaZctaManifest> = {
  ok: oklahomaZctaManifest,
};

const BORDER_COUNTY_ID = "999";

const intersectsBounds = (a: BoundsArray, b: BoundsArray): boolean =>
  a[0][0] <= b[1][0] &&
  a[1][0] >= b[0][0] &&
  a[0][1] <= b[1][1] &&
  a[1][1] >= b[0][1];

const computeNeighbors = (manifest: typeof oklahomaZctaManifest): Map<string, Set<string>> => {
  // Drop the synthetic border chunk here so neighbor math stays scoped to Oklahoma counties.
  const filteredManifest = manifest.filter((chunk) => chunk.countyId !== BORDER_COUNTY_ID);
  const neighbors = new Map<string, Set<string>>();
  for (const chunk of filteredManifest) {
    neighbors.set(chunk.countyId, new Set());
  }
  for (let i = 0; i < filteredManifest.length; i++) {
    const a = filteredManifest[i];
    for (let j = i + 1; j < filteredManifest.length; j++) {
      const b = filteredManifest[j];
      if (a.countyId === b.countyId) continue;
      if (intersectsBounds(a.bbox, b.bbox)) {
        neighbors.get(a.countyId)?.add(b.countyId);
        neighbors.get(b.countyId)?.add(a.countyId);
      }
    }
  }
  return neighbors;
};

const getOrCreateStateCache = (state: ZctaStateCode): StateCache => {
  let cache = stateCaches.get(state);
  if (cache) return cache;
  const manifest = manifests[state];
  const neighbors = computeNeighbors(manifest);
  const countyIdToChunkIds = new Map<string, Set<string>>();
  const countyIdToName = new Map<string, string>();
  for (const chunk of manifest) {
    if (chunk.countyId === BORDER_COUNTY_ID) {
      continue; // Ignore the synthetic border chunk when computing in-state county lookups.
    }
    const set = countyIdToChunkIds.get(chunk.countyId) ?? new Set<string>();
    set.add(chunk.id);
    countyIdToChunkIds.set(chunk.countyId, set);
    if (!countyIdToName.has(chunk.countyId)) {
      countyIdToName.set(chunk.countyId, chunk.name);
    }
  }
  cache = {
    chunksLoaded: new Set(),
    featureCollection: { type: "FeatureCollection", features: [] },
    featuresByZip: new Map(),
    boundsByZip: new Map(),
    centroidsByZip: new Map(),
    countyNameByZip: new Map(),
    countyIdByZip: new Map(),
    chunkZips: new Map(),
    zipToChunkId: new Map(),
    manifestById: new Map(manifest.map((entry) => [entry.id, entry])),
    countyIdToChunkIds,
    neighborsByCountyId: neighbors,
    countyIdToName,
  };
  stateCaches.set(state, cache);
  return cache;
};

const extendBounds = (
  coords: any,
  bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number },
): void => {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    const [lng, lat] = coords as Position;
    if (lng < bounds.minLng) bounds.minLng = lng;
    if (lat < bounds.minLat) bounds.minLat = lat;
    if (lng > bounds.maxLng) bounds.maxLng = lng;
    if (lat > bounds.maxLat) bounds.maxLat = lat;
    return;
  }
  for (const coord of coords) {
    extendBounds(coord, bounds);
  }
};

const computeBounds = (feature: ZctaFeature): BoundsArray | null => {
  if (!feature.geometry) return null;
  const bounds = {
    minLng: Infinity,
    minLat: Infinity,
    maxLng: -Infinity,
    maxLat: -Infinity,
  };
  extendBounds(feature.geometry.coordinates, bounds);
  if (
    !Number.isFinite(bounds.minLng) ||
    !Number.isFinite(bounds.minLat) ||
    !Number.isFinite(bounds.maxLng) ||
    !Number.isFinite(bounds.maxLat)
  ) {
    return null;
  }
  return [
    [bounds.minLng, bounds.minLat],
    [bounds.maxLng, bounds.maxLat],
  ];
};

const ringCentroid = (ring: Position[]): [number, number, number] => {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j] as [number, number];
    const [x1, y1] = ring[i] as [number, number];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (area === 0) {
    let sx = 0;
    let sy = 0;
    for (const point of ring) {
      sx += (point as [number, number])[0];
      sy += (point as [number, number])[1];
    }
    return [sx / ring.length, sy / ring.length, 0];
  }
  return [cx / (6 * area), cy / (6 * area), Math.abs(area)];
};

const computeCentroid = (feature: ZctaFeature): [number, number] | null => {
  if (!feature.geometry) return null;
  let totalArea = 0;
  let accX = 0;
  let accY = 0;
  if (feature.geometry.type === "Polygon") {
    const [cx, cy, area] = ringCentroid((feature.geometry.coordinates[0] || []) as Position[]);
    totalArea += area;
    accX += cx * area;
    accY += cy * area;
  } else if (feature.geometry.type === "MultiPolygon") {
    for (const polygon of feature.geometry.coordinates as Position[][][]) {
      const [cx, cy, area] = ringCentroid((polygon[0] || []) as Position[]);
      totalArea += area;
      accX += cx * area;
      accY += cy * area;
    }
  }
  if (totalArea === 0) return null;
  return [accX / totalArea, accY / totalArea];
};

const mergeFeatureCollection = (
  target: FeatureCollection<GeoJSON.MultiPolygon | GeoJSON.Polygon, { zip: string }>,
  source: FeatureCollection<GeoJSON.MultiPolygon | GeoJSON.Polygon, { zip: string }>,
): void => {
  for (const feature of source.features as ZctaFeature[]) {
    target.features.push(feature);
  }
};

const ensureChunkLoaded = async (state: ZctaStateCode, chunkId: string): Promise<void> => {
  const cache = getOrCreateStateCache(state);
  if (cache.chunksLoaded.has(chunkId)) return;

  const chunkMeta = cache.manifestById.get(chunkId);
  if (!chunkMeta) {
    throw new Error(`Unknown ZCTA chunk "${chunkId}" for state "${state}"`);
  }

  if (chunkMeta.countyId === BORDER_COUNTY_ID) {
    // We intentionally skip loading the border chunk because it pulls in large out-of-state ZIP polygons.
    // Future dev: remove this guard (and the viewport/neighbor filters below) if cross-border ZCTAs are needed again.
    cache.chunksLoaded.add(chunkId);
    cache.chunkZips.set(chunkId, new Set());
    return;
  }

  const collection = await chunkMeta.load();
  cache.chunksLoaded.add(chunkId);
  mergeFeatureCollection(cache.featureCollection, collection);

  const chunkZipSet = cache.chunkZips.get(chunkId) ?? new Set<string>();
  for (const feature of collection.features as ZctaFeature[]) {
    const zip = feature.properties?.zip;
    if (!zip) continue;
    cache.featuresByZip.set(zip, feature);
    chunkZipSet.add(zip);
    cache.zipToChunkId.set(zip, chunkId);

    const countyId =
      typeof feature.properties?.county === "string" && feature.properties.county.trim().length > 0
        ? feature.properties.county.trim()
        : chunkMeta.countyId;
    if (countyId) {
      cache.countyIdByZip.set(zip, countyId);
    }

    const rawCountyName =
      typeof feature.properties?.name === "string" && feature.properties.name.trim().length > 0
        ? feature.properties.name.trim()
        : chunkMeta.name;
    if (rawCountyName) {
      // Title-case normalization keeps Instant parentArea matches predictable.
      const countyName =
        rawCountyName.length === 0
          ? rawCountyName
          : rawCountyName
              .split(/\s+/)
              .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
              .join(" ");
      cache.countyNameByZip.set(zip, countyName);
    }

    if (!cache.boundsByZip.has(zip)) {
      const bounds = computeBounds(feature);
      if (bounds) cache.boundsByZip.set(zip, bounds);
    }

    if (!cache.centroidsByZip.has(zip)) {
      const centroid = computeCentroid(feature);
      if (centroid) cache.centroidsByZip.set(zip, centroid);
    }
  }
  cache.chunkZips.set(chunkId, chunkZipSet);
  cache.featureCollection.features = Array.from(cache.featuresByZip.values()) as any;
};

export const ensureZctasForState = async (state: ZctaStateCode): Promise<void> => {
  const manifest = manifests[state];
  await Promise.all(manifest.map((entry) => ensureChunkLoaded(state, entry.id)));
};

export const ensureZctaChunks = async (state: ZctaStateCode, chunkIds: string[]): Promise<void> => {
  const cache = getOrCreateStateCache(state);
  const filteredIds = chunkIds.filter((id) => {
    const meta = cache.manifestById.get(id);
    return meta && meta.countyId !== BORDER_COUNTY_ID;
  });
  await Promise.all(filteredIds.map((id) => ensureChunkLoaded(state, id)));
};

export interface EnsureViewportOptions {
  state: ZctaStateCode;
  bounds: BoundsArray;
  paddingDegrees?: number;
}

export interface ZctaChunkSummary {
  id: string;
  countyId: string;
  name: string;
  bbox: BoundsArray;
}

const expandBounds = (bounds: BoundsArray, paddingDegrees: number): BoundsArray => [
  [bounds[0][0] - paddingDegrees, bounds[0][1] - paddingDegrees],
  [bounds[1][0] + paddingDegrees, bounds[1][1] + paddingDegrees],
];

export const ensureZctasForViewport = async ({
  state,
  bounds,
  paddingDegrees = 0.5,
}: EnsureViewportOptions): Promise<ZctaChunkSummary[]> => {
  const padded = expandBounds(bounds, paddingDegrees);
  const manifest = manifests[state];
  // Skip the synthetic border chunk so we don't eagerly fetch non-Oklahoma ZIP geometries.
  const relevantChunks = manifest.filter(
    (entry) => entry.countyId !== BORDER_COUNTY_ID && intersectsBounds(entry.bbox, padded),
  );
  await Promise.all(relevantChunks.map((chunk) => ensureChunkLoaded(state, chunk.id)));
  return relevantChunks.map((chunk) => ({
    id: chunk.id,
    countyId: chunk.countyId,
    name: chunk.name,
    bbox: chunk.bbox,
  }));
};

export const getZctaFeatureCollection = (state: ZctaStateCode): FeatureCollection<
  GeoJSON.MultiPolygon | GeoJSON.Polygon,
  { zip: string }
> => {
  const cache = stateCaches.get(state);
  return cache ? cache.featureCollection : EMPTY_FC;
};

export const getZctaFeature = (state: ZctaStateCode, zip: string): ZctaFeature | undefined => {
  const cache = stateCaches.get(state);
  return cache?.featuresByZip.get(zip);
};

export const getZctaBounds = (state: ZctaStateCode, zip: string): BoundsArray | null => {
  const cache = stateCaches.get(state);
  return cache?.boundsByZip.get(zip) ?? null;
};

export const getZctaCentroid = (state: ZctaStateCode, zip: string): [number, number] | null => {
  const cache = stateCaches.get(state);
  return cache?.centroidsByZip.get(zip) ?? null;
};

export const getZctaCountyName = (state: ZctaStateCode, zip: string): string | null => {
  const cache = stateCaches.get(state);
  return cache?.countyNameByZip.get(zip) ?? null;
};

export const getZctaCountyId = (state: ZctaStateCode, zip: string): string | null => {
  const cache = stateCaches.get(state);
  return cache?.countyIdByZip.get(zip) ?? null;
};

export const getLoadedZctaCount = (state: ZctaStateCode): number =>
  stateCaches.get(state)?.featuresByZip.size ?? 0;

const removeChunkFromCache = (state: ZctaStateCode, chunkId: string): void => {
  const cache = stateCaches.get(state);
  if (!cache) return;
  const zips = cache.chunkZips.get(chunkId);
  if (!zips) return;
  for (const zip of zips) {
    cache.featuresByZip.delete(zip);
    cache.boundsByZip.delete(zip);
    cache.centroidsByZip.delete(zip);
    cache.countyNameByZip.delete(zip);
    cache.countyIdByZip.delete(zip);
    cache.zipToChunkId.delete(zip);
  }
  cache.chunkZips.delete(chunkId);
  cache.chunksLoaded.delete(chunkId);
  cache.featureCollection.features = Array.from(cache.featuresByZip.values()) as any;
};

export const pruneZctaChunks = (state: ZctaStateCode, keepChunkIds: Set<string>): void => {
  const cache = stateCaches.get(state);
  if (!cache) return;
  const loaded = Array.from(cache.chunksLoaded);
  for (const chunkId of loaded) {
    if (!keepChunkIds.has(chunkId)) {
      removeChunkFromCache(state, chunkId);
    }
  }
};

export const getZctaChunkIdForZip = (state: ZctaStateCode, zip: string): string | null => {
  const cache = stateCaches.get(state);
  return cache?.zipToChunkId.get(zip) ?? null;
};

export const getNeighborCountyIds = (state: ZctaStateCode, countyId: string): string[] => {
  const cache = stateCaches.get(state);
  if (!cache) return [];
  const neighbors: Set<string> | undefined = cache.neighborsByCountyId.get(countyId);
  return neighbors ? Array.from(neighbors) : [];
};

export const getChunkIdsForCounty = (state: ZctaStateCode, countyId: string): string[] => {
  const cache = stateCaches.get(state);
  if (!cache) return [];
  const ids = cache.countyIdToChunkIds.get(countyId);
  return ids ? Array.from(ids) : [];
};

export const getCountyNameForId = (state: ZctaStateCode, countyId: string): string | null => {
  const cache = stateCaches.get(state);
  if (!cache) return null;
  return cache.countyIdToName.get(countyId) ?? null;
};
