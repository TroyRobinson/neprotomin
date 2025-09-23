import maplibregl from "maplibre-gl";

import type { Organization } from "../types/organization";
import { TULSA_CENTER } from "../types/organization";
import { themeController } from "./theme";

interface MapViewOptions {
  onHover: (id: string | null) => void;
  onVisibleIdsChange?: (ids: string[]) => void;
}

export interface MapViewController {
  element: HTMLElement;
  setOrganizations: (organizations: Organization[]) => void;
  setActiveOrganization: (id: string | null) => void;
  fitAllOrganizations: () => void;
  destroy: () => void;
}

type ThemeName = "light" | "dark";

const MAP_STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const MAP_STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const getMapStyle = (theme: ThemeName): string =>
  theme === "dark" ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;

const SOURCE_ID = "organizations";
const LAYER_CLUSTERS_ID = "organizations-clusters";
const LAYER_CLUSTER_COUNT_ID = "organizations-cluster-count";
const LAYER_POINTS_ID = "organizations-points";
const LAYER_HIGHLIGHT_ID = "organizations-highlight";

type FC = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  { id: string; name: string; url: string }
>;

const emptyFC = (): FC => ({ type: "FeatureCollection", features: [] });

export const createMapView = ({ onHover, onVisibleIdsChange }: MapViewOptions): MapViewController => {
  const container = document.createElement("section");
  container.className = "relative flex flex-1";

  const mapNode = document.createElement("div");
  mapNode.className = "absolute inset-0";
  container.appendChild(mapNode);

  let currentTheme = themeController.getTheme();

  const map = new maplibregl.Map({
    container: mapNode,
    style: getMapStyle(currentTheme),
    center: [TULSA_CENTER.longitude, TULSA_CENTER.latitude],
    zoom: 12.5,
    attributionControl: false,
  });

  map.dragRotate.disable();
  map.touchZoomRotate.enable();
  map.touchZoomRotate.disableRotation();


  let lastData: FC = emptyFC();

  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  let activeId: string | null = null;
  let lastVisibleIdsKey: string | null = null;

  const ensureSourcesAndLayers = () => {
    if (!map.isStyleLoaded()) return;

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: emptyFC(),
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });
    }

    if (!map.getLayer(LAYER_CLUSTERS_ID)) {
      map.addLayer({
        id: LAYER_CLUSTERS_ID,
        type: "circle",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#3755f0",
          "circle-opacity": 0.85,
          "circle-radius": [
            "step",
            ["get", "point_count"],
            14,
            10,
            18,
            25,
            24,
          ],
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
    }

    if (!map.getLayer(LAYER_CLUSTER_COUNT_ID)) {
      map.addLayer({
        id: LAYER_CLUSTER_COUNT_ID,
        type: "symbol",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["literal", ["Open Sans Bold", "Arial Unicode MS Bold"]],
          "text-size": 12,
        },
        paint: {
          "text-color": "#ffffff",
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
          // animate in: start at 0 and grow/fade to target
          "circle-radius": 0,
          "circle-opacity": 0,
          "circle-color": "#3755f0", // brand-500
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-radius-transition": { duration: 200, delay: 0 },
          "circle-opacity-transition": { duration: 200, delay: 0 },
        } as any,
      });

      // Kick off the grow/fade to normal values next frame
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
        filter: [
          "all",
          ["!", ["has", "point_count"]],
          ["==", ["get", "id"], "__none__"],
        ],
        paint: {
          "circle-radius": 9,
          "circle-color": "#85a3ff", // brand-300
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
          "circle-opacity": 1,
        },
      });
    }

    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(lastData);
    }

    updateHighlight();

    // Recompute visible ids after ensuring layers/sources
    emitVisibleIds();
  };

  map.once("load", () => {
    map.jumpTo({
      center: [TULSA_CENTER.longitude, TULSA_CENTER.latitude],
      zoom: 13,
    });

    ensureSourcesAndLayers();

    map.on("mouseenter", LAYER_POINTS_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LAYER_POINTS_ID, () => {
      map.getCanvas().style.cursor = "";
      onHover(null);
    });
    map.on("mousemove", LAYER_POINTS_ID, (e: any) => {
      const f = e.features?.[0];
      const id = f?.properties?.id as string | undefined;
      onHover(id || null);
    });

    map.on("mouseenter", LAYER_CLUSTERS_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LAYER_CLUSTERS_ID, () => {
      map.getCanvas().style.cursor = "";
    });
    map.on("click", LAYER_CLUSTERS_ID, async (e) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [LAYER_CLUSTERS_ID],
      });
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
      } catch (error) {
        // ignore expansion errors
      }
    });
  });

  map.on("load", () => {
    ensureSourcesAndLayers();
  });

  map.on("styledata", () => {
    ensureSourcesAndLayers();
  });
  map.on("idle", () => {
    // Guarantees layers/sources exist once style fully settles
    ensureSourcesAndLayers();
  });

  const updateHighlight = () => {
    if (!map.getLayer(LAYER_HIGHLIGHT_ID)) return;
    const baseFilter: any[] = ["!", ["has", "point_count"]];
    const filter = activeId
      ? ["all", baseFilter, ["==", ["get", "id"], activeId]]
      : ["all", baseFilter, ["==", ["get", "id"], "__none__"]];
    map.setFilter(LAYER_HIGHLIGHT_ID, filter as any);
  };

  const setOrganizations = (organizations: Organization[]) => {
    const fc: FC = {
      type: "FeatureCollection",
      features: organizations.map((o) => ({
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

    // Organizations changed; recompute visible set
    emitVisibleIds();
  };

  const setActiveOrganization = (id: string | null) => {
    if (activeId === id) return;
    activeId = id;
    updateHighlight();
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
    map.setStyle(getMapStyle(nextTheme));
    // After a style swap, ensure our layers are reattached when ready
    map.once("styledata", () => ensureSourcesAndLayers());
    map.once("idle", () => ensureSourcesAndLayers());
  });

  const emitVisibleIds = () => {
    const bounds = map.getBounds();
    const ids = lastData.features
      .filter((f) => {
        const [lng, lat] = f.geometry.coordinates as [number, number];
        return bounds.contains([lng, lat]);
      })
      .map((f) => f.properties.id);

    // Stable sort and de-dupe just in case
    const uniqueSorted = Array.from(new Set(ids)).sort();
    const key = uniqueSorted.join("|");
    if (key === lastVisibleIdsKey) return;
    lastVisibleIdsKey = key;

    if (onVisibleIdsChange) onVisibleIdsChange(uniqueSorted);
  };

  // Update visible set on map interactions
  map.on("moveend", () => emitVisibleIds());
  map.on("zoomend", () => emitVisibleIds());

  return {
    element: container,
    setOrganizations,
    setActiveOrganization,
    fitAllOrganizations,
    destroy: () => {
      resizeObserver.disconnect();
      unsubscribeTheme();
      map.remove();
    },
  };
};
