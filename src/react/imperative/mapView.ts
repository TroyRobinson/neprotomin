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
import { createCategoryChips, type AreasChipMode, type SelectedStatChipOption } from "./categoryChips";
import { setStatDataPrefetchStatIds, setStatDataPriorityStatIds, setStatDataScopeParentAreas, statDataStore } from "../../state/statData";
import type { StatDataByParentArea, StatDataStoreState } from "../../state/statData";
import { createZipFloatingTitle, type ZipFloatingTitleController } from "./components/zipFloatingTitle";
import { createZipLabels, type HoverStackPill, type ZipLabelsController } from "./components/zipLabels";
import { createChoroplethLegend, type ChoroplethLegendController } from "./components/choroplethLegend";
import { createSecondaryChoroplethLegend, type SecondaryChoroplethLegendController } from "./components/secondaryChoroplethLegend";
import { statsStore } from "../../state/stats";
import {
  emptyPointsOfInterestSnapshot,
  getPointsOfInterestRows,
  pointsOfInterestStore,
  type PointOfInterestScopeKey,
  type PointsOfInterestSnapshot,
} from "../../state/pointsOfInterest";
import { createOrgLegend, type OrgLegendController } from "./components/orgLegend";
import { createMapLoadingIndicator } from "./components/mapLoadingIndicator";
import { getCountyCentroidsMap, getCountyName } from "../../lib/countyCentroids";
import type { AreaId, AreaKind } from "../../types/areas";
import { DEFAULT_PARENT_AREA_BY_KIND } from "../../types/areas";
import type { TimeSelection } from "../lib/timeFilters";
import { DEFAULT_POPULATION_STAT_ID, getDomainDefaults } from "../lib/domains";
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
  getZctaCentroid,
  getLoadedZctaCount,
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
export type { SelectedStatChipOption } from "./categoryChips";

interface AreaSelectionChange {
  kind: AreaKind;
  selected: string[];
  pinned: string[];
  transient: string[];
}

interface MapViewOptions {
  initialAreasMode?: AreasChipMode;
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
  onAreasModeChange?: (mode: AreasChipMode) => void;
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
  onSidebarExpand?: () => void;
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
  setSelectedStatOptions: (options: SelectedStatChipOption[]) => void;
  setSecondaryStat: (statId: string | null) => void;
  setVisibleStatIds: (ids: string[] | null) => void;
  setAreasMode: (mode: AreasChipMode) => void;
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
  setSidebarExpandVisible: (visible: boolean) => void;
  resize: () => void;
  destroy: () => void;
}

type ThemeName = "light" | "dark";

const MAP_STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const MAP_STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
const DEFAULT_GLOW_COLOR = "#f5c4ae";
const SELECTED_GLOW_COLOR = "#8e90c4"; // Tailwind brand-500
const BASEMAP_TEXT_OPACITY: Record<ThemeName, number> = {
  light: 0.34,
  dark: 0.46,
};
const STAT_EXTREME_GOOD_COLOR = "#6fc284";
const STAT_EXTREME_BAD_COLOR = "#f15b41";
const STAT_EXTREME_NEUTRAL_COLOR = "#f8d837";
const STAT_EXTREME_GOOD_ICON_ID = "stat-extreme-triangle-good";
const STAT_EXTREME_BAD_ICON_ID = "stat-extreme-triangle-bad";
const STAT_EXTREME_NEUTRAL_ICON_ID = "stat-extreme-triangle-neutral";
const STAT_EXTREME_ICON_SIZE = 1.08;
// Combined icon: two stacked triangles (high↑ on top, low↓ on bottom) for co-located extrema.
type ExtremaTone = "good" | "bad" | "neutral";
const statExtremeCombinedIconId = (highTone: ExtremaTone, lowTone: ExtremaTone) =>
  `stat-extreme-combined-${highTone}-${lowTone}`;

const getMapStyle = (theme: ThemeName): string =>
  theme === "dark" ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;

const CUSTOM_SOURCE_IDS = new Set<string>([
  SOURCE_ID,
  USER_LOCATION_SOURCE_ID,
  BOUNDARY_SOURCE_ID,
  ZIP_CENTROIDS_SOURCE_ID,
  POINTS_OF_INTEREST_SOURCE_ID,
  COUNTY_CENTROIDS_SOURCE_ID,
  COUNTY_BOUNDARY_SOURCE_ID,
]);

const applyBasemapLabelTone = (map: maplibregl.Map, theme: ThemeName) => {
  const style = map.getStyle() as
    | {
        layers?: Array<{
          id: string;
          type: string;
          source?: string;
          layout?: { "text-field"?: unknown };
        }>;
      }
    | undefined;
  if (!style?.layers?.length) return;
  const targetOpacity = BASEMAP_TEXT_OPACITY[theme];
  for (const layer of style.layers) {
    // Keep app-owned symbol layers at full readability; only soften basemap labels.
    if (layer.type !== "symbol") continue;
    if (!layer.layout || !("text-field" in layer.layout)) continue;
    if (typeof layer.source === "string" && CUSTOM_SOURCE_IDS.has(layer.source)) continue;
    try {
      map.setPaintProperty(layer.id, "text-opacity", targetOpacity);
    } catch {}
  }
};

const createStatExtremeArrowImage = (color: string): ImageData | null => {
  if (typeof document === "undefined") return null;
  const size = 20;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  // Straight-corner triangle marker for min/max indicators.
  ctx.beginPath();
  ctx.moveTo(size / 2, 3);
  ctx.lineTo(size - 3, size - 4);
  ctx.lineTo(3, size - 4);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  // White edge keeps markers readable over the choropleth.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  ctx.stroke();

  return ctx.getImageData(0, 0, size, size);
};

// Two stacked triangles on a single icon: high (↑) in topColor, low (↓) in bottomColor.
const createStatExtremeCombinedImage = (topColor: string, bottomColor: string): ImageData | null => {
  if (typeof document === "undefined") return null;
  const w = 20;
  const h = 30; // taller canvas to stack two triangles with a small gap
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, w, h);

  const drawTriangle = (color: string, tipX: number, tipY: number, baseY: number) => {
    const halfBase = 7;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - halfBase, baseY);
    ctx.lineTo(tipX + halfBase, baseY);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.4;
    ctx.lineJoin = "miter";
    ctx.stroke();
  };

  // High triangle pointing up (tip at top)
  drawTriangle(topColor, w / 2, 2, 13);
  // Low triangle pointing down (tip at bottom)
  drawTriangle(bottomColor, w / 2, h - 2, h - 13);

  return ctx.getImageData(0, 0, w, h);
};

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
  ZIP_STAT_EXTREME_HIGH_LAYER_ID,
  ZIP_STAT_EXTREME_LOW_LAYER_ID,
  POINTS_OF_INTEREST_SOURCE_ID,
  ZIP_POI_EXTREME_HIGH_LAYER_ID,
  ZIP_POI_EXTREME_LOW_LAYER_ID,
  COUNTY_CENTROIDS_SOURCE_ID,
  COUNTY_SECONDARY_LAYER_ID,
  COUNTY_SECONDARY_HOVER_LAYER_ID,
  COUNTY_STAT_EXTREME_HIGH_LAYER_ID,
  COUNTY_STAT_EXTREME_LOW_LAYER_ID,
  COUNTY_POI_EXTREME_HIGH_LAYER_ID,
  COUNTY_POI_EXTREME_LOW_LAYER_ID,
  ZIP_POI_COMBINED_LAYER_ID,
  COUNTY_POI_COMBINED_LAYER_ID,
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
  {
    id: string;
    name: string;
    website?: string | null;
    status?: string | null;
    annualRevenue?: number | null;
    annualRevenueTaxPeriod?: number | null;
  }
>;

type BoundaryTypeKey = "ZIP" | "COUNTY";
type ExtremaKind = "high" | "low";
type StatDataEntry = { type: string; data: Record<string, number>; min: number; max: number };
type StatDataEntryByBoundary = Partial<Record<BoundaryTypeKey, StatDataEntry>>;
type StatDataStoreMap = Map<string, StatDataByParentArea>;
type PoiFeature = GeoJSON.Feature<
  GeoJSON.Point,
  {
    poiKey: string;
    boundaryType: BoundaryTypeKey;
    extremaKind: ExtremaKind | "combined";
    areaCode: string;
    statCategory: string;
    iconId: string;
  }
>;
type PoiFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Point, PoiFeature["properties"]>;

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
const emptyPoiFC = (): PoiFeatureCollection => ({ type: "FeatureCollection", features: [] });

const readPoiDebugEnabled = (): boolean => {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const byQuery = params.get("poiDebug");
    if (byQuery === "1" || byQuery === "true") return true;
    const byStorage = window.localStorage.getItem("ne.poiDebug");
    return byStorage === "1" || byStorage === "true";
  } catch {
    return false;
  }
};

const MINIMAL_POI_DEBUG_EVENTS = new Set<string>([
  "enabled",
  "boundary-mode-change",
  "extrema-refresh",
  "poi-source-updated",
  "poi-layers-updated",
  "poi-zip-ensure-error",
]);

