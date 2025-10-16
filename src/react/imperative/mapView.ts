import maplibregl from "maplibre-gl";

// tulsaZipBoundaries no longer needed here (used in boundary layer module)
import { getZipBounds } from "../../lib/zipBoundaries";
import { getCountyBounds } from "../../lib/countyBoundaries";
import { computeToggle, computeAddTransient, computeClearTransient } from "./state/zipSelection";
import type { BoundsArray } from "../../lib/zipBoundaries";
import type { BoundaryMode } from "../../types/boundaries";
import type { Organization } from "../../types/organization";
import { TULSA_CENTER } from "../../types/organization";
import { themeController } from "./theme";
// palettes/hover are used inside boundary layer helpers now
import { createCategoryChips } from "./categoryChips";
import { statDataStore } from "../../state/statData";
import { createZipFloatingTitle, type ZipFloatingTitleController } from "./components/zipFloatingTitle";
import { createZipLabels, type ZipLabelsController } from "./components/zipLabels";
import { createChoroplethLegend, type ChoroplethLegendController } from "./components/choroplethLegend";
import { getCountyCentroidsMap, getCountyName } from "../../lib/countyCentroids";
// choropleth helpers are used only inside overlays/stats now
import { updateChoroplethLegend as extUpdateLegend, updateSecondaryStatOverlay as extUpdateSecondaryOverlay, updateStatDataChoropleth as extUpdatePrimaryChoropleth } from "./overlays/stats";
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
import { setClusterHighlight as extSetClusterHighlight, highlightClusterContainingOrg as extHighlightClusterContainingOrg } from "./organizationsHighlight";
import { wireVisibleIds } from "./visibilityTracker";

interface MapViewOptions {
  onHover: (idOrIds: string | string[] | null) => void;
  onVisibleIdsChange?: (ids: string[], totalInSource: number, allSourceIds: string[]) => void;
  onZipSelectionChange?: (selectedZips: string[], meta?: { pinned: string[]; transient: string[] }) => void;
  onZipHoverChange?: (zip: string | null) => void;
  onCountySelectionChange?: (selectedCounties: string[], meta?: { pinned: string[]; transient: string[] }) => void;
  onCountyHoverChange?: (county: string | null) => void;
  onStatSelectionChange?: (statId: string | null) => void;
  onCategorySelectionChange?: (categoryId: string | null) => void;
  onBoundaryModeChange?: (mode: BoundaryMode) => void;
}

export interface MapViewController {
  element: HTMLElement;
  setOrganizations: (organizations: Organization[]) => void;
  setActiveOrganization: (id: string | null) => void;
  setCategoryFilter: (categoryId: string | null) => void;
  setSelectedStat: (statId: string | null) => void;
  setSecondaryStat: (statId: string | null) => void;
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
  setOrganizationPinsVisible: (visible: boolean) => void;
  setCamera: (centerLng: number, centerLat: number, zoom: number) => void;
  onCameraChange: (fn: (centerLng: number, centerLat: number, zoom: number) => void) => () => void;
  resize: () => void;
  destroy: () => void;
}

type ThemeName = "light" | "dark";

const MAP_STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const MAP_STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const getMapStyle = (theme: ThemeName): string =>
  theme === "dark" ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;

