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
  lastData: GeoJSON.FeatureCollection<GeoJSON.Point, { id: string; name: string; url: string }>,
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
    map.addLayer({
      id: LAYER_CLUSTERS_ID,
      type: "circle",
      source: SOURCE_ID,
      filter: ["has", "point_count"],
      paint: {
        "circle-radius": ["step", ["get", "point_count"], 12, 10, 16, 25, 20],
        "circle-color": "#fed7aa",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-opacity": 0.9,
      } as any,
    });
  }

  if (!map.getLayer(LAYER_CLUSTER_COUNT_ID)) {
    map.addLayer({
      id: LAYER_CLUSTER_COUNT_ID,
      type: "symbol",
      source: SOURCE_ID,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count"],
        "text-font": ["Open Sans Bold"],
        "text-size": 12,
      },
      paint: {
        "text-color": "#9a3412",
      },
    });
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
      map.setPaintProperty(LAYER_POINTS_ID, "circle-radius", 6);
      map.setPaintProperty(LAYER_POINTS_ID, "circle-opacity", 1);
    });
  }

  if (!map.getLayer(LAYER_HIGHLIGHT_ID)) {
    map.addLayer({
      id: LAYER_HIGHLIGHT_ID,
      type: "circle",
      source: SOURCE_ID,
      filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], "__none__"]],
      paint: {
        "circle-radius": 9,
        "circle-color": "#fdba74",
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-opacity": 1,
      },
    });
  }

  if (!map.getLayer(LAYER_CLUSTER_HIGHLIGHT_ID)) {
    map.addLayer({
      id: LAYER_CLUSTER_HIGHLIGHT_ID,
      type: "circle",
      source: SOURCE_ID,
      filter: ["all", ["has", "point_count"], ["==", ["get", "cluster_id"], -1]],
      paint: {
        "circle-radius": ["step", ["get", "point_count"], 18, 10, 22, 25, 28],
        "circle-color": "#fdba74",
        "circle-opacity": 0.35,
        "circle-stroke-color": "#fdba74",
        "circle-stroke-width": 2,
      },
    });
  }
};


