import type { Feature, FeatureCollection, Point, Position } from "geojson";

import { tulsaZipBoundaries } from "../data/tulsaZipBoundaries";

type ZipBoundaryFeature = Feature<
  GeoJSON.MultiPolygon | GeoJSON.Polygon,
  { zip: string }
>;

export type ZipCentroid = [number, number];

let cachedCentroidsMap: Map<string, ZipCentroid> | null = null;
let cachedCentroidsFC:
  | FeatureCollection<Point, { zip: string }>
  | null = null;

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
    let sx = 0, sy = 0;
    for (const p of ring) { sx += (p as [number, number])[0]; sy += (p as [number, number])[1]; }
    return [sx / ring.length, sy / ring.length, 0];
  }
  return [cx / (6 * area), cy / (6 * area), Math.abs(area)];
};

const computeCentroidForFeature = (feature: ZipBoundaryFeature): ZipCentroid => {
  let totalArea = 0;
  let accX = 0, accY = 0;
  if (feature.geometry?.type === "Polygon") {
    const [cx, cy, a] = ringCentroid((feature.geometry.coordinates[0] || []) as Position[]);
    totalArea += a;
    accX += cx * a;
    accY += cy * a;
  } else if (feature.geometry?.type === "MultiPolygon") {
    for (const poly of feature.geometry.coordinates as Position[][][]) {
      const [cx, cy, a] = ringCentroid((poly[0] || []) as Position[]);
      totalArea += a;
      accX += cx * a;
      accY += cy * a;
    }
  }
  const center: ZipCentroid = totalArea > 0 ? [accX / totalArea, accY / totalArea] : [0, 0];
  return center;
};

export const getZipCentroidsMap = (): Map<string, ZipCentroid> => {
  if (cachedCentroidsMap) return cachedCentroidsMap;
  const map = new Map<string, ZipCentroid>();
  for (const feature of tulsaZipBoundaries.features as ZipBoundaryFeature[]) {
    const zip = feature.properties?.zip as string | undefined;
    if (!zip) continue;
    map.set(zip, computeCentroidForFeature(feature));
  }
  cachedCentroidsMap = map;
  return map;
};

export const getZipCentroidFeatureCollection = (): FeatureCollection<
  Point,
  { zip: string }
> => {
  if (cachedCentroidsFC) return cachedCentroidsFC;
  const features: Feature<Point, { zip: string }>[] = [];
  for (const feature of tulsaZipBoundaries.features as ZipBoundaryFeature[]) {
    const zip = feature.properties?.zip as string | undefined;
    if (!zip) continue;
    const [lng, lat] = computeCentroidForFeature(feature);
    features.push({ type: "Feature", properties: { zip }, geometry: { type: "Point", coordinates: [lng, lat] } });
  }
  cachedCentroidsFC = { type: "FeatureCollection", features };
  return cachedCentroidsFC;
};


