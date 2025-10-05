const CATEGORY_CHIP_CLASSES =
  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-300 shadow-sm backdrop-blur-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400";

const CATEGORY_CHIP_NEUTRAL_CLASSES =
  "border-slate-200 bg-white/90 text-slate-600 hover:border-brand-200 hover:bg-white hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white";

const CATEGORY_CHIP_SELECTED_CLASSES =
  "border-transparent bg-brand-500 text-white shadow-floating hover:bg-brand-500 dark:bg-brand-400 dark:text-white";

// Slightly fainter fill for selected STAT chip in both modes; white text in dark mode
const STAT_CHIP_SELECTED_CLASSES =
  "border-transparent bg-brand-100 text-brand-700 shadow-floating hover:bg-brand-100 dark:bg-brand-400/20 dark:text-white";

const CLOSE_ICON = `
  <svg viewBox="0 0 12 12" aria-hidden="true" class="h-3.5 w-3.5">
    <path
      fill="currentColor"
      d="M9.53 2.47a.75.75 0 00-1.06-1.06L6 3.94 3.53 1.41A.75.75 0 002.47 2.47L4.94 5 2.47 7.53a.75.75 0 101.06 1.06L6 6.06l2.47 2.53a.75.75 0 001.06-1.06L7.06 5z"
    />
  </svg>
`;

import { CATEGORIES as categories } from "../../types/categories";
import type { Stat } from "../../types/stat";
import { statsStore } from "../../state/stats";

export interface CategoryChipsController {
  element: HTMLElement;
  setSelected: (categoryId: string | null) => void;
  setSelectedStat: (statId: string | null) => void;
  destroy: () => void;
}

interface CategoryChipsOptions {
  onChange?: (categoryId: string | null) => void;
  onStatChange?: (statId: string | null) => void;
}

