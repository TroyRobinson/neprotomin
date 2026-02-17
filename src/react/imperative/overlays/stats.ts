import type maplibregl from "maplibre-gl";

import { CHOROPLETH_COLORS, TEAL_COLORS, getClassIndex, getDivergingColor, DIVERGING_NEGATIVE_COLORS, DIVERGING_POSITIVE_COLORS } from "../../../lib/choropleth";
import type { ChoroplethLegendController } from "../components/choroplethLegend";
import type { SecondaryChoroplethLegendController } from "../components/secondaryChoroplethLegend";

type BoundaryDataEntry = { type: string; data: Record<string, number>; min: number; max: number };
type BoundaryEntry = Partial<Record<"ZIP" | "COUNTY", BoundaryDataEntry>>;

export interface StatOverlayIds {
  BOUNDARY_STATDATA_FILL_LAYER_ID: string;
  COUNTY_STATDATA_FILL_LAYER_ID: string;
  SECONDARY_STAT_LAYER_ID: string;
  COUNTY_SECONDARY_LAYER_ID: string;
  SECONDARY_STAT_HOVER_LAYER_ID: string;
  COUNTY_SECONDARY_HOVER_LAYER_ID: string;
}

export const CHOROPLETH_HIDE_ZOOM = 13;

export const updateStatDataChoropleth = (
  map: maplibregl.Map,
  ids: StatOverlayIds,
  theme: "light" | "dark",
  boundaryMode: "zips" | "counties" | string,
  selectedStatId: string | null,
  statDataByStatId: Map<string, BoundaryEntry>,
  currentZoom: number,
) => {
  const { BOUNDARY_STATDATA_FILL_LAYER_ID, COUNTY_STATDATA_FILL_LAYER_ID } = ids;

  // Hide choropleth when zoomed in too close (similar to county/zip boundary switching)
  const shouldHideChoropleth = boundaryMode === "zips" && currentZoom >= CHOROPLETH_HIDE_ZOOM;

  const applyEntry = (
    layerId: string,
    featureKey: "zip" | "county",
    entry: BoundaryDataEntry | undefined,
    active: boolean,
  ) => {
    if (!map.getLayer(layerId)) return;
    if (!active || !entry || shouldHideChoropleth) {
      map.setPaintProperty(layerId, "fill-opacity", 0);
      return;
    }
    const keys = Object.keys(entry.data || {});
    if (keys.length === 0) {
      map.setPaintProperty(layerId, "fill-opacity", 0);
      return;
    }

    const isPercentChange = entry.type === "percent_change";
    const match: any[] = ["match", ["get", featureKey]];

    if (isPercentChange) {
      // Diverging colors: plum for negative, indigo for positive
      for (const id of keys) {
        const v = entry.data[id];
        const color = getDivergingColor(v, entry.min, entry.max);
        match.push(id, color);
      }
    } else {
      // Standard sequential colors
      const COLORS = CHOROPLETH_COLORS;
      const classes = COLORS.length;
      for (const id of keys) {
        const v = entry.data[id];
        const color = COLORS[getClassIndex(v, entry.min, entry.max, classes)];
        match.push(id, color);
      }
    }
    match.push("#000000");

    const baseOpacity = theme === "dark" ? 0.35 : 0.45;
    const opacityExpr: any = [
      "case",
      ["in", ["get", featureKey], ["literal", keys]],
      baseOpacity,
      0,
    ];
    map.setPaintProperty(layerId, "fill-color", match as any);
    map.setPaintProperty(layerId, "fill-opacity", opacityExpr as any);
  };

  const entry = selectedStatId ? statDataByStatId.get(selectedStatId) : undefined;
  const zipEntry = entry?.ZIP;
  const countyEntry = entry?.COUNTY;

  applyEntry(BOUNDARY_STATDATA_FILL_LAYER_ID, "zip", zipEntry, Boolean(selectedStatId) && boundaryMode === "zips");
  applyEntry(COUNTY_STATDATA_FILL_LAYER_ID, "county", countyEntry, Boolean(selectedStatId) && boundaryMode === "counties");
};

