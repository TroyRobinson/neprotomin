import { themeController } from "./theme";

type ThemeName = "light" | "dark";

const getThemeIcon = (theme: ThemeName): string => {
  if (theme === "dark") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" class="h-5 w-5">
        <path
          fill="currentColor"
          d="M21 12.79A9 9 0 0111.21 3a7 7 0 1010 9.79 1 1 0 010 .02 9 9 0 01-.21 0z"
        />
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" class="h-5 w-5">
      <path
        fill="currentColor"
        d="M12 18a1 1 0 011 1v1.5a1 1 0 11-2 0V19a1 1 0 011-1zm0-13a1 1 0 011-1V2.5a1 1 0 11-2 0V4a1 1 0 011 1zm6.364 12.95l1.061 1.061a1 1 0 01-1.414 1.414l-1.06-1.06a1 1 0 011.413-1.415zM5.05 5.636L3.99 4.575A1 1 0 115.403 3.16l1.06 1.06A1 1 0 115.05 5.636zM22 13a1 1 0 100-2h-1.5a1 1 0 100 2H22zM4 13a1 1 0 100-2H2.5a1 1 0 100 2H4zm15.314-7.95l1.061-1.061a1 1 0 10-1.414-1.414l-1.06 1.06a1 1 0 101.413 1.415zM6.474 19.364l-1.06 1.06a1 1 0 11-1.415-1.413l1.061-1.061a1 1 0 111.414 1.414zM12 8a4 4 0 100 8 4 4 0 000-8z"
      />
    </svg>
  `;
};

export interface TopBarController {
  element: HTMLElement;
  destroy: () => void;
}

const NAV_LINK_CLASSES =
  "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-150 text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white";

export const createTopBar = (): TopBarController => {
  const header = document.createElement("header");
  header.className =
    "sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur-lg dark:border-slate-800 dark:bg-slate-900/80";

  const identity = document.createElement("div");
  identity.className = "flex items-center gap-6";

  const brandLink = document.createElement("a");
  brandLink.href = "#";
  brandLink.className = "flex items-center gap-3 text-sm font-medium text-slate-500 dark:text-slate-400";
  brandLink.innerHTML = `
    <span class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 font-display text-lg font-semibold tracking-tight text-white shadow-floating">
      NE
    </span>
    <span class="hidden text-sm font-semibold md:inline text-slate-700 dark:text-slate-200">
      Neighborhood Explorer
    </span>
  `;

  const nav = document.createElement("nav");
  nav.className = "flex items-center gap-3";

  const mapLink = document.createElement("a");
  mapLink.href = "#";
  mapLink.setAttribute("aria-current", "page");
  mapLink.className = `${NAV_LINK_CLASSES} bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-white`;
  mapLink.textContent = "Map";

  nav.appendChild(mapLink);

  identity.appendChild(brandLink);
  identity.appendChild(nav);

  const controls = document.createElement("div");
  controls.className = "flex items-center gap-4";

  const themeButton = document.createElement("button");
  themeButton.type = "button";
  themeButton.className =
    "inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-brand-200 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white";
  themeButton.setAttribute("aria-pressed", "false");

  const updateThemeButton = (theme: ThemeName) => {
    themeButton.innerHTML = getThemeIcon(theme);
    themeButton.setAttribute(
      "aria-label",
      theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
    );
    themeButton.setAttribute("data-theme", theme);
  };

  const unsubscribeTheme = themeController.subscribe((current) => {
    updateThemeButton(current);
    themeButton.setAttribute("aria-pressed", `${current === "dark"}`);
  });

  const handleClick = () => {
    themeController.toggle();
  };

  themeButton.addEventListener("click", handleClick);

  controls.appendChild(themeButton);

  header.appendChild(identity);
  header.appendChild(controls);

  return {
    element: header,
    destroy: () => {
      unsubscribeTheme();
      themeButton.removeEventListener("click", handleClick);
    },
  };
};
