import { themeController } from "./theme";
import { createLoginModal } from "./loginModal";
import { db } from "../lib/db";

type ThemeName = "light" | "dark";

const getThemeIcon = (theme: ThemeName): string => {
  if (theme === "dark") {
    return `
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        class="h-5 w-5 translate-x-[-2px] translate-y-[2px]"
      >
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
  setActiveScreen: (screen: "map" | "report") => void;
  onSignedIn: (fn: (email: string) => void) => void;
  destroy: () => void;
}

const NAV_LINK_CLASSES =
  "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors duration-150 text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white";

export const createTopBar = (opts?: { onNavigate?: (screen: "map" | "report") => void; onBrandClick?: () => void }): TopBarController => {
  const header = document.createElement("header");
  header.className =
    "sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur-lg dark:border-slate-800 dark:bg-slate-900/80";

  const identity = document.createElement("div");
  identity.className = "flex items-center gap-4";

  const brandLink = document.createElement("a");
  brandLink.href = "#";
  brandLink.className = "flex items-center gap-3 text-sm font-medium text-slate-500 dark:text-slate-400 -ml-2";
  brandLink.innerHTML = `
    <span class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 font-display text-lg font-semibold tracking-wider text-white shadow-floating">
      NE
    </span>
  `;

  // Clicking the brand should reset map state (handled by app via onBrandClick)
  brandLink.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts?.onBrandClick?.();
  });

  const nav = document.createElement("nav");
  nav.className = "flex items-center gap-3";

  const mapLink = document.createElement("a");
  mapLink.href = "#";
  mapLink.setAttribute("aria-current", "page");
  mapLink.className = `${NAV_LINK_CLASSES} bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-white`;
  mapLink.textContent = "Map";

  const reportLink = document.createElement("a");
  reportLink.href = "#report";
  reportLink.className = NAV_LINK_CLASSES;
  reportLink.textContent = "Report";

  nav.appendChild(mapLink);
  nav.appendChild(reportLink);

  identity.appendChild(brandLink);
  identity.appendChild(nav);

  const controls = document.createElement("div");
  controls.className = "flex items-center gap-4";

  // Login group (email button + hover-only logout button)
  const loginGroup = document.createElement("div");
  loginGroup.className = "group inline-flex items-center";

  // Login button (to the left of the theme toggle)
  const loginButton = document.createElement("button");
  loginButton.type = "button";
  loginButton.className =
    "inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-brand-200 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white";
  loginButton.textContent = "Login";

  const logoutButton = document.createElement("button");
  logoutButton.type = "button";
  logoutButton.setAttribute("aria-label", "Sign out");
  logoutButton.title = "Sign out";
  logoutButton.className =
    "ml-1 inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-red-500/50 dark:text-slate-400";
  logoutButton.innerHTML = `
    <svg viewBox="0 0 20 20" aria-hidden="true" class="h-4 w-4">
      <path fill="currentColor" d="M11.28 4.22a.75.75 0 10-1.06 1.06L12.94 8H7a.75.75 0 000 1.5h5.94l-2.72 2.72a.75.75 0 101.06 1.06l4-4a.75.75 0 000-1.06l-4-4z"/>
      <path fill="currentColor" d="M4.5 3A1.5 1.5 0 003 4.5v11A1.5 1.5 0 004.5 17h4a.75.75 0 000-1.5h-4a.5.5 0 01-.5-.5v-11a.5.5 0 01.5-.5h4A.75.75 0 008.5 3h-4z"/>
    </svg>`;

  let isSignedIn = false;

  const renderSignedOut = () => {
    isSignedIn = false;
    loginButton.innerHTML = "Login";
    loginButton.setAttribute("aria-label", "Login");
    logoutButton.style.display = "none";
  };

  const renderSignedIn = (email: string) => {
    isSignedIn = true;
    // Clear and rebuild button content: [email]
    loginButton.innerHTML = "";
    const labelSpan = document.createElement("span");
    labelSpan.textContent = email;
    labelSpan.className = "truncate max-w-[14ch]";
    loginButton.appendChild(labelSpan);
    loginButton.setAttribute("aria-label", `Signed in as ${email}`);
    logoutButton.style.display = "inline-flex";
  };

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

  let signedInListeners: ((email: string) => void)[] = [];
  const loginModal = createLoginModal({
    onSignedIn: ({ email }) => {
      renderSignedIn(email);
      for (const fn of signedInListeners) fn(email);
    },
  });

  const onLoginButtonClick = () => {
    if (!isSignedIn) loginModal.open();
  };
  const onLogoutButtonClick = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      console.debug("[topbar] signOut click");
      await db.auth.signOut();
      console.debug("[topbar] signOut done");
    } catch (err) {
      console.debug("[topbar] signOut error", err);
    }
    renderSignedOut();
  };
  loginButton.addEventListener("click", onLoginButtonClick);
  logoutButton.addEventListener("click", onLogoutButtonClick);

  // Build login group
  loginGroup.appendChild(loginButton);
  loginGroup.appendChild(logoutButton);
  // Hidden by default until signed in
  logoutButton.style.display = "none";

  controls.appendChild(loginGroup);
  controls.appendChild(themeButton);

  header.appendChild(identity);
  header.appendChild(controls);

  const setActiveScreen = (screen: "map" | "report") => {
    if (screen === "map") {
      mapLink.className = `${NAV_LINK_CLASSES} bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-white`;
      mapLink.setAttribute("aria-current", "page");
      reportLink.className = NAV_LINK_CLASSES;
      reportLink.removeAttribute("aria-current");
    } else {
      reportLink.className = `${NAV_LINK_CLASSES} bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-white`;
      reportLink.setAttribute("aria-current", "page");
      mapLink.className = NAV_LINK_CLASSES;
      mapLink.removeAttribute("aria-current");
    }
  };

  const handleNavClick = (screen: "map" | "report") => (e: Event) => {
    e.preventDefault();
    setActiveScreen(screen);
    opts?.onNavigate?.(screen);
  };

  const onMapClick = handleNavClick("map");
  const onReportClick = handleNavClick("report");
  mapLink.addEventListener("click", onMapClick);
  reportLink.addEventListener("click", onReportClick);

  // Initialize auth state and set login button label
  (async () => {
    try {
      const user = await db.getAuth();
      const email = (user as any)?.email as string | undefined;
      if (email) {
        renderSignedIn(email);
      }
    } catch (_) {
      // ignore if not signed in
    }
  })();

  return {
    element: header,
    setActiveScreen,
    onSignedIn: (fn: (email: string) => void) => {
      signedInListeners.push(fn);
    },
    destroy: () => {
      unsubscribeTheme();
      themeButton.removeEventListener("click", handleClick);
      loginButton.removeEventListener("click", onLoginButtonClick);
      logoutButton.removeEventListener("click", onLogoutButtonClick);
      mapLink.removeEventListener("click", onMapClick);
      reportLink.removeEventListener("click", onReportClick);
      loginModal.destroy();
    },
  };
};
