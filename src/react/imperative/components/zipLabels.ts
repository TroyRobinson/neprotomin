import type maplibregl from "maplibre-gl";
import { formatStatValueCompact } from "../../../lib/format";
import { getZipCentroidsMap } from "../../../lib/zipCentroids";
import { getZctaCentroid } from "../../../lib/zctaLoader";
import { CHOROPLETH_COLORS, TEAL_COLORS, getClassIndex } from "../../../lib/choropleth";

interface ZipLabelsOptions {
  map: maplibregl.Map;
  getCentroidsMap?: () => Map<string, [number, number]>;
  labelForId?: (id: string) => string;
  stackedStatsMinZoom?: number;
}

export interface ZipLabelsController {
  setSelectedZips: (zips: string[], pinnedZips: string[]) => void;
  setHoveredZip: (zip: string | null) => void;
  setStatOverlay: (statId: string | null, statData: Record<string, number> | null, statType?: string) => void;
  setSecondaryStatOverlay: (statId: string | null, statData: Record<string, number> | null, statType?: string) => void;
  setTheme: (theme: "light" | "dark") => void;
  setVisible?: (visible: boolean) => void;
  destroy: () => void;
}

const defaultCentroids = (): Map<string, [number, number]> => getZipCentroidsMap();
const ZCTA_STATE = "ok" as const;

const formatStatValue = (value: number, type: string = "count"): string => {
  return formatStatValueCompact(value, type);
};

