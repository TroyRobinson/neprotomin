import type maplibregl from "maplibre-gl";

import { tulsaZipBoundaries } from "../../../data/tulsaZipBoundaries";
import type { BoundaryMode } from "../../../types/boundaries";
import { getZipCentroidFeatureCollection } from "../../../lib/zipCentroids";
import { getBoundaryPalette } from "../styles/boundaryPalettes";
import { LAYER_CLUSTERS_ID } from "../constants/map";

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
  } = ids;

  if (!map.getSource(BOUNDARY_SOURCE_ID)) {
    map.addSource(BOUNDARY_SOURCE_ID, { type: "geojson", data: tulsaZipBoundaries });
  }
  const boundarySource = map.getSource(BOUNDARY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
  try { boundarySource?.setData(tulsaZipBoundaries as any); } catch {}

  if (!map.getLayer(BOUNDARY_FILL_LAYER_ID)) {
    const palette = getBoundaryPalette(theme);
    map.addLayer({
      id: BOUNDARY_FILL_LAYER_ID,
      type: "fill",
      source: BOUNDARY_SOURCE_ID,
      layout: { visibility: boundaryMode === "zips" ? "visible" : "none" },
      paint: { "fill-color": palette.fillColor, "fill-opacity": palette.fillOpacity },
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
    const palette = getBoundaryPalette(theme);
    map.addLayer({
      id: BOUNDARY_LINE_LAYER_ID,
      type: "line",
      source: BOUNDARY_SOURCE_ID,
      layout: { visibility: boundaryMode === "zips" ? "visible" : "none" },
      paint: { "line-color": palette.lineColor, "line-opacity": palette.lineOpacity, "line-width": 0.6 },
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
      paint: { "line-opacity-transition": { duration: 150, delay: 0 } as any },
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
        paint: { "fill-opacity-transition": { duration: 150, delay: 0 } as any },
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
        "circle-color": "#0f766e",
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
        "circle-color": "#0f766e",
        "circle-opacity": 0,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-translate": [0, 0],
      } as any,
    };
    if (before) map.addLayer(layer, before);
    else map.addLayer(layer);
  }
};

export const updateBoundaryPaint = (
  map: maplibregl.Map,
  ids: BoundaryLayerIds,
  theme: "light" | "dark",
) => {
  const { BOUNDARY_FILL_LAYER_ID, BOUNDARY_LINE_LAYER_ID, BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, BOUNDARY_PINNED_FILL_LAYER_ID, BOUNDARY_PINNED_LINE_LAYER_ID, BOUNDARY_HOVER_LINE_LAYER_ID, BOUNDARY_HOVER_FILL_LAYER_ID } = ids;
  const palette = getBoundaryPalette(theme);
  if (map.getLayer(BOUNDARY_FILL_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_FILL_LAYER_ID, "fill-color", palette.fillColor);
    map.setPaintProperty(BOUNDARY_FILL_LAYER_ID, "fill-opacity", palette.fillOpacity);
  }
  if (map.getLayer(BOUNDARY_LINE_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_LINE_LAYER_ID, "line-color", palette.lineColor);
    map.setPaintProperty(BOUNDARY_LINE_LAYER_ID, "line-opacity", palette.lineOpacity);
  }
  if (map.getLayer(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, "fill-color", "#3755f0");
    map.setPaintProperty(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, "fill-opacity", theme === "dark" ? 0.26 : 0.20);
  }
  if (map.getLayer(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-color", "#6d8afc");
    map.setPaintProperty(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-width", 1);
    map.setPaintProperty(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-opacity", 0.9);
  }
  if (map.getLayer(BOUNDARY_PINNED_FILL_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_PINNED_FILL_LAYER_ID, "fill-color", "#3755f0");
    map.setPaintProperty(BOUNDARY_PINNED_FILL_LAYER_ID, "fill-opacity", theme === "dark" ? 0.26 : 0.20);
  }
  if (map.getLayer(BOUNDARY_PINNED_LINE_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_PINNED_LINE_LAYER_ID, "line-color", "#6d8afc");
    map.setPaintProperty(BOUNDARY_PINNED_LINE_LAYER_ID, "line-width", 1);
    map.setPaintProperty(BOUNDARY_PINNED_LINE_LAYER_ID, "line-opacity", 0.9);
  }
  if (map.getLayer(BOUNDARY_HOVER_LINE_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-width", 0.9);
    map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-opacity-transition", { duration: 150, delay: 0 } as any);
  }
  if (map.getLayer(BOUNDARY_HOVER_FILL_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_HOVER_FILL_LAYER_ID, "fill-opacity-transition", { duration: 150, delay: 0 } as any);
  }
};

export const updateBoundaryVisibility = (
  map: maplibregl.Map,
  ids: BoundaryLayerIds,
  boundaryMode: BoundaryMode,
) => {
  const { BOUNDARY_FILL_LAYER_ID, BOUNDARY_STATDATA_FILL_LAYER_ID, SECONDARY_STAT_LAYER_ID, SECONDARY_STAT_HOVER_LAYER_ID, BOUNDARY_LINE_LAYER_ID, BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, BOUNDARY_PINNED_FILL_LAYER_ID, BOUNDARY_PINNED_LINE_LAYER_ID, BOUNDARY_HOVER_LINE_LAYER_ID, BOUNDARY_HOVER_FILL_LAYER_ID } = ids;
  const visibility = boundaryMode === "zips" ? "visible" : "none";
  const setVis = (layerId: string) => { if (map.getLayer(layerId)) map.setLayoutProperty(layerId, "visibility", visibility); };
  setVis(BOUNDARY_FILL_LAYER_ID);
  setVis(BOUNDARY_STATDATA_FILL_LAYER_ID);
  setVis(SECONDARY_STAT_LAYER_ID);
  setVis(SECONDARY_STAT_HOVER_LAYER_ID);
  setVis(BOUNDARY_LINE_LAYER_ID);
  setVis(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID);
  setVis(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID);
  setVis(BOUNDARY_PINNED_FILL_LAYER_ID);
  setVis(BOUNDARY_PINNED_LINE_LAYER_ID);
  setVis(BOUNDARY_HOVER_LINE_LAYER_ID);
  setVis(BOUNDARY_HOVER_FILL_LAYER_ID);
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
    const lineWidth = hasStatOverlay ? 1.5 : 1;
    const lineColor = hasStatOverlay ? (theme === "dark" ? "#e6e6e6" : "#46576f") : "#6d8afc";
    map.setPaintProperty(BOUNDARY_PINNED_LINE_LAYER_ID, "line-width", lineWidth);
    map.setPaintProperty(BOUNDARY_PINNED_LINE_LAYER_ID, "line-color", lineColor);
  }
  if (map.getLayer(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID)) map.setFilter(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, fillFilter || transFilter);
  if (map.getLayer(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID)) {
    map.setFilter(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, transFilter);
    const lineWidth = hasStatOverlay ? 1.5 : 1;
    const lineColor = hasStatOverlay ? (theme === "dark" ? "#e6e6e6" : "#46576f") : "#6d8afc";
    map.setPaintProperty(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-width", lineWidth);
    map.setPaintProperty(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "line-color", lineColor);
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
  if (!hoveredZip) return;
  const isPinned = pinnedZips.has(hoveredZip);
  const isSelected = transientZips.has(hoveredZip);
  const hasStatOverlay = Boolean(selectedStatId);
  if (hasStatOverlay && (isSelected || isPinned)) {
    if (map.getLayer(BOUNDARY_HOVER_LINE_LAYER_ID)) {
      const hoverLineColor = theme === "dark" ? "#ffffff" : "#000000";
      map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-color", hoverLineColor);
      map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-opacity", 0.95);
    }
    if (map.getLayer(BOUNDARY_HOVER_FILL_LAYER_ID)) {
      const fillOpacity = theme === "dark" ? 0.32 : 0.26;
      map.setPaintProperty(BOUNDARY_HOVER_FILL_LAYER_ID, "fill-opacity", fillOpacity);
    }
    return;
  }
  const hoverColors = theme === "dark"
    ? { fillColor: "#94a3b8", lineColor: "#cbd5e1" }
    : { fillColor: "#1f2937", lineColor: "#475569" };
  if (map.getLayer(BOUNDARY_HOVER_LINE_LAYER_ID)) {
    map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-color", hoverColors.lineColor);
    map.setPaintProperty(BOUNDARY_HOVER_LINE_LAYER_ID, "line-opacity", 0.90);
  }
  if (map.getLayer(BOUNDARY_HOVER_FILL_LAYER_ID)) {
    const opacity = theme === "dark" ? 0.18 : 0.12;
    map.setPaintProperty(BOUNDARY_HOVER_FILL_LAYER_ID, "fill-color", hoverColors.fillColor);
    map.setPaintProperty(BOUNDARY_HOVER_FILL_LAYER_ID, "fill-opacity", opacity);
  }
};


