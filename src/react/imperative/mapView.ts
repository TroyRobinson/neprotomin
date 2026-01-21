import maplibregl from "maplibre-gl";

// tulsaZipBoundaries no longer needed here (used in boundary layer module)
import { computeToggle, computeAddTransient, computeClearTransient } from "./state/zipSelection";
import { getZipCountyName, getZipCountyId } from "../../lib/zipBoundaries";
import type { BoundsArray } from "../../lib/zipBoundaries";
import type { BoundaryMode } from "../../types/boundaries";
import type { Organization } from "../../types/organization";
import { OKLAHOMA_CENTER, OKLAHOMA_DEFAULT_ZOOM } from "../../types/organization";
import { themeController } from "./theme";
// palettes/hover are used inside boundary layer helpers now
import { createCategoryChips } from "./categoryChips";
import { setStatDataPrefetchStatIds, setStatDataPriorityStatIds, setStatDataScopeParentAreas, statDataStore } from "../../state/statData";
import type { StatDataByParentArea } from "../../state/statData";
import { createZipFloatingTitle, type ZipFloatingTitleController } from "./components/zipFloatingTitle";
import { createZipLabels, type ZipLabelsController } from "./components/zipLabels";
import { createChoroplethLegend, type ChoroplethLegendController } from "./components/choroplethLegend";
import { createSecondaryChoroplethLegend, type SecondaryChoroplethLegendController } from "./components/secondaryChoroplethLegend";
import { statsStore } from "../../state/stats";
import { createOrgLegend, type OrgLegendController } from "./components/orgLegend";
import { createMapLoadingIndicator } from "./components/mapLoadingIndicator";
import { getCountyCentroidsMap, getCountyName } from "../../lib/countyCentroids";
import type { AreaId, AreaKind } from "../../types/areas";
import { DEFAULT_PARENT_AREA_BY_KIND } from "../../types/areas";
import type { TimeSelection } from "../lib/timeFilters";
// choropleth helpers are used only inside overlays/stats now
import { updateChoroplethLegend as extUpdateLegend, updateSecondaryChoroplethLegend as extUpdateSecondaryLegend, updateSecondaryStatOverlay as extUpdateSecondaryOverlay, updateSecondaryStatHoverOnly as extUpdateSecondaryStatHover, updateStatDataChoropleth as extUpdatePrimaryChoropleth, CHOROPLETH_HIDE_ZOOM } from "./overlays/stats";
import {
  ensureBoundaryLayers,
  updateBoundaryPaint as extUpdateBoundaryPaint,
  updateBoundaryVisibility as extUpdateBoundaryVisibility,
  updateZipSelectionHighlight as extUpdateZipSelectionHighlight,
  updateZipHoverOutline as extUpdateZipHoverOutline,
  updateCountyHoverOutline as extUpdateCountyHoverOutline,
  updateCountySelectionHighlight as extUpdateCountySelectionHighlight,
} from "./layers/boundaries";
import { ensureOrganizationLayers } from "./layers/organizations";
import { setClusterHighlight as extSetClusterHighlight, setClusterHighlights as extSetClusterHighlights } from "./organizationsHighlight";
import { wireVisibleIds } from "./visibilityTracker";
import { getAreaRegistryEntry, type AreaLayerIds } from "./areas/registry";
import {
  ensureZctasForViewport,
  ensureZctaChunks,
  getZctaFeatureCollection,
  pruneZctaChunks,
  getZctaChunkIdForZip,
  getNeighborCountyIds,
  getChunkIdsForCounty,
  getCountyNameForId,
  type ZctaStateCode,
  type ZctaChunkSummary,
} from "../../lib/zctaLoader";
import { normalizeScopeLabel, formatCountyScopeLabel } from "../../lib/scopeLabels";
import { isLowMemoryDevice } from "../../lib/device";
import { PREFETCH_RECENT_STATS_KEY, REDUCED_DATA_LOADING_KEY, readBoolSetting } from "../../lib/settings";

interface AreaSelectionChange {
  kind: AreaKind;
  selected: string[];
  pinned: string[];
  transient: string[];
}

interface MapViewOptions {
  initialUserLocation?: { lng: number; lat: number } | null;
  initialMapPosition?: { lng: number; lat: number; zoom: number } | null;
  onHover: (idOrIds: string | string[] | null) => void;
  onVisibleIdsChange?: (ids: string[], totalInSource: number, allSourceIds: string[]) => void;
  onZipSelectionChange?: (selectedZips: string[], meta?: { pinned: string[]; transient: string[] }) => void;
  onZipHoverChange?: (zip: string | null) => void;
  onCountySelectionChange?: (selectedCounties: string[], meta?: { pinned: string[]; transient: string[] }) => void;
  onCountyHoverChange?: (county: string | null) => void;
  onAreaSelectionChange?: (change: AreaSelectionChange) => void;
  onAreaHoverChange?: (area: AreaId | null) => void;
  onStatSelectionChange?: (statId: string | null) => void;
  onSecondaryStatChange?: (statId: string | null) => void;
  onCategorySelectionChange?: (categoryId: string | null) => void;
  onBoundaryModeChange?: (mode: BoundaryMode) => void;
  onZipScopeChange?: (scopeLabel: string, neighbors: string[]) => void;
  shouldAutoBoundarySwitch?: () => boolean;
  onMapDragStart?: () => void;
  onOrganizationClick?: (organizationId: string, meta?: { source: "point" | "centroid" }) => void;
  onClusterClick?: (
    organizationIds: string[],
    meta: { count: number; longitude: number; latitude: number },
  ) => void;
  isMobile?: boolean;
  onLocationSearch?: (query: string) => void;
  onRequestHideOrgs?: () => void;
  onTimeChipClick?: () => void;
  onTimeChipClear?: () => void;
  onLegendSettingsClick?: () => void;
  legendRangeMode?: "dynamic" | "scoped" | "global";
}

export interface MapViewController {
  element: HTMLElement;
  setOrganizations: (organizations: Organization[]) => void;
  setActiveOrganization: (id: string | null) => void;
  centerOnOrganization: (id: string, options?: { animate?: boolean; zoom?: number; offset?: [number, number] }) => void;
  setSelectedOrgIds: (ids: string[]) => void;
  setCategoryFilter: (categoryId: string | null) => void;
  setSelectedStat: (statId: string | null) => void;
  setSecondaryStat: (statId: string | null) => void;
  setVisibleStatIds: (ids: string[] | null) => void;
  setBoundaryMode: (mode: BoundaryMode) => void;
  setPinnedZips: (zips: string[]) => void;
  setHoveredZip: (zip: string | null) => void;
  setPinnedCounties: (counties: string[]) => void;
  setHoveredCounty: (county: string | null) => void;
  clearTransientSelection: () => void;
  addTransientZips: (zips: string[]) => void;
  clearCountyTransientSelection: () => void;
  addTransientCounties: (counties: string[]) => void;
  fitAllOrganizations: () => void;
  setTimeSelection: (selection: TimeSelection | null) => void;
  setTimeFilterAvailable: (available: boolean) => void;
  setOrganizationPinsVisible: (visible: boolean) => void;
  setUserLocation: (location: { lng: number; lat: number } | null) => void;
  fitBounds: (bounds: BoundsArray, options?: { padding?: number; maxZoom?: number; duration?: number }) => void;
  setCamera: (centerLng: number, centerLat: number, zoom: number, options?: { animate?: boolean }) => void;
  onCameraChange: (fn: (centerLng: number, centerLat: number, zoom: number) => void) => () => void;
  setLegendInset: (pixels: number) => void;
  setLegendTop: (topPx: number) => void;
  setLegendVisible: (visible: boolean) => void;
  setLegendRightContent: (el: HTMLElement | null) => void;
  setLegendRangeMode: (mode: "dynamic" | "scoped" | "global") => void;
  resize: () => void;
  destroy: () => void;
}

type ThemeName = "light" | "dark";

const MAP_STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const MAP_STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const DEFAULT_GLOW_COLOR = "#fdba74";
const SELECTED_GLOW_COLOR = "#8a93ff"; // Tailwind brand-400 indigo

const getMapStyle = (theme: ThemeName): string =>
  theme === "dark" ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;

import {
  SOURCE_ID,
  LAYER_CLUSTERS_ID,
  LAYER_CLUSTER_COUNT_ID,
  LAYER_POINTS_ID,
  LAYER_HIGHLIGHT_ID,
  LAYER_CLUSTER_HIGHLIGHT_ID,
  USER_LOCATION_SOURCE_ID,
  USER_LOCATION_LAYER_ID,
  BOUNDARY_SOURCE_ID,
  BOUNDARY_FILL_LAYER_ID,
  BOUNDARY_LINE_LAYER_ID,
  BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
  BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
  BOUNDARY_PINNED_FILL_LAYER_ID,
  BOUNDARY_PINNED_LINE_LAYER_ID,
  BOUNDARY_HOVER_LINE_LAYER_ID,
  BOUNDARY_HOVER_FILL_LAYER_ID,
  BOUNDARY_STATDATA_FILL_LAYER_ID,
  ZIP_CENTROIDS_SOURCE_ID,
  SECONDARY_STAT_LAYER_ID,
  SECONDARY_STAT_HOVER_LAYER_ID,
  COUNTY_CENTROIDS_SOURCE_ID,
  COUNTY_SECONDARY_LAYER_ID,
  COUNTY_SECONDARY_HOVER_LAYER_ID,
  COUNTY_BOUNDARY_SOURCE_ID,
  COUNTY_BOUNDARY_FILL_LAYER_ID,
  COUNTY_BOUNDARY_LINE_LAYER_ID,
  COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
  COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
  COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
  COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
  COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID,
  COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID,
  COUNTY_STATDATA_FILL_LAYER_ID,
} from "./constants/map";

// colors and class index provided by lib/choropleth

type FC = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  { id: string; name: string; website?: string | null; status?: string | null }
>;

type BoundaryTypeKey = "ZIP" | "COUNTY";
type StatDataEntry = { type: string; data: Record<string, number>; min: number; max: number };
type StatDataEntryByBoundary = Partial<Record<BoundaryTypeKey, StatDataEntry>>;
type StatDataStoreMap = Map<string, StatDataByParentArea>;

const FALLBACK_ZIP_PARENT_AREA =
  normalizeScopeLabel(DEFAULT_PARENT_AREA_BY_KIND.ZIP ?? "Oklahoma") ?? "Oklahoma";

const RECENT_STATS_STORAGE_KEY = "uiState.recentStats";
const RECENT_STATS_MAX = 10;

const VIEWPORT_DOMINANCE_RATIO = 0.45;

const boundsArea = (bounds: BoundsArray): number => {
  const width = Math.max(0, bounds[1][0] - bounds[0][0]);
  const height = Math.max(0, bounds[1][1] - bounds[0][1]);
  return width * height;
};

const intersectionArea = (a: BoundsArray, b: BoundsArray): number => {
  const minLng = Math.max(a[0][0], b[0][0]);
  const minLat = Math.max(a[0][1], b[0][1]);
  const maxLng = Math.min(a[1][0], b[1][0]);
  const maxLat = Math.min(a[1][1], b[1][1]);
  if (minLng >= maxLng || minLat >= maxLat) return 0;
  return (maxLng - minLng) * (maxLat - minLat);
};

const emptyFC = (): FC => ({ type: "FeatureCollection", features: [] });

const COUNTY_MODE_ENABLE_ZOOM = 9;
const COUNTY_MODE_DISABLE_ZOOM = 9.6;
const COUNTY_SELECTION_MAX_ZOOM = 8.5;
const COUNTY_ZIP_VIEW_MAX_ZOOM = 10.2;
const COUNTY_CLICK_ZOOM_DELAY_MS = 220;
const COUNTY_LONG_PRESS_MS = 350;
// Minimum map movement (in meters) before we treat a gesture as a drag and collapse the mobile sheet.
const MOBILE_DRAG_COLLAPSE_DISTANCE_METERS = 8;
const ZCTA_STATE: ZctaStateCode = "ok";
const ZCTA_LOAD_MIN_ZOOM = 9;
const ZCTA_LOAD_PADDING_DEGREES = 0.75;

const zipAreaEntry = getAreaRegistryEntry("ZIP");
const countyAreaEntry = getAreaRegistryEntry("COUNTY");

const buildLayerOrder = (layers: AreaLayerIds): string[] => {
  const order: string[] = [];
  const push = (id?: string | null) => {
    if (id && id.length > 0) order.push(id);
  };
  push(layers.hoverFillLayerId);
  push(layers.hoverLineLayerId);
  push(layers.pinnedFillLayerId);
  push(layers.pinnedLineLayerId);
  push(layers.highlightFillLayerId);
  push(layers.highlightLineLayerId);
  push(layers.statDataFillLayerId);
  push(layers.baseFillLayerId);
  push(layers.baseLineLayerId);
  return order;
};

const zipLayerOrder = buildLayerOrder(zipAreaEntry.layers);
const countyLayerOrder = buildLayerOrder(countyAreaEntry.layers);
const zipFeatureProperty = zipAreaEntry.featureIdProperty;
const countyFeatureProperty = countyAreaEntry.featureIdProperty;
const getZipAreaBounds = zipAreaEntry.getBounds;
const getCountyAreaBounds = countyAreaEntry.getBounds;