const COUNTY_MODE_ENABLE_ZOOM = 9;
const COUNTY_MODE_DISABLE_ZOOM = 9.6;
const COUNTY_SELECTION_MAX_ZOOM = 8.5;
const COUNTY_ZIP_VIEW_MAX_ZOOM = 10.2;
const COUNTY_CLICK_ZOOM_DELAY_MS = 220;
const COUNTY_LONG_PRESS_MS = 350;
// Minimum map movement (in meters) before we treat a gesture as a drag and collapse the mobile sheet.
const MOBILE_DRAG_COLLAPSE_DISTANCE_METERS = 8;
const ZCTA_STATE: ZctaStateCode = "ok";
const OKC_COUNTY_ID = "109";
const TULSA_COUNTY_ID = "143";
const POI_VISIBLE_WITH_SELECTED_STAT_IDS = new Set<string>([
  DEFAULT_POPULATION_STAT_ID,
  "8807bf0b-5a85-4a73-82f2-cd18c8140072",
  "82edc133-f761-4db9-8159-d5d8de3ea047",
]);
const ZCTA_LOAD_MIN_ZOOM = 9;
const ZCTA_LOAD_PADDING_DEGREES = 0.75;
const ZIP_LABEL_STACK_MIN_ZOOM = 10.8;
const COUNTY_LABEL_STACK_MIN_ZOOM = 8.6;
const ORG_HOVER_TOOLTIP_FADE_MS = 45;
const ORG_HOVER_TOOLTIP_ENTER_TRANSFORM_MS = 81;
const ORG_HOVER_TOOLTIP_ENTER_OFFSET_PX = 3;
const ORG_HOVER_TOOLTIP_Y_OFFSET_PX = 10;
const ORG_HOVER_TOOLTIP_ENTER_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
const ORG_HOVER_TOOLTIP_MAX_WIDTH_CH = 30;
const ORG_REVENUE_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const formatOrgRevenueLine = (
  annualRevenue: number | null | undefined,
  annualRevenueTaxPeriod: number | null | undefined,
): string | null => {
  if (typeof annualRevenue !== "number" || !Number.isFinite(annualRevenue) || annualRevenue <= 0) return null;
  const amountLabel = ORG_REVENUE_FORMATTER.format(annualRevenue);
  const year =
    typeof annualRevenueTaxPeriod === "number"
      && Number.isFinite(annualRevenueTaxPeriod)
      && annualRevenueTaxPeriod >= 1900
      && annualRevenueTaxPeriod <= 2500
      ? annualRevenueTaxPeriod
      : null;
  return year ? `Revenue ${amountLabel} (${year})` : `Revenue ${amountLabel}`;
};
const preventTrailingWordOrphan = (text: string): string => {
  const normalized = text.trim().replace(/\s+/g, " ");
  const words = normalized.split(" ");
  if (words.length < 2) return normalized;
  const lastWord = words[words.length - 1];
  const shouldBindLastWord =
    // Prevent common short business suffixes from dangling (e.g., "Inc", "LLC").
    /^(inc|inc\.|llc|co|co\.|corp|corp\.|ltd|ltd\.|pllc|pc|lp|llp)$/i.test(lastWord)
    || lastWord.length <= 4;
  if (!shouldBindLastWord) return normalized;
  const penultimateWord = words[words.length - 2];
  words[words.length - 2] = `${penultimateWord}\u00A0${lastWord}`;
  words.pop();
  return words.join(" ");
};

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
  initialAreasMode = "auto",
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
  onAreasModeChange,
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
  onSidebarExpand,
  legendRangeMode: legendRangeModeInitial = "scoped",
}: MapViewOptions): MapViewController => {
  const container = document.createElement("section");
  container.className = "relative flex flex-1";

  const poiDebugEnabled = readPoiDebugEnabled();
  const poiDebugLog = (event: string, details?: Record<string, unknown>) => {
    if (!poiDebugEnabled) return;
    if (!MINIMAL_POI_DEBUG_EVENTS.has(event)) return;
    if (details) {
      console.log(`[poi-debug] ${event}`, details);
      return;
    }
    console.log(`[poi-debug] ${event}`);
  };

  const mapNode = document.createElement("div");
  mapNode.className = "absolute inset-0";
  container.appendChild(mapNode);

  let selectedCategory: string | null = null;
  let extremasVisible = getDomainDefaults().defaultExtremasVisible;
  const categoryChips = createCategoryChips({
    isMobile,
    onChange: (categoryId) => {
      hideStatExtremaArrows();
      selectedCategory = categoryId;
      applyData();
      refreshStatVisuals();
      if (typeof onCategorySelectionChange === 'function') {
        onCategorySelectionChange(selectedCategory);
      }
    },
    onStatChange: (statId) => {
      hideStatExtremaArrows();
      selectedStatId = statId;
      secondaryStatId = null;
      categoryChips.setSecondaryStat(null);
      syncStatDataStoreFocus();
      if (!selectedStatId) {
        try { updateStatDataChoropleth(); } catch {}
        try { map.triggerRepaint(); } catch {}
      }
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
    onExtremasToggle: () => {
      extremasVisible = !extremasVisible;
      try { categoryChips.setExtremasVisible(extremasVisible); } catch {}
      if (extremasVisible) {
        refreshStatVisuals();
      } else {
        hideStatExtremaArrows();
        syncHoverPillsForAreaHover();
      }
    },
    onTimeChipClick: () => { try { onTimeChipClick?.(); } catch {} },
    onTimeChipClear: () => { try { onTimeChipClear?.(); } catch {} },
    onAreasModeChange: (mode) => {
      if (mode !== "auto") {
        setBoundaryMode(mode);
      } else {
        const zoom = map.getZoom();
        const nextMode = zoom <= COUNTY_MODE_ENABLE_ZOOM ? "counties" : "zips";
        setBoundaryMode(nextMode);
      }
      onAreasModeChange?.(mode);
    },
    onSidebarExpand: () => { try { onSidebarExpand?.(); } catch {} },
    onSearch: (query) => {
      try { onLocationSearch?.(query); } catch {}
    },
  });
  container.appendChild(categoryChips.element);
  categoryChips.setAreasMode(initialAreasMode);
  categoryChips.setExtremasVisible(extremasVisible);

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
  let hoveredZipPreviewFromMap: string | null = null;
  let hoveredZipPreviewTrailFromMap: string | null = null;
  let hoveredZipPreviewTrailTimer: ReturnType<typeof setTimeout> | null = null;
  let hoveredZipFromPill: string | null = null;
  let hoveredZipPillArea: string | null = null;
  let hoveredZipPillKey: string | null = null;
  let pinnedCounties = new Set<string>();
  let transientCounties = new Set<string>();
  let hoveredCountyFromToolbar: string | null = null;
  let hoveredCountyFromMap: string | null = null;
  let hoveredCountyPreviewFromMap: string | null = null;
  let hoveredCountyPreviewTrailFromMap: string | null = null;
  let hoveredCountyPreviewTrailTimer: ReturnType<typeof setTimeout> | null = null;
  let hoveredCountyFromPill: string | null = null;
  let hoveredCountyPillArea: string | null = null;
  let hoveredCountyPillKey: string | null = null;
  const HOVER_PREVIEW_TRAIL_MS = 120;
  let cancelZipBoundaryLeaveClear: (() => void) | null = null;
  let cancelCountyBoundaryLeaveClear: (() => void) | null = null;
  // Stopgap for React hover echo races: queue map-origin hover commits by area id.
  // This avoids single-slot overwrite when React effects arrive out of order.
  type PendingMapHoverEcho = { count: number; lastQueuedAt: number };
  const MAP_HOVER_ECHO_WINDOW_MS = 1500;
  const pendingMapZipHoverEchoCounts = new Map<string, PendingMapHoverEcho>();
  const pendingMapCountyHoverEchoCounts = new Map<string, PendingMapHoverEcho>();
  const queuePendingMapHoverEcho = (pending: Map<string, PendingMapHoverEcho>, areaId: string) => {
    const now = performance.now();
    const current = pending.get(areaId);
    if (!current) {
      pending.set(areaId, { count: 1, lastQueuedAt: now });
      return;
    }
    pending.set(areaId, { count: current.count + 1, lastQueuedAt: now });
  };
  const consumePendingMapHoverEcho = (pending: Map<string, PendingMapHoverEcho>, areaId: string | null): boolean => {
    if (!areaId) return false;
    const current = pending.get(areaId);
    if (!current) return false;
    if (performance.now() - current.lastQueuedAt > MAP_HOVER_ECHO_WINDOW_MS) {
      pending.delete(areaId);
      return false;
    }
    if (current.count <= 1) pending.delete(areaId);
    else pending.set(areaId, { count: current.count - 1, lastQueuedAt: current.lastQueuedAt });
    return true;
  };
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
  let zipHoverPillsByArea = new Map<string, HoverStackPill[]>();
  let countyHoverPillsByArea = new Map<string, HoverStackPill[]>();
  let unsubscribeStatData: (() => void) | null = null;
  let unsubscribeStatDataState: (() => void) | null = null;
  let pointsOfInterestSnapshot: PointsOfInterestSnapshot = emptyPointsOfInterestSnapshot();
  let unsubscribePointsOfInterest: (() => void) | null = null;
  let lastPoiBuildSummary: {
    zipRows: number;
    countyRows: number;
    zipFeatures: number;
    countyFeatures: number;
    missingZipCentroids: number;
    missingCountyCentroids: number;
  } = {
    zipRows: 0,
    countyRows: 0,
    zipFeatures: 0,
    countyFeatures: 0,
    missingZipCentroids: 0,
    missingCountyCentroids: 0,
  };
  let statDataStoreState: Pick<StatDataStoreState, "isRefreshing" | "hasPendingRefresh"> = {
    isRefreshing: false,
    hasPendingRefresh: false,
  };
  let isTileLoading = true;
  let isStatDataLoading = false;
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

  const getExtremeAreaIds = (
    data: Record<string, number> | undefined,
  ): { highestId: string | null; lowestId: string | null } => {
    if (!data) return { highestId: null, lowestId: null };
    const entries = Object.entries(data)
      .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
      .sort(([a], [b]) => a.localeCompare(b));
    if (entries.length === 0) return { highestId: null, lowestId: null };

    let highest = entries[0];
    let lowest = entries[0];
    for (const entry of entries) {
      if (entry[1] > highest[1]) highest = entry;
      if (entry[1] < lowest[1]) lowest = entry;
    }
    return { highestId: highest[0], lowestId: lowest[0] };
  };

  // Keep map spinner active until all loading sources (tiles + selected stat data) settle.
  const applyCompositeLoading = () => {
    loadingIndicator.setLoading(isTileLoading || isStatDataLoading);
  };

  const getRequiredBoundariesForLoading = (): BoundaryTypeKey[] => {
    if (boundaryMode === "zips") return ["ZIP"];
    if (boundaryMode === "counties") return ["COUNTY"];
    return [];
  };

  const hasStatDataForBoundary = (statId: string, boundary: BoundaryTypeKey): boolean => {
    const entry = getStatEntryByBoundary(statId, boundary);
    if (!entry) return false;
    return Object.keys(entry.data ?? {}).length > 0;
  };

  const isSecondaryLegendLoading = (): boolean => {
    const secId = secondaryStatId;
    if (!secId) return false;
    const requiredBoundaries = getRequiredBoundariesForLoading();
    if (requiredBoundaries.length === 0) return false;
    const secondaryMissing = requiredBoundaries.some(
      (boundary) => !hasStatDataForBoundary(secId, boundary),
    );
    const primaryId = selectedStatId;
    const primaryMissing = primaryId
      ? requiredBoundaries.some((boundary) => !hasStatDataForBoundary(primaryId, boundary))
      : false;
    const statStoreBusy = statDataStoreState.isRefreshing || statDataStoreState.hasPendingRefresh;
    return statStoreBusy && (secondaryMissing || primaryMissing);
  };

  const recomputeStatDataLoading = () => {
    const requiredBoundaries = getRequiredBoundariesForLoading();
    const selectedStatIds = [selectedStatId, secondaryStatId].filter(
      (id): id is string => typeof id === "string" && id.trim().length > 0,
    );
    if (selectedStatIds.length === 0 || requiredBoundaries.length === 0) {
      isStatDataLoading = false;
      applyCompositeLoading();
      return;
    }

    const missingRequiredData = selectedStatIds.some((statId) =>
      requiredBoundaries.some((boundary) => !hasStatDataForBoundary(statId, boundary)),
    );
    const statStoreBusy = statDataStoreState.isRefreshing || statDataStoreState.hasPendingRefresh;
    isStatDataLoading = missingRequiredData && statStoreBusy;
    applyCompositeLoading();
  };

  // Coalesce multiple refreshStatVisuals calls into one frame
  let statVisualsScheduled = false;
  const refreshStatVisualsCore = () => {
    // Keep POI/extrema updates resilient even if a choropleth/legend step throws.
    try { updateStatDataChoropleth(); } catch {}
    try { updateChoroplethLegend(); } catch {}
    try { updateSecondaryStatOverlay(); } catch {}
    try { updateSecondaryChoroplethLegend(); } catch {}
    try { updateStatExtremaArrows(); } catch {}

    const zipEntry = getStatEntryByBoundary(selectedStatId, "ZIP");
    zipLabels?.setStatOverlay(selectedStatId, zipEntry?.data || null, zipEntry?.type || "count");
    const secondaryEntry = getStatEntryByBoundary(secondaryStatId, "ZIP");
    zipLabels?.setSecondaryStatOverlay?.(secondaryStatId, secondaryEntry?.data || null, secondaryEntry?.type || "count");
    const countyEntry = getStatEntryByBoundary(selectedStatId, "COUNTY");
    countyLabels?.setStatOverlay(selectedStatId, countyEntry?.data || null, countyEntry?.type || "count");
    const countySecondary = getStatEntryByBoundary(secondaryStatId, "COUNTY");
    countyLabels?.setSecondaryStatOverlay?.(secondaryStatId, countySecondary?.data || null, countySecondary?.type || "count");
    recomputeStatDataLoading();
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
    recomputeStatDataLoading();

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

  if (poiDebugEnabled && typeof window !== "undefined") {
    (window as any).__poiDebugSnapshot = () => ({
      zoom: Number(map.getZoom().toFixed(2)),
      boundaryMode,
      selectedStatId,
      selectedCategory,
      zipGeometryHiddenDueToZoom,
      loadedZctas: getLoadedZctaCount(ZCTA_STATE),
      zipPoiScopeMode: boundaryMode === "zips" ? "tulsa_area+okc_area" : "n/a",
      poiRowsZip: getZipPoiRowsForCurrentView().length,
      poiRowsZipAllScopes: getPointsOfInterestRows(pointsOfInterestSnapshot, "ZIP", selectedCategory).length,
      poiRowsCounty: getPointsOfInterestRows(pointsOfInterestSnapshot, "COUNTY", selectedCategory).length,
      poiHintsCached: poiZipChunkHints.size,
      lastEnsuredPoiZipChunkKey,
      lastPoiBuildSummary,
      poiLayerDiagnostics: getPoiLayerDiagnostics(),
    });
    poiDebugLog("enabled", {
      hint: "Use window.__poiDebugSnapshot() in devtools for current POI state",
    });
  }

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

  let orgHoverTooltipEl: HTMLDivElement | null = null;
  let orgHoverTooltipRaf: number | null = null;
  let orgHoverTooltipVisible = false;
  const tooltipTransform = (offsetPx: number): string => `translate(-50%, calc(-100% - ${offsetPx}px))`;
  const tooltipPrimaryColor = () => (currentTheme === "light" ? "#64748b" : "#cbd5e1");
  const tooltipSecondaryColor = () => (currentTheme === "light" ? "#a4afbf" : "#94a3b8");
  const getOrCreateOrgHoverTooltip = (): HTMLDivElement => {
    if (orgHoverTooltipEl) return orgHoverTooltipEl;
    const el = document.createElement("div");
    // Keep this below map chips/dropdowns while still floating above map geometry.
    el.className = "pointer-events-none absolute z-[9] rounded-2xl px-2.5 py-1 text-[11px] font-medium shadow-sm";
    el.style.left = "0";
    el.style.top = "0";
    el.style.maxWidth = `${ORG_HOVER_TOOLTIP_MAX_WIDTH_CH}ch`;
    el.style.whiteSpace = "normal";
    el.style.overflowWrap = "break-word";
    el.style.wordBreak = "normal";
    el.style.textAlign = "center";
    el.style.opacity = "0";
    el.style.transform = tooltipTransform(ORG_HOVER_TOOLTIP_Y_OFFSET_PX - ORG_HOVER_TOOLTIP_ENTER_OFFSET_PX);
    el.style.willChange = "opacity, transform";
    el.style.transition = `opacity ${ORG_HOVER_TOOLTIP_FADE_MS}ms ease-out, transform ${ORG_HOVER_TOOLTIP_ENTER_TRANSFORM_MS}ms ${ORG_HOVER_TOOLTIP_ENTER_EASE}`;
    map.getContainer().appendChild(el);
    orgHoverTooltipEl = el;
    return el;
  };
  const syncOrgHoverTooltipTheme = () => {
    if (!orgHoverTooltipEl) return;
    if (currentTheme === "light") {
      orgHoverTooltipEl.style.backgroundColor = "rgba(255, 255, 255, 0.87)";
      orgHoverTooltipEl.style.border = "1px solid rgba(203, 213, 225, 0.8)";
      orgHoverTooltipEl.style.color = tooltipPrimaryColor();
      return;
    }
    orgHoverTooltipEl.style.backgroundColor = "rgba(15, 23, 42, 0.86)";
    orgHoverTooltipEl.style.border = "1px solid rgba(100, 116, 139, 0.55)";
    orgHoverTooltipEl.style.color = tooltipPrimaryColor();
  };
  const hideOrgHoverTooltip = () => {
    if (!orgHoverTooltipEl) return;
    orgHoverTooltipVisible = false;
    if (orgHoverTooltipRaf !== null) {
      cancelAnimationFrame(orgHoverTooltipRaf);
      orgHoverTooltipRaf = null;
    }
    orgHoverTooltipEl.style.opacity = "0";
    orgHoverTooltipEl.style.transform = tooltipTransform(ORG_HOVER_TOOLTIP_Y_OFFSET_PX - ORG_HOVER_TOOLTIP_ENTER_OFFSET_PX);
  };
  const showOrgHoverTooltip = (
    name: string,
    x: number,
    y: number,
    annualRevenue?: number | null,
    annualRevenueTaxPeriod?: number | null,
  ): boolean => {
    if (isMobile) return false;
    const label = name.trim();
    if (!label) return false;
    const displayLabel = preventTrailingWordOrphan(label);
    const tooltip = getOrCreateOrgHoverTooltip();
    syncOrgHoverTooltipTheme();
    tooltip.replaceChildren();
    const nameLine = document.createElement("div");
    nameLine.textContent = displayLabel;
    nameLine.style.lineHeight = "1.2";
    nameLine.style.color = tooltipPrimaryColor();
    tooltip.appendChild(nameLine);
    const revenueLine = formatOrgRevenueLine(annualRevenue, annualRevenueTaxPeriod);
    if (revenueLine) {
      const revenueEl = document.createElement("div");
      revenueEl.textContent = revenueLine;
      revenueEl.style.marginTop = "2px";
      revenueEl.style.fontSize = "10px";
      revenueEl.style.fontWeight = "500";
      revenueEl.style.lineHeight = "1.2";
      revenueEl.style.color = tooltipSecondaryColor();
      tooltip.appendChild(revenueEl);
    }
    tooltip.title = label;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
    if (!orgHoverTooltipVisible) {
      tooltip.style.opacity = "0";
      tooltip.style.transform = tooltipTransform(ORG_HOVER_TOOLTIP_Y_OFFSET_PX - ORG_HOVER_TOOLTIP_ENTER_OFFSET_PX);
      if (orgHoverTooltipRaf !== null) {
        cancelAnimationFrame(orgHoverTooltipRaf);
      }
      orgHoverTooltipRaf = requestAnimationFrame(() => {
        orgHoverTooltipRaf = null;
        if (!orgHoverTooltipEl) return;
        orgHoverTooltipEl.style.opacity = "1";
        orgHoverTooltipEl.style.transform = tooltipTransform(ORG_HOVER_TOOLTIP_Y_OFFSET_PX);
      });
    } else {
      tooltip.style.opacity = "1";
      tooltip.style.transform = tooltipTransform(ORG_HOVER_TOOLTIP_Y_OFFSET_PX);
    }
    orgHoverTooltipVisible = true;
    return true;
  };

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
  let lastEnsuredPoiZipChunkKey = "";
  // Cache ZIP->chunk mappings learned while chunks are loaded so POI ZIP chunks
  // can be re-requested after prune/unload cycles.
  const poiZipChunkHints = new Map<string, string>();
  
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
    poiDebugLog("zcta-ensure-start", {
      zoom: Number(zoom.toFixed(2)),
      force,
      boundaryMode,
      loadedZctas: getLoadedZctaCount(ZCTA_STATE),
    });
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
    if (requestId !== zctaUpdateToken) {
      poiDebugLog("zcta-ensure-stale-request", {
        requestId,
        currentToken: zctaUpdateToken,
      });
      return;
    }
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
    poiDebugLog("zcta-ensure-post-prune", {
      zoom: Number(zoom.toFixed(2)),
      force,
      keepChunkCount: keepChunkIds.size,
      neighborCountyIds,
      activeZipParentCountyId,
      loadedZctas: getLoadedZctaCount(ZCTA_STATE),
    });

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
    // Rebuild ZIP-dependent overlays (including no-stat POI extrema) once new chunks land.
    refreshStatVisuals();
    poiDebugLog("zcta-ensure-complete", {
      zoom: Number(map.getZoom().toFixed(2)),
      loadedZctas: getLoadedZctaCount(ZCTA_STATE),
    });
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
  const statGoodIfUpById = new Map<string, boolean | null>();
  const unsubscribeStats = statsStore.subscribe((stats) => {
    statNameById.clear();
    statGoodIfUpById.clear();
    for (const s of stats) {
      statNameById.set(s.id, s.label || s.name);
      statGoodIfUpById.set(s.id, typeof s.goodIfUp === "boolean" ? s.goodIfUp : null);
    }
    refreshStatVisuals();
  });
  destroyFns.push(() => {
    try { unsubscribeStats?.(); } catch {}
  });

  // Helper to attach a small overlay label inside a pill
  const attachLegendMessage = (
    pillEl: HTMLElement,
    onClear?: () => void,
    textColorClasses = "text-brand-700 dark:text-brand-300",
  ) => {
    pillEl.style.position = pillEl.style.position || "relative";
    const msg = document.createElement("div");
    msg.className = [
      "pointer-events-none absolute inset-0 flex items-center",
      isMobile && onClear ? "pl-1 pr-1" : "px-2",
      `text-[10px] leading-tight ${textColorClasses}`,
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
    hideStatExtremaArrows();
    selectedStatId = null;
    categoryChips.setSelectedStat(null);
    secondaryStatId = null;
    categoryChips.setSecondaryStat(null);
    syncStatDataStoreFocus();
    try { updateStatDataChoropleth(); } catch {}
    try { map.triggerRepaint(); } catch {}
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
  const secondaryMsg = attachLegendMessage(
    secondaryChoroplethLegend.pill,
    isMobile ? clearSecondaryStat : undefined,
    "text-[#2b8698] dark:text-[#7f9ea7]",
  );

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

  const findOppositeHoverPill = (
    rowsByArea: Map<string, HoverStackPill[]>,
    hoveredArea: string | null,
    hoveredPillKey: string | null,
  ): Map<string, HoverStackPill[]> => {
    if (!hoveredArea || !hoveredPillKey) return new Map();
    const sourceRows = rowsByArea.get(hoveredArea) ?? [];
    const sourceRow = sourceRows.find((row) => row.key === hoveredPillKey);
    if (!sourceRow?.pairKey) return new Map();
    const targetDirection: "up" | "down" = sourceRow.direction === "up" ? "down" : "up";

    for (const [area, rows] of rowsByArea.entries()) {
      if (area === hoveredArea) continue;
      const opposite = rows.find(
        (row) => row.pairKey === sourceRow.pairKey && row.direction === targetDirection,
      );
      if (!opposite) continue;
      return new Map([[area, [opposite]]]);
    }
    return new Map();
  };

  const syncLinkedExtremaHoverLabels = () => {
    if (!zipLabels || !countyLabels) return;
    zipLabels.setLinkedHoverPillsByArea(
      findOppositeHoverPill(zipHoverPillsByArea, hoveredZipPillArea, hoveredZipPillKey),
    );
    countyLabels.setLinkedHoverPillsByArea(
      findOppositeHoverPill(countyHoverPillsByArea, hoveredCountyPillArea, hoveredCountyPillKey),
    );
  };

  const clearZipPreviewTrailTimer = () => {
    if (hoveredZipPreviewTrailTimer !== null) {
      clearTimeout(hoveredZipPreviewTrailTimer);
      hoveredZipPreviewTrailTimer = null;
    }
  };

  const clearCountyPreviewTrailTimer = () => {
    if (hoveredCountyPreviewTrailTimer !== null) {
      clearTimeout(hoveredCountyPreviewTrailTimer);
      hoveredCountyPreviewTrailTimer = null;
    }
  };

  const clearZipPreviewHover = () => {
    clearZipPreviewTrailTimer();
    hoveredZipPreviewFromMap = null;
    hoveredZipPreviewTrailFromMap = null;
  };

  const clearCountyPreviewHover = () => {
    clearCountyPreviewTrailTimer();
    hoveredCountyPreviewFromMap = null;
    hoveredCountyPreviewTrailFromMap = null;
  };

  const setZipPreviewHover = (zip: string): boolean => {
    if (zip === hoveredZipPreviewFromMap) return false;
    clearZipPreviewTrailTimer();
    const previous = hoveredZipPreviewFromMap;
    hoveredZipPreviewFromMap = zip;
    hoveredZipPreviewTrailFromMap = null;
    if (previous && previous !== zip) {
      hoveredZipPreviewTrailFromMap = previous;
      hoveredZipPreviewTrailTimer = setTimeout(() => {
        hoveredZipPreviewTrailTimer = null;
        hoveredZipPreviewTrailFromMap = null;
        zipSelection.updateHover();
      }, HOVER_PREVIEW_TRAIL_MS);
    }
    return true;
  };

  const setCountyPreviewHover = (county: string): boolean => {
    if (county === hoveredCountyPreviewFromMap) return false;
    clearCountyPreviewTrailTimer();
    const previous = hoveredCountyPreviewFromMap;
    hoveredCountyPreviewFromMap = county;
    hoveredCountyPreviewTrailFromMap = null;
    if (previous && previous !== county) {
      hoveredCountyPreviewTrailFromMap = previous;
      hoveredCountyPreviewTrailTimer = setTimeout(() => {
        hoveredCountyPreviewTrailTimer = null;
        hoveredCountyPreviewTrailFromMap = null;
        countySelection.updateHover();
      }, HOVER_PREVIEW_TRAIL_MS);
    }
    return true;
  };

  const updateZipHoverOutline = () => {
    const hovered = hoveredZipFromToolbar || hoveredZipFromPill || hoveredZipFromMap;
    const visualHovered = hovered || hoveredZipPreviewFromMap;
    // Keep map-origin committed hover on the same lightweight fill style as
    // traversal preview to avoid a second overlay jump when dwell labels appear.
    const mapCommittedHoverOnly = Boolean(hoveredZipFromMap && !hoveredZipFromToolbar && !hoveredZipFromPill);
    const previewOnly = Boolean(visualHovered) && (!hovered || mapCommittedHoverOnly);
    if (!hovered || hoveredZipPillArea !== hovered) {
      hoveredZipPillArea = null;
      hoveredZipPillKey = null;
    }
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
  }, currentTheme, selectedStatId, pinnedZips, transientZips, visualHovered || null, {
    previewOnly,
    trailingZipId: previewOnly ? hoveredZipPreviewTrailFromMap : null,
  });
    zipLabels?.setHoveredZip(hovered || null);
    syncLinkedExtremaHoverLabels();
    
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
      // Keep base secondary dots in sync during hover transitions in case a
      // zoom/scope update landed between scheduled visual refreshes.
      updateSecondaryStatOverlay();
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
    const hovered = hoveredCountyFromToolbar || hoveredCountyFromPill || hoveredCountyFromMap;
    const visualHovered = hovered || hoveredCountyPreviewFromMap;
    // Match ZIP behavior: map dwell should not introduce a second stronger fill.
    const mapCommittedHoverOnly = Boolean(hoveredCountyFromMap && !hoveredCountyFromToolbar && !hoveredCountyFromPill);
    const previewOnly = Boolean(visualHovered) && (!hovered || mapCommittedHoverOnly);
    if (!hovered || hoveredCountyPillArea !== hovered) {
      hoveredCountyPillArea = null;
      hoveredCountyPillKey = null;
    }
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
  }, currentTheme, selectedStatId, pinnedCounties, transientCounties, visualHovered, {
    previewOnly,
    trailingCountyId: previewOnly ? hoveredCountyPreviewTrailFromMap : null,
  });
    syncLinkedExtremaHoverLabels();
    
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
      // Keep base secondary dots in sync during hover transitions in case a
      // zoom/scope update landed between scheduled visual refreshes.
      updateSecondaryStatOverlay();
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
      poiDebugLog("boundary-eval-skipped-auto-disabled", {
        zoom: Number(map.getZoom().toFixed(2)),
        boundaryMode,
      });
      return;
    }
    if (boundaryMode === "none") return;
    const zoom = map.getZoom();
    const before = boundaryMode;
    if (boundaryMode === "zips" && zoom <= COUNTY_MODE_ENABLE_ZOOM) {
      setBoundaryMode("counties");
    } else if (boundaryMode === "counties" && zoom >= COUNTY_MODE_DISABLE_ZOOM) {
      setBoundaryMode("zips");
    }
    poiDebugLog("boundary-eval", {
      zoom: Number(zoom.toFixed(2)),
      before,
      after: boundaryMode,
    });
  };

  map.on("zoomend", evaluateBoundaryModeForZoom);
  map.on("moveend", evaluateBoundaryModeForZoom);
  destroyFns.push(() => {
    map.off("zoomend", evaluateBoundaryModeForZoom);
    map.off("moveend", evaluateBoundaryModeForZoom);
  });

  const syncExtremaLayersOnZoomEnd = () => {
    // Extra safety net: keep POI/stat extrema visibility in sync after zoom cycles.
    updateStatExtremaArrows();
  };
  map.on("zoomend", syncExtremaLayersOnZoomEnd);
  destroyFns.push(() => {
    map.off("zoomend", syncExtremaLayersOnZoomEnd);
  });

  const handleZipGeometryVisibilityChange = () => {
    const didChange = updateBoundaryVisibility();
    if (!didChange) return;
    applyLabelVisibility();
    if (zipGeometryHiddenDueToZoom) {
      hideStatExtremaArrows();
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

  const poiIconForRow = (goodIfUp: boolean | null, extremaKind: ExtremaKind): string => {
    if (goodIfUp === true) {
      return extremaKind === "high" ? STAT_EXTREME_GOOD_ICON_ID : STAT_EXTREME_BAD_ICON_ID;
    }
    if (goodIfUp === false) {
      return extremaKind === "high" ? STAT_EXTREME_BAD_ICON_ID : STAT_EXTREME_GOOD_ICON_ID;
    }
    return STAT_EXTREME_NEUTRAL_ICON_ID;
  };

  const getPoiToneForRow = (goodIfUp: boolean | null, extremaKind: ExtremaKind): HoverStackPill["tone"] => {
    if (goodIfUp === true) return extremaKind === "high" ? "good" : "bad";
    if (goodIfUp === false) return extremaKind === "high" ? "bad" : "good";
    return "neutral";
  };

  const compactScopeLabel = (value: string | null | undefined): string | undefined => {
    const normalized = normalizeScopeLabel(value);
    if (!normalized) return undefined;
    if (normalized === "Oklahoma") return "OK";
    if (normalized === "Oklahoma City") return "OKC";
    return normalized.replace(/\s+County$/i, "").trim();
  };

  const poiScopeLabel = (scopeKey: PointOfInterestScopeKey | null | undefined): string | undefined => {
    if (scopeKey === "oklahoma") return "OK";
    if (scopeKey === "okc_area") return "OKC";
    if (scopeKey === "tulsa_area") return "Tulsa";
    return undefined;
  };

  // Derive the ExtremaTone ("good"|"bad"|"neutral") used for combined icon IDs.
  const poiExtremaTone = (goodIfUp: boolean | null, extremaKind: ExtremaKind): ExtremaTone => {
    if (goodIfUp === true) return extremaKind === "high" ? "good" : "bad";
    if (goodIfUp === false) return extremaKind === "high" ? "bad" : "good";
    return "neutral";
  };

  const getSelectedStatZipPoiRowsForCurrentScope = () => {
    if (!selectedStatId) return [];
    const zipRows = getPointsOfInterestRows(pointsOfInterestSnapshot, "ZIP", selectedCategory).filter(
      (row) => row.scopeKey === "tulsa_area" || row.scopeKey === "okc_area",
    );
    return zipRows.filter((row) => row.statId === selectedStatId);
  };

  const getSelectedStatCountyPoiRowsForCurrentScope = () => {
    if (!selectedStatId) return [];
    const countyRowsAll = getPointsOfInterestRows(pointsOfInterestSnapshot, "COUNTY", selectedCategory);
    const countyRows = boundaryMode === "counties"
      ? countyRowsAll.filter((row) => row.scopeKey === "oklahoma")
      : countyRowsAll;
    return countyRows.filter((row) => row.statId === selectedStatId);
  };

  const getZipPoiRowsForCurrentView = () => {
    const allRows = getPointsOfInterestRows(pointsOfInterestSnapshot, "ZIP", selectedCategory);
    if (boundaryMode !== "zips") return [];
    // At ZIP level, always show city-scope extrema (Tulsa + OKC).
    // Statewide ZIP extrema remain hidden to reduce noise at city zoom.
    const zipRows = allRows.filter(
      (row) => row.scopeKey === "tulsa_area" || row.scopeKey === "okc_area",
    );
    if (!selectedStatId) return zipRows;

    // When a stat is selected and has POI rows, show only that stat's POIs at city scope.
    const selectedRows = getSelectedStatZipPoiRowsForCurrentScope();
    if (selectedRows.length > 0) return selectedRows;
    return isPopulationLikeSelectedStat() || POI_VISIBLE_WITH_SELECTED_STAT_IDS.has(selectedStatId)
      ? zipRows
      : [];
  };

  const getCountyPoiRowsForCurrentView = () => {
    const countyRowsAll = getPointsOfInterestRows(pointsOfInterestSnapshot, "COUNTY", selectedCategory);
    const countyRows = boundaryMode === "counties"
      ? countyRowsAll.filter((row) => row.scopeKey === "oklahoma")
      : countyRowsAll;
    if (!selectedStatId) return countyRows;

    // Keep county POIs aligned with the selected-stat-only behavior when possible.
    const selectedRows = getSelectedStatCountyPoiRowsForCurrentScope();
    if (selectedRows.length > 0) return selectedRows;
    return isPopulationLikeSelectedStat() || POI_VISIBLE_WITH_SELECTED_STAT_IDS.has(selectedStatId)
      ? countyRows
      : [];
  };

  const selectedStatHasPoiRows = () => {
    if (!selectedStatId) return false;
    const zipRows = getPointsOfInterestRows(pointsOfInterestSnapshot, "ZIP", selectedCategory).filter(
      (row) => row.scopeKey === "tulsa_area" || row.scopeKey === "okc_area",
    );
    if (zipRows.some((row) => row.statId === selectedStatId)) return true;

    const countyRows = getPointsOfInterestRows(pointsOfInterestSnapshot, "COUNTY", selectedCategory);
    return countyRows.some((row) => row.statId === selectedStatId);
  };

  const isPopulationLikeSelectedStat = () => {
    if (!selectedStatId) return false;
    const statName = statNameById.get(selectedStatId);
    const normalized = typeof statName === "string" ? statName.trim().toLowerCase() : "";
    return normalized.length > 0 && normalized.includes("population");
  };

  const shouldShowPoiWithSelectedStat = () => {
    if (!selectedStatId) return false;
    if (selectedStatHasPoiRows()) return true;
    if (POI_VISIBLE_WITH_SELECTED_STAT_IDS.has(selectedStatId)) return true;
    return isPopulationLikeSelectedStat();
  };

  const shouldRenderPointsOfInterest = () =>
    extremasVisible && (!selectedStatId || shouldShowPoiWithSelectedStat());

  const setPoiLayerState = (layerId: string, visible: boolean) => {
    if (!map.getLayer(layerId)) return;
    map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
    map.setPaintProperty(layerId, "icon-opacity", visible ? 1 : 0);
    try { map.triggerRepaint(); } catch {}
  };

  const getPoiVisibilityState = () => {
    const zoom = map.getZoom();
    return {
      showZipPoiLayers: boundaryMode === "zips" || zoom >= COUNTY_MODE_DISABLE_ZOOM,
      showCountyPoiLayers: boundaryMode === "counties" && zoom < COUNTY_MODE_DISABLE_ZOOM,
    };
  };

  const applyPoiLayerVisibility = (showZipPoiLayers: boolean, showCountyPoiLayers: boolean) => {
    setPoiLayerState(ZIP_POI_EXTREME_HIGH_LAYER_ID, showZipPoiLayers);
    setPoiLayerState(ZIP_POI_EXTREME_LOW_LAYER_ID, showZipPoiLayers);
    setPoiLayerState(ZIP_POI_COMBINED_LAYER_ID, showZipPoiLayers);
    setPoiLayerState(COUNTY_POI_EXTREME_HIGH_LAYER_ID, showCountyPoiLayers);
    setPoiLayerState(COUNTY_POI_EXTREME_LOW_LAYER_ID, showCountyPoiLayers);
    setPoiLayerState(COUNTY_POI_COMBINED_LAYER_ID, showCountyPoiLayers);
  };

  const buildHoverPillsByArea = (): {
    zipByArea: Map<string, HoverStackPill[]>;
    countyByArea: Map<string, HoverStackPill[]>;
  } => {
    const zipByArea = new Map<string, HoverStackPill[]>();
    const countyByArea = new Map<string, HoverStackPill[]>();
    if (!extremasVisible) {
      return { zipByArea, countyByArea };
    }

    const countyCentroids = getCountyCentroidsMap();
    const appendPill = (
      areaCode: string,
      targetMap: Map<string, HoverStackPill[]>,
      pill: HoverStackPill,
    ) => {
      const rows = targetMap.get(areaCode) ?? [];
      if (rows.some((row) => row.key === pill.key)) return;
      rows.push(pill);
      targetMap.set(areaCode, rows);
    };

    const appendPoiRows = (
      rows: ReturnType<typeof getZipPoiRowsForCurrentView>,
      boundaryType: "ZIP" | "COUNTY",
      targetMap: Map<string, HoverStackPill[]>,
    ) => {
      const seenKeys = new Set<string>();
      for (const row of rows) {
        if (seenKeys.has(row.poiKey)) continue;
        seenKeys.add(row.poiKey);

        const hasCentroid = boundaryType === "ZIP"
          ? Boolean(getZctaCentroid(ZCTA_STATE, row.areaCode))
          : Boolean(countyCentroids.get(row.areaCode));
        if (!hasCentroid) continue;

        const label = row.statName || statNameById.get(row.statId) || row.statCategory || "Stat";
        appendPill(row.areaCode, targetMap, {
          key: row.poiKey,
          label,
          tone: getPoiToneForRow(row.goodIfUp, row.extremaKind),
          direction: row.extremaKind === "high" ? "up" : "down",
          statId: row.statId,
          pairKey: `poi:${boundaryType}:${row.statId}:${row.scopeKey ?? "none"}`,
          scopeLabel: poiScopeLabel(row.scopeKey),
        });
      }
    };

    if (shouldRenderPointsOfInterest()) {
      const zipRows = getZipPoiRowsForCurrentView();
      const countyRows = getCountyPoiRowsForCurrentView();
      appendPoiRows(zipRows, "ZIP", zipByArea);
      appendPoiRows(countyRows, "COUNTY", countyByArea);
    }

    if (selectedStatId) {
      const selectedStatLabel = statNameById.get(selectedStatId) || "Stat";
      const selectedStatGoodIfUp = statGoodIfUpById.get(selectedStatId) ?? null;
      const selectedZipPoiRows = getSelectedStatZipPoiRowsForCurrentScope();
      const selectedCountyPoiRows = getSelectedStatCountyPoiRowsForCurrentScope();
      const selectedZipScopeLabel = compactScopeLabel(activeZipParentArea) ?? "OK";
      const selectedCountyScopeLabel = "OK";
      const zoom = map.getZoom();
      const hideZip = boundaryMode === "zips" && zoom >= CHOROPLETH_HIDE_ZOOM;
      const showZipStatExtrema = boundaryMode === "zips" && !hideZip;
      const showCountyStatExtrema = boundaryMode === "counties" && zoom < COUNTY_MODE_DISABLE_ZOOM;

      const zipEntry = getStatEntryByBoundary(selectedStatId, "ZIP");
      const countyEntry = getStatEntryByBoundary(selectedStatId, "COUNTY");
      const zipExtremes = getExtremeAreaIds(zipEntry?.data);
      const countyExtremes = getExtremeAreaIds(countyEntry?.data);

      if (showZipStatExtrema && selectedZipPoiRows.length === 0) {
        if (zipExtremes.highestId) {
          appendPill(zipExtremes.highestId, zipByArea, {
            key: `stat:${selectedStatId}:zip:high`,
            label: selectedStatLabel,
            tone: getPoiToneForRow(selectedStatGoodIfUp, "high"),
            direction: "up",
            statId: selectedStatId,
            pairKey: `stat:${selectedStatId}:ZIP`,
            scopeLabel: selectedZipScopeLabel,
          });
        }
        if (zipExtremes.lowestId && zipExtremes.lowestId !== zipExtremes.highestId) {
          appendPill(zipExtremes.lowestId, zipByArea, {
            key: `stat:${selectedStatId}:zip:low`,
            label: selectedStatLabel,
            tone: getPoiToneForRow(selectedStatGoodIfUp, "low"),
            direction: "down",
            statId: selectedStatId,
            pairKey: `stat:${selectedStatId}:ZIP`,
            scopeLabel: selectedZipScopeLabel,
          });
        }
      }

      if (showCountyStatExtrema && selectedCountyPoiRows.length === 0) {
        if (countyExtremes.highestId) {
          appendPill(countyExtremes.highestId, countyByArea, {
            key: `stat:${selectedStatId}:county:high`,
            label: selectedStatLabel,
            tone: getPoiToneForRow(selectedStatGoodIfUp, "high"),
            direction: "up",
            statId: selectedStatId,
            pairKey: `stat:${selectedStatId}:COUNTY`,
            scopeLabel: selectedCountyScopeLabel,
          });
        }
        if (countyExtremes.lowestId && countyExtremes.lowestId !== countyExtremes.highestId) {
          appendPill(countyExtremes.lowestId, countyByArea, {
            key: `stat:${selectedStatId}:county:low`,
            label: selectedStatLabel,
            tone: getPoiToneForRow(selectedStatGoodIfUp, "low"),
            direction: "down",
            statId: selectedStatId,
            pairKey: `stat:${selectedStatId}:COUNTY`,
            scopeLabel: selectedCountyScopeLabel,
          });
        }
      }
    }

    const sortRows = (rowsByArea: Map<string, HoverStackPill[]>) => {
      for (const rows of rowsByArea.values()) {
        rows.sort((a, b) => {
          if (a.direction !== b.direction) return a.direction === "up" ? -1 : 1;
          return a.label.localeCompare(b.label);
        });
      }
    };
    sortRows(zipByArea);
    sortRows(countyByArea);
    return { zipByArea, countyByArea };
  };

  const syncHoverPillsForAreaHover = () => {
    if (!zipLabels || !countyLabels) return;
    const { zipByArea, countyByArea } = buildHoverPillsByArea();
    zipHoverPillsByArea = zipByArea;
    countyHoverPillsByArea = countyByArea;
    zipLabels.setHoverPillsByArea(zipByArea);
    countyLabels.setHoverPillsByArea(countyByArea);
    syncLinkedExtremaHoverLabels();
  };

  let pendingPoiVisibilityRaf: number | null = null;
  const schedulePoiVisibilityReapply = () => {
    if (pendingPoiVisibilityRaf !== null) {
      cancelAnimationFrame(pendingPoiVisibilityRaf);
      pendingPoiVisibilityRaf = null;
    }
    pendingPoiVisibilityRaf = requestAnimationFrame(() => {
      pendingPoiVisibilityRaf = null;
      if (shouldRenderPointsOfInterest()) {
        const { showZipPoiLayers, showCountyPoiLayers } = getPoiVisibilityState();
        applyPoiLayerVisibility(showZipPoiLayers, showCountyPoiLayers);
      } else {
        applyPoiLayerVisibility(false, false);
      }
      try { map.triggerRepaint(); } catch {}
    });
  };

  const getPoiLayerDiagnostics = () => {
    const read = (layerId: string) => {
      if (!map.getLayer(layerId)) {
        return {
          present: false,
          visibility: "missing",
          opacity: null as number | null,
        };
      }
      const visibility = map.getLayoutProperty(layerId, "visibility");
      const opacity = map.getPaintProperty(layerId, "icon-opacity");
      return {
        present: true,
        visibility: typeof visibility === "string" ? visibility : String(visibility ?? "unknown"),
        opacity: typeof opacity === "number" ? opacity : null,
      };
    };
    return {
      zipHigh: read(ZIP_POI_EXTREME_HIGH_LAYER_ID),
      zipLow: read(ZIP_POI_EXTREME_LOW_LAYER_ID),
      countyHigh: read(COUNTY_POI_EXTREME_HIGH_LAYER_ID),
      countyLow: read(COUNTY_POI_EXTREME_LOW_LAYER_ID),
    };
  };

  const buildPointsOfInterestSourceData = (): PoiFeatureCollection => {
    if (!shouldRenderPointsOfInterest()) {
      lastPoiBuildSummary = {
        zipRows: 0,
        countyRows: 0,
        zipFeatures: 0,
        countyFeatures: 0,
        missingZipCentroids: 0,
        missingCountyCentroids: 0,
      };
      return emptyPoiFC();
    }

    const zipRows = getZipPoiRowsForCurrentView();
    const countyRows = getCountyPoiRowsForCurrentView();
    const countyCentroids = getCountyCentroidsMap();
    const features: PoiFeature[] = [];
    let zipFeatures = 0;
    let countyFeatures = 0;
    let missingZipCentroids = 0;
    let missingCountyCentroids = 0;

    const append = (rows: typeof zipRows, boundaryType: BoundaryTypeKey) => {
      // Group rows by areaCode so co-located extrema can be collapsed into one badge.
      const byArea = new Map<string, { high: typeof rows[0] | null; low: typeof rows[0] | null }>();
      for (const row of rows) {
        const entry = byArea.get(row.areaCode) ?? { high: null, low: null };
        if (row.extremaKind === "high" && !entry.high) entry.high = row;
        else if (row.extremaKind === "low" && !entry.low) entry.low = row;
        byArea.set(row.areaCode, entry);
      }

      for (const [areaCode, { high, low }] of byArea) {
        // ZIP centroids are chunk-loaded; skip rows whose centroids are not ready yet.
        const centroid =
          boundaryType === "ZIP"
            ? getZctaCentroid(ZCTA_STATE, areaCode)
            : countyCentroids.get(areaCode);
        if (!centroid) {
          if (boundaryType === "ZIP") missingZipCentroids += 1;
          else missingCountyCentroids += 1;
          continue;
        }
        if (boundaryType === "ZIP") zipFeatures += 1;
        else countyFeatures += 1;

        if (high && low) {
          // Both a high and a low extremum share this centroid — emit a single combined badge.
          const highTone = poiExtremaTone(high.goodIfUp, "high");
          const lowTone = poiExtremaTone(low.goodIfUp, "low");
          features.push({
            type: "Feature",
            properties: {
              poiKey: `${areaCode}::combined::${boundaryType}`,
              boundaryType,
              extremaKind: "combined",
              areaCode,
              statCategory: high.statCategory,
              iconId: statExtremeCombinedIconId(highTone, lowTone),
            },
            geometry: { type: "Point", coordinates: centroid },
          });
        } else {
          // Only one direction present — render the single triangle as before.
          const row = (high ?? low)!;
          features.push({
            type: "Feature",
            properties: {
              poiKey: row.poiKey,
              boundaryType,
              extremaKind: row.extremaKind,
              areaCode: row.areaCode,
              statCategory: row.statCategory,
              iconId: poiIconForRow(row.goodIfUp, row.extremaKind),
            },
            geometry: { type: "Point", coordinates: centroid },
          });
        }
      }
    };

    append(zipRows, "ZIP");
    append(countyRows, "COUNTY");
    lastPoiBuildSummary = {
      zipRows: zipRows.length,
      countyRows: countyRows.length,
      zipFeatures,
      countyFeatures,
      missingZipCentroids,
      missingCountyCentroids,
    };
    return { type: "FeatureCollection", features };
  };

  const updatePointsOfInterestSource = () => {
    const source = map.getSource(POINTS_OF_INTEREST_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const data = buildPointsOfInterestSourceData();
    source.setData(data);
    try { map.triggerRepaint(); } catch {}
    const zipLayerVisibility = map.getLayer(ZIP_POI_EXTREME_HIGH_LAYER_ID)
      ? map.getLayoutProperty(ZIP_POI_EXTREME_HIGH_LAYER_ID, "visibility")
      : "missing";
    const countyLayerVisibility = map.getLayer(COUNTY_POI_EXTREME_HIGH_LAYER_ID)
      ? map.getLayoutProperty(COUNTY_POI_EXTREME_HIGH_LAYER_ID, "visibility")
      : "missing";
    poiDebugLog("poi-source-updated", {
      zoom: Number(map.getZoom().toFixed(2)),
      boundaryMode,
      selectedStatId,
      selectedCategory,
      zipPoiScopeMode: boundaryMode === "zips" ? "tulsa_area+okc_area" : "n/a",
      zipRowsAllScopes: getPointsOfInterestRows(pointsOfInterestSnapshot, "ZIP", selectedCategory).length,
      sourceFeatures: data.features.length,
      ...lastPoiBuildSummary,
      zipLayerVisible: zipLayerVisibility,
      countyLayerVisible: countyLayerVisibility,
      loadedZctas: getLoadedZctaCount(ZCTA_STATE),
    });
  };

  const ensurePoiZipCentroidsLoaded = () => {
    if (!shouldRenderPointsOfInterest()) return;
    const rows = getZipPoiRowsForCurrentView();
    if (rows.length === 0) return;

    const chunkIdsSet = new Set<string>();
    const cityScopeCountyIds = new Set<string>();
    let missingCentroid = false;
    let withLiveChunk = 0;
    let withHintChunk = 0;
    let unresolvedChunk = 0;
    let withCentroid = 0;

    for (const row of rows) {
      const liveChunkId = getZctaChunkIdForZip(ZCTA_STATE, row.areaCode);
      if (row.scopeKey === "okc_area") cityScopeCountyIds.add(OKC_COUNTY_ID);
      if (row.scopeKey === "tulsa_area") cityScopeCountyIds.add(TULSA_COUNTY_ID);
      if (liveChunkId) {
        poiZipChunkHints.set(row.areaCode, liveChunkId);
        chunkIdsSet.add(liveChunkId);
        withLiveChunk += 1;
      } else {
        const hintedChunkId = poiZipChunkHints.get(row.areaCode);
        if (hintedChunkId) {
          chunkIdsSet.add(hintedChunkId);
          withHintChunk += 1;
        } else {
          unresolvedChunk += 1;
        }
      }
      if (!getZctaCentroid(ZCTA_STATE, row.areaCode)) {
        missingCentroid = true;
      } else {
        withCentroid += 1;
      }
    }

    // City-scope POIs should remain loadable from a cold cache:
    // include both core county chunks and immediate neighbor county chunks so
    // extrema that land in metro-adjacent ZIPs can render without a second zoom.
    for (const countyId of cityScopeCountyIds) {
      const countyIdsToEnsure = new Set<string>([countyId, ...getNeighborCountyIds(ZCTA_STATE, countyId)]);
      for (const cid of countyIdsToEnsure) {
        const countyChunkIds = getChunkIdsForCounty(ZCTA_STATE, cid);
        for (const chunkId of countyChunkIds) {
          chunkIdsSet.add(chunkId);
        }
      }
    }

    const chunkIds = Array.from(chunkIdsSet).sort();
    if (chunkIds.length === 0) {
      poiDebugLog("poi-zip-ensure-skipped-no-chunks", {
        rows: rows.length,
        withLiveChunk,
        withHintChunk,
        unresolvedChunk,
        withCentroid,
        missingCentroid,
        hintsCached: poiZipChunkHints.size,
        loadedZctas: getLoadedZctaCount(ZCTA_STATE),
      });
      return;
    }

    const key = chunkIds.join("|");
    // Re-ensure if centroids are missing, even if the chunk key is unchanged.
    if (key === lastEnsuredPoiZipChunkKey && !missingCentroid) {
      poiDebugLog("poi-zip-ensure-skipped-key-unchanged", {
        key,
        rows: rows.length,
        withLiveChunk,
        withHintChunk,
        unresolvedChunk,
        withCentroid,
        missingCentroid,
      });
      return;
    }
    lastEnsuredPoiZipChunkKey = key;
    poiDebugLog("poi-zip-ensure-start", {
      key,
      chunkIds,
      rows: rows.length,
      withLiveChunk,
      withHintChunk,
      unresolvedChunk,
      withCentroid,
      missingCentroid,
      loadedZctas: getLoadedZctaCount(ZCTA_STATE),
    });

    void ensureZctaChunks(ZCTA_STATE, chunkIds)
      .then(() => {
        syncZctaSource();
        refreshStatVisuals();
        poiDebugLog("poi-zip-ensure-complete", {
          key,
          chunkIds,
          loadedZctas: getLoadedZctaCount(ZCTA_STATE),
        });
      })
      .catch((error) => {
        console.warn("Failed to ensure ZIP chunks for POIs", error);
        poiDebugLog("poi-zip-ensure-error", {
          key,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  function hideStatExtremaArrows() {
    const hideLayer = (layerId: string, featureKey: "zip" | "county") => {
      if (!map.getLayer(layerId)) return;
      try { map.setFilter(layerId, ["==", ["get", featureKey], "__none__"] as any); } catch {}
      try { map.setPaintProperty(layerId, "icon-opacity", 0); } catch {}
      try { map.setLayoutProperty(layerId, "visibility", "none"); } catch {}
    };
    hideLayer(ZIP_STAT_EXTREME_HIGH_LAYER_ID, "zip");
    hideLayer(ZIP_STAT_EXTREME_LOW_LAYER_ID, "zip");
    hideLayer(COUNTY_STAT_EXTREME_HIGH_LAYER_ID, "county");
    hideLayer(COUNTY_STAT_EXTREME_LOW_LAYER_ID, "county");
    setPoiLayerState(ZIP_POI_EXTREME_HIGH_LAYER_ID, false);
    setPoiLayerState(ZIP_POI_EXTREME_LOW_LAYER_ID, false);
    setPoiLayerState(ZIP_POI_COMBINED_LAYER_ID, false);
    setPoiLayerState(COUNTY_POI_EXTREME_HIGH_LAYER_ID, false);
    setPoiLayerState(COUNTY_POI_EXTREME_LOW_LAYER_ID, false);
    setPoiLayerState(COUNTY_POI_COMBINED_LAYER_ID, false);
  }

  // Keep extrema indicators as MapLibre symbol layers so they stay centered during zoom/pan/style swaps.
  const ensureStatExtremaLayers = () => {
    const ensureImages = () => {
      const addArrowIcon = (id: string, color: string) => {
        if (map.hasImage(id)) return;
        const image = createStatExtremeArrowImage(color);
        if (!image) return;
        try {
          map.addImage(id, image, { pixelRatio: 2 });
        } catch {}
      };
      addArrowIcon(STAT_EXTREME_GOOD_ICON_ID, STAT_EXTREME_GOOD_COLOR);
      addArrowIcon(STAT_EXTREME_BAD_ICON_ID, STAT_EXTREME_BAD_COLOR);
      addArrowIcon(STAT_EXTREME_NEUTRAL_ICON_ID, STAT_EXTREME_NEUTRAL_COLOR);
    };
    ensureImages();

    const addExtremeLayer = (
      layerId: string,
      sourceId: string,
      featureKey: "zip" | "county",
      rotation: number,
      visible: boolean,
    ) => {
      if (map.getLayer(layerId)) return;
      const before = map.getLayer(LAYER_CLUSTERS_ID) ? LAYER_CLUSTERS_ID : undefined;
      const layer: any = {
        id: layerId,
        type: "symbol",
        source: sourceId,
        filter: ["==", ["get", featureKey], "__none__"] as any,
        layout: {
          visibility: visible ? "visible" : "none",
          "icon-image": STAT_EXTREME_GOOD_ICON_ID,
          "icon-size": STAT_EXTREME_ICON_SIZE,
          "icon-anchor": "center",
          "icon-rotate": rotation,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-opacity": 0,
        },
      };
      if (before) map.addLayer(layer, before);
      else map.addLayer(layer);
    };

    addExtremeLayer(
      ZIP_STAT_EXTREME_HIGH_LAYER_ID,
      ZIP_CENTROIDS_SOURCE_ID,
      "zip",
      0,
      boundaryMode === "zips" && !zipGeometryHiddenDueToZoom,
    );
    addExtremeLayer(
      ZIP_STAT_EXTREME_LOW_LAYER_ID,
      ZIP_CENTROIDS_SOURCE_ID,
      "zip",
      180,
      boundaryMode === "zips" && !zipGeometryHiddenDueToZoom,
    );
    addExtremeLayer(
      COUNTY_STAT_EXTREME_HIGH_LAYER_ID,
      COUNTY_CENTROIDS_SOURCE_ID,
      "county",
      0,
      boundaryMode === "counties",
    );
    addExtremeLayer(
      COUNTY_STAT_EXTREME_LOW_LAYER_ID,
      COUNTY_CENTROIDS_SOURCE_ID,
      "county",
      180,
      boundaryMode === "counties",
    );
  };

  const ensurePointsOfInterestLayers = () => {
    let addedLayer = false;
    if (!map.getSource(POINTS_OF_INTEREST_SOURCE_ID)) {
      map.addSource(POINTS_OF_INTEREST_SOURCE_ID, {
        type: "geojson",
        data: emptyPoiFC(),
      });
    }

    // Register the 9 combined icon variants (3 high tones × 3 low tones) the first time layers are set up.
    const toneColors: Record<ExtremaTone, string> = {
      good: STAT_EXTREME_GOOD_COLOR,
      bad: STAT_EXTREME_BAD_COLOR,
      neutral: STAT_EXTREME_NEUTRAL_COLOR,
    };
    for (const highTone of ["good", "bad", "neutral"] as ExtremaTone[]) {
      for (const lowTone of ["good", "bad", "neutral"] as ExtremaTone[]) {
        const id = statExtremeCombinedIconId(highTone, lowTone);
        if (!map.hasImage(id)) {
          const image = createStatExtremeCombinedImage(toneColors[highTone], toneColors[lowTone]);
          if (image) try { map.addImage(id, image, { pixelRatio: 2 }); } catch {}
        }
      }
    }

    const addPoiLayer = (
      layerId: string,
      boundaryType: BoundaryTypeKey,
      extremaKind: ExtremaKind,
      rotation: number,
      visible: boolean,
    ) => {
      if (map.getLayer(layerId)) return;
      addedLayer = true;
      const before = map.getLayer(LAYER_CLUSTERS_ID) ? LAYER_CLUSTERS_ID : undefined;
      const layer: any = {
        id: layerId,
        type: "symbol",
        source: POINTS_OF_INTEREST_SOURCE_ID,
        filter: [
          "all",
          ["==", ["get", "boundaryType"], boundaryType],
          ["==", ["get", "extremaKind"], extremaKind],
        ],
        layout: {
          visibility: visible ? "visible" : "none",
          "icon-image": ["coalesce", ["get", "iconId"], STAT_EXTREME_NEUTRAL_ICON_ID],
          "icon-size": STAT_EXTREME_ICON_SIZE,
          "icon-anchor": "center",
          "icon-rotate": rotation,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-opacity": visible ? 1 : 0,
        },
      };
      if (before) map.addLayer(layer, before);
      else map.addLayer(layer);
    };

    addPoiLayer(
      ZIP_POI_EXTREME_HIGH_LAYER_ID,
      "ZIP",
      "high",
      0,
      boundaryMode === "zips" && !zipGeometryHiddenDueToZoom,
    );
    addPoiLayer(
      ZIP_POI_EXTREME_LOW_LAYER_ID,
      "ZIP",
      "low",
      180,
      boundaryMode === "zips" && !zipGeometryHiddenDueToZoom,
    );
    addPoiLayer(
      COUNTY_POI_EXTREME_HIGH_LAYER_ID,
      "COUNTY",
      "high",
      0,
      boundaryMode === "counties",
    );
    addPoiLayer(
      COUNTY_POI_EXTREME_LOW_LAYER_ID,
      "COUNTY",
      "low",
      180,
      boundaryMode === "counties",
    );

    // Combined badge layers — no rotation since the icon already encodes both directions.
    const addCombinedPoiLayer = (layerId: string, boundaryType: BoundaryTypeKey, visible: boolean) => {
      if (map.getLayer(layerId)) return;
      addedLayer = true;
      const before = map.getLayer(LAYER_CLUSTERS_ID) ? LAYER_CLUSTERS_ID : undefined;
      const layer: any = {
        id: layerId,
        type: "symbol",
        source: POINTS_OF_INTEREST_SOURCE_ID,
        filter: [
          "all",
          ["==", ["get", "boundaryType"], boundaryType],
          ["==", ["get", "extremaKind"], "combined"],
        ],
        layout: {
          visibility: visible ? "visible" : "none",
          "icon-image": ["coalesce", ["get", "iconId"], statExtremeCombinedIconId("neutral", "neutral")],
          "icon-size": STAT_EXTREME_ICON_SIZE,
          "icon-anchor": "center",
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: {
          "icon-opacity": visible ? 1 : 0,
        },
      };
      if (before) map.addLayer(layer, before);
      else map.addLayer(layer);
    };

    addCombinedPoiLayer(
      ZIP_POI_COMBINED_LAYER_ID,
      "ZIP",
      boundaryMode === "zips" && !zipGeometryHiddenDueToZoom,
    );
    addCombinedPoiLayer(
      COUNTY_POI_COMBINED_LAYER_ID,
      "COUNTY",
      boundaryMode === "counties",
    );

    return addedLayer;
  };

  const updateStatExtremaArrows = () => {
    if (!extremasVisible) {
      hideStatExtremaArrows();
      syncHoverPillsForAreaHover();
      return;
    }
    const zoom = map.getZoom();
    const hideZip = boundaryMode === "zips" && zoom >= CHOROPLETH_HIDE_ZOOM;
    const showZipLayers = boundaryMode === "zips" && !hideZip;
    const { showZipPoiLayers, showCountyPoiLayers } = getPoiVisibilityState();
    const renderPoi = shouldRenderPointsOfInterest();
    const showCountyLayers = showCountyPoiLayers;
    poiDebugLog("extrema-refresh", {
      zoom: Number(zoom.toFixed(2)),
      boundaryMode,
      selectedStatId,
      selectedCategory,
      hideZip,
      showZipLayers,
      showZipPoiLayers,
      showCountyLayers,
      zipGeometryHiddenDueToZoom,
      loadedZctas: getLoadedZctaCount(ZCTA_STATE),
    });

    const setLayerState = (
      layerId: string,
      featureKey: "zip" | "county",
      targetId: string | null,
      iconId: string,
      visible: boolean,
    ) => {
      if (!map.getLayer(layerId)) return;
      map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
      map.setFilter(layerId, ["==", ["get", featureKey], targetId ?? "__none__"] as any);
      map.setLayoutProperty(layerId, "icon-image", iconId);
      map.setPaintProperty(layerId, "icon-opacity", visible && targetId ? 1 : 0);
    };

    if (renderPoi) {
      ensurePoiZipCentroidsLoaded();
      updatePointsOfInterestSource();
      applyPoiLayerVisibility(showZipPoiLayers, showCountyPoiLayers);
      schedulePoiVisibilityReapply();
      poiDebugLog("poi-layers-updated", {
        zipVisible: showZipPoiLayers,
        countyVisible: showCountyPoiLayers,
      });
    } else {
      applyPoiLayerVisibility(false, false);
      schedulePoiVisibilityReapply();
    }
    syncHoverPillsForAreaHover();

    if (!selectedStatId) {
      setLayerState(ZIP_STAT_EXTREME_HIGH_LAYER_ID, "zip", null, STAT_EXTREME_GOOD_ICON_ID, false);
      setLayerState(ZIP_STAT_EXTREME_LOW_LAYER_ID, "zip", null, STAT_EXTREME_BAD_ICON_ID, false);
      setLayerState(COUNTY_STAT_EXTREME_HIGH_LAYER_ID, "county", null, STAT_EXTREME_GOOD_ICON_ID, false);
      setLayerState(COUNTY_STAT_EXTREME_LOW_LAYER_ID, "county", null, STAT_EXTREME_BAD_ICON_ID, false);
      return;
    }

    const entry = boundaryMode === "counties"
      ? getStatEntryByBoundary(selectedStatId, "COUNTY")
      : getStatEntryByBoundary(selectedStatId, "ZIP");
    const { highestId, lowestId } = getExtremeAreaIds(entry?.data);
    const distinctLowestId = lowestId && lowestId !== highestId ? lowestId : null;
    const suppressZipStatExtrema = getSelectedStatZipPoiRowsForCurrentScope().length > 0;
    const suppressCountyStatExtrema = getSelectedStatCountyPoiRowsForCurrentScope().length > 0;
    const showZipStatLayers = showZipLayers && !suppressZipStatExtrema;
    const showCountyStatLayers = showCountyLayers && !suppressCountyStatExtrema;

    const goodIfUp = statGoodIfUpById.get(selectedStatId);
    const highIconId =
      goodIfUp === true
        ? STAT_EXTREME_GOOD_ICON_ID
        : goodIfUp === false
        ? STAT_EXTREME_BAD_ICON_ID
        : STAT_EXTREME_NEUTRAL_ICON_ID;
    const lowIconId =
      goodIfUp === true
        ? STAT_EXTREME_BAD_ICON_ID
        : goodIfUp === false
        ? STAT_EXTREME_GOOD_ICON_ID
        : STAT_EXTREME_NEUTRAL_ICON_ID;

    // Suppress a stat extremum for any area that already has a POI badge rendered there,
    // avoiding a stacked triangle + badge at the same centroid.
    const zipPoiAreaCodes = new Set(getZipPoiRowsForCurrentView().map((r) => r.areaCode));
    const countyPoiAreaCodes = new Set(getCountyPoiRowsForCurrentView().map((r) => r.areaCode));
    const zipHighId = showZipStatLayers && highestId && !zipPoiAreaCodes.has(highestId) ? highestId : null;
    const zipLowId = showZipStatLayers && distinctLowestId && !zipPoiAreaCodes.has(distinctLowestId) ? distinctLowestId : null;
    const countyHighId = showCountyStatLayers && highestId && !countyPoiAreaCodes.has(highestId) ? highestId : null;
    const countyLowId = showCountyStatLayers && distinctLowestId && !countyPoiAreaCodes.has(distinctLowestId) ? distinctLowestId : null;

    setLayerState(
      ZIP_STAT_EXTREME_HIGH_LAYER_ID,
      "zip",
      zipHighId,
      highIconId,
      showZipStatLayers,
    );
    setLayerState(
      ZIP_STAT_EXTREME_LOW_LAYER_ID,
      "zip",
      zipLowId,
      lowIconId,
      showZipStatLayers,
    );
    setLayerState(
      COUNTY_STAT_EXTREME_HIGH_LAYER_ID,
      "county",
      countyHighId,
      highIconId,
      showCountyStatLayers,
    );
    setLayerState(
      COUNTY_STAT_EXTREME_LOW_LAYER_ID,
      "county",
      countyLowId,
      lowIconId,
      showCountyStatLayers,
    );
  };

  const ensureSourcesAndLayers = () => {
    if (!map.isStyleLoaded()) return;

    applyBasemapLabelTone(map, currentTheme);

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
    ensureStatExtremaLayers();
    const poiLayersAdded = ensurePointsOfInterestLayers();

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
            "circle-color": "#bae5f2",
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
    // Sync extrema/POI state immediately after ensure so newly-added symbol layers
    // don't remain hidden waiting for the next camera event.
    try { updateStatExtremaArrows(); } catch {}
    if (poiLayersAdded) {
      try { map.triggerRepaint(); } catch {}
    }
    
    // Deferred path: stat overlays (can wait, expensive)
    // Use idle callback so map renders first, then overlays appear
    scheduleIdle(() => {
      try { updateStatDataChoropleth(); } catch {}
      try { updateSecondaryStatOverlay(); } catch {}
      try { updateStatExtremaArrows(); } catch {}
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

    const applyExtremaPillStatSelection = (pillStatId?: string) => {
      if (!pillStatId) return;
      const isClosingActiveStat = pillStatId === selectedStatId && selectedStatId !== DEFAULT_POPULATION_STAT_ID;
      const nextStatId = pillStatId === selectedStatId ? DEFAULT_POPULATION_STAT_ID : pillStatId;
      if (!nextStatId || nextStatId === selectedStatId) return;
      hideStatExtremaArrows();
      if (isClosingActiveStat && selectedCategory) {
        selectedCategory = null;
        categoryChips.setSelected(null);
        applyData();
        onCategorySelectionChange?.(null);
      }
      selectedStatId = nextStatId;
      categoryChips.setSelectedStat(selectedStatId);
      secondaryStatId = null;
      categoryChips.setSecondaryStat(null);
      syncStatDataStoreFocus();
      refreshStatVisuals();
      onStatSelectionChange?.(selectedStatId);
    };
    
    zipLabels = createZipLabels({
      map,
      stackedStatsMinZoom: ZIP_LABEL_STACK_MIN_ZOOM,
      onHoverPillChange: ({ areaId, pill }) => {
        cancelZipBoundaryLeaveClear?.();
        const prevArea = hoveredZipFromPill;
        const prevKey = hoveredZipPillKey;
        hoveredZipFromPill = areaId;
        hoveredZipPillArea = areaId;
        hoveredZipPillKey = pill?.key ?? null;
        if (prevArea !== hoveredZipFromPill) {
          zipSelection.updateHover();
        }
        if (prevArea !== hoveredZipFromPill || prevKey !== hoveredZipPillKey) {
          syncLinkedExtremaHoverLabels();
        }
      },
      onPillClick: ({ pill }) => {
        applyExtremaPillStatSelection(pill.statId);
      },
    });
    countyLabels = createZipLabels({
      map,
      getCentroidsMap: getCountyCentroidsMap,
      labelForId: getCountyName,
      stackedStatsMinZoom: COUNTY_LABEL_STACK_MIN_ZOOM,
      onHoverPillChange: ({ areaId, pill }) => {
        cancelCountyBoundaryLeaveClear?.();
        const prevArea = hoveredCountyFromPill;
        const prevKey = hoveredCountyPillKey;
        hoveredCountyFromPill = areaId;
        hoveredCountyPillArea = areaId;
        hoveredCountyPillKey = pill?.key ?? null;
        if (prevArea !== hoveredCountyFromPill) {
          countySelection.updateHover();
        }
        if (prevArea !== hoveredCountyFromPill || prevKey !== hoveredCountyPillKey) {
          syncLinkedExtremaHoverLabels();
        }
      },
      onPillClick: ({ pill }) => {
        applyExtremaPillStatSelection(pill.statId);
      },
    });
    zipLabels.setTheme(currentTheme);
    countyLabels.setTheme(currentTheme);
    syncHoverPillsForAreaHover();

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
        hideOrgHoverTooltip();
        // Clear hover - updateHighlight will restore selection if any
        onHover(null); 
      };
      const onPointsMouseMove = (e: any) => { 
        const f = e.features?.[0]; 
        const id = f?.properties?.id as string | undefined;
        const name = f?.properties?.name as string | undefined;
        const annualRevenueRaw = f?.properties?.annualRevenue;
        const annualRevenue =
          typeof annualRevenueRaw === "number" && Number.isFinite(annualRevenueRaw)
            ? annualRevenueRaw
            : null;
        const annualRevenuePeriodRaw = f?.properties?.annualRevenueTaxPeriod ?? f?.properties?.annualRevenuePeriod;
        const annualRevenueTaxPeriod =
          typeof annualRevenuePeriodRaw === "number" && Number.isFinite(annualRevenuePeriodRaw)
            ? annualRevenuePeriodRaw
            : null;
        const x = e.point?.x;
        const y = e.point?.y;
        if (typeof id === "string" && typeof name === "string" && typeof x === "number" && typeof y === "number") {
          const shown = showOrgHoverTooltip(name, x, y, annualRevenue, annualRevenueTaxPeriod);
          if (!shown) hideOrgHoverTooltip();
        } else {
          hideOrgHoverTooltip();
        }
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
        hideOrgHoverTooltip();
        // Clear hover - selection will persist
        hoverClusterId = null;
        onHover(null); 
        updateSelectedHighlights();
      };
      const onClustersMouseMove = async (e: any) => {
        hideOrgHoverTooltip();
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
        hideOrgHoverTooltip();
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
      // Debounced dwell time for hover - only show overlay after cursor settles briefly.
      // This avoids lighting up every area crossed during fast traversal.
      const HOVER_DWELL_MS = 120;
      let zipHoverDwellTimer: ReturnType<typeof setTimeout> | null = null;
      let zipHoverCandidate: string | null = null;
      let zipBoundaryLeaveClearTimer: ReturnType<typeof setTimeout> | null = null;
      const cancelZipBoundaryLeaveClearLocal = () => {
        if (zipBoundaryLeaveClearTimer !== null) {
          clearTimeout(zipBoundaryLeaveClearTimer);
          zipBoundaryLeaveClearTimer = null;
        }
      };
      cancelZipBoundaryLeaveClear = cancelZipBoundaryLeaveClearLocal;
      
      const commitZipHover = (zip: string) => {
        cancelZipBoundaryLeaveClearLocal();
        clearZipPreviewHover();
        hoveredZipFromMap = zip;
        queuePendingMapHoverEcho(pendingMapZipHoverEchoCounts, zip);
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
      const clearZipHoverFromMap = () => {
        clearZipHoverDwell();
        clearZipPreviewHover();
        hoveredZipFromMap = null;
        zipSelection.updateHover();
        if (mapInMotion) {
          pendingZipHover = null;
          pendingHoverArea = null;
        } else {
          onZipHoverChange?.(null);
          onAreaHoverChange?.(null);
        }
      };
      const scheduleZipBoundaryLeaveClear = () => {
        cancelZipBoundaryLeaveClearLocal();
        zipBoundaryLeaveClearTimer = setTimeout(() => {
          zipBoundaryLeaveClearTimer = null;
          if (hoveredZipFromPill) return;
          clearZipHoverFromMap();
        }, 45);
      };
      
      const onBoundaryMouseEnter = () => { 
        cancelZipBoundaryLeaveClearLocal();
        if (boundaryMode === "zips" && !(isMobile && orgPinsVisible)) {
          map.getCanvas().style.cursor = "pointer";
        }
      };
      const onBoundaryMouseLeave = () => {
        map.getCanvas().style.cursor = "pointer";
        if (boundaryMode === "zips") {
          scheduleZipBoundaryLeaveClear();
        }
      };
      const onZipMouseMove = (e: maplibregl.MapLayerMouseEvent) => {
        if (boundaryMode !== "zips") return;
        // Disable hover on mobile when org pins are visible
        if (isMobile && orgPinsVisible) return;
        cancelZipBoundaryLeaveClearLocal();
        const features = map.queryRenderedFeatures(e.point, { layers: zipLayerOrder });
        const zip = features[0]?.properties?.[zipFeatureProperty] as string | undefined;
        if (!zip) return;
        // Any map-layer hover means pointer is back on the map, so pill hover should
        // no longer win precedence over traversal preview/detail hover.
        let clearedZipPillHover = false;
        if (hoveredZipFromPill) {
          hoveredZipFromPill = null;
          hoveredZipPillArea = null;
          hoveredZipPillKey = null;
          clearedZipPillHover = true;
        }
        // Once the cursor leaves a committed area, clear detail hover immediately.
        // This lets lightweight preview hover continue while traversing to a new area.
        if (hoveredZipFromMap && zip !== hoveredZipFromMap && !hoveredZipFromToolbar && !hoveredZipFromPill) {
          hoveredZipFromMap = null;
          if (mapInMotion) {
            pendingZipHover = null;
            pendingHoverArea = null;
          } else {
            onZipHoverChange?.(null);
            onAreaHoverChange?.(null);
          }
        }
        if (zip !== hoveredZipFromMap && setZipPreviewHover(zip)) {
          zipSelection.updateHover();
        }

        // Already committed for this area; no further work needed.
        if (zip === hoveredZipFromMap) {
          clearZipHoverDwell();
          if (clearedZipPillHover) {
            zipSelection.updateHover();
          }
          return;
        }

        // Keep candidate in sync with current feature under cursor.
        if (zip !== zipHoverCandidate) {
          zipHoverCandidate = zip;
        }

        // Debounce dwell by resetting the timer on each mouse move.
        if (zipHoverDwellTimer !== null) {
          clearTimeout(zipHoverDwellTimer);
        }
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
      // Only register enter/leave/move on the base and statdata fill layers.
      // The hover fill layer's filter changes on every area transition, so its
      // mouseleave events are spurious and cause leave-clear timers to fire
      // after the preview was already set for the next area.
      map.on("mouseenter", BOUNDARY_FILL_LAYER_ID, onBoundaryMouseEnter);
      map.on("mouseenter", BOUNDARY_STATDATA_FILL_LAYER_ID, onBoundaryMouseEnter);
      map.on("mouseleave", BOUNDARY_FILL_LAYER_ID, onBoundaryMouseLeave);
      map.on("mouseleave", BOUNDARY_STATDATA_FILL_LAYER_ID, onBoundaryMouseLeave);
      map.on("mousemove", BOUNDARY_FILL_LAYER_ID, onZipMouseMove);
      map.on("mousemove", BOUNDARY_STATDATA_FILL_LAYER_ID, onZipMouseMove);

      // Dwell time for county hover (same pattern as ZIP)
      let countyHoverDwellTimer: ReturnType<typeof setTimeout> | null = null;
      let countyHoverCandidate: string | null = null;
      let countyBoundaryLeaveClearTimer: ReturnType<typeof setTimeout> | null = null;
      const cancelCountyBoundaryLeaveClearLocal = () => {
        if (countyBoundaryLeaveClearTimer !== null) {
          clearTimeout(countyBoundaryLeaveClearTimer);
          countyBoundaryLeaveClearTimer = null;
        }
      };
      cancelCountyBoundaryLeaveClear = cancelCountyBoundaryLeaveClearLocal;
      
      const commitCountyHover = (county: string) => {
        cancelCountyBoundaryLeaveClearLocal();
        clearCountyPreviewHover();
        hoveredCountyFromMap = county;
        queuePendingMapHoverEcho(pendingMapCountyHoverEchoCounts, county);
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
      const clearCountyHoverFromMap = () => {
        clearCountyHoverDwell();
        clearCountyPreviewHover();
        hoveredCountyFromMap = null;
        countySelection.updateHover();
        countyLabels?.setHoveredZip(null);
        if (mapInMotion) {
          pendingCountyHover = null;
          pendingHoverArea = null;
        } else {
          onCountyHoverChange?.(null);
          onAreaHoverChange?.(null);
        }
      };
      const scheduleCountyBoundaryLeaveClear = () => {
        cancelCountyBoundaryLeaveClearLocal();
        countyBoundaryLeaveClearTimer = setTimeout(() => {
          countyBoundaryLeaveClearTimer = null;
          if (hoveredCountyFromPill) return;
          clearCountyHoverFromMap();
        }, 45);
      };
      
      const onCountyMouseEnter = () => { 
        cancelCountyBoundaryLeaveClearLocal();
        if (boundaryMode === "counties" && !(isMobile && orgPinsVisible)) {
          map.getCanvas().style.cursor = "pointer";
        }
      };
      const onCountyMouseLeave = () => {
        map.getCanvas().style.cursor = "pointer";
        scheduleCountyBoundaryLeaveClear();
      };
      const onCountyMouseMove = (e: maplibregl.MapLayerMouseEvent) => {
        if (boundaryMode !== "counties") return;
        // Disable hover on mobile when org pins are visible
        if (isMobile && orgPinsVisible) return;
        cancelCountyBoundaryLeaveClearLocal();
        const features = map.queryRenderedFeatures(e.point, { layers: countyLayerOrder });
        const county = features[0]?.properties?.[countyFeatureProperty] as string | undefined;
        if (!county) return;
        // Any map-layer hover means pointer is back on the map, so pill hover should
        // no longer win precedence over traversal preview/detail hover.
        let clearedCountyPillHover = false;
        if (hoveredCountyFromPill) {
          hoveredCountyFromPill = null;
          hoveredCountyPillArea = null;
          hoveredCountyPillKey = null;
          clearedCountyPillHover = true;
        }
        // Once the cursor leaves a committed area, clear detail hover immediately.
        // This lets lightweight preview hover continue while traversing to a new area.
        if (hoveredCountyFromMap && county !== hoveredCountyFromMap && !hoveredCountyFromToolbar && !hoveredCountyFromPill) {
          hoveredCountyFromMap = null;
          if (mapInMotion) {
            pendingCountyHover = null;
            pendingHoverArea = null;
          } else {
            onCountyHoverChange?.(null);
            onAreaHoverChange?.(null);
          }
        }
        if (county !== hoveredCountyFromMap && setCountyPreviewHover(county)) {
          countySelection.updateHover();
        }

        // Already committed for this area; no further work needed.
        if (county === hoveredCountyFromMap) {
          clearCountyHoverDwell();
          if (clearedCountyPillHover) {
            countySelection.updateHover();
          }
          return;
        }

        // Keep candidate in sync with current feature under cursor.
        if (county !== countyHoverCandidate) {
          countyHoverCandidate = county;
        }

        // Debounce dwell by resetting the timer on each mouse move.
        if (countyHoverDwellTimer !== null) {
          clearTimeout(countyHoverDwellTimer);
        }
        countyHoverDwellTimer = setTimeout(() => {
          countyHoverDwellTimer = null;
          if (countyHoverCandidate === county) {
            commitCountyHover(county);
            countyHoverCandidate = null;
          }
        }, HOVER_DWELL_MS);
      };
      // Same as ZIP: skip hover fill layer to avoid spurious mouseleave events.
      map.on("mouseenter", COUNTY_BOUNDARY_FILL_LAYER_ID, onCountyMouseEnter);
      map.on("mouseenter", COUNTY_STATDATA_FILL_LAYER_ID, onCountyMouseEnter);
      map.on("mouseleave", COUNTY_BOUNDARY_FILL_LAYER_ID, onCountyMouseLeave);
      map.on("mouseleave", COUNTY_STATDATA_FILL_LAYER_ID, onCountyMouseLeave);
      map.on("mousemove", COUNTY_BOUNDARY_FILL_LAYER_ID, onCountyMouseMove);
      map.on("mousemove", COUNTY_STATDATA_FILL_LAYER_ID, onCountyMouseMove);
      return () => {
        // Clean up dwell timers
        cancelZipBoundaryLeaveClearLocal();
        cancelCountyBoundaryLeaveClearLocal();
        if (cancelZipBoundaryLeaveClear === cancelZipBoundaryLeaveClearLocal) {
          cancelZipBoundaryLeaveClear = null;
        }
        if (cancelCountyBoundaryLeaveClear === cancelCountyBoundaryLeaveClearLocal) {
          cancelCountyBoundaryLeaveClear = null;
        }
        clearZipHoverDwell();
        clearCountyHoverDwell();
        clearZipPreviewHover();
        clearCountyPreviewHover();
        map.off("click", handleBoundaryClick);
        map.off("dblclick", handleBoundaryDoubleClick);
        map.off("mouseenter", BOUNDARY_FILL_LAYER_ID, onBoundaryMouseEnter);
        map.off("mouseenter", BOUNDARY_STATDATA_FILL_LAYER_ID, onBoundaryMouseEnter);
        map.off("mouseleave", BOUNDARY_FILL_LAYER_ID, onBoundaryMouseLeave);
        map.off("mouseleave", BOUNDARY_STATDATA_FILL_LAYER_ID, onBoundaryMouseLeave);
        map.off("mousemove", BOUNDARY_FILL_LAYER_ID, onZipMouseMove);
        map.off("mousemove", BOUNDARY_STATDATA_FILL_LAYER_ID, onZipMouseMove);
        map.off("mouseenter", COUNTY_BOUNDARY_FILL_LAYER_ID, onCountyMouseEnter);
        map.off("mouseenter", COUNTY_STATDATA_FILL_LAYER_ID, onCountyMouseEnter);
        map.off("mouseleave", COUNTY_BOUNDARY_FILL_LAYER_ID, onCountyMouseLeave);
        map.off("mouseleave", COUNTY_STATDATA_FILL_LAYER_ID, onCountyMouseLeave);
        map.off("mousemove", COUNTY_BOUNDARY_FILL_LAYER_ID, onCountyMouseMove);
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
    isTileLoading = false;
    applyCompositeLoading();
  });
  map.once("idle", () => updateVisibleZipSet());

  // Track map tile loading state for the loading indicator.
  // Only show loading for actual tile fetches (basemap), not GeoJSON source updates.
  map.on("sourcedataloading", (e: maplibregl.MapSourceDataEvent) => {
    // Only trigger for tile loading events (has a tile property)
    if (e.tile) {
      isTileLoading = true;
      applyCompositeLoading();
    }
  });

  unsubscribeStatData = statDataStore.subscribe((byStat) => {
    statDataStoreMap = byStat;
    recomputeScopedStatData();
    refreshStatVisuals(); // Already deferred via coalescing
  });
  unsubscribeStatDataState = statDataStore.subscribeState((state) => {
    statDataStoreState = {
      isRefreshing: state.isRefreshing,
      hasPendingRefresh: state.hasPendingRefresh,
    };
    recomputeStatDataLoading();
  });
  unsubscribePointsOfInterest = pointsOfInterestStore.subscribe((snapshot) => {
    pointsOfInterestSnapshot = snapshot;
    poiDebugLog("poi-store-update", {
      totalRows: snapshot.rows.length,
      zipRows: snapshot.byBoundary.ZIP.length,
      countyRows: snapshot.byBoundary.COUNTY.length,
    });
    refreshStatVisuals();
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
          0.45, // Semi-transparent for selected (glow effect)
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
    if (!secondaryStatId) {
      secondaryChoroplethLegend.setLoading(false);
      secondaryChoroplethLegend.setVisible(false);
      return;
    }
    extUpdateSecondaryLegend(secondaryChoroplethLegend, secondaryStatId, boundaryMode, scopedStatDataByBoundary);
    const showLoading = isSecondaryLegendLoading();
    secondaryChoroplethLegend.setLoading(showLoading);
    if (showLoading) {
      secondaryChoroplethLegend.setVisible(true);
    }
  }

  function updateSecondaryStatOverlay() {
    if (!map.isStyleLoaded()) return;
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
    poiDebugLog("boundary-mode-change", {
      from: previousMode,
      to: mode,
      zoom: Number(map.getZoom().toFixed(2)),
    });
    hideStatExtremaArrows();
    boundaryMode = mode;
    
    // Immediate: clear hover state (fast)
    if (mode !== "zips") {
      pendingMapZipHoverEchoCounts.clear();
      hoveredZipFromToolbar = null;
      hoveredZipFromMap = null;
      clearZipPreviewHover();
      hoveredZipFromPill = null;
      hoveredZipPillArea = null;
      hoveredZipPillKey = null;
      zipFloatingTitle?.hide();
      zipLabels?.setHoveredZip(null);
      zipLabels?.setSelectedZips([], []);
    }
    if (mode !== "counties") {
      pendingMapCountyHoverEchoCounts.clear();
      hoveredCountyFromMap = null;
      clearCountyPreviewHover();
      hoveredCountyFromToolbar = null;
      hoveredCountyFromPill = null;
      hoveredCountyPillArea = null;
      hoveredCountyPillKey = null;
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
    // Force an immediate extrema/POI layer-state sync when mode flips so
    // layers cannot remain hidden waiting on deferred refresh.
    updateStatExtremaArrows();
    
    // Notify React immediately so UI can update (mode indicator, etc.)
    onBoundaryModeChange?.(boundaryMode);
    recomputeStatDataLoading();
    
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
    if (!selectedStatId) {
      try { map.triggerRepaint(); } catch {}
    }
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
          annualRevenue:
            typeof o.annualRevenue === "number" && Number.isFinite(o.annualRevenue)
              ? o.annualRevenue
              : null,
          annualRevenueTaxPeriod:
            typeof o.annualRevenueTaxPeriod === "number" && Number.isFinite(o.annualRevenueTaxPeriod)
              ? o.annualRevenueTaxPeriod
              : null,
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
    hideStatExtremaArrows();
    selectedCategory = categoryId;
    categoryChips.setSelected(selectedCategory);
    applyData();
    refreshStatVisuals();
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
    syncOrgHoverTooltipTheme();
  });

  const unwireVisibleIds = wireVisibleIds(map, () => lastData, (ids, total, all) => {
    const key = `${ids.join("|")}::${all.length}`;
    if (key === lastVisibleIdsKey) return;
    lastVisibleIdsKey = key;
    onVisibleIdsChange?.(ids, total, all);
  });

  const updateOrganizationPinsVisibility = () => {
    const visibility = orgPinsVisible ? "visible" : "none";
    if (!orgPinsVisible) {
      hideOrgHoverTooltip();
    }
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
      hideStatExtremaArrows();
      selectedStatId = statId;
      categoryChips.setSelectedStat(statId);
      secondaryStatId = null;
      categoryChips.setSecondaryStat(null);
      syncStatDataStoreFocus();
      if (!selectedStatId) {
        try { updateStatDataChoropleth(); } catch {}
        try { map.triggerRepaint(); } catch {}
      }
      refreshStatVisuals();
      if (typeof onStatSelectionChange === 'function') {
        onStatSelectionChange(selectedStatId);
      }
    },
    setSelectedStatOptions: (options: SelectedStatChipOption[]) => {
      categoryChips.setSelectedStatOptions(options);
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
    setAreasMode: (mode: AreasChipMode) => {
      categoryChips.setAreasMode(mode);
    },
    setBoundaryMode,
    setPinnedZips: (zips: string[]) => {
      // React is the source of truth for pinned IDs; don't echo back via callbacks.
      zipSelection.setPinnedIds(zips, { shouldZoom: false, notify: false });
    },
    setHoveredZip: (zip: string | null) => {
      // Skip if this is React echoing back the map's own committed hover.
      // Match against queued map-origin commits so delayed/out-of-order React
      // effects don't latch toolbar hover state.
      const isMapEcho = consumePendingMapHoverEcho(pendingMapZipHoverEchoCounts, zip);
      if (isMapEcho) return;
      hoveredZipFromToolbar = zip;
      if (zip) clearZipPreviewHover();
      zipSelection.updateHover();
      const finalHovered = zip || hoveredZipFromPill || hoveredZipFromMap;
      zipLabels?.setHoveredZip(finalHovered);
      syncLinkedExtremaHoverLabels();
      onZipHoverChange?.(finalHovered || null);
      onAreaHoverChange?.(finalHovered ? { kind: "ZIP", id: finalHovered } : null);
    },
    setPinnedCounties: (counties: string[]) => {
      // React is the source of truth for pinned IDs; don't echo back via callbacks.
      countySelection.setPinnedIds(counties, { shouldZoom: false, notify: false });
    },
    setHoveredCounty: (county: string | null) => {
      // Same echo guard as zip (see comment in setHoveredZip).
      const isMapEcho = consumePendingMapHoverEcho(pendingMapCountyHoverEchoCounts, county);
      if (isMapEcho) return;
      hoveredCountyFromToolbar = county;
      if (county) clearCountyPreviewHover();
      countySelection.updateHover();
      const finalHovered = county || hoveredCountyFromPill || hoveredCountyFromMap;
      countyLabels?.setHoveredZip(finalHovered);
      syncLinkedExtremaHoverLabels();
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
      // Keep subscribers in sync even before the first move/zoom event.
      const center = map.getCenter();
      fn(center.lng, center.lat, map.getZoom());
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
    setSidebarExpandVisible: (visible: boolean) => {
      categoryChips.setSidebarExpandVisible(visible);
    },
    resize: () => {
      map.resize();
    },
    destroy: () => {
      clearZipPreviewHover();
      clearCountyPreviewHover();
      hideOrgHoverTooltip();
      if (orgHoverTooltipRaf !== null) {
        cancelAnimationFrame(orgHoverTooltipRaf);
        orgHoverTooltipRaf = null;
      }
      if (orgHoverTooltipEl) {
        orgHoverTooltipEl.remove();
        orgHoverTooltipEl = null;
      }
      if (poiDebugEnabled && typeof window !== "undefined") {
        try {
          if ((window as any).__poiDebugSnapshot) {
            delete (window as any).__poiDebugSnapshot;
          }
        } catch {}
      }
      try { unwireVisibleIds(); } catch {}
      // unwind wired events
      while (destroyFns.length) {
        const fn = destroyFns.pop();
        try { fn && fn(); } catch {}
      }
      if (pendingPoiVisibilityRaf !== null) {
        cancelAnimationFrame(pendingPoiVisibilityRaf);
        pendingPoiVisibilityRaf = null;
      }
      resizeObserver.disconnect();
      unsubscribeTheme();
      categoryChips.destroy();
      if (unsubscribeStatData) unsubscribeStatData();
      if (unsubscribeStatDataState) unsubscribeStatDataState();
      if (unsubscribePointsOfInterest) unsubscribePointsOfInterest();
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
