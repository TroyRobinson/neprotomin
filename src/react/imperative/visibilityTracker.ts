import type maplibregl from "maplibre-gl";

type OrgFC = GeoJSON.FeatureCollection<GeoJSON.Point, { id: string; name: string; url: string }>;

export type VisibleIdsCallback = (ids: string[], totalInSource: number, allSourceIds: string[]) => void;

export function wireVisibleIds(
  map: maplibregl.Map,
  getLastData: () => OrgFC,
  onChange?: VisibleIdsCallback,
): () => void {
  let lastKey: string | null = null;

  const emit = () => {
    const lastData = getLastData();
    const bounds = map.getBounds();
    const ids = lastData.features
      .filter((f) => {
        const [lng, lat] = f.geometry.coordinates as [number, number];
        return bounds.contains([lng, lat]);
      })
      .map((f) => (f.properties as any).id);

    const uniqueSorted = Array.from(new Set(ids)).sort();
    const allSourceIds = lastData.features.map((f) => (f.properties as any).id);
    const key = `${uniqueSorted.join("|")}::${allSourceIds.length}`;
    if (key === lastKey) return;
    lastKey = key;
    onChange?.(uniqueSorted, lastData.features.length, allSourceIds);
  };

  const onMoveEnd = () => emit();
  const onZoomEnd = () => emit();
  map.on("moveend", onMoveEnd);
  map.on("zoomend", onZoomEnd);

  // Initial emit
  setTimeout(() => emit(), 0);

  return () => {
    map.off("moveend", onMoveEnd);
    map.off("zoomend", onZoomEnd);
  };
}


