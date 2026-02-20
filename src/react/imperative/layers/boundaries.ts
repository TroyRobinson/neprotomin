import type maplibregl from "maplibre-gl";

import { oklahomaCountyBoundaries } from "../../../data/oklahomaCountyBoundaries";
import type { BoundaryMode } from "../../../types/boundaries";
import { getZipCentroidFeatureCollection } from "../../../lib/zipCentroids";
import { getCountyCentroidFeatureCollection } from "../../../lib/countyCentroids";
import { getAreaRegistryEntry } from "../areas/registry";
import {
  LAYER_CLUSTERS_ID,
  COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
  COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
  COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID,
  COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID,
} from "../constants/map";

const zipAreaEntry = getAreaRegistryEntry("ZIP");
const countyAreaEntry = getAreaRegistryEntry("COUNTY");
const HOVER_OPACITY_TRANSITION_MS = 85;
const HOVER_OPACITY_TRANSITION = {
  duration: HOVER_OPACITY_TRANSITION_MS,
  delay: 0,
} as const;
const HOVER_OPACITY_SCALE = 0.9;
const PREVIEW_HOVER_OPACITY_MULTIPLIER = 0.42;
const ZIP_NONE_FILTER = ["==", ["get", "zip"], "__none__"] as const;
const COUNTY_NONE_FILTER = ["==", ["get", "county"], "__none__"] as const;

type HoverClearTimers = {
  zip: ReturnType<typeof setTimeout> | null;
  county: ReturnType<typeof setTimeout> | null;
};

const hoverClearTimersByMap = new WeakMap<maplibregl.Map, HoverClearTimers>();

const getHoverClearTimers = (map: maplibregl.Map): HoverClearTimers => {
  const existing = hoverClearTimersByMap.get(map);
  if (existing) return existing;
  const next: HoverClearTimers = { zip: null, county: null };
  hoverClearTimersByMap.set(map, next);
  return next;
};

const cancelZipHoverFilterClear = (map: maplibregl.Map) => {
  const timers = getHoverClearTimers(map);
  if (timers.zip !== null) {
    clearTimeout(timers.zip);
    timers.zip = null;
  }
};

const cancelCountyHoverFilterClear = (map: maplibregl.Map) => {
  const timers = getHoverClearTimers(map);
  if (timers.county !== null) {
    clearTimeout(timers.county);
    timers.county = null;
  }
};

const scheduleZipHoverFilterClear = (
  map: maplibregl.Map,
  layerIds: { line: string; fill: string },
) => {
  const timers = getHoverClearTimers(map);
  cancelZipHoverFilterClear(map);
  timers.zip = setTimeout(() => {
    timers.zip = null;
    if (map.getLayer(layerIds.line)) map.setFilter(layerIds.line, ZIP_NONE_FILTER as any);
    if (map.getLayer(layerIds.fill)) map.setFilter(layerIds.fill, ZIP_NONE_FILTER as any);
    map.triggerRepaint();
  }, HOVER_OPACITY_TRANSITION_MS);
};

const scheduleCountyHoverFilterClear = (
  map: maplibregl.Map,
  layerIds: { line: string; fill: string },
) => {
  const timers = getHoverClearTimers(map);
  cancelCountyHoverFilterClear(map);
  timers.county = setTimeout(() => {
    timers.county = null;
    if (map.getLayer(layerIds.line)) map.setFilter(layerIds.line, COUNTY_NONE_FILTER as any);
    if (map.getLayer(layerIds.fill)) map.setFilter(layerIds.fill, COUNTY_NONE_FILTER as any);
    map.triggerRepaint();
  }, HOVER_OPACITY_TRANSITION_MS);
};

const scaleHoverOpacity = (value: number): number =>
  Math.max(0, Math.min(1, value * HOVER_OPACITY_SCALE));

const buildHoverFilter = (
  featureKey: "zip" | "county",
  primaryId: string,
  trailingId?: string | null,
) => {
  const ids = new Set<string>([primaryId]);
  if (trailingId) ids.add(trailingId);
  const values = Array.from(ids);
  if (values.length === 1) {
    return ["==", ["get", featureKey], values[0]] as any;
  }
  return ["in", ["get", featureKey], ["literal", values]] as any;
};

export interface BoundaryLayerIds {
  BOUNDARY_SOURCE_ID: string;
  BOUNDARY_FILL_LAYER_ID: string;
  BOUNDARY_LINE_LAYER_ID: string;
  BOUNDARY_HIGHLIGHT_FILL_LAYER_ID: string;
  BOUNDARY_HIGHLIGHT_LINE_LAYER_ID: string;
  BOUNDARY_PINNED_FILL_LAYER_ID: string;
  BOUNDARY_PINNED_LINE_LAYER_ID: string;
  BOUNDARY_HOVER_LINE_LAYER_ID: string;
  BOUNDARY_HOVER_FILL_LAYER_ID: string;
  BOUNDARY_STATDATA_FILL_LAYER_ID: string;
  ZIP_CENTROIDS_SOURCE_ID: string;
  SECONDARY_STAT_LAYER_ID: string;
  SECONDARY_STAT_HOVER_LAYER_ID: string;
  COUNTY_CENTROIDS_SOURCE_ID: string;
  COUNTY_SECONDARY_LAYER_ID: string;
  COUNTY_SECONDARY_HOVER_LAYER_ID: string;
  COUNTY_BOUNDARY_SOURCE_ID: string;
  COUNTY_BOUNDARY_FILL_LAYER_ID: string;
  COUNTY_BOUNDARY_LINE_LAYER_ID: string;
  COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID: string;
  COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID: string;
  COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID: string;
  COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID: string;
  COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID: string;
  COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID: string;
  COUNTY_STATDATA_FILL_LAYER_ID: string;
}

