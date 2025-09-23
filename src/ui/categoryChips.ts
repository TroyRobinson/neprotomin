const CATEGORY_CHIP_CLASSES =
  "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all duration-300 shadow-sm backdrop-blur-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-400";

const CATEGORY_CHIP_NEUTRAL_CLASSES =
  "border-slate-200 bg-white/90 text-slate-600 hover:border-brand-200 hover:bg-white hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white";

const CATEGORY_CHIP_SELECTED_CLASSES =
  "border-transparent bg-brand-500 text-white shadow-floating hover:bg-brand-500 dark:bg-brand-400 dark:text-slate-900";

const CLOSE_ICON = `
  <svg viewBox="0 0 12 12" aria-hidden="true" class="h-3.5 w-3.5">
    <path
      fill="currentColor"
      d="M9.53 2.47a.75.75 0 00-1.06-1.06L6 3.94 3.53 1.41A.75.75 0 002.47 2.47L4.94 5 2.47 7.53a.75.75 0 101.06 1.06L6 6.06l2.47 2.53a.75.75 0 001.06-1.06L7.06 5z"
    />
  </svg>
`;

const categories = [
  { id: "health", label: "Health" },
  { id: "education", label: "Education" },
  { id: "justice", label: "Justice" },
  { id: "economy", label: "Economy" },
];

export interface CategoryChipsController {
  element: HTMLElement;
  destroy: () => void;
}

export const createCategoryChips = (): CategoryChipsController => {
  const wrapper = document.createElement("div");
  wrapper.className =
    "pointer-events-none absolute left-4 top-4 z-10 flex flex-wrap gap-2";

  const list = document.createElement("div");
  list.className = "flex flex-wrap gap-2 pointer-events-auto transition-all duration-300";
  wrapper.appendChild(list);

  let selectedId: string | null = null;

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
      selectedId = selectedId === category.id ? null : category.id;
      update();
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
  };

  const destroy = () => {
    entries.forEach(({ button, handleClick }) => {
      button.removeEventListener("click", handleClick);
    });
  };

  update();

  return { element: wrapper, destroy };
};
