const CATEGORY_CHIP_CLASSES =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-300 shadow-sm backdrop-blur-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400";

const CATEGORY_CHIP_NEUTRAL_CLASSES =
  "border-slate-200 bg-white/40 text-slate-600 hover:border-brand-200 hover:bg-white/80 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white";

const TIME_OPEN_CHIP_CLASSES =
  "border-[#f5c4ae]/60 bg-[#fdd6c3]/20 text-[#7a4030] hover:border-[#e8a990]/80 hover:bg-[#fdd6c3]/40 hover:text-[#6b3525] dark:border-[#7a4030]/40 dark:bg-[#7a4030]/15 dark:text-[#f5c4ae] dark:hover:border-[#e8a990]/60 dark:hover:text-[#fdd6c3]";

const AREAS_CHIP_CLASSES =
  "border-[0.5px] border-white/60 bg-white/18 text-slate-700 ring-1 ring-white/45 hover:border-brand-200/70 hover:bg-white/30 hover:text-brand-700 dark:border-slate-500/35 dark:bg-slate-900/22 dark:text-slate-200 dark:ring-white/8 dark:hover:border-brand-400/50 dark:hover:bg-slate-900/38 dark:hover:text-white";

const ORGS_CHIP_ON_CLASSES =
  "border-[0.5px] border-transparent bg-[#f7e2d6] text-[#7a4030] shadow-floating hover:bg-[#f1d3c3] dark:bg-[#7a4030]/22 dark:text-[#d79c84]";

const ORGS_CHIP_OFF_CLASSES =
  "border-[0.5px] border-white/60 bg-white/18 text-slate-500 ring-1 ring-white/45 hover:border-slate-300/70 hover:bg-white/30 hover:text-slate-600 dark:border-slate-500/35 dark:bg-slate-900/22 dark:text-slate-400 dark:ring-white/8 dark:hover:border-slate-400/55 dark:hover:bg-slate-900/38 dark:hover:text-slate-300";

const SEARCH_ICON = `
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="h-3.5 w-3.5 translate-x-[0.2px] -translate-y-[0.2px] text-brand-600 dark:text-brand-400">
    <path
      fill-rule="evenodd"
      d="M9 3.5a5.5 5.5 0 013.894 9.394l3.703 3.703a.75.75 0 11-1.06 1.06l-3.703-3.703A5.5 5.5 0 119 3.5zm0 1.5a4 4 0 100 8 4 4 0 000-8z"
      clip-rule="evenodd"
    />
  </svg>
`;

const ARROW_ICON = `
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="h-3.5 w-3.5">
    <path
      fill-rule="evenodd"
      d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
      clip-rule="evenodd"
    />
  </svg>
`;

const CHEVRON_DOWN_ICON = `
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="h-3 w-3 transition-transform duration-150">
    <path
      fill-rule="evenodd"
      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
      clip-rule="evenodd"
    />
  </svg>
`;

const CHECK_ICON = `
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="h-3.5 w-3.5">
    <path
      fill-rule="evenodd"
      d="M16.704 5.29a1 1 0 010 1.42l-7.24 7.24a1 1 0 01-1.42 0L3.29 9.196a1 1 0 011.42-1.42l4.044 4.044 6.53-6.53a1 1 0 011.42 0z"
      clip-rule="evenodd"
    />
  </svg>
`;

const CATEGORY_CHIP_SELECTED_CLASSES =
  "border-transparent bg-brand-500 text-white shadow-floating hover:bg-brand-500 dark:bg-brand-900 dark:text-brand-200 dark:hover:bg-brand-800";

// Selected stat chip keeps a neutral fill while preserving brand border emphasis.
const STAT_CHIP_SELECTED_CLASSES =
  "border-[1.5px] border-brand-500 bg-white text-brand-700 font-semibold shadow-floating hover:border-brand-500 hover:bg-white dark:border-brand-400 dark:bg-black dark:text-brand-300 dark:hover:border-brand-300 dark:hover:bg-black dark:!backdrop-blur-none";

const CATEGORY_CHIP_INACTIVE_FEATURED_CLASSES =
  "border-slate-300 bg-slate-200 text-slate-700 shadow-sm hover:bg-slate-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200";

const MOBILE_STAT_CHIP_SELECTED_CLASSES =
  "border-[1.5px] border-brand-500 bg-white text-brand-700 font-semibold shadow-floating hover:border-brand-500 hover:bg-white dark:border-brand-400 dark:bg-black dark:text-brand-300 dark:hover:border-brand-300 dark:hover:bg-black px-3 py-1 text-xs";

const MOBILE_STAT_CHIP_BASE_CLASSES =
  "inline-flex items-center gap-1.5 rounded-full border bg-white/90 text-brand-700 shadow-sm transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400";

const SECONDARY_STAT_CHIP_BASE_CLASSES =
  "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-300 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400";

// Secondary-stat chip styling aligned with the secondary map palette
const SECONDARY_STAT_CHIP_CLASSES =
  "bg-[#e9f5fa] text-[#2b8698] hover:bg-[#f1f9fc] dark:bg-[#2a7685]/22 dark:text-[#7f9ea7]";

const CLOSE_ICON = `
  <svg viewBox="0 0 12 12" aria-hidden="true" class="block h-2.5 w-2.5">
    <path
      fill="currentColor"
      d="M9.53 2.47a.75.75 0 00-1.06-1.06L6 3.94 3.53 1.41A.75.75 0 002.47 2.47L4.94 5 2.47 7.53a.75.75 0 101.06 1.06L6 6.06l2.47 2.53a.75.75 0 001.06-1.06L7.06 5z"
    />
  </svg>
`;

// Animation constants for chip visibility
const CHIP_HIDDEN_STYLES = {
  opacity: "0",
  transform: "translateX(-8px) scale(0.95)",
  pointerEvents: "none" as const,
};

const CHIP_VISIBLE_STYLES = {
  opacity: "1",
  transform: "translateX(0) scale(1)",
  pointerEvents: "auto" as const,
};

const DESKTOP_CHIP_LEFT_OFFSET =
  "var(--map-chips-left-offset, calc(var(--desktop-sidebar-width, 24rem) + 0.25rem))";

import type { Stat } from "../../types/stat";
import { statsStore } from "../../state/stats";
import { categoriesStore, type CategoryRow } from "../../state/categories";
import { formatTimeSelection as formatTimeSelectionLabel, type TimeSelection } from "../lib/timeFilters";

export type AreasChipMode = "auto" | "zips" | "counties" | "none";

export interface CategoryChipsController {
  element: HTMLElement;
  setSelected: (categoryId: string | null) => void;
  setSelectedStat: (statId: string | null) => void;
  setSelectedStatOptions: (options: SelectedStatChipOption[]) => void;
  setSecondaryStat: (statId: string | null) => void;
  setVisibleStatIds: (ids: string[] | null) => void;
  setAreasMode: (mode: AreasChipMode) => void;
  setOrgsVisible: (visible: boolean) => void;
  setTimeSelection: (selection: TimeSelection | null) => void;
  setTimeFilterAvailable: (available: boolean) => void;
  /** Show/hide the sidebar expand button (right-chevron pill) */
  setSidebarExpandVisible: (visible: boolean) => void;
  destroy: () => void;
}

