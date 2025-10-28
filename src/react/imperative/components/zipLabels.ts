import type maplibregl from "maplibre-gl";
import { formatStatValueCompact } from "../../../lib/format";
import { getZipCentroidsMap } from "../../../lib/zipCentroids";
import { CHOROPLETH_COLORS, TEAL_COLORS, getClassIndex } from "../../../lib/choropleth";

interface ZipLabelsOptions {
  map: maplibregl.Map;
  getCentroidsMap?: () => Map<string, [number, number]>;
  labelForId?: (id: string) => string;
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

const formatStatValue = (value: number, type: string = "count"): string => {
  return formatStatValueCompact(value, type);
};

export const createZipLabels = ({ map, getCentroidsMap, labelForId }: ZipLabelsOptions): ZipLabelsController => {
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

  const createLabelElement = (zip: string, isSelected: boolean, isPinned: boolean, isHovered: boolean): HTMLElement | null => {
    const centroid = resolveCentroids().get(zip);
    if (!centroid) return null;

    const [lng, lat] = centroid;
    const element = document.createElement("div");
    element.className = "absolute z-0 flex flex-col items-center";
    const baseTransform = "translate(-50%, -50%)";

    const pillLabel = document.createElement("div");
    const hasStatOverlay = Boolean(currentStatId);
    const baseHeight = hasStatOverlay ? "h-6" : "h-5";
    const selectedHeight = hasStatOverlay && (isSelected || isPinned) ? "h-7" : baseHeight;

    let pillClassName, backgroundColor, textColor;
    if (hasStatOverlay && currentStatData && zip in currentStatData) {
      const allValues = Object.values(currentStatData || {});
      const numericValues = allValues.filter(v => typeof v === 'number' && Number.isFinite(v)) as number[];
      const min = numericValues.length > 0 ? Math.min(...numericValues) : 0;
      const max = numericValues.length > 0 ? Math.max(...numericValues) : 1;
      const classes = CHOROPLETH_COLORS.length;
      const statValue = currentStatData[zip];
      const colorIndex = getClassIndex(statValue, min, max, classes);
      backgroundColor = CHOROPLETH_COLORS[colorIndex];
      const isLightColor = colorIndex <= 2;
      textColor = isLightColor ? '#000000' : 'white';
      const borderClass = isLightColor ? 'border border-slate-300/70' : '';
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

    if (hasStatOverlay && currentStatData && zip in currentStatData) {
      const statValue = currentStatData[zip];
      const isSelectedOrPinned = isSelected || isPinned;
      if (isSelectedOrPinned) {
        pillLabel.textContent = displayLabel;
        element.style.pointerEvents = "auto";
        element.style.cursor = "pointer";
        pillLabel.addEventListener('mouseenter', () => {
          pillLabel.textContent = formatStatValue(statValue, currentStatType);
        });
        pillLabel.addEventListener('mouseleave', () => {
          pillLabel.textContent = displayLabel;
        });
      } else {
        pillLabel.textContent = formatStatValue(statValue, currentStatType);
        element.className = "absolute z-0 flex flex-col items-center pointer-events-none";
      }
    } else {
      pillLabel.textContent = displayLabel;
      element.className = "absolute z-0 flex flex-col items-center pointer-events-none";
    }

    const hasSecondaryData = Boolean(currentSecondaryStatId && currentSecondaryData && (zip in currentSecondaryData));
    const shouldShowSecondary = hasSecondaryData && (isHovered || isSelected || isPinned);
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
        secondaryPill.className = `h-5 px-2 rounded-full font-medium text-xs flex items-center justify-center shadow-md`;
        secondaryPill.style.backgroundColor = backgroundColor;
        secondaryPill.style.color = textColor as any;
        secondaryPill.style.marginBottom = "-4px";
        secondaryPill.style.zIndex = "0";
        secondaryPill.textContent = formatStatValue(secondaryVal, currentSecondaryStatType);
        element.appendChild(secondaryPill);
    }
    element.appendChild(pillLabel);

    const point = map.project([lng, lat]);
    element.style.left = `${point.x}px`;
    element.style.top = `${point.y}px`;
    if (secondaryPill) {
      element.style.transform = `${baseTransform} translateY(6px)`;
    } else {
      element.style.transform = baseTransform;
    }
    map.getContainer().appendChild(element);
    return element;
  };

  const updateAllPositions = () => {
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
