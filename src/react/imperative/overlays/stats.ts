import type maplibregl from "maplibre-gl";

import { CHOROPLETH_COLORS, TEAL_COLORS, getClassIndex } from "../../../lib/choropleth";
import { getAllZipCodes } from "../../../lib/zipBoundaries";
import type { ChoroplethLegendController } from "../components/choroplethLegend";

export interface StatOverlayIds {
  BOUNDARY_STATDATA_FILL_LAYER_ID: string;
  SECONDARY_STAT_LAYER_ID: string;
  SECONDARY_STAT_HOVER_LAYER_ID: string;
}

export const updateStatDataChoropleth = (
  map: maplibregl.Map,
  ids: StatOverlayIds,
  theme: "light" | "dark",
  selectedStatId: string | null,
  statDataByStatId: Map<string, { type: string; data: Record<string, number>; min: number; max: number }>,
) => {
  const { BOUNDARY_STATDATA_FILL_LAYER_ID } = ids;
  if (!map.getLayer(BOUNDARY_STATDATA_FILL_LAYER_ID)) return;
  if (!selectedStatId) {
    map.setPaintProperty(BOUNDARY_STATDATA_FILL_LAYER_ID, "fill-opacity", 0);
    return;
  }
  const entry = statDataByStatId.get(selectedStatId);
  if (!entry) {
    map.setPaintProperty(BOUNDARY_STATDATA_FILL_LAYER_ID, "fill-opacity", 0);
    return;
  }
  const { data, min, max } = entry;
  const zips = Object.keys(data || {});
  if (zips.length === 0) {
    map.setPaintProperty(BOUNDARY_STATDATA_FILL_LAYER_ID, "fill-opacity", 0);
    return;
  }

  const COLORS = CHOROPLETH_COLORS;
  const classes = COLORS.length;
  const match: any[] = ["match", ["get", "zip"]];
  for (const zip of zips) {
    const v = data[zip];
    const color = COLORS[getClassIndex(v, min, max, classes)];
    match.push(zip, color);
  }
  match.push("#000000");

  const baseOpacity = theme === "dark" ? 0.35 : 0.45;
  const opacityExpr: any = [
    "case",
    ["in", ["get", "zip"], ["literal", zips]],
    baseOpacity,
    0,
  ];
  map.setPaintProperty(BOUNDARY_STATDATA_FILL_LAYER_ID, "fill-color", match as any);
  map.setPaintProperty(BOUNDARY_STATDATA_FILL_LAYER_ID, "fill-opacity", opacityExpr as any);
};

export const updateChoroplethLegend = (
  legend: ChoroplethLegendController,
  selectedStatId: string | null,
  statDataByStatId: Map<string, { type: string; data: Record<string, number>; min: number; max: number }>,
) => {
  if (!selectedStatId) {
    legend.setVisible(false);
    return;
  }
  const entry = statDataByStatId.get(selectedStatId);
  const hasData = !!entry && Object.keys(entry.data || {}).length > 0;
  if (!hasData) {
    legend.setVisible(false);
    return;
  }
  legend.setColors(CHOROPLETH_COLORS[0], CHOROPLETH_COLORS[CHOROPLETH_COLORS.length - 1]);
  legend.setRange(entry!.min, entry!.max, (entry as any).type as string);
  legend.setVisible(true);
};

