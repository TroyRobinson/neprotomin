// URL utilities for shareable map positions and state
// Uses query parameters: ?lat=36.1540&lng=-95.9928&z=12&stat=uuid

export interface MapPosition {
  lat: number;
  lng: number;
  zoom: number;
}

export interface MapState {
  position: MapPosition | null;
  statId: string | null;
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

// Get full map state from URL (position + stat)
export function getMapStateFromUrl(): MapState {
  const position = getMapPositionFromUrl();
  const statId = getStatIdFromUrl();
  return { position, statId };
}

// Get stat ID from URL
export function getStatIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("stat");
}

// Update URL with stat ID
export function updateUrlWithStatId(statId: string | null): void {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);

  if (statId) {
    url.searchParams.set("stat", statId);
  } else {
    url.searchParams.delete("stat");
  }

  window.history.replaceState(null, "", url.toString());
}

// Update URL with both position and stat
export function updateUrlWithMapState(
  lat: number,
  lng: number,
  zoom: number,
  statId: string | null,
): void {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);

  // Update position
  url.searchParams.set("lat", lat.toFixed(4));
  url.searchParams.set("lng", lng.toFixed(4));
  url.searchParams.set("z", zoom.toFixed(2));

  // Update stat
  if (statId) {
    url.searchParams.set("stat", statId);
  } else {
    url.searchParams.delete("stat");
  }

  window.history.replaceState(null, "", url.toString());
}
