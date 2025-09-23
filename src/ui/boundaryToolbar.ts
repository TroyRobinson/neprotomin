import type { BoundaryMode } from "../types/boundaries";
import { createSelect } from "./components/Select";

interface BoundaryToolbarOptions {
  defaultValue: BoundaryMode;
  onChange: (mode: BoundaryMode) => void;
  onToggleZipPin?: (zip: string, nextPinned: boolean) => void;
  onHoverZip?: (zip: string | null) => void;
}

export interface BoundaryToolbarController {
  element: HTMLElement;
  setValue: (mode: BoundaryMode) => void;
  setSelectedZips: (zips: string[], pinned: string[]) => void;
  setHoveredZip: (zip: string | null) => void;
  destroy: () => void;
}

const OPTION_LABELS: Record<BoundaryMode, string> = {
  none: "None",
  zips: "ZIPs",
};

const OPTION_ORDER: BoundaryMode[] = ["zips", "none"];

export const createBoundaryToolbar = ({
  defaultValue,
  onChange,
  onToggleZipPin,
  onHoverZip,
}: BoundaryToolbarOptions): BoundaryToolbarController => {
  const container = document.createElement("div");
  container.className =
    "sticky top-16 z-10 flex h-10 w-full items-center gap-3 border-b border-slate-200 bg-slate-100/70 px-4 text-sm text-slate-600 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300";

  const label = document.createElement("label");
  label.className = "flex items-center gap-2 font-medium";
  label.textContent = "Boundaries";
  label.htmlFor = "boundary-select";

  const selectController = createSelect<BoundaryMode>({
    id: "boundary-select",
    value: defaultValue,
    options: OPTION_ORDER.map((value) => ({
      value,
      label: OPTION_LABELS[value],
    })),
    onChange,
  });

  label.appendChild(selectController.element);
  container.appendChild(label);

  // Selected ZIP chips to the right of the select
  const chipsWrapper = document.createElement("div");
  // Allow ring highlight to extend outside on all axes - use padding to create space for highlight rings
  chipsWrapper.className = "flex items-center gap-2 overflow-x-auto self-center px-1 py-1";
  chipsWrapper.style.clipPath = "inset(-4px -4px -4px -4px)"; // Allow highlights to extend beyond container
  container.appendChild(chipsWrapper);

  let lastZips: string[] = [];
  let lastPinned = new Set<string>();
  let hoveredZip: string | null = null;
  const chipByZip = new Map<string, HTMLButtonElement>();

  const renderChips = () => {
    // Simple redraw (small counts)
    chipsWrapper.innerHTML = "";
    chipByZip.clear();
    if (lastZips.length === 0) return;
    const sorted = [...lastZips].sort();
    for (const zip of sorted) {
      const pinned = lastPinned.has(zip);
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = [
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
        pinned
          ? "border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-400/60 dark:bg-brand-400/10 dark:text-brand-200"
          : "border-slate-300 bg-white/70 text-slate-600 hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300",
      ].join(" ");

      const labelSpan = document.createElement("span");
      labelSpan.textContent = zip;
      chip.appendChild(labelSpan);

      const icon = document.createElement("span");
      icon.textContent = pinned ? "×" : "+";
      icon.className = "ml-0.5 hidden text-brand-600 group-hover:inline";
      chip.appendChild(icon);

      chip.classList.add("group");

      chip.addEventListener("mouseenter", () => {
        icon.classList.remove("hidden");
        onHoverZip?.(zip);
      });
      chip.addEventListener("mouseleave", () => {
        icon.classList.add("hidden");
        onHoverZip?.(null);
      });

      chip.addEventListener("click", () => {
        onToggleZipPin?.(zip, !pinned);
      });

      // Visual highlight when hovered via map
      if (hoveredZip === zip) {
        chip.classList.add("ring-1", "ring-brand-300");
      }

      chipByZip.set(zip, chip);
      chipsWrapper.appendChild(chip);
    }
  };

  const setSelectedZips = (zips: string[], pinned: string[]) => {
    lastZips = Array.from(new Set(zips));
    lastPinned = new Set(pinned);
    renderChips();
  };

  const setHoveredZip = (zip: string | null) => {
    hoveredZip = zip;
    for (const [z, el] of chipByZip) {
      if (z === zip) {
        el.classList.add("ring-1", "ring-brand-300");
      } else {
        el.classList.remove("ring-1", "ring-brand-300");
      }
    }
  };

  return {
    element: container,
    setValue: selectController.setValue,
    setSelectedZips,
    setHoveredZip,
    destroy: selectController.destroy,
  };
};
