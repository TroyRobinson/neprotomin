// URL utilities for shareable map positions
// Uses query parameters: ?lat=36.1540&lng=-95.9928&z=12

export interface MapPosition {
  lat: number;
  lng: number;
  zoom: number;
}

// Parse map position from current URL query params
export function getMapPositionFromUrl(): MapPosition | null {
  if (typeof window === "undefined") return null;

  const params = new URLSearchParams(window.location.search);
  const lat = params.get("lat");
  const lng = params.get("lng");
  const z = params.get("z");

  // Require all three params
  if (!lat || !lng || !z) return null;

  const latNum = parseFloat(lat);
  const lngNum = parseFloat(lng);
  const zoomNum = parseFloat(z);

  // Validate numbers
  if (isNaN(latNum) || isNaN(lngNum) || isNaN(zoomNum)) return null;

  // Basic bounds validation (roughly Oklahoma area with some buffer)
  if (latNum < 30 || latNum > 40) return null;
  if (lngNum < -105 || lngNum > -90) return null;
  if (zoomNum < 0 || zoomNum > 22) return null;

  return { lat: latNum, lng: lngNum, zoom: zoomNum };
}

// Update URL with map position without triggering navigation
export function updateUrlWithMapPosition(
  lat: number,
  lng: number,
  zoom: number,
): void {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);

  // Round to reasonable precision: 4 decimals for coords (~11m), 2 for zoom
  url.searchParams.set("lat", lat.toFixed(4));
  url.searchParams.set("lng", lng.toFixed(4));
  url.searchParams.set("z", zoom.toFixed(2));

  // Use replaceState to avoid polluting browser history
  window.history.replaceState(null, "", url.toString());
}

// Clear map position params from URL
export function clearMapPositionFromUrl(): void {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  url.searchParams.delete("lat");
  url.searchParams.delete("lng");
  url.searchParams.delete("z");

  window.history.replaceState(null, "", url.toString());
}
