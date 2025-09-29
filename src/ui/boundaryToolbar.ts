import type { BoundaryMode } from "../types/boundaries";
import { createSelect } from "./components/Select";

interface BoundaryToolbarOptions {
  defaultValue: BoundaryMode;
  onChange: (mode: BoundaryMode) => void;
  onToggleZipPin?: (zip: string, nextPinned: boolean) => void;
  onHoverZip?: (zip: string | null) => void;
  onClearSelection?: () => void;
  onExport?: () => void;
  onAddZips?: (zips: string[]) => void;
}

export interface BoundaryToolbarController {
  element: HTMLElement;
  setValue: (mode: BoundaryMode) => void;
  setSelectedZips: (zips: string[], pinned: string[]) => void;
  setHoveredZip: (zip: string | null) => void;
  destroy: () => void;
}

// Mirror line chart palette from statViz for chip coloring in line mode
const LINE_COLORS = ["#375bff", "#8f20f8", "#a76d44", "#b4a360"];
// Utility to shade a color by a factor (0.15 -> lighten a bit)
function shade(hex: string, amount: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return hex;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  const adj = (c: number) => (amount >= 0 ? c + (255 - c) * amount : c + c * amount);
  return (
    "#" +
    clamp(adj(r)).toString(16).padStart(2, "0") +
    clamp(adj(g)).toString(16).padStart(2, "0") +
    clamp(adj(b)).toString(16).padStart(2, "0")
  );
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
  onClearSelection,
  onExport,
  onAddZips,
}: BoundaryToolbarOptions): BoundaryToolbarController => {
  const container = document.createElement("div");
  container.className =
    "sticky top-16 z-10 flex h-10 w-full items-center gap-3 border-b border-slate-200 bg-slate-100/70 px-4 text-sm text-slate-600 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300";

  const label = document.createElement("label");
  label.className = "flex items-center gap-2 font-medium";
  label.textContent = "Areas";
  label.htmlFor = "boundary-select";

  const selectController = createSelect<BoundaryMode>({
    id: "boundary-select",
    value: defaultValue,
    options: OPTION_ORDER.map((value) => ({
      value,
      label: OPTION_LABELS[value],
    })),
    onChange: (v) => {
      currentMode = v;
      const areaLabel = currentMode === "zips" ? "ZIP" : "area";
      setAddButtonAppearance(lastZips.length === 0, areaLabel);
      onChange(v);
    },
  });

  label.appendChild(selectController.element);

  // Left side: chips + add button group
  const chipsWrapper = document.createElement("div");
  chipsWrapper.className = "flex flex-1 items-center gap-2 overflow-x-auto self-center pl-0 pr-1 py-1";
  chipsWrapper.style.clipPath = "inset(-4px -4px -4px -4px)"; // Allow highlights to extend beyond container
  container.appendChild(chipsWrapper);

  // Right side: export button (when present) and Areas selector
  const rightSide = document.createElement("div");
  rightSide.className = "ml-auto flex items-center gap-2";
  container.appendChild(rightSide);

  // Inner container strictly for chips so we don't wipe the add button on rerender
  const chipsContainer = document.createElement("div");
  chipsContainer.className = "flex items-center gap-2";
  // chipsContainer will be appended after addWrapper so + button sits on the far left

  // Inline add-zips UI
  const addWrapper = document.createElement("div");
  addWrapper.className = "flex items-center gap-1";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.title = "Add ZIPs";
  addBtn.setAttribute("aria-label", "Add ZIPs");
  // Class/label are adjusted dynamically depending on whether there are any selections
  const PLUS_SVG = `
    <svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5 translate-x-[0.2px] -translate-y-[0.2px]" aria-hidden="true">
      <path fill-rule=\"evenodd\" d=\"M10 3.5a.75.75 0 01.75.75v5h5a.75.75 0 010 1.5h-5v5a.75.75 0 01-1.5 0v-5h-5a.75.75 0 010-1.5h5v-5A.75.75 0 0110 3.5z\" clip-rule=\"evenodd\" />
    </svg>
  `;
  const setAddButtonAppearance = (descriptive: boolean, areaLabel: string) => {
    if (descriptive) {
      addBtn.className = [
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium",
        "border-slate-300 bg-white/70 text-slate-600 hover:border-brand-300 hover:text-brand-700",
        "dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300",
        "transition-colors",
      ].join(" ");
      addBtn.innerHTML = `${PLUS_SVG}<span class=\"ml-1 whitespace-nowrap\">add ${areaLabel}</span>`;
      addBtn.title = `Add ${areaLabel}`;
      addBtn.setAttribute("aria-label", `Add ${areaLabel}`);
      // Remove left margin when in descriptive mode (no selections) for better alignment
      addWrapper.className = "flex items-center gap-1 -ml-2";
    } else {
      addBtn.className = [
        "inline-flex h-6 w-6 items-center justify-center rounded-full border",
        "border-slate-300 bg-white/70 text-slate-500 hover:border-brand-300 hover:text-brand-700",
        "dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400",
        "transition-colors",
      ].join(" ");
      addBtn.innerHTML = PLUS_SVG;
      addBtn.title = `Add ${areaLabel}`;
      addBtn.setAttribute("aria-label", `Add ${areaLabel}`);
      // Use normal spacing when there are selections
      addWrapper.className = "flex items-center gap-1";
    }
  };

  const inputWrapper = document.createElement("div");
  inputWrapper.className = "hidden"; // hidden by default

  const input = document.createElement("textarea");
  input.rows = 1;
  input.placeholder = "Add ZIPs (comma or space separated)";
  input.className = [
    "h-7 min-h-[1.75rem] resize-none rounded border px-2 py-1 text-xs",
    "border-slate-300 bg-white text-slate-700 shadow-sm",
    "focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200",
    "dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-300 dark:focus:ring-brand-800/50",
    "w-56 md:w-64",
    "mt-1.5 ml-1" // Add margin-top to sit slightly lower in the parent bar
  ].join(" ");
  inputWrapper.appendChild(input);

  addWrapper.appendChild(addBtn);
  // Input should appear immediately to the right of the plus button when opened
  addWrapper.appendChild(inputWrapper);
  // "pin all" quick action follows the input (pushed right when input is visible)
  const pinAllBtn = document.createElement("button");
  pinAllBtn.type = "button";
  pinAllBtn.textContent = "pin all";
  pinAllBtn.className = [
    "text-xs font-medium text-brand-400 hover:text-brand-600/90",
    "decoration-brand-200/70 hover:decoration-brand-400 ml-2",
    "cursor-pointer whitespace-nowrap",
    "hidden", // hidden until there are multiple unpinned selections
  ].join(" ");
  // action: "pin" | "clear"; managed in setSelectedZips
  pinAllBtn.dataset.action = "pin";
  pinAllBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const action = pinAllBtn.dataset.action;
    if (action === "clear") {
      const toUnpin = lastZips.filter((z) => lastPinned.has(z));
      for (const z of toUnpin) {
        onToggleZipPin?.(z, false);
      }
    } else {
      const toPin = lastZips.filter((z) => !lastPinned.has(z));
      for (const z of toPin) {
        onToggleZipPin?.(z, true);
      }
    }
  });
  addWrapper.appendChild(pinAllBtn);

  // Export button lives on the far right, just left of the Areas selector
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  const exportBaseLabel = "export";
  const exportHoverLabel = "export (CSV report)";
  exportBtn.textContent = exportBaseLabel;
  exportBtn.className = [
    "inline-flex items-center rounded px-2 py-1 text-xs font-medium",
    "bg-slate-200/60 text-slate-700 hover:bg-slate-300/60",
    "dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700/60",
    "transition-colors cursor-pointer whitespace-nowrap hidden",
  ].join(" ");
  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    // Delegate to app to compute and trigger CSV download
    onExport?.();
  });
  exportBtn.addEventListener("mouseenter", () => {
    exportBtn.textContent = exportHoverLabel;
  });
  exportBtn.addEventListener("mouseleave", () => {
    exportBtn.textContent = exportBaseLabel;
  });
  // Append to the right side container, before the Areas selector label
  // (label will be appended after this block)
  rightSide.appendChild(exportBtn);

  // "clear selection (esc)" link lives to the right of the pin all link
  const clearSelectionBtn = document.createElement("button");
  clearSelectionBtn.type = "button";
  clearSelectionBtn.textContent = "clear selection (esc)";
  clearSelectionBtn.className = [
    "text-xs font-medium text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300",
    "ml-3 cursor-pointer whitespace-nowrap hidden",
  ].join(" ");
  clearSelectionBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    onClearSelection?.();
  });
  addWrapper.appendChild(clearSelectionBtn);
  // Place chips first so they sit on the far left
  chipsWrapper.appendChild(chipsContainer);
  // Add (+) button group and quick actions to the right of chips
  chipsWrapper.appendChild(addWrapper);

  // Finally, append the Areas selector to the far right container
  rightSide.appendChild(label);

  let inputOpen = false;

  const showInput = () => {
    if (inputOpen) return;
    inputOpen = true;
    inputWrapper.classList.remove("hidden");
    // Slight delay ensures layout is applied before focus
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  };

  const hideInput = () => {
    if (!inputOpen) return;
    inputOpen = false;
    inputWrapper.classList.add("hidden");
    input.value = "";
  };

  const parseZips = (raw: string): string[] => {
    const matches = raw.match(/\b\d{5}\b/g) || [];
    // de-dupe while preserving order of first appearance
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of matches) {
      if (!seen.has(m)) {
        seen.add(m);
        out.push(m);
      }
    }
    return out;
  };

  const submitZips = () => {
    const zips = parseZips(input.value);
    if (zips.length > 0) {
      if (onAddZips) {
        onAddZips(zips);
      } else {
        // Fallback: pin if add-as-transient callback isn't provided
        for (const z of zips) {
          onToggleZipPin?.(z, true);
        }
      }
      // Scroll to end to reveal newly added chips soon after app state updates
      requestAnimationFrame(() => {
        chipsWrapper.scrollLeft = chipsWrapper.scrollWidth;
      });
    }
    hideInput();
  };

  addBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (inputOpen) hideInput();
    else showInput();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitZips();
    } else if (e.key === "Escape") {
      e.preventDefault();
      hideInput();
    }
  });

  const onDocumentPointerDown = (e: Event) => {
    if (!inputOpen) return;
    const target = e.target as Node | null;
    if (!target) return;
    // Close if clicking outside the input wrapper and add button
    if (!inputWrapper.contains(target) && !addBtn.contains(target)) {
      hideInput();
    }
  };
  document.addEventListener("pointerdown", onDocumentPointerDown, true);

  let lastZips: string[] = [];
  let lastPinned = new Set<string>();
  let hoveredZip: string | null = null;
  let currentMode: BoundaryMode = defaultValue;
  const chipByZip = new Map<string, HTMLButtonElement>();

  const renderChips = () => {
    // Simple redraw (small counts)
    chipsContainer.innerHTML = "";
    chipByZip.clear();
    if (lastZips.length === 0) return;
    // Determine if statViz is in line mode based on current selected count
    const inLineMode = lastZips.length > 0 && lastZips.length < 4;
    // Build color mapping by original selection order so it matches statViz
    const colorByZip = new Map<string, string>();
    if (inLineMode) {
      lastZips.forEach((z, i) => colorByZip.set(z, LINE_COLORS[i % LINE_COLORS.length]));
    }
    // Sort pinned zips first (left), then unpinned zips (right)
    const pinned = lastZips.filter(zip => lastPinned.has(zip)).sort();
    const unpinned = lastZips.filter(zip => !lastPinned.has(zip)).sort();
    const sorted = [...pinned, ...unpinned];
    for (const zip of sorted) {
      const pinned = lastPinned.has(zip);
      const chip = document.createElement("button");
      chip.type = "button";
      const baseClasses = [
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors",
      ];
      if (inLineMode) {
        // Dynamic coloring to match line chart series
        chip.className = baseClasses.join(" ");
        const col = colorByZip.get(zip);
        if (col) {
          const isDark = document.documentElement.classList.contains("dark");
          const bg = isDark ? shade(col, -0.82) : shade(col, 0.85);
          const border = isDark ? shade(col, -0.35) : shade(col, 0.55);
          chip.style.backgroundColor = bg;
          chip.style.borderColor = border;
          chip.style.color = col;
        }
      } else {
        // Default brand/neutral appearance, preserving pinned emphasis
        chip.className = [
          ...baseClasses,
          pinned
            ? "border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-400/60 dark:bg-brand-400/10 dark:text-brand-200"
            : "border-slate-300 bg-white/70 text-slate-600 hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300",
        ].join(" ");
      }

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
      chipsContainer.appendChild(chip);
    }
  };

  const setSelectedZips = (zips: string[], pinned: string[]) => {
    lastZips = Array.from(new Set(zips));
    lastPinned = new Set(pinned);
    renderChips();
    // Update add button appearance: show descriptive pill when there are no selections
    const hasAny = lastZips.length > 0;
    const areaLabel = currentMode === "zips" ? "ZIP" : "area";
    setAddButtonAppearance(!hasAny, areaLabel);
    // Decide between "pin all" vs "clear pins"
    const pinnedCount = lastZips.filter((z) => lastPinned.has(z)).length;
    const unpinnedCount = lastZips.length - pinnedCount;
    // Prefer showing "clear pins" when 2+ of the selected are pinned
    if (pinnedCount >= 2) {
      pinAllBtn.textContent = "clear pins";
      pinAllBtn.dataset.action = "clear";
      pinAllBtn.classList.remove("hidden");
    } else if (lastZips.length >= 2 && unpinnedCount > 0) {
      pinAllBtn.textContent = "pin all";
      pinAllBtn.dataset.action = "pin";
      pinAllBtn.classList.remove("hidden");
    } else {
      pinAllBtn.classList.add("hidden");
    }
    // Show clear selection only when there is at least one selected zip
    if (lastZips.length > 0) {
      clearSelectionBtn.classList.remove("hidden");
      exportBtn.classList.remove("hidden");
    } else {
      clearSelectionBtn.classList.add("hidden");
      exportBtn.classList.add("hidden");
    }
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

  // Initialize add button appearance for empty state
  setAddButtonAppearance(true, (currentMode === "zips" ? "ZIP" : "area"));

  return {
    element: container,
    setValue: (v: BoundaryMode) => {
      currentMode = v;
      selectController.setValue(v);
      const areaLabel = currentMode === "zips" ? "ZIP" : "area";
      setAddButtonAppearance(lastZips.length === 0, areaLabel);
    },
    setSelectedZips,
    setHoveredZip,
    destroy: () => {
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      selectController.destroy();
    },
  };
};
