// URL utilities for shareable map positions and state
// Uses query parameters: ?lat=36.1540&lng=-95.9928&z=12&stat=uuid&category=Food&orgs=id1,id2

export interface MapPosition {
  lat: number;
  lng: number;
  zoom: number;
}

export interface SidebarInsightsState {
  /** Whether the StatViz (trend) section is shown */
  statVizVisible: boolean;
  /** Whether the StatViz section is collapsed */
  statVizCollapsed: boolean;
  /** Whether the demographics section is shown */
  demographicsVisible: boolean;
  /** Whether the demographics section is expanded */
  demographicsExpanded: boolean;
  /** True if any sidebar-insights params were present in the URL */
  hasAnyParam: boolean;
}

// Areas mode combines boundaryControlMode and boundaryMode:
// - "auto" = automatic switching based on zoom
// - "zips" = manual, show ZIP boundaries
// - "counties" = manual, show county boundaries
// - "none" = no boundaries
export type AreasMode = "auto" | "zips" | "counties" | "none";

export interface MapState {
  position: MapPosition | null;
  statId: string | null;
  category: string | null;
  orgIds: string[];
  showAdvanced: boolean;
  orgPinsVisible: boolean;
  areasMode: AreasMode;
  selectedZips: string[];
  selectedCounties: string[];
  sidebarTab: "orgs" | "stats";
  sidebarInsights: SidebarInsightsState;
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

// Get full map state from URL (position + stat + category + orgs + toggles + areas + selections)
export function getMapStateFromUrl(): MapState {
  const position = getMapPositionFromUrl();
  const statId = getStatIdFromUrl();
  const category = getCategoryFromUrl();
  const orgIds = getOrgIdsFromUrl();
  const showAdvanced = getShowAdvancedFromUrl();
  const orgPinsVisible = getOrgPinsVisibleFromUrl();
  const areasMode = getAreasModeFromUrl();
  const selectedZips = getSelectedZipsFromUrl();
  const selectedCounties = getSelectedCountiesFromUrl();
  const sidebarTab = getSidebarTabFromUrl();
  const sidebarInsights = getSidebarInsightsFromUrl();
  return {
    position,
    statId,
    category,
    orgIds,
    showAdvanced,
    orgPinsVisible,
    areasMode,
    selectedZips,
    selectedCounties,
    sidebarTab,
    sidebarInsights,
  };
}

const parseBoolParam = (
  params: URLSearchParams,
  key: string,
): { value: boolean | null; present: boolean } => {
  const raw = params.get(key);
  if (raw === null) return { value: null, present: false };
  if (raw === "true") return { value: true, present: true };
  if (raw === "false") return { value: false, present: true };
  return { value: null, present: true };
};

// Get sidebar "insights" (Demographics + StatViz) visibility + expansion state.
export function getSidebarInsightsFromUrl(): SidebarInsightsState {
  if (typeof window === "undefined") {
    return {
      statVizVisible: true,
      statVizCollapsed: false,
      demographicsVisible: true,
      demographicsExpanded: false,
      hasAnyParam: false,
    };
  }

  const params = new URLSearchParams(window.location.search);

  const sv = parseBoolParam(params, "sv");
  const svc = parseBoolParam(params, "svc");
  const demo = parseBoolParam(params, "demo");
  const demoe = parseBoolParam(params, "demoe");

  const hasAnyParam = sv.present || svc.present || demo.present || demoe.present;

  return {
    statVizVisible: sv.value ?? true,
    statVizCollapsed: svc.value ?? false,
    demographicsVisible: demo.value ?? true,
    demographicsExpanded: demoe.value ?? false,
    hasAnyParam,
  };
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

// Get areas mode from URL (defaults to "auto" if not present)
export function getAreasModeFromUrl(): AreasMode {
  if (typeof window === "undefined") return "auto";
  const params = new URLSearchParams(window.location.search);
  const value = params.get("areas");
  if (value === "zips" || value === "counties" || value === "none") {
    return value;
  }
  return "auto";
}

// Get selected ZIP codes from URL (comma-separated)
export function getSelectedZipsFromUrl(): string[] {
  if (typeof window === "undefined") return [];
  const params = new URLSearchParams(window.location.search);
  const zipsParam = params.get("zips");
  if (!zipsParam) return [];
  return zipsParam
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

// Get selected counties from URL (comma-separated)
export function getSelectedCountiesFromUrl(): string[] {
  if (typeof window === "undefined") return [];
  const params = new URLSearchParams(window.location.search);
  const countiesParam = params.get("counties");
  if (!countiesParam) return [];
  return countiesParam
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

// Get sidebar tab from URL (defaults to "orgs")
export function getSidebarTabFromUrl(): "orgs" | "stats" {
  if (typeof window === "undefined") return "orgs";
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  if (tab === "stats" || tab === "orgs") return tab;
  return "orgs";
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

// Update URL with full map state (position + stat + category + orgs + toggles + areas + selections)
export function updateUrlWithMapState(
  lat: number,
  lng: number,
  zoom: number,
  statId: string | null,
  category: string | null,
  orgIds: string[],
  showAdvanced: boolean,
  orgPinsVisible: boolean,
  areasMode: AreasMode,
  selectedZips: string[],
  selectedCounties: string[],
  sidebarTab: "orgs" | "stats",
  sidebarInsights: Omit<SidebarInsightsState, "hasAnyParam">,
  persistSidebarInsights: boolean,
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

  // Update areas mode (only if not "auto", since that's the default)
  if (areasMode !== "auto") {
    url.searchParams.set("areas", areasMode);
  } else {
    url.searchParams.delete("areas");
  }

  // Update selected ZIPs (comma-separated)
  if (selectedZips.length > 0) {
    url.searchParams.set("zips", selectedZips.join(","));
  } else {
    url.searchParams.delete("zips");
  }

  // Update selected counties (comma-separated)
  if (selectedCounties.length > 0) {
    url.searchParams.set("counties", selectedCounties.join(","));
  } else {
    url.searchParams.delete("counties");
  }

  // Update sidebar tab (only write if not default "orgs")
  if (sidebarTab === "stats") {
    url.searchParams.set("tab", "stats");
  } else {
    url.searchParams.delete("tab");
  }

  // Sidebar insights sections (Demographics + StatViz)
  if (persistSidebarInsights) {
    url.searchParams.set("sv", sidebarInsights.statVizVisible ? "true" : "false");
    url.searchParams.set("svc", sidebarInsights.statVizCollapsed ? "true" : "false");
    url.searchParams.set("demo", sidebarInsights.demographicsVisible ? "true" : "false");
    url.searchParams.set("demoe", sidebarInsights.demographicsExpanded ? "true" : "false");
  } else {
    url.searchParams.delete("sv");
    url.searchParams.delete("svc");
    url.searchParams.delete("demo");
    url.searchParams.delete("demoe");
  }

  window.history.replaceState(null, "", url.toString());
}
