import { useState, useEffect, useRef, useMemo } from "react";
import type { FormEvent, MouseEvent as ReactMouseEvent } from "react";
import { track } from "@vercel/analytics";
import { db } from "../../lib/reactDb";
import { isAdminEmail } from "../../lib/admin";
import { themeController } from "../imperative/theme";
import { useCensusImportQueue } from "../hooks/useCensusImportQueue";
import { QueueListIcon } from "@heroicons/react/24/outline";

// ============================================================================
// Enable Features
// ============================================================================
const ENABLE_REPORT_MENU = true;

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

const PlusIcon = ({ className = "h-6 w-6" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
    <path
      fill="currentColor"
      d="M12 5a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H6a1 1 0 110-2h5V6a1 1 0 011-1z"
    />
  </svg>
);

const ArrowRightIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
    <path
      fillRule="evenodd"
      d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
      clipRule="evenodd"
    />
  </svg>
);

const ChevronDownIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
    <path
      fillRule="evenodd"
      d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z"
      clipRule="evenodd"
    />
  </svg>
);

// Locate icon is now rendered in the map overlay button

const MOBILE_SEARCH_AUTO_EXPAND_THRESHOLD = 380;

const NE_HOME_REDIRECT_STORAGE_KEY = "ne.homeRedirectDisabled";

const guessQueueTitle = (text: string): string => {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const delimiters = ["→", "–", "—", "·", ":"];
  let bestIndex = -1;
  let bestDelim = "";
  for (const delim of delimiters) {
    const idx = trimmed.lastIndexOf(delim);
    if (idx === -1) continue;
    const next = trimmed.slice(idx + delim.length).trim();
    if (!next) continue;
    if (idx > bestIndex) {
      bestIndex = idx;
      bestDelim = delim;
    }
  }
  if (bestIndex === -1) return trimmed;
  return trimmed.slice(bestIndex + bestDelim.length).trim();
};

const getQueueItemTitle = (item: { statLabel?: string; variable: string }): string => {
  if (item.statLabel && item.statLabel.trim()) {
    const guessed = guessQueueTitle(item.statLabel);
    return guessed || item.statLabel.trim();
  }
  return item.variable;
};

const getNeHomeRedirectState = (): boolean => {
  if (typeof window === "undefined") return false; // Default: map is home (=0), toggle "on"
  const stored = localStorage.getItem(NE_HOME_REDIRECT_STORAGE_KEY);
  if (stored === null) return false; // Never clicked: default map home (=0)
  // If clicked before, return stored value (false = map home, true = original home)
  return stored === "true";
};

const setNeHomeRedirectState = (disabled: boolean): void => {
  if (typeof window === "undefined") return;
  localStorage.setItem(NE_HOME_REDIRECT_STORAGE_KEY, disabled ? "true" : "false");
};

interface TopBarProps {
  onBrandClick?: () => void;
  onNavigate?: (screen: "map" | "report" | "roadmap" | "data" | "queue" | "admin") => void;
  active?: "map" | "report" | "roadmap" | "data" | "queue" | "admin";
  onOpenAuth?: () => void;
  isMobile?: boolean;
  onMobileLocationSearch?: (query: string) => void;
  onAddOrganization?: () => void;
  expandMobileSearch?: boolean;
}