import {
  SOURCE_ID,
  LAYER_CLUSTERS_ID,
  LAYER_CLUSTER_COUNT_ID,
  LAYER_POINTS_ID,
  LAYER_HIGHLIGHT_ID,
  LAYER_CLUSTER_HIGHLIGHT_ID,
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
  { id: string; name: string; url: string }
>;

type BoundaryTypeKey = "ZIP" | "COUNTY";
type StatDataEntry = { type: string; data: Record<string, number>; min: number; max: number };
type StatDataByBoundary = Map<string, Partial<Record<BoundaryTypeKey, StatDataEntry>>>;

const emptyFC = (): FC => ({ type: "FeatureCollection", features: [] });

const COUNTY_MODE_ENABLE_ZOOM = 9;
const COUNTY_MODE_DISABLE_ZOOM = 9.6;

export const createMapView = ({
  onHover,
  onVisibleIdsChange,
  onZipSelectionChange,
  onZipHoverChange,
  onCountySelectionChange,
  onCountyHoverChange,
  onStatSelectionChange,
  onCategorySelectionChange,
  onBoundaryModeChange,
}: MapViewOptions): MapViewController => {
  const container = document.createElement("section");
  container.className = "relative flex flex-1";

  const mapNode = document.createElement("div");
  mapNode.className = "absolute inset-0";
  container.appendChild(mapNode);

  let selectedCategory: string | null = null;
  const categoryChips = createCategoryChips({
    onChange: (categoryId) => {
      selectedCategory = categoryId;
      applyData();
      if (typeof onCategorySelectionChange === 'function') {
        onCategorySelectionChange(selectedCategory);
      }
    },
    onStatChange: (statId) => {
      selectedStatId = statId;
      updateStatDataChoropleth();
      updateChoroplethLegend();
      secondaryStatId = null;
      updateSecondaryStatOverlay();

      const zipEntry = getStatEntryByBoundary(selectedStatId, "ZIP");
      const statData = zipEntry?.data || null;
      const statType = zipEntry?.type || "count";
      zipLabels?.setStatOverlay(selectedStatId, statData, statType);

      if (typeof onStatSelectionChange === 'function') {
        onStatSelectionChange(selectedStatId);
      }
    },
  });
  container.appendChild(categoryChips.element);

  let zipFloatingTitle: ZipFloatingTitleController;
  let zipLabels: ZipLabelsController;
  let countyLabels: ZipLabelsController;
  let choroplethLegend: ChoroplethLegendController;

  let currentTheme = themeController.getTheme();
  let boundaryMode: BoundaryMode = "zips";
  let pinnedZips = new Set<string>();
  let transientZips = new Set<string>();
  let hoveredZipFromToolbar: string | null = null;
  let hoveredZipFromMap: string | null = null;
  let pinnedCounties = new Set<string>();
  let transientCounties = new Set<string>();
  let hoveredCountyFromToolbar: string | null = null;
  let hoveredCountyFromMap: string | null = null;
  let selectedStatId: string | null = null;
  let secondaryStatId: string | null = null;

  let statDataByStatId: StatDataByBoundary = new Map();
  let unsubscribeStatData: (() => void) | null = null;
  const destroyFns: Array<() => void> = [];

  const getStatEntryByBoundary = (statId: string | null, boundary: BoundaryTypeKey): StatDataEntry | undefined => {
    if (!statId) return undefined;
    const entry = statDataByStatId.get(statId);
    return entry?.[boundary];
  };

  const map = new maplibregl.Map({
    container: mapNode,
    style: getMapStyle(currentTheme),
    center: [TULSA_CENTER.longitude, TULSA_CENTER.latitude],
    zoom: 10.5,
    attributionControl: false,
    fadeDuration: 0,
    boxZoom: false,
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

  let allOrganizations: Organization[] = [];
  let lastData: FC = emptyFC();
  let orgPinsVisible: boolean = false;
  
  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  choroplethLegend = createChoroplethLegend();
  container.appendChild(choroplethLegend.element);

  let activeId: string | null = null;
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

  const updateBoundaryVisibility = () => extUpdateBoundaryVisibility(map, {
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
  }, boundaryMode);

  const getUnionZips = (): string[] => {
    const u = new Set<string>([...pinnedZips, ...transientZips]);
    return Array.from(u);
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
    updateSecondaryStatOverlay();
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
  };

  const getUnionCounties = (): string[] => {
    const combined = new Set<string>([...pinnedCounties, ...transientCounties]);
    return Array.from(combined);
  };

  const notifyCountySelectionChange = () => {
    const union = getUnionCounties();
    onCountySelectionChange?.(union, {
      pinned: Array.from(pinnedCounties),
      transient: Array.from(transientCounties),
    });
  };

  const zoomToSelectedCounties = () => {
    const union = getUnionCounties();
    if (union.length === 0) return;
    let combinedBounds: BoundsArray | null = null;
    for (const county of union) {
      const bounds = getCountyBounds(county);
      if (!bounds) continue;
      if (!combinedBounds) combinedBounds = bounds;
      else {
        combinedBounds = [
          [
            Math.min(combinedBounds[0][0], bounds[0][0]),
            Math.min(combinedBounds[0][1], bounds[0][1]),
          ],
          [
            Math.max(combinedBounds[1][0], bounds[1][0]),
            Math.max(combinedBounds[1][1], bounds[1][1]),
          ],
        ];
      }
    }
    if (!combinedBounds) return;
    map.fitBounds(combinedBounds, { padding: 48, duration: 400, maxZoom: 8.5 });
  };

  const applyCountySelection = ({ shouldZoom, notify }: { shouldZoom: boolean; notify: boolean }) => {
    updateCountySelectionHighlight();
    updateCountyHoverOutline();
    if (shouldZoom) zoomToSelectedCounties();
    if (notify) notifyCountySelectionChange();
  };

  const clearCountySelection = ({ notify }: { notify: boolean }) => {
    if (transientCounties.size === 0) {
      if (notify) notifyCountySelectionChange();
      return;
    }
    transientCounties = new Set();
    applyCountySelection({ shouldZoom: false, notify });
  };

  const toggleCountySelection = (county: string, additive: boolean, shouldZoom: boolean = false) => {
    const wasSelected = pinnedCounties.has(county) || transientCounties.has(county);
    const next = computeToggle(county, additive, pinnedCounties, transientCounties);
    pinnedCounties = next.pinned;
    transientCounties = next.transient;
    applyCountySelection({ shouldZoom: shouldZoom && !wasSelected, notify: true });
  };

  const clearCountyTransientState = ({ notify }: { notify: boolean }) => {
    if (transientCounties.size === 0) {
      if (notify) notifyCountySelectionChange();
      return;
    }
    transientCounties = computeClearTransient();
    applyCountySelection({ shouldZoom: false, notify });
  };

  const addTransientCountiesState = (counties: string[]) => {
    if (!Array.isArray(counties) || counties.length === 0) return;
    transientCounties = computeAddTransient(counties, transientCounties);
    applyCountySelection({ shouldZoom: false, notify: true });
  };

  const evaluateBoundaryModeForZoom = () => {
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

  const notifyZipSelectionChange = () => {
    const union = getUnionZips();
    onZipSelectionChange?.(union, {
      pinned: Array.from(pinnedZips),
      transient: Array.from(transientZips),
    });
    zipLabels?.setSelectedZips(union, Array.from(pinnedZips));
  };

  const zoomToSelectedZips = () => {
    const union = getUnionZips();
    if (union.length === 0) return;

    let combinedBounds: BoundsArray | null = null;

    for (const zip of union) {
      const bounds = getZipBounds(zip);
      if (!bounds) continue;
      if (!combinedBounds) {
        combinedBounds = bounds;
      } else {
        combinedBounds = [
          [
            Math.min(combinedBounds[0][0], bounds[0][0]),
            Math.min(combinedBounds[0][1], bounds[0][1]),
          ],
          [
            Math.max(combinedBounds[1][0], bounds[1][0]),
            Math.max(combinedBounds[1][1], bounds[1][1]),
          ],
        ];
      }
    }

    if (!combinedBounds) return;

    map.fitBounds(combinedBounds, { padding: 48, duration: 400, maxZoom: 14 });
  };

  const applyZipSelection = ({ shouldZoom, notify }: { shouldZoom: boolean; notify: boolean }) => {
    updateZipSelectionHighlight();
    updateZipHoverOutline();
    updateSecondaryStatOverlay();
    if (shouldZoom) {
      zoomToSelectedZips();
    }
    if (notify) {
      notifyZipSelectionChange();
    }
  };

  const clearZipSelection = ({ notify }: { notify: boolean }) => {
    if (transientZips.size === 0) {
      if (notify) notifyZipSelectionChange();
      return;
    }
    transientZips = new Set();
    applyZipSelection({ shouldZoom: false, notify });
  };

  const toggleZipSelection = (zip: string, additive: boolean, shouldZoom: boolean = false) => {
    const wasSelected = pinnedZips.has(zip) || transientZips.has(zip);
    const next = computeToggle(zip, additive, pinnedZips, transientZips);
    pinnedZips = next.pinned;
    transientZips = next.transient;
    applyZipSelection({ shouldZoom: shouldZoom && !wasSelected, notify: true });
  };

  const ensureSourcesAndLayers = () => {
    if (!map.isStyleLoaded()) return;

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

    ensureOrganizationLayers(map, {
      SOURCE_ID,
      LAYER_CLUSTERS_ID,
      LAYER_CLUSTER_COUNT_ID,
      LAYER_POINTS_ID,
      LAYER_HIGHLIGHT_ID,
      LAYER_CLUSTER_HIGHLIGHT_ID,
    }, lastData);

    updateHighlight();
    updateBoundaryPaint();
    updateBoundaryVisibility();
    updateZipSelectionHighlight();
    updateCountySelectionHighlight();
    updateCountyHoverOutline();
    updateStatDataChoropleth();
    updateSecondaryStatOverlay();
    updateOrganizationPinsVisibility();
    // visibility will be emitted by the wired tracker on next move/zoom end
    // Toggle label visibility according to boundary mode
    try { zipLabels?.setVisible?.(boundaryMode === 'zips'); } catch {}
    try { countyLabels?.setVisible?.(boundaryMode === 'counties'); } catch {}
  };

  map.once("load", () => {
    map.jumpTo({
      center: [TULSA_CENTER.longitude, TULSA_CENTER.latitude],
      zoom: 11,
    });

    map.getCanvas().style.outline = "none";

    ensureSourcesAndLayers();
    evaluateBoundaryModeForZoom();

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
      const onPointsMouseEnter = () => { map.getCanvas().style.cursor = "pointer"; };
      const onPointsMouseLeave = () => { map.getCanvas().style.cursor = "pointer"; clearClusterHighlight(); onHover(null); };
      const onPointsMouseMove = (e: any) => { const f = e.features?.[0]; const id = f?.properties?.id as string | undefined; clearClusterHighlight(); onHover(id || null); };
      const onPointsClick = (e: any) => { e.originalEvent.stopPropagation(); };
      map.on("mouseenter", LAYER_POINTS_ID, onPointsMouseEnter);
      map.on("mouseleave", LAYER_POINTS_ID, onPointsMouseLeave);
      map.on("mousemove", LAYER_POINTS_ID, onPointsMouseMove);
      map.on("click", LAYER_POINTS_ID, onPointsClick);

      const onClustersMouseEnter = () => { map.getCanvas().style.cursor = "pointer"; };
      const onClustersMouseLeave = () => { map.getCanvas().style.cursor = "pointer"; clearClusterHighlight(); onHover(null); };
      const onClustersMouseMove = async (e: any) => {
        const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_CLUSTERS_ID] });
      const feature = features[0];
      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      const clusterId = feature?.properties?.cluster_id as number | undefined;
      if (!feature || !source || clusterId === undefined) return;
      try {
        setClusterHighlight(clusterId);
        const leaves = await source.getClusterLeaves(clusterId, 1000, 0);
          const ids = leaves.map((f: any) => f?.properties?.id).filter((v: any): v is string => typeof v === "string");
        onHover(ids);
      } catch {}
      };
      const onClustersClick = async (e: any) => {
        const features = map.queryRenderedFeatures(e.point, { layers: [LAYER_CLUSTERS_ID] });
      const feature = features[0];
      if (!feature || feature.geometry?.type !== "Point") return;
      const clusterId = feature.properties?.cluster_id as number | undefined;
      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (!source || clusterId === undefined) return;
      try {
        const zoom = await source.getClusterExpansionZoom(clusterId);
        const point = feature.geometry as GeoJSON.Point;
        const [lng, lat] = point.coordinates as [number, number];
        map.easeTo({ center: [lng, lat], zoom });
      } catch {}
      };
      map.on("mouseenter", LAYER_CLUSTERS_ID, onClustersMouseEnter);
      map.on("mouseleave", LAYER_CLUSTERS_ID, onClustersMouseLeave);
      map.on("mousemove", LAYER_CLUSTERS_ID, onClustersMouseMove);
      map.on("click", LAYER_CLUSTERS_ID, onClustersClick);
      return () => {
        map.off("mouseenter", LAYER_POINTS_ID, onPointsMouseEnter);
        map.off("mouseleave", LAYER_POINTS_ID, onPointsMouseLeave);
        map.off("mousemove", LAYER_POINTS_ID, onPointsMouseMove);
        map.off("click", LAYER_POINTS_ID, onPointsClick);
        map.off("mouseenter", LAYER_CLUSTERS_ID, onClustersMouseEnter);
        map.off("mouseleave", LAYER_CLUSTERS_ID, onClustersMouseLeave);
        map.off("mousemove", LAYER_CLUSTERS_ID, onClustersMouseMove);
        map.off("click", LAYER_CLUSTERS_ID, onClustersClick);
      };
    })();

    const boundaryLayerOrder = [
          BOUNDARY_HOVER_FILL_LAYER_ID,
          BOUNDARY_HOVER_LINE_LAYER_ID,
          BOUNDARY_PINNED_FILL_LAYER_ID,
          BOUNDARY_PINNED_LINE_LAYER_ID,
          BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
          BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
          BOUNDARY_STATDATA_FILL_LAYER_ID,
          BOUNDARY_FILL_LAYER_ID,
          BOUNDARY_LINE_LAYER_ID,
    ];
    const countyLayerOrder = [
          COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
          COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
          COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID,
          COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID,
          COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
          COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
          COUNTY_STATDATA_FILL_LAYER_ID,
          COUNTY_BOUNDARY_FILL_LAYER_ID,
          COUNTY_BOUNDARY_LINE_LAYER_ID,
    ];
    const unwireBoundaries = (() => {
      const handleBoundaryClick = (e: maplibregl.MapLayerMouseEvent) => {
        if (boundaryMode === "zips") {
          const orgFeatures = map.queryRenderedFeatures(e.point, { layers: [LAYER_POINTS_ID, LAYER_CLUSTERS_ID] });
          if (orgFeatures.length > 0) return;
          const features = map.queryRenderedFeatures(e.point, { layers: boundaryLayerOrder });
          const feature = features[0];
          const zip = feature?.properties?.zip as string | undefined;
          if (!zip) return;
          const additive = Boolean((e.originalEvent as MouseEvent | PointerEvent | undefined)?.shiftKey);
          toggleZipSelection(zip, additive, false);
        } else if (boundaryMode === "counties") {
          const orgFeatures = map.queryRenderedFeatures(e.point, { layers: [LAYER_POINTS_ID, LAYER_CLUSTERS_ID] });
          if (orgFeatures.length > 0) return;
          const features = map.queryRenderedFeatures(e.point, { layers: countyLayerOrder });
          const feature = features[0];
          const county = feature?.properties?.county as string | undefined;
          if (!county) return;
          const additive = Boolean((e.originalEvent as MouseEvent | PointerEvent | undefined)?.shiftKey);
          toggleCountySelection(county, additive, false);
        }
      };
      const handleBoundaryDoubleClick = (e: maplibregl.MapLayerMouseEvent) => {
        if (boundaryMode === "zips") {
          e.preventDefault();
          const orgFeatures = map.queryRenderedFeatures(e.point, { layers: [LAYER_POINTS_ID, LAYER_CLUSTERS_ID] });
          if (orgFeatures.length > 0) return;
          const features = map.queryRenderedFeatures(e.point, { layers: boundaryLayerOrder });
          const feature = features[0];
          const zip = feature?.properties?.zip as string | undefined;
          if (!zip) return;
          const additive = Boolean((e.originalEvent as MouseEvent | PointerEvent | undefined)?.shiftKey);
          toggleZipSelection(zip, additive, true);
        } else if (boundaryMode === "counties") {
          e.preventDefault();
          const orgFeatures = map.queryRenderedFeatures(e.point, { layers: [LAYER_POINTS_ID, LAYER_CLUSTERS_ID] });
          if (orgFeatures.length > 0) return;
          const features = map.queryRenderedFeatures(e.point, { layers: countyLayerOrder });
          const feature = features[0];
          const county = feature?.properties?.county as string | undefined;
          if (!county) return;
          const additive = Boolean((e.originalEvent as MouseEvent | PointerEvent | undefined)?.shiftKey);
          toggleCountySelection(county, additive, true);
        }
      };
      const onBoundaryMouseEnter = () => { if (boundaryMode === "zips") map.getCanvas().style.cursor = "pointer"; };
      const onBoundaryMouseLeave = () => {
        map.getCanvas().style.cursor = "pointer";
        if (boundaryMode === "zips") {
          hoveredZipFromMap = null;
          updateZipHoverOutline();
          onZipHoverChange?.(null);
        }
      };
      const onZipMouseMove = (e: maplibregl.MapLayerMouseEvent) => {
        if (boundaryMode !== "zips") return;
        const features = map.queryRenderedFeatures(e.point, { layers: boundaryLayerOrder });
        const zip = features[0]?.properties?.zip as string | undefined;
        if (!zip || zip === hoveredZipFromMap) return;
        hoveredZipFromMap = zip;
        updateZipHoverOutline();
        onZipHoverChange?.(zip);
      };
      map.on("click", handleBoundaryClick);
      map.on("dblclick", handleBoundaryDoubleClick);
      map.on("mouseenter", BOUNDARY_FILL_LAYER_ID, onBoundaryMouseEnter);
      map.on("mouseenter", BOUNDARY_STATDATA_FILL_LAYER_ID, onBoundaryMouseEnter);
      map.on("mouseleave", BOUNDARY_FILL_LAYER_ID, onBoundaryMouseLeave);
      map.on("mouseleave", BOUNDARY_STATDATA_FILL_LAYER_ID, onBoundaryMouseLeave);
      map.on("mousemove", BOUNDARY_FILL_LAYER_ID, onZipMouseMove);
      map.on("mousemove", BOUNDARY_STATDATA_FILL_LAYER_ID, onZipMouseMove);

      const onCountyMouseEnter = () => { if (boundaryMode === "counties") map.getCanvas().style.cursor = "pointer"; };
      const onCountyMouseLeave = () => {
        map.getCanvas().style.cursor = "pointer";
        hoveredCountyFromMap = null;
        updateCountyHoverOutline();
        onCountyHoverChange?.(null);
      };
      const onCountyMouseMove = (e: maplibregl.MapLayerMouseEvent) => {
        if (boundaryMode !== "counties") return;
        const features = map.queryRenderedFeatures(e.point, { layers: countyLayerOrder });
        const county = features[0]?.properties?.county as string | undefined;
        if (!county || county === hoveredCountyFromMap) return;
        hoveredCountyFromMap = county;
        updateCountyHoverOutline();
        onCountyHoverChange?.(county);
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
  });

  unsubscribeStatData = statDataStore.subscribe((byStat) => {
    statDataByStatId = byStat;
    updateStatDataChoropleth();
    updateChoroplethLegend();
    updateSecondaryStatOverlay();

    const zipEntry = getStatEntryByBoundary(selectedStatId, "ZIP");
    zipLabels?.setStatOverlay(selectedStatId, zipEntry?.data || null, zipEntry?.type || "count");
    const secondaryEntry = getStatEntryByBoundary(secondaryStatId, "ZIP");
    zipLabels?.setSecondaryStatOverlay?.(secondaryStatId, secondaryEntry?.data || null, secondaryEntry?.type || "count");
    const countyEntry = getStatEntryByBoundary(selectedStatId, "COUNTY");
    countyLabels?.setStatOverlay(selectedStatId, countyEntry?.data || null, countyEntry?.type || "count");
    const countySecondary = getStatEntryByBoundary(secondaryStatId, "COUNTY");
    countyLabels?.setSecondaryStatOverlay?.(secondaryStatId, countySecondary?.data || null, countySecondary?.type || "count");
  });

  function updateHighlight() {
    if (!map.getLayer(LAYER_HIGHLIGHT_ID)) return;
    const baseFilter: any[] = ["!", ["has", "point_count"]];
    const filter = activeId
      ? ["all", baseFilter, ["==", ["get", "id"], activeId]]
      : ["all", baseFilter, ["==", ["get", "id"], "__none__"]];
    map.setFilter(LAYER_HIGHLIGHT_ID, filter as any);
  }

  function updateChoroplethLegend() {
    if (!selectedStatId) { choroplethLegend.setVisible(false); return; }
    extUpdateLegend(choroplethLegend, selectedStatId, boundaryMode, statDataByStatId);
  }

  function updateSecondaryStatOverlay() {
    extUpdateSecondaryOverlay(map, {
      BOUNDARY_STATDATA_FILL_LAYER_ID,
      COUNTY_STATDATA_FILL_LAYER_ID,
      SECONDARY_STAT_LAYER_ID,
      SECONDARY_STAT_HOVER_LAYER_ID,
    }, boundaryMode, currentTheme, secondaryStatId, statDataByStatId, pinnedZips, transientZips, (hoveredZipFromToolbar || hoveredZipFromMap || null));
  }

  const setClusterHighlight = (clusterId: number | null) => {
    extSetClusterHighlight(map, LAYER_CLUSTER_HIGHLIGHT_ID, clusterId);
  };

  const setBoundaryMode = (mode: BoundaryMode) => {
    if (mode === boundaryMode) return;
    const previousMode = boundaryMode;
    boundaryMode = mode;
    if (mode !== "zips") {
      hoveredZipFromToolbar = null;
      hoveredZipFromMap = null;
      transientZips = computeClearTransient();
      applyZipSelection({ shouldZoom: false, notify: true });
      zipFloatingTitle?.hide();
      zipLabels?.setHoveredZip(null);
      zipLabels?.setSelectedZips([], []);
      onZipHoverChange?.(null);
    }
    if (mode !== "counties") {
      hoveredCountyFromMap = null;
      hoveredCountyFromToolbar = null;
      transientCounties = computeClearTransient();
      applyCountySelection({ shouldZoom: false, notify: true });
      countyLabels?.setHoveredZip(null);
      countyLabels?.setSelectedZips([], []);
    }
    if (mode !== "counties") {
      hoveredCountyFromMap = null;
      hoveredCountyFromToolbar = null;
      transientCounties = computeClearTransient();
      applyCountySelection({ shouldZoom: false, notify: true });
    }
    if (mode === "counties" && previousMode !== "counties") {
      zipFloatingTitle?.hide();
    }
    ensureSourcesAndLayers();
    updateBoundaryVisibility();
    updateStatDataChoropleth();
    updateChoroplethLegend();
    updateSecondaryStatOverlay();
    onBoundaryModeChange?.(boundaryMode);
  };

  const clearClusterHighlight = () => setClusterHighlight(null);

  const highlightClusterContainingOrg = async (id: string | null) => {
    await extHighlightClusterContainingOrg(map, SOURCE_ID, LAYER_CLUSTERS_ID, LAYER_CLUSTER_HIGHLIGHT_ID, id);
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
      SECONDARY_STAT_HOVER_LAYER_ID,
    }, currentTheme, boundaryMode, selectedStatId, statDataByStatId);
  }

  const applyData = () => {
    const filtered = selectedCategory
      ? allOrganizations.filter((o) => o.category === selectedCategory)
      : allOrganizations;

    const fc: FC = {
      type: "FeatureCollection",
      features: filtered.map((o) => ({
        type: "Feature",
        properties: { id: o.id, name: o.name, url: o.url },
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
      clearClusterHighlight();
    }

    // visibility will be emitted by the wired tracker on next move/zoom end
  };

  const setActiveOrganization = (id: string | null) => {
    if (activeId === id) return;
    activeId = id;
    updateHighlight();
    void highlightClusterContainingOrg(activeId);
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
      clearZipSelection({ notify: true });
      clearCountySelection({ notify: true });
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

  return {
    element: container,
    setOrganizations,
    setActiveOrganization,
    setCategoryFilter,
    setSelectedStat: (statId: string | null) => {
      selectedStatId = statId;
      categoryChips.setSelectedStat(statId);
      updateStatDataChoropleth();
      updateChoroplethLegend();
      secondaryStatId = null;
      updateSecondaryStatOverlay();
      const zipEntry = getStatEntryByBoundary(selectedStatId, "ZIP");
      zipLabels?.setStatOverlay(selectedStatId, zipEntry?.data || null, zipEntry?.type || "count");
      zipLabels?.setSecondaryStatOverlay?.(null, null);
      if (typeof onStatSelectionChange === 'function') {
        onStatSelectionChange(selectedStatId);
      }
    },
    setSecondaryStat: (statId: string | null) => {
      secondaryStatId = statId;
      updateSecondaryStatOverlay();
      const secondaryEntry = getStatEntryByBoundary(secondaryStatId, "ZIP");
      zipLabels?.setSecondaryStatOverlay?.(secondaryStatId, secondaryEntry?.data || null, secondaryEntry?.type || "count");
    },
    setBoundaryMode,
    setPinnedZips: (zips: string[]) => {
      const next = new Set(zips);
      let changed = false;
      if (next.size !== pinnedZips.size) changed = true;
      else {
        for (const z of next) if (!pinnedZips.has(z)) { changed = true; break; }
      }
      if (!changed) return;
      pinnedZips = next;
      applyZipSelection({ shouldZoom: false, notify: true });
    },
    setHoveredZip: (zip: string | null) => {
      hoveredZipFromToolbar = zip;
      updateZipHoverOutline();
      const finalHovered = zip || hoveredZipFromMap;
      zipLabels?.setHoveredZip(finalHovered);
    },
    setPinnedCounties: (counties: string[]) => {
      const next = new Set(counties);
      let changed = false;
      if (next.size !== pinnedCounties.size) changed = true;
      else {
        for (const id of next) if (!pinnedCounties.has(id)) { changed = true; break; }
      }
      if (!changed) return;
      pinnedCounties = next;
      applyCountySelection({ shouldZoom: false, notify: true });
    },
    setHoveredCounty: (county: string | null) => {
      hoveredCountyFromToolbar = county;
      updateCountyHoverOutline();
      const finalHovered = county || hoveredCountyFromMap;
      onCountyHoverChange?.(finalHovered || null);
    },
    clearTransientSelection: () => {
      transientZips = computeClearTransient();
      applyZipSelection({ shouldZoom: false, notify: true });
    },
    addTransientZips: (zips: string[]) => {
      if (!Array.isArray(zips) || zips.length === 0) return;
      transientZips = computeAddTransient(zips, transientZips);
      applyZipSelection({ shouldZoom: false, notify: true });
    },
    clearCountyTransientSelection: () => {
      clearCountyTransientState({ notify: true });
    },
    addTransientCounties: (counties: string[]) => {
      addTransientCountiesState(counties);
    },
    fitAllOrganizations,
    setOrganizationPinsVisible: (visible: boolean) => {
      if (orgPinsVisible === visible) return;
      orgPinsVisible = visible;
      updateOrganizationPinsVisibility();
    },
    setCamera: (centerLng: number, centerLat: number, zoom: number) => {
      map.jumpTo({ center: [centerLng, centerLat], zoom });
    },
    onCameraChange: (fn: (lng: number, lat: number, zoom: number) => void) => {
      cameraListeners.push(fn);
      return () => {
        const idx = cameraListeners.indexOf(fn);
        if (idx >= 0) cameraListeners.splice(idx, 1);
      };
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
      window.removeEventListener("keydown", handleKeyDown);
      map.remove();
    },
  };
};
