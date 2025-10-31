import { useState, useEffect, useRef } from "react";
import type { FormEvent, MouseEvent as ReactMouseEvent } from "react";
import { db } from "../../lib/reactDb";
import { isAdminEmail } from "../../lib/admin";
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

const SearchIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5 translate-x-[0.2px] -translate-y-[0.2px] text-slate-400 dark:text-slate-500">
    <path
      fillRule="evenodd"
      d="M9 3.5a5.5 5.5 0 013.894 9.394l3.703 3.703a.75.75 0 11-1.06 1.06l-3.703-3.703A5.5 5.5 0 119 3.5zm0 1.5a4 4 0 100 8 4 4 0 000-8z"
      clipRule="evenodd"
    />
  </svg>
);

const HamburgerIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
    <path fill="currentColor" d="M4 7a1 1 0 011-1h14a1 1 0 110 2H5a1 1 0 01-1-1zm0 5a1 1 0 011-1h14a1 1 0 110 2H5a1 1 0 01-1-1zm0 5a1 1 0 011-1h14a1 1 0 110 2H5a1 1 0 01-1-1z" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5">
    <path
      fill="currentColor"
      d="M6.225 4.811a1 1 0 011.414 0L12 9.172l4.361-4.361a1 1 0 011.415 1.414L13.414 10.6l4.362 4.361a1 1 0 01-1.415 1.415L12 12.014l-4.361 4.362a1 1 0 01-1.414-1.415L10.586 10.6 6.225 6.239a1 1 0 010-1.428z"
    />
  </svg>
);

const PlusIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
    <path
      fill="currentColor"
      d="M12 5a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H6a1 1 0 110-2h5V6a1 1 0 011-1z"
    />
  </svg>
);

// Locate icon is now rendered in the map overlay button

const MOBILE_SEARCH_AUTO_EXPAND_THRESHOLD = 380;

interface TopBarProps {
  onBrandClick?: () => void;
  onNavigate?: (screen: "map" | "report" | "data" | "queue") => void;
  active?: "map" | "report" | "data" | "queue";
  onOpenAuth?: () => void;
  isMobile?: boolean;
  onMobileLocationSearch?: (query: string) => void;
  onAddOrganization?: () => void;
}

