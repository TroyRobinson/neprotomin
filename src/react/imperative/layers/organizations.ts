import type maplibregl from "maplibre-gl";
import type {
  DataDrivenPropertyValueSpecification,
  ExpressionSpecification,
} from "@maplibre/maplibre-gl-style-spec";

const desktopClusterRadiusExpression = [
  "step",
  ["get", "point_count"],
  12,
  10,
  16,
  25,
  20,
] as ExpressionSpecification;

const mobileClusterRadiusExpression = [
  "step",
  ["zoom"],
  desktopClusterRadiusExpression,
  10.01,
  ["step", ["get", "point_count"], 18, 10, 22, 25, 26],
] as ExpressionSpecification;

const desktopClusterTextSize = 12;

const mobileClusterTextSizeExpression = [
  "step",
  ["zoom"],
  12,
  10.01,
  14,
] as ExpressionSpecification;

const desktopPointRadius = 6;

const mobilePointRadiusExpression = [
  "step",
  ["zoom"],
  6,
  10.01,
  16,
] as ExpressionSpecification;

const desktopHighlightRadius = 9;

const mobileHighlightRadiusExpression = [
  "step",
  ["zoom"],
  9,
  10.01,
  20,
] as ExpressionSpecification;

const desktopClusterHighlightRadiusExpression = [
  "step",
  ["get", "point_count"],
  18,
  10,
  22,
  25,
  28,
] as ExpressionSpecification;

const mobileClusterHighlightRadiusExpression = [
  "step",
  ["zoom"],
  desktopClusterHighlightRadiusExpression,
  10.01,
  ["step", ["get", "point_count"], 24, 10, 28, 25, 32],
] as ExpressionSpecification;

const getClusterRadius = (
  isMobile: boolean,
): DataDrivenPropertyValueSpecification<number> =>
  isMobile ? mobileClusterRadiusExpression : desktopClusterRadiusExpression;

const getClusterTextSize = (
  isMobile: boolean,
): DataDrivenPropertyValueSpecification<number> =>
  (isMobile ? mobileClusterTextSizeExpression : desktopClusterTextSize);

const getPointRadius = (
  isMobile: boolean,
): DataDrivenPropertyValueSpecification<number> =>
  (isMobile ? mobilePointRadiusExpression : desktopPointRadius);

const getHighlightRadius = (
  isMobile: boolean,
): DataDrivenPropertyValueSpecification<number> =>
  (isMobile ? mobileHighlightRadiusExpression : desktopHighlightRadius);

const getClusterHighlightRadius = (
  isMobile: boolean,
): DataDrivenPropertyValueSpecification<number> =>
  isMobile
    ? mobileClusterHighlightRadiusExpression
    : desktopClusterHighlightRadiusExpression;

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
    const clusterRadius = getClusterRadius(isMobile);

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
    const clusterRadius = getClusterRadius(isMobile);
    try {
      map.setPaintProperty(LAYER_CLUSTERS_ID, "circle-radius", clusterRadius);
    } catch {}
  }

  if (!map.getLayer(LAYER_CLUSTER_COUNT_ID)) {
    // Scale text size proportionally with cluster size on mobile when zoomed in
    const clusterTextSize = getClusterTextSize(isMobile);

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
    const clusterTextSize = getClusterTextSize(isMobile);
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
      const pointRadius = getPointRadius(isMobile);
      map.setPaintProperty(LAYER_POINTS_ID, "circle-radius", pointRadius);
      map.setPaintProperty(LAYER_POINTS_ID, "circle-opacity", 1);
    });
  } else {
    // Update existing layer point size
    const pointRadius = getPointRadius(isMobile);
    try {
      map.setPaintProperty(LAYER_POINTS_ID, "circle-radius", pointRadius);
    } catch {}
  }

  if (!map.getLayer(LAYER_HIGHLIGHT_ID)) {
    // Scale highlight proportionally with point size on mobile when zoomed in
    // Desktop: 9, Mobile + zoom > 10: 20 (proportional to point size increase from 6 to 16)
    const highlightRadius = getHighlightRadius(isMobile);

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
    const highlightRadius = getHighlightRadius(isMobile);
    try {
      map.setPaintProperty(LAYER_HIGHLIGHT_ID, "circle-radius", highlightRadius);
    } catch {}
  }

  if (!map.getLayer(LAYER_CLUSTER_HIGHLIGHT_ID)) {
    // Scale cluster highlight proportionally with cluster size on mobile when zoomed in
    // Desktop: base 18, >=10 count: 22, >=25 count: 28
    // Mobile + zoom > 10: base 24, >=10 count: 28, >=25 count: 32
    const clusterHighlightRadius = getClusterHighlightRadius(isMobile);

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
    const clusterHighlightRadius = getClusterHighlightRadius(isMobile);
    try {
      map.setPaintProperty(LAYER_CLUSTER_HIGHLIGHT_ID, "circle-radius", clusterHighlightRadius);
    } catch {}
  }
};
