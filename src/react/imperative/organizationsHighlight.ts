import type maplibregl from "maplibre-gl";

export const setClusterHighlight = (
  map: maplibregl.Map,
  highlightLayerId: string,
  clusterId: number | null,
) => {
  if (!map.getLayer(highlightLayerId)) return;
  const filter = clusterId !== null
    ? ["all", ["has", "point_count"], ["==", ["get", "cluster_id"], clusterId]]
    : ["all", ["has", "point_count"], ["==", ["get", "cluster_id"], -1]];
  map.setFilter(highlightLayerId, filter as any);
};

export const setClusterHighlights = (
  map: maplibregl.Map,
  highlightLayerId: string,
  clusterIds: number[],
) => {
  if (!map.getLayer(highlightLayerId)) return;
  if (clusterIds.length === 0) {
    setClusterHighlight(map, highlightLayerId, null);
    return;
  }
  if (clusterIds.length === 1) {
    setClusterHighlight(map, highlightLayerId, clusterIds[0]);
    return;
  }
  // Show multiple clusters using "in" filter
  const filter = ["all", ["has", "point_count"], ["in", ["get", "cluster_id"], ["literal", clusterIds]]];
  map.setFilter(highlightLayerId, filter as any);
};

export const clearClusterHighlight = (
  map: maplibregl.Map,
  highlightLayerId: string,
) => setClusterHighlight(map, highlightLayerId, null);

export const highlightClusterContainingOrg = async (
  map: maplibregl.Map,
  sourceId: string,
  clustersLayerId: string,
  highlightLayerId: string,
  orgId: string | null,
) => {
  if (!orgId) {
    clearClusterHighlight(map, highlightLayerId);
    return;
  }
  const source = map.getSource(sourceId) as maplibregl.GeoJSONSource | undefined;
  if (!source) return;
  try {
    const canvas = map.getCanvas();
    const clusters = map
      .queryRenderedFeatures([[0, 0], [canvas.width, canvas.height]] as any, {
        layers: [clustersLayerId],
      })
      .filter((f) => typeof (f.properties as any)?.cluster_id === "number");

    for (const f of clusters) {
      const cid = (f.properties as any).cluster_id as number;
      const leaves = await source.getClusterLeaves(cid, 1000, 0);
      if (leaves.some((lf: any) => lf?.properties?.id === orgId)) {
        setClusterHighlight(map, highlightLayerId, cid);
        return;
      }
    }
    clearClusterHighlight(map, highlightLayerId);
  } catch {
    clearClusterHighlight(map, highlightLayerId);
  }
};


