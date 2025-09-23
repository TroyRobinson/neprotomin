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

  // Inner container strictly for chips so we don't wipe the add button on rerender
  const chipsContainer = document.createElement("div");
  chipsContainer.className = "flex items-center gap-2";
  chipsWrapper.appendChild(chipsContainer);

  // Inline add-zips UI
  const addWrapper = document.createElement("div");
  addWrapper.className = "flex items-center gap-1";

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.title = "Add ZIPs";
  addBtn.setAttribute("aria-label", "Add ZIPs");
  addBtn.className = [
    "inline-flex h-6 w-6 items-center justify-center rounded-full border",
    "border-slate-300 bg-white/70 text-slate-500 hover:border-brand-300 hover:text-brand-700",
    "dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400",
    "transition-colors",
  ].join(" ");
  addBtn.innerHTML = `
    <svg viewBox="0 0 20 20" fill="currentColor" class="h-3.5 w-3.5 translate-x-[0.2px] -translate-y-[0.2px]" aria-hidden="true">
      <path fill-rule="evenodd" d="M10 3.5a.75.75 0 01.75.75v5h5a.75.75 0 010 1.5h-5v5a.75.75 0 01-1.5 0v-5h-5a.75.75 0 010-1.5h5v-5A.75.75 0 0110 3.5z" clip-rule="evenodd" />
    </svg>
  `;

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
  addWrapper.appendChild(inputWrapper);
  chipsWrapper.appendChild(addWrapper);

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
      for (const z of zips) {
        onToggleZipPin?.(z, true);
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
  const chipByZip = new Map<string, HTMLButtonElement>();

  const renderChips = () => {
    // Simple redraw (small counts)
    chipsContainer.innerHTML = "";
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
      chipsContainer.appendChild(chip);
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
    destroy: () => {
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      selectController.destroy();
    },
  };
};
