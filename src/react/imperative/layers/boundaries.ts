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
      paint: { "line-opacity-transition": { duration: 0, delay: 0 } as any },
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
        paint: { "fill-opacity-transition": { duration: 0, delay: 0 } as any },
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
      paint: {},
    });
  }

  if (!map.getLayer(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID)) {
    map.addLayer({
      id: COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
      type: "line",
      source: COUNTY_BOUNDARY_SOURCE_ID,
      filter: ["==", ["get", "county"], "__none__"],
      layout: { visibility: boundaryMode === "counties" ? "visible" : "none" },
      paint: {},
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
    map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-opacity", zipHoverPaint.line.opacity);
    map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-width", zipHoverPaint.line.width);
    map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-opacity-transition", { duration: 0, delay: 0 } as any);
  }
  if (map.getLayer(BOUNDARY_HOVER_FILL_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_HOVER_FILL_LAYER_ID, "fill-color", zipHoverPaint.fill.color);
    map.setPaintProperty(BOUNDARY_HOVER_FILL_LAYER_ID, "fill-opacity", zipHoverPaint.fill.opacity);
    map.setPaintProperty(BOUNDARY_HOVER_FILL_LAYER_ID, "fill-opacity-transition", { duration: 0, delay: 0 } as any);
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
    map.setPaintProperty(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, "fill-opacity", countyHoverPaint.fill.opacity);
  }
  if (map.getLayer(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID)) {
    map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-color", countyHoverPaint.line.color);
    map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-opacity", countyHoverPaint.line.opacity);
    map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-width", countyHoverPaint.line.width);
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
) => {
  const { BOUNDARY_HOVER_LINE_LAYER_ID, BOUNDARY_HOVER_FILL_LAYER_ID } = ids;
  const filter = hoveredZip ? (["==", ["get", "zip"], hoveredZip] as any) : (["==", ["get", "zip"], "__none__"] as any);
  if (map.getLayer(BOUNDARY_HOVER_LINE_LAYER_ID)) map.setFilter(BOUNDARY_HOVER_LINE_LAYER_ID, filter);
  if (map.getLayer(BOUNDARY_HOVER_FILL_LAYER_ID)) map.setFilter(BOUNDARY_HOVER_FILL_LAYER_ID, filter);
  // Force immediate repaint to avoid hover trailing
  map.triggerRepaint();
  if (!hoveredZip) return;
  const isPinned = pinnedZips.has(hoveredZip);
  const isSelected = transientZips.has(hoveredZip);
  const hasStatOverlay = Boolean(selectedStatId);
  const hoverPaint = zipAreaEntry.getHoverPaint(theme);
  if (hasStatOverlay && (isSelected || isPinned)) {
    if (map.getLayer(BOUNDARY_HOVER_LINE_LAYER_ID)) {
      const hoverLineColor = theme === "dark" ? "#ffffff" : "#000000";
      map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-color", hoverLineColor);
      map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-opacity", 0.95);
      map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-width", 1.5);
    }
    if (map.getLayer(BOUNDARY_HOVER_FILL_LAYER_ID)) {
      const fillOpacity = theme === "dark" ? 0.32 : 0.26;
      map.setPaintProperty(BOUNDARY_HOVER_FILL_LAYER_ID, "fill-opacity", fillOpacity);
    }
    return;
  }
  if (map.getLayer(BOUNDARY_HOVER_LINE_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-color", hoverPaint.line.color);
    map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-opacity", hoverPaint.line.opacity);
    map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-width", hoverPaint.line.width);
  }
  if (map.getLayer(BOUNDARY_HOVER_FILL_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_HOVER_FILL_LAYER_ID, "fill-color", hoverPaint.fill.color);
    map.setPaintProperty(BOUNDARY_HOVER_FILL_LAYER_ID, "fill-opacity", hoverPaint.fill.opacity);
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
) => {
  const { COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID } = ids;
  const filter = countyId ? (["==", ["get", "county"], countyId] as any) : (["==", ["get", "county"], "__none__"] as any);
  if (map.getLayer(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID)) map.setFilter(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, filter);
  if (map.getLayer(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID)) map.setFilter(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, filter);
  // Force immediate repaint to avoid hover trailing
  map.triggerRepaint();
  if (!countyId) return;
  const isPinned = pinnedCounties.has(countyId);
  const isSelected = transientCounties.has(countyId);
  const hasStatOverlay = Boolean(selectedStatId);
  const hoverPaint = countyAreaEntry.getHoverPaint(theme);
  if (map.getLayer(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID)) {
    if (hasStatOverlay && (isPinned || isSelected)) {
      const hoverLineColor = theme === "dark" ? "#ffffff" : "#000000";
      map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-color", hoverLineColor);
      map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-opacity", 0.95);
      map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-width", 1.5);
    } else {
      map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-color", hoverPaint.line.color);
      map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-opacity", hoverPaint.line.opacity);
      map.setPaintProperty(COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID, "line-width", hoverPaint.line.width);
    }
  }
  if (map.getLayer(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID)) {
    if (hasStatOverlay && (isPinned || isSelected)) {
      const fillOpacity = theme === "dark" ? 0.32 : 0.26;
      map.setPaintProperty(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, "fill-opacity", fillOpacity);
    } else {
      map.setPaintProperty(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, "fill-color", hoverPaint.fill.color);
      map.setPaintProperty(COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID, "fill-opacity", hoverPaint.fill.opacity);
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
