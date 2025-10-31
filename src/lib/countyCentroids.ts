import type { Position, FeatureCollection, Feature, Point } from 'geojson';
import { oklahomaCountyBoundaries } from '../data/oklahomaCountyBoundaries';

const centroids = new Map<string, [number, number]>();
const names = new Map<string, string>();

function computeBBoxCenter(coords: any): [number, number] | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const extend = (c: any) => {
    if (Array.isArray(c[0]) && typeof c[0][0] === 'number') {
      for (const p of c as Position[]) {
        const [lng, lat] = p as Position;
        minLng = Math.min(minLng, lng);
        minLat = Math.min(minLat, lat);
        maxLng = Math.max(maxLng, lng);
        maxLat = Math.max(maxLat, lat);
      }
    } else if (Array.isArray(c)) {
      for (const sub of c) extend(sub);
    }
  };
  extend(coords);
  if (!Number.isFinite(minLng) || !Number.isFinite(minLat) || !Number.isFinite(maxLng) || !Number.isFinite(maxLat)) return null;
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
}

for (const f of oklahomaCountyBoundaries.features as any[]) {
  const id = f?.properties?.county as string | undefined;
  const name = f?.properties?.name as string | undefined;
  if (!id || !f?.geometry) continue;
  const center = computeBBoxCenter(f.geometry.coordinates);
  if (center) centroids.set(id, center);
  if (name) names.set(id, name);
}

export const getCountyCentroidsMap = () => centroids;
export const getCountyName = (id: string) => names.get(id) || id;

// Build reverse lookup: name -> id (case-insensitive)
const nameToId = new Map<string, string>();
for (const [id, name] of names.entries()) {
  nameToId.set(name.toLowerCase(), id);
}

export const getCountyIdByName = (name: string): string | undefined => {
  return nameToId.get(name.toLowerCase());
};

export const getCountyCentroidFeatureCollection = (): FeatureCollection<
  Point,
  { county: string; name: string | undefined }
> => {
  const features: Feature<Point, { county: string; name: string | undefined }>[] = [];
  for (const f of oklahomaCountyBoundaries.features as any[]) {
    const id = f?.properties?.county as string | undefined;
    if (!id) continue;
    const center = centroids.get(id) ?? computeBBoxCenter(f.geometry?.coordinates);
    if (!center) continue;
    features.push({
      type: "Feature",
      properties: { county: id, name: names.get(id) },
      geometry: {
        type: "Point",
        coordinates: center,
      },
    });
  }
  return { type: "FeatureCollection", features };
};
