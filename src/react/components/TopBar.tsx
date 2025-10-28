import { useState, useEffect } from "react";
import { db } from "../../lib/reactDb";
import { themeController } from "../imperative/theme";

type ThemeName = "light" | "dark";

const SunIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
    <path
      fill="currentColor"
      d="M12 18a1 1 0 011 1v1.5a1 1 0 11-2 0V19a1 1 0 011-1zm0-13a1 1 0 011-1V2.5a1 1 0 11-2 0V4a1 1 0 011 1zm6.364 12.95l1.061 1.061a1 1 0 01-1.414 1.414l-1.06-1.06a1 1 0 011.413-1.415zM5.05 5.636L3.99 4.575A1 1 0 115.403 3.16l1.06 1.06A1 1 0 115.05 5.636zM22 13a1 1 0 100-2h-1.5a1 1 0 100 2H22zM4 13a1 1 0 100-2H2.5a1 1 0 100 2H4zm15.314-7.95l1.061-1.061a1 1 0 10-1.414-1.414l-1.06 1.06a1 1 0 101.413 1.415zM6.474 19.364l-1.06 1.06a1 1 0 11-1.415-1.413l1.061-1.061a1 1 0 111.414 1.414zM12 8a4 4 0 100 8 4 4 0 000-8z"
    />
  </svg>
);

const MoonIcon = () => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    className="h-5 w-5 translate-x-[-2px] translate-y-[2px]"
  >
    <path
      fill="currentColor"
      d="M21 12.79A9 9 0 0111.21 3a7 7 0 1010 9.79 1 1 0 010 .02 9 9 0 01-.21 0z"
    />
  </svg>
);

const LogoutIcon = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
    <path
      fill="currentColor"
      d="M11.28 4.22a.75.75 0 10-1.06 1.06L12.94 8H7a.75.75 0 000 1.5h5.94l-2.72 2.72a.75.75 0 101.06 1.06l4-4a.75.75 0 000-1.06l-4-4z"
    />
    <path
      fill="currentColor"
      d="M4.5 3A1.5 1.5 0 003 4.5v11A1.5 1.5 0 004.5 17h4a.75.75 0 000-1.5h-4a.5.5 0 01-.5-.5v-11a.5.5 0 01.5-.5h4A.75.75 0 008.5 3h-4z"
    />
  </svg>
);

interface TopBarProps {
  onBrandClick?: () => void;
  onNavigate?: (screen: "map" | "report" | "data") => void;
  active?: "map" | "report" | "data";
  onOpenAuth?: () => void;
}

export const TopBar = ({ onBrandClick, onNavigate, active = "map", onOpenAuth }: TopBarProps) => {
  const [theme, setTheme] = useState<ThemeName>("light");
  const { isLoading, user } = db.useAuth();

  useEffect(() => {
    const unsubscribe = themeController.subscribe((current) => {
      setTheme(current);
    });

    return unsubscribe;
  }, []);

  const handleThemeToggle = () => {
    themeController.toggle();
  };

  

  const handleBrandClick = (e: React.MouseEvent) => {
    e.preventDefault();
    onBrandClick?.();
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/80 px-6 backdrop-blur-lg dark:border-slate-800 dark:bg-slate-900/80">
      <div className="flex items-center gap-4">
        <a
          href="#"
          onClick={handleBrandClick}
          className="flex items-center gap-3 text-sm font-medium text-slate-500 dark:text-slate-400 -ml-2"
        >
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 font-display text-lg font-semibold tracking-wider text-white shadow-floating">
            NE
          </span>
        </a>
        <nav className="hidden sm:flex items-center gap-2">
          <a
            href="#map"
            onClick={(e) => {
              e.preventDefault();
              onNavigate?.("map");
            }}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
              active === "map"
                ? "bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-white"
                : "text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            }`}
            aria-current={active === "map" ? "page" : undefined}
          >
            Map
          </a>
          <a
            href="#report"
            onMouseEnter={() => { import("../components/ReportScreen"); }}
            onFocus={() => { import("../components/ReportScreen"); }}
            onClick={(e) => {
              e.preventDefault();
              onNavigate?.("report");
            }}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
              active === "report"
                ? "bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-white"
                : "text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            }`}
            aria-current={active === "report" ? "page" : undefined}
          >
            Report
          </a>
          <a
            href="#data"
            onClick={(e) => {
              e.preventDefault();
              onNavigate?.("data");
            }}
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
              active === "data"
                ? "bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-white"
                : "text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            }`}
            aria-current={active === "data" ? "page" : undefined}
          >
            Data
          </a>
        </nav>
      </div>

      <div className="flex items-center gap-4">
        {!isLoading && (!user || user.isGuest) && (
          <button
            type="button"
            onClick={onOpenAuth}
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-brand-200 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
          >
            Login
          </button>
        )}
        {!isLoading && user && !user.isGuest && (
          <button
            type="button"
            onClick={() => db.auth.signOut()}
            className="group inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-brand-200 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
            title="Sign out"
          >
            <span className="max-w-[16ch] truncate">{user.email}</span>
            <span className="opacity-0 transition-opacity group-hover:opacity-100 text-slate-500 group-hover:text-current">
              <LogoutIcon />
            </span>
          </button>
        )}
        <button
          type="button"
          onClick={handleThemeToggle}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-brand-200 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-pressed={theme === "dark"}
        >
          {theme === "dark" ? <MoonIcon /> : <SunIcon />}
        </button>
      </div>
    </header>
  );
};
