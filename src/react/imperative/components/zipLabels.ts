import type maplibregl from "maplibre-gl";
import { formatStatValueCompact } from "../../../lib/format";
import { getZipCentroidsMap } from "../../../lib/zipCentroids";
import { CHOROPLETH_COLORS, TEAL_COLORS, getClassIndex } from "../../../lib/choropleth";

interface ZipLabelsOptions {
  map: maplibregl.Map;
  getCentroidsMap?: () => Map<string, [number, number]>;
  labelForId?: (id: string) => string;
  stackedStatsMinZoom?: number;
}

export type HoverPillTone = "good" | "bad" | "neutral";
export type HoverPillDirection = "up" | "down";

export interface HoverStackPill {
  key: string;
  label: string;
  tone: HoverPillTone;
  direction: HoverPillDirection;
}

export interface ZipLabelsController {
  setSelectedZips: (zips: string[], pinnedZips: string[]) => void;
  setHoveredZip: (zip: string | null) => void;
  setHoverPillsByArea: (rowsByArea: Map<string, HoverStackPill[]>) => void;
  setStatOverlay: (statId: string | null, statData: Record<string, number> | null, statType?: string) => void;
  setSecondaryStatOverlay: (statId: string | null, statData: Record<string, number> | null, statType?: string) => void;
  setTheme: (theme: "light" | "dark") => void;
  setVisible?: (visible: boolean) => void;
  destroy: () => void;
}

const defaultCentroids = (): Map<string, [number, number]> => getZipCentroidsMap();

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
  let currentHoverPillsByArea = new Map<string, HoverStackPill[]>();
  let currentTheme: "light" | "dark" = "light";
  let updatePositionHandler: (() => void) | null = null;
  let visible = true;
  let shouldShowStackedStats = map.getZoom() >= stackedStatsMinZoom;

  const computeShouldShowStackedStats = (): boolean => map.getZoom() >= stackedStatsMinZoom;

  const createLabelElement = (zip: string, isSelected: boolean, isPinned: boolean, isHovered: boolean): HTMLElement | null => {
    const centroid = resolveCentroids().get(zip);
    if (!centroid) return null;

    const [lng, lat] = centroid;
    const element = document.createElement("div");
    element.className = "absolute z-0 flex flex-col items-center";
    const baseTransform = "translate(-50%, -50%)";
    const isSelectedOrPinned = isSelected || isPinned;
    const hasPrimaryData = Boolean(currentStatId && currentStatData && zip in currentStatData);
    const hasSecondaryData = Boolean(currentSecondaryStatId && currentSecondaryData && (zip in currentSecondaryData));
    // Hovered area always gets the full stat stack; selected/pinned areas stay zoom-gated.
    const shouldShowPrimaryStat = hasPrimaryData && (isHovered || (shouldShowStackedStats && isSelectedOrPinned));
    const shouldShowSecondary = hasSecondaryData && (isHovered || (shouldShowStackedStats && isSelectedOrPinned));

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
    if (hasPrimaryData) {
      backgroundColor = currentTheme === "light" ? "#111827" : "#ffffff";
      textColor = currentTheme === "light" ? "#ffffff" : "#111827";
      const borderClass = currentTheme === "light" ? "border border-slate-900/80" : "border border-slate-300/90";
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

    const displayLabel = idToLabel(zip);

    pillLabel.textContent = displayLabel;
    element.className = "absolute z-0 flex flex-col items-center pointer-events-none";

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

    if (isHovered) {
      const hoverRows = currentHoverPillsByArea.get(zip) ?? [];
      for (const row of hoverRows) {
        const rowPill = document.createElement("div");
        rowPill.className = [
          "h-5 px-2 rounded-full border border-slate-300/80 bg-white/95",
          "font-medium text-xs flex items-center gap-1.5 justify-center shadow-md",
          "text-slate-700 dark:border-slate-600/80 dark:bg-slate-900/95 dark:text-slate-200",
        ].join(" ");
        rowPill.style.marginTop = "-2px";

        const arrow = document.createElement("span");
        arrow.textContent = row.direction === "up" ? "▲" : "▼";
        arrow.style.fontWeight = "700";
        arrow.style.color =
          row.tone === "good" ? "#6fc284" : row.tone === "bad" ? "#f15b41" : "#f8d837";

        const text = document.createElement("span");
        text.textContent = row.label;

        rowPill.appendChild(arrow);
        rowPill.appendChild(text);
        element.appendChild(rowPill);
      }
    }

    const point = map.project([lng, lat]);
    element.style.left = `${point.x}px`;
    element.style.top = `${point.y}px`;
    // Keep the entire pill stack centered on the centroid.
    // `translate(-50%, -50%)` already centers the rendered stack box.
    element.style.transform = baseTransform;
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

  const setHoverPillsByArea = (rowsByArea: Map<string, HoverStackPill[]>) => {
    currentHoverPillsByArea = rowsByArea;
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
    setHoverPillsByArea,
    setStatOverlay,
    setSecondaryStatOverlay,
    setTheme,
    setVisible,
    destroy,
  };
};
