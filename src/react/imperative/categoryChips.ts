const CATEGORY_CHIP_CLASSES =
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-300 shadow-sm backdrop-blur-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400";

const CATEGORY_CHIP_NEUTRAL_CLASSES =
  "border-slate-200 bg-white/40 text-slate-600 hover:border-brand-200 hover:bg-white/80 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white";

const CATEGORY_CHIP_SELECTED_CLASSES =
  "border-transparent bg-brand-500 text-white shadow-floating hover:bg-brand-500 dark:bg-brand-400 dark:text-white";

// Slightly fainter fill for selected STAT chip in both modes; white text in dark mode
const STAT_CHIP_SELECTED_CLASSES =
  "border-transparent bg-brand-100 text-brand-700 shadow-floating hover:bg-brand-100 dark:bg-brand-400/20 dark:text-white";

const MOBILE_STAT_CHIP_SELECTED_CLASSES =
  "border-transparent bg-brand-100 text-brand-700 shadow-floating hover:bg-brand-100 dark:bg-brand-400/80 dark:text-white px-3 py-1 text-xs";

const MOBILE_STAT_CHIP_BASE_CLASSES =
  "inline-flex items-center gap-1.5 rounded-full border bg-white/90 text-brand-700 shadow-sm transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400";

// Teal styling for secondary stat chip to match map overlay
const SECONDARY_STAT_CHIP_CLASSES =
  "border-transparent bg-teal-100 text-teal-700 shadow-floating hover:bg-teal-100 dark:bg-teal-400/20 dark:text-teal-200";