export const createCategoryChips = (options: CategoryChipsOptions = {}): CategoryChipsController => {
  const wrapper = document.createElement("div");
  wrapper.className =
    "pointer-events-none absolute left-4 top-4 z-10 flex flex-nowrap items-start gap-2";

  const list = document.createElement("div");
  list.className = "flex flex-wrap gap-2 pointer-events-auto transition-all duration-300";
  wrapper.appendChild(list);

  // Stats chips appear to the right of the selected category
  const statWrapper = document.createElement("div");
  statWrapper.className = "flex flex-wrap gap-2 items-center pointer-events-auto transition-all duration-300 ml-2 pl-2 border-l border-slate-200 dark:border-slate-700";
  // Note: statWrapper lives inside the same flex row so it aligns immediately
  // to the right of the selected category chip.
  list.appendChild(statWrapper);

  let selectedId: string | null = null;
  let selectedStatId: string | null = null;

  // In-memory stats from store
  let allStats: Stat[] = [];
  let unsubscribeStats: (() => void) | null = null;

  const entries = categories.map((category) => {
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
        list.insertBefore(statWrapper, selectedEntry.button.nextSibling);
      }
    }

    entries.forEach(({ button, closeIcon, categoryId }) => {
      const isSelected = selectedId === categoryId;
      button.setAttribute("aria-pressed", `${isSelected}`);
      button.className = `${CATEGORY_CHIP_CLASSES} ${
        isSelected ? CATEGORY_CHIP_SELECTED_CLASSES : CATEGORY_CHIP_NEUTRAL_CLASSES
      }`;
      closeIcon.classList.toggle("hidden", !isSelected);
      closeIcon.classList.toggle("flex", isSelected);
      closeIcon.classList.toggle("items-center", isSelected);

      if (selectedId && selectedId !== categoryId) {
        button.style.opacity = "0";
        button.style.transform = "translateX(-8px) scale(0.95)";
        button.style.pointerEvents = "none";
      } else {
        button.style.opacity = "1";
        button.style.transform = "translateX(0) scale(1)";
        button.style.pointerEvents = "auto";
      }
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
    // If a stat is being programmatically selected, ensure the matching category
    // is also active so the stat chip is visible in the UI.
    if (selectedStatId) {
      const stat = allStats.find((s) => s.id === selectedStatId);
      if (stat && stat.category !== selectedId) {
        selectedId = stat.category;
        update();
        return; // update() will call renderStatChips and apply selection styles
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
    btn.className = `${CATEGORY_CHIP_CLASSES} ${CATEGORY_CHIP_NEUTRAL_CLASSES}`;
    btn.setAttribute("data-stat-id", stat.id);
    btn.setAttribute("title", stat.name);
    const label = document.createElement("span");
    label.textContent = formatStatChipLabel(stat.name);
    label.className = "whitespace-nowrap";
    btn.appendChild(label);
    const handleClick = () => {
      const next = selectedStatId === stat.id ? null : stat.id;
      selectedStatId = next;
      updateStatSelectionStyles();
      if (options.onStatChange) options.onStatChange(selectedStatId);
    };
    btn.addEventListener("click", handleClick);
    return { btn, handleClick, labelEl: label };
  };

  let statEntries: { btn: HTMLButtonElement; handleClick: () => void; id: string; name: string; labelEl: HTMLSpanElement }[] = [];

  const renderStatChips = () => {
    // Show only when a category is selected
    if (!selectedId) {
      statWrapper.classList.add("hidden");
      // Clean up existing
      statEntries.forEach((e) => e.btn.removeEventListener("click", e.handleClick));
      statWrapper.replaceChildren();
      statEntries = [];
      return;
    }
    statWrapper.classList.remove("hidden");

    const stats = allStats.filter((s) => s.category === selectedId);

    // Rebuild if set changed (simple rebuild for clarity)
    statEntries.forEach((e) => e.btn.removeEventListener("click", e.handleClick));
    statWrapper.replaceChildren();
    statEntries = stats.map((s) => {
      const { btn, handleClick, labelEl } = buildStatButton(s);
      statWrapper.appendChild(btn);
      return { btn, handleClick, id: s.id, name: s.name, labelEl };
    });

    updateStatSelectionStyles();
  };

  const updateStatSelectionStyles = () => {
    if (!selectedId) {
      statWrapper.classList.add("hidden");
      return;
    }
    // If a stat is selected, move it to the start so it "floats left"
    if (selectedStatId) {
      const selectedEntry = statEntries.find((e) => e.id === selectedStatId);
      if (selectedEntry) {
        statWrapper.insertBefore(selectedEntry.btn, statWrapper.firstChild);
      }
    }
    statEntries.forEach(({ btn, id, name, labelEl }) => {
      const isSelected = selectedStatId === id;
      btn.className = `${CATEGORY_CHIP_CLASSES} ${
        isSelected ? STAT_CHIP_SELECTED_CLASSES : CATEGORY_CHIP_NEUTRAL_CLASSES
      }`;
      // Selected stat shows full name; others truncated
      labelEl.textContent = isSelected ? name : formatStatChipLabel(name);
      if (selectedStatId && selectedStatId !== id) {
        btn.style.opacity = "0";
        btn.style.transform = "translateX(-8px) scale(0.95)";
        btn.style.pointerEvents = "none";
      } else {
        btn.style.opacity = "1";
        btn.style.transform = "translateX(0) scale(1)";
        btn.style.pointerEvents = "auto";
      }
    });
  };

  const destroy = () => {
    entries.forEach(({ button, handleClick }) => {
      button.removeEventListener("click", handleClick);
    });
    statEntries.forEach(({ btn, handleClick }) => btn.removeEventListener("click", handleClick));
    if (unsubscribeStats) unsubscribeStats();
  };

  update();

  // Subscribe to stats after helpers are defined
  unsubscribeStats = statsStore.subscribe((rows) => {
    allStats = rows;
    renderStatChips();
  });

  return { element: wrapper, setSelected, setSelectedStat, destroy };
};