export const updateChoroplethLegend = (
  legend: ChoroplethLegendController,
  selectedStatId: string | null,
  boundaryMode: "zips" | "counties" | string,
  statDataByStatId: Map<string, BoundaryEntry>,
) => {
  if (!selectedStatId) {
    legend.setVisible(false);
    return;
  }
  const entry = statDataByStatId.get(selectedStatId);
  const dataEntry = boundaryMode === "counties" ? entry?.COUNTY : entry?.ZIP;
  if (!dataEntry || Object.keys(dataEntry.data || {}).length === 0) {
    legend.setVisible(false);
    return;
  }

  const isPercentChange = dataEntry.type === "percent_change";
  if (isPercentChange) {
    // Diverging legend: plum (negative) to indigo (positive)
    const negColor = DIVERGING_NEGATIVE_COLORS[DIVERGING_NEGATIVE_COLORS.length - 1];
    const posColor = DIVERGING_POSITIVE_COLORS[DIVERGING_POSITIVE_COLORS.length - 1];
    legend.setColors(negColor, posColor);
  } else {
    legend.setColors(CHOROPLETH_COLORS[0], CHOROPLETH_COLORS[CHOROPLETH_COLORS.length - 1]);
  }
  legend.setRange(dataEntry.min, dataEntry.max, dataEntry.type);
  legend.setVisible(true);
};

export const updateSecondaryChoroplethLegend = (
  legend: SecondaryChoroplethLegendController,
  secondaryStatId: string | null,
  boundaryMode: "zips" | "counties" | string,
  statDataByStatId: Map<string, BoundaryEntry>,
) => {
  if (!secondaryStatId) {
    legend.setVisible(false);
    return;
  }
  const entry = statDataByStatId.get(secondaryStatId);
  const dataEntry = boundaryMode === "counties" ? entry?.COUNTY : entry?.ZIP;
  if (!dataEntry || Object.keys(dataEntry.data || {}).length === 0) {
    legend.setVisible(false);
    return;
  }
  legend.setColors(TEAL_COLORS[0], TEAL_COLORS[TEAL_COLORS.length - 1]);
  legend.setRange(dataEntry.min, dataEntry.max, dataEntry.type);
  legend.setVisible(true);
};

// Lightweight hover-only update for secondary stat overlay (avoids rebuilding everything)
export const updateSecondaryStatHoverOnly = (
  map: maplibregl.Map,
  ids: Pick<StatOverlayIds, "SECONDARY_STAT_LAYER_ID" | "SECONDARY_STAT_HOVER_LAYER_ID" | "COUNTY_SECONDARY_LAYER_ID" | "COUNTY_SECONDARY_HOVER_LAYER_ID">,
  boundaryMode: "zips" | string,
  secondaryStatId: string | null,
  statDataByStatId: Map<string, BoundaryEntry>,
  primaryZipScope: Set<string>,
  primaryCountyScope: Set<string>,
  hoveredZip: string | null,
  hoveredCounty: string | null,
) => {
  if (!secondaryStatId) return;
  const entry = statDataByStatId.get(secondaryStatId);
  if (!entry) return;

  const { SECONDARY_STAT_HOVER_LAYER_ID, COUNTY_SECONDARY_HOVER_LAYER_ID } = ids;

  // ZIP hover layer
  if (boundaryMode === "zips" && map.getLayer(SECONDARY_STAT_HOVER_LAYER_ID)) {
    const zipEntry = entry.ZIP;
    if (hoveredZip && primaryZipScope.has(hoveredZip) && zipEntry) {
      const { data, min, max } = zipEntry;
      const v = data?.[hoveredZip];
      const classes = TEAL_COLORS.length;
      let idx = 0;
      if (typeof v === "number" && Number.isFinite(v)) {
        if (max - min <= 0) idx = Math.floor((classes - 1) / 2);
        else idx = Math.max(0, Math.min(classes - 1, Math.floor(((v - min) / (max - min)) * (classes - 1))));
      }
      map.setFilter(SECONDARY_STAT_HOVER_LAYER_ID, ["==", ["get", "zip"], hoveredZip] as any);
      map.setPaintProperty(SECONDARY_STAT_HOVER_LAYER_ID, "circle-color", TEAL_COLORS[idx]);
      map.setPaintProperty(SECONDARY_STAT_HOVER_LAYER_ID, "circle-opacity", 1);
    } else {
      map.setPaintProperty(SECONDARY_STAT_HOVER_LAYER_ID, "circle-opacity", 0);
    }
  }

  // County hover layer
  if (boundaryMode === "counties" && map.getLayer(COUNTY_SECONDARY_HOVER_LAYER_ID)) {
    const countyEntry = entry.COUNTY;
    if (hoveredCounty && primaryCountyScope.has(hoveredCounty) && countyEntry) {
      const { data, min, max } = countyEntry;
      const v = data?.[hoveredCounty];
      const classes = TEAL_COLORS.length;
      let idx = 0;
      if (typeof v === "number" && Number.isFinite(v)) {
        if (max - min <= 0) idx = Math.floor((classes - 1) / 2);
        else idx = Math.max(0, Math.min(classes - 1, Math.floor(((v - min) / (max - min)) * (classes - 1))));
      }
      map.setFilter(COUNTY_SECONDARY_HOVER_LAYER_ID, ["==", ["get", "county"], hoveredCounty] as any);
      map.setPaintProperty(COUNTY_SECONDARY_HOVER_LAYER_ID, "circle-color", TEAL_COLORS[idx]);
      map.setPaintProperty(COUNTY_SECONDARY_HOVER_LAYER_ID, "circle-opacity", 1);
    } else {
      map.setPaintProperty(COUNTY_SECONDARY_HOVER_LAYER_ID, "circle-opacity", 0);
    }
  }
};