export const ensureBoundaryLayers = (
  map: maplibregl.Map,
  ids: BoundaryLayerIds,
  boundaryMode: BoundaryMode,
  theme: "light" | "dark",
): void => {
  if (!map.isStyleLoaded()) return;

  const {
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
  } = ids;

  const zipBasePaint = zipAreaEntry.getBasePaint(theme);
  const countyBasePaint = countyAreaEntry.getBasePaint(theme);

  if (!map.getSource(BOUNDARY_SOURCE_ID)) {
    map.addSource(BOUNDARY_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }

  if (!map.getLayer(BOUNDARY_FILL_LAYER_ID)) {
    map.addLayer({
      id: BOUNDARY_FILL_LAYER_ID,
      type: "fill",
      source: BOUNDARY_SOURCE_ID,
      layout: { visibility: boundaryMode === "zips" ? "visible" : "none" },
      paint: { "fill-color": zipBasePaint.fill.color, "fill-opacity": zipBasePaint.fill.opacity },
    });
  }

  if (!map.getLayer(BOUNDARY_STATDATA_FILL_LAYER_ID)) {
    map.addLayer({
      id: BOUNDARY_STATDATA_FILL_LAYER_ID,
      type: "fill",
      source: BOUNDARY_SOURCE_ID,
      layout: { visibility: boundaryMode === "zips" ? "visible" : "none" },
      paint: { "fill-opacity": 0 },
    });
  }

  if (!map.getLayer(BOUNDARY_LINE_LAYER_ID)) {
    map.addLayer({
      id: BOUNDARY_LINE_LAYER_ID,
      type: "line",
      source: BOUNDARY_SOURCE_ID,
      layout: { visibility: boundaryMode === "zips" ? "visible" : "none" },
      paint: {
        "line-color": zipBasePaint.line.color,
        "line-opacity": zipBasePaint.line.opacity,
        "line-width": zipBasePaint.line.width,
      },
    });
  }

  if (!map.getLayer(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID)) {
    map.addLayer(
      {
        id: BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
        type: "fill",
        source: BOUNDARY_SOURCE_ID,
        filter: ["==", ["get", "zip"], "__none__"],
        layout: { visibility: boundaryMode === "zips" ? "visible" : "none" },
        paint: {},
      },
      BOUNDARY_LINE_LAYER_ID,
    );
  }

  if (!map.getLayer(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID)) {
    map.addLayer({
      id: BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
      type: "line",
      source: BOUNDARY_SOURCE_ID,
      filter: ["==", ["get", "zip"], "__none__"],
      layout: { visibility: boundaryMode === "zips" ? "visible" : "none" },
      paint: {},
    });
  }

  if (!map.getLayer(BOUNDARY_PINNED_FILL_LAYER_ID)) {
    map.addLayer(
      {
        id: BOUNDARY_PINNED_FILL_LAYER_ID,
        type: "fill",
        source: BOUNDARY_SOURCE_ID,
        filter: ["==", ["get", "zip"], "__none__"],
        layout: { visibility: boundaryMode === "zips" ? "visible" : "none" },
        paint: {},
      },
      BOUNDARY_LINE_LAYER_ID,
    );
  }

  if (!map.getLayer(BOUNDARY_PINNED_LINE_LAYER_ID)) {
    map.addLayer({
      id: BOUNDARY_PINNED_LINE_LAYER_ID,
      type: "line",
      source: BOUNDARY_SOURCE_ID,
      filter: ["==", ["get", "zip"], "__none__"],
      layout: { visibility: boundaryMode === "zips" ? "visible" : "none" },
      paint: {},
    });
  }

  if (!map.getLayer(BOUNDARY_HOVER_LINE_LAYER_ID)) {
    map.addLayer({
      id: BOUNDARY_HOVER_LINE_LAYER_ID,
      type: "line",
      source: BOUNDARY_SOURCE_ID,
      filter: ["==", ["get", "zip"], "__none__"],
      layout: { visibility: boundaryMode === "zips" ? "visible" : "none" },
      paint: { "line-opacity-transition": HOVER_OPACITY_TRANSITION as any },
    });
  }

  if (!map.getLayer(BOUNDARY_HOVER_FILL_LAYER_ID)) {
    map.addLayer(
      {
        id: BOUNDARY_HOVER_FILL_LAYER_ID,
        type: "fill",
        source: BOUNDARY_SOURCE_ID,
        filter: ["==", ["get", "zip"], "__none__"],
        layout: { visibility: boundaryMode === "zips" ? "visible" : "none" },
        paint: { "fill-opacity-transition": HOVER_OPACITY_TRANSITION as any },
      },
      BOUNDARY_HOVER_LINE_LAYER_ID,
    );
  }

  if (!map.getSource(ZIP_CENTROIDS_SOURCE_ID)) {
    map.addSource(ZIP_CENTROIDS_SOURCE_ID, { type: "geojson", data: getZipCentroidFeatureCollection() });
  } else {
    const s = map.getSource(ZIP_CENTROIDS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    try { s?.setData(getZipCentroidFeatureCollection() as any); } catch {}
  }

  if (!map.getLayer(SECONDARY_STAT_LAYER_ID)) {
    const before = map.getLayer(LAYER_CLUSTERS_ID) ? LAYER_CLUSTERS_ID : undefined;
    const layer: any = {
      id: SECONDARY_STAT_LAYER_ID,
      type: "circle",
      source: ZIP_CENTROIDS_SOURCE_ID,
      filter: ["==", ["get", "zip"], "__none__"],
      layout: { visibility: boundaryMode === "zips" ? "visible" : "none" },
      paint: {
        "circle-radius": 5,
        "circle-color": "#1e98ac",
        "circle-opacity": 0,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1,
        "circle-translate": [0, 0],
      } as any,
    };
    if (before) map.addLayer(layer, before);
    else map.addLayer(layer);
  }

  if (!map.getLayer(SECONDARY_STAT_HOVER_LAYER_ID)) {
    const before = map.getLayer(SECONDARY_STAT_LAYER_ID) ? SECONDARY_STAT_LAYER_ID : undefined;
    const layer: any = {
      id: SECONDARY_STAT_HOVER_LAYER_ID,
      type: "circle",
      source: ZIP_CENTROIDS_SOURCE_ID,
      filter: ["==", ["get", "zip"], "__none__"],
      layout: { visibility: boundaryMode === "zips" ? "visible" : "none" },
      paint: {
        "circle-radius": 7,
        "circle-color": "#1e98ac",
        "circle-opacity": 0,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-translate": [0, 0],
      } as any,
    };
    if (before) map.addLayer(layer, before);
    else map.addLayer(layer);
  }

  if (!map.getSource(COUNTY_CENTROIDS_SOURCE_ID)) {
    map.addSource(COUNTY_CENTROIDS_SOURCE_ID, {
      type: "geojson",
      data: getCountyCentroidFeatureCollection(),
    });
  } else {
    const source = map.getSource(COUNTY_CENTROIDS_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    try { source?.setData(getCountyCentroidFeatureCollection() as any); } catch {}
  }

  if (!map.getLayer(COUNTY_SECONDARY_LAYER_ID)) {
    const before = map.getLayer(LAYER_CLUSTERS_ID) ? LAYER_CLUSTERS_ID : undefined;
    const layer: any = {
      id: COUNTY_SECONDARY_LAYER_ID,
      type: "circle",
      source: COUNTY_CENTROIDS_SOURCE_ID,
      filter: ["==", ["get", "county"], "__none__"],
      layout: { visibility: boundaryMode === "counties" ? "visible" : "none" },
      paint: {
        "circle-radius": 6.5,
        "circle-color": "#1e98ac",
        "circle-opacity": 0,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 1,
        "circle-translate": [0, 0],
      } as any,
    };
    if (before) map.addLayer(layer, before);
    else map.addLayer(layer);
  }

  if (!map.getLayer(COUNTY_SECONDARY_HOVER_LAYER_ID)) {
    const before = map.getLayer(COUNTY_SECONDARY_LAYER_ID) ? COUNTY_SECONDARY_LAYER_ID : undefined;
    const layer: any = {
      id: COUNTY_SECONDARY_HOVER_LAYER_ID,
      type: "circle",
      source: COUNTY_CENTROIDS_SOURCE_ID,
      filter: ["==", ["get", "county"], "__none__"],
      layout: { visibility: boundaryMode === "counties" ? "visible" : "none" },
      paint: {
        "circle-radius": 8.5,
        "circle-color": "#1e98ac",
        "circle-opacity": 0,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-translate": [0, 0],
      } as any,
    };
    if (before) map.addLayer(layer, before);
    else map.addLayer(layer);
  }

  if (!map.getSource(COUNTY_BOUNDARY_SOURCE_ID)) {
    map.addSource(COUNTY_BOUNDARY_SOURCE_ID, { type: "geojson", data: oklahomaCountyBoundaries });
  } else {
    const source = map.getSource(COUNTY_BOUNDARY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    try { source?.setData(oklahomaCountyBoundaries as any); } catch {}
  }

  if (!map.getLayer(COUNTY_BOUNDARY_FILL_LAYER_ID)) {
    map.addLayer({
      id: COUNTY_BOUNDARY_FILL_LAYER_ID,
      type: "fill",
      source: COUNTY_BOUNDARY_SOURCE_ID,
      layout: { visibility: boundaryMode === "counties" ? "visible" : "none" },
      paint: {
        "fill-color": countyBasePaint.fill.color,
        "fill-opacity": countyBasePaint.fill.opacity,
      },
    });
  }

  if (!map.getLayer(COUNTY_BOUNDARY_LINE_LAYER_ID)) {
    map.addLayer({
      id: COUNTY_BOUNDARY_LINE_LAYER_ID,
      type: "line",
      source: COUNTY_BOUNDARY_SOURCE_ID,
      layout: { visibility: boundaryMode === "counties" ? "visible" : "none" },
      paint: {
        "line-color": countyBasePaint.line.color,
        "line-opacity": countyBasePaint.line.opacity,
        "line-width": countyBasePaint.line.width,
      },
    });
  }

  if (!map.getLayer(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID)) {
    map.addLayer({
      id: COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
      type: "fill",
      source: COUNTY_BOUNDARY_SOURCE_ID,
      filter: ["==", ["get", "county"], "__none__"],
      layout: { visibility: boundaryMode === "counties" ? "visible" : "none" },
      paint: { "fill-opacity-transition": HOVER_OPACITY_TRANSITION as any },
    });
  }

  if (!map.getLayer(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID)) {
    map.addLayer({
      id: COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
      type: "line",
      source: COUNTY_BOUNDARY_SOURCE_ID,
      filter: ["==", ["get", "county"], "__none__"],
      layout: { visibility: boundaryMode === "counties" ? "visible" : "none" },
      paint: { "line-opacity-transition": HOVER_OPACITY_TRANSITION as any },
    });
  }

  if (!map.getLayer(COUNTY_STATDATA_FILL_LAYER_ID)) {
    map.addLayer({
      id: COUNTY_STATDATA_FILL_LAYER_ID,
      type: "fill",
      source: COUNTY_BOUNDARY_SOURCE_ID,
      layout: { visibility: boundaryMode === "counties" ? "visible" : "none" },
      paint: { "fill-opacity": 0 },
    });
  }

  if (!map.getLayer(COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID)) {
    map.addLayer({
      id: COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
      type: "fill",
      source: COUNTY_BOUNDARY_SOURCE_ID,
      filter: ["==", ["get", "county"], "__none__"],
      layout: { visibility: boundaryMode === "counties" ? "visible" : "none" },
      paint: {},
    });
  }

  if (!map.getLayer(COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID)) {
    map.addLayer({
      id: COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
      type: "line",
      source: COUNTY_BOUNDARY_SOURCE_ID,
      filter: ["==", ["get", "county"], "__none__"],
      layout: { visibility: boundaryMode === "counties" ? "visible" : "none" },
      paint: {},
    });
  }

  if (!map.getLayer(COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID)) {
    map.addLayer({
      id: COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID,
      type: "fill",
      source: COUNTY_BOUNDARY_SOURCE_ID,
      filter: ["==", ["get", "county"], "__none__"],
      layout: { visibility: boundaryMode === "counties" ? "visible" : "none" },
      paint: {},
    });
  }

  if (!map.getLayer(COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID)) {
    map.addLayer({
      id: COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID,
      type: "line",
      source: COUNTY_BOUNDARY_SOURCE_ID,
      filter: ["==", ["get", "county"], "__none__"],
      layout: { visibility: boundaryMode === "counties" ? "visible" : "none" },
      paint: {},
    });
  }

  // Keep secondary overlays above choropleth fills after initial load/style resets.
  const placeSecondaryOverlayPair = (hoverLayerId: string, layerId: string) => {
    if (!map.getLayer(layerId)) return;
    try {
      const before = map.getLayer(LAYER_CLUSTERS_ID) ? LAYER_CLUSTERS_ID : undefined;
      if (before) map.moveLayer(layerId, before);
      else map.moveLayer(layerId);
    } catch {}
    if (!map.getLayer(hoverLayerId)) return;
    try {
      map.moveLayer(hoverLayerId, layerId);
    } catch {}
  };

  placeSecondaryOverlayPair(SECONDARY_STAT_HOVER_LAYER_ID, SECONDARY_STAT_LAYER_ID);
  placeSecondaryOverlayPair(COUNTY_SECONDARY_HOVER_LAYER_ID, COUNTY_SECONDARY_LAYER_ID);
};

export const updateBoundaryPaint = (
  map: maplibregl.Map,
  ids: BoundaryLayerIds,
  theme: "light" | "dark",
) => {
  const {
    BOUNDARY_FILL_LAYER_ID,
    BOUNDARY_LINE_LAYER_ID,
    BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
    BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
    BOUNDARY_PINNED_FILL_LAYER_ID,
    BOUNDARY_PINNED_LINE_LAYER_ID,
    BOUNDARY_HOVER_LINE_LAYER_ID,
    BOUNDARY_HOVER_FILL_LAYER_ID,
    COUNTY_BOUNDARY_FILL_LAYER_ID,
    COUNTY_BOUNDARY_LINE_LAYER_ID,
    COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
    COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
  } = ids;
  const zipBasePaint = zipAreaEntry.getBasePaint(theme);
  const zipHoverPaint = zipAreaEntry.getHoverPaint(theme);
  const zipHighlightPaint = zipAreaEntry.getHighlightPaint(theme);
  const zipPinnedPaint = zipAreaEntry.getPinnedPaint(theme);
  if (map.getLayer(BOUNDARY_FILL_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_FILL_LAYER_ID, "fill-color", zipBasePaint.fill.color);
    map.setPaintProperty(BOUNDARY_FILL_LAYER_ID, "fill-opacity", zipBasePaint.fill.opacity);
  }
  if (map.getLayer(BOUNDARY_LINE_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_LINE_LAYER_ID, "line-color", zipBasePaint.line.color);
    map.setPaintProperty(BOUNDARY_LINE_LAYER_ID, "line-opacity", zipBasePaint.line.opacity);
    map.setPaintProperty(BOUNDARY_LINE_LAYER_ID, "line-width", zipBasePaint.line.width);
  }
  if (map.getLayer(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, "fill-color", zipHighlightPaint.fill.color);
    map.setPaintProperty(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, "fill-opacity", zipHighlightPaint.fill.opacity);
  }
  if (map.getLayer(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-color", zipHighlightPaint.line.color);
    map.setPaintProperty(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-width", zipHighlightPaint.line.width);
    map.setPaintProperty(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-opacity", zipHighlightPaint.line.opacity);
  }
  if (map.getLayer(BOUNDARY_PINNED_FILL_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_PINNED_FILL_LAYER_ID, "fill-color", zipPinnedPaint.fill.color);
    map.setPaintProperty(BOUNDARY_PINNED_FILL_LAYER_ID, "fill-opacity", zipPinnedPaint.fill.opacity);
  }
  if (map.getLayer(BOUNDARY_PINNED_LINE_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_PINNED_LINE_LAYER_ID, "line-color", zipPinnedPaint.line.color);
    map.setPaintProperty(BOUNDARY_PINNED_LINE_LAYER_ID, "line-width", zipPinnedPaint.line.width);
    map.setPaintProperty(BOUNDARY_PINNED_LINE_LAYER_ID, "line-opacity", zipPinnedPaint.line.opacity);
  }
  if (map.getLayer(BOUNDARY_HOVER_LINE_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-color", zipHoverPaint.line.color);
    map.setPaintProperty(
      BOUNDARY_HOVER_LINE_LAYER_ID,
      "line-opacity",
      scaleHoverOpacity(zipHoverPaint.line.opacity),
    );
    map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-width", zipHoverPaint.line.width);
    map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-opacity-transition", HOVER_OPACITY_TRANSITION as any);
  }
  if (map.getLayer(BOUNDARY_HOVER_FILL_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_HOVER_FILL_LAYER_ID, "fill-color", zipHoverPaint.fill.color);
    map.setPaintProperty(
      BOUNDARY_HOVER_FILL_LAYER_ID,
      "fill-opacity",
      scaleHoverOpacity(zipHoverPaint.fill.opacity),
    );
    map.setPaintProperty(BOUNDARY_HOVER_FILL_LAYER_ID, "fill-opacity-transition", HOVER_OPACITY_TRANSITION as any);
  }
  const countyBasePaint = countyAreaEntry.getBasePaint(theme);
  const countyHoverPaint = countyAreaEntry.getHoverPaint(theme);
  const countyHighlightPaint = countyAreaEntry.getHighlightPaint(theme);
  const countyPinnedPaint = countyAreaEntry.getPinnedPaint(theme);
  if (map.getLayer(COUNTY_BOUNDARY_FILL_LAYER_ID)) {
    map.setPaintProperty(COUNTY_BOUNDARY_FILL_LAYER_ID, "fill-color", countyBasePaint.fill.color);
    map.setPaintProperty(COUNTY_BOUNDARY_FILL_LAYER_ID, "fill-opacity", countyBasePaint.fill.opacity);
  }
  if (map.getLayer(COUNTY_BOUNDARY_LINE_LAYER_ID)) {
    map.setPaintProperty(COUNTY_BOUNDARY_LINE_LAYER_ID, "line-color", countyBasePaint.line.color);
    map.setPaintProperty(COUNTY_BOUNDARY_LINE_LAYER_ID, "line-opacity", countyBasePaint.line.opacity);
    map.setPaintProperty(COUNTY_BOUNDARY_LINE_LAYER_ID, "line-width", countyBasePaint.line.width);
  }
  if (map.getLayer(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID)) {
    map.setPaintProperty(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, "fill-color", countyHoverPaint.fill.color);
    map.setPaintProperty(
      COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
      "fill-opacity",
      scaleHoverOpacity(countyHoverPaint.fill.opacity),
    );
    map.setPaintProperty(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, "fill-opacity-transition", HOVER_OPACITY_TRANSITION as any);
  }
  if (map.getLayer(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID)) {
    map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-color", countyHoverPaint.line.color);
    map.setPaintProperty(
      COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
      "line-opacity",
      scaleHoverOpacity(countyHoverPaint.line.opacity),
    );
    map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-width", countyHoverPaint.line.width);
    map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-opacity-transition", HOVER_OPACITY_TRANSITION as any);
  }
  if (map.getLayer(COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID)) {
    map.setPaintProperty(COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, "fill-color", countyHighlightPaint.fill.color);
    map.setPaintProperty(COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, "fill-opacity", countyHighlightPaint.fill.opacity);
  }
  if (map.getLayer(COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID)) {
    map.setPaintProperty(COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-color", countyHighlightPaint.line.color);
    map.setPaintProperty(COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-opacity", countyHighlightPaint.line.opacity);
    map.setPaintProperty(COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-width", countyHighlightPaint.line.width);
  }
  if (map.getLayer(COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID)) {
    map.setPaintProperty(COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID, "fill-color", countyPinnedPaint.fill.color);
    map.setPaintProperty(COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID, "fill-opacity", countyPinnedPaint.fill.opacity);
  }
  if (map.getLayer(COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID)) {
    map.setPaintProperty(COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID, "line-color", countyPinnedPaint.line.color);
    map.setPaintProperty(COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID, "line-opacity", countyPinnedPaint.line.opacity);
    map.setPaintProperty(COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID, "line-width", countyPinnedPaint.line.width);
  }
};

export const updateBoundaryVisibility = (
  map: maplibregl.Map,
  ids: BoundaryLayerIds,
  boundaryMode: BoundaryMode,
  options?: { hideZipGeometry?: boolean },
) => {
  const {
    BOUNDARY_FILL_LAYER_ID,
    BOUNDARY_STATDATA_FILL_LAYER_ID,
    SECONDARY_STAT_LAYER_ID,
    SECONDARY_STAT_HOVER_LAYER_ID,
    COUNTY_SECONDARY_LAYER_ID,
    COUNTY_SECONDARY_HOVER_LAYER_ID,
    BOUNDARY_LINE_LAYER_ID,
    BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
    BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
    BOUNDARY_PINNED_FILL_LAYER_ID,
    BOUNDARY_PINNED_LINE_LAYER_ID,
    BOUNDARY_HOVER_LINE_LAYER_ID,
    BOUNDARY_HOVER_FILL_LAYER_ID,
    COUNTY_BOUNDARY_FILL_LAYER_ID,
    COUNTY_BOUNDARY_LINE_LAYER_ID,
    COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
    COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
    COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
    COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
    COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID,
    COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID,
    COUNTY_STATDATA_FILL_LAYER_ID,
  } = ids;
  const hideZipGeometry = Boolean(options?.hideZipGeometry);
  const zipVisibility = boundaryMode === "zips" && !hideZipGeometry ? "visible" : "none";
  const countyVisibility = boundaryMode === "counties" ? "visible" : "none";
  const setVis = (layerId: string, visibility: "visible" | "none") => {
    if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility);
  };
  setVis(BOUNDARY_FILL_LAYER_ID, zipVisibility);
  setVis(BOUNDARY_STATDATA_FILL_LAYER_ID, zipVisibility);
  setVis(SECONDARY_STAT_LAYER_ID, zipVisibility);
  setVis(SECONDARY_STAT_HOVER_LAYER_ID, zipVisibility);
  setVis(BOUNDARY_LINE_LAYER_ID, zipVisibility);
  setVis(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, zipVisibility);
  setVis(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, zipVisibility);
  setVis(BOUNDARY_PINNED_FILL_LAYER_ID, zipVisibility);
  setVis(BOUNDARY_PINNED_LINE_LAYER_ID, zipVisibility);
  setVis(BOUNDARY_HOVER_LINE_LAYER_ID, zipVisibility);
  setVis(BOUNDARY_HOVER_FILL_LAYER_ID, zipVisibility);
  setVis(COUNTY_BOUNDARY_FILL_LAYER_ID, countyVisibility);
  setVis(COUNTY_BOUNDARY_LINE_LAYER_ID, countyVisibility);
  setVis(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, countyVisibility);
  setVis(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, countyVisibility);
  setVis(COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, countyVisibility);
  setVis(COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, countyVisibility);
  setVis(COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID, countyVisibility);
  setVis(COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID, countyVisibility);
  setVis(COUNTY_STATDATA_FILL_LAYER_ID, countyVisibility);
  setVis(COUNTY_SECONDARY_LAYER_ID, countyVisibility);
  setVis(COUNTY_SECONDARY_HOVER_LAYER_ID, countyVisibility);
};

export const updateZipSelectionHighlight = (
  map: maplibregl.Map,
  ids: BoundaryLayerIds,
  theme: "light" | "dark",
  selectedStatId: string | null,
  pinnedZips: Set<string>,
  transientZips: Set<string>,
) => {
  const { BOUNDARY_PINNED_FILL_LAYER_ID, BOUNDARY_PINNED_LINE_LAYER_ID, BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, BOUNDARY_HIGHLIGHT_LINE_LAYER_ID } = ids;
  const pinned = Array.from(pinnedZips);
  const transient = Array.from(transientZips).filter((z) => !pinnedZips.has(z));
  const pinnedFilter = pinned.length ? (["in", ["get", "zip"], ["literal", pinned]] as any) : (["==", ["get", "zip"], "__none__"] as any);
  const transFilter = transient.length ? (["in", ["get", "zip"], ["literal", transient]] as any) : (["==", ["get", "zip"], "__none__"] as any);
  const hasStatOverlay = Boolean(selectedStatId);
  const fillFilter = hasStatOverlay ? (["==", ["get", "zip"], "__none__"] as any) : null;
  if (map.getLayer(BOUNDARY_PINNED_FILL_LAYER_ID)) map.setFilter(BOUNDARY_PINNED_FILL_LAYER_ID, fillFilter || pinnedFilter);
  if (map.getLayer(BOUNDARY_PINNED_LINE_LAYER_ID)) {
    map.setFilter(BOUNDARY_PINNED_LINE_LAYER_ID, pinnedFilter);
    const pinnedPaint = zipAreaEntry.getPinnedPaint(theme);
    const overlayLine = zipAreaEntry.getSelectionOverlayLine(theme);
    const targetLine = hasStatOverlay ? overlayLine : pinnedPaint.line;
    map.setPaintProperty(BOUNDARY_PINNED_LINE_LAYER_ID, "line-width", targetLine.width);
    map.setPaintProperty(BOUNDARY_PINNED_LINE_LAYER_ID, "line-color", targetLine.color);
    map.setPaintProperty(BOUNDARY_PINNED_LINE_LAYER_ID, "line-opacity", targetLine.opacity);
    if (!hasStatOverlay) {
      map.setPaintProperty(BOUNDARY_PINNED_FILL_LAYER_ID, "fill-color", pinnedPaint.fill.color);
      map.setPaintProperty(BOUNDARY_PINNED_FILL_LAYER_ID, "fill-opacity", pinnedPaint.fill.opacity);
    }
  }
  if (map.getLayer(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID)) map.setFilter(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, fillFilter || transFilter);
  if (map.getLayer(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID)) {
    map.setFilter(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, transFilter);
    const highlightPaint = zipAreaEntry.getHighlightPaint(theme);
    const overlayLine = zipAreaEntry.getSelectionOverlayLine(theme);
    const targetLine = hasStatOverlay ? overlayLine : highlightPaint.line;
    map.setPaintProperty(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-width", targetLine.width);
    map.setPaintProperty(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-color", targetLine.color);
    map.setPaintProperty(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-opacity", targetLine.opacity);
    if (!hasStatOverlay) {
      map.setPaintProperty(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, "fill-color", highlightPaint.fill.color);
      map.setPaintProperty(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, "fill-opacity", highlightPaint.fill.opacity);
    }
  }
};

export const updateZipHoverOutline = (
  map: maplibregl.Map,
  ids: BoundaryLayerIds,
  theme: "light" | "dark",
  selectedStatId: string | null,
  pinnedZips: Set<string>,
  transientZips: Set<string>,
  hoveredZip: string | null,
  options?: {
    previewOnly?: boolean;
    trailingZipId?: string | null;
  },
) => {
  const { BOUNDARY_HOVER_LINE_LAYER_ID, BOUNDARY_HOVER_FILL_LAYER_ID } = ids;
  const lineLayer = map.getLayer(BOUNDARY_HOVER_LINE_LAYER_ID);
  const fillLayer = map.getLayer(BOUNDARY_HOVER_FILL_LAYER_ID);
  if (!lineLayer && !fillLayer) return;

  if (!hoveredZip) {
    // Fade out first, then clear filter after transition completes.
    if (lineLayer) map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-opacity", 0);
    if (fillLayer) map.setPaintProperty(BOUNDARY_HOVER_FILL_LAYER_ID, "fill-opacity", 0);
    map.triggerRepaint();
    scheduleZipHoverFilterClear(map, {
      line: BOUNDARY_HOVER_LINE_LAYER_ID,
      fill: BOUNDARY_HOVER_FILL_LAYER_ID,
    });
    return;
  }

  cancelZipHoverFilterClear(map);
  const hoverFilter = buildHoverFilter("zip", hoveredZip, options?.trailingZipId);
  if (lineLayer) map.setFilter(BOUNDARY_HOVER_LINE_LAYER_ID, hoverFilter);
  if (fillLayer) map.setFilter(BOUNDARY_HOVER_FILL_LAYER_ID, hoverFilter);
  map.triggerRepaint();
  const opacityMultiplier = options?.previewOnly ? PREVIEW_HOVER_OPACITY_MULTIPLIER : 1;
  const isPinned = pinnedZips.has(hoveredZip);
  const isSelected = transientZips.has(hoveredZip);
  const hasStatOverlay = Boolean(selectedStatId);
  const hoverPaint = zipAreaEntry.getHoverPaint(theme);
  if (hasStatOverlay && (isSelected || isPinned)) {
    if (map.getLayer(BOUNDARY_HOVER_LINE_LAYER_ID)) {
      const hoverLineColor = theme === "dark" ? "#ffffff" : "#000000";
      map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-color", hoverLineColor);
      map.setPaintProperty(
        BOUNDARY_HOVER_LINE_LAYER_ID,
        "line-opacity",
        scaleHoverOpacity(0.95) * opacityMultiplier,
      );
      map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-width", 1.5);
    }
    if (map.getLayer(BOUNDARY_HOVER_FILL_LAYER_ID)) {
      const fillOpacity = theme === "dark" ? 0.32 : 0.26;
      map.setPaintProperty(
        BOUNDARY_HOVER_FILL_LAYER_ID,
        "fill-opacity",
        scaleHoverOpacity(fillOpacity) * opacityMultiplier,
      );
    }
    return;
  }
  if (map.getLayer(BOUNDARY_HOVER_LINE_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-color", hoverPaint.line.color);
    map.setPaintProperty(
      BOUNDARY_HOVER_LINE_LAYER_ID,
      "line-opacity",
      scaleHoverOpacity(hoverPaint.line.opacity) * opacityMultiplier,
    );
    map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-width", hoverPaint.line.width);
  }
  if (map.getLayer(BOUNDARY_HOVER_FILL_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_HOVER_FILL_LAYER_ID, "fill-color", hoverPaint.fill.color);
    map.setPaintProperty(
      BOUNDARY_HOVER_FILL_LAYER_ID,
      "fill-opacity",
      scaleHoverOpacity(hoverPaint.fill.opacity) * opacityMultiplier,
    );
  }
};

export const updateCountyHoverOutline = (
  map: maplibregl.Map,
  ids: BoundaryLayerIds,
  theme: "light" | "dark",
  selectedStatId: string | null,
  pinnedCounties: Set<string>,
  transientCounties: Set<string>,
  countyId: string | null,
  options?: {
    previewOnly?: boolean;
    trailingCountyId?: string | null;
  },
) => {
  const { COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID } = ids;
  const fillLayer = map.getLayer(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID);
  const lineLayer = map.getLayer(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID);
  if (!fillLayer && !lineLayer) return;

  if (!countyId) {
    // Fade out first, then clear filter after transition completes.
    if (lineLayer) map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-opacity", 0);
    if (fillLayer) map.setPaintProperty(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, "fill-opacity", 0);
    map.triggerRepaint();
    scheduleCountyHoverFilterClear(map, {
      line: COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
      fill: COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
    });
    return;
  }

  cancelCountyHoverFilterClear(map);
  const hoverFilter = buildHoverFilter("county", countyId, options?.trailingCountyId);
  if (fillLayer) map.setFilter(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, hoverFilter);
  if (lineLayer) map.setFilter(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, hoverFilter);
  map.triggerRepaint();
  const opacityMultiplier = options?.previewOnly ? PREVIEW_HOVER_OPACITY_MULTIPLIER : 1;
  const isPinned = pinnedCounties.has(countyId);
  const isSelected = transientCounties.has(countyId);
  const hasStatOverlay = Boolean(selectedStatId);
  const hoverPaint = countyAreaEntry.getHoverPaint(theme);
  if (map.getLayer(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID)) {
    if (hasStatOverlay && (isPinned || isSelected)) {
      const hoverLineColor = theme === "dark" ? "#ffffff" : "#000000";
      map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-color", hoverLineColor);
      map.setPaintProperty(
        COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
        "line-opacity",
        scaleHoverOpacity(0.95) * opacityMultiplier,
      );
      map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-width", 1.5);
    } else {
      map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-color", hoverPaint.line.color);
      map.setPaintProperty(
        COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
        "line-opacity",
        scaleHoverOpacity(hoverPaint.line.opacity) * opacityMultiplier,
      );
      map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-width", hoverPaint.line.width);
    }
  }
  if (map.getLayer(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID)) {
    if (hasStatOverlay && (isPinned || isSelected)) {
      const fillOpacity = theme === "dark" ? 0.32 : 0.26;
      map.setPaintProperty(
        COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
        "fill-opacity",
        scaleHoverOpacity(fillOpacity) * opacityMultiplier,
      );
    } else {
      map.setPaintProperty(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, "fill-color", hoverPaint.fill.color);
      map.setPaintProperty(
        COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
        "fill-opacity",
        scaleHoverOpacity(hoverPaint.fill.opacity) * opacityMultiplier,
      );
    }
  }
};

export const updateCountySelectionHighlight = (
  map: maplibregl.Map,
  ids: BoundaryLayerIds,
  theme: "light" | "dark",
  selectedStatId: string | null,
  pinnedCounties: Set<string>,
  transientCounties: Set<string>,
) => {
  const {
    COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID,
    COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID,
    COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
    COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
  } = ids;
  const pinned = Array.from(pinnedCounties);
  const transient = Array.from(transientCounties).filter((id) => !pinnedCounties.has(id));
  const pinnedFilter = pinned.length ? (["in", ["get", "county"], ["literal", pinned]] as any) : (["==", ["get", "county"], "__none__"] as any);
  const transientFilter = transient.length ? (["in", ["get", "county"], ["literal", transient]] as any) : (["==", ["get", "county"], "__none__"] as any);
  const hasStatOverlay = Boolean(selectedStatId);
  if (map.getLayer(COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID)) {
    const fillFilter = hasStatOverlay ? (["==", ["get", "county"], "__none__"] as any) : pinnedFilter;
    map.setFilter(COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID, fillFilter);
    if (!hasStatOverlay) {
      const pinnedPaint = countyAreaEntry.getPinnedPaint(theme);
      map.setPaintProperty(COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID, "fill-color", pinnedPaint.fill.color);
      map.setPaintProperty(COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID, "fill-opacity", pinnedPaint.fill.opacity);
    }
  }
  if (map.getLayer(COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID)) {
    map.setFilter(COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID, pinnedFilter);
    const pinnedPaint = countyAreaEntry.getPinnedPaint(theme);
    const overlayLine = countyAreaEntry.getSelectionOverlayLine(theme);
    const targetLine = hasStatOverlay ? overlayLine : pinnedPaint.line;
    map.setPaintProperty(COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID, "line-width", targetLine.width);
    map.setPaintProperty(COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID, "line-color", targetLine.color);
    map.setPaintProperty(COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID, "line-opacity", targetLine.opacity);
  }
  if (map.getLayer(COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID)) {
    const fillFilter = hasStatOverlay ? (["==", ["get", "county"], "__none__"] as any) : transientFilter;
    map.setFilter(COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, fillFilter);
    if (!hasStatOverlay) {
      const highlightPaint = countyAreaEntry.getHighlightPaint(theme);
      map.setPaintProperty(COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, "fill-color", highlightPaint.fill.color);
      map.setPaintProperty(COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, "fill-opacity", highlightPaint.fill.opacity);
    }
  }
  if (map.getLayer(COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID)) {
    map.setFilter(COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, transientFilter);
    const highlightPaint = countyAreaEntry.getHighlightPaint(theme);
    const overlayLine = countyAreaEntry.getSelectionOverlayLine(theme);
    const targetLine = hasStatOverlay ? overlayLine : highlightPaint.line;
    map.setPaintProperty(COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-width", targetLine.width);
    map.setPaintProperty(COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-color", targetLine.color);
    map.setPaintProperty(COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-opacity", targetLine.opacity);
  }
};
