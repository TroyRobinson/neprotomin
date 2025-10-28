import type { FeatureCollection, Position } from "geojson";

import { oklahomaCountyBoundaries } from "../data/oklahomaCountyBoundaries";

export type CountyBoundaryFeature = FeatureCollection<
  GeoJSON.MultiPolygon | GeoJSON.Polygon,
  { county: string; name: string }
>["features"][number];

type BoundsArray = [[number, number], [number, number]];

const features = oklahomaCountyBoundaries.features as CountyBoundaryFeature[];
const featureById = new Map<string, CountyBoundaryFeature>();
const boundsById = new Map<string, BoundsArray>();

for (const feature of features) {
  const county = feature.properties?.county;
  if (county) featureById.set(county, feature);
}

const extendBounds = (
  coords: any,
  bounds: { minLng: number; minLat: number; maxLng: number; maxLat: number },
) => {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    const [lng, lat] = coords as Position;
    if (lng < bounds.minLng) bounds.minLng = lng;
    if (lat < bounds.minLat) bounds.minLat = lat;
    if (lng > bounds.maxLng) bounds.maxLng = lng;
    if (lat > bounds.maxLat) bounds.maxLat = lat;
    return;
  }
  for (const coord of coords) extendBounds(coord, bounds);
};

const computeBounds = (feature: CountyBoundaryFeature): BoundsArray | undefined => {
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

export const getCountyFeature = (id: string): CountyBoundaryFeature | undefined => featureById.get(id);

export const getCountyBounds = (id: string): BoundsArray | undefined => {
  if (boundsById.has(id)) return boundsById.get(id);
  const feature = getCountyFeature(id);
  if (!feature) return undefined;
  const bounds = computeBounds(feature);
  if (bounds) boundsById.set(id, bounds);
  return bounds;
};

export const getCountyName = (id: string): string | undefined => featureById.get(id)?.properties?.name;

export const getAllCountyIds = (): string[] => features.map((f) => f.properties?.county).filter((v): v is string => typeof v === "string");

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
    return (geometry.coordinates as Position[][][]).some((poly) => pointInPolygon(point, poly));
  }

  return false;
};

export const findCountyForLocation = (longitude: number, latitude: number): string | null => {
  const point: Position = [longitude, latitude];

  for (const feature of features) {
    const county = feature.properties?.county;
    if (!county) continue;
    const bounds = getCountyBounds(county);
    if (!bounds) continue;
    const [[minLng, minLat], [maxLng, maxLat]] = bounds;
    if (longitude < minLng || longitude > maxLng || latitude < minLat || latitude > maxLat) {
      continue;
    }
    if (feature.geometry && pointInGeometry(point, feature.geometry)) {
      return county;
    }
  }

  return null;
};