export const updateSecondaryStatOverlay = (
  map: maplibregl.Map,
  ids: StatOverlayIds,
  boundaryMode: "zips" | string,
  theme: "light" | "dark",
  secondaryStatId: string | null,
  statDataByStatId: Map<string, BoundaryEntry>,
  primaryZipScope: Set<string>,
  primaryCountyScope: Set<string>,
  pinnedZips: Set<string>,
  transientZips: Set<string>,
  hoveredZip: string | null,
  pinnedCounties: Set<string>,
  transientCounties: Set<string>,
  hoveredCounty: string | null,
) => {
  // theme currently does not affect rendering for secondary overlay; keep param for parity
  void theme;
  const {
    SECONDARY_STAT_LAYER_ID,
    SECONDARY_STAT_HOVER_LAYER_ID,
    COUNTY_SECONDARY_LAYER_ID,
    COUNTY_SECONDARY_HOVER_LAYER_ID,
  } = ids;
  const zipLayerAvailable = Boolean(map.getLayer(SECONDARY_STAT_LAYER_ID));
  const countyLayerAvailable = Boolean(map.getLayer(COUNTY_SECONDARY_LAYER_ID));

  const entry = secondaryStatId ? statDataByStatId.get(secondaryStatId) : undefined;
  const zipEntry = entry?.ZIP;
  const countyEntry = entry?.COUNTY;
  const zipScopeIds = Array.from(primaryZipScope);
  const countyScopeIds = Array.from(primaryCountyScope);

  const disableZipLayers = () => {
    if (zipLayerAvailable) {
      map.setPaintProperty(SECONDARY_STAT_LAYER_ID, "circle-opacity", 0);
      map.setFilter(SECONDARY_STAT_LAYER_ID, ["==", ["get", "zip"], "__none__"] as any);
    }
    if (zipLayerAvailable && map.getLayer(SECONDARY_STAT_HOVER_LAYER_ID)) {
      map.setPaintProperty(SECONDARY_STAT_HOVER_LAYER_ID, "circle-opacity", 0);
      map.setFilter(SECONDARY_STAT_HOVER_LAYER_ID, ["==", ["get", "zip"], "__none__"] as any);
    }
  };

  const disableCountyLayers = () => {
    if (countyLayerAvailable) {
      map.setPaintProperty(COUNTY_SECONDARY_LAYER_ID, "circle-opacity", 0);
      map.setFilter(COUNTY_SECONDARY_LAYER_ID, ["==", ["get", "county"], "__none__"] as any);
    }
    if (countyLayerAvailable && map.getLayer(COUNTY_SECONDARY_HOVER_LAYER_ID)) {
      map.setPaintProperty(COUNTY_SECONDARY_HOVER_LAYER_ID, "circle-opacity", 0);
      map.setFilter(COUNTY_SECONDARY_HOVER_LAYER_ID, ["==", ["get", "county"], "__none__"] as any);
    }
  };

  if (!secondaryStatId) {
    disableZipLayers();
    disableCountyLayers();
    return;
  }

  if (zipLayerAvailable) {
    if (boundaryMode === "zips" && zipEntry && zipScopeIds.length > 0) {
      const baseFilter: any[] = ["all", ["in", ["get", "zip"], ["literal", zipScopeIds]]];
      if (hoveredZip && primaryZipScope.has(hoveredZip)) {
        baseFilter.push(["!=", ["get", "zip"], hoveredZip]);
      }
      map.setFilter(SECONDARY_STAT_LAYER_ID, baseFilter as any);

      const selectedOrPinned = new Set<string>();
      for (const zip of pinnedZips) if (primaryZipScope.has(zip)) selectedOrPinned.add(zip);
      for (const zip of transientZips) if (primaryZipScope.has(zip)) selectedOrPinned.add(zip);
      const selectedArray = Array.from(selectedOrPinned);

      const { data, min, max } = zipEntry;
      const COLORS = TEAL_COLORS;
      const classes = COLORS.length;
      const match: any[] = ["match", ["get", "zip"]];
      for (const zip of zipScopeIds) {
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
        if (hoveredZip && primaryZipScope.has(hoveredZip)) {
          const v = zipEntry.data?.[hoveredZip];
          let idx = 0;
          if (typeof v === "number" && Number.isFinite(v)) {
            if (max - min <= 0) idx = Math.floor((classes - 1) / 2);
            else idx = Math.max(0, Math.min(classes - 1, Math.floor(((v - min) / (max - min)) * (classes - 1))));
          }
          const color = COLORS[idx];
          map.setFilter(
            SECONDARY_STAT_HOVER_LAYER_ID,
            ["all", ["==", ["get", "zip"], hoveredZip], ["in", ["get", "zip"], ["literal", zipScopeIds]]] as any,
          );
          map.setPaintProperty(SECONDARY_STAT_HOVER_LAYER_ID, "circle-color", color as any);
          map.setPaintProperty(SECONDARY_STAT_HOVER_LAYER_ID, "circle-opacity", 1);
          map.setPaintProperty(SECONDARY_STAT_HOVER_LAYER_ID, "circle-translate", [0, -14] as any);
        } else {
          map.setPaintProperty(SECONDARY_STAT_HOVER_LAYER_ID, "circle-opacity", 0);
          map.setFilter(SECONDARY_STAT_HOVER_LAYER_ID, ["==", ["get", "zip"], "__none__"] as any);
        }
      }
    } else {
      disableZipLayers();
    }
  }

  if (countyLayerAvailable) {
    if (boundaryMode === "counties" && countyEntry && countyScopeIds.length > 0) {
      const baseFilter: any[] = ["all", ["in", ["get", "county"], ["literal", countyScopeIds]]];
      if (hoveredCounty && primaryCountyScope.has(hoveredCounty)) {
        baseFilter.push(["!=", ["get", "county"], hoveredCounty]);
      }
      map.setFilter(COUNTY_SECONDARY_LAYER_ID, baseFilter as any);

      const selectedOrPinnedCounties = new Set<string>();
      for (const county of pinnedCounties) if (primaryCountyScope.has(county)) selectedOrPinnedCounties.add(county);
      for (const county of transientCounties) if (primaryCountyScope.has(county)) selectedOrPinnedCounties.add(county);
      const selectedArray = Array.from(selectedOrPinnedCounties);

      const { data, min, max } = countyEntry;
      const COLORS = TEAL_COLORS;
      const classes = COLORS.length;
      const match: any[] = ["match", ["get", "county"]];
      for (const county of countyScopeIds) {
        const v = data?.[county];
        const color = typeof v === "number" ? COLORS[getClassIndex(v, min, max, classes)] : COLORS[0];
        match.push(county, color);
      }
      match.push(COLORS[0]);

      map.setPaintProperty(COUNTY_SECONDARY_LAYER_ID, "circle-color", match as any);
      map.setPaintProperty(COUNTY_SECONDARY_LAYER_ID, "circle-opacity", 0.95);
      const translateExpr: any = selectedArray.length
        ? [
            "case",
            ["in", ["get", "county"], ["literal", selectedArray]],
            ["literal", [0, -18]],
            ["literal", [0, 0]],
          ]
        : ["literal", [0, 0]];
      map.setPaintProperty(COUNTY_SECONDARY_LAYER_ID, "circle-translate", translateExpr);

      if (map.getLayer(COUNTY_SECONDARY_HOVER_LAYER_ID)) {
        if (hoveredCounty && primaryCountyScope.has(hoveredCounty)) {
          const v = countyEntry.data?.[hoveredCounty];
          let idx = 0;
          if (typeof v === "number" && Number.isFinite(v)) {
            if (max - min <= 0) idx = Math.floor((classes - 1) / 2);
            else idx = Math.max(0, Math.min(classes - 1, Math.floor(((v - min) / (max - min)) * (classes - 1))));
          }
          const color = COLORS[idx];
          map.setFilter(
            COUNTY_SECONDARY_HOVER_LAYER_ID,
            ["all", ["==", ["get", "county"], hoveredCounty], ["in", ["get", "county"], ["literal", countyScopeIds]]] as any,
          );
          map.setPaintProperty(COUNTY_SECONDARY_HOVER_LAYER_ID, "circle-color", color as any);
          map.setPaintProperty(COUNTY_SECONDARY_HOVER_LAYER_ID, "circle-opacity", 1);
          map.setPaintProperty(COUNTY_SECONDARY_HOVER_LAYER_ID, "circle-translate", [0, -18] as any);
        } else {
          map.setPaintProperty(COUNTY_SECONDARY_HOVER_LAYER_ID, "circle-opacity", 0);
          map.setFilter(COUNTY_SECONDARY_HOVER_LAYER_ID, ["==", ["get", "county"], "__none__"] as any);
        }
      }
    } else {
      disableCountyLayers();
    }
  }
};