export const createZipLabels = ({ map, getCentroidsMap, labelForId, stackedStatsMinZoom = 0 }: ZipLabelsOptions): ZipLabelsController => {
  const resolveCentroids = getCentroidsMap ?? defaultCentroids;
  const idToLabel = labelForId || ((id: string) => id);
  const labelElements = new Map<string, HTMLElement>();
  let currentSelectedZips = new Set<string>();
  let currentPinnedZips = new Set<string>();
  let currentHoveredZip: string | null = null;
  let currentStatId: string | null = null;
  let currentStatData: Record<string, number> | null = null;
  let currentStatType: string = "count";
  let currentSecondaryStatId: string | null = null;
  let currentSecondaryData: Record<string, number> | null = null;
  let currentSecondaryStatType: string = "count";
  let currentTheme: "light" | "dark" = "light";
  let updatePositionHandler: (() => void) | null = null;
  let visible = true;
  let shouldShowStackedStats = map.getZoom() >= stackedStatsMinZoom;

  const computeShouldShowStackedStats = (): boolean => map.getZoom() >= stackedStatsMinZoom;

  const createLabelElement = (zip: string, isSelected: boolean, isPinned: boolean, isHovered: boolean): HTMLElement | null => {
    let centroid = resolveCentroids().get(zip);
    if (!centroid && /^\d{5}$/.test(zip)) {
      // Defensive fallback for transient centroid-cache lag on ZIP hover.
      centroid = getZctaCentroid(ZCTA_STATE, zip) ?? undefined;
    }
    if (!centroid) return null;

    const [lng, lat] = centroid;
    const element = document.createElement("div");
    element.className = "absolute z-0 flex flex-col items-center";
    const baseTransform = "translate(-50%, -50%)";
    const isSelectedOrPinned = isSelected || isPinned;
    const canShowStatStacks = shouldShowStackedStats;

    const pillLabel = document.createElement("div");
    const hasStatOverlay = Boolean(currentStatId);
    const baseHeight = hasStatOverlay ? "h-6" : "h-5";
    const selectedHeight = hasStatOverlay && (isSelected || isPinned) ? "h-7" : baseHeight;
    const primaryPalette = (() => {
      if (!hasStatOverlay || !currentStatData || !(zip in currentStatData)) return null;
      const value = currentStatData[zip];
      const allValues = Object.values(currentStatData || {});
      const numericValues = allValues.filter(v => typeof v === "number" && Number.isFinite(v)) as number[];
      const min = numericValues.length > 0 ? Math.min(...numericValues) : 0;
      const max = numericValues.length > 0 ? Math.max(...numericValues) : 1;
      const colorIndex = getClassIndex(value, min, max, CHOROPLETH_COLORS.length);
      return {
        value,
        bg: CHOROPLETH_COLORS[colorIndex],
        text: colorIndex <= 2 ? "#000000" : "#ffffff",
      };
    })();

    let pillClassName: string;
    let backgroundColor: string | null;
    let textColor: string | null;
    let borderColorOverride: string | null = null;
    if (hasStatOverlay && currentStatData && zip in currentStatData) {
      const isHoverOnlyPrimaryValue = canShowStatStacks && isHovered && !isSelectedOrPinned;
      const hasSecondaryStat = Boolean(currentSecondaryStatId);
      // Selected areas keep the dark/light inverted label style; hover-only value pills use white/black.
      backgroundColor = isHoverOnlyPrimaryValue
        ? (currentTheme === "light" ? "#ffffff" : "#111827")
        : (currentTheme === "light" ? "#111827" : "#ffffff");
      textColor = isHoverOnlyPrimaryValue
        ? (currentTheme === "light" ? "#111827" : "#ffffff")
        : (currentTheme === "light" ? "#ffffff" : "#111827");
      // When secondary stat is active, add a thin primary-color border on hover-only value pills.
      borderColorOverride = isHoverOnlyPrimaryValue && hasSecondaryStat && primaryPalette ? primaryPalette.bg : null;
      const borderClass = isHoverOnlyPrimaryValue
        ? "border"
        : (currentTheme === "light" ? "border border-slate-900/80" : "border border-slate-300/90");
      pillClassName = `
        ${selectedHeight} px-2 rounded-full font-medium text-xs flex items-center justify-center
        shadow-lg backdrop-blur-sm ${borderClass}
      `;
    } else {
      const regularTextColor = currentTheme === "dark" ? "text-slate-200" : "text-slate-700";
      const regularBgColor = currentTheme === "dark" ? "bg-slate-800/70" : "bg-white/70";
      const regularBorderColor = currentTheme === "dark" ? "border-slate-600" : "border-slate-300";
      pillClassName = `
        ${selectedHeight} px-2 rounded-full border ${regularBorderColor} ${regularBgColor} ${regularTextColor}
        font-medium text-xs flex items-center justify-center shadow-md
      `;
      backgroundColor = null;
      textColor = null;
    }
    pillLabel.className = pillClassName;
    if (backgroundColor) pillLabel.style.backgroundColor = backgroundColor as any;
    if (textColor) pillLabel.style.color = textColor as any;
    if (borderColorOverride) pillLabel.style.borderColor = borderColorOverride;

    const displayLabel = idToLabel(zip);

    if (hasStatOverlay && currentStatData && zip in currentStatData) {
      const statValue = currentStatData[zip];
      if (isSelectedOrPinned || !canShowStatStacks) {
        pillLabel.textContent = displayLabel;
        element.className = "absolute z-0 flex flex-col items-center pointer-events-none";
      } else {
        pillLabel.textContent = formatStatValue(statValue, currentStatType);
        element.className = "absolute z-0 flex flex-col items-center pointer-events-none";
      }
    } else {
      pillLabel.textContent = displayLabel;
      element.className = "absolute z-0 flex flex-col items-center pointer-events-none";
    }

    const hasPrimaryData = Boolean(currentStatId && currentStatData && zip in currentStatData);
    const shouldShowPrimaryStat = canShowStatStacks && hasPrimaryData && (isSelected || isPinned);
    let primaryPill: HTMLDivElement | null = null;
    if (shouldShowPrimaryStat && primaryPalette) {
      primaryPill = document.createElement("div");
      primaryPill.className = "h-5 px-2 rounded-full font-medium text-xs flex items-center justify-center shadow-md";
      primaryPill.style.backgroundColor = primaryPalette.bg;
      primaryPill.style.color = primaryPalette.text;
      primaryPill.style.marginBottom = "-4px";
      primaryPill.style.zIndex = "0";
      primaryPill.textContent = formatStatValue(primaryPalette.value, currentStatType);
    }

    const hasSecondaryData = Boolean(currentSecondaryStatId && currentSecondaryData && (zip in currentSecondaryData));
    const shouldShowSecondary = canShowStatStacks && hasSecondaryData && (isHovered || isSelected || isPinned);
    let secondaryPill: HTMLDivElement | null = null;
    if (shouldShowSecondary) {
      const secondaryVal = currentSecondaryData![zip];
      secondaryPill = document.createElement("div");
      const allValues = Object.values(currentSecondaryData || {});
      const numericValues = allValues.filter(v => typeof v === 'number' && Number.isFinite(v)) as number[];
      const min = numericValues.length > 0 ? Math.min(...numericValues) : 0;
      const max = numericValues.length > 0 ? Math.max(...numericValues) : 1;
      const classes = TEAL_COLORS.length;
      const colorIndex = getClassIndex(secondaryVal, min, max, classes);
      const backgroundColor = TEAL_COLORS[colorIndex];
      const isLightColor = colorIndex <= 2;
      const textColor = isLightColor ? '#64748b' : 'white';
      secondaryPill.className = "h-5 px-2 rounded-full font-medium text-xs flex items-center justify-center shadow-md";
      secondaryPill.style.backgroundColor = backgroundColor;
      secondaryPill.style.color = textColor as any;
      secondaryPill.style.marginBottom = "-4px";
      secondaryPill.style.zIndex = "0";
      secondaryPill.textContent = formatStatValue(secondaryVal, currentSecondaryStatType);
    }
    // Keep stacked stat chips behind the area label for quick visual comparison.
    if (secondaryPill) element.appendChild(secondaryPill);
    if (primaryPill) element.appendChild(primaryPill);
    element.appendChild(pillLabel);

    const point = map.project([lng, lat]);
    element.style.left = `${point.x}px`;
    element.style.top = `${point.y}px`;
    const stackCount = (secondaryPill ? 1 : 0) + (primaryPill ? 1 : 0);
    if (stackCount > 0) {
      element.style.transform = `${baseTransform} translateY(${stackCount * 6}px)`;
    } else {
      element.style.transform = baseTransform;
    }
    map.getContainer().appendChild(element);
    return element;
  };

  const updateAllPositions = () => {
    const nextShouldShowStackedStats = computeShouldShowStackedStats();
    if (nextShouldShowStackedStats !== shouldShowStackedStats) {
      shouldShowStackedStats = nextShouldShowStackedStats;
      updateLabels();
      return;
    }
    for (const [zipCode, element] of labelElements) {
      const centroid = resolveCentroids().get(zipCode);
      if (!centroid) continue;
      const [lng, lat] = centroid;
      const point = map.project([lng, lat]);
      element.style.left = `${point.x}px`;
      element.style.top = `${point.y}px`;
    }
  };

  const updateLabels = () => {
    if (!visible) return;
    shouldShowStackedStats = computeShouldShowStackedStats();
    for (const [_zip, element] of labelElements) {
      element.remove();
    }
    labelElements.clear();
    const zipsToLabel = new Set([...currentSelectedZips, ...currentPinnedZips]);
    if (currentHoveredZip && !zipsToLabel.has(currentHoveredZip)) {
      zipsToLabel.add(currentHoveredZip);
    }
    for (const zip of zipsToLabel) {
      const isSelected = currentSelectedZips.has(zip);
      const isPinned = currentPinnedZips.has(zip);
      const isHovered = currentHoveredZip === zip;
      const element = createLabelElement(zip, isSelected, isPinned, isHovered);
      if (element) {
        labelElements.set(zip, element);
      }
    }
    if (updatePositionHandler) {
      map.off("move", updatePositionHandler);
      map.off("zoom", updatePositionHandler);
    }
    if (labelElements.size > 0) {
      updatePositionHandler = updateAllPositions;
      map.on("move", updatePositionHandler);
      map.on("zoom", updatePositionHandler);
    } else {
      updatePositionHandler = null;
    }
  };

  const setSelectedZips = (zips: string[], pinnedZips: string[]) => {
    const selectedSet = new Set(zips);
    const pinnedSet = new Set(pinnedZips);
    if (
      selectedSet.size === currentSelectedZips.size &&
      pinnedSet.size === currentPinnedZips.size &&
      [...selectedSet].every(z => currentSelectedZips.has(z)) &&
      [...pinnedSet].every(z => currentPinnedZips.has(z))
    ) {
      return;
    }
    currentSelectedZips = selectedSet;
    currentPinnedZips = pinnedSet;
    if (visible) updateLabels();
  };

  const setHoveredZip = (zip: string | null) => {
    if (currentHoveredZip === zip) return;
    currentHoveredZip = zip;
    if (visible) updateLabels();
  };

  const setStatOverlay = (statId: string | null, statData: Record<string, number> | null, statType?: string) => {
    currentStatId = statId;
    currentStatData = statData;
    if (statType) currentStatType = statType;
    if (visible) updateLabels();
  };

  const setSecondaryStatOverlay = (statId: string | null, statData: Record<string, number> | null, statType?: string) => {
    currentSecondaryStatId = statId;
    currentSecondaryData = statData;
    if (statType) currentSecondaryStatType = statType;
    if (visible) updateLabels();
  };

  const setTheme = (theme: "light" | "dark") => {
    if (currentTheme === theme) return;
    currentTheme = theme;
    if (visible) updateLabels();
  };

  const setVisible = (v: boolean) => {
    if (visible === v) return;
    visible = v;
    if (!visible) {
      // Remove all elements and stop tracking
      if (updatePositionHandler) {
        map.off("move", updatePositionHandler);
        map.off("zoom", updatePositionHandler);
        updatePositionHandler = null;
      }
      for (const [, el] of labelElements) el.remove();
      labelElements.clear();
    } else {
      updateLabels();
    }
  };

  const destroy = () => {
    if (updatePositionHandler) {
      map.off("move", updatePositionHandler);
      map.off("zoom", updatePositionHandler);
    }
    for (const [_zip, element] of labelElements) {
      element.remove();
    }
    labelElements.clear();
  };

  return {
    setSelectedZips,
    setHoveredZip,
    setStatOverlay,
    setSecondaryStatOverlay,
    setTheme,
    setVisible,
    destroy,
  };
};