export const createMapView = ({
  initialUserLocation = null,
  initialMapPosition = null,
  onHover,
  onVisibleIdsChange,
  onZipSelectionChange,
  onZipHoverChange,
  onCountySelectionChange,
  onCountyHoverChange,
  onAreaSelectionChange,
  onAreaHoverChange,
  onStatSelectionChange,
  onSecondaryStatChange,
  onCategorySelectionChange,
  onBoundaryModeChange,
  onZipScopeChange,
  shouldAutoBoundarySwitch,
  onMapDragStart,
  onOrganizationClick,
  onClusterClick,
  isMobile = false,
  onLocationSearch,
  onRequestHideOrgs,
  onTimeChipClick,
  onTimeChipClear,
  onLegendSettingsClick,
  legendRangeMode: legendRangeModeInitial = "dynamic",
}: MapViewOptions): MapViewController => {
  const container = document.createElement("section");
  container.className = "relative flex flex-1";

  const mapNode = document.createElement("div");
  mapNode.className = "absolute inset-0";
  container.appendChild(mapNode);

  let selectedCategory: string | null = null;
  const categoryChips = createCategoryChips({
    isMobile,
    onChange: (categoryId) => {
      selectedCategory = categoryId;
      applyData();
      if (typeof onCategorySelectionChange === 'function') {
        onCategorySelectionChange(selectedCategory);
      }
    },
    onStatChange: (statId) => {
      selectedStatId = statId;
      secondaryStatId = null;
      categoryChips.setSecondaryStat(null);
      syncStatDataStoreFocus();
      refreshStatVisuals();
      if (typeof onStatSelectionChange === 'function') {
        onStatSelectionChange(selectedStatId);
      }
    },
    onSecondaryStatChange: (statId) => {
      secondaryStatId = statId;
      syncStatDataStoreFocus();
      refreshStatVisuals();

      // Notify React layer
      if (typeof onSecondaryStatChange === 'function') {
        onSecondaryStatChange(secondaryStatId);
      }
    },
    onOrgsChipClose: () => { try { onRequestHideOrgs?.(); } catch {} },
    onTimeChipClick: () => { try { onTimeChipClick?.(); } catch {} },
    onTimeChipClear: () => { try { onTimeChipClear?.(); } catch {} },
    onSearch: (query) => {
      try { onLocationSearch?.(query); } catch {}
    },
  });
  container.appendChild(categoryChips.element);

  // Loading indicator: bottom-center pill on desktop, top-right spinner on mobile
  const loadingIndicator = createMapLoadingIndicator({ isMobile });
  container.appendChild(loadingIndicator.element);

  let zipFloatingTitle: ZipFloatingTitleController;
  let zipLabels: ZipLabelsController;
  let countyLabels: ZipLabelsController;
  let choroplethLegend: ChoroplethLegendController;
  let orgLegend: OrgLegendController;
  let secondaryChoroplethLegend: SecondaryChoroplethLegendController;
  let legendRowEl: HTMLDivElement | null = null;
  let legendRightSlotEl: HTMLDivElement | null = null;
  let legendInset = 16;
  const applyLegendInset = () => {
    if (legendRowEl) {
      // Position by bottom edge for desktop, but we'll use top for mobile when attached to sheet
      legendRowEl.style.bottom = `${Math.max(0, legendInset)}px`;
      legendRowEl.style.top = "";
    }
  };
  const setLegendTop = (topPx: number) => {
    if (legendRowEl) {
      legendRowEl.style.bottom = "";
      legendRowEl.style.top = `${Math.max(0, topPx)}px`;
    }
  };
  const setLegendInset = (value: number) => {
    legendInset = value;
    applyLegendInset();
  };
  const setLegendVisible = (visible: boolean) => {
    if (!legendRowEl) return;
    legendRowEl.style.display = visible ? "flex" : "none";
  };
  const setLegendRightContent = (el: HTMLElement | null) => {
    if (!legendRowEl || !legendRightSlotEl) return;
    legendRightSlotEl.replaceChildren();
    if (el) legendRightSlotEl.appendChild(el);
  };

  let currentTheme = themeController.getTheme();
  let boundaryMode: BoundaryMode = "zips";
  let legendRangeMode: "dynamic" | "scoped" | "global" = legendRangeModeInitial;
  let pinnedZips = new Set<string>();
  let transientZips = new Set<string>();
  let hoveredZipFromToolbar: string | null = null;
  let hoveredZipFromMap: string | null = null;
  let pinnedCounties = new Set<string>();
  let transientCounties = new Set<string>();
  let hoveredCountyFromToolbar: string | null = null;
  let hoveredCountyFromMap: string | null = null;
  let userLocation: { lng: number; lat: number } | null = initialUserLocation;
  let pendingUserLocationUpdate = Boolean(initialUserLocation);
  // Track pointer press state so quick taps zoom and sustained presses select.
  let countyPressCandidate: string | null = null;
  let countyLongPressTimer: ReturnType<typeof setTimeout> | null = null;
  let countyLongPressTriggered = false;
  let countyPendingZoomTimer: ReturnType<typeof setTimeout> | null = null;
  let selectedStatId: string | null = null;
  let secondaryStatId: string | null = null;
  let dragStartCenter: maplibregl.LngLat | null = null;
  let dragCollapseTriggered = false;
  let zipGeometryHiddenDueToZoom = false;
  let visibleZipIds = new Set<string>();
  let pendingVisibleZipRefresh = false;

let statDataStoreMap: StatDataStoreMap = new Map();
let scopedStatDataByBoundary = new Map<string, StatDataEntryByBoundary>();
  let unsubscribeStatData: (() => void) | null = null;
  let activeZipParentArea: string | null = FALLBACK_ZIP_PARENT_AREA;
  const destroyFns: Array<() => void> = [];

  const resolveScopedStatEntry = (statId: string | null): StatDataEntryByBoundary | undefined => {
    if (!statId) return undefined;
    return scopedStatDataByBoundary.get(statId);
  };

  const getStatEntryByBoundary = (statId: string | null, boundary: BoundaryTypeKey): StatDataEntry | undefined => {
    const entry = resolveScopedStatEntry(statId);
    return entry?.[boundary];
  };

  // Coalesce multiple refreshStatVisuals calls into one frame
  let statVisualsScheduled = false;
  const refreshStatVisualsCore = () => {
    updateStatDataChoropleth();
    updateChoroplethLegend();
    updateSecondaryStatOverlay();
    updateSecondaryChoroplethLegend();

    const zipEntry = getStatEntryByBoundary(selectedStatId, "ZIP");
    zipLabels?.setStatOverlay(selectedStatId, zipEntry?.data || null, zipEntry?.type || "count");
    const secondaryEntry = getStatEntryByBoundary(secondaryStatId, "ZIP");
    zipLabels?.setSecondaryStatOverlay?.(secondaryStatId, secondaryEntry?.data || null, secondaryEntry?.type || "count");
    const countyEntry = getStatEntryByBoundary(selectedStatId, "COUNTY");
    countyLabels?.setStatOverlay(selectedStatId, countyEntry?.data || null, countyEntry?.type || "count");
    const countySecondary = getStatEntryByBoundary(secondaryStatId, "COUNTY");
    countyLabels?.setSecondaryStatOverlay?.(secondaryStatId, countySecondary?.data || null, countySecondary?.type || "count");
  };
  
  const refreshStatVisuals = () => {
    // If already scheduled, skip - the pending call will pick up latest state
    if (statVisualsScheduled) return;
    statVisualsScheduled = true;
    requestAnimationFrame(() => {
      statVisualsScheduled = false;
      refreshStatVisualsCore();
    });
  };

  // Schedule work during idle time (or fallback to setTimeout)
  // Defined early so it's available throughout the module
  const scheduleIdle = (fn: () => void, timeout = 100): number | ReturnType<typeof setTimeout> => {
    if (typeof requestIdleCallback === "function") {
      return requestIdleCallback(() => fn(), { timeout });
    }
    return setTimeout(fn, 16); // ~1 frame fallback
  };
  const cancelIdle = (handle: number | ReturnType<typeof setTimeout> | null) => {
    if (handle === null) return;
    if (typeof cancelIdleCallback === "function") {
      cancelIdleCallback(handle as number);
    } else {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    }
  };

  let latestNeighborCountyIds: string[] = [];
  let activeZipParentCountyId: string | null = null;

  const normalizeCountyIdToName = (countyId: string | null | undefined): string | null => {
    if (!countyId) return null;
    const rawName = getCountyNameForId(ZCTA_STATE, countyId);
    return formatCountyScopeLabel(rawName);
  };

  const getScopeAreaNames = (): string[] => {
    const set = new Set<string>();
    const primary = normalizeScopeLabel(activeZipParentArea);
    if (primary) set.add(primary);
    for (const neighborId of latestNeighborCountyIds) {
      const name = normalizeCountyIdToName(neighborId);
      if (name) set.add(name);
    }
    const countyFallback = normalizeScopeLabel(DEFAULT_PARENT_AREA_BY_KIND.COUNTY ?? "Oklahoma");
    if (countyFallback) set.add(countyFallback);
    if (set.size === 0) set.add(FALLBACK_ZIP_PARENT_AREA);
    return Array.from(set);
  };

  const syncStatDataStoreFocus = () => {
    const statIds = [selectedStatId, secondaryStatId].filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0,
    );
    setStatDataPriorityStatIds(statIds);
    setStatDataScopeParentAreas(getScopeAreaNames());

    // Phase 3: idle prefetch for recently viewed stats so switching back feels instant.
    try {
      if (typeof window === "undefined") return;
      if (statIds.length === 0) {
        setStatDataPrefetchStatIds([]);
        return;
      }
      if (isLowMemoryDevice()) {
        setStatDataPrefetchStatIds([]);
        return;
      }
      const reducedDataLoading = readBoolSetting(REDUCED_DATA_LOADING_KEY, false);
      if (reducedDataLoading) {
        setStatDataPrefetchStatIds([]);
        return;
      }
      const prefetchEnabled = readBoolSetting(PREFETCH_RECENT_STATS_KEY, false);
      if (!prefetchEnabled) {
        setStatDataPrefetchStatIds([]);
        return;
      }

      const readRecent = (): string[] => {
        try {
          const raw = localStorage.getItem(RECENT_STATS_STORAGE_KEY);
          const parsed = raw ? (JSON.parse(raw) as unknown) : null;
          return Array.isArray(parsed)
            ? parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
            : [];
        } catch {
          return [];
        }
      };

      const writeRecent = (ids: string[]) => {
        try {
          localStorage.setItem(RECENT_STATS_STORAGE_KEY, JSON.stringify(ids));
        } catch {}
      };

      const existing = readRecent();
      const next = [...statIds, ...existing.filter((id) => !statIds.includes(id))].slice(0, RECENT_STATS_MAX);
      writeRecent(next);

      const candidates = next.filter((id) => !statIds.includes(id)).slice(0, 6);
      const scheduleIdle = (fn: () => void) => {
        const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, opts?: any) => number);
        if (ric) ric(fn, { timeout: 1500 });
        else setTimeout(fn, 1200);
      };

      scheduleIdle(() => setStatDataPrefetchStatIds(candidates));
    } catch {}
  };

  const mergeStatEntries = (existing: StatDataEntry | undefined, incoming: StatDataEntry): StatDataEntry => {
    const data = { ...(existing?.data ?? {}), ...incoming.data };
    const values = Object.values(data).filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    return {
      type: existing?.type ?? incoming.type,
      data,
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
    };
  };

  const recomputeScopedStatData = () => {
    const scopeNames = getScopeAreaNames();
    const primaryScope = normalizeScopeLabel(activeZipParentArea) ?? FALLBACK_ZIP_PARENT_AREA;
    const legendScopes = (() => {
      const set = new Set<string>();
      if (primaryScope) set.add(primaryScope);
      for (const neighborId of latestNeighborCountyIds) {
        const name = normalizeCountyIdToName(neighborId);
        if (name) set.add(name);
      }
      return Array.from(set);
    })();

    const aggregated = new Map<string, StatDataEntryByBoundary>();
    for (const [statId, byParent] of statDataStoreMap.entries()) {
      let scopedEntry: StatDataEntryByBoundary | null = null;
      const dataScopeNames =
        legendRangeMode === "global" ? Array.from(byParent.keys()) : scopeNames;

      for (const scopeName of dataScopeNames) {
        const parentEntry = byParent.get(scopeName);
        if (!parentEntry) continue;
        scopedEntry = scopedEntry ?? {};
        for (const boundary of ["ZIP", "COUNTY"] as const) {
          const incoming = parentEntry[boundary];
          if (!incoming) continue;
          scopedEntry[boundary] = mergeStatEntries(scopedEntry[boundary], incoming);
        }
      }

      if (scopedEntry?.ZIP) {
        let legendMin = Number.POSITIVE_INFINITY;
        let legendMax = Number.NEGATIVE_INFINITY;
        if (legendRangeMode === "global") {
          for (const parentEntry of byParent.values()) {
            const entry = parentEntry?.ZIP;
            if (!entry) continue;
            for (const value of Object.values(entry.data ?? {})) {
              if (typeof value === "number" && Number.isFinite(value)) {
                if (value < legendMin) legendMin = value;
                if (value > legendMax) legendMax = value;
              }
            }
          }
        } else if (legendScopes.length > 0) {
          const hasVisible = legendRangeMode === "dynamic" && visibleZipIds.size > 0;
          for (const scope of legendScopes) {
            const entry = byParent.get(scope)?.ZIP;
            if (!entry) continue;
            for (const [zip, value] of Object.entries(entry.data ?? {})) {
              if (hasVisible && !visibleZipIds.has(zip)) continue;
              if (typeof value === "number" && Number.isFinite(value)) {
                if (value < legendMin) legendMin = value;
                if (value > legendMax) legendMax = value;
              }
            }
          }
        }
        if (Number.isFinite(legendMin) && Number.isFinite(legendMax)) {
          scopedEntry = {
            ...scopedEntry,
            ZIP: { ...scopedEntry.ZIP, min: legendMin, max: legendMax },
          };
        }
      }

      if (scopedEntry && Object.keys(scopedEntry).length > 0) {
        aggregated.set(statId, scopedEntry);
      }
    }
    scopedStatDataByBoundary = aggregated;
  };

  const updateVisibleZipSet = () => {
    // Only track visible ZIPs when the ZIP layer is active and rendered
    if (boundaryMode !== "zips" || zipGeometryHiddenDueToZoom) {
      if (visibleZipIds.size > 0) {
        visibleZipIds = new Set<string>();
        recomputeScopedStatData();
        refreshStatVisuals();
      }
      return;
    }
    if (legendRangeMode !== "dynamic") return;
    const queryLayers = [BOUNDARY_STATDATA_FILL_LAYER_ID, BOUNDARY_FILL_LAYER_ID].filter((id) => map.getLayer(id));
    if (queryLayers.length === 0) return;
    const canvas = map.getCanvas();
    const features = map.queryRenderedFeatures([[0, 0], [canvas.width, canvas.height]] as any, {
      layers: queryLayers as any,
    });
    const next = new Set<string>();
    for (const f of features) {
      const zip = (f.properties as any)?.zip;
      if (typeof zip === "string" && zip.length > 0) {
        next.add(zip);
      }
    }
    const changed =
      next.size !== visibleZipIds.size ||
      Array.from(next).some((zip) => !visibleZipIds.has(zip)) ||
      Array.from(visibleZipIds).some((zip) => !next.has(zip));
    if (!changed) return;
    visibleZipIds = next;
    recomputeScopedStatData();
    refreshStatVisuals();
  };

  const setLegendRangeModeInternal = (mode: "dynamic" | "scoped" | "global") => {
    if (legendRangeMode === mode) return;
    legendRangeMode = mode;
    if (legendRangeMode === "dynamic") {
      updateVisibleZipSet();
    } else {
      recomputeScopedStatData();
      refreshStatVisuals();
    }
  };

  const emitScopeChange = () => {
    const scopeLabel = normalizeScopeLabel(activeZipParentArea) ?? FALLBACK_ZIP_PARENT_AREA;
    const neighborLabels = latestNeighborCountyIds
      .map((id) => normalizeCountyIdToName(id))
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    onZipScopeChange?.(scopeLabel, neighborLabels);
  };

  const applyZipParentArea = ({ name, countyId }: { name: string | null; countyId: string | null }) => {
    const normalizedNext = countyId
      ? formatCountyScopeLabel(name) ?? FALLBACK_ZIP_PARENT_AREA
      : normalizeScopeLabel(name) ?? FALLBACK_ZIP_PARENT_AREA;
    const normalizedCurrent = normalizeScopeLabel(activeZipParentArea) ?? FALLBACK_ZIP_PARENT_AREA;
    const countyChanged = countyId && countyId !== activeZipParentCountyId;
    activeZipParentCountyId = countyId;
    if (normalizedCurrent === normalizedNext && !countyChanged) {
      setStatDataScopeParentAreas(getScopeAreaNames());
      recomputeScopedStatData();
      emitScopeChange();
      refreshStatVisuals();
      return;
    }
    activeZipParentArea = normalizedNext;
    setStatDataScopeParentAreas(getScopeAreaNames());
    recomputeScopedStatData();
    refreshStatVisuals();
    emitScopeChange();
  };

  // Oklahoma bounding box with padding to keep map constrained to the state
  const OKLAHOMA_MAX_BOUNDS: [[number, number], [number, number]] = [
    [-104.5, 32.8], // SW: west of panhandle, south of Red River
    [-93.5, 37.8],  // NE: east of state line, north of Kansas border
  ];

  const map = new maplibregl.Map({
    container: mapNode,
    style: getMapStyle(currentTheme),
    center: initialMapPosition
      ? [initialMapPosition.lng, initialMapPosition.lat]
      : [OKLAHOMA_CENTER.longitude, OKLAHOMA_CENTER.latitude],
    zoom: initialMapPosition?.zoom ?? OKLAHOMA_DEFAULT_ZOOM,
    attributionControl: false,
    fadeDuration: 0,
    boxZoom: false,
    maxBounds: OKLAHOMA_MAX_BOUNDS,
  });

  map.dragRotate.disable();
  map.touchZoomRotate.enable();
  map.touchZoomRotate.disableRotation();

  // Proactively ensure correct sizing right after mount
  requestAnimationFrame(() => {
    try { map.resize(); } catch {}
  });
  setTimeout(() => {
    try { map.resize(); } catch {}
  }, 100);

  const stopCountyPressTimer = () => {
    if (countyLongPressTimer !== null) {
      clearTimeout(countyLongPressTimer);
      countyLongPressTimer = null;
    }
  };

  const cancelCountyPendingZoom = () => {
    if (countyPendingZoomTimer !== null) {
      clearTimeout(countyPendingZoomTimer);
      countyPendingZoomTimer = null;
    }
  };

  const resetCountyPressState = ({ cancelZoom = true }: { cancelZoom?: boolean } = {}) => {
    stopCountyPressTimer();
    if (cancelZoom) cancelCountyPendingZoom();
    countyPressCandidate = null;
    countyLongPressTriggered = false;
  };

  const beginCountyPressTracking = (countyId: string) => {
    stopCountyPressTimer();
    cancelCountyPendingZoom();
    countyPressCandidate = countyId;
    countyLongPressTriggered = false;
    countyLongPressTimer = setTimeout(() => {
      countyLongPressTriggered = true;
    }, COUNTY_LONG_PRESS_MS);
  };

  const wasCountyPressLong = (countyId: string | null): boolean =>
    Boolean(countyId && countyPressCandidate === countyId && countyLongPressTriggered);

  let allOrganizations: Organization[] = [];
  let lastData: FC = emptyFC();
  let orgPinsVisible: boolean = false;
  let zctaUpdateToken = 0;
  // Track boundary-source readiness so ZIP ensures wait until layers exist.
  let boundarySourceReady = false;
  let pendingZctaEnsure = false;
  let pendingZctaEnsureForce = false;
  
  // Track map motion state to suppress React hover callbacks during drag/zoom
  let mapInMotion = false;
  let pendingHoverArea: AreaId | null = null;
  let pendingZipHover: string | null = null;
  let pendingCountyHover: string | null = null;

  const toBoundsArray = (bounds: maplibregl.LngLatBounds): BoundsArray => [
    [bounds.getWest(), bounds.getSouth()],
    [bounds.getEast(), bounds.getNorth()],
  ];

  const syncZctaSource = () => {
    const source = map.getSource(BOUNDARY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const collection = getZctaFeatureCollection(ZCTA_STATE);
    source.setData(collection as any);
  };

  const ensureZctasForCurrentView = async ({ force = false }: { force?: boolean } = {}) => {
    if (!boundarySourceReady) {
      // Stash the request and retry once the boundary source is attached.
      pendingZctaEnsure = true;
      if (force) pendingZctaEnsureForce = true;
      return;
    }
    const zoom = map.getZoom();
    const boundsArray = toBoundsArray(map.getBounds());
    const requestId = ++zctaUpdateToken;
    let relevantChunks: ZctaChunkSummary[] = [];
    try {
      if (force || zoom >= ZCTA_LOAD_MIN_ZOOM) {
        relevantChunks = await ensureZctasForViewport({
          state: ZCTA_STATE,
          bounds: boundsArray,
          paddingDegrees: ZCTA_LOAD_PADDING_DEGREES,
        });
      }
    } catch (error) {
      console.warn("Failed to ensure ZCTA data", error);
      return;
    }
    if (requestId !== zctaUpdateToken) return;
    const keepChunkIds = new Set<string>();
    if (force || zoom >= ZCTA_LOAD_MIN_ZOOM) {
      for (const chunk of relevantChunks) keepChunkIds.add(chunk.id);
    }
    const addChunkForZip = (zip: string | null | undefined) => {
      if (!zip) return;
      const chunkId = getZctaChunkIdForZip(ZCTA_STATE, zip);
      if (chunkId) keepChunkIds.add(chunkId);
    };
    for (const zip of pinnedZips) addChunkForZip(zip);
    for (const zip of transientZips) addChunkForZip(zip);
    addChunkForZip(hoveredZipFromToolbar);
    addChunkForZip(hoveredZipFromMap);
    const selectionCounts = new Map<string, { count: number; name: string | null }>();
    const accumulateSelection = (zip: string) => {
      const countyId = getZipCountyId(zip);
      if (!countyId) return;
      const countyName = getZipCountyName(zip);
      const entry = selectionCounts.get(countyId) ?? { count: 0, name: countyName ?? null };
      entry.count += 1;
      if (!entry.name && countyName) entry.name = countyName;
      selectionCounts.set(countyId, entry);
    };
    for (const zip of pinnedZips) accumulateSelection(zip);
    for (const zip of transientZips) accumulateSelection(zip);
    const totalSelections = Array.from(selectionCounts.values()).reduce((acc, entry) => acc + entry.count, 0);
    let selectionCounty: { id: string; name: string | null } | null = null;
    if (totalSelections > 0) {
      let topCounty: { id: string; count: number; name: string | null } | null = null;
      let topCount = 0;
      for (const [countyId, entry] of selectionCounts.entries()) {
        if (entry.count > topCount) {
          topCounty = { id: countyId, count: entry.count, name: entry.name ?? null };
          topCount = entry.count;
        }
      }
      if (topCounty && topCount / totalSelections >= 0.5) {
        selectionCounty = { id: topCounty.id, name: topCounty.name ?? getCountyNameForId(ZCTA_STATE, topCounty.id) };
      }
    }

    let viewportCounty: { id: string; name: string | null } | null = null;
    if ((force || zoom >= ZCTA_LOAD_MIN_ZOOM) && boundaryMode === "zips") {
      const viewportArea = boundsArea(boundsArray);
      if (viewportArea > 0) {
        let leadingCounty: { name: string; ratio: number; id: string } | null = null;
        for (const chunk of relevantChunks) {
          if (chunk.countyId === "999") continue;
          const intersection = intersectionArea(chunk.bbox, boundsArray);
          if (intersection <= 0) continue;
          const ratio = intersection / viewportArea;
          if (!leadingCounty || ratio > leadingCounty.ratio) {
            leadingCounty = { name: chunk.name, ratio, id: chunk.countyId };
          }
        }
        if (leadingCounty && leadingCounty.ratio >= VIEWPORT_DOMINANCE_RATIO) {
          viewportCounty = {
            id: leadingCounty.id,
            name: leadingCounty.name,
          };
        }
      }
    }

    const primaryCounty =
      selectionCounty ??
      viewportCounty ??
      (activeZipParentCountyId
        ? { id: activeZipParentCountyId, name: activeZipParentArea ?? getCountyNameForId(ZCTA_STATE, activeZipParentCountyId) }
        : null);

    let allNeighborChunkIds: string[] = [];
    let neighborCountyIds: string[] = [];
    if (primaryCounty && primaryCounty.id) {
      const primaryChunkIds = getChunkIdsForCounty(ZCTA_STATE, primaryCounty.id);
      for (const id of primaryChunkIds) keepChunkIds.add(id);
      const neighborIds = getNeighborCountyIds(ZCTA_STATE, primaryCounty.id);
      neighborCountyIds = neighborIds;
      const neighborChunkIdSet = new Set<string>(primaryChunkIds);
      for (const neighborId of neighborIds) {
        const chunks = getChunkIdsForCounty(ZCTA_STATE, neighborId);
        for (const chunkId of chunks) {
          keepChunkIds.add(chunkId);
          neighborChunkIdSet.add(chunkId);
        }
      }
      allNeighborChunkIds = Array.from(neighborChunkIdSet);
      try {
        await ensureZctaChunks(ZCTA_STATE, allNeighborChunkIds);
      } catch (error) {
        console.warn("Failed to ensure neighbor ZCTA chunks", error);
      }
    } else {
      neighborCountyIds = [];
    }

    latestNeighborCountyIds = neighborCountyIds;
    pruneZctaChunks(ZCTA_STATE, keepChunkIds);

    if (primaryCounty) {
      applyZipParentArea({
        name: primaryCounty.name ?? getCountyNameForId(ZCTA_STATE, primaryCounty.id) ?? FALLBACK_ZIP_PARENT_AREA,
        countyId: primaryCounty.id,
      });
    } else {
      applyZipParentArea({
        name: activeZipParentArea ?? FALLBACK_ZIP_PARENT_AREA,
        countyId: activeZipParentCountyId,
      });
    }
    syncZctaSource();
    if (legendRangeMode === "dynamic" && !pendingVisibleZipRefresh) {
      pendingVisibleZipRefresh = true;
      map.once("idle", () => {
        pendingVisibleZipRefresh = false;
        updateVisibleZipSet();
      });
    }
  };
  
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  // Create a single bottom-row for legends so they share space evenly with right-side controls
  legendRowEl = document.createElement("div");
  legendRowEl.className = "pointer-events-none absolute left-4 right-4 z-10 flex items-center gap-3 justify-between";
  legendRowEl.style.bottom = `${legendInset}px`;
  container.appendChild(legendRowEl);

  choroplethLegend = createChoroplethLegend(isMobile, () => {
    try { onLegendSettingsClick?.(); } catch {}
  });
  legendRowEl.appendChild(choroplethLegend.element);
  // Only render the org legend on non-mobile to reduce visual noise
  if (!isMobile) {
    orgLegend = createOrgLegend();
    choroplethLegend.pill.insertBefore(orgLegend.element, choroplethLegend.pill.firstChild);
  }
  secondaryChoroplethLegend = createSecondaryChoroplethLegend(isMobile);
  legendRowEl.appendChild(secondaryChoroplethLegend.element);

  // Right-side slot for consumer-provided controls (e.g., My Location)
  legendRightSlotEl = document.createElement("div");
  legendRightSlotEl.className = "pointer-events-auto ml-auto flex min-w-0 pl-3"; // Keep controls pinned right even if legends hide
  legendRowEl.appendChild(legendRightSlotEl);

  // Wire up momentary stat name display on legend tap/click
  // Maintain a lookup of stat id -> name from the stats store
  const statNameById = new Map<string, string>();
  const unsubscribeStats = statsStore.subscribe((stats) => {
    statNameById.clear();
    for (const s of stats) statNameById.set(s.id, s.name);
  });
  destroyFns.push(() => {
    try { unsubscribeStats?.(); } catch {}
  });

  // Helper to attach a small overlay label inside a pill
  const attachLegendMessage = (pillEl: HTMLElement, onClear?: () => void) => {
    pillEl.style.position = pillEl.style.position || "relative";
    const msg = document.createElement("div");
    msg.className = [
      "pointer-events-none absolute inset-0 flex items-center",
      isMobile && onClear ? "pl-1 pr-1" : "px-2",
      "text-[10px] leading-tight text-brand-700 dark:text-brand-300",
      isMobile && onClear ? "justify-end gap-1" : "justify-center text-center",
    ].join(" ");
    msg.style.display = "none";
    
    const textEl = document.createElement("span");
    if (isMobile && onClear) {
      textEl.className = "pointer-events-none text-right flex-1 min-w-0";
      textEl.style.display = "-webkit-box";
      textEl.style.webkitLineClamp = "2";
      textEl.style.webkitBoxOrient = "vertical";
      textEl.style.overflow = "hidden";
      textEl.style.textOverflow = "ellipsis";
    } else {
      textEl.className = "pointer-events-none";
    }
    msg.appendChild(textEl);
    
    let hideTimer: number | null = null;
    let closeBtn: HTMLButtonElement | null = null;
    if (isMobile && onClear) {
      closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = [
        "pointer-events-auto flex-shrink-0 rounded p-2",
        "text-brand-700 hover:bg-brand-100 dark:text-brand-300 dark:hover:bg-brand-900/50",
        "transition-colors touch-manipulation",
      ].join(" ");
      closeBtn.setAttribute("aria-label", "Clear stat");
      closeBtn.innerHTML = `
        <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      `;
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (hideTimer) { 
          window.clearTimeout(hideTimer); 
          hideTimer = null; 
        }
        onClear();
        hideMessage();
      });
      msg.appendChild(closeBtn);
    }
    
    pillEl.appendChild(msg);
    
    // Store original min-width to restore later
    const originalMinWidth = pillEl.style.minWidth || "";
    
    const setSiblingsVisibility = (visible: boolean) => {
      const children = Array.from(pillEl.children) as HTMLElement[];
      for (const child of children) {
        if (child === msg) continue;
        child.style.visibility = visible ? "visible" : "hidden";
      }
    };
    const hideMessage = () => {
      msg.style.display = "none";
      setSiblingsVisibility(true);
      // Restore original min-width
      if (isMobile && onClear) {
        pillEl.style.transition = "min-width 0.2s ease-out";
      }
      if (originalMinWidth) {
        pillEl.style.minWidth = originalMinWidth;
      } else {
        pillEl.style.minWidth = "";
      }
    };
    const showMessage = (text: string, autoHide: boolean = true) => {
      textEl.textContent = text;
      msg.style.display = "flex";
      setSiblingsVisibility(false);
      
      // Expand pill to fit title on two lines
      if (isMobile && onClear) {
        // Calculate a reasonable min-width based on text length
        // At 10px font size, ~10-12 chars per line on 2 lines = ~20-24 chars total
        // Each char is roughly 6-7px wide, so ~140-170px for text + padding + close button
        // Use a more generous width to ensure titles fit comfortably
        const estimatedWidth = Math.max(140, Math.min(text.length * 6 + 50, 180));
        pillEl.style.minWidth = `${estimatedWidth}px`;
        pillEl.style.transition = "min-width 0.2s ease-out";
      }
      
      if (hideTimer) { window.clearTimeout(hideTimer); hideTimer = null; }
      if (autoHide) {
        hideTimer = window.setTimeout(() => { hideMessage(); }, 1500);
      }
    };
    return { showMessage, hideMessage };
  };

  // Create clear callbacks for mobile legend close buttons
  const clearPrimaryStat = () => {
    selectedStatId = null;
    categoryChips.setSelectedStat(null);
    secondaryStatId = null;
    categoryChips.setSecondaryStat(null);
    syncStatDataStoreFocus();
    refreshStatVisuals();
    if (typeof onStatSelectionChange === 'function') {
      onStatSelectionChange(null);
    }
  };
  
  const clearSecondaryStat = () => {
    secondaryStatId = null;
    categoryChips.setSecondaryStat(null);
    syncStatDataStoreFocus();
    refreshStatVisuals();
    if (typeof onSecondaryStatChange === 'function') {
      onSecondaryStatChange(null);
    }
  };

  const primaryMsg = attachLegendMessage(choroplethLegend.pill, isMobile ? clearPrimaryStat : undefined);
  const secondaryMsg = attachLegendMessage(secondaryChoroplethLegend.pill, isMobile ? clearSecondaryStat : undefined);

  if (isMobile) {
    choroplethLegend.pill.addEventListener("click", () => {
      if (!selectedStatId) return;
      const name = statNameById.get(selectedStatId) || "Stat";
      primaryMsg.showMessage(name, true);
    });
    secondaryChoroplethLegend.pill.addEventListener("click", () => {
      if (!secondaryStatId) return;
      const name = statNameById.get(secondaryStatId) || "Stat";
      secondaryMsg.showMessage(name, true);
    });
  } else {
    choroplethLegend.pill.addEventListener("mouseenter", () => {
      if (!selectedStatId) return;
      const name = statNameById.get(selectedStatId) || "Stat";
      primaryMsg.showMessage(name, false);
    });
    choroplethLegend.pill.addEventListener("mouseleave", () => {
      primaryMsg.hideMessage();
    });
    secondaryChoroplethLegend.pill.addEventListener("mouseenter", () => {
      if (!secondaryStatId) return;
      const name = statNameById.get(secondaryStatId) || "Stat";
      secondaryMsg.showMessage(name, false);
    });
    secondaryChoroplethLegend.pill.addEventListener("mouseleave", () => {
      secondaryMsg.hideMessage();
    });
  }

  type SelectionApplyOptions = { shouldZoom?: boolean; notify?: boolean };

  interface SelectionHandlers {
    getUnion: () => string[];
    apply: (options?: SelectionApplyOptions) => void;
    refresh: () => void;
    updateHover: () => void;
    setPinnedIds: (ids: string[], options?: SelectionApplyOptions) => void;
    toggle: (id: string, additive: boolean, shouldZoom?: boolean) => void;
    clearTransient: (options: SelectionApplyOptions) => void;
    addTransient: (ids: string[], options?: SelectionApplyOptions) => void;
  }

  const createSelectionHandlers = (config: {
    getPinned: () => Set<string>;
    setPinned: (next: Set<string>) => void;
    getTransient: () => Set<string>;
    setTransient: (next: Set<string>) => void;
    updateHighlight: () => void;
    updateHover: () => void;
    onAfterApply?: (union: string[]) => void;
    onNotify?: (payload: { union: string[]; pinned: string[]; transient: string[] }) => void;
    getBounds: (id: string) => BoundsArray | null;
    maxZoom: number;
  }): SelectionHandlers => {
    const getUnion = (): string[] => {
      const all = new Set<string>([...config.getPinned(), ...config.getTransient()]);
      return Array.from(all);
    };

    const zoomToSelection = (union: string[]) => {
      if (union.length === 0) return;
      let combined: BoundsArray | null = null;
      for (const id of union) {
        const bounds = config.getBounds(id);
        if (!bounds) continue;
        if (!combined) {
          combined = bounds;
        } else {
          combined = [
            [
              Math.min(combined[0][0], bounds[0][0]),
              Math.min(combined[0][1], bounds[0][1]),
            ],
            [
              Math.max(combined[1][0], bounds[1][0]),
              Math.max(combined[1][1], bounds[1][1]),
            ],
          ];
        }
      }
      if (!combined) return;
      map.fitBounds(combined, { padding: 48, duration: 400, maxZoom: config.maxZoom });
    };

    const apply = (options: SelectionApplyOptions = {}) => {
      const { shouldZoom = false, notify = false } = options;
      config.updateHighlight();
      config.updateHover();
      const union = getUnion();
      config.onAfterApply?.(union);
      if (shouldZoom && union.length > 0) {
        zoomToSelection(union);
      }
      if (notify) {
        const pinnedArray = Array.from(config.getPinned());
        const transientArray = Array.from(config.getTransient());
        config.onNotify?.({ union, pinned: pinnedArray, transient: transientArray });
      }
    };

    const refresh = () => apply();

    const updateHover = () => {
      config.updateHover();
    };

    const setPinnedIds = (ids: string[], options?: SelectionApplyOptions) => {
      const next = new Set(ids);
      const current = config.getPinned();
      let changed = next.size !== current.size;
      if (!changed) {
        for (const id of next) {
          if (!current.has(id)) {
            changed = true;
            break;
          }
        }
      }
      if (!changed) {
        for (const id of current) {
          if (!next.has(id)) {
            changed = true;
            break;
          }
        }
      }
      if (!changed) return;
      config.setPinned(next);
      apply(options);
    };

    const clearTransient = (options: SelectionApplyOptions) => {
      const { notify = false } = options;
      const current = config.getTransient();
      if (current.size === 0) {
        if (notify) {
          const union = getUnion();
          const pinnedArray = Array.from(config.getPinned());
          config.onNotify?.({ union, pinned: pinnedArray, transient: Array.from(current) });
        }
        return;
      }
      config.setTransient(computeClearTransient());
      apply({ shouldZoom: false, notify });
    };

    const addTransient = (ids: string[], options: SelectionApplyOptions = { notify: true }) => {
      if (!Array.isArray(ids) || ids.length === 0) return;
      const next = computeAddTransient(ids, config.getTransient());
      config.setTransient(next);
      apply({ shouldZoom: false, notify: options.notify ?? true });
    };

    const toggle = (id: string, additive: boolean, shouldZoom?: boolean) => {
      const pinned = config.getPinned();
      const transient = config.getTransient();
      const wasSelected = pinned.has(id) || transient.has(id);
      const next = computeToggle(id, additive, pinned, transient);
      config.setPinned(next.pinned);
      config.setTransient(next.transient);
      apply({ shouldZoom: Boolean(shouldZoom && !wasSelected), notify: true });
    };

    return {
      getUnion,
      apply,
      refresh,
      updateHover,
      setPinnedIds,
      toggle,
      clearTransient,
      addTransient,
    };
  };

  let activeId: string | null = null;
  let hoverClusterId: number | null = null;
  let selectedOrgIds: Set<string> = new Set();
  let selectedClusterId: number | null = null;
  let selectedClusterIds: number[] = []; // Support multiple clusters when orgs split
  let lastVisibleIdsKey: string | null = null;

  // getBoundaryPalette and getHoverColors moved to styles/boundaryPalettes

  const updateBoundaryPaint = () => extUpdateBoundaryPaint(map, {
    BOUNDARY_SOURCE_ID,
    BOUNDARY_FILL_LAYER_ID,
    BOUNDARY_LINE_LAYER_ID,
    BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
    BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
    BOUNDARY_PINNED_FILL_LAYER_ID,
    BOUNDARY_PINNED_LINE_LAYER_ID,
    BOUNDARY_HOVER_LINE_LAYER_ID,
    BOUNDARY_HOVER_FILL_LAYER_ID,
    BOUNDARY_STATDATA_FILL_LAYER_ID,
    ZIP_CENTROIDS_SOURCE_ID,
    SECONDARY_STAT_LAYER_ID,
    SECONDARY_STAT_HOVER_LAYER_ID,
    COUNTY_CENTROIDS_SOURCE_ID,
    COUNTY_SECONDARY_LAYER_ID,
    COUNTY_SECONDARY_HOVER_LAYER_ID,
    COUNTY_BOUNDARY_SOURCE_ID,
    COUNTY_BOUNDARY_FILL_LAYER_ID,
    COUNTY_BOUNDARY_LINE_LAYER_ID,
    COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
    COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
    COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
    COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
    COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID,
    COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID,
    COUNTY_STATDATA_FILL_LAYER_ID,
  }, currentTheme);

  const shouldHideZipGeometry = () => boundaryMode === "zips" && map.getZoom() >= CHOROPLETH_HIDE_ZOOM;

  const updateBoundaryVisibility = (options?: { force?: boolean }): boolean => {
    const hideZipGeometry = shouldHideZipGeometry();
    if (!options?.force && hideZipGeometry === zipGeometryHiddenDueToZoom) {
      return false;
    }
    zipGeometryHiddenDueToZoom = hideZipGeometry;
    extUpdateBoundaryVisibility(map, {
      BOUNDARY_SOURCE_ID,
      BOUNDARY_FILL_LAYER_ID,
      BOUNDARY_LINE_LAYER_ID,
      BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
      BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
      BOUNDARY_PINNED_FILL_LAYER_ID,
      BOUNDARY_PINNED_LINE_LAYER_ID,
      BOUNDARY_HOVER_LINE_LAYER_ID,
      BOUNDARY_HOVER_FILL_LAYER_ID,
      BOUNDARY_STATDATA_FILL_LAYER_ID,
      ZIP_CENTROIDS_SOURCE_ID,
      SECONDARY_STAT_LAYER_ID,
      SECONDARY_STAT_HOVER_LAYER_ID,
      COUNTY_CENTROIDS_SOURCE_ID,
      COUNTY_SECONDARY_LAYER_ID,
      COUNTY_SECONDARY_HOVER_LAYER_ID,
      COUNTY_BOUNDARY_SOURCE_ID,
      COUNTY_BOUNDARY_FILL_LAYER_ID,
      COUNTY_BOUNDARY_LINE_LAYER_ID,
      COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
      COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
      COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
      COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
      COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID,
      COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID,
      COUNTY_STATDATA_FILL_LAYER_ID,
    }, boundaryMode, { hideZipGeometry });
    return true;
  };

  const applyLabelVisibility = () => {
    try { zipLabels?.setVisible?.(boundaryMode === "zips" && !zipGeometryHiddenDueToZoom); } catch {}
    try { countyLabels?.setVisible?.(boundaryMode === "counties"); } catch {}
  };

  const updateZipSelectionHighlight = () => extUpdateZipSelectionHighlight(map, {
    BOUNDARY_SOURCE_ID,
    BOUNDARY_FILL_LAYER_ID,
    BOUNDARY_LINE_LAYER_ID,
    BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
    BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
    BOUNDARY_PINNED_FILL_LAYER_ID,
    BOUNDARY_PINNED_LINE_LAYER_ID,
    BOUNDARY_HOVER_LINE_LAYER_ID,
    BOUNDARY_HOVER_FILL_LAYER_ID,
    BOUNDARY_STATDATA_FILL_LAYER_ID,
    ZIP_CENTROIDS_SOURCE_ID,
    SECONDARY_STAT_LAYER_ID,
    SECONDARY_STAT_HOVER_LAYER_ID,
    COUNTY_CENTROIDS_SOURCE_ID,
    COUNTY_SECONDARY_LAYER_ID,
    COUNTY_SECONDARY_HOVER_LAYER_ID,
    COUNTY_BOUNDARY_SOURCE_ID,
    COUNTY_BOUNDARY_FILL_LAYER_ID,
    COUNTY_BOUNDARY_LINE_LAYER_ID,
    COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
    COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
    COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
    COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
    COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID,
    COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID,
    COUNTY_STATDATA_FILL_LAYER_ID,
  }, currentTheme, selectedStatId, pinnedZips, transientZips);

  const updateZipHoverOutline = () => {
    const hovered = hoveredZipFromToolbar || hoveredZipFromMap;
    extUpdateZipHoverOutline(map, {
      BOUNDARY_SOURCE_ID,
      BOUNDARY_FILL_LAYER_ID,
      BOUNDARY_LINE_LAYER_ID,
      BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
      BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
      BOUNDARY_PINNED_FILL_LAYER_ID,
      BOUNDARY_PINNED_LINE_LAYER_ID,
      BOUNDARY_HOVER_LINE_LAYER_ID,
      BOUNDARY_HOVER_FILL_LAYER_ID,
      BOUNDARY_STATDATA_FILL_LAYER_ID,
      ZIP_CENTROIDS_SOURCE_ID,
      SECONDARY_STAT_LAYER_ID,
      SECONDARY_STAT_HOVER_LAYER_ID,
      COUNTY_CENTROIDS_SOURCE_ID,
      COUNTY_SECONDARY_LAYER_ID,
      COUNTY_SECONDARY_HOVER_LAYER_ID,
      COUNTY_BOUNDARY_SOURCE_ID,
      COUNTY_BOUNDARY_FILL_LAYER_ID,
      COUNTY_BOUNDARY_LINE_LAYER_ID,
      COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
      COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
    COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
    COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
    COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID,
    COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID,
    COUNTY_STATDATA_FILL_LAYER_ID,
  }, currentTheme, selectedStatId, pinnedZips, transientZips, hovered || null);
    zipLabels?.setHoveredZip(hovered || null);
    
    // Also update secondary stat hover layer immediately
    if (secondaryStatId) {
      const primaryEntry = selectedStatId ? scopedStatDataByBoundary.get(selectedStatId) : undefined;
      const primaryZipScope = new Set<string>(Object.keys(primaryEntry?.ZIP?.data ?? {}));
      extUpdateSecondaryStatHover(map, {
        SECONDARY_STAT_LAYER_ID,
        SECONDARY_STAT_HOVER_LAYER_ID,
        COUNTY_SECONDARY_LAYER_ID,
        COUNTY_SECONDARY_HOVER_LAYER_ID,
      }, boundaryMode, secondaryStatId, scopedStatDataByBoundary, primaryZipScope, new Set(), hovered || null, null);
    }
  };

  const updateCountySelectionHighlight = () => extUpdateCountySelectionHighlight(map, {
    BOUNDARY_SOURCE_ID,
    BOUNDARY_FILL_LAYER_ID,
    BOUNDARY_LINE_LAYER_ID,
    BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
    BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
    BOUNDARY_PINNED_FILL_LAYER_ID,
    BOUNDARY_PINNED_LINE_LAYER_ID,
    BOUNDARY_HOVER_LINE_LAYER_ID,
    BOUNDARY_HOVER_FILL_LAYER_ID,
    BOUNDARY_STATDATA_FILL_LAYER_ID,
    ZIP_CENTROIDS_SOURCE_ID,
    SECONDARY_STAT_LAYER_ID,
    SECONDARY_STAT_HOVER_LAYER_ID,
    COUNTY_CENTROIDS_SOURCE_ID,
    COUNTY_SECONDARY_LAYER_ID,
    COUNTY_SECONDARY_HOVER_LAYER_ID,
    COUNTY_BOUNDARY_SOURCE_ID,
    COUNTY_BOUNDARY_FILL_LAYER_ID,
    COUNTY_BOUNDARY_LINE_LAYER_ID,
    COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
    COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
    COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
    COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
    COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID,
    COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID,
    COUNTY_STATDATA_FILL_LAYER_ID,
  }, currentTheme, selectedStatId, pinnedCounties, transientCounties);

  const updateCountyHoverOutline = () => {
    const hovered = hoveredCountyFromToolbar || hoveredCountyFromMap;
    extUpdateCountyHoverOutline(map, {
      BOUNDARY_SOURCE_ID,
      BOUNDARY_FILL_LAYER_ID,
      BOUNDARY_LINE_LAYER_ID,
      BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
      BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
      BOUNDARY_PINNED_FILL_LAYER_ID,
      BOUNDARY_PINNED_LINE_LAYER_ID,
      BOUNDARY_HOVER_LINE_LAYER_ID,
      BOUNDARY_HOVER_FILL_LAYER_ID,
      BOUNDARY_STATDATA_FILL_LAYER_ID,
      ZIP_CENTROIDS_SOURCE_ID,
      SECONDARY_STAT_LAYER_ID,
      SECONDARY_STAT_HOVER_LAYER_ID,
      COUNTY_CENTROIDS_SOURCE_ID,
      COUNTY_SECONDARY_LAYER_ID,
      COUNTY_SECONDARY_HOVER_LAYER_ID,
      COUNTY_BOUNDARY_SOURCE_ID,
      COUNTY_BOUNDARY_FILL_LAYER_ID,
      COUNTY_BOUNDARY_LINE_LAYER_ID,
      COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
      COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
      COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
      COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
      COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID,
      COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID,
    COUNTY_STATDATA_FILL_LAYER_ID,
  }, currentTheme, selectedStatId, pinnedCounties, transientCounties, hovered);
    
    // Also update secondary stat hover layer immediately
    if (secondaryStatId) {
      const primaryEntry = selectedStatId ? scopedStatDataByBoundary.get(selectedStatId) : undefined;
      const primaryCountyScope = new Set<string>(Object.keys(primaryEntry?.COUNTY?.data ?? {}));
      extUpdateSecondaryStatHover(map, {
        SECONDARY_STAT_LAYER_ID,
        SECONDARY_STAT_HOVER_LAYER_ID,
        COUNTY_SECONDARY_LAYER_ID,
        COUNTY_SECONDARY_HOVER_LAYER_ID,
      }, boundaryMode, secondaryStatId, scopedStatDataByBoundary, new Set(), primaryCountyScope, null, hovered || null);
    }
  };

  const zipSelection = createSelectionHandlers({
    getPinned: () => pinnedZips,
    setPinned: (next) => { pinnedZips = next; },
    getTransient: () => transientZips,
    setTransient: (next) => { transientZips = next; },
    updateHighlight: updateZipSelectionHighlight,
    updateHover: updateZipHoverOutline,
    onAfterApply: (union) => {
      updateSecondaryStatOverlay();
      zipLabels?.setSelectedZips(union, Array.from(pinnedZips));
    },
    onNotify: ({ union, pinned, transient }) => {
      onZipSelectionChange?.(union, { pinned, transient });
      onAreaSelectionChange?.({
        kind: "ZIP",
        selected: union,
        pinned,
        transient,
      });
    },
    getBounds: getZipAreaBounds,
    maxZoom: 14,
  });

  const countySelection = createSelectionHandlers({
    getPinned: () => pinnedCounties,
    setPinned: (next) => { pinnedCounties = next; },
    getTransient: () => transientCounties,
    setTransient: (next) => { transientCounties = next; },
    updateHighlight: updateCountySelectionHighlight,
    updateHover: updateCountyHoverOutline,
    onAfterApply: (union) => {
      countyLabels?.setSelectedZips?.(union, Array.from(pinnedCounties));
    },
    onNotify: ({ union, pinned, transient }) => {
      onCountySelectionChange?.(union, { pinned, transient });
      onAreaSelectionChange?.({
        kind: "COUNTY",
        selected: union,
        pinned,
        transient,
      });
    },
    getBounds: getCountyAreaBounds,
    maxZoom: COUNTY_SELECTION_MAX_ZOOM,
  });

  const zoomToCounty = (countyId: string) => {
    const bounds = getCountyAreaBounds(countyId);
    if (!bounds) return;
    const centerLng = (bounds[0][0] + bounds[1][0]) / 2;
    const centerLat = (bounds[0][1] + bounds[1][1]) / 2;
    map.easeTo({ center: [centerLng, centerLat], zoom: COUNTY_ZIP_VIEW_MAX_ZOOM, duration: 400 });
    const ensureZipMode = () => {
      if (map.getZoom() >= COUNTY_MODE_DISABLE_ZOOM) {
        setBoundaryMode("zips");
      }
    };
    map.once("zoomend", ensureZipMode);
    map.once("moveend", ensureZipMode);
  };

  const evaluateBoundaryModeForZoom = () => {
    if (typeof shouldAutoBoundarySwitch === "function" && !shouldAutoBoundarySwitch()) {
      return;
    }
    if (boundaryMode === "none") return;
    const zoom = map.getZoom();
    if (boundaryMode === "zips" && zoom <= COUNTY_MODE_ENABLE_ZOOM) {
      setBoundaryMode("counties");
    } else if (boundaryMode === "counties" && zoom >= COUNTY_MODE_DISABLE_ZOOM) {
      setBoundaryMode("zips");
    }
  };

  map.on("zoomend", evaluateBoundaryModeForZoom);
  map.on("moveend", evaluateBoundaryModeForZoom);
  destroyFns.push(() => {
    map.off("zoomend", evaluateBoundaryModeForZoom);
    map.off("moveend", evaluateBoundaryModeForZoom);
  });

  const handleZipGeometryVisibilityChange = () => {
    const didChange = updateBoundaryVisibility();
    if (!didChange) return;
    applyLabelVisibility();
    if (zipGeometryHiddenDueToZoom) {
      zipFloatingTitle?.hide();
    }
    refreshStatVisuals(); // Already deferred via coalescing
    updateVisibleZipSet();
  };
  map.on("zoom", handleZipGeometryVisibilityChange);
  destroyFns.push(() => {
    map.off("zoom", handleZipGeometryVisibilityChange);
  });

  // Debounce viewport settled handler to reduce jutter during pan/zoom
  let viewportSettledTimer: ReturnType<typeof setTimeout> | null = null;
  let viewportIdleHandle: number | ReturnType<typeof setTimeout> | null = null;
  const VIEWPORT_SETTLED_DEBOUNCE_MS = 200;

  const handleViewportSettledCore = () => {
    void ensureZctasForCurrentView();
    // Check if selected orgs are still visible after viewport change
    void checkSelectedOrgsVisibility();
    // Update cluster highlights after zoom (clusters may have merged/split)
    if (selectedOrgIds.size > 0) {
      void updateSelectedClusterHighlight();
    }
    updateVisibleZipSet();
  };

  const handleViewportSettled = () => {
    // Cancel any pending work
    if (viewportSettledTimer !== null) {
      clearTimeout(viewportSettledTimer);
    }
    cancelIdle(viewportIdleHandle);
    viewportIdleHandle = null;
    
    // Debounce first, then schedule in idle time
    viewportSettledTimer = setTimeout(() => {
      viewportSettledTimer = null;
      // Schedule heavy work during idle time so it doesn't block interactions
      viewportIdleHandle = scheduleIdle(() => {
        viewportIdleHandle = null;
        handleViewportSettledCore();
      }, 150);
    }, VIEWPORT_SETTLED_DEBOUNCE_MS);
  };

  map.on("moveend", handleViewportSettled);
  map.on("zoomend", handleViewportSettled);
  destroyFns.push(() => {
    map.off("moveend", handleViewportSettled);
    map.off("zoomend", handleViewportSettled);
    if (viewportSettledTimer !== null) {
      clearTimeout(viewportSettledTimer);
      viewportSettledTimer = null;
    }
    cancelIdle(viewportIdleHandle);
    viewportIdleHandle = null;
  });

  const checkSelectedOrgsVisibility = async () => {
    if (selectedOrgIds.size === 0) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    try {
      const canvas = map.getCanvas();
      // Check visible point features
      const visiblePoints = map.queryRenderedFeatures(
        [[0, 0], [canvas.width, canvas.height]] as any,
        { layers: [LAYER_POINTS_ID] }
      );
      const visiblePointIds = new Set(
        visiblePoints.map(f => f?.properties?.id).filter((id: any): id is string => typeof id === "string")
      );
      // Check visible clusters
      const visibleClusters = map.queryRenderedFeatures(
        [[0, 0], [canvas.width, canvas.height]] as any,
        { layers: [LAYER_CLUSTERS_ID] }
      ).filter((f) => typeof (f.properties as any)?.cluster_id === "number");
      
      // Check if any selected orgs are visible as points
      const hasVisiblePoints = Array.from(selectedOrgIds).some(id => visiblePointIds.has(id));
      
      // Check if selected orgs are in visible clusters
      let hasVisibleCluster = false;
      for (const f of visibleClusters) {
        const cid = (f.properties as any).cluster_id as number;
        const leaves = await source.getClusterLeaves(cid, 1000, 0);
        const clusterOrgIds = new Set(
          leaves.map((lf: any) => lf?.properties?.id).filter((id: any): id is string => typeof id === "string")
        );
        if (Array.from(selectedOrgIds).some(id => clusterOrgIds.has(id))) {
          hasVisibleCluster = true;
          break;
        }
      }
      
      // If no selected orgs are visible, clear the selection
      if (!hasVisiblePoints && !hasVisibleCluster) {
        selectedOrgIds = new Set();
        selectedClusterId = null;
        selectedClusterIds = [];
        updateSelectedHighlights();
      } else {
        // Update cluster highlight if needed
        void updateSelectedClusterHighlight();
      }
    } catch {
      // On error, keep selection (might be temporary issue)
    }
  };

  const updateUserLocationSource = () => {
    const source = map.getSource(USER_LOCATION_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) {
      pendingUserLocationUpdate = Boolean(userLocation);
      return;
    }

    pendingUserLocationUpdate = false;
    const data: GeoJSON.FeatureCollection<GeoJSON.Point> = userLocation
      ? {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [userLocation.lng, userLocation.lat],
              },
              properties: {},
            },
          ],
        }
      : {
          type: "FeatureCollection",
          features: [],
        };

    source.setData(data);
  };

  const ensureSourcesAndLayers = () => {
    if (!map.isStyleLoaded()) return;

    // Ensure a slightly gray map background in light mode to contrast the UI
    try {
      if (currentTheme === "light") {
        const style = map.getStyle() as any;
        const bgLayer = style?.layers?.find((l: any) => l?.type === "background");
        const backgroundLayerId = bgLayer?.id || "app-background";
        if (!bgLayer && !map.getLayer(backgroundLayerId)) {
          map.addLayer({ id: backgroundLayerId, type: "background", paint: {} });
        }
        if (map.getLayer(backgroundLayerId)) {
          map.setPaintProperty(backgroundLayerId, "background-color", "#f2f3f5");
        }
      }
    } catch {}

    ensureBoundaryLayers(map, {
      BOUNDARY_SOURCE_ID,
      BOUNDARY_FILL_LAYER_ID,
      BOUNDARY_LINE_LAYER_ID,
      BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
      BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
      BOUNDARY_PINNED_FILL_LAYER_ID,
      BOUNDARY_PINNED_LINE_LAYER_ID,
      BOUNDARY_HOVER_LINE_LAYER_ID,
      BOUNDARY_HOVER_FILL_LAYER_ID,
      BOUNDARY_STATDATA_FILL_LAYER_ID,
      ZIP_CENTROIDS_SOURCE_ID,
      SECONDARY_STAT_LAYER_ID,
      SECONDARY_STAT_HOVER_LAYER_ID,
      COUNTY_CENTROIDS_SOURCE_ID,
      COUNTY_SECONDARY_LAYER_ID,
      COUNTY_SECONDARY_HOVER_LAYER_ID,
      COUNTY_BOUNDARY_SOURCE_ID,
      COUNTY_BOUNDARY_FILL_LAYER_ID,
      COUNTY_BOUNDARY_LINE_LAYER_ID,
      COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
      COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
      COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
      COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
      COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID,
      COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID,
      COUNTY_STATDATA_FILL_LAYER_ID,
    }, boundaryMode, currentTheme);

    const hasBoundarySource = Boolean(map.getSource(BOUNDARY_SOURCE_ID));
    if (!hasBoundarySource) {
      // Style swaps purge sources; remember to re-run ensures once rebuilt.
      if (boundarySourceReady) {
        pendingZctaEnsureForce = true;
      }
      boundarySourceReady = false;
      pendingZctaEnsure = true;
    } else if (!boundarySourceReady) {
      // First time the source appears after a reset, replay any queued requests.
      boundarySourceReady = true;
      const shouldForce = pendingZctaEnsureForce;
      const shouldRun = pendingZctaEnsure;
      pendingZctaEnsure = false;
      pendingZctaEnsureForce = false;
      if (shouldRun) {
        void ensureZctasForCurrentView({ force: shouldForce });
      }
    }

    syncZctaSource();

    ensureOrganizationLayers(map, {
      SOURCE_ID,
      LAYER_CLUSTERS_ID,
      LAYER_CLUSTER_COUNT_ID,
      LAYER_POINTS_ID,
      LAYER_HIGHLIGHT_ID,
      LAYER_CLUSTER_HIGHLIGHT_ID,
    }, lastData, isMobile);

    if (!map.getSource(USER_LOCATION_SOURCE_ID)) {
      map.addSource(USER_LOCATION_SOURCE_ID, {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });
    }
    if (!map.getLayer(USER_LOCATION_LAYER_ID)) {
      map.addLayer(
        {
          id: USER_LOCATION_LAYER_ID,
          type: "circle",
          source: USER_LOCATION_SOURCE_ID,
          paint: {
            "circle-radius": 9,
            "circle-color": "#d946ef",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": 0.95,
          },
        },
      );
    }

    // Critical path: visibility and basic paint (fast, needed for UX)
    updateHighlight();
    updateBoundaryPaint();
    updateBoundaryVisibility({ force: true });
    zipSelection.refresh();
    countySelection.refresh();
    updateOrganizationPinsVisibility();
    applyLabelVisibility();
    if (pendingUserLocationUpdate || userLocation) {
      updateUserLocationSource();
    }
    
    // Deferred path: stat overlays (can wait, expensive)
    // Use idle callback so map renders first, then overlays appear
    scheduleIdle(() => {
      updateStatDataChoropleth();
      updateSecondaryStatOverlay();
    }, 100);
  };

  map.once("load", () => {
    // Only reset to default if no initial position was provided from URL
    if (!initialMapPosition) {
      map.jumpTo({
        center: [OKLAHOMA_CENTER.longitude, OKLAHOMA_CENTER.latitude],
        zoom: OKLAHOMA_DEFAULT_ZOOM,
      });
    }

    map.getCanvas().style.outline = "none";

    // Critical path: set up layers and visibility (fast)
    ensureSourcesAndLayers();
    evaluateBoundaryModeForZoom();
    
    // Deferred: ZCTA loading (heavy, can wait for idle)
    scheduleIdle(() => {
      void ensureZctasForCurrentView({ force: true });
    }, 50);

    zipFloatingTitle = createZipFloatingTitle({ map });
    
    zipLabels = createZipLabels({ map });
    countyLabels = createZipLabels({ map, getCentroidsMap: getCountyCentroidsMap, labelForId: getCountyName });
    zipLabels.setTheme(currentTheme);
    countyLabels.setTheme(currentTheme);

    const unwireCanvasDrag = (() => {
    let isDragging = false;
      const onMouseDown = () => { isDragging = true; map.getCanvas().style.cursor = "grabbing"; };
      const onMouseUp = () => { isDragging = false; map.getCanvas().style.cursor = "pointer"; };
      const onCanvasLeave = () => { if (isDragging) { isDragging = false; map.getCanvas().style.cursor = "pointer"; } };
      map.on("mousedown", onMouseDown);
      map.on("mouseup", onMouseUp);
      const canvas = map.getCanvas();
      canvas.addEventListener("mouseleave", onCanvasLeave);
      map.getCanvas().style.cursor = "pointer";
      return () => {
        map.off("mousedown", onMouseDown);
        map.off("mouseup", onMouseUp);
        canvas.removeEventListener("mouseleave", onCanvasLeave);
      };
    })();

    const unwireOrganizations = (() => {
      // Track short, low‑movement taps on mobile to treat as a primary select
      let tapStart: { point: maplibregl.PointLike; time: number; id: string | null } | null = null;
      let consumedTap = false;
      const onPointsMouseEnter = () => { map.getCanvas().style.cursor = "pointer"; };
      const onPointsMouseLeave = () => { 
        map.getCanvas().style.cursor = "pointer"; 
        // Clear hover - updateHighlight will restore selection if any
        onHover(null); 
      };
      const onPointsMouseMove = (e: any) => { 
        const f = e.features?.[0]; 
        const id = f?.properties?.id as string | undefined; 
        // Update hover - this will call updateHighlight which handles hover vs selection
        onHover(id || null); 
      };
      const onPointsClick = (e: any) => {
        // Avoid duplicate open when a touch tap already handled selection
        if (consumedTap) { consumedTap = false; return; }
        const feature = e.features?.[0];
        const orgId = feature?.properties?.id as string | undefined;
        if (orgId) {
          onOrganizationClick?.(orgId, { source: "point" });
        }
      };
      const onPointsTouchStart = (e: any) => {
        if (!isMobile) return;
        tapStart = { point: e.point, time: Date.now(), id: (e.features?.[0]?.properties?.id as string) || null };
        consumedTap = false;
      };
      const onPointsTouchEnd = (e: any) => {
        if (!isMobile || !tapStart) return;
        const dt = Date.now() - tapStart.time;
        const dx = (e.point?.x ?? 0) - (tapStart.point as any)?.x;
        const dy = (e.point?.y ?? 0) - (tapStart.point as any)?.y;
        const distancePx = Math.sqrt((dx || 0) * (dx || 0) + (dy || 0) * (dy || 0));
        // Treat quick, small movement as a tap
        if (dt < 500 && distancePx < 6) {
          const feature = e.features?.[0];
          const orgId = feature?.properties?.id as string | undefined;
          if (orgId) {
            consumedTap = true;
            onOrganizationClick?.(orgId, { source: "point" });
          }
        }
        tapStart = null;
      };
      map.on("mouseenter", LAYER_POINTS_ID, onPointsMouseEnter);
      map.on("mouseleave", LAYER_POINTS_ID, onPointsMouseLeave);
      map.on("mousemove", LAYER_POINTS_ID, onPointsMouseMove);
      map.on("click", LAYER_POINTS_ID, onPointsClick);
      // Mobile tap support
      map.on("touchstart", LAYER_POINTS_ID, onPointsTouchStart);
      map.on("touchend", LAYER_POINTS_ID, onPointsTouchEnd);

      const triggerClusterInteraction = async (point: maplibregl.PointLike) => {
        const features = map.queryRenderedFeatures(point, { layers: [LAYER_CLUSTERS_ID] });
        const feature = features[0];
        if (!feature || feature.geometry?.type !== "Point") return;
        const clusterId = feature.properties?.cluster_id as number | undefined;
        const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        if (!source || clusterId === undefined) return;
        try {
          const zoom = await source.getClusterExpansionZoom(clusterId);
          const pointGeometry = feature.geometry as GeoJSON.Point;
          const [lng, lat] = pointGeometry.coordinates as [number, number];
          const countRaw = feature.properties?.point_count;
          const count = typeof countRaw === "number" ? countRaw : undefined;
          const leavesPromise =
            typeof count === "number" && count <= 3
              ? source.getClusterLeaves(clusterId, Math.max(count, 1), 0)
              : null;

          if (leavesPromise) {
            try {
              const leaves = await leavesPromise;
              const ids = leaves
                .map((leaf: any) => leaf?.properties?.id)
                .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);

              // Only zoom if single org; skip zoom for multiple orgs
              if (ids.length === 1) {
                map.easeTo({ center: [lng, lat], zoom });
              }

              onClusterClick?.(ids, { count: count ?? ids.length, longitude: lng, latitude: lat });
            } catch {}
          } else {
            // For large clusters (count > 3), still zoom as before
            map.easeTo({ center: [lng, lat], zoom });
          }
        } catch {}
      };

      const onClustersMouseEnter = () => { map.getCanvas().style.cursor = "pointer"; };
      const onClustersMouseLeave = () => { 
        map.getCanvas().style.cursor = "pointer"; 
        // Clear hover - selection will persist
        hoverClusterId = null;
        onHover(null); 
        updateSelectedHighlights();
      };
      const onClustersMouseMove = async (e: any) => {
        const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_CLUSTERS_ID] });
        const feature = features[0];
        const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        const clusterId = feature?.properties?.cluster_id as number | undefined;
        if (!feature || !source || clusterId === undefined) {
          // If no cluster under cursor, clear hover (selection will persist)
          hoverClusterId = null;
          onHover(null);
          updateSelectedHighlights();
          return;
        }
        try {
          // Set hover cluster - updateSelectedHighlights will show both selected and hover
          hoverClusterId = clusterId;
          updateSelectedHighlights();
          const leaves = await source.getClusterLeaves(clusterId, 1000, 0);
          const ids = leaves
            .map((f: any) => f?.properties?.id)
            .filter((v: any): v is string => typeof v === "string");
          onHover(ids);
        } catch {}
      };
      const onClustersClick = async (e: any) => {
        if (clusterConsumedTap) {
          clusterConsumedTap = false;
          return;
        }
        await triggerClusterInteraction(e.point);
      };
      let clusterTapStart: { point: maplibregl.PointLike; time: number } | null = null;
      let clusterConsumedTap = false;
      const onClustersTouchStart = (e: any) => {
        if (!isMobile) return;
        clusterTapStart = { point: e.point, time: Date.now() };
        clusterConsumedTap = false;
      };
      const onClustersTouchEnd = (e: any) => {
        if (!isMobile || !clusterTapStart) return;
        const dt = Date.now() - clusterTapStart.time;
        const dx = (e.point?.x ?? 0) - (clusterTapStart.point as any)?.x;
        const dy = (e.point?.y ?? 0) - (clusterTapStart.point as any)?.y;
        const distancePx = Math.sqrt((dx || 0) * (dx || 0) + (dy || 0) * (dy || 0));
        if (dt < 500 && distancePx < 6) {
          clusterConsumedTap = true;
          void triggerClusterInteraction(e.point);
        }
        clusterTapStart = null;
      };
      map.on("mouseenter", LAYER_CLUSTERS_ID, onClustersMouseEnter);
      map.on("mouseleave", LAYER_CLUSTERS_ID, onClustersMouseLeave);
      map.on("mousemove", LAYER_CLUSTERS_ID, onClustersMouseMove);
      map.on("click", LAYER_CLUSTERS_ID, onClustersClick);
      map.on("touchstart", LAYER_CLUSTERS_ID, onClustersTouchStart);
      map.on("touchend", LAYER_CLUSTERS_ID, onClustersTouchEnd);
      return () => {
        map.off("mouseenter", LAYER_POINTS_ID, onPointsMouseEnter);
        map.off("mouseleave", LAYER_POINTS_ID, onPointsMouseLeave);
        map.off("mousemove", LAYER_POINTS_ID, onPointsMouseMove);
        map.off("click", LAYER_POINTS_ID, onPointsClick);
        map.off("mouseenter", LAYER_CLUSTERS_ID, onClustersMouseEnter);
        map.off("mouseleave", LAYER_CLUSTERS_ID, onClustersMouseLeave);
        map.off("mousemove", LAYER_CLUSTERS_ID, onClustersMouseMove);
        map.off("click", LAYER_CLUSTERS_ID, onClustersClick);
        map.off("touchstart", LAYER_POINTS_ID, onPointsTouchStart);
        map.off("touchend", LAYER_POINTS_ID, onPointsTouchEnd);
        map.off("touchstart", LAYER_CLUSTERS_ID, onClustersTouchStart);
        map.off("touchend", LAYER_CLUSTERS_ID, onClustersTouchEnd);
      };
    })();

    const unwireBoundaries = (() => {
      const handleBoundaryClick = (e: maplibregl.MapLayerMouseEvent) => {
        // Disable ZIP area selection on mobile when org pins are visible
        // (County clicks are handled separately to allow zooming)
        if (boundaryMode === "zips" && isMobile && orgPinsVisible) {
          resetCountyPressState();
          return;
        }

        if (boundaryMode === "zips") {
          const orgFeatures = map.queryRenderedFeatures(e.point, { layers: [LAYER_POINTS_ID, LAYER_CLUSTERS_ID] });
          if (orgFeatures.length > 0) {
            resetCountyPressState();
            return;
          }
          const features = map.queryRenderedFeatures(e.point, { layers: zipLayerOrder });
          const feature = features[0];
          const zip = feature?.properties?.[zipFeatureProperty] as string | undefined;
          if (!zip) {
            resetCountyPressState();
            return;
          }
          const additive = Boolean((e.originalEvent as MouseEvent | PointerEvent | undefined)?.shiftKey);
          zipSelection.toggle(zip, additive, false);
          resetCountyPressState();
          return;
        }

        if (boundaryMode === "counties") {
          const orgFeatures = map.queryRenderedFeatures(e.point, { layers: [LAYER_POINTS_ID, LAYER_CLUSTERS_ID] });
          if (orgFeatures.length > 0) {
            resetCountyPressState();
            return;
          }
          const features = map.queryRenderedFeatures(e.point, { layers: countyLayerOrder });
          const feature = features[0];
          const county = feature?.properties?.[countyFeatureProperty] as string | undefined;
          if (!county) {
            resetCountyPressState();
            return;
          }
          // On mobile with org pins visible, allow zoom but disable selection
          if (isMobile && orgPinsVisible) {
            cancelCountyPendingZoom();
            countyPendingZoomTimer = setTimeout(() => {
              if (boundaryMode !== "counties") return;
              zoomToCounty(county);
              countyPendingZoomTimer = null;
            }, COUNTY_CLICK_ZOOM_DELAY_MS);
            resetCountyPressState({ cancelZoom: false });
            return;
          }
          const originalEvent = e.originalEvent as MouseEvent | PointerEvent | undefined;
          const shiftKey = Boolean(originalEvent?.shiftKey);
          const hasExistingSelection = countySelection.getUnion().length > 0;
          const longPressTriggered = wasCountyPressLong(county);
          const shouldSelect = shiftKey || longPressTriggered || hasExistingSelection;
          if (shouldSelect) {
            const additive = shiftKey || hasExistingSelection;
            cancelCountyPendingZoom();
            countySelection.toggle(county, additive, false);
            resetCountyPressState();
          } else {
            cancelCountyPendingZoom();
            countyPendingZoomTimer = setTimeout(() => {
              if (boundaryMode !== "counties") return;
              zoomToCounty(county);
              countyPendingZoomTimer = null;
            }, COUNTY_CLICK_ZOOM_DELAY_MS);
            resetCountyPressState({ cancelZoom: false });
          }
          return;
        }

        resetCountyPressState();
      };
      const handleBoundaryDoubleClick = (e: maplibregl.MapLayerMouseEvent) => {
        // Disable area selection on mobile when org pins are visible
        if (isMobile && orgPinsVisible) {
          return;
        }

        if (boundaryMode === "zips") {
          e.preventDefault();
          const orgFeatures = map.queryRenderedFeatures(e.point, { layers: [LAYER_POINTS_ID, LAYER_CLUSTERS_ID] });
          if (orgFeatures.length > 0) return;
          const features = map.queryRenderedFeatures(e.point, { layers: zipLayerOrder });
          const feature = features[0];
          const zip = feature?.properties?.[zipFeatureProperty] as string | undefined;
          if (!zip) return;
          const additive = Boolean((e.originalEvent as MouseEvent | PointerEvent | undefined)?.shiftKey);
          zipSelection.toggle(zip, additive, true);
        } else if (boundaryMode === "counties") {
          e.preventDefault();
          cancelCountyPendingZoom();
          const orgFeatures = map.queryRenderedFeatures(e.point, { layers: [LAYER_POINTS_ID, LAYER_CLUSTERS_ID] });
          if (orgFeatures.length > 0) return;
          const features = map.queryRenderedFeatures(e.point, { layers: countyLayerOrder });
          const feature = features[0];
          const county = feature?.properties?.[countyFeatureProperty] as string | undefined;
          if (!county) return;
          const additive = Boolean((e.originalEvent as MouseEvent | PointerEvent | undefined)?.shiftKey);
          countySelection.toggle(county, additive, false);
          resetCountyPressState();
        }
      };
      const countyInteractionLayers = [
        COUNTY_BOUNDARY_FILL_LAYER_ID,
        COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
        COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
        COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID,
        COUNTY_STATDATA_FILL_LAYER_ID,
      ];
      const handleCountyPointerDown = (e: maplibregl.MapLayerMouseEvent) => {
        if (boundaryMode !== "counties") {
          resetCountyPressState();
          return;
        }
        const features = map.queryRenderedFeatures(e.point, { layers: countyLayerOrder });
        const feature = features[0];
        const county = feature?.properties?.[countyFeatureProperty] as string | undefined;
        if (!county) {
          resetCountyPressState();
          return;
        }
        beginCountyPressTracking(county);
      };
      const handleCountyPointerUp = (e: maplibregl.MapLayerMouseEvent) => {
        stopCountyPressTimer();
        if (!countyPressCandidate) return;
        const features = map.queryRenderedFeatures(e.point, { layers: countyLayerOrder });
        const feature = features[0];
        const county = feature?.properties?.[countyFeatureProperty] as string | undefined;
        if (!county || county !== countyPressCandidate) {
          countyLongPressTriggered = false;
        }
      };
      const handleMapMouseUp = () => {
        stopCountyPressTimer();
      };
      const handleMapDragStart = () => {
        resetCountyPressState();
        dragStartCenter = map.getCenter();
        dragCollapseTriggered = false;
        mapInMotion = true;
      };
      const handleMapDrag = () => {
        if (!dragStartCenter || dragCollapseTriggered) return;
        const currentCenter = map.getCenter();
        let distanceMoved = 0;
        try {
          const distanceFn = (dragStartCenter as unknown as { distanceTo?: (c: maplibregl.LngLat) => number }).distanceTo;
          if (typeof distanceFn === "function") {
            distanceMoved = distanceFn.call(dragStartCenter, currentCenter);
          } else {
            const deltaLng = Math.abs(currentCenter.lng - dragStartCenter.lng);
            const deltaLat = Math.abs(currentCenter.lat - dragStartCenter.lat);
            // Rough conversion: degrees -> meters at equator (~111_139 meters per degree)
            distanceMoved = Math.max(deltaLng, deltaLat) * 111_139;
          }
        } catch {
          distanceMoved = 0;
        }
        if (distanceMoved >= MOBILE_DRAG_COLLAPSE_DISTANCE_METERS) {
          dragCollapseTriggered = true;
          onMapDragStart?.();
        }
      };
      const handleMapDragEnd = () => {
        dragStartCenter = null;
        dragCollapseTriggered = false;
        mapInMotion = false;
        // Flush any pending hover updates now that motion stopped
        if (pendingZipHover !== null || pendingCountyHover !== null || pendingHoverArea !== null) {
          if (pendingZipHover !== null) onZipHoverChange?.(pendingZipHover);
          if (pendingCountyHover !== null) onCountyHoverChange?.(pendingCountyHover);
          if (pendingHoverArea !== null) onAreaHoverChange?.(pendingHoverArea);
          pendingZipHover = null;
          pendingCountyHover = null;
          pendingHoverArea = null;
        }
      };
      // Safety: also reset motion on moveend in case dragend doesn't fire
      const handleMapMoveEnd = () => {
        if (mapInMotion) {
          mapInMotion = false;
          // Flush pending hovers
          if (pendingZipHover !== null) onZipHoverChange?.(pendingZipHover);
          if (pendingCountyHover !== null) onCountyHoverChange?.(pendingCountyHover);
          if (pendingHoverArea !== null) onAreaHoverChange?.(pendingHoverArea);
          pendingZipHover = null;
          pendingCountyHover = null;
          pendingHoverArea = null;
        }
      };
      countyInteractionLayers.forEach((layerId) => {
        map.on("mousedown", layerId, handleCountyPointerDown);
        map.on("mouseup", layerId, handleCountyPointerUp);
      });
      map.on("mouseup", handleMapMouseUp);
      map.on("dragstart", handleMapDragStart);
      map.on("drag", handleMapDrag);
      map.on("dragend", handleMapDragEnd);
      map.on("moveend", handleMapMoveEnd);
      // Dwell time for hover - only show overlay after mouse has been in area briefly
      // This prevents trailing overlays when moving quickly across areas
      const HOVER_DWELL_MS = 80; // ~4-5 frames - filters out fast traversal
      let zipHoverDwellTimer: ReturnType<typeof setTimeout> | null = null;
      let zipHoverCandidate: string | null = null;
      
      const commitZipHover = (zip: string) => {
        hoveredZipFromMap = zip;
        zipSelection.updateHover();
        if (mapInMotion) {
          pendingZipHover = zip;
          pendingHoverArea = { kind: "ZIP", id: zip };
        } else {
          onZipHoverChange?.(zip);
          onAreaHoverChange?.({ kind: "ZIP", id: zip });
        }
      };
      
      const clearZipHoverDwell = () => {
        if (zipHoverDwellTimer !== null) {
          clearTimeout(zipHoverDwellTimer);
          zipHoverDwellTimer = null;
        }
        zipHoverCandidate = null;
      };
      
      const onBoundaryMouseEnter = () => { 
        if (boundaryMode === "zips" && !(isMobile && orgPinsVisible)) {
          map.getCanvas().style.cursor = "pointer";
        }
      };
      const onBoundaryMouseLeave = () => {
        map.getCanvas().style.cursor = "pointer";
        if (boundaryMode === "zips") {
          clearZipHoverDwell();
          hoveredZipFromMap = null;
          zipSelection.updateHover();
          // Defer React callbacks if map is in motion
          if (mapInMotion) {
            pendingZipHover = null;
            pendingHoverArea = null;
          } else {
            onZipHoverChange?.(null);
            onAreaHoverChange?.(null);
          }
        }
      };
      const onZipMouseMove = (e: maplibregl.MapLayerMouseEvent) => {
        if (boundaryMode !== "zips") return;
        // Disable hover on mobile when org pins are visible
        if (isMobile && orgPinsVisible) return;
        const features = map.queryRenderedFeatures(e.point, { layers: zipLayerOrder });
        const zip = features[0]?.properties?.[zipFeatureProperty] as string | undefined;
        if (!zip) return;
        
        // If still in the same area (already committed or candidate), do nothing
        if (zip === hoveredZipFromMap) return;
        if (zip === zipHoverCandidate) return;
        
        // New area - cancel any pending dwell and start fresh
        clearZipHoverDwell();
        zipHoverCandidate = zip;
        zipHoverDwellTimer = setTimeout(() => {
          zipHoverDwellTimer = null;
          if (zipHoverCandidate === zip) {
            commitZipHover(zip);
            zipHoverCandidate = null;
          }
        }, HOVER_DWELL_MS);
      };
      map.on("click", handleBoundaryClick);
      map.on("dblclick", handleBoundaryDoubleClick);
      map.on("mouseenter", BOUNDARY_FILL_LAYER_ID, onBoundaryMouseEnter);
      map.on("mouseenter", BOUNDARY_STATDATA_FILL_LAYER_ID, onBoundaryMouseEnter);
      map.on("mouseleave", BOUNDARY_FILL_LAYER_ID, onBoundaryMouseLeave);
      map.on("mouseleave", BOUNDARY_STATDATA_FILL_LAYER_ID, onBoundaryMouseLeave);
      map.on("mousemove", BOUNDARY_FILL_LAYER_ID, onZipMouseMove);
      map.on("mousemove", BOUNDARY_STATDATA_FILL_LAYER_ID, onZipMouseMove);

      // Dwell time for county hover (same pattern as ZIP)
      let countyHoverDwellTimer: ReturnType<typeof setTimeout> | null = null;
      let countyHoverCandidate: string | null = null;
      
      const commitCountyHover = (county: string) => {
        hoveredCountyFromMap = county;
        countySelection.updateHover();
        countyLabels?.setHoveredZip(county);
        if (mapInMotion) {
          pendingCountyHover = county;
          pendingHoverArea = { kind: "COUNTY", id: county };
        } else {
          onCountyHoverChange?.(county);
          onAreaHoverChange?.({ kind: "COUNTY", id: county });
        }
      };
      
      const clearCountyHoverDwell = () => {
        if (countyHoverDwellTimer !== null) {
          clearTimeout(countyHoverDwellTimer);
          countyHoverDwellTimer = null;
        }
        countyHoverCandidate = null;
      };
      
      const onCountyMouseEnter = () => { 
        if (boundaryMode === "counties" && !(isMobile && orgPinsVisible)) {
          map.getCanvas().style.cursor = "pointer";
        }
      };
      const onCountyMouseLeave = () => {
        map.getCanvas().style.cursor = "pointer";
        clearCountyHoverDwell();
        hoveredCountyFromMap = null;
        countySelection.updateHover();
        countyLabels?.setHoveredZip(null);
        // Defer React callbacks if map is in motion
        if (mapInMotion) {
          pendingCountyHover = null;
          pendingHoverArea = null;
        } else {
          onCountyHoverChange?.(null);
          onAreaHoverChange?.(null);
        }
      };
      const onCountyMouseMove = (e: maplibregl.MapLayerMouseEvent) => {
        if (boundaryMode !== "counties") return;
        // Disable hover on mobile when org pins are visible
        if (isMobile && orgPinsVisible) return;
        const features = map.queryRenderedFeatures(e.point, { layers: countyLayerOrder });
        const county = features[0]?.properties?.[countyFeatureProperty] as string | undefined;
        if (!county) return;
        
        // If still in the same area (already committed or candidate), do nothing
        if (county === hoveredCountyFromMap) return;
        if (county === countyHoverCandidate) return;
        
        // New area - cancel any pending dwell and start fresh
        clearCountyHoverDwell();
        countyHoverCandidate = county;
        countyHoverDwellTimer = setTimeout(() => {
          countyHoverDwellTimer = null;
          if (countyHoverCandidate === county) {
            commitCountyHover(county);
            countyHoverCandidate = null;
          }
        }, HOVER_DWELL_MS);
      };
      map.on("mouseenter", COUNTY_BOUNDARY_FILL_LAYER_ID, onCountyMouseEnter);
      map.on("mouseenter", COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, onCountyMouseEnter);
      map.on("mouseenter", COUNTY_STATDATA_FILL_LAYER_ID, onCountyMouseEnter);
      map.on("mouseleave", COUNTY_BOUNDARY_FILL_LAYER_ID, onCountyMouseLeave);
      map.on("mouseleave", COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, onCountyMouseLeave);
      map.on("mouseleave", COUNTY_STATDATA_FILL_LAYER_ID, onCountyMouseLeave);
      map.on("mousemove", COUNTY_BOUNDARY_FILL_LAYER_ID, onCountyMouseMove);
      map.on("mousemove", COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, onCountyMouseMove);
      map.on("mousemove", COUNTY_STATDATA_FILL_LAYER_ID, onCountyMouseMove);
      return () => {
        // Clean up dwell timers
        clearZipHoverDwell();
        clearCountyHoverDwell();
        map.off("click", handleBoundaryClick);
        map.off("dblclick", handleBoundaryDoubleClick);
        map.off("mouseenter", BOUNDARY_FILL_LAYER_ID, onBoundaryMouseEnter);
        map.off("mouseenter", BOUNDARY_STATDATA_FILL_LAYER_ID, onBoundaryMouseEnter);
        map.off("mouseleave", BOUNDARY_FILL_LAYER_ID, onBoundaryMouseLeave);
        map.off("mouseleave", BOUNDARY_STATDATA_FILL_LAYER_ID, onBoundaryMouseLeave);
        map.off("mousemove", BOUNDARY_FILL_LAYER_ID, onZipMouseMove);
        map.off("mousemove", BOUNDARY_STATDATA_FILL_LAYER_ID, onZipMouseMove);
        map.off("mouseenter", COUNTY_BOUNDARY_FILL_LAYER_ID, onCountyMouseEnter);
        map.off("mouseenter", COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, onCountyMouseEnter);
        map.off("mouseenter", COUNTY_STATDATA_FILL_LAYER_ID, onCountyMouseEnter);
        map.off("mouseleave", COUNTY_BOUNDARY_FILL_LAYER_ID, onCountyMouseLeave);
        map.off("mouseleave", COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, onCountyMouseLeave);
        map.off("mouseleave", COUNTY_STATDATA_FILL_LAYER_ID, onCountyMouseLeave);
        map.off("mousemove", COUNTY_BOUNDARY_FILL_LAYER_ID, onCountyMouseMove);
        map.off("mousemove", COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, onCountyMouseMove);
        map.off("mousemove", COUNTY_STATDATA_FILL_LAYER_ID, onCountyMouseMove);
        countyInteractionLayers.forEach((layerId) => {
          map.off("mousedown", layerId, handleCountyPointerDown);
          map.off("mouseup", layerId, handleCountyPointerUp);
        });
        map.off("mouseup", handleMapMouseUp);
        map.off("dragstart", handleMapDragStart);
        map.off("drag", handleMapDrag);
        map.off("dragend", handleMapDragEnd);
        resetCountyPressState();
        dragStartCenter = null;
        dragCollapseTriggered = false;
      };
    })();

    // Ensure all listeners are cleaned up when controller is destroyed
    const previousDestroy = destroyFns.pop?.();
    const cleanup = () => {
      try { unwireCanvasDrag(); } catch {}
      try { unwireOrganizations(); } catch {}
      try { unwireBoundaries(); } catch {}
      if (typeof previousDestroy === 'function') {
        try { previousDestroy(); } catch {}
      }
    };
    destroyFns.push(cleanup);
  });

  map.on("load", () => {
    ensureSourcesAndLayers();
  });

  map.on("styledata", () => {
    ensureSourcesAndLayers();
  });
  map.on("idle", () => {
    ensureSourcesAndLayers();
    loadingIndicator.setLoading(false);
  });
  map.once("idle", () => updateVisibleZipSet());

  // Track map tile loading state for the loading indicator.
  // Only show loading for actual tile fetches (basemap), not GeoJSON source updates.
  map.on("sourcedataloading", (e: maplibregl.MapSourceDataEvent) => {
    // Only trigger for tile loading events (has a tile property)
    if (e.tile) {
      loadingIndicator.setLoading(true);
    }
  });

  unsubscribeStatData = statDataStore.subscribe((byStat) => {
    statDataStoreMap = byStat;
    recomputeScopedStatData();
    refreshStatVisuals(); // Already deferred via coalescing
  });

  function updateHighlight() {
    if (!map.getLayer(LAYER_HIGHLIGHT_ID)) return;
    const baseFilter: any[] = ["!", ["has", "point_count"]];
    // Show highlights for BOTH selected orgs AND hover (if any)
    // Selection persists even when hovering over other orgs
    const highlightIds: string[] = [];
    const hasSelectedOrgs = selectedOrgIds.size > 0;
    
    if (hasSelectedOrgs) {
      highlightIds.push(...Array.from(selectedOrgIds));
    }
    if (activeId && !selectedOrgIds.has(activeId)) {
      // Add hover ID if it's not already selected
      highlightIds.push(activeId);
    }
    
    if (highlightIds.length > 0) {
      const filter = ["all", baseFilter, ["in", ["get", "id"], ["literal", highlightIds]]];
      map.setFilter(LAYER_HIGHLIGHT_ID, filter as any);
      
      // Use data-driven properties: selected orgs get indigo glow, hover keeps white stroke
      if (hasSelectedOrgs) {
        const selectedIdsArray = Array.from(selectedOrgIds);
        const selectionMatchExpr: any = ["in", ["get", "id"], ["literal", selectedIdsArray]];
        // Conditional: if ID is in selected set, use brand glow; otherwise white stroke for hover
        const strokeColorExpr: any = [
          "case",
          selectionMatchExpr,
          SELECTED_GLOW_COLOR,
          "#ffffff"  // White stroke for hover-only orgs
        ];
        const fillColorExpr: any = [
          "case",
          selectionMatchExpr,
          SELECTED_GLOW_COLOR,
          DEFAULT_GLOW_COLOR,
        ];
        const opacityExpr: any = [
          "case",
          selectionMatchExpr,
          0.35, // Semi-transparent for selected (glow effect)
          1     // Fully opaque for hover
        ];
        map.setPaintProperty(LAYER_HIGHLIGHT_ID, "circle-color", fillColorExpr);
        map.setPaintProperty(LAYER_HIGHLIGHT_ID, "circle-stroke-color", strokeColorExpr);
        map.setPaintProperty(LAYER_HIGHLIGHT_ID, "circle-opacity", opacityExpr);
      } else {
        // Just hover - use white stroke, fully opaque
        map.setPaintProperty(LAYER_HIGHLIGHT_ID, "circle-stroke-color", "#ffffff");
        map.setPaintProperty(LAYER_HIGHLIGHT_ID, "circle-opacity", 1);
        map.setPaintProperty(LAYER_HIGHLIGHT_ID, "circle-color", DEFAULT_GLOW_COLOR);
      }
    } else {
      // No highlights
      const filter = ["all", baseFilter, ["==", ["get", "id"], "__none__"]];
      map.setFilter(LAYER_HIGHLIGHT_ID, filter as any);
    }
  }

  function updateSelectedHighlights() {
    updateHighlight();
    // Update cluster highlight - show BOTH selected clusters AND hover cluster (if different)
    // Selection persists even when hovering over other clusters
    const clusterIdsToHighlight: number[] = [];
    const primarySelectedClusterIds =
      selectedClusterIds.length > 0
        ? selectedClusterIds
        : selectedClusterId !== null
        ? [selectedClusterId]
        : [];
    const hasSelectedClusters = primarySelectedClusterIds.length > 0;
    
    // Add all selected clusters (supports multiple when orgs split across clusters)
    if (hasSelectedClusters) {
      clusterIdsToHighlight.push(...primarySelectedClusterIds);
    }
    
    // Add hover cluster if different from selected clusters
    if (hoverClusterId !== null && !clusterIdsToHighlight.includes(hoverClusterId)) {
      clusterIdsToHighlight.push(hoverClusterId);
    }
    
    if (clusterIdsToHighlight.length > 0) {
      if (clusterIdsToHighlight.length === 1) {
        extSetClusterHighlight(map, LAYER_CLUSTER_HIGHLIGHT_ID, clusterIdsToHighlight[0]);
      } else {
        extSetClusterHighlights(map, LAYER_CLUSTER_HIGHLIGHT_ID, clusterIdsToHighlight);
      }
    } else {
      extSetClusterHighlight(map, LAYER_CLUSTER_HIGHLIGHT_ID, null);
    }

    if (map.getLayer(LAYER_CLUSTER_HIGHLIGHT_ID)) {
      if (hasSelectedClusters) {
        const clusterSelectionExpr: any = [
          "in",
          ["get", "cluster_id"],
          ["literal", primarySelectedClusterIds],
        ];
        const clusterColorExpr: any = [
          "case",
          clusterSelectionExpr,
          SELECTED_GLOW_COLOR,
          DEFAULT_GLOW_COLOR,
        ];
        const clusterOpacityExpr: any = [
          "case",
          clusterSelectionExpr,
          0.45,
          0.35,
        ];
        map.setPaintProperty(LAYER_CLUSTER_HIGHLIGHT_ID, "circle-color", clusterColorExpr);
        map.setPaintProperty(LAYER_CLUSTER_HIGHLIGHT_ID, "circle-stroke-color", clusterColorExpr);
        map.setPaintProperty(LAYER_CLUSTER_HIGHLIGHT_ID, "circle-opacity", clusterOpacityExpr);
      } else {
        map.setPaintProperty(LAYER_CLUSTER_HIGHLIGHT_ID, "circle-color", DEFAULT_GLOW_COLOR);
        map.setPaintProperty(LAYER_CLUSTER_HIGHLIGHT_ID, "circle-stroke-color", DEFAULT_GLOW_COLOR);
        map.setPaintProperty(LAYER_CLUSTER_HIGHLIGHT_ID, "circle-opacity", 0.35);
      }
    }
  }

  function updateChoroplethLegend() {
    if (!selectedStatId) { choroplethLegend.setVisible(false); return; }
    
    // Hide legend when zoomed in too close (similar to county/zip boundary switching)
    if (boundaryMode === "zips" && map.getZoom() >= CHOROPLETH_HIDE_ZOOM) {
      choroplethLegend.setVisible(false);
      return;
    }
    
    extUpdateLegend(choroplethLegend, selectedStatId, boundaryMode, scopedStatDataByBoundary);
  }

  function updateSecondaryChoroplethLegend() {
    if (!secondaryStatId) { secondaryChoroplethLegend.setVisible(false); return; }
    extUpdateSecondaryLegend(secondaryChoroplethLegend, secondaryStatId, boundaryMode, scopedStatDataByBoundary);
  }

  function updateSecondaryStatOverlay() {
    const primaryEntry = selectedStatId ? scopedStatDataByBoundary.get(selectedStatId) : undefined;
    const primaryZipScope = new Set<string>(Object.keys(primaryEntry?.ZIP?.data ?? {}));
    const primaryCountyScope = new Set<string>(Object.keys(primaryEntry?.COUNTY?.data ?? {}));
    extUpdateSecondaryOverlay(map, {
      BOUNDARY_STATDATA_FILL_LAYER_ID,
      COUNTY_STATDATA_FILL_LAYER_ID,
      SECONDARY_STAT_LAYER_ID,
      COUNTY_SECONDARY_LAYER_ID,
      SECONDARY_STAT_HOVER_LAYER_ID,
      COUNTY_SECONDARY_HOVER_LAYER_ID,
    }, boundaryMode, currentTheme, secondaryStatId, scopedStatDataByBoundary,
      primaryZipScope,
      primaryCountyScope,
      pinnedZips,
      transientZips,
      (hoveredZipFromToolbar || hoveredZipFromMap || null),
      pinnedCounties,
      transientCounties,
      (hoveredCountyFromToolbar || hoveredCountyFromMap || null));
  }


  const setBoundaryMode = (mode: BoundaryMode) => {
    if (mode === boundaryMode) return;
    const previousMode = boundaryMode;
    boundaryMode = mode;
    
    // Immediate: clear hover state (fast)
    if (mode !== "zips") {
      hoveredZipFromToolbar = null;
      hoveredZipFromMap = null;
      zipFloatingTitle?.hide();
      zipLabels?.setHoveredZip(null);
      zipLabels?.setSelectedZips([], []);
    }
    if (mode !== "counties") {
      hoveredCountyFromMap = null;
      hoveredCountyFromToolbar = null;
      countyLabels?.setHoveredZip(null);
      countyLabels?.setSelectedZips([], []);
    }
    if (mode === "counties" && previousMode !== "counties") {
      zipFloatingTitle?.hide();
    }
    
    // Immediate: update layer visibility (fast, critical for UX)
    ensureSourcesAndLayers();
    updateBoundaryVisibility({ force: true });
    applyLabelVisibility();
    
    // Notify React immediately so UI can update (mode indicator, etc.)
    onBoundaryModeChange?.(boundaryMode);
    
    // Deferred: React callbacks for selection clearing (next frame)
    requestAnimationFrame(() => {
      if (previousMode === "zips" && mode !== "zips") {
        zipSelection.clearTransient({ shouldZoom: false, notify: true });
        onZipHoverChange?.(null);
        onAreaHoverChange?.(null);
      }
      if (previousMode === "counties" && mode !== "counties") {
        countySelection.clearTransient({ shouldZoom: false, notify: true });
      }
    });
    
    // Heavy work: ZCTA loading and stat visuals (idle time)
    scheduleIdle(() => {
      if (mode === "zips") {
        void ensureZctasForCurrentView({ force: true });
      }
      updateVisibleZipSet();
      refreshStatVisuals();
    }, 100);
  };

  const highlightClusterContainingOrg = async (id: string | null) => {
    if (!id) {
      hoverClusterId = null;
      updateSelectedHighlights();
      return;
    }
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    try {
      const canvas = map.getCanvas();
      const clusters = map
        .queryRenderedFeatures([[0, 0], [canvas.width, canvas.height]] as any, {
          layers: [LAYER_CLUSTERS_ID],
        })
        .filter((f) => typeof (f.properties as any)?.cluster_id === "number");

      for (const f of clusters) {
        const cid = (f.properties as any).cluster_id as number;
        const leaves = await source.getClusterLeaves(cid, 1000, 0);
        if (leaves.some((lf: any) => lf?.properties?.id === id)) {
          hoverClusterId = cid;
          updateSelectedHighlights();
          return;
        }
      }
      hoverClusterId = null;
      updateSelectedHighlights();
    } catch {
      hoverClusterId = null;
      updateSelectedHighlights();
    }
  };

  const setOrganizations = (organizations: Organization[]) => {
    allOrganizations = organizations;
    applyData();
  };

  function updateStatDataChoropleth() {
    extUpdatePrimaryChoropleth(map, {
      BOUNDARY_STATDATA_FILL_LAYER_ID,
      COUNTY_STATDATA_FILL_LAYER_ID,
      SECONDARY_STAT_LAYER_ID,
      COUNTY_SECONDARY_LAYER_ID,
      SECONDARY_STAT_HOVER_LAYER_ID,
      COUNTY_SECONDARY_HOVER_LAYER_ID,
    }, currentTheme, boundaryMode, selectedStatId, scopedStatDataByBoundary, map.getZoom());
  }

  const applyData = () => {
    const visible = allOrganizations.filter(
      (o) => !o.status || o.status === "active",
    );

    const filtered = selectedCategory
      ? visible.filter((o) => o.category === selectedCategory)
      : visible;

    const fc: FC = {
      type: "FeatureCollection",
      features: filtered.map((o) => ({
        type: "Feature",
        properties: {
          id: o.id,
          name: o.name,
          website: o.website ?? null,
          status: o.status ?? null,
        },
        geometry: { type: "Point", coordinates: [o.longitude, o.latitude] },
      })),
    };

    lastData = fc;

    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(lastData);
    }

    if (activeId && !filtered.some((o) => o.id === activeId)) {
      activeId = null;
      updateHighlight();
      // Restore selection highlights if hover is cleared
      updateSelectedHighlights();
    }

    // Clear selected orgs if they're filtered out
    const filteredIds = new Set(filtered.map(o => o.id));
    const remainingSelected = Array.from(selectedOrgIds).filter(id => filteredIds.has(id));
    if (remainingSelected.length !== selectedOrgIds.size) {
      selectedOrgIds = new Set(remainingSelected);
      if (selectedOrgIds.size === 0) {
        selectedClusterId = null;
      }
      updateSelectedHighlights();
    }

    // visibility will be emitted by the wired tracker on next move/zoom end
  };

  const setActiveOrganization = (id: string | null) => {
    if (activeId === id) return;
    activeId = id;
    // Update highlights - show both selection and hover
    updateHighlight();
    // Update cluster highlight for hover (selection will be maintained)
    void highlightClusterContainingOrg(activeId);
  };

  const centerOnOrganization = (
    id: string,
    options: { animate?: boolean; zoom?: number; offset?: [number, number] } = {},
  ) => {
    if (!id) return;
    const org = allOrganizations.find((o) => o.id === id);
    if (!org) return;
    const { longitude, latitude } = org;
    if (typeof longitude !== "number" || typeof latitude !== "number") return;

    const animate = options.animate !== false;
    const targetZoom = typeof options.zoom === "number" ? options.zoom : map.getZoom();

    const center: [number, number] = [longitude, latitude];
    const easeOptions: maplibregl.EaseToOptions = {
      center,
      zoom: targetZoom,
      duration: animate ? 600 : 0,
    };
    if (options.offset) {
      easeOptions.offset = options.offset;
    }
    try {
      map.easeTo(easeOptions);
    } catch {}
  };

  const setSelectedOrgIds = (ids: string[]) => {
    const newSet = new Set(ids);
    // Check if selection actually changed
    if (selectedOrgIds.size === newSet.size && 
        Array.from(selectedOrgIds).every(id => newSet.has(id))) {
      return;
    }
    selectedOrgIds = newSet;
    // Clear selected clusters if no orgs selected
    if (selectedOrgIds.size === 0) {
      selectedClusterId = null;
      selectedClusterIds = [];
    }
    updateSelectedHighlights();
    // If we have selected orgs, check if they're in clusters and highlight them
    if (selectedOrgIds.size > 0) {
      void updateSelectedClusterHighlight();
    }
  };

  const updateSelectedClusterHighlight = async () => {
    if (selectedOrgIds.size === 0) {
      selectedClusterId = null;
      selectedClusterIds = [];
      updateSelectedHighlights();
      return;
    }
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    try {
      const canvas = map.getCanvas();
      
      // Check visible individual points first
      const visiblePoints = map.queryRenderedFeatures(
        [[0, 0], [canvas.width, canvas.height]] as any,
        { layers: [LAYER_POINTS_ID] }
      );
      const visiblePointIds = new Set(
        visiblePoints.map(f => f?.properties?.id).filter((id: any): id is string => typeof id === "string")
      );
      
      // Check if all selected orgs are visible as individual points (not clustered)
      const allSelectedVisibleAsPoints = Array.from(selectedOrgIds).every(id => visiblePointIds.has(id));
      if (allSelectedVisibleAsPoints) {
        // All selected orgs are visible as individual points - no cluster highlight needed
        selectedClusterId = null;
        selectedClusterIds = [];
        updateSelectedHighlights();
        return;
      }
      
      // Check clusters
      const clusters = map
        .queryRenderedFeatures([[0, 0], [canvas.width, canvas.height]] as any, {
          layers: [LAYER_CLUSTERS_ID],
        })
        .filter((f) => typeof (f.properties as any)?.cluster_id === "number");

      // Find clusters that contain selected orgs
      const clustersContainingSelected: Array<{ id: number; orgIds: Set<string> }> = [];
      for (const f of clusters) {
        const cid = (f.properties as any).cluster_id as number;
        const leaves = await source.getClusterLeaves(cid, 1000, 0);
        const clusterOrgIds = new Set(
          leaves.map((lf: any) => lf?.properties?.id).filter((id: any): id is string => typeof id === "string")
        );
        // Check if any selected orgs are in this cluster
        const hasSelectedOrgs = Array.from(selectedOrgIds).some(id => clusterOrgIds.has(id));
        if (hasSelectedOrgs) {
          clustersContainingSelected.push({ id: cid, orgIds: clusterOrgIds });
        }
      }
      
      if (clustersContainingSelected.length === 0) {
        // No clusters contain selected orgs - they might be off-screen or individual points
        selectedClusterId = null;
        selectedClusterIds = [];
        updateSelectedHighlights();
        return;
      }
      
      // Find clusters that contain all selected orgs (parent clusters when zooming out)
      // or clusters that contain some selected orgs (split clusters when zooming in)
      const clustersWithAllSelected: Array<{ id: number; orgIds: Set<string> }> = [];
      const clustersWithSomeSelected: Array<{ id: number; orgIds: Set<string> }> = [];
      
      for (const cluster of clustersContainingSelected) {
        const allSelectedInCluster = Array.from(selectedOrgIds).every(id => cluster.orgIds.has(id));
        if (allSelectedInCluster) {
          clustersWithAllSelected.push(cluster);
        } else {
          clustersWithSomeSelected.push(cluster);
        }
      }
      
      if (clustersWithAllSelected.length > 0) {
        // Found cluster(s) containing all selected orgs
        // Prefer the smallest cluster (most specific match), but support multiple if needed
        clustersWithAllSelected.sort((a, b) => a.orgIds.size - b.orgIds.size);
        const bestCluster = clustersWithAllSelected[0];
        
        // Check if there are multiple clusters of the same size (rare case)
        if (clustersWithAllSelected.length === 1 || bestCluster.orgIds.size < clustersWithAllSelected[1].orgIds.size) {
          // Single best match or clearly smallest - use single cluster ID
          selectedClusterId = bestCluster.id;
          selectedClusterIds = [];
        } else {
          // Multiple clusters of same size (very rare) - highlight all
          selectedClusterId = null;
          selectedClusterIds = clustersWithAllSelected.map(c => c.id);
        }
      } else if (clustersWithSomeSelected.length > 0) {
        // Selected orgs are split across multiple clusters (zoomed in)
        // Highlight all clusters that contain selected orgs
        selectedClusterId = null;
        selectedClusterIds = clustersWithSomeSelected.map(c => c.id);
      } else {
        // No clusters found (shouldn't happen, but handle gracefully)
        selectedClusterId = null;
        selectedClusterIds = [];
      }
      
      updateSelectedHighlights();
    } catch {
      selectedClusterId = null;
      selectedClusterIds = [];
      updateSelectedHighlights();
    }
  };

  const setCategoryFilter = (categoryId: string | null) => {
    // Always sync the chips UI, even if our internal filter hasn't changed.
    // This ensures cases where a stat selection temporarily selects a category
    // (without changing the filter) can be cleared from external callers.
    selectedCategory = categoryId;
    categoryChips.setSelected(selectedCategory);
    applyData();
  };

  const fitAllOrganizations = () => {
    const features = lastData.features;
    if (!features.length) return;
    const first = features[0].geometry.coordinates as [number, number];
    let bounds = new maplibregl.LngLatBounds(first, first);
    for (let i = 1; i < features.length; i++) {
      const c = features[i].geometry.coordinates as [number, number];
      bounds = bounds.extend(c);
    }
    map.fitBounds(bounds, { padding: 60, duration: 400 });
  };

  const resizeObserver = new ResizeObserver(() => {
    map.resize();
  });
  resizeObserver.observe(container);

  const unsubscribeTheme = themeController.subscribe((nextTheme) => {
    if (nextTheme === currentTheme) return;
    currentTheme = nextTheme;
    // Preserve camera explicitly across style swaps
    const prevCenter = map.getCenter();
    const prevZoom = map.getZoom();
    // New styles wipe custom sources; flag a fresh ensure once the style settles.
    boundarySourceReady = false;
    pendingZctaEnsure = true;
    pendingZctaEnsureForce = true;
    map.setStyle(getMapStyle(nextTheme));
    map.once("styledata", () => {
      try { map.jumpTo({ center: [prevCenter.lng, prevCenter.lat], zoom: prevZoom }); } catch {}
      ensureSourcesAndLayers();
      try { map.resize(); } catch {}
    });
    map.once("idle", () => ensureSourcesAndLayers());
    
    zipLabels?.setTheme(nextTheme);
  });

  const unwireVisibleIds = wireVisibleIds(map, () => lastData, (ids, total, all) => {
    const key = `${ids.join("|")}::${all.length}`;
    if (key === lastVisibleIdsKey) return;
    lastVisibleIdsKey = key;
    onVisibleIdsChange?.(ids, total, all);
  });

  const updateOrganizationPinsVisibility = () => {
    const visibility = orgPinsVisible ? "visible" : "none";
    if (map.getLayer(LAYER_CLUSTERS_ID)) {
      map.setLayoutProperty(LAYER_CLUSTERS_ID, "visibility", visibility);
    }
    if (map.getLayer(LAYER_CLUSTER_COUNT_ID)) {
      map.setLayoutProperty(LAYER_CLUSTER_COUNT_ID, "visibility", visibility);
    }
    if (map.getLayer(LAYER_POINTS_ID)) {
      map.setLayoutProperty(LAYER_POINTS_ID, "visibility", visibility);
    }
    if (map.getLayer(LAYER_HIGHLIGHT_ID)) {
      map.setLayoutProperty(LAYER_HIGHLIGHT_ID, "visibility", visibility);
    }
    if (map.getLayer(LAYER_CLUSTER_HIGHLIGHT_ID)) {
      map.setLayoutProperty(LAYER_CLUSTER_HIGHLIGHT_ID, "visibility", visibility);
    }
  };

  // visibility listeners are managed by wireVisibleIds

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      zipSelection.clearTransient({ shouldZoom: false, notify: true });
      countySelection.clearTransient({ shouldZoom: false, notify: true });
    }
  };
  window.addEventListener("keydown", handleKeyDown);

  const cameraListeners: ((lng: number, lat: number, zoom: number) => void)[] = [];
  const emitCamera = () => {
    const c = map.getCenter();
    const z = map.getZoom();
    for (const fn of cameraListeners) fn(c.lng, c.lat, z);
  };
  map.on("moveend", emitCamera);
  map.on("zoomend", emitCamera);

  emitScopeChange();

  return {
    element: container,
    setOrganizations,
    setActiveOrganization,
    centerOnOrganization,
    setSelectedOrgIds,
    setCategoryFilter,
    setSelectedStat: (statId: string | null) => {
      selectedStatId = statId;
      categoryChips.setSelectedStat(statId);
      secondaryStatId = null;
      categoryChips.setSecondaryStat(null);
      syncStatDataStoreFocus();
      refreshStatVisuals();
      if (typeof onStatSelectionChange === 'function') {
        onStatSelectionChange(selectedStatId);
      }
    },
    setSecondaryStat: (statId: string | null) => {
      secondaryStatId = statId;
      categoryChips.setSecondaryStat(statId);
      syncStatDataStoreFocus();
      refreshStatVisuals();
    },
    setVisibleStatIds: (ids: string[] | null) => {
      categoryChips.setVisibleStatIds(ids);
    },
    setBoundaryMode,
    setPinnedZips: (zips: string[]) => {
      // React is the source of truth for pinned IDs; don't echo back via callbacks.
      zipSelection.setPinnedIds(zips, { shouldZoom: false, notify: false });
    },
    setHoveredZip: (zip: string | null) => {
      hoveredZipFromToolbar = zip;
      zipSelection.updateHover();
      const finalHovered = zip || hoveredZipFromMap;
      zipLabels?.setHoveredZip(finalHovered);
      onZipHoverChange?.(finalHovered || null);
      onAreaHoverChange?.(finalHovered ? { kind: "ZIP", id: finalHovered } : null);
    },
    setPinnedCounties: (counties: string[]) => {
      // React is the source of truth for pinned IDs; don't echo back via callbacks.
      countySelection.setPinnedIds(counties, { shouldZoom: false, notify: false });
    },
    setHoveredCounty: (county: string | null) => {
      hoveredCountyFromToolbar = county;
      countySelection.updateHover();
      const finalHovered = county || hoveredCountyFromMap;
      countyLabels?.setHoveredZip(finalHovered);
      onCountyHoverChange?.(finalHovered || null);
      onAreaHoverChange?.(finalHovered ? { kind: "COUNTY", id: finalHovered } : null);
    },
    clearTransientSelection: () => {
      // Called by React to reconcile transient sets; avoid feedback loops.
      zipSelection.clearTransient({ shouldZoom: false, notify: false });
    },
    addTransientZips: (zips: string[]) => {
      // Called by React to reconcile transient sets; avoid feedback loops.
      zipSelection.addTransient(zips, { notify: false });
    },
    clearCountyTransientSelection: () => {
      // Called by React to reconcile transient sets; avoid feedback loops.
      countySelection.clearTransient({ shouldZoom: false, notify: false });
    },
    addTransientCounties: (counties: string[]) => {
      // Called by React to reconcile transient sets; avoid feedback loops.
      countySelection.addTransient(counties, { notify: false });
    },
    fitAllOrganizations,
    setOrganizationPinsVisible: (visible: boolean) => {
      if (orgPinsVisible === visible) return;
      orgPinsVisible = visible;
      updateOrganizationPinsVisibility();
      orgLegend?.setVisible(visible);
      try { categoryChips.setOrgsVisible(visible); } catch {}
    },
    setUserLocation: (location: { lng: number; lat: number } | null) => {
      userLocation = location;
      pendingUserLocationUpdate = Boolean(location);
      if (!map.isStyleLoaded()) {
        return;
      }
      if (!map.getSource(USER_LOCATION_SOURCE_ID)) {
        ensureSourcesAndLayers();
      } else {
        updateUserLocationSource();
      }
    },
    setTimeSelection: (selection: TimeSelection | null) => {
      categoryChips.setTimeSelection(selection);
    },
    setTimeFilterAvailable: (available: boolean) => {
      categoryChips.setTimeFilterAvailable(available);
    },
    fitBounds: (bounds: BoundsArray, options?: { padding?: number; maxZoom?: number; duration?: number }) => {
      map.fitBounds(bounds, {
        padding: options?.padding ?? 72,
        maxZoom: options?.maxZoom,
        duration: options?.duration ?? 400,
      });
    },
    setCamera: (centerLng: number, centerLat: number, zoom: number, options?: { animate?: boolean }) => {
      const animate = options?.animate ?? false;
      if (animate) {
        map.easeTo({
          center: [centerLng, centerLat],
          zoom,
          duration: 600,
        });
      } else {
        map.jumpTo({ center: [centerLng, centerLat], zoom });
      }
    },
    onCameraChange: (fn: (lng: number, lat: number, zoom: number) => void) => {
      cameraListeners.push(fn);
      return () => {
        const idx = cameraListeners.indexOf(fn);
        if (idx >= 0) cameraListeners.splice(idx, 1);
      };
    },
    setLegendInset,
    setLegendTop,
    setLegendVisible,
    setLegendRightContent,
    setLegendRangeMode: (mode: "dynamic" | "scoped" | "global") => {
      setLegendRangeModeInternal(mode);
    },
    resize: () => {
      map.resize();
    },
    destroy: () => {
      try { unwireVisibleIds(); } catch {}
      // unwind wired events
      while (destroyFns.length) {
        const fn = destroyFns.pop();
        try { fn && fn(); } catch {}
      }
      resizeObserver.disconnect();
      unsubscribeTheme();
      categoryChips.destroy();
      if (unsubscribeStatData) unsubscribeStatData();
      zipFloatingTitle?.destroy();
      zipLabels?.destroy();
      choroplethLegend?.destroy();
      secondaryChoroplethLegend?.destroy();
      loadingIndicator?.destroy();
      window.removeEventListener("keydown", handleKeyDown);
      map.remove();
    },
  };
};
