import type maplibregl from "maplibre-gl";
import { tulsaZipBoundaries } from "../../../data/tulsaZipBoundaries";
import { formatStatValueCompact } from "../../../lib/format";

interface ZipLabelsOptions {
  map: maplibregl.Map;
}

export interface ZipLabelsController {
  setSelectedZips: (zips: string[], pinnedZips: string[]) => void;
  setHoveredZip: (zip: string | null) => void;
  setStatOverlay: (statId: string | null, statData: Record<string, number> | null, statType?: string) => void;
  setSecondaryStatOverlay: (statId: string | null, statData: Record<string, number> | null, statType?: string) => void;
  setTheme: (theme: "light" | "dark") => void;
  destroy: () => void;
}

const zipCentroids = new Map<string, [number, number]>();

const ringCentroid = (ring: number[][]): [number, number, number] => {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  area *= 0.5;
  if (area === 0) {
    let sx = 0, sy = 0;
    for (const [x, y] of ring) { sx += x; sy += y; }
    return [sx / ring.length, sy / ring.length, 0];
  }
  return [cx / (6 * area), cy / (6 * area), Math.abs(area)];
};

for (const feature of tulsaZipBoundaries.features as any) {
  const zip = feature.properties.zip as string;
  if (!zip) continue;
  let totalArea = 0;
  let accX = 0, accY = 0;
  if (feature.geometry.type === "Polygon") {
    const [cx, cy, a] = ringCentroid(feature.geometry.coordinates[0]);
    totalArea += a;
    accX += cx * a;
    accY += cy * a;
  } else if (feature.geometry.type === "MultiPolygon") {
    for (const poly of feature.geometry.coordinates) {
      const [cx, cy, a] = ringCentroid(poly[0]);
      totalArea += a;
      accX += cx * a;
      accY += cy * a;
    }
  }
  const center: [number, number] = totalArea > 0 ? [accX / totalArea, accY / totalArea] : [0, 0];
  zipCentroids.set(zip, center);
}

const formatStatValue = (value: number, type: string = "count"): string => {
  return formatStatValueCompact(value, type);
};

export const createZipLabels = ({ map }: ZipLabelsOptions): ZipLabelsController => {
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

  const createLabelElement = (zip: string, isSelected: boolean, isPinned: boolean, isHovered: boolean): HTMLElement => {
    const centroid = zipCentroids.get(zip);
    if (!centroid) throw new Error(`No centroid found for ZIP ${zip}`);

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
      const CHOROPLETH_COLORS = [
        "#e9efff",
        "#cdd9ff",
        "#aebfff",
        "#85a3ff",
        "#6d8afc",
        "#4a6af9",
        "#3755f0",
      ];
      const allValues = Object.values(currentStatData || {});
      const numericValues = allValues.filter(v => typeof v === 'number' && Number.isFinite(v)) as number[];
      const min = numericValues.length > 0 ? Math.min(...numericValues) : 0;
      const max = numericValues.length > 0 ? Math.max(...numericValues) : 1;
      const range = max - min;
      const classes = CHOROPLETH_COLORS.length;
      const idxFor = (v: number) => {
        if (!Number.isFinite(v)) return 0;
        if (range <= 0) return Math.floor((classes - 1) / 2);
        const r = (v - min) / range;
        return Math.max(0, Math.min(classes - 1, Math.floor(r * (classes - 1))));
      };
      const statValue = currentStatData[zip];
      const colorIndex = idxFor(statValue);
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

    if (hasStatOverlay && currentStatData && zip in currentStatData) {
      const statValue = currentStatData[zip];
      pillLabel.textContent = formatStatValue(statValue, currentStatType);
      const isSelectedOrPinned = isSelected || isPinned;
      if (isSelectedOrPinned) {
        element.className = "absolute z-0 flex flex-col items-center pointer-events-auto cursor-pointer";
        pillLabel.addEventListener('mouseenter', () => {
          pillLabel.textContent = zip;
        });
        pillLabel.addEventListener('mouseleave', () => {
          pillLabel.textContent = formatStatValue(statValue, currentStatType);
        });
      } else {
        element.className = "absolute z-0 flex flex-col items-center pointer-events-none";
      }
    } else {
      pillLabel.textContent = zip;
      element.className = "absolute z-0 flex flex-col items-center pointer-events-none";
    }

    const hasSecondaryData = Boolean(currentSecondaryStatId && currentSecondaryData && (zip in currentSecondaryData));
    const shouldShowSecondary = hasSecondaryData && (isHovered || isSelected || isPinned);
    let secondaryPill: HTMLDivElement | null = null;
    if (shouldShowSecondary) {
      const secondaryVal = currentSecondaryData![zip];
      secondaryPill = document.createElement("div");
      const TEAL_COLORS = [
        "#f9fffd",
        "#e9fffb",
        "#c9fbf2",
        "#99f0e3",
        "#63dfd0",
        "#24c7b8",
        "#0f766e",
      ];
      const allValues = Object.values(currentSecondaryData || {});
      const numericValues = allValues.filter(v => typeof v === 'number' && Number.isFinite(v)) as number[];
      const min = numericValues.length > 0 ? Math.min(...numericValues) : 0;
      const max = numericValues.length > 0 ? Math.max(...numericValues) : 1;
      const range = max - min;
      const classes = TEAL_COLORS.length;
      const idxFor = (v: number) => {
        if (!Number.isFinite(v)) return 0;
        if (range <= 0) return Math.floor((classes - 1) / 2);
        const r = (v - min) / range;
        return Math.max(0, Math.min(classes - 1, Math.floor(r * (classes - 1))));
      };
      const colorIndex = idxFor(secondaryVal);
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
      const centroid = zipCentroids.get(zipCode);
      if (!centroid) continue;
      const [lng, lat] = centroid;
      const point = map.project([lng, lat]);
      element.style.left = `${point.x}px`;
      element.style.top = `${point.y}px`;
    }
  };

  const updateLabels = () => {
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
      try {
        const element = createLabelElement(zip, isSelected, isPinned, isHovered);
        labelElements.set(zip, element);
      } catch {}
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
    updateLabels();
  };

  const setHoveredZip = (zip: string | null) => {
    if (currentHoveredZip === zip) return;
    currentHoveredZip = zip;
    updateLabels();
  };

  const setStatOverlay = (statId: string | null, statData: Record<string, number> | null, statType?: string) => {
    currentStatId = statId;
    currentStatData = statData;
    if (statType) currentStatType = statType;
    updateLabels();
  };

  const setSecondaryStatOverlay = (statId: string | null, statData: Record<string, number> | null, statType?: string) => {
    currentSecondaryStatId = statId;
    currentSecondaryData = statData;
    if (statType) currentSecondaryStatType = statType;
    updateLabels();
  };

  const setTheme = (theme: "light" | "dark") => {
    if (currentTheme === theme) return;
    currentTheme = theme;
    updateLabels();
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
    destroy,
  };
};


