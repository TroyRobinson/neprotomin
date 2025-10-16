import type { Position } from 'geojson';
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

