import type maplibregl from "maplibre-gl";

export interface OrgLayerIds {
  SOURCE_ID: string;
  LAYER_CLUSTERS_ID: string;
  LAYER_CLUSTER_COUNT_ID: string;
  LAYER_POINTS_ID: string;
  LAYER_HIGHLIGHT_ID: string;
  LAYER_CLUSTER_HIGHLIGHT_ID: string;
}

export const ensureOrganizationLayers = (
  map: maplibregl.Map,
  ids: OrgLayerIds,
  lastData: GeoJSON.FeatureCollection<
    GeoJSON.Point,
    { id: string; name: string; website?: string | null; status?: string | null }
  >,
  isMobile: boolean = false,
): void => {
  const {
    SOURCE_ID,
    LAYER_CLUSTERS_ID,
    LAYER_CLUSTER_COUNT_ID,
    LAYER_POINTS_ID,
    LAYER_HIGHLIGHT_ID,
    LAYER_CLUSTER_HIGHLIGHT_ID,
  } = ids;

  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: lastData,
      cluster: true,
      clusterMaxZoom: 14,
      clusterRadius: 50,
    });
  } else {
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    try { source?.setData(lastData as any); } catch {}
  }

  if (!map.getLayer(LAYER_CLUSTERS_ID)) {
    // On mobile when zoomed in past level 10, make clusters larger for better tap targets
    // Desktop: base 12, >=10 count: 16, >=25 count: 20
    // Mobile + zoom > 10: base 18, >=10 count: 22, >=25 count: 26
    const clusterRadius = isMobile
      ? [
          "step",
          ["zoom"],
          ["step", ["get", "point_count"], 12, 10, 16, 25, 20], // zoom <= 10: desktop sizes
          10.01,
          ["step", ["get", "point_count"], 18, 10, 22, 25, 26], // zoom > 10: larger sizes
        ]
      : ["step", ["get", "point_count"], 12, 10, 16, 25, 20];
    
    map.addLayer({
      id: LAYER_CLUSTERS_ID,
      type: "circle",
      source: SOURCE_ID,
      filter: ["has", "point_count"],
      paint: {
        "circle-radius": clusterRadius,
        "circle-color": "#fed7aa",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-opacity": 0.9,
      } as any,
    });
  } else {
    // Update existing layer with new sizes based on mobile state
    const clusterRadius = isMobile
      ? [
          "step",
          ["zoom"],
          ["step", ["get", "point_count"], 12, 10, 16, 25, 20],
          10.01,
          ["step", ["get", "point_count"], 18, 10, 22, 25, 26],
        ]
      : ["step", ["get", "point_count"], 12, 10, 16, 25, 20];
    try {
      map.setPaintProperty(LAYER_CLUSTERS_ID, "circle-radius", clusterRadius);
    } catch {}
  }

  if (!map.getLayer(LAYER_CLUSTER_COUNT_ID)) {
    // Scale text size proportionally with cluster size on mobile when zoomed in
    const clusterTextSize = isMobile
      ? [
          "step",
          ["zoom"],
          12, // zoom <= 10: normal size
          10.01,
          14, // zoom > 10: slightly larger
        ]
      : 12;
    
    map.addLayer({
      id: LAYER_CLUSTER_COUNT_ID,
      type: "symbol",
      source: SOURCE_ID,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count"],
        "text-font": ["Open Sans Bold"],
        "text-size": clusterTextSize,
      },
      paint: {
        "text-color": "#9a3412",
      },
    });
  } else {
    // Update existing layer text size
    const clusterTextSize = isMobile
      ? [
          "step",
          ["zoom"],
          12,
          10.01,
          14,
        ]
      : 12;
    try {
      map.setLayoutProperty(LAYER_CLUSTER_COUNT_ID, "text-size", clusterTextSize);
    } catch {}
  }

  if (!map.getLayer(LAYER_POINTS_ID)) {
    map.addLayer({
      id: LAYER_POINTS_ID,
      type: "circle",
      source: SOURCE_ID,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": 0,
        "circle-opacity": 0,
        "circle-color": "#f97316",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-radius-transition": { duration: 200, delay: 0 },
        "circle-opacity-transition": { duration: 200, delay: 0 },
      } as any,
    });
    requestAnimationFrame(() => {
      if (!map.getLayer(LAYER_POINTS_ID)) return;
      // On mobile when zoomed in past level 10, make individual points larger (similar to cluster base size)
      // Desktop: 6, Mobile + zoom > 10: 16
      const pointRadius = isMobile
        ? ["step", ["zoom"], 6, 10.01, 16]
        : 6;
      map.setPaintProperty(LAYER_POINTS_ID, "circle-radius", pointRadius);
      map.setPaintProperty(LAYER_POINTS_ID, "circle-opacity", 1);
    });
  } else {
    // Update existing layer point size
    const pointRadius = isMobile
      ? ["step", ["zoom"], 6, 10.01, 16]
      : 6;
    try {
      map.setPaintProperty(LAYER_POINTS_ID, "circle-radius", pointRadius);
    } catch {}
  }

  if (!map.getLayer(LAYER_HIGHLIGHT_ID)) {
    // Scale highlight proportionally with point size on mobile when zoomed in
    // Desktop: 9, Mobile + zoom > 10: 20 (proportional to point size increase from 6 to 16)
    const highlightRadius = isMobile
      ? ["step", ["zoom"], 9, 10.01, 20]
      : 9;
    
    map.addLayer({
      id: LAYER_HIGHLIGHT_ID,
      type: "circle",
      source: SOURCE_ID,
      filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], "__none__"]],
      paint: {
        "circle-radius": highlightRadius,
        "circle-color": "#fdba74",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-opacity": 1,
      },
    });
  } else {
    // Update existing layer highlight size
    const highlightRadius = isMobile
      ? ["step", ["zoom"], 9, 10.01, 20]
      : 9;
    try {
      map.setPaintProperty(LAYER_HIGHLIGHT_ID, "circle-radius", highlightRadius);
    } catch {}
  }

  if (!map.getLayer(LAYER_CLUSTER_HIGHLIGHT_ID)) {
    // Scale cluster highlight proportionally with cluster size on mobile when zoomed in
    // Desktop: base 18, >=10 count: 22, >=25 count: 28
    // Mobile + zoom > 10: base 24, >=10 count: 28, >=25 count: 32
    const clusterHighlightRadius = isMobile
      ? [
          "step",
          ["zoom"],
          ["step", ["get", "point_count"], 18, 10, 22, 25, 28], // zoom <= 10: desktop sizes
          10.01,
          ["step", ["get", "point_count"], 24, 10, 28, 25, 32], // zoom > 10: larger sizes
        ]
      : ["step", ["get", "point_count"], 18, 10, 22, 25, 28];
    
    map.addLayer({
      id: LAYER_CLUSTER_HIGHLIGHT_ID,
      type: "circle",
      source: SOURCE_ID,
      filter: ["all", ["has", "point_count"], ["==", ["get", "cluster_id"], -1]],
      paint: {
        "circle-radius": clusterHighlightRadius,
        "circle-color": "#fdba74",
        "circle-opacity": 0.35,
        "circle-stroke-color": "#fdba74",
        "circle-stroke-width": 2,
      },
    });
  } else {
    // Update existing layer cluster highlight size
    const clusterHighlightRadius = isMobile
      ? [
          "step",
          ["zoom"],
          ["step", ["get", "point_count"], 18, 10, 22, 25, 28],
          10.01,
          ["step", ["get", "point_count"], 24, 10, 28, 25, 32],
        ]
      : ["step", ["get", "point_count"], 18, 10, 22, 25, 28];
    try {
      map.setPaintProperty(LAYER_CLUSTER_HIGHLIGHT_ID, "circle-radius", clusterHighlightRadius);
    } catch {}
  }
};