export const TopBar = ({
  onBrandClick,
  onNavigate,
  active = "map",
  onOpenAuth,
  isMobile = false,
  onMobileLocationSearch,
  onAddOrganization,
}: TopBarProps) => {
  const [theme, setTheme] = useState<ThemeName>("light");
  const { isLoading, user } = db.useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [mobileSearchValue, setMobileSearchValue] = useState("");
  const [isCompactMobileSearch, setIsCompactMobileSearch] = useState(false);
  const [isMobileSearchExpanded, setIsMobileSearchExpanded] = useState(true);
  const mobileActionsRef = useRef<HTMLDivElement | null>(null);
  const mobileSearchFormRef = useRef<HTMLFormElement | null>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const unsubscribe = themeController.subscribe((current) => {
      setTheme(current);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setIsMobileMenuOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!isMobileMenuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isMobileMenuOpen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const node = mobileActionsRef.current;
    if (!node) return;
    if (typeof ResizeObserver === "undefined") return;

    const updateCompactState = () => {
      // Collapse the search UI into an icon when the mobile row gets narrow.
      const width = node.getBoundingClientRect().width;
      setIsCompactMobileSearch((prev) => {
        const next = width < MOBILE_SEARCH_AUTO_EXPAND_THRESHOLD;
        if (prev !== next) {
          setIsMobileSearchExpanded(!next);
        }
        return next;
      });
    };

    updateCompactState();
    const observer = new ResizeObserver(() => updateCompactState());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isCompactMobileSearch || !isMobileSearchExpanded) return;
    const handlePointerDown = (event: PointerEvent) => {
      const form = mobileSearchFormRef.current;
      if (form && event.target instanceof Node && form.contains(event.target)) {
        return;
      }
      mobileSearchInputRef.current?.blur();
      setIsMobileSearchExpanded(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [isCompactMobileSearch, isMobileSearchExpanded]);

  const handleThemeToggle = () => {
    themeController.toggle();
  };

  const handleBrandClick = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    onBrandClick?.();
  };

  const handleMobileSearchSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = mobileSearchValue.trim();
    if (!trimmed) return;
    onMobileLocationSearch?.(trimmed);
    if (isCompactMobileSearch) {
      mobileSearchInputRef.current?.blur();
      setIsMobileSearchExpanded(false);
    }
  };

  const handleMobileMenuToggle = () => {
    setIsMobileMenuOpen((prev) => !prev);
  };

  const handleNavigate = (screen: "map" | "report" | "data" | "queue") => {
    setIsMobileMenuOpen(false);
    onNavigate?.(screen);
  };

  const handleAddOrganization = () => {
    setIsMobileMenuOpen(false);
    onAddOrganization?.();
  };

  // Location actions are now handled by the map overlay button

  const handleMobileSearchExpand = () => {
    setIsMobileSearchExpanded(true);
    if (typeof window !== "undefined") {
      window.requestAnimationFrame(() => {
        mobileSearchInputRef.current?.focus();
      });
    }
  };

  const handleLogin = () => {
    setIsMobileMenuOpen(false);
    onOpenAuth?.();
  };

  const handleSignOut = () => {
    setIsMobileMenuOpen(false);
    void db.auth.signOut();
  };

  const showDataLink =
    !isLoading && user && !user.isGuest && isAdminEmail(user.email ?? null);
  const showQueueLink =
    !isLoading && user && !user.isGuest && isAdminEmail(user.email ?? null);

  return (
    <>
      <header
        data-role="topbar"
        className="sticky top-0 z-20 flex flex-col gap-2 border-b border-slate-200 bg-white/80 px-4 pt-safe backdrop-blur-lg dark:border-slate-800 dark:bg-slate-900/80 sm:gap-0 sm:px-6"
      >
        <div className="hidden h-16 w-full items-center justify-between sm:flex">
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
            <nav className="hidden items-center gap-2 sm:flex">
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
                onMouseEnter={() => {
                  import("../components/ReportScreen");
                }}
                onFocus={() => {
                  import("../components/ReportScreen");
                }}
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
              {showDataLink && (
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
            )}
            {showQueueLink && (
              <a
                href="#queue"
                onClick={(e) => {
                  e.preventDefault();
                  onNavigate?.("queue");
                }}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                  active === "queue"
                    ? "bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-white"
                    : "text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                }`}
                aria-current={active === "queue" ? "page" : undefined}
              >
                Queue
              </a>
            )}
            <a
              href="https://www.neighborhoodexplorer.org/statistics/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Stats
            </a>
            <a
              href="https://www.neighborhoodexplorer.org/organizations/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Orgs
            </a>
            <a
              href="https://www.neighborhoodexplorer.org/community-goals/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Goals
            </a>
            <a
              href="https://www.neighborhoodexplorer.org/research-questions/"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              Research
            </a>
            <a
              href="https://www.9bcorp.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            >
              About
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
                <span className="text-slate-500 opacity-0 transition-opacity group-hover:opacity-100 group-hover:text-current">
                  <LogoutIcon />
                </span>
              </button>
            )}
            {/* Location button moved onto map overlay */}
            <button
              type="button"
              onClick={handleThemeToggle}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-brand-200 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-pressed={theme === "dark"}
            >
              {theme === "dark" ? <MoonIcon /> : <SunIcon />}
            </button>
            {onAddOrganization && (
              <button
                type="button"
                onClick={handleAddOrganization}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-brand-700 shadow-sm transition hover:bg-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:ring-offset-2 dark:bg-brand-500/20 dark:text-brand-200 dark:hover:bg-brand-500/30 dark:focus:ring-offset-slate-900"
                aria-label="Add organization"
              >
                <PlusIcon />
              </button>
            )}
          </div>
        </div>
        <div
          className="flex w-full items-center gap-3 py-3 sm:hidden"
          style={{ minHeight: "72px" }}
          ref={mobileActionsRef}
        >
          <button
            type="button"
            onClick={() => onBrandClick?.()}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 font-display text-lg font-semibold tracking-wider text-white shadow-floating"
            aria-label="Return to home"
          >
            NE
          </button>
          <div className="flex flex-1 items-center gap-3">
            {isCompactMobileSearch && !isMobileSearchExpanded ? (
              <button
                type="button"
                onClick={handleMobileSearchExpand}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-brand-200 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
                aria-label="Open search"
                aria-expanded={false}
              >
                <SearchIcon />
              </button>
            ) : (
              <form
                ref={mobileSearchFormRef}
                onSubmit={handleMobileSearchSubmit}
                className="flex flex-1 items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 shadow-sm transition focus-within:border-brand-300 focus-within:ring-2 focus-within:ring-brand-200 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-slate-500"
              >
                <SearchIcon />
                <input
                  ref={mobileSearchInputRef}
                  type="search"
                  value={mobileSearchValue}
                  onChange={(e) => setMobileSearchValue(e.target.value)}
                  placeholder="enter ZIP"
                  className="w-full min-w-0 bg-transparent text-base text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-500"
                  enterKeyHint="search"
                />
              </form>
            )}
            {/* Mobile location button removed; now rendered on map */}
          </div>
          {(!isCompactMobileSearch || !isMobileSearchExpanded) && (
            <button
              type="button"
              onClick={handleThemeToggle}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-brand-200 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-pressed={theme === "dark"}
            >
              {theme === "dark" ? <MoonIcon /> : <SunIcon />}
            </button>
          )}
          {onAddOrganization && (
            <button
              type="button"
              onClick={handleAddOrganization}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-brand-100 text-brand-700 shadow-sm transition hover:bg-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:ring-offset-2 dark:bg-brand-500/20 dark:text-brand-200 dark:hover:bg-brand-500/30 dark:focus:ring-offset-slate-900"
              aria-label="Add organization"
            >
              <PlusIcon />
            </button>
          )}
          <button
            type="button"
            onClick={handleMobileMenuToggle}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-brand-200 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
            aria-label="Open menu"
            aria-expanded={isMobileMenuOpen}
          >
            <HamburgerIcon />
          </button>
        </div>
      </header>
      {/* Location errors are now rendered inline within the map overlay button */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 bg-white/95 backdrop-blur-md dark:bg-slate-950/95">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-6 pt-6">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-brand-500 font-display text-lg font-semibold text-white shadow-floating">
                NE
              </span>
              <button
                type="button"
                onClick={handleMobileMenuToggle}
                className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-brand-200 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
                aria-label="Close menu"
              >
                <CloseIcon />
              </button>
            </div>
            <nav className="mt-10 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-10">
              {onAddOrganization && (
                <button
                  type="button"
                  onClick={handleAddOrganization}
                  className="flex w-full items-center justify-between rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-left text-lg font-semibold text-brand-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-100 dark:border-brand-500/50 dark:bg-brand-500/10 dark:text-brand-200 dark:hover:border-brand-400 dark:hover:bg-brand-500/20"
                >
                  <span>Add an organization</span>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-white">
                    <PlusIcon />
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => handleNavigate("map")}
                className={`w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800 ${active === "map" ? "bg-brand-50 dark:bg-slate-800" : ""}`}
                aria-current={active === "map" ? "page" : undefined}
              >
                Map
              </button>
              <button
                type="button"
                onClick={() => handleNavigate("report")}
                className={`w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800 ${active === "report" ? "bg-brand-50 dark:bg-slate-800" : ""}`}
                aria-current={active === "report" ? "page" : undefined}
              >
                Report
              </button>
              {showDataLink && (
                <button
                  type="button"
                  onClick={() => handleNavigate("data")}
                  className={`w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800 ${active === "data" ? "bg-brand-50 dark:bg-slate-800" : ""}`}
                  aria-current={active === "data" ? "page" : undefined}
                >
                  Data
                </button>
              )}
              {showQueueLink && (
                <button
                  type="button"
                  onClick={() => handleNavigate("queue")}
                  className={`w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800 ${active === "queue" ? "bg-brand-50 dark:bg-slate-800" : ""}`}
                  aria-current={active === "queue" ? "page" : undefined}
                >
                  Queue
                </button>
              )}
              <a
                href="https://www.neighborhoodexplorer.org/statistics/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800"
              >
                Stats
              </a>
              <a
                href="https://www.neighborhoodexplorer.org/organizations/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800"
              >
                Orgs
              </a>
              <a
                href="https://www.neighborhoodexplorer.org/community-goals/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800"
              >
                Goals
              </a>
              <a
                href="https://www.neighborhoodexplorer.org/research-questions/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800"
              >
                Research
              </a>
              <a
                href="https://www.9bcorp.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800"
              >
                About
              </a>
            </nav>
            <div className="px-6 pb-safe pt-2">
              {!isLoading && (!user || user.isGuest) ? (
                <button
                  type="button"
                  onClick={handleLogin}
                  className="w-full rounded-full border border-slate-200 bg-white px-5 py-3 text-base font-semibold text-slate-700 shadow-sm transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-800 dark:hover:text-white"
                >
                  Login
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-full rounded-full border border-slate-200 bg-white px-5 py-3 text-base font-semibold text-slate-700 shadow-sm transition hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:bg-slate-800 dark:hover:text-white"
                >
                  Sign out
                </button>
              )}
              {!isLoading && user && !user.isGuest && (
                <p className="mt-3 text-center text-xs text-slate-500 dark:text-slate-400">
                  Signed in as {user.email}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
