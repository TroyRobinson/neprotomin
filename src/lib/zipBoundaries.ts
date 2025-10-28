import type { Feature, Position } from "geojson";

import {
  ensureZctasForState,
  getZctaBounds,
  getZctaFeature,
  getZctaFeatureCollection,
  getZctaCountyId,
  getZctaCountyName,
  type BoundsArray,
  type ZctaStateCode,
} from "./zctaLoader";

export type ZipBoundaryFeature = Feature<
  GeoJSON.MultiPolygon | GeoJSON.Polygon,
  { zip: string }
>;

const ZCTA_STATE: ZctaStateCode = "ok";

const pointInRing = (point: Position, ring: Position[]): boolean => {
  let inside = false;
  const [x, y] = point;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];

    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
};

const pointInPolygon = (point: Position, polygon: Position[][]): boolean => {
  if (polygon.length === 0) return false;
  if (!pointInRing(point, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(point, polygon[i])) return false;
  }
  return true;
};

const pointInGeometry = (point: Position, geometry: GeoJSON.Geometry): boolean => {
  if (geometry.type === "Polygon") {
    return pointInPolygon(point, geometry.coordinates as Position[][]);
  }

  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as Position[][][]).some((poly) =>
      pointInPolygon(point, poly),
    );
  }

  return false;
};

export const getZipFeature = (zip: string): ZipBoundaryFeature | undefined =>
  getZctaFeature(ZCTA_STATE, zip);

export const getZipBounds = (zip: string): BoundsArray | undefined => {
  return getZctaBounds(ZCTA_STATE, zip) ?? undefined;
};

export const getZipCountyName = (zip: string): string | null => {
  return getZctaCountyName(ZCTA_STATE, zip);
};

export const getZipCountyId = (zip: string): string | null => {
  return getZctaCountyId(ZCTA_STATE, zip);
};

const pointInBounds = (point: Position, bounds: BoundsArray): boolean => {
  const [min, max] = bounds;
  return (
    point[0] >= min[0] &&
    point[0] <= max[0] &&
    point[1] >= min[1] &&
    point[1] <= max[1]
  );
};

export const findZipForLocation = (longitude: number, latitude: number): string | null => {
  const point: Position = [longitude, latitude];

  const collection = getZctaFeatureCollection(ZCTA_STATE);
  for (const feature of collection.features as ZipBoundaryFeature[]) {
    const zip = feature.properties?.zip;
    if (!zip) continue;
    const bounds = getZipBounds(zip);
    if (!bounds || !pointInBounds(point, bounds)) continue;
    if (feature.geometry && pointInGeometry(point, feature.geometry)) {
      return zip;
    }
  }

  return null;
};

export const getAllZipCodes = (): string[] => {
  const collection = getZctaFeatureCollection(ZCTA_STATE);
  const zips: string[] = [];
  for (const feature of collection.features as ZipBoundaryFeature[]) {
    const zip = feature.properties?.zip;
    if (zip) zips.push(zip);
  }
  return zips;
};

/**
 * Ensure the entire state's ZCTA dataset is available. Useful for scripts that
 * need to iterate over every ZIP (e.g., seeding) outside of the map viewport.
 */
export const ensureAllZipDataLoaded = async (): Promise<void> => {
  await ensureZctasForState(ZCTA_STATE);
};

export type { BoundsArray } from "./zctaLoader";