export const TopBar = ({
  onBrandClick,
  onNavigate,
  active = "map",
  onOpenAuth,
  isMobile = false,
  onMobileLocationSearch,
  onAddOrganization,
  expandMobileSearch = false,
}: TopBarProps) => {
  const [theme, setTheme] = useState<ThemeName>("light");
  const { isLoading, user } = db.useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [mobileSearchValue, setMobileSearchValue] = useState("");
  const [isCompactMobileSearch, setIsCompactMobileSearch] = useState(false);
  // Default to collapsed (icon button) on mobile; will be updated by ResizeObserver based on screen width
  const [isMobileSearchExpanded, setIsMobileSearchExpanded] = useState(false);
  const [isMobileSearchFocused, setIsMobileSearchFocused] = useState(false);
  const [neHomeRedirectDisabled, setNeHomeRedirectDisabled] = useState(getNeHomeRedirectState);
  const [showLocationTextMobile, setShowLocationTextMobile] = useState(true);
  const [showThemeButtonMobile, setShowThemeButtonMobile] = useState(true);
  // Desktop "More" dropdown state
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const {
    queueItems: importQueueItems,
    setQueueItems: setImportQueueItems,
    isRunning: isImportRunning,
    currentItemId: currentImportItemId,
    currentYearProcessing: currentImportYearProcessing,
    derivedStatusLabel: importDerivedStatusLabel,
    isDropdownOpen: isImportQueueOpen,
    setIsDropdownOpen: setIsImportQueueOpen,
    toggleDropdown: toggleImportQueueDropdown,
  } = useCensusImportQueue();
  const mobileActionsRef = useRef<HTMLDivElement | null>(null);
  const mobileSearchFormRef = useRef<HTMLFormElement | null>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement | null>(null);
  const moreMenuRef = useRef<HTMLDivElement | null>(null);
  const importQueueRef = useRef<HTMLDivElement | null>(null);
  const nextNeHomeRedirectDisabled = !neHomeRedirectDisabled;
  const nextNeHomeUrl = `https://www.neighborhoodexplorer.org/?dwft_disable_homepage_redirect=${nextNeHomeRedirectDisabled ? "1" : "0"}`;

  useEffect(() => {
    const unsubscribe = themeController.subscribe((current) => {
      setTheme(current);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isMobile) {
      setIsMobileMenuOpen(false);
    } else {
      // Close desktop dropdown when switching to mobile
      setIsMoreMenuOpen(false);
    }
  }, [isMobile]);

  useEffect(() => {
    if (!isImportQueueOpen) return;
    const handleClickOutside = (event: globalThis.MouseEvent) => {
      if (importQueueRef.current && !importQueueRef.current.contains(event.target as Node)) {
        setIsImportQueueOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isImportQueueOpen, setIsImportQueueOpen]);

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
      const shouldBeCompact = width < MOBILE_SEARCH_AUTO_EXPAND_THRESHOLD;
      
      setIsCompactMobileSearch((prev) => {
        const next = shouldBeCompact;
        // When transitioning to/from compact mode, update expanded state:
        // - Wide screen (>= 380px): always expanded
        // - Narrow screen (< 380px): collapsed (icon button) by default, but user can manually expand
        if (prev !== next) {
          // Transitioning between modes
          if (next) {
            // Becoming compact (narrow): collapse to icon button
            setIsMobileSearchExpanded(false);
          } else {
            // Becoming wide: always show expanded search bar
            setIsMobileSearchExpanded(true);
          }
        } else if (!next) {
          // Already in wide mode: ensure it's always expanded
          setIsMobileSearchExpanded(true);
        }
        // When staying in compact mode, don't change expanded state (user may have manually expanded it)
        return next;
      });
      
      // Hide Location text when mobile container is narrow to ensure theme button always fits
      // Fixed elements: brand button (~48px) + gap (12px) + search icon (~44px) + gap (12px) + theme button (~44px) + gap (12px) + hamburger (~44px) + gaps = ~212px
      // Location icon button needs ~44px, text adds ~80px
      // Hide text earlier (at ~340px) to ensure theme button always has room
      setShowLocationTextMobile(width >= 340);
      
      // Hide theme button when space is very tight to ensure Location and Hamburger buttons always fit
      // Minimum needed: brand (~48px) + search icon (~44px) + location icon (~44px) + hamburger (~44px) + gaps (~36px) = ~216px
      // Hide theme button when width is less than ~260px to provide buffer
      setShowThemeButtonMobile(width >= 260);
    };

    updateCompactState();
    const observer = new ResizeObserver(() => updateCompactState());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Handle external request to expand mobile search
  useEffect(() => {
    if (expandMobileSearch && isMobile) {
      setIsMobileSearchExpanded(true);
    }
  }, [expandMobileSearch, isMobile]);

  // Focus input when mobile search becomes expanded (handles both prop-driven and internal state changes)
  useEffect(() => {
    if (!isMobile || !isMobileSearchExpanded) return;
    
    // Wait for React to render the input before focusing
    // Use multiple attempts with increasing delays to ensure it works
    const attemptFocus = (attempt = 0) => {
      if (attempt > 5) return; // Max 5 attempts
      
      const input = mobileSearchInputRef.current;
      if (input && document.activeElement !== input) {
        // Ensure the input is visible
        if (input.offsetParent !== null) {
          input.focus();
          // Also trigger a click to ensure it's in focused state on mobile
          // This helps with mobile browsers that require user interaction
          try {
            input.click();
          } catch {
            // Some browsers prevent programmatic clicks, that's okay
          }
        } else {
          // Input not visible yet, try again
          setTimeout(() => attemptFocus(attempt + 1), 50);
        }
      } else if (!input) {
        // Input not rendered yet, try again
        setTimeout(() => attemptFocus(attempt + 1), 50);
      }
    };
    
    // Start attempts after a short delay to allow React to render
    const timeoutId = setTimeout(() => {
      requestAnimationFrame(() => {
        attemptFocus(0);
      });
    }, 100);
    
    return () => clearTimeout(timeoutId);
  }, [isMobile, isMobileSearchExpanded]);

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

  // Click-outside handler for desktop "More" dropdown
  useEffect(() => {
    if (!isMoreMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const menu = moreMenuRef.current;
      if (menu && event.target instanceof Node && !menu.contains(event.target)) {
        setIsMoreMenuOpen(false);
      }
    };
    // Use mousedown for immediate response
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMoreMenuOpen]);

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

  const trackNavItem = (item: string, destination: "internal" | "external") => {
    track("topbar_nav_click", { item, destination, device: isMobile ? "mobile" : "desktop" });
  };

  const handleNavigate = (screen: "map" | "report" | "roadmap" | "data" | "queue" | "admin") => {
    setIsMobileMenuOpen(false);
    const labelMap: Record<typeof screen, string> = {
      map: "Food Map",
      report: "Report",
      roadmap: "Roadmap",
      data: "Data",
      queue: "Queue",
      admin: "Admin",
    };
    trackNavItem(labelMap[screen], "internal");
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
  const showReportLink =
    !isLoading &&
    user &&
    !user.isGuest &&
    user.email?.toLowerCase() === "ttroyr@gmail.com";
  const showQueueLink =
    !isLoading && user && !user.isGuest && isAdminEmail(user.email ?? null);
  const showAdminLink =
    !isLoading && user && !user.isGuest && isAdminEmail(user.email ?? null);
  const showRoadmapLink = !isLoading && user != null && !user.isGuest;

  const queueQuery = useMemo(
    () =>
      showQueueLink
        ? {
            organizations: {
              $: {
                where: { moderationStatus: "pending" },
              },
            },
          }
        : null,
    [showQueueLink],
  );

  const { data: queueData } = db.useQuery(queueQuery);
  const pendingQueueCount = queueData?.organizations?.length ?? 0;
  const showQueueBadge = pendingQueueCount > 0;
  const queueBadgeLabel = pendingQueueCount > 99 ? "99+" : pendingQueueCount.toString();

  const importQueueTotal = importQueueItems.length;
  const importQueueActiveCount = importQueueItems.filter(
    (item) => item.status === "pending" || item.status === "running",
  ).length;
  const importQueueCompletedCount = importQueueItems.filter((item) => item.status === "success").length;
  const importQueueProgress =
    importQueueTotal === 0 ? 0 : Math.round((importQueueCompletedCount / importQueueTotal) * 100);
  const showImportQueueBadge = importQueueActiveCount > 0;
  const importQueueBadgeLabel = importQueueActiveCount > 99 ? "99+" : importQueueActiveCount.toString();
  const showImportQueue = showQueueLink && (showImportQueueBadge || isImportRunning);
  const showGroupingNote =
    isImportRunning &&
    (importDerivedStatusLabel?.toLowerCase().startsWith("grouping") ?? false);
  const hasCompletedImports = importQueueCompletedCount > 0;

  return (
    <>
      <header
        data-role="topbar"
        className="sticky top-0 z-40 flex flex-col gap-2 border-b border-slate-200 bg-white/80 px-4 pt-safe backdrop-blur-lg dark:border-slate-800 dark:bg-slate-900/80 sm:gap-0 sm:px-6"
      >
        <div className="hidden h-14 w-full items-center justify-between sm:flex">
          <div className="flex min-w-0 flex-1 items-center gap-4">
            <a
              href="#"
              onClick={handleBrandClick}
              className="flex shrink-0 items-center gap-3 text-sm font-medium text-slate-500 dark:text-slate-400 -ml-2"
            >
              <img src="/icons/NE_Logos_Logomark_Prp.svg" alt="NourishED" className="h-9 w-9 rounded-lg shadow-floating" />
            </a>
            <div className="relative flex min-w-0 flex-1 items-center overflow-hidden">
              <nav className="hidden min-w-0 items-center gap-2 sm:flex">
                <a
                  href="#map"
                  onClick={(e) => {
                    e.preventDefault();
                    trackNavItem("Food Map", "internal");
                    onNavigate?.("map");
                  }}
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 whitespace-nowrap ${
                    active === "map"
                      ? "bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-white"
                      : "text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  }`}
                  aria-current={active === "map" ? "page" : undefined}
                >
                  Map
                </a>
                {ENABLE_REPORT_MENU && showReportLink && (
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
                      trackNavItem("Report", "internal");
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
                )}
                {showAdminLink && (
                  <a
                    href="#admin"
                    onMouseEnter={() => {
                      import("../components/AdminScreen");
                    }}
                    onFocus={() => {
                      import("../components/AdminScreen");
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      trackNavItem("Admin", "internal");
                      onNavigate?.("admin");
                    }}
                    className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                      active === "admin"
                        ? "bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-white"
                        : "text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                    }`}
                    aria-current={active === "admin" ? "page" : undefined}
                  >
                    Admin
                  </a>
                )}
                <a
                  href="https://www.neighborhoodexplorer.org/statistics/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 whitespace-nowrap text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  onClick={() => trackNavItem("All Stats", "external")}
                >
                  All Stats
                </a>
                <a
                  href="https://www.9bcorp.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                  onClick={() => trackNavItem("About", "external")}
                >
                  About
                </a>
                {/* "More" dropdown containing Queue, Roadmap, Orgs, Research */}
                <div className="relative" ref={moreMenuRef}>
                  <button
                    type="button"
                    onClick={() => setIsMoreMenuOpen((prev) => !prev)}
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                      isMoreMenuOpen || active === "queue" || active === "roadmap"
                        ? "bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-white"
                        : "text-slate-600 hover:bg-brand-50 hover:text-brand-600 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                    }`}
                    aria-expanded={isMoreMenuOpen}
                    aria-haspopup="true"
                  >
                    <span>More</span>
                    {showQueueBadge && (
                      <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-fuchsia-500 px-1 text-xs font-semibold leading-tight text-white">
                        {queueBadgeLabel}
                      </span>
                    )}
                    <span className={`transition-transform duration-150 ${isMoreMenuOpen ? "rotate-180" : ""}`}>
                      <ChevronDownIcon />
                    </span>
                  </button>
                  {isMoreMenuOpen && (
                    <div className="absolute left-0 top-full mt-2 z-50 min-w-[180px] rounded-xl border border-slate-200 bg-white py-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                      {showQueueLink && (
                        <a
                          href="#queue"
                          onClick={(e) => {
                            e.preventDefault();
                            setIsMoreMenuOpen(false);
                            trackNavItem("Queue", "internal");
                            onNavigate?.("queue");
                          }}
                          className={`flex w-full items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
                            active === "queue"
                              ? "bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-white"
                              : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                          }`}
                        >
                          <span>Queue</span>
                          {showQueueBadge && (
                            <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-fuchsia-500 px-1 text-xs font-semibold leading-tight text-white">
                              {queueBadgeLabel}
                            </span>
                          )}
                        </a>
                      )}
                      {showRoadmapLink && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsMoreMenuOpen(false);
                            handleNavigate("roadmap");
                          }}
                          className={`flex w-full items-center px-4 py-2 text-left text-sm font-medium transition-colors ${
                            active === "roadmap"
                              ? "bg-brand-50 text-brand-600 dark:bg-slate-800 dark:text-white"
                              : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                          }`}
                        >
                          Roadmap
                        </button>
                      )}
                      <a
                        href="https://www.neighborhoodexplorer.org/organizations/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full items-center px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          trackNavItem("Orgs", "external");
                        }}
                      >
                        Orgs
                      </a>
                      <a
                        href="https://www.neighborhoodexplorer.org/research-questions/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full items-center px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          trackNavItem("Research", "external");
                        }}
                      >
                        Research
                      </a>
                      <a
                        href="https://www.neighborhoodexplorer.org/community-goals/"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex w-full items-center px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                        onClick={() => {
                          setIsMoreMenuOpen(false);
                          trackNavItem("Goals", "external");
                        }}
                      >
                        Goals
                      </a>
                    </div>
                  )}
                </div>
              </nav>
              {/* Gradient fade overlay for truncating links */}
              <div 
                className="pointer-events-none absolute right-0 top-0 h-full w-56 dark:hidden"
                style={{
                  background: 'linear-gradient(to left, rgba(255, 255, 255, 0.8) 0%, rgba(255, 255, 255, 0.65) 15%, rgba(255, 255, 255, 0.45) 35%, rgba(255, 255, 255, 0.25) 55%, rgba(255, 255, 255, 0.1) 75%, rgba(255, 255, 255, 0.05) 90%, transparent 100%)'
                }}
              />
              <div 
                className="pointer-events-none absolute right-0 top-0 h-full w-56 hidden dark:block"
                style={{
                  background: 'linear-gradient(to left, rgba(17, 26, 20, 0.8) 0%, rgba(17, 26, 20, 0.65) 15%, rgba(17, 26, 20, 0.45) 35%, rgba(17, 26, 20, 0.25) 55%, rgba(17, 26, 20, 0.1) 75%, rgba(17, 26, 20, 0.05) 90%, transparent 100%)'
                }}
              />
            </div>
          </div>
          <div className="relative z-10 flex shrink-0 items-center gap-3 bg-white/80 pl-4 -ml-4 -mr-2 dark:bg-slate-900/80 backdrop-blur-lg">
            {/* Blend the left seam where the nav lane meets the right action cluster on tight desktop widths. */}
            <div
              className="pointer-events-none absolute -left-12 top-0 h-full w-12 dark:hidden"
              style={{
                background: "linear-gradient(to right, transparent 0%, rgba(255, 255, 255, 0.8) 100%)",
              }}
            />
            <div
              className="pointer-events-none absolute -left-12 top-0 hidden h-full w-12 dark:block"
              style={{
                background: "linear-gradient(to right, transparent 0%, rgba(15, 23, 42, 0.8) 100%)",
              }}
            />
            <a
              href={nextNeHomeUrl}
              onClick={(e) => {
                e.preventDefault();
                // Persist the selected homepage mode before browser navigation.
                setNeHomeRedirectDisabled(nextNeHomeRedirectDisabled);
                setNeHomeRedirectState(nextNeHomeRedirectDisabled);
                if (nextNeHomeRedirectDisabled) {
                  // Switching to original home: open classic homepage in a new tab,
                  // and keep this tab on the map host.
                  const opened = window.open(nextNeHomeUrl, "_blank");
                  if (opened) {
                    // Detach opener to avoid tabnabbing while still allowing reliable popup detection.
                    opened.opener = null;
                  }
                  window.location.assign("https://map.neighborhoodexplorer.org");
                  return;
                }
                // Switching to map home: navigate in this tab (server redirects to map).
                window.location.assign(nextNeHomeUrl);
              }}
              className="relative inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors duration-150 text-slate-600 dark:text-slate-300"
              title={neHomeRedirectDisabled ? "Make map the default homepage" : "Open original homepage in a new tab"}
            >
              <span className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                neHomeRedirectDisabled
                  ? "bg-slate-300 dark:bg-slate-600"
                  : "bg-brand-400 dark:bg-brand-500"
              }`}>
                <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow transition ${
                  neHomeRedirectDisabled
                    ? "translate-x-1.5"
                    : "translate-x-3"
                }`} />
              </span>
              <span className="whitespace-nowrap text-slate-400 dark:text-slate-500">
                {neHomeRedirectDisabled ? "Home: Original" : "Home: Map"}
              </span>
            </a>
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
                className="group inline-flex items-center gap-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:border-brand-200 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
                title="Sign out"
              >
                <span className="max-w-[24ch] truncate">
                  <span className="group-hover:hidden">
                    {user.email?.split("@")[0]}
                  </span>
                  <span className="hidden group-hover:inline">
                    {user.email}
                  </span>
                </span>
                <span className="text-slate-500 w-0 overflow-hidden transition-all duration-200 group-hover:w-4 group-hover:ml-2 group-hover:text-current group-active:w-4 group-active:ml-2 group-active:text-current">
                  <LogoutIcon />
                </span>
              </button>
            )}
            {showImportQueue && (
              <div ref={importQueueRef} className="relative">
                <button
                  type="button"
                  onClick={toggleImportQueueDropdown}
                  className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-brand-200 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
                  aria-label="Toggle import queue"
                  aria-expanded={isImportQueueOpen}
                >
                  <QueueListIcon className="h-5 w-5" />
                  {showImportQueueBadge && (
                    <span className="absolute -top-1 -right-1 min-w-[1.1rem] rounded-full bg-brand-500 px-1.5 py-0.5 text-[10px] font-semibold text-white shadow">
                      {importQueueBadgeLabel}
                    </span>
                  )}
                </button>
                {isImportQueueOpen && (
                  <div className="absolute right-0 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-3 text-[11px] shadow-xl dark:border-slate-700 dark:bg-slate-900">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Import queue
                      </span>
                      <div className="flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500">
                        {importQueueTotal > 0 && (
                          <span>
                            {importQueueCompletedCount}/{importQueueTotal}
                          </span>
                        )}
                        {hasCompletedImports && (
                          <button
                            type="button"
                            onClick={() =>
                              setImportQueueItems((prev) =>
                                prev.filter((item) => item.status !== "success"),
                              )
                            }
                            className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 transition hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                    {isImportRunning && (
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                        <div
                          className="h-full rounded-full bg-brand-500 transition-all dark:bg-brand-400"
                          style={{ width: `${importQueueProgress}%` }}
                        />
                      </div>
                    )}
                    {showGroupingNote && (
                      <div className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
                        {importDerivedStatusLabel}…
                      </div>
                    )}
                    <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
                      {importQueueItems.length === 0 ? (
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          No imports queued yet.
                        </p>
                      ) : (
                        importQueueItems.map((item) => {
                          const isCurrent = item.id === currentImportItemId && isImportRunning;
                          const yearRangeLabel =
                            item.years > 1 ? `${item.year - item.years + 1} to ${item.year}` : item.year;
                          const subtitle = `${item.variable} · ${item.group} · ${yearRangeLabel}`;
                          const title = getQueueItemTitle(item);
                          return (
                            <div
                              key={item.id}
                              className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate font-medium text-slate-800 dark:text-slate-100">
                                    {title}
                                  </div>
                                  <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                                    {subtitle}
                                  </div>
                                </div>
                                <div className="shrink-0 text-[10px] text-slate-500 dark:text-slate-400">
                                  {item.status === "pending" && "Queued"}
                                  {item.status === "running" && (
                                    <span className="text-brand-600 dark:text-brand-400">
                                      {isCurrent && importDerivedStatusLabel
                                        ? `Loading ${importDerivedStatusLabel}…`
                                        : isCurrent && currentImportYearProcessing
                                          ? `Loading ${currentImportYearProcessing}…`
                                          : "Running…"}
                                    </span>
                                  )}
                                  {item.status === "success" && (
                                    <span className="text-emerald-600 dark:text-emerald-400">Done</span>
                                  )}
                                  {item.status === "error" && (
                                    <span className="text-rose-600 dark:text-rose-400">Error</span>
                                  )}
                                </div>
                              </div>
                              {item.status === "error" && item.errorMessage && (
                                <div className="mt-1 truncate text-[9px] text-rose-500 dark:text-rose-400">
                                  {item.errorMessage}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* Location button moved onto map overlay */}
            <button
              type="button"
              onClick={handleThemeToggle}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-brand-200 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              aria-pressed={theme === "dark"}
            >
              {theme === "dark" ? <MoonIcon /> : <SunIcon />}
            </button>
            {onAddOrganization && (
              <button
                type="button"
                onClick={handleAddOrganization}
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-brand-100 px-2.5 text-sm font-medium text-brand-700 transition hover:bg-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:ring-offset-2 dark:bg-brand-500/20 dark:text-brand-200 dark:hover:bg-brand-500/30 dark:focus:ring-offset-slate-900"
                aria-label="Add organization"
              >
                <PlusIcon className="h-5 w-5" />
                <span>Location</span>
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
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg shadow-floating overflow-hidden"
            aria-label="Return to home"
          >
            <img src="/icons/NE_Logos_Logomark_Prp.svg" alt="NourishED" className="h-10 w-10" />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {isCompactMobileSearch && !isMobileSearchExpanded ? (
              <button
                type="button"
                onClick={handleMobileSearchExpand}
                className="inline-flex h-11 min-w-[2.75rem] w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-brand-200 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
                aria-label="Open search"
                aria-expanded={false}
              >
                <SearchIcon />
              </button>
            ) : (
              <form
                ref={mobileSearchFormRef}
                onSubmit={handleMobileSearchSubmit}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-full border border-slate-200 bg-white pl-3 pr-2 py-2 shadow-sm transition focus-within:border-brand-300 focus-within:ring-2 focus-within:ring-brand-200 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-slate-500"
                style={{ minWidth: 0 }}
              >
                {!isCompactMobileSearch && (
                  <button
                    type="button"
                    onClick={() => mobileSearchInputRef.current?.focus()}
                    className="flex shrink-0 items-center justify-center text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                    aria-label="Focus search"
                  >
                    <SearchIcon />
                  </button>
                )}
                <input
                  ref={mobileSearchInputRef}
                  type="search"
                  value={mobileSearchValue}
                  onChange={(e) => setMobileSearchValue(e.target.value)}
                  onFocus={(e) => {
                    setIsMobileSearchFocused(true);
                    // Select all text if input already has a value when focused
                    if (mobileSearchValue) {
                      e.target.select();
                    }
                  }}
                  onBlur={() => setIsMobileSearchFocused(false)}
                  onClick={(e) => {
                    // Select all text when clicking on an input that already has text
                    // Use setTimeout to ensure the input is focused after the click
                    if (mobileSearchValue) {
                      setTimeout(() => {
                        if (document.activeElement === e.currentTarget && mobileSearchValue) {
                          e.currentTarget.select();
                        }
                      }, 0);
                    }
                  }}
                  onPointerDown={() =>
                    track("mobile_search_bar_tap", {
                      compact: isCompactMobileSearch,
                      expanded: isMobileSearchExpanded,
                      device: "mobile",
                    })
                  }
                  placeholder="City, Org, ZIP, Address, ..."
                  className="search-input-brand-cancel flex-1 min-w-0 bg-transparent text-base text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-500"
                  enterKeyHint="search"
                />
                <button
                  type="submit"
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${
                    mobileSearchValue.trim().length > 0
                      ? "bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700 dark:bg-brand-600 dark:hover:bg-brand-500"
                      : "bg-slate-200 text-slate-600 hover:bg-slate-300 active:bg-slate-400 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600"
                  }`}
                  aria-label="Submit search"
                >
                  <ArrowRightIcon />
                </button>
              </form>
            )}
            {/* Mobile location button removed; now rendered on map */}
          </div>
          {(!isCompactMobileSearch || !isMobileSearchExpanded) && (
            <>
              {showThemeButtonMobile && !isMobileSearchFocused && (
                <button
                  type="button"
                  onClick={handleThemeToggle}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-brand-200 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
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
                  className={`inline-flex h-11 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700 shadow-sm transition hover:bg-brand-200 focus:outline-none focus:ring-2 focus:ring-brand-300 focus:ring-offset-2 dark:bg-brand-500/20 dark:text-brand-200 dark:hover:bg-brand-500/30 dark:focus:ring-offset-slate-900 ${
                    showLocationTextMobile && (!isCompactMobileSearch || !isMobileSearchExpanded) && !isMobileSearchFocused
                      ? "gap-2 w-auto px-3"
                      : "w-11 px-0"
                  }`}
                  aria-label="Add organization"
                >
                  <PlusIcon />
                  {showLocationTextMobile && (!isCompactMobileSearch || !isMobileSearchExpanded) && !isMobileSearchFocused && (
                    <span className="text-sm font-medium">Location</span>
                  )}
                </button>
              )}
            </>
          )}
          {(!isCompactMobileSearch || !isMobileSearchExpanded) && (
            <button
              type="button"
              onClick={handleMobileMenuToggle}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition hover:border-brand-200 hover:text-brand-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white"
              aria-label="Open menu"
              aria-expanded={isMobileMenuOpen}
            >
              <HamburgerIcon />
            </button>
          )}
        </div>
      </header>
      {/* Location errors are now rendered inline within the map overlay button */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-50 bg-white/95 backdrop-blur-md dark:bg-slate-950/95">
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-6 pt-6">
              <img src="/icons/NE_Logos_Logomark_Prp.svg" alt="NourishED" className="h-11 w-11 rounded-lg shadow-floating" />
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
                  <span>Add a Location</span>
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-brand-500 text-white">
                    <PlusIcon />
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => handleNavigate("map")}
                className={`w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800 whitespace-nowrap ${active === "map" ? "bg-brand-50 dark:bg-slate-800" : ""}`}
                aria-current={active === "map" ? "page" : undefined}
              >
                Map
              </button>
              {ENABLE_REPORT_MENU && showReportLink && (
                <button
                  type="button"
                  onClick={() => handleNavigate("report")}
                  className={`w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800 ${active === "report" ? "bg-brand-50 dark:bg-slate-800" : ""}`}
                  aria-current={active === "report" ? "page" : undefined}
                >
                  Report
                </button>
              )}
              {showAdminLink && (
                <button
                  type="button"
                  onClick={() => handleNavigate("admin")}
                  className={`w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800 ${active === "admin" ? "bg-brand-50 dark:bg-slate-800" : ""}`}
                  aria-current={active === "admin" ? "page" : undefined}
                >
                  Admin
                </button>
              )}
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
                  className={`flex w-full items-center justify-between rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800 ${active === "queue" ? "bg-brand-50 dark:bg-slate-800" : ""}`}
                  aria-current={active === "queue" ? "page" : undefined}
                >
                  <span>Queue</span>
                  {showQueueBadge ? (
                    <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-fuchsia-500 px-1.5 text-xs font-semibold leading-tight text-white">
                      {queueBadgeLabel}
                    </span>
                  ) : null}
                </button>
              )}
              {showRoadmapLink && (
                <button
                  type="button"
                  onClick={() => handleNavigate("roadmap")}
                  className={`w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800 whitespace-nowrap ${active === "roadmap" ? "bg-brand-50 dark:bg-slate-800" : ""}`}
                  aria-current={active === "roadmap" ? "page" : undefined}
                >
                  Roadmap
                </button>
              )}
              <a
                href="https://www.neighborhoodexplorer.org/statistics/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800 whitespace-nowrap"
                onClick={() => trackNavItem("All Stats", "external")}
              >
                All Stats
              </a>
              <a
                href="https://www.neighborhoodexplorer.org/organizations/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800"
                onClick={() => trackNavItem("Orgs", "external")}
              >
                Orgs
              </a>
              <a
                href="https://www.neighborhoodexplorer.org/community-goals/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800"
                onClick={() => trackNavItem("Goals", "external")}
              >
                Goals
              </a>
              <a
                href="https://www.neighborhoodexplorer.org/research-questions/"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800"
                onClick={() => trackNavItem("Research", "external")}
              >
                Research
              </a>
              <a
                href="https://www.9bcorp.com"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full rounded-2xl border border-slate-200 px-5 py-4 text-left text-lg font-semibold text-slate-800 transition hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700 dark:text-slate-100 dark:hover:border-slate-500 dark:hover:bg-slate-800"
                onClick={() => trackNavItem("About", "external")}
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
