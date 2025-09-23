import maplibregl from "maplibre-gl";

import type { Organization } from "../types/organization";
import { TULSA_CENTER } from "../types/organization";

interface MapViewOptions {
  onHover: (id: string | null) => void;
}

export interface MapViewController {
  element: HTMLElement;
  setOrganizations: (organizations: Organization[]) => void;
  setActiveOrganization: (id: string | null) => void;
  destroy: () => void;
}

const MAP_STYLE = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";

const SOURCE_ID = "organizations";
const LAYER_POINTS_ID = "organizations-points";
const LAYER_HIGHLIGHT_ID = "organizations-highlight";

type FC = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  { id: string; name: string; url: string }
>;

const emptyFC = (): FC => ({ type: "FeatureCollection", features: [] });

export const createMapView = ({ onHover }: MapViewOptions): MapViewController => {
  const container = document.createElement("section");
  container.className = "relative flex flex-1";

  const mapNode = document.createElement("div");
  mapNode.className = "absolute inset-0";
  container.appendChild(mapNode);

  const map = new maplibregl.Map({
    container: mapNode,
    style: MAP_STYLE,
    center: [TULSA_CENTER.longitude, TULSA_CENTER.latitude],
    zoom: 12.5,
    attributionControl: false,
  });

  map.dragRotate.disable();
  map.touchZoomRotate.enable();
  map.touchZoomRotate.disableRotation();

  map.once("load", () => {
    map.jumpTo({
      center: [TULSA_CENTER.longitude, TULSA_CENTER.latitude],
      zoom: 13,
    });

    // Add empty source and layers; we’ll set data when available
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: emptyFC(),
    });

    map.addLayer({
      id: LAYER_POINTS_ID,
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": 6,
        "circle-color": "#3755f0", // brand-500
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-opacity": 1,
      },
    });

    map.addLayer({
      id: LAYER_HIGHLIGHT_ID,
      type: "circle",
      source: SOURCE_ID,
      filter: ["==", ["get", "id"], "__none__"],
      paint: {
        "circle-radius": 9,
        "circle-color": "#85a3ff", // brand-300
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-opacity": 1,
      },
    });

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

    // If we already have data queued, apply it
    if (queuedData) {
      const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource;
      src.setData(queuedData);
      queuedData = null;
    }
  });

  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  let activeId: string | null = null;
  let queuedData: FC | null = null;

  const updateHighlight = () => {
    if (!map.getLayer(LAYER_HIGHLIGHT_ID)) return;
    const filter = activeId
      ? ["==", ["get", "id"], activeId]
      : ["==", ["get", "id"], "__none__"];
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

    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(fc);
    } else {
      queuedData = fc;
    }
  };

  const setActiveOrganization = (id: string | null) => {
    if (activeId === id) return;
    activeId = id;
    updateHighlight();
  };

  const resizeObserver = new ResizeObserver(() => {
    map.resize();
  });
  resizeObserver.observe(container);

  return {
    element: container,
    setOrganizations,
    setActiveOrganization,
    destroy: () => {
      resizeObserver.disconnect();
      map.remove();
    },
  };
};
