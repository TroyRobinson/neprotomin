import type maplibregl from "maplibre-gl";
import { getZipCentroidsMap } from "../../../lib/zipCentroids";

interface ZipFloatingTitleOptions {
  map: maplibregl.Map;
}

export interface ZipFloatingTitleController {
  show: (zip: string) => void;
  hide: () => void;
  destroy: () => void;
}

export const createZipFloatingTitle = ({ map }: ZipFloatingTitleOptions): ZipFloatingTitleController => {
  let titleElement: HTMLElement | null = null;
  let currentZip: string | null = null;
  let updatePositionHandler: (() => void) | null = null;

  const createTitleElement = () => {
    if (!titleElement) {
      titleElement = document.createElement("div");
      titleElement.className =
        "absolute z-0 pointer-events-none text-slate-500 text-[12px] font-normal dark:text-slate-400";
      titleElement.style.transform = "translate(-50%, -50%)";
      titleElement.style.opacity = "0.7";
      map.getContainer().appendChild(titleElement);
    }
    return titleElement;
  };

  const show = (zip: string) => {
    if (currentZip === zip) return;
    const centroid = getZipCentroidsMap().get(zip);
    if (!centroid) return;
    const [lng, lat] = centroid;
    const element = createTitleElement();
    element.textContent = zip;
    const point = map.project([lng, lat]);
    element.style.left = `${point.x}px`;
    element.style.top = `${point.y}px`;
    if (updatePositionHandler) {
      map.off("move", updatePositionHandler);
      map.off("zoom", updatePositionHandler);
    }
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

  return { show, hide, destroy };
};

