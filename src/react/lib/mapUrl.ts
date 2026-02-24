// URL utilities for shareable map positions and state
// Uses query parameters: ?lat=36.1540&lng=-95.9928&z=12&stat=uuid&stat2=uuid&category=Food&orgs=id1,id2&poi=true
import { getDomainDefaults } from "./domains";

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
  secondaryStatId: string | null;
  category: string | null;
  orgIds: string[];
  startTour: boolean;
  showAdvanced: boolean;
  orgPinsVisible: boolean;
  extremasVisible: boolean;
  areasMode: AreasMode;
  selectedZips: string[];
  selectedCounties: string[];
  sidebarTab: "orgs" | "stats";
  sidebarCollapsed: boolean;
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

// Get full map state from URL (position + stats + category + orgs + toggles + areas + selections)
export function getMapStateFromUrl(): MapState {
  const position = getMapPositionFromUrl();
  const statId = getStatIdFromUrl();
  const secondaryStatId = getSecondaryStatIdFromUrl();
  const category = getCategoryFromUrl();
  const orgIds = getOrgIdsFromUrl();
  const startTour = getStartTourFromUrl();
  const showAdvanced = getShowAdvancedFromUrl();
  const orgPinsVisible = getOrgPinsVisibleFromUrl();
  const extremasVisible = getExtremasVisibleFromUrl();
  const areasMode = getAreasModeFromUrl();
  const selectedZips = getSelectedZipsFromUrl();
  const selectedCounties = getSelectedCountiesFromUrl();
  const sidebarTab = getSidebarTabFromUrl();
  const sidebarCollapsed = getSidebarCollapsedFromUrl();
  const sidebarInsights = getSidebarInsightsFromUrl();
  return {
    position,
    statId,
    secondaryStatId,
    category,
    orgIds,
    startTour,
    showAdvanced,
    orgPinsVisible,
    extremasVisible,
    areasMode,
    selectedZips,
    selectedCounties,
    sidebarTab,
    sidebarCollapsed,
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

// Get secondary stat ID from URL
export function getSecondaryStatIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  return params.get("stat2");
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

// Get guided tour trigger from URL (?tour=true / ?tour=1)
export function getStartTourFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  const raw = (params.get("tour") || "").trim().toLowerCase();
  return raw === "true" || raw === "1";
}

// Get showAdvanced from URL (defaults to false if not present)
export function getShowAdvancedFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("advanced") === "true";
}

// Get orgPinsVisible from URL (defaults based on domain if not present)
export function getOrgPinsVisibleFromUrl(): boolean {
  const defaultPinsVisible = getDomainDefaults().defaultOrgPinsVisible;
  if (typeof window === "undefined") return defaultPinsVisible;
  const params = new URLSearchParams(window.location.search);
  const value = params.get("pins");
  // If not specified, use domain default.
  if (value === null) return defaultPinsVisible;
  return value === "true";
}

// Get extrema/POI visibility from URL (defaults based on domain if not present)
export function getExtremasVisibleFromUrl(): boolean {
  const defaultExtremasVisible = getDomainDefaults().defaultExtremasVisible;
  if (typeof window === "undefined") return defaultExtremasVisible;
  const params = new URLSearchParams(window.location.search);
  const value = params.get("poi");
  if (value === null) return defaultExtremasVisible;
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

// Get sidebar tab from URL (defaults based on domain)
export function getSidebarTabFromUrl(): "orgs" | "stats" {
  const defaultTab = getDomainDefaults().defaultSidebarTab;
  if (typeof window === "undefined") return defaultTab;
  const params = new URLSearchParams(window.location.search);
  const tab = params.get("tab");
  if (tab === "stats" || tab === "orgs") return tab;
  return defaultTab;
}

// Get sidebar collapsed state from URL (defaults to true)
export function getSidebarCollapsedFromUrl(): boolean {
  if (typeof window === "undefined") return true;
  const params = new URLSearchParams(window.location.search);
  const collapsed = parseBoolParam(params, "sc");
  return collapsed.value ?? true;
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

// Update URL with full map state (position + stats + category + orgs + toggles + areas + selections)
export function updateUrlWithMapState(
  lat: number,
  lng: number,
  zoom: number,
  statId: string | null,
  secondaryStatId: string | null,
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
  sidebarCollapsed = true,
  extremasVisible = getDomainDefaults().defaultExtremasVisible,
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

  // Update secondary stat
  if (secondaryStatId) {
    url.searchParams.set("stat2", secondaryStatId);
  } else {
    url.searchParams.delete("stat2");
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

  const defaultOrgPinsVisible = getDomainDefaults().defaultOrgPinsVisible;
  // Persist orgPinsVisible only when it differs from this domain's default.
  if (orgPinsVisible !== defaultOrgPinsVisible) {
    url.searchParams.set("pins", orgPinsVisible ? "true" : "false");
  } else {
    url.searchParams.delete("pins");
  }

  const defaultExtremasVisible = getDomainDefaults().defaultExtremasVisible;
  // Persist extrema visibility only when it differs from this domain's default.
  if (extremasVisible !== defaultExtremasVisible) {
    url.searchParams.set("poi", extremasVisible ? "true" : "false");
  } else {
    url.searchParams.delete("poi");
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

  const defaultSidebarTab = getDomainDefaults().defaultSidebarTab;
  // Update sidebar tab (only write if not the domain default)
  if (sidebarTab !== defaultSidebarTab) {
    url.searchParams.set("tab", sidebarTab);
  } else {
    url.searchParams.delete("tab");
  }

  // Update sidebar collapsed state (only write if open, since collapsed=true is default)
  if (!sidebarCollapsed) {
    url.searchParams.set("sc", "false");
  } else {
    url.searchParams.delete("sc");
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
