import type maplibregl from "maplibre-gl";
import {
  BOUNDARY_SOURCE_ID,
  COUNTY_BOUNDARY_SOURCE_ID,
  COUNTY_CENTROIDS_SOURCE_ID,
  POINTS_OF_INTEREST_SOURCE_ID,
  SOURCE_ID,
  USER_LOCATION_SOURCE_ID,
  ZIP_CENTROIDS_SOURCE_ID,
} from "../constants/map";

export type ThemeName = "light" | "dark";

const MAP_STYLE_LIGHT = "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json";
const MAP_STYLE_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

const BASEMAP_TEXT_OPACITY: Record<ThemeName, number> = {
  light: 0.34,
  dark: 0.46,
};

const CUSTOM_SOURCE_IDS = new Set<string>([
  SOURCE_ID,
  USER_LOCATION_SOURCE_ID,
  BOUNDARY_SOURCE_ID,
  ZIP_CENTROIDS_SOURCE_ID,
  POINTS_OF_INTEREST_SOURCE_ID,
  COUNTY_CENTROIDS_SOURCE_ID,
  COUNTY_BOUNDARY_SOURCE_ID,
]);

export const getMapStyle = (theme: ThemeName): string =>
  theme === "dark" ? MAP_STYLE_DARK : MAP_STYLE_LIGHT;

export const isCustomMapSource = (source: string | undefined): boolean =>
  typeof source === "string" && CUSTOM_SOURCE_IDS.has(source);

export const applyBasemapLabelTone = (map: maplibregl.Map, theme: ThemeName) => {
  const style = map.getStyle() as
    | {
        layers?: Array<{
          id: string;
          type: string;
          source?: string;
          layout?: { "text-field"?: unknown };
        }>;
      }
    | undefined;
  if (!style?.layers?.length) return;
  const targetOpacity = BASEMAP_TEXT_OPACITY[theme];
  for (const layer of style.layers) {
    // Keep app-owned symbol layers at full readability; only soften basemap labels.
    if (layer.type !== "symbol") continue;
    if (!layer.layout || !("text-field" in layer.layout)) continue;
    if (isCustomMapSource(layer.source)) continue;
    try {
      map.setPaintProperty(layer.id, "text-opacity", targetOpacity);
    } catch {}
  }
};
