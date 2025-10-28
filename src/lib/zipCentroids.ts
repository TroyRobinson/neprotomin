import type { Feature, FeatureCollection, Point } from "geojson";

import {
  ensureZctasForState,
  getLoadedZctaCount,
  getZctaCentroid,
  getZctaFeatureCollection,
  type ZctaStateCode,
} from "./zctaLoader";

type ZipBoundaryFeature = Feature<
  GeoJSON.MultiPolygon | GeoJSON.Polygon,
  { zip: string }
>;

export type ZipCentroid = [number, number];

const ZCTA_STATE: ZctaStateCode = "ok";

let cachedCentroidsMap: Map<string, ZipCentroid> | null = null;
let cachedCentroidsCount = -1;
let cachedCentroidsFC: FeatureCollection<Point, { zip: string }> | null = null;

const rebuildCentroidCache = (): void => {
  const collection = getZctaFeatureCollection(ZCTA_STATE);
  const newMap = new Map<string, ZipCentroid>();
  const newFeatures: Feature<Point, { zip: string }>[] = [];

  for (const feature of collection.features as ZipBoundaryFeature[]) {
    const zip = feature.properties?.zip;
    if (!zip) continue;
    const centroid = getZctaCentroid(ZCTA_STATE, zip);
    if (!centroid) continue;
    newMap.set(zip, centroid);
    newFeatures.push({
      type: "Feature",
      properties: { zip },
      geometry: { type: "Point", coordinates: centroid },
    });
  }

  cachedCentroidsMap = newMap;
  cachedCentroidsFC = { type: "FeatureCollection", features: newFeatures };
  cachedCentroidsCount = getLoadedZctaCount(ZCTA_STATE);
};

const ensureCacheFresh = (): void => {
  const loadedCount = getLoadedZctaCount(ZCTA_STATE);
  if (cachedCentroidsMap && cachedCentroidsCount === loadedCount) {
    return;
  }
  rebuildCentroidCache();
};

export const getZipCentroidsMap = (): Map<string, ZipCentroid> => {
  ensureCacheFresh();
  return cachedCentroidsMap ?? new Map();
};

export const getZipCentroidFeatureCollection = (): FeatureCollection<Point, { zip: string }> => {
  ensureCacheFresh();
  return (
    cachedCentroidsFC ?? {
      type: "FeatureCollection",
      features: [],
    }
  );
};

export const ensureZipCentroidsLoaded = async (): Promise<void> => {
  await ensureZctasForState(ZCTA_STATE);
  rebuildCentroidCache();
};

