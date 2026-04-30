import type { BoundsArray } from "../../../lib/zipBoundaries";

export const boundsArea = (bounds: BoundsArray): number => {
  const width = Math.max(0, bounds[1][0] - bounds[0][0]);
  const height = Math.max(0, bounds[1][1] - bounds[0][1]);
  return width * height;
};

export const intersectionArea = (a: BoundsArray, b: BoundsArray): number => {
  const minLng = Math.max(a[0][0], b[0][0]);
  const minLat = Math.max(a[0][1], b[0][1]);
  const maxLng = Math.min(a[1][0], b[1][0]);
  const maxLat = Math.min(a[1][1], b[1][1]);
  if (minLng >= maxLng || minLat >= maxLat) return 0;
  return (maxLng - minLng) * (maxLat - minLat);
};