const CLOSE_ICON = `
  <svg viewBox="0 0 12 12" aria-hidden="true" class="h-2.5 w-2.5">
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

import { CATEGORIES as categories } from "../../types/categories";
import type { Stat } from "../../types/stat";
import { statsStore } from "../../state/stats";
import { formatTimeSelection as formatTimeSelectionLabel, type TimeSelection } from "../lib/timeFilters";

export interface CategoryChipsController {
  element: HTMLElement;
  setSelected: (categoryId: string | null) => void;
  setSelectedStat: (statId: string | null) => void;
  setSecondaryStat: (statId: string | null) => void;
  setOrgsVisible: (visible: boolean) => void;
  setTimeSelection: (selection: TimeSelection | null) => void;
  destroy: () => void;
}

interface CategoryChipsOptions {
  onChange?: (categoryId: string | null) => void;
  onStatChange?: (statId: string | null) => void;
  onSecondaryStatChange?: (statId: string | null) => void;
  isMobile?: boolean;
  onOrgsChipClose?: () => void;
  onTimeChipClick?: () => void;
  onTimeChipClear?: () => void;
}

// Type for chip entry elements with their handlers
interface ChipEntry {
  btn: HTMLButtonElement;
  handleClick: () => void;
  id: string;
  name: string;
  labelEl: HTMLSpanElement;
  closeIcon: HTMLSpanElement;
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
    "pointer-events-none absolute left-4 top-4 z-10 flex flex-nowrap items-start gap-2";

  const list = document.createElement("div");
  list.className = "flex flex-wrap gap-2 pointer-events-auto transition-all duration-300";
  wrapper.appendChild(list);

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
  // Match org cluster color: #fed7aa (orange-200)
  orgsChipBtn.className = `${CATEGORY_CHIP_CLASSES} border-transparent bg-orange-200 text-orange-900 shadow-floating hover:bg-orange-200 dark:bg-orange-400/30 dark:text-orange-100`;
  const orgsLabel = document.createElement("span");
  orgsLabel.textContent = "Providers";
  orgsLabel.className = "whitespace-nowrap";
  const orgsClose = document.createElement("span");
  orgsClose.innerHTML = CLOSE_ICON;
  orgsClose.className = "-mr-1 flex items-center";
  orgsChipBtn.appendChild(orgsLabel);
  orgsChipBtn.appendChild(orgsClose);
  orgsChipBtn.style.display = "none"; // hidden by default
  orgsChipBtn.addEventListener("click", () => {
    options.onOrgsChipClose?.();
  });
  list.appendChild(orgsChipBtn);

  // Time Open chip - only shows when provider chip is visible
  const timeOpenChipBtn = document.createElement("button");
  timeOpenChipBtn.type = "button";
  timeOpenChipBtn.className = `${CATEGORY_CHIP_CLASSES} ${CATEGORY_CHIP_NEUTRAL_CLASSES}`;
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
  labelText.textContent = isMobile ? "Open" : "Time Open";
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

  let selectedId: string | null = null;
  let selectedStatId: string | null = null;
  let secondaryStatId: string | null = null;

  // Secondary stat button will be appended directly to list (no wrapper needed)

  // In-memory stats from store
  let allStats: Stat[] = [];
  let unsubscribeStats: (() => void) | null = null;

  const entries = isMobile
    ? []
    : categories.map((category) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `${CATEGORY_CHIP_CLASSES} ${CATEGORY_CHIP_NEUTRAL_CLASSES}`;
        button.setAttribute("data-category", category.id);
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
          const nextId = selectedId === category.id ? null : category.id;
          selectedId = nextId;
          // Reset stat selection when switching category or clearing category
          selectedStatId = null;
          update();
          if (options.onChange) options.onChange(selectedId);
          if (options.onStatChange) options.onStatChange(selectedStatId);
        };

        button.addEventListener("click", handleClick);

        list.appendChild(button);

        return { button, closeIcon, handleClick, categoryId: category.id };
      });

  const update = () => {
    // Reorder buttons so selected chip comes first
    if (selectedId) {
      const selectedEntry = entries.find(e => e.categoryId === selectedId);
      if (selectedEntry) {
        list.insertBefore(selectedEntry.button, list.firstChild);
        // Ensure stats wrapper renders immediately after the selected chip
        if (statWrapper.parentElement !== list) list.appendChild(statWrapper);
        // Order: selected category -> stat chips -> orgs chip (always at right end)
        list.insertBefore(statWrapper, selectedEntry.button.nextSibling);
      }
    } else if (selectedStatId) {
      // If stat is selected but no category, move stat wrapper to the beginning
      if (statWrapper.parentElement !== list) list.appendChild(statWrapper);
      list.insertBefore(statWrapper, list.firstChild);
    }
    
    // Always position orgs chip at the right end (after all category and stat chips)
    if (orgsChipBtn.style.display !== "none") {
      if (orgsChipBtn.parentElement !== list) list.appendChild(orgsChipBtn);
      // Always append to the very end to ensure it's rightmost
      list.appendChild(orgsChipBtn);
      // Position time open chip right after orgs chip
      if (timeOpenChipBtn.parentElement !== list) list.appendChild(timeOpenChipBtn);
      list.appendChild(timeOpenChipBtn);
    }

    entries.forEach(({ button, closeIcon, categoryId }) => {
      const isSelected = selectedId === categoryId;
      button.setAttribute("aria-pressed", `${isSelected}`);
      button.className = `${CATEGORY_CHIP_CLASSES} ${
        isSelected ? CATEGORY_CHIP_SELECTED_CLASSES : CATEGORY_CHIP_NEUTRAL_CLASSES
      }`;
      toggleCloseIcon(closeIcon, isSelected);

      // Hide category chips if:
      // 1. A different category is selected, OR
      // 2. A stat is selected but no category is selected
      const shouldHide = (selectedId && selectedId !== categoryId) || (selectedStatId && !selectedId);
      applyChipVisibility(button, !shouldHide);
    });

    // Update stats UI region
    renderStatChips();
  };

  const setSelected = (categoryId: string | null) => {
    selectedId = categoryId;
    // Clear stat selection if no category
    if (!selectedId) selectedStatId = null;
    update();
  };

  const setSelectedStat = (statId: string | null) => {
    selectedStatId = statId;
    // If a stat is being programmatically selected, try to select the matching category
    // if it's an official category. Otherwise, just show the stat without a category.
    if (selectedStatId) {
      const stat = allStats.find((s) => s.id === selectedStatId);
      if (stat && stat.category !== selectedId) {
        // Only set the category if it's one of the official categories
        const isOfficialCategory = categories.some((c) => c.id === stat.category);
        if (isOfficialCategory) {
          selectedId = stat.category;
          update();
          return; // update() will call renderStatChips and apply selection styles
        } else {
          // Non-official category: clear category selection but keep stat selected
          selectedId = null;
          update();
          return;
        }
      }
    }
    updateStatSelectionStyles();
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
    btn.setAttribute("title", stat.name);
    const label = document.createElement("span");
    label.textContent = isMobile ? stat.name : formatStatChipLabel(stat.name);
    label.className = isMobile
      ? "whitespace-nowrap overflow-hidden text-ellipsis"
      : "whitespace-nowrap";

    const closeIcon = document.createElement("span");
    closeIcon.innerHTML = CLOSE_ICON;
    closeIcon.className = isMobile ? "-mr-0.5 hidden" : "-mr-1 hidden";

    btn.appendChild(label);
    btn.appendChild(closeIcon);

    const handleClick = () => {
      const next = selectedStatId === stat.id ? null : stat.id;
      selectedStatId = next;
      updateStatSelectionStyles();
      if (options.onStatChange) options.onStatChange(selectedStatId);
    };
    btn.addEventListener("click", handleClick);
    return { btn, handleClick, labelEl: label, closeIcon };
  };

  let statEntries: ChipEntry[] = [];

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
      statEntries.forEach((e) => e.btn.removeEventListener("click", e.handleClick));
      statWrapper.replaceChildren();
      statEntries = [];
      return;
    }
    // Show stat chips if either:
    // 1. A category is selected (show all stats in that category)
    // 2. A stat is selected (show just that stat, even if no category or non-matching category)
    if (!selectedId && !selectedStatId) {
      statWrapper.classList.add("hidden");
      // Clean up existing
      statEntries.forEach((e) => e.btn.removeEventListener("click", e.handleClick));
      statWrapper.replaceChildren();
      statEntries = [];
      return;
    }
    statWrapper.classList.remove("hidden");

    // Determine which stats to show:
    // - Desktop: show category stats when a category is selected, otherwise show the selected stat
    // - Mobile: always show only the selected stat
    let stats: Stat[] = [];
    if (isMobile) {
      if (selectedStatId) {
        const selectedStat = allStats.find((s) => s.id === selectedStatId);
        stats = selectedStat ? [selectedStat] : [];
      }
    } else if (selectedId) {
      stats = allStats.filter((s) => s.category === selectedId);
    } else if (selectedStatId) {
      const selectedStat = allStats.find((s) => s.id === selectedStatId);
      stats = selectedStat ? [selectedStat] : [];
    }

    // Rebuild if set changed (simple rebuild for clarity)
    statEntries.forEach((e) => e.btn.removeEventListener("click", e.handleClick));
    statWrapper.replaceChildren();
    statEntries = stats.map((s) => {
      const { btn, handleClick, labelEl, closeIcon } = buildStatButton(s);
      statWrapper.appendChild(btn);
      return { btn, handleClick, id: s.id, name: s.name, labelEl, closeIcon };
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
    // Don't hide if we have a selected stat (even without a category)
    if (!selectedId && !selectedStatId) {
      statWrapper.classList.add("hidden");
      return;
    }
    // Stat chips maintain their original order - no reordering on selection
    statEntries.forEach(({ btn, id, name, labelEl, closeIcon }) => {
      const isSelected = selectedStatId === id;
      if (isMobile) {
        const base = `${MOBILE_STAT_CHIP_BASE_CLASSES} border-slate-200`;
        btn.className = isSelected
          ? `${MOBILE_STAT_CHIP_BASE_CLASSES} border-transparent ${MOBILE_STAT_CHIP_SELECTED_CLASSES}`
          : base;
        labelEl.textContent = name;
      } else {
        btn.className = `${CATEGORY_CHIP_CLASSES} ${
          isSelected ? STAT_CHIP_SELECTED_CLASSES : CATEGORY_CHIP_NEUTRAL_CLASSES
        }`;
        // Selected stat shows full name; others truncated
        labelEl.textContent = isSelected ? name : formatStatChipLabel(name);
      }
      // Show close icon only when stat is selected
      toggleCloseIcon(closeIcon, isSelected);
      // Hide unselected stats when another stat is selected (desktop) or whenever not selected (mobile)
      const shouldShow = isMobile ? isSelected : !selectedStatId || selectedStatId === id;
      applyChipVisibility(btn, shouldShow);
    });
    applyMobileLabelWidths();
  };

  const buildSecondaryStatChip = (stat: Stat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${CATEGORY_CHIP_CLASSES} ${SECONDARY_STAT_CHIP_CLASSES}`;
    btn.setAttribute("data-secondary-stat-id", stat.id);
    btn.setAttribute("title", `Secondary: ${stat.name}`);

    const label = document.createElement("span");
    label.textContent = stat.name;
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

    if (!secondaryStatId || isMobile) {
      return;
    }

    const stat = allStats.find((s) => s.id === secondaryStatId);
    if (!stat) {
      return;
    }

    const chipData = buildSecondaryStatChip(stat);
    secondaryChipEntry = chipData;
    // Append directly to list so it appears in the same row
    list.appendChild(chipData.btn);
  };

  const setSecondaryStat = (statId: string | null) => {
    secondaryStatId = isMobile ? null : statId;
    renderSecondaryStatChip();
  };

  const destroy = () => {
    entries.forEach(({ button, handleClick }) => {
      button.removeEventListener("click", handleClick);
    });
    statEntries.forEach(({ btn, handleClick }) => btn.removeEventListener("click", handleClick));
    if (secondaryChipEntry) {
      secondaryChipEntry.btn.removeEventListener("click", secondaryChipEntry.handleClick);
    }
    if (unsubscribeStats) unsubscribeStats();
    if (isMobile) window.removeEventListener("resize", handleResize);
  };

  update();

  // Subscribe to stats after helpers are defined
  unsubscribeStats = statsStore.subscribe((rows) => {
    allStats = rows;
    renderStatChips();
    renderSecondaryStatChip();
  });

  const handleResize = () => {
    applyMobileLabelWidths();
  };

  const setTimeSelection = (selection: TimeSelection | null) => {
    // Update the label text (keep the icon)
    if (selection) {
      labelText.textContent = formatTimeSelectionLabel(selection);
    } else {
      labelText.textContent = isMobile ? "Open" : "Time Open";
    }
    // Show close section (divider + icon) only when a time is selected
    closeSection.classList.toggle("hidden", !selection);
    closeSection.classList.toggle("flex", !!selection);
  };

  if (isMobile) {
    applyMobileLabelWidths();
    window.addEventListener("resize", handleResize);
  }

  return {
    element: wrapper,
    setSelected,
    setSelectedStat,
    setSecondaryStat,
    setOrgsVisible: (visible: boolean) => {
      if (isMobile) {
        orgsChipBtn.style.display = "none";
        timeOpenChipBtn.style.display = visible ? "" : "none";
        return;
      }
      orgsChipBtn.style.display = visible ? "" : "none";
      timeOpenChipBtn.style.display = visible ? "" : "none";
      // Re-run ordering so it stays between category and stats
      update();
    },
    setTimeSelection,
    destroy,
  };
};
