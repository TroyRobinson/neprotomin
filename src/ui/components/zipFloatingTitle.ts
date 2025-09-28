import type maplibregl from "maplibre-gl";
import { tulsaZipBoundaries } from "../../data/tulsaZipBoundaries";

interface ZipFloatingTitleOptions {
  map: maplibregl.Map;
}

export interface ZipFloatingTitleController {
  show: (zip: string) => void;
  hide: () => void;
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

export const createZipFloatingTitle = ({ map }: ZipFloatingTitleOptions): ZipFloatingTitleController => {
  let titleElement: HTMLElement | null = null;
  let currentZip: string | null = null;
  let updatePositionHandler: (() => void) | null = null;

  // Create the element once and reuse it
  const createTitleElement = () => {
    if (!titleElement) {
      titleElement = document.createElement("div");
      titleElement.className = 
        "absolute z-0 pointer-events-none text-slate-500 text-[12px] font-normal " +
        "dark:text-slate-400";
      titleElement.style.transform = "translate(-50%, -50%)";
      titleElement.style.opacity = "0.7";
      map.getContainer().appendChild(titleElement);
    }
    return titleElement;
  };

  const show = (zip: string) => {
    if (currentZip === zip) return; // Already showing this ZIP
    
    const centroid = zipCentroids.get(zip);
    if (!centroid) return;
    
    const [lng, lat] = centroid;
    const element = createTitleElement();
    
    // Update content and position
    element.textContent = zip;
    const point = map.project([lng, lat]);
    element.style.left = `${point.x}px`;
    element.style.top = `${point.y}px`;
    
    // Clean up previous event listeners
    if (updatePositionHandler) {
      map.off("move", updatePositionHandler);
      map.off("zoom", updatePositionHandler);
    }
    
    // Set up new position update handler
    updatePositionHandler = () => {
      if (!titleElement || currentZip !== zip) return;
      const updatedPoint = map.project([lng, lat]);
      titleElement.style.left = `${updatedPoint.x}px`;
      titleElement.style.top = `${updatedPoint.y}px`;
    };
    
    map.on("move", updatePositionHandler);
    map.on("zoom", updatePositionHandler);
    
    currentZip = zip;
  };

  const hide = () => {
    if (!titleElement) return;
    
    // Clean up event listeners
    if (updatePositionHandler) {
      map.off("move", updatePositionHandler);
      map.off("zoom", updatePositionHandler);
      updatePositionHandler = null;
    }
    
    titleElement.remove();
    titleElement = null;
    currentZip = null;
  };

  const destroy = () => {
    hide();
  };

  return {
    show,
    hide,
    destroy,
  };
};