interface CategoryChipsOptions {
  onChange?: (categoryId: string | null) => void;
  onStatChange?: (statId: string | null) => void;
  onSecondaryStatChange?: (statId: string | null) => void;
  isMobile?: boolean;
  onSearch?: (query: string) => void;
  onOrgsChipClose?: () => void;
  onTimeChipClick?: () => void;
  onTimeChipClear?: () => void;
  onAreasModeChange?: (mode: AreasChipMode) => void;
  /** Called when the sidebar expand button is clicked */
  onSidebarExpand?: () => void;
}

export interface SelectedStatChipOption {
  id: string;
  label: string;
}

// Type for chip entry elements with their handlers
interface ChipEntry {
  btn: HTMLButtonElement;
  handleClick?: (event: MouseEvent) => void;
  destroy?: () => void;
  isDropdown?: boolean;
  id: string;
  displayName: string;
  labelEl: HTMLSpanElement;
  closeIcon: HTMLSpanElement | null;
}

// Helper: Apply visibility styles to a chip button
const applyChipVisibility = (button: HTMLButtonElement, visible: boolean) => {
  if (visible) {
    const styles = CHIP_VISIBLE_STYLES;
    button.style.opacity = styles.opacity;
    button.style.transform = styles.transform;
    button.style.pointerEvents = styles.pointerEvents;
    button.style.display = "";
  } else {
    const styles = CHIP_HIDDEN_STYLES;
    button.style.opacity = styles.opacity;
    button.style.transform = styles.transform;
    button.style.pointerEvents = styles.pointerEvents;
    button.style.display = "none";
  }
};

// Helper: Toggle close icon visibility
const toggleCloseIcon = (closeIcon: HTMLSpanElement, show: boolean) => {
  closeIcon.classList.toggle("hidden", !show);
  closeIcon.classList.toggle("flex", show);
  closeIcon.classList.toggle("items-center", show);
};

