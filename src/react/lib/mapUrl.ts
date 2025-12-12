// URL utilities for shareable map positions and state
// Uses query parameters: ?lat=36.1540&lng=-95.9928&z=12&stat=uuid&category=Food&orgs=id1,id2

export interface MapPosition {
  lat: number;
  lng: number;
  zoom: number;
}

export interface MapState {
  position: MapPosition | null;
  statId: string | null;
  category: string | null;
  orgIds: string[];
  showAdvanced: boolean;
  orgPinsVisible: boolean;
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

// Get full map state from URL (position + stat + category + orgs + toggles)
export function getMapStateFromUrl(): MapState {
  const position = getMapPositionFromUrl();
  const statId = getStatIdFromUrl();
  const category = getCategoryFromUrl();
  const orgIds = getOrgIdsFromUrl();
  const showAdvanced = getShowAdvancedFromUrl();
  const orgPinsVisible = getOrgPinsVisibleFromUrl();
  return { position, statId, category, orgIds, showAdvanced, orgPinsVisible };
}

// Get stat ID from URL
export function getStatIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("stat");
}

// Get category from URL
export function getCategoryFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("category");
}

// Get org IDs from URL (comma-separated)
export function getOrgIdsFromUrl(): string[] {
  if (typeof window === "undefined") return [];
  const params = new URLSearchParams(window.location.search);
  const orgsParam = params.get("orgs");
  if (!orgsParam) return [];
  return orgsParam.split(",").filter(id => id.trim().length > 0);
}

// Get showAdvanced from URL (defaults to false if not present)
export function getShowAdvancedFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("advanced") === "true";
}

// Get orgPinsVisible from URL (defaults to true if not present)
export function getOrgPinsVisibleFromUrl(): boolean {
  if (typeof window === "undefined") return true;
  const params = new URLSearchParams(window.location.search);
  const value = params.get("pins");
  // If not specified, default to true
  if (value === null) return true;
  return value === "true";
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

// Update URL with full map state (position + stat + category + orgs + toggles)
export function updateUrlWithMapState(
  lat: number,
  lng: number,
  zoom: number,
  statId: string | null,
  category: string | null,
  orgIds: string[],
  showAdvanced: boolean,
  orgPinsVisible: boolean,
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

  // Update category
  if (category) {
    url.searchParams.set("category", category);
  } else {
    url.searchParams.delete("category");
  }

  // Update orgs (comma-separated)
  if (orgIds.length > 0) {
    url.searchParams.set("orgs", orgIds.join(","));
  } else {
    url.searchParams.delete("orgs");
  }

  // Update showAdvanced (only if true, to keep URLs clean)
  if (showAdvanced) {
    url.searchParams.set("advanced", "true");
  } else {
    url.searchParams.delete("advanced");
  }

  // Update orgPinsVisible (only if false, since true is the default)
  if (!orgPinsVisible) {
    url.searchParams.set("pins", "false");
  } else {
    url.searchParams.delete("pins");
  }

  window.history.replaceState(null, "", url.toString());
}
