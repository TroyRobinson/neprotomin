import type { Feature, Position } from "geojson";

import { tulsaZipBoundaries } from "../data/tulsaZipBoundaries";

export type ZipBoundaryFeature = Feature<
  GeoJSON.MultiPolygon | GeoJSON.Polygon,
  { zip: string }
>;

export type BoundsArray = [[number, number], [number, number]];

const features = tulsaZipBoundaries.features as ZipBoundaryFeature[];

const featureByZip = new Map<string, ZipBoundaryFeature>();
const boundsByZip = new Map<string, BoundsArray>();

for (const feature of features) {
  const zip = feature.properties?.zip;
  if (zip) {
    featureByZip.set(zip, feature);
  }
}

const extendBounds = (
  coords: any,
  bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number },
) => {
  if (!Array.isArray(coords)) {
    return;
  }

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

const computeBounds = (feature: ZipBoundaryFeature): BoundsArray | undefined => {
  if (!feature.geometry) return undefined;
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
    return undefined;
  }

  return [
    [bounds.minLng, bounds.minLat],
    [bounds.maxLng, bounds.maxLat],
  ];
};

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
  featureByZip.get(zip);

export const getZipBounds = (zip: string): BoundsArray | undefined => {
  if (boundsByZip.has(zip)) {
    return boundsByZip.get(zip);
  }
  const feature = getZipFeature(zip);
  if (!feature) return undefined;
  const bounds = computeBounds(feature);
  if (bounds) {
    boundsByZip.set(zip, bounds);
  }
  return bounds;
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

  for (const feature of features) {
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

export const getAllZipCodes = (): string[] => Array.from(featureByZip.keys());