export const createCategoryChips = (options: CategoryChipsOptions = {}): CategoryChipsController => {
  const isMobile = options.isMobile ?? false;
  const wrapper = document.createElement("div");
  wrapper.className =
    "pointer-events-none absolute left-4 top-4 z-10 flex flex-nowrap items-center gap-2";

  const list = document.createElement("div");
  list.className = "flex flex-wrap items-center gap-2 pointer-events-auto transition-all duration-300";
  wrapper.appendChild(list);

  let searchExpanded = false;
  let searchContainer: HTMLDivElement | null = null;
  let searchButton: HTMLButtonElement | null = null;
  let searchForm: HTMLFormElement | null = null;
  let searchInput: HTMLInputElement | null = null;
  let removeSearchOutsideHandler: (() => void) | null = null;
  let orgsChipVisible = false;
  let timeFilterAvailable = false;
  let visibleStatIds: Set<string> | null = null;

  const isStatVisible = (stat: Stat): boolean => {
    if (visibleStatIds) return visibleStatIds.has(stat.id);
    if (stat.visibility === "inactive") return false;
    if (stat.visibility === "private") return false;
    if (stat.active === false) return false;
    return true;
  };

  // Stats chips appear to the right of the selected category
  const statWrapper = document.createElement("div");
  statWrapper.className = "flex flex-wrap gap-2 items-center pointer-events-auto transition-all duration-300";
  // Note: statWrapper lives inside the same flex row so it aligns immediately
  // to the right of the selected category chip.
  list.appendChild(statWrapper);

  // Orgs chip lives between selected category and stat chips (desktop only)
  // When no category selected, it appears at the end of category chips
  const orgsChipBtn = document.createElement("button");
  orgsChipBtn.type = "button";
  // Match org cluster color: peach accent family when on, subdued neutral when off.
  orgsChipBtn.className = `${CATEGORY_CHIP_CLASSES} ${ORGS_CHIP_ON_CLASSES}`;
  const orgsLabel = document.createElement("span");
  orgsLabel.textContent = "Organizations";
  orgsLabel.className = "whitespace-nowrap";
  const orgsClose = document.createElement("span");
  orgsClose.innerHTML = CLOSE_ICON;
  orgsClose.className = "-mr-1 flex items-center";
  const updateOrgsChipState = () => {
    const isOn = orgsChipVisible;
    orgsChipBtn.className = `${CATEGORY_CHIP_CLASSES} ${isOn ? ORGS_CHIP_ON_CLASSES : ORGS_CHIP_OFF_CLASSES}`;
    orgsLabel.textContent = "Organizations";
    orgsChipBtn.setAttribute("aria-pressed", `${isOn}`);
    orgsChipBtn.title = isOn ? "Hide organizations" : "Show organizations";
    toggleCloseIcon(orgsClose, isOn);
  };
  orgsChipBtn.appendChild(orgsLabel);
  orgsChipBtn.appendChild(orgsClose);
  updateOrgsChipState();
  orgsChipBtn.style.display = "none"; // hidden by default
  orgsChipBtn.addEventListener("click", () => {
    options.onOrgsChipClose?.();
  });
  list.appendChild(orgsChipBtn);

  // Time Open chip - only shows when provider chip is visible
  const timeOpenChipBtn = document.createElement("button");
  timeOpenChipBtn.type = "button";
  timeOpenChipBtn.className = `${CATEGORY_CHIP_CLASSES} ${TIME_OPEN_CHIP_CLASSES}`;
  timeOpenChipBtn.style.display = "none"; // hidden by default
  
  // Create a container for the chip content
  const chipContent = document.createElement("div");
  chipContent.className = "flex items-center";
  
  const timeOpenLabel = document.createElement("span");
  timeOpenLabel.className = "flex items-center gap-1.5 whitespace-nowrap";
  
  // Add time icon
  const timeIcon = document.createElement("span");
  timeIcon.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="h-3 w-3">
      <path
        fill="currentColor"
        fill-rule="evenodd"
        d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm0 18a8 8 0 100-16 8 8 0 000 16zm.5-13a.5.5 0 00-1 0v7a.5.5 0 00.276.447l3.5 2a.5.5 0 10.496-.868L12.5 13.764V7z"
        clip-rule="evenodd"
      />
    </svg>
  `;
  timeIcon.className = isMobile ? "" : "flex items-center";
  
  // Add text label (different text on mobile vs desktop)
  const labelText = document.createElement("span");
  labelText.textContent = isMobile ? "Open Now" : "Hours Open";
  labelText.className = "";
  
  // Assemble the label with icon and text
  timeOpenLabel.appendChild(timeIcon);
  timeOpenLabel.appendChild(labelText);
  
  // Create divider and close icon container
  const closeSection = document.createElement("div");
  closeSection.className = "flex items-center hidden";
  
  const divider = document.createElement("div");
  divider.className = "w-px h-4 bg-slate-300 dark:bg-slate-600 mx-1";
  
  const closeIcon = document.createElement("button");
  closeIcon.type = "button";
  closeIcon.innerHTML = CLOSE_ICON;
  closeIcon.className = "flex items-center justify-center w-4 h-4 hover:bg-slate-200 dark:hover:bg-slate-700 rounded -mr-1";
  closeIcon.setAttribute("aria-label", "Clear time filter");
  
  // Assemble the close section
  closeSection.appendChild(divider);
  closeSection.appendChild(closeIcon);
  
  // Assemble the chip content
  chipContent.appendChild(timeOpenLabel);
  chipContent.appendChild(closeSection);
  
  // Add chip content to the main button
  timeOpenChipBtn.appendChild(chipContent);
  
  // Handle clicks on the time chip
  timeOpenChipBtn.addEventListener("click", (e) => {
    // Check if the click was on the close icon
    if (e.target === closeIcon || closeIcon.contains(e.target as Node)) {
      // Close icon clicked - clear time filter
      e.stopPropagation(); // Prevent the main button click
      options.onTimeChipClear?.();
    } else {
      // Main chip clicked - open time selector
      options.onTimeChipClick?.();
    }
  });
  
  // Also handle close icon clicks directly
  closeIcon.addEventListener("click", (e) => {
    e.stopPropagation(); // Prevent the main button click
    options.onTimeChipClear?.();
  });
  
  list.appendChild(timeOpenChipBtn);

  const AREA_MODE_OPTIONS: Array<{ value: AreasChipMode; label: string }> = [
    { value: "auto", label: "Zoom" },
    { value: "zips", label: "ZIPs" },
    { value: "counties", label: "Counties" },
    { value: "none", label: "None" },
  ];

  const formatAreasModeLabel = (mode: AreasChipMode): string => {
    const match = AREA_MODE_OPTIONS.find((entry) => entry.value === mode);
    return match?.label ?? "Zoom";
  };

  let areasMenuOpen = false;
  let removeAreasOutsideHandler: (() => void) | null = null;
  const areasChipContainer = document.createElement("div");
  const areasChipBtn = document.createElement("button");
  const areasChipLabel = document.createElement("span");
  const areasChipChevron = document.createElement("span");
  const areasChipMenu = document.createElement("div");
  const areasMenuOptions = new Map<AreasChipMode, HTMLButtonElement>();

  // Map chip-level Areas control mirrors the toolbar's mode options.
  areasChipContainer.className = "relative pointer-events-auto";
  areasChipContainer.style.display = isMobile ? "none" : "";
  areasChipBtn.type = "button";
  areasChipBtn.className = `${CATEGORY_CHIP_CLASSES} ${AREAS_CHIP_CLASSES} pr-2`;
  areasChipBtn.setAttribute("aria-haspopup", "listbox");
  areasChipBtn.setAttribute("aria-expanded", "false");
  areasChipBtn.setAttribute("aria-label", "Areas mode");
  areasChipLabel.className = "whitespace-nowrap";
  areasChipChevron.className = "flex items-center text-slate-400 dark:text-slate-500";
  areasChipChevron.innerHTML = CHEVRON_DOWN_ICON;
  areasChipBtn.appendChild(areasChipLabel);
  areasChipBtn.appendChild(areasChipChevron);

  areasChipMenu.className =
    "absolute right-0 top-full z-20 mt-1 hidden min-w-[9rem] rounded-xl border border-slate-200/80 bg-white/90 p-1.5 shadow-lg backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/90";
  areasChipMenu.setAttribute("role", "listbox");
  areasChipMenu.setAttribute("aria-label", "Areas mode");

  AREA_MODE_OPTIONS.forEach((option) => {
    const optionBtn = document.createElement("button");
    optionBtn.type = "button";
    optionBtn.className =
      "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800";
    optionBtn.setAttribute("data-areas-mode", option.value);
    optionBtn.setAttribute("role", "option");
    optionBtn.addEventListener("click", () => {
      setAreasModeInternal(option.value, { emitChange: true, closeMenu: true });
    });
    areasMenuOptions.set(option.value, optionBtn);
    areasChipMenu.appendChild(optionBtn);
  });

  areasChipContainer.appendChild(areasChipBtn);
  areasChipContainer.appendChild(areasChipMenu);
  list.appendChild(areasChipContainer);

  const closeAreasMenu = () => {
    if (!areasMenuOpen) return;
    areasMenuOpen = false;
    areasChipMenu.classList.add("hidden");
    areasChipBtn.setAttribute("aria-expanded", "false");
    areasChipChevron.firstElementChild?.classList.remove("rotate-180");
    if (removeAreasOutsideHandler) {
      removeAreasOutsideHandler();
      removeAreasOutsideHandler = null;
    }
  };

  const openAreasMenu = () => {
    if (areasMenuOpen) return;
    areasMenuOpen = true;
    areasChipMenu.classList.remove("hidden");
    areasChipBtn.setAttribute("aria-expanded", "true");
    areasChipChevron.firstElementChild?.classList.add("rotate-180");
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (target && areasChipContainer.contains(target)) return;
      closeAreasMenu();
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    removeAreasOutsideHandler = () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  };

  const setAreasModeInternal = (
    mode: AreasChipMode,
    config: { emitChange?: boolean; closeMenu?: boolean } = {},
  ) => {
    areasChipLabel.textContent = `Areas: ${formatAreasModeLabel(mode)}`;
    AREA_MODE_OPTIONS.forEach((entry) => {
      const optionBtn = areasMenuOptions.get(entry.value);
      if (!optionBtn) return;
      const isActive = entry.value === mode;
      optionBtn.innerHTML = `<span>${entry.label}</span>${isActive ? `<span class="text-brand-500 dark:text-brand-300">${CHECK_ICON}</span>` : `<span class="h-3.5 w-3.5"></span>`}`;
      optionBtn.setAttribute("aria-selected", isActive ? "true" : "false");
      optionBtn.className = isActive
        ? "flex w-full items-center justify-between rounded-lg bg-brand-50 px-2.5 py-1.5 text-left text-xs text-brand-700 transition dark:bg-brand-400/15 dark:text-brand-300"
        : "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800";
    });
    if (config.closeMenu) closeAreasMenu();
    if (config.emitChange) {
      try {
        options.onAreasModeChange?.(mode);
      } catch {}
    }
  };

  areasChipBtn.addEventListener("click", () => {
    if (areasMenuOpen) closeAreasMenu();
    else openAreasMenu();
  });

  areasChipBtn.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAreasMenu();
      areasChipBtn.blur();
    }
  });

  setAreasModeInternal("auto");

  let selectedId: string | null = null;
  let selectedStatId: string | null = null;
  let selectedStatOptions: SelectedStatChipOption[] = [];
  let secondaryStatId: string | null = null;

  // Secondary stat button will be appended directly to list (no wrapper needed)

  // In-memory stats from store
  let allStats: Stat[] = [];
  let unsubscribeStats: (() => void) | null = null;

  // In-memory categories from store (for map chips)
  let mapCategories: CategoryRow[] = [];
  let unsubscribeCategories: (() => void) | null = null;

  // Category chip entries (mutable, rebuilt when categories change)
  interface CategoryEntry {
    button: HTMLButtonElement;
    closeIcon: HTMLSpanElement;
    handleClick: () => void;
    categoryId: string;
  }
  let entries: CategoryEntry[] = [];

  // Build category chip entries from categories data
  const buildCategoryEntries = (categories: CategoryRow[]): CategoryEntry[] => {
    if (isMobile) return [];
    const result: CategoryEntry[] = [];
    // Process categories in reverse order so they appear in correct order when inserted at beginning
    for (let i = categories.length - 1; i >= 0; i--) {
      const category = categories[i];
      const button = document.createElement("button");
      button.type = "button";
      button.className = `${CATEGORY_CHIP_CLASSES} ${CATEGORY_CHIP_NEUTRAL_CLASSES}`;
      button.setAttribute("data-category", category.slug);
      button.setAttribute("aria-pressed", "false");

      const label = document.createElement("span");
      label.textContent = category.label;
      label.className = "whitespace-nowrap";

      const closeIcon = document.createElement("span");
      closeIcon.innerHTML = CLOSE_ICON;
      closeIcon.className = "-mr-1 hidden";

      button.appendChild(label);
      button.appendChild(closeIcon);

      const handleClick = () => {
        const nextId = selectedId === category.slug ? null : category.slug;
        selectedId = nextId;
        // Reset stat selection when switching category or clearing category
        selectedStatId = null;
        update();
        if (options.onChange) options.onChange(selectedId);
        if (options.onStatChange) options.onStatChange(selectedStatId);
      };

      button.addEventListener("click", handleClick);

      // Insert at the beginning so order is preserved (we're iterating in reverse)
      list.insertBefore(button, list.firstChild);

      result.unshift({ button, closeIcon, handleClick, categoryId: category.slug });
    }
    return result;
  };

  // Rebuild category chips when categories data changes
  const rebuildCategoryChips = (categories: CategoryRow[]) => {
    // Remove old category buttons from DOM
    entries.forEach(({ button, handleClick }) => {
      button.removeEventListener("click", handleClick);
      button.remove();
    });
    // Build new entries
    entries = buildCategoryEntries(categories);
    // Re-run update to apply selection styles
    update();
  };

  const positionTrailingChips = () => {
    if (isMobile) return;
    if (orgsChipBtn.style.display !== "none") {
      if (orgsChipBtn.parentElement !== list) list.appendChild(orgsChipBtn);
      list.appendChild(orgsChipBtn);
    }
    if (timeOpenChipBtn.style.display !== "none") {
      if (timeOpenChipBtn.parentElement !== list) list.appendChild(timeOpenChipBtn);
      list.appendChild(timeOpenChipBtn);
    }
    if (areasChipContainer.style.display !== "none") {
      if (areasChipContainer.parentElement !== list) list.appendChild(areasChipContainer);
      // Keep Areas chip fixed as the right-most trailing control.
      list.appendChild(areasChipContainer);
    }
  };

  const update = () => {
    const selectedStat = selectedStatId ? allStats.find(s => s.id === selectedStatId) : null;
    const selectedStatCategory = selectedStat?.category;

    // Reorder buttons so relevant chips come first
    if (selectedStatId) {
      // Find the category entry for the selected stat
      const statCategoryEntry = entries.find(e => e.categoryId === selectedStatCategory);
      
      if (statCategoryEntry) {
        // If stat's category is featured, put it first
        list.insertBefore(statCategoryEntry.button, list.firstChild);
        // Put stat chip right after its category chip
        if (statWrapper.parentElement !== list) list.appendChild(statWrapper);
        list.insertBefore(statWrapper, statCategoryEntry.button.nextSibling);
        
        // If there's ALSO a selected filter category and it's different, put it BEFORE the stat's category
        if (selectedId && selectedId !== selectedStatCategory) {
          const selectedEntry = entries.find(e => e.categoryId === selectedId);
          if (selectedEntry) {
            list.insertBefore(selectedEntry.button, list.firstChild);
          }
        }
      } else {
        // Stat's category not featured - put stat chip first
        if (statWrapper.parentElement !== list) list.appendChild(statWrapper);
        list.insertBefore(statWrapper, list.firstChild);
        
        // If there's a selected filter category, put it BEFORE the stat chip
        if (selectedId) {
          const selectedEntry = entries.find(e => e.categoryId === selectedId);
          if (selectedEntry) {
            list.insertBefore(selectedEntry.button, list.firstChild);
          }
        }
      }
    } else if (selectedId) {
      // Normal category selection reordering
      const selectedEntry = entries.find(e => e.categoryId === selectedId);
      if (selectedEntry) {
        list.insertBefore(selectedEntry.button, list.firstChild);
        if (statWrapper.parentElement !== list) list.appendChild(statWrapper);
        list.insertBefore(statWrapper, selectedEntry.button.nextSibling);
      }
    }
    
    positionTrailingChips();

    entries.forEach(({ button, closeIcon, categoryId }) => {
      const isSelected = selectedId === categoryId;
      const isStatCategory = selectedStatCategory === categoryId;

      let shouldShow = false;
      if (selectedStatId) {
        // If stat is selected with no active category filter, keep all category options visible.
        if (!selectedId) {
          shouldShow = true;
        } else {
          // With a category filter, keep just the selected category and selected-stat category context.
          shouldShow = isStatCategory || isSelected;
        }
      } else if (selectedId) {
        // If filter is active but no stat, only show the filter category
        shouldShow = isSelected;
      } else {
        // If nothing selected, show all featured categories
        shouldShow = true;
      }

      button.setAttribute("aria-pressed", `${isSelected}`);
      
      if (isSelected) {
        button.className = `${CATEGORY_CHIP_CLASSES} ${CATEGORY_CHIP_SELECTED_CLASSES}`;
      } else if (selectedStatId && isStatCategory) {
        button.className = `${CATEGORY_CHIP_CLASSES} ${CATEGORY_CHIP_INACTIVE_FEATURED_CLASSES}`;
      } else {
        button.className = `${CATEGORY_CHIP_CLASSES} ${CATEGORY_CHIP_NEUTRAL_CLASSES}`;
      }
      
      toggleCloseIcon(closeIcon, isSelected);
      applyChipVisibility(button, shouldShow);
    });

    // Update stats UI region
    renderStatChips();
  };

  const applyAccessoryChipVisibility = () => {
    if (isMobile) {
      // Organizations chip is desktop-only; on mobile we show only the time chip when available.
      orgsChipBtn.style.display = "none";
      const showTime = orgsChipVisible && timeFilterAvailable;
      timeOpenChipBtn.style.display = showTime ? "" : "none";
      areasChipContainer.style.display = "none";
      closeAreasMenu();
      return;
    }
    updateOrgsChipState();
    const showOrganizations = !searchExpanded;
    orgsChipBtn.style.display = showOrganizations ? "" : "none";

    // Desktop UX: keep the map chip row cleaner by hiding the time chip entirely.
    timeOpenChipBtn.style.display = "none";
    const showAreas = !searchExpanded;
    areasChipContainer.style.display = showAreas ? "" : "none";
    if (!showAreas) closeAreasMenu();
    update();
  };

  // Sidebar expand button — shown when sidebar is collapsed (desktop only)
  let sidebarExpandBtn: HTMLButtonElement | null = null;
  if (!isMobile) {
    sidebarExpandBtn = document.createElement("button");
    sidebarExpandBtn.type = "button";
    sidebarExpandBtn.className =
      "pointer-events-auto inline-flex h-8 w-9 items-center justify-center rounded-full border-2 border-slate-300 bg-brand-50 text-slate-600 transition hover:border-slate-400 hover:text-brand-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white";
    sidebarExpandBtn.setAttribute("aria-label", "Expand sidebar");
    sidebarExpandBtn.title = "Expand sidebar";
    // Right-chevron icon
    sidebarExpandBtn.innerHTML = `
      <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" class="h-3.5 w-3.5">
        <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
      </svg>
    `;
    sidebarExpandBtn.style.display = "none"; // hidden by default (sidebar starts collapsed, but caller sets visibility)
    sidebarExpandBtn.addEventListener("click", () => {
      options.onSidebarExpand?.();
    });
    wrapper.insertBefore(sidebarExpandBtn, wrapper.firstChild);
  }

  if (!isMobile) {
    // Desktop-only search control that mimics the compact mobile search UX.
    searchContainer = document.createElement("div");
    searchContainer.className =
      "pointer-events-auto flex items-center gap-2 transition-all duration-300";
    wrapper.insertBefore(searchContainer, list);

    searchButton = document.createElement("button");
    searchButton.type = "button";
    searchButton.className =
      "inline-flex h-8 w-9 items-center justify-center rounded-full border-2 border-slate-300 bg-brand-50 text-slate-600 transition hover:border-slate-400 hover:text-brand-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white";
    searchButton.setAttribute("aria-label", "Open search");
    searchButton.setAttribute("aria-expanded", "false");
    searchButton.innerHTML = SEARCH_ICON;
    searchContainer.appendChild(searchButton);

    searchForm = document.createElement("form");
    searchForm.className =
      "hidden flex min-w-0 items-center gap-2 rounded-full border border-slate-200 bg-white pl-3 pr-2 py-.5 shadow-sm transition focus-within:border-brand-300 focus-within:ring-2 focus-within:ring-brand-200 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-slate-500";
    searchForm.setAttribute("role", "search");
    searchForm.style.minWidth = "240px";
    searchForm.style.maxWidth = "320px";
    searchContainer.appendChild(searchForm);

    const searchIconSpan = document.createElement("span");
    searchIconSpan.innerHTML = SEARCH_ICON;
    searchForm.appendChild(searchIconSpan);

    searchInput = document.createElement("input");
    searchInput.type = "search";
    searchInput.autocomplete = "off";
    searchInput.className =
      "w-full min-w-0 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-500";
    searchInput.placeholder = "City, Location, ZIP, Address, ...";
    searchInput.setAttribute("aria-label", "Search organizations");
    searchForm.appendChild(searchInput);

    const submitButton = document.createElement("button");
    submitButton.type = "submit";
    submitButton.className =
      "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600 transition hover:bg-slate-300 active:bg-slate-400 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600 my-1 ml-[-4px] mr-[-4px]";
    submitButton.setAttribute("aria-label", "Submit search");
    submitButton.innerHTML = ARROW_ICON;
    searchForm.appendChild(submitButton);

    const updateSubmitButtonStyle = () => {
      const hasValue = (searchInput?.value.trim().length ?? 0) > 0;
      if (hasValue) {
        submitButton.className =
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500 text-white transition hover:bg-brand-600 active:bg-brand-700 dark:bg-brand-600 dark:hover:bg-brand-500 my-1 ml-[-4px] mr-[-4px]";
      } else {
        submitButton.className =
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600 transition hover:bg-slate-300 active:bg-slate-400 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600 my-1 ml-[-4px] mr-[-4px]";
      }
    };

    searchInput.addEventListener("input", updateSubmitButtonStyle);

    const teardownOutsideHandler = () => {
      if (removeSearchOutsideHandler) {
        removeSearchOutsideHandler();
        removeSearchOutsideHandler = null;
      }
    };

    const closeSearch = () => {
      if (!searchExpanded) return;
      searchExpanded = false;
      searchButton?.classList.remove("hidden");
      searchButton?.setAttribute("aria-expanded", "false");
      searchForm?.classList.add("hidden");
      if (searchInput) {
        searchInput.value = "";
        updateSubmitButtonStyle();
      }
      teardownOutsideHandler();
      applyAccessoryChipVisibility();
      renderStatChips();
      renderSecondaryStatChip();
      update();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!searchContainer) return;
      const target = event.target as Node | null;
      if (target && searchContainer.contains(target)) return;
      closeSearch();
    };

    const openSearch = () => {
      if (searchExpanded) return;
      searchExpanded = true;
      searchButton?.classList.add("hidden");
      searchButton?.setAttribute("aria-expanded", "true");
      searchForm?.classList.remove("hidden");
      updateSubmitButtonStyle();
      applyAccessoryChipVisibility();
      renderStatChips();
      renderSecondaryStatChip();
      update();
      document.addEventListener("pointerdown", handlePointerDown, true);
      removeSearchOutsideHandler = () => {
        document.removeEventListener("pointerdown", handlePointerDown, true);
      };
      // Focus after layout settles so the input receives focus reliably.
      requestAnimationFrame(() => {
        searchInput?.focus();
        searchInput?.select();
      });
    };

    searchButton.addEventListener("click", () => {
      if (searchExpanded) {
        closeSearch();
      } else {
        openSearch();
      }
    });

    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = searchInput?.value.trim() ?? "";
      if (!query) return;
      options.onSearch?.(query);
    });

    if (searchInput) {
      const searchInputEl = searchInput;
      searchInputEl.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeSearch();
          searchButton?.focus();
        }
      });

      // Select all text when clicking on the input if it already has text
      searchInputEl.addEventListener("click", () => {
        if (searchInputEl.value) {
          // Use setTimeout to ensure the input is focused after the click
          setTimeout(() => {
            if (document.activeElement === searchInputEl && searchInputEl.value) {
              searchInputEl.select();
            }
          }, 0);
        }
      });

      // Also select text when the input receives focus if it already has text
      searchInputEl.addEventListener("focus", () => {
        if (searchInputEl.value) {
          // Use setTimeout to ensure selection happens after focus
          setTimeout(() => {
            if (document.activeElement === searchInputEl && searchInputEl.value) {
              searchInputEl.select();
            }
          }, 0);
        }
      });
    }

  }

  const setSelected = (categoryId: string | null) => {
    selectedId = categoryId;
    // Clear stat selection if no category
    if (!selectedId) selectedStatId = null;
    update();
  };

  const setSelectedStat = (statId: string | null) => {
    selectedStatId = statId;
    // We no longer automatically select the matching category when a stat is selected.
    // This allows stats to be viewed independently of the category filter.
    update();
  };

  const formatStatChipLabel = (name: string): string => {
    if (name.length <= 12) return name;
    const words = name.split(/\s+/).filter(Boolean);
    if (words.length === 0) return name.slice(0, 12);
    const first = words[0];
    const second = words[1];
    if (!second) {
      // No second word; show full first word per spec
      return first;
    }
    const hasMore = second.length > 5 || words.length > 2;
    return `${first} ${second.slice(0, 5)}${hasMore ? " ..." : ""}`;
  };

  const buildStatButton = (stat: Stat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = isMobile
      ? `${MOBILE_STAT_CHIP_BASE_CLASSES} border-slate-200`
      : `${CATEGORY_CHIP_CLASSES} ${CATEGORY_CHIP_NEUTRAL_CLASSES}`;
    btn.setAttribute("data-stat-id", stat.id);
    const displayName = stat.label || stat.name;
    btn.setAttribute("title", displayName);
    const label = document.createElement("span");
    label.textContent = isMobile ? displayName : formatStatChipLabel(displayName);
    label.className = isMobile
      ? "whitespace-nowrap overflow-hidden text-ellipsis"
      : "whitespace-nowrap";

    const closeIcon = document.createElement("span");
    closeIcon.innerHTML = CLOSE_ICON;
    closeIcon.className = isMobile ? "-mr-0.5 hidden" : "-mr-1 hidden";

    btn.appendChild(label);
    btn.appendChild(closeIcon);

    const handleClick = (_event: MouseEvent) => {
      const next = selectedStatId === stat.id ? null : stat.id;
      selectedStatId = next;
      update();
      if (options.onStatChange) options.onStatChange(selectedStatId);
    };
    btn.addEventListener("click", handleClick);
    return { btn, handleClick, labelEl: label, closeIcon };
  };

  let statEntries: ChipEntry[] = [];

  const cleanupStatEntries = () => {
    statEntries.forEach((entry) => {
      if (entry.handleClick) {
        entry.btn.removeEventListener("click", entry.handleClick);
      }
      entry.destroy?.();
    });
    statEntries = [];
  };

  // Normalize externally-provided option rows and keep only map-visible stats.
  const getSelectedStatDropdownOptions = (): SelectedStatChipOption[] => {
    if (!selectedStatId) return [];
    const statById = new Map(allStats.map((stat) => [stat.id, stat]));
    const deduped = new Map<string, SelectedStatChipOption>();
    for (const option of selectedStatOptions) {
      if (!option || typeof option.id !== "string") continue;
      const id = option.id.trim();
      if (!id) continue;
      const stat = statById.get(id);
      if (stat && !isStatVisible(stat)) continue;
      const fallbackLabel = stat ? stat.label || stat.name : id;
      const label =
        typeof option.label === "string" && option.label.trim().length > 0
          ? option.label.trim()
          : fallbackLabel;
      deduped.set(id, { id, label });
    }
    if (!deduped.has(selectedStatId)) {
      const selectedStat = statById.get(selectedStatId);
      if (selectedStat && isStatVisible(selectedStat)) {
        deduped.set(selectedStatId, {
          id: selectedStatId,
          label: selectedStat.label || selectedStat.name,
        });
      }
    }
    return Array.from(deduped.values());
  };

  // Selected stat chip can switch between related stat variants via an inline menu.
  const buildSelectedStatDropdownChip = (
    stat: Stat,
    dropdownOptions: SelectedStatChipOption[],
  ): ChipEntry & { container: HTMLDivElement } => {
    const container = document.createElement("div");
    container.className = "relative";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${CATEGORY_CHIP_CLASSES} ${STAT_CHIP_SELECTED_CLASSES} pr-2`;
    btn.setAttribute("data-stat-id", stat.id);
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "Select stat option");

    const label = document.createElement("span");
    label.textContent = stat.label || stat.name;
    label.className = "whitespace-nowrap";

    const actions = document.createElement("span");
    actions.className = "ml-1 flex items-center gap-1";

    const chevron = document.createElement("span");
    chevron.className = "flex items-center text-brand-500 dark:text-brand-300";
    chevron.innerHTML = CHEVRON_DOWN_ICON;

    const inlineClear = document.createElement("span");
    inlineClear.className =
      "flex h-4 w-4 items-center justify-center rounded-full leading-none text-brand-500/80 transition hover:bg-brand-200/70 hover:text-brand-700 dark:text-brand-300 dark:hover:bg-brand-700/30 dark:hover:text-brand-100";
    inlineClear.innerHTML = CLOSE_ICON;
    inlineClear.querySelector("svg")?.classList.add("translate-y-px");
    inlineClear.setAttribute("aria-hidden", "true");
    inlineClear.title = "Deselect stat";

    actions.appendChild(chevron);
    actions.appendChild(inlineClear);

    btn.appendChild(label);
    btn.appendChild(actions);

    const menu = document.createElement("div");
    menu.className =
      "absolute left-0 top-full z-20 mt-1 hidden min-w-[14rem] rounded-xl border border-slate-200/80 bg-white/95 p-1.5 shadow-lg backdrop-blur-md dark:border-slate-700/80 dark:bg-slate-900/95";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", "Stat options");

    const optionButtons: Array<{
      id: string;
      button: HTMLButtonElement;
      checkSlot: HTMLSpanElement;
      handleClick: () => void;
    }> = [];

    const closeMenu = () => {
      if (menu.classList.contains("hidden")) return;
      menu.classList.add("hidden");
      btn.setAttribute("aria-expanded", "false");
      chevron.firstElementChild?.classList.remove("rotate-180");
      if (removeOutsideHandler) {
        removeOutsideHandler();
        removeOutsideHandler = null;
      }
    };

    const syncMenuState = () => {
      optionButtons.forEach((entry) => {
        const isActive = selectedStatId === entry.id;
        entry.button.className = isActive
          ? "flex w-full items-center justify-between rounded-lg bg-brand-50 px-2.5 py-1.5 text-left text-xs text-brand-700 transition dark:bg-brand-400/15 dark:text-brand-300"
          : "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800";
        entry.button.setAttribute("aria-selected", isActive ? "true" : "false");
        entry.checkSlot.innerHTML = isActive
          ? `<span class="text-brand-500 dark:text-brand-300">${CHECK_ICON}</span>`
          : `<span class="h-3.5 w-3.5"></span>`;
      });
    };

    const commitSelection = (next: string | null) => {
      selectedStatId = next;
      closeMenu();
      update();
      options.onStatChange?.(selectedStatId);
    };

    for (const option of dropdownOptions) {
      const optionBtn = document.createElement("button");
      optionBtn.type = "button";
      optionBtn.setAttribute("role", "option");

      const labelSpan = document.createElement("span");
      labelSpan.textContent = option.label;
      labelSpan.className = "truncate pr-2";

      const checkSlot = document.createElement("span");
      optionBtn.appendChild(labelSpan);
      optionBtn.appendChild(checkSlot);

      const handleOptionClick = () => {
        if (selectedStatId === option.id) {
          closeMenu();
          return;
        }
        commitSelection(option.id);
      };
      optionBtn.addEventListener("click", handleOptionClick);
      optionButtons.push({ id: option.id, button: optionBtn, checkSlot, handleClick: handleOptionClick });
      menu.appendChild(optionBtn);
    }

    const divider = document.createElement("div");
    divider.className = "my-1 h-px bg-slate-200/80 dark:bg-slate-700/80";
    menu.appendChild(divider);

    const deselectBtn = document.createElement("button");
    deselectBtn.type = "button";
    deselectBtn.className =
      "flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs text-slate-600 transition hover:bg-slate-100 hover:text-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100";
    const deselectIcon = document.createElement("span");
    deselectIcon.className = "flex h-3.5 w-3.5 items-center justify-center";
    deselectIcon.innerHTML = CLOSE_ICON;
    const deselectLabel = document.createElement("span");
    deselectLabel.textContent = "Deselect stat";
    deselectBtn.appendChild(deselectIcon);
    deselectBtn.appendChild(deselectLabel);
    const handleDeselectClick = () => {
      commitSelection(null);
    };
    deselectBtn.addEventListener("click", handleDeselectClick);
    menu.appendChild(deselectBtn);

    let removeOutsideHandler: (() => void) | null = null;
    const openMenu = () => {
      if (!menu.classList.contains("hidden")) return;
      syncMenuState();
      menu.classList.remove("hidden");
      btn.setAttribute("aria-expanded", "true");
      chevron.firstElementChild?.classList.add("rotate-180");
      const handlePointerDown = (event: PointerEvent) => {
        const target = event.target as Node | null;
        if (target && container.contains(target)) return;
        closeMenu();
      };
      document.addEventListener("pointerdown", handlePointerDown, true);
      removeOutsideHandler = () => {
        document.removeEventListener("pointerdown", handlePointerDown, true);
      };
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && inlineClear.contains(target)) {
        event.preventDefault();
        event.stopPropagation();
        commitSelection(null);
        return;
      }
      if (menu.classList.contains("hidden")) {
        openMenu();
      } else {
        closeMenu();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        btn.blur();
      }
    };

    btn.addEventListener("click", handleClick);
    btn.addEventListener("keydown", handleKeyDown);

    container.appendChild(btn);
    container.appendChild(menu);
    syncMenuState();

    return {
      container,
      btn,
      handleClick,
      destroy: () => {
        closeMenu();
        btn.removeEventListener("keydown", handleKeyDown);
        optionButtons.forEach((entry) => {
          entry.button.removeEventListener("click", entry.handleClick);
        });
        deselectBtn.removeEventListener("click", handleDeselectClick);
      },
      isDropdown: true,
      id: stat.id,
      displayName: stat.label || stat.name,
      labelEl: label,
      closeIcon: null,
    };
  };

  const applyMobileLabelWidths = () => {
    if (!isMobile) return;
    const viewportWidth = document.documentElement.clientWidth;
    const rightBuffer = 24;
    
    const setMax = (labelEl: HTMLElement) => {
      const btn = labelEl.parentElement as HTMLButtonElement;
      const rect = btn.getBoundingClientRect();
      const styles = getComputedStyle(btn);
      const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
      const available = Math.max(140, viewportWidth - rect.left - rightBuffer - padX);
      labelEl.style.maxWidth = `${available}px`;
    };
    
    statEntries.forEach(({ labelEl }) => setMax(labelEl));
    if (secondaryChipEntry) setMax(secondaryChipEntry.labelEl);
  };

  const renderStatChips = () => {
    // On mobile, we no longer show the active-stat chip at all
    if (isMobile) {
      statWrapper.classList.add("hidden");
      // Clean up any previously-added entries just in case
      cleanupStatEntries();
      statWrapper.replaceChildren();
      return;
    }
    // When search is expanded, keep the stat chip visible if a stat is already selected
    if (searchExpanded && !selectedStatId) {
      statWrapper.classList.add("hidden");
      return;
    }
    // Show stat chips if either:
    // 1. A category is selected (show all stats in that category)
    // 2. A stat is selected (show just that stat, even if no category or non-matching category)
    if (!selectedId && !selectedStatId) {
      statWrapper.classList.add("hidden");
      // Clean up existing
      cleanupStatEntries();
      statWrapper.replaceChildren();
      return;
    }
    statWrapper.classList.remove("hidden");

    // Determine which stats to show:
    // - Desktop: show the selected stat if one exists, otherwise show category stats if a category is selected
    // - Mobile: always show only the selected stat
    // Only show stats that are visible for the current viewer/map surface
    let stats: Stat[] = [];
    if (isMobile) {
      if (selectedStatId) {
        const selectedStat = allStats.find((s) => s.id === selectedStatId && isStatVisible(s));
        stats = selectedStat ? [selectedStat] : [];
      }
    } else if (selectedStatId) {
      const selectedStat = allStats.find((s) => s.id === selectedStatId && isStatVisible(s));
      if (selectedStat) {
        // Always show just the selected stat by itself as a chip
        stats = [selectedStat];
      }
    } else if (selectedId) {
      stats = allStats.filter(
        (s) => s.category === selectedId && isStatVisible(s) && s.featured === true,
      );
    }

    // Rebuild if set changed (simple rebuild for clarity)
    cleanupStatEntries();
    statWrapper.replaceChildren();
    const dropdownOptions = getSelectedStatDropdownOptions();
    statEntries = stats.map((s) => {
      const shouldRenderDropdown =
        !isMobile &&
        selectedStatId === s.id &&
        dropdownOptions.length > 1;
      if (shouldRenderDropdown) {
        const chip = buildSelectedStatDropdownChip(s, dropdownOptions);
        statWrapper.appendChild(chip.container);
        return chip;
      }
      const { btn, handleClick, labelEl, closeIcon } = buildStatButton(s);
      statWrapper.appendChild(btn);
      return { btn, handleClick, id: s.id, displayName: s.label || s.name, labelEl, closeIcon };
    });

    updateStatSelectionStyles();
    applyMobileLabelWidths();
  };

  const updateStatSelectionStyles = () => {
    // On mobile, we suppress the stat chip entirely
    if (isMobile) {
      statWrapper.classList.add("hidden");
      return;
    }
    // When search is expanded, keep the stat chip visible if a stat is already selected
    if (searchExpanded && !selectedStatId) {
      statWrapper.classList.add("hidden");
      return;
    }
    // Don't hide if we have a selected stat (even without a category)
    if (!selectedId && !selectedStatId) {
      statWrapper.classList.add("hidden");
      return;
    }
    // Stat chips maintain their original order - no reordering on selection
    statEntries.forEach(({ btn, id, displayName, labelEl, closeIcon, isDropdown }) => {
      const isSelected = selectedStatId === id;
      if (isDropdown) {
        applyChipVisibility(btn, isSelected);
        return;
      }
      if (isMobile) {
        const base = `${MOBILE_STAT_CHIP_BASE_CLASSES} border-slate-200`;
        btn.className = isSelected
          ? `${MOBILE_STAT_CHIP_BASE_CLASSES} ${MOBILE_STAT_CHIP_SELECTED_CLASSES}`
          : base;
        labelEl.textContent = displayName;
      } else {
        btn.className = `${CATEGORY_CHIP_CLASSES} ${
          isSelected ? STAT_CHIP_SELECTED_CLASSES : CATEGORY_CHIP_NEUTRAL_CLASSES
        }`;
        // Selected stat shows display name (label if available, otherwise name)
        labelEl.textContent = isSelected ? displayName : formatStatChipLabel(displayName);
      }
      // Show close icon only when stat is selected
      if (closeIcon) toggleCloseIcon(closeIcon, isSelected);
      // Hide unselected stats when another stat is selected (desktop) or whenever not selected (mobile)
      const shouldShow = isMobile ? isSelected : !selectedStatId || selectedStatId === id;
      applyChipVisibility(btn, shouldShow);
    });
    applyMobileLabelWidths();
  };

  const buildSecondaryStatChip = (stat: Stat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${SECONDARY_STAT_CHIP_BASE_CLASSES} ${SECONDARY_STAT_CHIP_CLASSES}`;
    btn.setAttribute("data-secondary-stat-id", stat.id);
    const displayName = stat.label || stat.name;
    btn.setAttribute("title", `Secondary: ${displayName}`);

    const label = document.createElement("span");
    label.textContent = displayName;
    label.className = isMobile
      ? "whitespace-nowrap overflow-hidden text-ellipsis"
      : "whitespace-nowrap";

    const closeIcon = document.createElement("span");
    closeIcon.innerHTML = CLOSE_ICON;
    closeIcon.className = "-mr-1 flex items-center";

    btn.appendChild(label);
    btn.appendChild(closeIcon);

    const handleClick = () => {
      secondaryStatId = null;
      renderSecondaryStatChip();
      if (options.onSecondaryStatChange) options.onSecondaryStatChange(null);
    };

    btn.addEventListener("click", handleClick);
    return { btn, labelEl: label, handleClick };
  };

  let secondaryChipEntry: { btn: HTMLButtonElement; labelEl: HTMLElement; handleClick: () => void } | null = null;

  const renderSecondaryStatChip = () => {
    // Clean up existing
    if (secondaryChipEntry) {
      secondaryChipEntry.btn.removeEventListener("click", secondaryChipEntry.handleClick);
      if (secondaryChipEntry.btn.parentElement === list) {
        list.removeChild(secondaryChipEntry.btn);
      }
      secondaryChipEntry = null;
    }

    if (!secondaryStatId || isMobile || searchExpanded) {
      return;
    }

    const stat = allStats.find((s) => s.id === secondaryStatId && isStatVisible(s));
    if (!stat) {
      return;
    }

    const chipData = buildSecondaryStatChip(stat);
    secondaryChipEntry = chipData;
    // Append directly to list so it appears in the same row
    list.appendChild(chipData.btn);
    positionTrailingChips();
  };

  const setSecondaryStat = (statId: string | null) => {
    secondaryStatId = isMobile ? null : statId;
    renderSecondaryStatChip();
  };

  const destroy = () => {
    entries.forEach(({ button, handleClick }) => {
      button.removeEventListener("click", handleClick);
    });
    cleanupStatEntries();
    if (secondaryChipEntry) {
      secondaryChipEntry.btn.removeEventListener("click", secondaryChipEntry.handleClick);
    }
    if (removeSearchOutsideHandler) {
      removeSearchOutsideHandler();
      removeSearchOutsideHandler = null;
    }
    if (removeAreasOutsideHandler) {
      removeAreasOutsideHandler();
      removeAreasOutsideHandler = null;
    }
    if (unsubscribeStats) unsubscribeStats();
    if (unsubscribeCategories) unsubscribeCategories();
    if (isMobile) window.removeEventListener("resize", handleResize);
  };

  update();

  // Subscribe to stats after helpers are defined
  unsubscribeStats = statsStore.subscribe((rows) => {
    allStats = rows;
    update();
    renderSecondaryStatChip();
  });

  // Subscribe to categories store for map chips
  unsubscribeCategories = categoriesStore.subscribe((rows) => {
    const newMapCategories = rows.filter((c) => c.showOnMap);
    // Only rebuild if categories actually changed
    const slugsChanged =
      newMapCategories.length !== mapCategories.length ||
      newMapCategories.some((c, i) => c.slug !== mapCategories[i]?.slug);
    if (slugsChanged) {
      mapCategories = newMapCategories;
      rebuildCategoryChips(mapCategories);
    }
  });

  const handleResize = () => {
    applyMobileLabelWidths();
  };

  const setTimeSelection = (selection: TimeSelection | null) => {
    // Update the label text (keep the icon)
    if (selection) {
      labelText.textContent = formatTimeSelectionLabel(selection);
    } else {
      labelText.textContent = isMobile ? "Open Now" : "Hours Open";
    }
    // Show close section (divider + icon) only when a time is selected
    closeSection.classList.toggle("hidden", !selection);
    closeSection.classList.toggle("flex", !!selection);
  };

  if (isMobile) {
    applyMobileLabelWidths();
    window.addEventListener("resize", handleResize);
  }

  const setVisibleStatIds = (ids: string[] | null) => {
    visibleStatIds = ids ? new Set(ids) : null;
    update();
    renderSecondaryStatChip();
  };

  const setSelectedStatOptions = (nextOptions: SelectedStatChipOption[]) => {
    selectedStatOptions = Array.isArray(nextOptions) ? nextOptions : [];
    update();
  };

  return {
    element: wrapper,
    setSelected,
    setSelectedStat,
    setSelectedStatOptions,
    setSecondaryStat,
    setVisibleStatIds,
    setAreasMode: (mode: AreasChipMode) => {
      setAreasModeInternal(mode);
      positionTrailingChips();
    },
    setOrgsVisible: (visible: boolean) => {
      orgsChipVisible = visible;
      if (isMobile) {
        applyAccessoryChipVisibility();
        return;
      }
      applyAccessoryChipVisibility();
    },
    setTimeFilterAvailable: (available: boolean) => {
      timeFilterAvailable = available;
      applyAccessoryChipVisibility();
    },
    setTimeSelection,
    setSidebarExpandVisible: (visible: boolean) => {
      // Defensive reset: if desktop search UI has been hidden externally, ensure
      // internal expanded state is also cleared so map chips remain visible.
      if (!isMobile && searchExpanded) {
        searchExpanded = false;
        searchButton?.classList.remove("hidden");
        searchButton?.setAttribute("aria-expanded", "false");
        searchForm?.classList.add("hidden");
        if (searchInput) {
          searchInput.value = "";
        }
        if (removeSearchOutsideHandler) {
          removeSearchOutsideHandler();
          removeSearchOutsideHandler = null;
        }
        applyAccessoryChipVisibility();
        renderStatChips();
        renderSecondaryStatChip();
        update();
      }
      // When sidebar is collapsed, the persistent search bar lives at top-left.
      // Keep mobile chips anchored from the right so the time chip doesn't
      // drift or clip, but keep desktop chips near the persistent search bar.
      if (sidebarExpandBtn) {
        sidebarExpandBtn.style.display = "none"; // always hidden; the search bar has the expand button
      }
      if (searchContainer) {
        // Always hide on desktop — the persistent sidebar search bar replaces it
        searchContainer.style.display = "none";
      }
      if (visible) {
        if (isMobile) {
          wrapper.style.left = "auto";
          wrapper.style.right = "1rem";
        } else {
          // Keep chips adjacent to the persistent desktop search bar.
          wrapper.style.left = DESKTOP_CHIP_LEFT_OFFSET;
          wrapper.style.right = "";
        }
      } else {
        wrapper.style.left = "";
        wrapper.style.right = "";
      }
    },
    destroy,
  };
};