export const updateSecondaryStatOverlay = (
  map: maplibregl.Map,
  ids: StatOverlayIds,
  boundaryMode: "zips" | string,
  theme: "light" | "dark",
  secondaryStatId: string | null,
  statDataByStatId: Map<string, { type: string; data: Record<string, number>; min: number; max: number }>,
  pinnedZips: Set<string>,
  transientZips: Set<string>,
  hoveredZip: string | null,
) => {
  // theme currently does not affect rendering for secondary overlay; keep param for parity
  void theme;
  const { SECONDARY_STAT_LAYER_ID, SECONDARY_STAT_HOVER_LAYER_ID } = ids;
  if (!map.getLayer(SECONDARY_STAT_LAYER_ID)) return;
  if (boundaryMode !== "zips") {
    map.setPaintProperty(SECONDARY_STAT_LAYER_ID, "circle-opacity", 0);
    if (map.getLayer(SECONDARY_STAT_HOVER_LAYER_ID)) map.setPaintProperty(SECONDARY_STAT_HOVER_LAYER_ID, "circle-opacity", 0);
    return;
  }
  if (!secondaryStatId) {
    map.setPaintProperty(SECONDARY_STAT_LAYER_ID, "circle-opacity", 0);
    map.setFilter(SECONDARY_STAT_LAYER_ID, ["==", ["get", "zip"], "__none__"] as any);
    if (map.getLayer(SECONDARY_STAT_HOVER_LAYER_ID)) {
      map.setPaintProperty(SECONDARY_STAT_HOVER_LAYER_ID, "circle-opacity", 0);
      map.setFilter(SECONDARY_STAT_HOVER_LAYER_ID, ["==", ["get", "zip"], "__none__"] as any);
    }
    return;
  }
  const entry = statDataByStatId.get(secondaryStatId);
  if (!entry) {
    map.setPaintProperty(SECONDARY_STAT_LAYER_ID, "circle-opacity", 0);
    map.setFilter(SECONDARY_STAT_LAYER_ID, ["==", ["get", "zip"], "__none__"] as any);
    if (map.getLayer(SECONDARY_STAT_HOVER_LAYER_ID)) {
      map.setPaintProperty(SECONDARY_STAT_HOVER_LAYER_ID, "circle-opacity", 0);
      map.setFilter(SECONDARY_STAT_HOVER_LAYER_ID, ["==", ["get", "zip"], "__none__"] as any);
    }
    return;
  }

  // Exclude hovered zip from base layer if any
  try {
    if (hoveredZip) {
      map.setFilter(SECONDARY_STAT_LAYER_ID, ["all", ["has", "zip"], ["!=", ["get", "zip"], hoveredZip]] as any);
    } else {
      map.setFilter(SECONDARY_STAT_LAYER_ID, null as any);
    }
  } catch {
    if (hoveredZip) map.setFilter(SECONDARY_STAT_LAYER_ID, ["all", ["has", "zip"], ["!=", ["get", "zip"], hoveredZip]] as any);
    else map.setFilter(SECONDARY_STAT_LAYER_ID, ["has", "zip"] as any);
  }

  const selectedOrPinned = new Set<string>([...pinnedZips, ...transientZips]);
  const selectedArray = Array.from(selectedOrPinned);

  const { data, min, max } = entry;
  const COLORS = TEAL_COLORS;
  const classes = COLORS.length;
  const match: any[] = ["match", ["get", "zip"]];
  for (const zip of getAllZipCodes()) {
    const v = data?.[zip];
    const color = typeof v === "number" ? COLORS[getClassIndex(v, min, max, classes)] : COLORS[0];
    match.push(zip, color);
  }
  match.push(COLORS[0]);

  map.setPaintProperty(SECONDARY_STAT_LAYER_ID, "circle-color", match as any);
  map.setPaintProperty(SECONDARY_STAT_LAYER_ID, "circle-opacity", 0.95);
  const translateExpr: any = selectedArray.length
    ? [
        "case",
        ["in", ["get", "zip"], ["literal", selectedArray]],
        ["literal", [0, -14]],
        ["literal", [0, 0]],
      ]
    : ["literal", [0, 0]];
  map.setPaintProperty(SECONDARY_STAT_LAYER_ID, "circle-translate", translateExpr);

  if (map.getLayer(SECONDARY_STAT_HOVER_LAYER_ID)) {
    if (hoveredZip) {
      const v = entry.data?.[hoveredZip as string];
      let idx = 0;
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (max - min <= 0) idx = Math.floor((classes - 1) / 2);
        else idx = Math.max(0, Math.min(classes - 1, Math.floor(((v - min) / (max - min)) * (classes - 1))));
      }
      const color = COLORS[idx];
      map.setFilter(SECONDARY_STAT_HOVER_LAYER_ID, ["==", ["get", "zip"], hoveredZip] as any);
      map.setPaintProperty(SECONDARY_STAT_HOVER_LAYER_ID, "circle-color", color as any);
      map.setPaintProperty(SECONDARY_STAT_HOVER_LAYER_ID, "circle-opacity", 1);
      map.setPaintProperty(SECONDARY_STAT_HOVER_LAYER_ID, "circle-translate", [0, -14] as any);
    } else {
      map.setPaintProperty(SECONDARY_STAT_HOVER_LAYER_ID, "circle-opacity", 0);
      map.setFilter(SECONDARY_STAT_HOVER_LAYER_ID, ["==", ["get", "zip"], "__none__"] as any);
    }
  }
};


