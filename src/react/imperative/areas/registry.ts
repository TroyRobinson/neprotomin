import type { BoundsArray } from "../../../lib/zipBoundaries";
import { getZipBounds } from "../../../lib/zipBoundaries";
import { getZipCentroidsMap } from "../../../lib/zipCentroids";
import { getCountyBounds } from "../../../lib/countyBoundaries";
import { getCountyCentroidsMap, getCountyName } from "../../../lib/countyCentroids";
import type { AreaKind } from "../../../types/areas";
import {
  BOUNDARY_SOURCE_ID,
  BOUNDARY_FILL_LAYER_ID,
  BOUNDARY_LINE_LAYER_ID,
  BOUNDARY_STATDATA_FILL_LAYER_ID,
  BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
  BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
  BOUNDARY_PINNED_FILL_LAYER_ID,
  BOUNDARY_PINNED_LINE_LAYER_ID,
  BOUNDARY_HOVER_FILL_LAYER_ID,
  BOUNDARY_HOVER_LINE_LAYER_ID,
  ZIP_CENTROIDS_SOURCE_ID,
  COUNTY_BOUNDARY_SOURCE_ID,
  COUNTY_BOUNDARY_FILL_LAYER_ID,
  COUNTY_BOUNDARY_LINE_LAYER_ID,
  COUNTY_STATDATA_FILL_LAYER_ID,
  COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
  COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
  COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID,
  COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID,
  COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
  COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
} from "../constants/map";

export interface AreaLayerIds {
  sourceId: string;
  baseFillLayerId: string;
  baseLineLayerId: string;
  statDataFillLayerId: string;
  highlightFillLayerId: string;
  highlightLineLayerId: string;
  pinnedFillLayerId: string;
  pinnedLineLayerId: string;
  hoverFillLayerId: string;
  hoverLineLayerId: string;
}

export interface AreaRegistryEntry {
  kind: AreaKind;
  featureIdProperty: string;
  centroidSourceId?: string;
  getBounds: (id: string) => BoundsArray | null;
  getName: (id: string) => string | null;
  getLabel: (id: string) => string;
  getCentroidsMap?: () => Map<string, [number, number]>;
  layers: AreaLayerIds;
  isEnabled: boolean;
}

type AreaRegistry = Record<AreaKind, AreaRegistryEntry>;

/**
 * Central registry describing how each area type maps to geo sources, labels, and metadata.
 * The rest of the refactor will lean on this instead of scattered ZIP/COUNTY conditionals.
 */
const registry: AreaRegistry = {
  ZIP: {
    kind: "ZIP",
    featureIdProperty: "zip",
    centroidSourceId: ZIP_CENTROIDS_SOURCE_ID,
    getBounds: (id) => getZipBounds(id),
    getName: (id) => id,
    getLabel: (id) => id,
    getCentroidsMap: () => getZipCentroidsMap(),
    layers: {
      sourceId: BOUNDARY_SOURCE_ID,
      baseFillLayerId: BOUNDARY_FILL_LAYER_ID,
      baseLineLayerId: BOUNDARY_LINE_LAYER_ID,
      statDataFillLayerId: BOUNDARY_STATDATA_FILL_LAYER_ID,
      highlightFillLayerId: BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
      highlightLineLayerId: BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
      pinnedFillLayerId: BOUNDARY_PINNED_FILL_LAYER_ID,
      pinnedLineLayerId: BOUNDARY_PINNED_LINE_LAYER_ID,
      hoverFillLayerId: BOUNDARY_HOVER_FILL_LAYER_ID,
      hoverLineLayerId: BOUNDARY_HOVER_LINE_LAYER_ID,
    },
    isEnabled: true,
  },
  COUNTY: {
    kind: "COUNTY",
    featureIdProperty: "county",
    getBounds: (id) => getCountyBounds(id),
    getName: (id) => getCountyName(id) ?? null,
    getLabel: (id) => getCountyName(id) ?? id,
    getCentroidsMap: () => getCountyCentroidsMap(),
    layers: {
      sourceId: COUNTY_BOUNDARY_SOURCE_ID,
      baseFillLayerId: COUNTY_BOUNDARY_FILL_LAYER_ID,
      baseLineLayerId: COUNTY_BOUNDARY_LINE_LAYER_ID,
      statDataFillLayerId: COUNTY_STATDATA_FILL_LAYER_ID,
      highlightFillLayerId: COUNTY_BOUNDARY_HIGHLIGHT_FILL_LAYER_ID,
      highlightLineLayerId: COUNTY_BOUNDARY_HIGHLIGHT_LINE_LAYER_ID,
      pinnedFillLayerId: COUNTY_BOUNDARY_PINNED_FILL_LAYER_ID,
      pinnedLineLayerId: COUNTY_BOUNDARY_PINNED_LINE_LAYER_ID,
      hoverFillLayerId: COUNTY_BOUNDARY_HOVER_FILL_LAYER_ID,
      hoverLineLayerId: COUNTY_BOUNDARY_HOVER_LINE_LAYER_ID,
    },
    isEnabled: true,
  },
  TRACT: {
    kind: "TRACT",
    featureIdProperty: "tract",
    getBounds: () => null,
    getName: (id) => id,
    getLabel: (id) => id,
    layers: {
      sourceId: "",
      baseFillLayerId: "",
      baseLineLayerId: "",
      statDataFillLayerId: "",
      highlightFillLayerId: "",
      highlightLineLayerId: "",
      pinnedFillLayerId: "",
      pinnedLineLayerId: "",
      hoverFillLayerId: "",
      hoverLineLayerId: "",
    },
    isEnabled: false,
  },
};

export const getAreaRegistryEntry = (kind: AreaKind): AreaRegistryEntry => registry[kind];

export const listEnabledAreaEntries = (): AreaRegistryEntry[] =>
  Object.values(registry).filter((entry) => entry.isEnabled);

export const listAllAreaEntries = (): AreaRegistryEntry[] => Object.values(registry);
