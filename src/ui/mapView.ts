import maplibregl from "maplibre-gl";

import { tulsaZipBoundaries } from "../data/tulsaZipBoundaries";
import { getZipBounds } from "../lib/zipBoundaries";
import type { BoundsArray } from "../lib/zipBoundaries";
import type { BoundaryMode } from "../types/boundaries";
import type { Organization } from "../types/organization";
import { TULSA_CENTER } from "../types/organization";
import { themeController } from "./theme";
import { createCategoryChips } from "./categoryChips";

interface MapViewOptions {
  onHover: (idOrIds: string | string[] | null) => void;
  onVisibleIdsChange?: (ids: string[], totalInSource: number, allSourceIds: string[]) => void;
  onZipSelectionChange?: (selectedZips: string[]) => void;
}

export interface MapViewController {
  element: HTMLElement;
  setOrganizations: (organizations: Organization[]) => void;
  setActiveOrganization: (id: string | null) => void;
  setCategoryFilter: (categoryId: string | null) => void;
  setBoundaryMode: (mode: BoundaryMode) => void;
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
const LAYER_CLUSTER_HIGHLIGHT_ID = "organizations-cluster-highlight";
const BOUNDARY_SOURCE_ID = "tulsa-zip-boundaries";
const BOUNDARY_FILL_LAYER_ID = "tulsa-zip-boundaries-fill";
const BOUNDARY_LINE_LAYER_ID = "tulsa-zip-boundaries-outline";
const BOUNDARY_HIGHLIGHT_FILL_LAYER_ID = "tulsa-zip-boundaries-highlight-fill";
const BOUNDARY_HIGHLIGHT_LINE_LAYER_ID = "tulsa-zip-boundaries-highlight-line";

type FC = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  { id: string; name: string; url: string }
>;

const emptyFC = (): FC => ({ type: "FeatureCollection", features: [] });

export const createMapView = ({
  onHover,
  onVisibleIdsChange,
  onZipSelectionChange,
}: MapViewOptions): MapViewController => {
  const container = document.createElement("section");
  container.className = "relative flex flex-1";

  const mapNode = document.createElement("div");
  mapNode.className = "absolute inset-0";
  container.appendChild(mapNode);

  // Category filter UI (chips)
  let selectedCategory: string | null = null;
  const categoryChips = createCategoryChips({
    onChange: (categoryId) => {
      selectedCategory = categoryId;
      applyData();
    },
  });
  container.appendChild(categoryChips.element);

  let currentTheme = themeController.getTheme();
  let boundaryMode: BoundaryMode = "zips";
  let selectedZips = new Set<string>();

  const map = new maplibregl.Map({
    container: mapNode,
    style: getMapStyle(currentTheme),
    center: [TULSA_CENTER.longitude, TULSA_CENTER.latitude],
    zoom: 12.5,
    attributionControl: false,
    fadeDuration: 0,
    // Disable Shift+drag box zoom so Shift can be used for multi-select
    boxZoom: false,
  });

  map.dragRotate.disable();
  map.touchZoomRotate.enable();
  map.touchZoomRotate.disableRotation();


  // Keep a copy of all orgs and the last rendered FeatureCollection
  let allOrganizations: Organization[] = [];
  let lastData: FC = emptyFC();

  map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  let activeId: string | null = null;
  let lastVisibleIdsKey: string | null = null;

  const getBoundaryPalette = (theme: ThemeName) =>
    theme === "dark"
      ? {
          // Dark theme: lighter, subtler fill and outline
          fillColor: "#94a3b8", // slate-400
          fillOpacity: 0.08,
          lineColor: "#f1f5f9", // slate-100
          lineOpacity: 0.45,
        }
      : {
          // Light theme: very light shading with a softer outline
          fillColor: "#1f2937", // gray-800 but very low opacity
          fillOpacity: 0.04,
          lineColor: "#94a3b8", // slate-400
          lineOpacity: 0.35,
        };

  const updateBoundaryPaint = () => {
    const palette = getBoundaryPalette(currentTheme);
    if (map.getLayer(BOUNDARY_FILL_LAYER_ID)) {
      map.setPaintProperty(BOUNDARY_FILL_LAYER_ID, "fill-color", palette.fillColor);
      map.setPaintProperty(BOUNDARY_FILL_LAYER_ID, "fill-opacity", palette.fillOpacity);
    }
    if (map.getLayer(BOUNDARY_LINE_LAYER_ID)) {
      map.setPaintProperty(BOUNDARY_LINE_LAYER_ID, "line-color", palette.lineColor);
      map.setPaintProperty(BOUNDARY_LINE_LAYER_ID, "line-opacity", palette.lineOpacity);
    }
  };

  const updateBoundaryVisibility = () => {
    const visibility = boundaryMode === "zips" ? "visible" : "none";
    if (map.getLayer(BOUNDARY_FILL_LAYER_ID)) {
      map.setLayoutProperty(BOUNDARY_FILL_LAYER_ID, "visibility", visibility);
    }
    if (map.getLayer(BOUNDARY_LINE_LAYER_ID)) {
      map.setLayoutProperty(BOUNDARY_LINE_LAYER_ID, "visibility", visibility);
    }
    if (map.getLayer(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID)) {
      map.setLayoutProperty(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, "visibility", visibility);
    }
    if (map.getLayer(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID)) {
      map.setLayoutProperty(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, "visibility", visibility);
    }
  };

  const updateZipSelectionHighlight = () => {
    const selected = Array.from(selectedZips);
    const filter =
      selected.length > 0
        ? (["in", ["get", "zip"], ["literal", selected]] as any)
        : (["==", ["get", "zip"], "__none__"] as any);
    if (map.getLayer(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID)) {
      map.setFilter(BOUNDARY_HIGHLIGHT_FILL_LAYER_ID, filter);
    }
    if (map.getLayer(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID)) {
      map.setFilter(BOUNDARY_HIGHLIGHT_LINE_LAYER_ID, filter);
    }
  };

  const notifyZipSelectionChange = () => {
    onZipSelectionChange?.(Array.from(selectedZips));
  };

  const zoomToSelectedZips = () => {
    if (selectedZips.size === 0) return;

    let combinedBounds: BoundsArray | null = null;

    for (const zip of selectedZips) {
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
    if (shouldZoom) {
      zoomToSelectedZips();
    }
    if (notify) {
      notifyZipSelectionChange();
    }
  };

  const clearZipSelection = ({ notify }: { notify: boolean }) => {
    if (selectedZips.size === 0) {
      if (notify) notifyZipSelectionChange();
      return;
    }
    selectedZips = new Set();
    applyZipSelection({ shouldZoom: false, notify });
  };

  const toggleZipSelection = (zip: string, additive: boolean) => {
    const next = new Set(selectedZips);
    if (additive) {
      if (next.has(zip)) {
        next.delete(zip);
      } else {
        next.add(zip);
      }
    } else {
      next.clear();
      next.add(zip);
    }
    selectedZips = next;
    applyZipSelection({ shouldZoom: true, notify: true });
  };

  const ensureSourcesAndLayers = () => {
    if (!map.isStyleLoaded()) return;

    if (!map.getSource(BOUNDARY_SOURCE_ID)) {
      map.addSource(BOUNDARY_SOURCE_ID, {
        type: "geojson",
        data: tulsaZipBoundaries,
      });
    }

    const boundarySource = map.getSource(BOUNDARY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (boundarySource) {
      boundarySource.setData(tulsaZipBoundaries);
    }

    if (!map.getLayer(BOUNDARY_FILL_LAYER_ID)) {
      const palette = getBoundaryPalette(currentTheme);
      map.addLayer({
        id: BOUNDARY_FILL_LAYER_ID,
        type: "fill",
        source: BOUNDARY_SOURCE_ID,
        layout: { visibility: boundaryMode === "zips" ? "visible" : "none" },
        paint: {
          "fill-color": palette.fillColor,
          "fill-opacity": palette.fillOpacity,
        },
      });
    }

    if (!map.getLayer(BOUNDARY_LINE_LAYER_ID)) {
      const palette = getBoundaryPalette(currentTheme);
      map.addLayer({
        id: BOUNDARY_LINE_LAYER_ID,
        type: "line",
        source: BOUNDARY_SOURCE_ID,
        layout: { visibility: boundaryMode === "zips" ? "visible" : "none" },
        paint: {
          "line-color": palette.lineColor,
          "line-opacity": palette.lineOpacity,
          "line-width": 1.2,
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
          paint: {
            "fill-color": "#3755f0",
            "fill-opacity": 0.22,
          },
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
        paint: {
          "line-color": "#1d3bd6",
          "line-width": 2.4,
          "line-opacity": 0.85,
        },
      });
    }

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

    // Cluster highlight ring, drawn above base clusters
    if (!map.getLayer(LAYER_CLUSTER_HIGHLIGHT_ID)) {
      map.addLayer({
        id: LAYER_CLUSTER_HIGHLIGHT_ID,
        type: "circle",
        source: SOURCE_ID,
        filter: [
          "all",
          ["has", "point_count"],
          ["==", ["get", "cluster_id"], -1],
        ],
        paint: {
          "circle-radius": [
            "step",
            ["get", "point_count"],
            18,
            10,
            22,
            25,
            28,
          ],
          "circle-color": "#85a3ff",
          "circle-opacity": 0.35,
          "circle-stroke-color": "#85a3ff",
          "circle-stroke-width": 2,
        },
      });
    }

    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(lastData);
    }

    updateHighlight();
    updateBoundaryPaint();
    updateBoundaryVisibility();
    updateZipSelectionHighlight();

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
      clearClusterHighlight();
      onHover(null);
    });
    map.on("mousemove", LAYER_POINTS_ID, (e: any) => {
      const f = e.features?.[0];
      const id = f?.properties?.id as string | undefined;
      clearClusterHighlight();
      onHover(id || null);
    });

    map.on("mouseenter", LAYER_CLUSTERS_ID, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", LAYER_CLUSTERS_ID, () => {
      map.getCanvas().style.cursor = "";
      clearClusterHighlight();
      onHover(null);
    });
    map.on("mousemove", LAYER_CLUSTERS_ID, async (e: any) => {
      const features = map.queryRenderedFeatures(e.point, {
        layers: [LAYER_CLUSTERS_ID],
      });
      const feature = features[0];
      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      const clusterId = feature?.properties?.cluster_id as number | undefined;
      if (!feature || !source || clusterId === undefined) return;
      try {
        setClusterHighlight(clusterId);
        const leaves = await source.getClusterLeaves(clusterId, 1000, 0);
        const ids = leaves
          .map((f: any) => f?.properties?.id)
          .filter((v: any): v is string => typeof v === "string");
        onHover(ids);
      } catch {}
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

    const handleZipClick = (e: maplibregl.MapLayerMouseEvent) => {
      if (boundaryMode !== "zips") return;
      const features = map.queryRenderedFeatures(e.point, {
        layers: [BOUNDARY_FILL_LAYER_ID],
      });
      const feature = features[0];
      const zip = feature?.properties?.zip as string | undefined;
      if (!zip) return;
      const additive = Boolean((e.originalEvent as MouseEvent | PointerEvent | undefined)?.shiftKey);
      toggleZipSelection(zip, additive);
    };

    map.on("click", BOUNDARY_FILL_LAYER_ID, handleZipClick);
    map.on("click", BOUNDARY_LINE_LAYER_ID, handleZipClick);

    map.on("mouseenter", BOUNDARY_FILL_LAYER_ID, () => {
      if (boundaryMode !== "zips") return;
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", BOUNDARY_FILL_LAYER_ID, () => {
      map.getCanvas().style.cursor = "";
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

  const setClusterHighlight = (clusterId: number | null) => {
    if (!map.getLayer(LAYER_CLUSTER_HIGHLIGHT_ID)) return;
    const filter = clusterId !== null
      ? ["all", ["has", "point_count"], ["==", ["get", "cluster_id"], clusterId]]
      : ["all", ["has", "point_count"], ["==", ["get", "cluster_id"], -1]];
    map.setFilter(LAYER_CLUSTER_HIGHLIGHT_ID, filter as any);
  };

  const setBoundaryMode = (mode: BoundaryMode) => {
    boundaryMode = mode;
    if (mode !== "zips") {
      clearZipSelection({ notify: true });
    }
    ensureSourcesAndLayers();
    updateBoundaryVisibility();
  };

  const clearClusterHighlight = () => setClusterHighlight(null);

  // When activating a single org (e.g., hovering card), if it's clustered at the
  // current zoom, highlight the containing cluster as well.
  const highlightClusterContainingOrg = async (id: string | null) => {
    if (!id) {
      clearClusterHighlight();
      return;
    }
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    try {
      const canvas = map.getCanvas();
      const clusters = map
        .queryRenderedFeatures([[0, 0], [canvas.width, canvas.height]] as any, {
          layers: [LAYER_CLUSTERS_ID],
        })
        .filter((f) => typeof (f.properties as any)?.cluster_id === "number");

      for (const f of clusters) {
        const cid = (f.properties as any).cluster_id as number;
        const leaves = await source.getClusterLeaves(cid, 1000, 0);
        if (leaves.some((lf: any) => lf?.properties?.id === id)) {
          setClusterHighlight(cid);
          return;
        }
      }
      clearClusterHighlight();
    } catch {
      clearClusterHighlight();
    }
  };

  const setOrganizations = (organizations: Organization[]) => {
    allOrganizations = organizations;
    applyData();
  };

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

    // If the active org no longer exists under filter, clear it
    if (activeId && !filtered.some((o) => o.id === activeId)) {
      activeId = null;
      updateHighlight();
      clearClusterHighlight();
    }

    // Organizations changed; recompute visible set
    emitVisibleIds();
  };

  const setActiveOrganization = (id: string | null) => {
    if (activeId === id) return;
    activeId = id;
    updateHighlight();
    // Also update cluster highlight, if applicable
    void highlightClusterContainingOrg(activeId);
  };

  const setCategoryFilter = (categoryId: string | null) => {
    if (selectedCategory === categoryId) return;
    selectedCategory = categoryId;
    // Reflect in chips without re-emitting onChange
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
    const allSourceIds = lastData.features.map((f) => f.properties.id);
    const key = `${uniqueSorted.join("|")}::${allSourceIds.length}`;
    if (key === lastVisibleIdsKey) return;
    lastVisibleIdsKey = key;

    if (onVisibleIdsChange)
      onVisibleIdsChange(uniqueSorted, lastData.features.length, allSourceIds);
  };

  // Update visible set on map interactions
  map.on("moveend", () => emitVisibleIds());
  map.on("zoomend", () => emitVisibleIds());

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      clearZipSelection({ notify: true });
    }
  };
  window.addEventListener("keydown", handleKeyDown);

  return {
    element: container,
    setOrganizations,
    setActiveOrganization,
    setCategoryFilter,
    setBoundaryMode,
    fitAllOrganizations,
    destroy: () => {
      resizeObserver.disconnect();
      unsubscribeTheme();
      categoryChips.destroy();
      window.removeEventListener("keydown", handleKeyDown);
      map.remove();
    },
  };
};
