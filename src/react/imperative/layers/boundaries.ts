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


