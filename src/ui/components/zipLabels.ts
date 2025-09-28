import type maplibregl from "maplibre-gl";
import { tulsaZipBoundaries } from "../../data/tulsaZipBoundaries";

interface ZipLabelsOptions {
  map: maplibregl.Map;
}

export interface ZipLabelsController {
  setSelectedZips: (zips: string[], pinnedZips: string[]) => void;
  setHoveredZip: (zip: string | null) => void;
  setStatOverlay: (statId: string | null, statData: Record<string, number> | null) => void;
  setTheme: (theme: "light" | "dark") => void;
  destroy: () => void;
}

// Pre-calculate centroids for better performance and accuracy
const zipCentroids = new Map<string, [number, number]>();

const calculateBoundingBoxCenter = (geometry: GeoJSON.Feature<GeoJSON.MultiPolygon | GeoJSON.Polygon>): [number, number] => {
  let minLng = Infinity, maxLng = -Infinity;
  let minLat = Infinity, maxLat = -Infinity;
  
  const processCoordinates = (coords: number[][]) => {
    for (const [lng, lat] of coords) {
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  };
  
  if (geometry.geometry.type === "Polygon") {
    processCoordinates(geometry.geometry.coordinates[0]); // outer ring
  } else if (geometry.geometry.type === "MultiPolygon") {
    // Process all polygons to get overall bounding box
    for (const polygon of geometry.geometry.coordinates) {
      processCoordinates(polygon[0]); // outer ring of each polygon
    }
  }
  
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
};

// Initialize centroids cache on module load
for (const feature of tulsaZipBoundaries.features) {
  const zip = feature.properties.zip;
  zipCentroids.set(zip, calculateBoundingBoxCenter(feature));
}

// Format stat value for display
const formatStatValue = (value: number): string => {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(0)}k`;
  }
  if (value % 1 === 0) {
    return value.toString();
  }
  return value.toFixed(1);
};

export const createZipLabels = ({ map }: ZipLabelsOptions): ZipLabelsController => {
  const labelElements = new Map<string, HTMLElement>();
  let currentSelectedZips = new Set<string>();
  let currentPinnedZips = new Set<string>();
  let currentHoveredZip: string | null = null;
  let currentStatId: string | null = null;
  let currentStatData: Record<string, number> | null = null;
  let currentTheme: "light" | "dark" = "light";
  let updatePositionHandler: (() => void) | null = null;

  const createLabelElement = (zip: string, isSelected: boolean, isPinned: boolean, _isHovered: boolean): HTMLElement => {
    const centroid = zipCentroids.get(zip);
    if (!centroid) throw new Error(`No centroid found for ZIP ${zip}`);

    const [lng, lat] = centroid;
    const element = document.createElement("div");
    
    // Container styles
    element.className = "absolute z-0 flex flex-col items-center";
    element.style.transform = "translate(-50%, -50%)";
    
    // Main pill label
    const pillLabel = document.createElement("div");
    const hasStatOverlay = Boolean(currentStatId);
    const baseHeight = hasStatOverlay ? "h-6" : "h-5";
    const selectedHeight = hasStatOverlay && (isSelected || isPinned) ? "h-7" : baseHeight;
    
    // Enhanced contrast for stat overlay
    let textColor, bgColor, borderColor;
    if (hasStatOverlay) {
      // High contrast colors for better readability over colored backgrounds
      textColor = currentTheme === "dark" ? "text-white" : "text-slate-900";
      bgColor = currentTheme === "dark" ? "bg-slate-900/85" : "bg-white/90";
      borderColor = currentTheme === "dark" ? "border-slate-600" : "border-slate-200";
    } else {
      // Regular colors for normal mode
      textColor = currentTheme === "dark" ? "text-slate-200" : "text-slate-700";
      bgColor = currentTheme === "dark" ? "bg-slate-800/70" : "bg-white/70";
      borderColor = currentTheme === "dark" ? "border-slate-600" : "border-slate-300";
    }

    pillLabel.className = `
      ${selectedHeight} px-2 rounded-full border ${borderColor} ${bgColor} ${textColor}
      font-medium text-xs flex items-center justify-center
      ${hasStatOverlay ? 'shadow-lg backdrop-blur-sm' : 'shadow-md'}
    `;
    
    // Determine what to show in the pill and whether to enable hover
    if (hasStatOverlay && currentStatData && zip in currentStatData) {
      const statValue = currentStatData[zip];
      pillLabel.textContent = formatStatValue(statValue);
      
      // Only enable pill hover for selected/pinned areas
      const isSelectedOrPinned = isSelected || isPinned;
      if (isSelectedOrPinned) {
        element.className = "absolute z-0 flex flex-col items-center pointer-events-auto cursor-pointer";
        // Add pill hover for selected/pinned areas only
        pillLabel.addEventListener('mouseenter', () => {
          pillLabel.textContent = zip;
        });
        pillLabel.addEventListener('mouseleave', () => {
          pillLabel.textContent = formatStatValue(statValue);
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
    
    element.appendChild(pillLabel);

    // Position the element
    const point = map.project([lng, lat]);
    element.style.left = `${point.x}px`;
    element.style.top = `${point.y}px`;
    
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

  const setStatOverlay = (statId: string | null, statData: Record<string, number> | null) => {
    currentStatId = statId;
    currentStatData = statData;
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
    setTheme,
    destroy,
  };
};
