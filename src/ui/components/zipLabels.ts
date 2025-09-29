import type maplibregl from "maplibre-gl";
import { tulsaZipBoundaries } from "../../data/tulsaZipBoundaries";
import { formatStatValueCompact } from "../../lib/format";

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

// Pre-calculate geometric centroids (area-weighted for multipolygons)
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

// Format stat value for display - now uses the shared utility
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
    
    // Container styles
    element.className = "absolute z-0 flex flex-col items-center";
    // Center the group on the centroid; we may nudge on hover to account for lifted circle
    const baseTransform = "translate(-50%, -50%)";
    
    // Main pill label
    const pillLabel = document.createElement("div");
    const hasStatOverlay = Boolean(currentStatId);
    const baseHeight = hasStatOverlay ? "h-6" : "h-5";
    const selectedHeight = hasStatOverlay && (isSelected || isPinned) ? "h-7" : baseHeight;
    
    // Dynamic colors for stat overlay or regular colors for normal mode
    let pillClassName, backgroundColor, textColor;
    
    if (hasStatOverlay && currentStatData && zip in currentStatData) {
      // Calculate dynamic colors based on primary stat value (matching the choropleth)
      const CHOROPLETH_COLORS = [
        "#e9efff",
        "#cdd9ff", 
        "#aebfff",
        "#85a3ff",
        "#6d8afc",
        "#4a6af9",
        "#3755f0",
      ];
      
      // Get min/max from all primary stat data to calculate color index
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
      
      // Determine text color and border based on background lightness
      // For very light colors (first 2-3 colors), use solid black text and subtle border
      // For darker colors, use white text and no border
      const isLightColor = colorIndex <= 2; // First 3 colors are very light
      textColor = isLightColor ? '#000000' : 'white'; // solid black for light backgrounds
      
      // Add subtle border for very light backgrounds to provide definition
      const borderClass = isLightColor ? 'border border-slate-300/70' : '';
      
      pillClassName = `
        ${selectedHeight} px-2 rounded-full font-medium text-xs flex items-center justify-center
        shadow-lg backdrop-blur-sm ${borderClass}
      `;
    } else {
      // Regular colors for normal mode
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
    
    // Apply the calculated styles
    pillLabel.className = pillClassName;
    if (backgroundColor) {
      pillLabel.style.backgroundColor = backgroundColor;
    }
    if (textColor) {
      pillLabel.style.color = textColor;
    }
    
    // Determine what to show in the pill and whether to enable hover
    if (hasStatOverlay && currentStatData && zip in currentStatData) {
      const statValue = currentStatData[zip];
      pillLabel.textContent = formatStatValue(statValue, currentStatType);
      
      // Only enable pill hover for selected/pinned areas
      const isSelectedOrPinned = isSelected || isPinned;
      if (isSelectedOrPinned) {
        element.className = "absolute z-0 flex flex-col items-center pointer-events-auto cursor-pointer";
        // Add pill hover for selected/pinned areas only
        pillLabel.addEventListener('mouseenter', () => {
          pillLabel.textContent = zip;
        });
        pillLabel.addEventListener('mouseleave', () => {
          pillLabel.textContent = formatStatValue(statValue, currentStatType);
        });
      } else {
        // Non-selected areas: no pill hover interaction
        element.className = "absolute z-0 flex flex-col items-center pointer-events-none";
      }
    } else {
      // Regular mode: always show ZIP, no pointer events
      pillLabel.textContent = zip;
      element.className = "absolute z-0 flex flex-col items-center pointer-events-none";
    }
    
    const hasSecondaryData = Boolean(currentSecondaryStatId && currentSecondaryData && (zip in currentSecondaryData));
    const shouldShowSecondary = hasSecondaryData && (isHovered || isSelected || isPinned);

    // Optional secondary pill when we have a secondary stat (hovered or selected/pinned)
    let secondaryPill: HTMLDivElement | null = null;
    if (shouldShowSecondary) {
      const secondaryVal = currentSecondaryData![zip];
      secondaryPill = document.createElement("div");
      
      // Calculate color based on secondary stat value (matching the overlay circles)
      const TEAL_COLORS = [
        "#f9fffd",
        "#e9fffb", 
        "#c9fbf2",
        "#99f0e3",
        "#63dfd0",
        "#24c7b8",
        "#0f766e",
      ];
      
      // Get min/max from all secondary data to calculate color index
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
      
      // Determine text color based on background lightness
      // For very light colors (first 2-3 colors), use grey with teal tint
      // For darker colors, use white
      const isLightColor = colorIndex <= 2; // First 3 colors are very light
      const textColor = isLightColor ? '#64748b' : 'white'; // slate-500 for light backgrounds
      
      // Slightly tucked behind main pill, placed above
      // No border, dynamic color fill with contrast-appropriate text
      secondaryPill.className = `h-5 px-2 rounded-full font-medium text-xs flex items-center justify-center shadow-md`;
      secondaryPill.style.backgroundColor = backgroundColor;
      secondaryPill.style.color = textColor;
      secondaryPill.style.marginBottom = "-4px"; // tuck under main
      secondaryPill.style.zIndex = "0";
      secondaryPill.textContent = formatStatValue(secondaryVal, currentSecondaryStatType);
      element.appendChild(secondaryPill);
    }
    element.appendChild(pillLabel);

    // Position the element
    const point = map.project([lng, lat]);
    element.style.left = `${point.x}px`;
    element.style.top = `${point.y}px`;
    // Nudge group downward when secondary stack is visible so lifted circle stays centered
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
    // Clear existing labels
    for (const [_zip, element] of labelElements) {
      element.remove();
    }
    labelElements.clear();

    // Create labels for selected/pinned ZIPs
    const zipsToLabel = new Set([...currentSelectedZips, ...currentPinnedZips]);
    
    // Add hovered ZIP if not already selected/pinned
    if (currentHoveredZip && !zipsToLabel.has(currentHoveredZip)) {
      zipsToLabel.add(currentHoveredZip);
    }

    // Create label elements
    for (const zip of zipsToLabel) {
      const isSelected = currentSelectedZips.has(zip);
      const isPinned = currentPinnedZips.has(zip);
      const isHovered = currentHoveredZip === zip;
      
      try {
        const element = createLabelElement(zip, isSelected, isPinned, isHovered);
        labelElements.set(zip, element);
      } catch (error) {
        console.warn(`Failed to create label for ZIP ${zip}:`, error);
      }
    }

    // Set up position update handler
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
      return; // No change
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
    // Clean up event listeners
    if (updatePositionHandler) {
      map.off("move", updatePositionHandler);
      map.off("zoom", updatePositionHandler);
    }
    
    // Remove all label elements (event listeners are cleaned up automatically)
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
