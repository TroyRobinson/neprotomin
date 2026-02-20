import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { track } from "@vercel/analytics";
import {
  Bars3Icon,
  BuildingOfficeIcon,
  ChartBarIcon,
  MagnifyingGlassIcon,
  MapIcon,
  MapPinIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { DemographicsBar } from "./DemographicsBar";
import { StatList } from "./StatList";
import { IssueReportModal } from "./IssueReportModal";
import type { Organization, OrganizationHours } from "../../types/organization";
import type { Stat, StatRelationsByParent, StatRelationsByChild } from "../../types/stat";
import { useCategories } from "../hooks/useCategories";
import { useSidebarSearch, type SidebarSearchResult } from "../hooks/useSidebarSearch";
import type { CombinedDemographicsSnapshot } from "../hooks/useDemographics";
import type { SeriesByKind, StatBoundaryEntry } from "../hooks/useStats";
import type { AreaId } from "../../types/areas";
import type { TimeSelection } from "../lib/timeFilters";
import { formatTimeSelection } from "../lib/timeFilters";
import { db } from "../../lib/reactDb";

// ============================================================================
// Enable Features
// ============================================================================
const ENABLE_DEMOGRAPHICS_SECTION = true;
const CATEGORY_FILTER_LABEL_MAX_CHARS = 6;
const LINE_COLORS_ZIP = ["#3a519d", "#784578", "#1e98ac"];
const LINE_COLORS_COUNTY = ["#3a519d", "#784578", "#1e98ac"];
const MAX_LINE_AREA_SERIES = 6;

const abbreviateCategoryFilterLabel = (label: string): string => {
  const trimmed = label.trim();
  if (trimmed.length <= CATEGORY_FILTER_LABEL_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, CATEGORY_FILTER_LABEL_MAX_CHARS - 2)}..`;
};

type SupportedAreaKind = "ZIP" | "COUNTY";
type SelectedAreasMap = Partial<Record<SupportedAreaKind, string[]>>;
type PinnedAreasMap = Partial<Record<SupportedAreaKind, string[]>>;
type StatSummaryEntry = {
  type: string;
  date: string;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
};

interface SidebarProps {
  // Organization data
  organizations?: {
    inSelection: Organization[];
    all: Organization[];
    recent?: Organization[];
    totalSourceCount?: number;
    visibleInViewport?: number;
    visibleCountByCounty?: Map<string, number>;
  };
  // Full org list for search indexing (not viewport-limited)
  searchOrganizations?: Organization[];
  activeOrganizationId?: string | null;
  highlightedOrganizationIds?: string[] | null;
  demographicsSnapshot?: CombinedDemographicsSnapshot | null;
  statsById?: Map<string, Stat>;
  statSummariesById?: Map<string, Partial<Record<SupportedAreaKind, StatSummaryEntry>>>;
  seriesByStatIdByKind?: Map<string, SeriesByKind>;
  statDataById?: Map<string, Partial<Record<SupportedAreaKind, StatBoundaryEntry>>>;
  statRelationsByParent?: StatRelationsByParent;
  statRelationsByChild?: StatRelationsByChild;
  selectedAreas?: SelectedAreasMap;
  pinnedAreas?: PinnedAreasMap;
  activeAreaKind?: SupportedAreaKind | null;
  areaNameLookup?: (kind: SupportedAreaKind, code: string) => string;
  // Indicates that selection is from direct org clicks (vs area-based)
  directOrgSelectionActive?: boolean;
  // Selected org IDs from direct clicks (used to detect selection changes)
  selectedOrgIds?: string[];
  // Whether the current direct org selection originated from the map
  selectedOrgIdsFromMap?: boolean;
  zipScopeDisplayName?: string | null;
  countyScopeDisplayName?: string | null;
  /** Returns { code, name } for a ZIP's parent county, or null if unknown */
  getZipParentCounty?: (zipCode: string) => { code: string; name: string } | null;
  viewportCountyOrgCount?: number | null;
  viewportCountyVisibleCount?: number | null;
  /** County FIPS code for the current ZIP scope (used for zoom-to-county) */
  zipScopeCountyCode?: string | null;
  selectedStatId?: string | null;
  secondaryStatId?: string | null;
  selectedStatLoading?: boolean;
  categoryFilter?: string | null;
  hoveredArea?: AreaId | null;
  onHover?: (idOrIds: string | string[] | null) => void;
  onOrganizationClick?: (organizationId: string) => void;
  onZoomOutAll?: () => void;
  onZoomToCounty?: (countyCode: string) => void;
  onRequestCollapseSheet?: () => void;
  onLocationSearch?: (query: string) => void;
  onCategoryClick?: (categoryId: string) => void;
  onCategoryChange?: (categoryId: string | null) => void;
  onHoverArea?: (area: AreaId | null) => void;
  onStatSelect?: (statId: string | null, meta?: { shiftKey?: boolean; clear?: boolean }) => void;
  onRetryStatData?: (statId: string) => void;
  onExport?: () => void;
  onOrgPinsVisibleChange?: (visible: boolean) => void;
  initialOrgPinsVisible?: boolean;
  onClearAreas?: () => void;
  onRemoveArea?: (area: { kind: SupportedAreaKind; id: string }) => void;
  onAddAreas?: (kind: SupportedAreaKind, ids: string[]) => void;
  variant?: "desktop" | "mobile";
  showInsights?: boolean;
  showAdvanced?: boolean;
  onAdvancedToggle?: (show: boolean) => void;
  /** Visibility + expansion state for Insights sections (persisted in URL). */
  insightsState?: {
    demographicsVisible: boolean;
    demographicsExpanded: boolean;
    statVizVisible: boolean;
    statVizCollapsed: boolean;
  };
  /** Update Insights section state (persisted in URL). */
  onInsightsStateChange?: (
    next: Partial<{
      demographicsVisible: boolean;
      demographicsExpanded: boolean;
      statVizVisible: boolean;
      statVizCollapsed: boolean;
    }>,
  ) => void;
  className?: string;
  // When incremented, force switch to Statistics tab and hide orgs toggle
  forceHideOrgsNonce?: number;
  // When incremented, force switch to Orgs tab and show orgs toggle
  forceShowOrgsNonce?: number;
  // Time selection for filtering organizations by availability
  timeSelection?: TimeSelection | null;
  // Callback to clear the time filter
  onClearTimeFilter?: () => void;
  // Callback to change the time filter (open time selector)
  onChangeTimeFilter?: () => void;
  // Current camera state for zoom level detection
  cameraState?: { center: [number, number]; zoom: number } | null;
  // Callback to zoom to a specific organization
  onZoomToOrg?: (organizationId: string) => void;
  selectionLabelOverride?: string | null;
  selectionStyleVariant?: "default" | "searchResults";
  // Initial tab state (from URL)
  initialTab?: "orgs" | "stats";
  // Callback when tab changes (to update URL)
  onTabChange?: (tab: "orgs" | "stats") => void;
  // Whether the sidebar is currently collapsed (content hidden, search bar persists)
  collapsed?: boolean;
  // Collapse sidebar callback
  onCollapse?: (collapsed: boolean) => void;
}

type TabType = "stats" | "orgs";

const areaKey = (kind: SupportedAreaKind, id: string): string => `${kind}:${id}`;

export const Sidebar = ({
  organizations = { inSelection: [], all: [], totalSourceCount: 0 },
  searchOrganizations = [],
  highlightedOrganizationIds = null,
  demographicsSnapshot = null,
  statsById = new Map(),
  statSummariesById = new Map(),
  seriesByStatIdByKind = new Map(),
  statDataById = new Map(),
  statRelationsByParent = new Map(),
  statRelationsByChild = new Map(),
  selectedAreas = {},
  pinnedAreas = {},
  activeAreaKind = null,
  areaNameLookup,
  directOrgSelectionActive = false,
  selectedOrgIds = [],
  selectedOrgIdsFromMap = false,
  zipScopeDisplayName = null,
  countyScopeDisplayName = null,
  getZipParentCounty,
  viewportCountyOrgCount = null,
  viewportCountyVisibleCount = null,
  zipScopeCountyCode = null,
  selectedStatId = null,
  secondaryStatId = null,
  selectedStatLoading = false,
  categoryFilter = null,
  hoveredArea = null,
  onHover,
  onOrganizationClick,
  onZoomOutAll,
  onZoomToCounty,
  onRequestCollapseSheet,
  onLocationSearch,
  onCategoryClick,
  onCategoryChange,
  onHoverArea,
  onStatSelect,
  onRetryStatData,
  onExport,
  onOrgPinsVisibleChange,
  initialOrgPinsVisible = true,
  onClearAreas,
  onRemoveArea,
  onAddAreas,
  variant = "desktop",
  showInsights = true,
  showAdvanced = false,
  onAdvancedToggle,
  insightsState,
  onInsightsStateChange,
  className = "",
  forceHideOrgsNonce,
  forceShowOrgsNonce,
  timeSelection,
  onClearTimeFilter,
  onChangeTimeFilter,
  cameraState,
  onZoomToOrg,
  selectionLabelOverride = null,
  selectionStyleVariant = "default",
  collapsed = false,
  initialTab = "orgs",
  onTabChange,
  onCollapse,
}: SidebarProps) => {
  // Fetch categories from InstantDB
  const { sidebarCategories, getCategoryLabel } = useCategories();

  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [keepOrgsOnMap, setKeepOrgsOnMap] = useState(initialOrgPinsVisible);
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [searchPinnedOrgId, setSearchPinnedOrgId] = useState<string | null>(null);
  const [issueModalOrg, setIssueModalOrg] = useState<Organization | null>(null);
  const [issueFeedback, setIssueFeedback] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const [highlightedSearchIndex, setHighlightedSearchIndex] = useState(-1);
  const sidebarRef = useRef<HTMLElement>(null);
  const lastSidebarPointerDownRef = useRef(false);
  const desktopSearchInputRef = useRef<HTMLInputElement>(null);
  const selectAllSearchTextOnNextFocusRef = useRef(false);
  const hasAppliedInitialSearchFocusRef = useRef(false);
  const [isOrgsScrollAtTop, setIsOrgsScrollAtTop] = useState(true);
  const [isStatsScrollAtTop, setIsStatsScrollAtTop] = useState(true);
  const orgsScrollRef = useRef<HTMLDivElement>(null);
  const searchDropdownTimeoutRef = useRef<number | null>(null);
  const orgSearchScrollTimeoutRef = useRef<number | null>(null);
  const searchPinnedClearTimeoutRef = useRef<number | null>(null);
  const hasAppliedInitialSelectionPinRef = useRef(false);
  const lastMapExpandedOrgRef = useRef<string | null>(null);
  const directSelectionStateRef = useRef<{ active: boolean; selectionKey: string | null }>({
    active: false,
    selectionKey: null,
  });
  const lastNonMapSelectionKeyRef = useRef<string | null>(null);
  const setActiveTabWithSync = useCallback(
    (tab: TabType) => {
      setActiveTab(tab);
      onTabChange?.(tab);
    },
    [onTabChange],
  );
  const scrollOrgIntoView = useCallback((orgId: string, options?: { alignTop?: boolean; padding?: number }) => {
    const container = orgsScrollRef.current;
    if (!container) return;
    const safeOrgId =
      typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(orgId) : orgId;
    const target = container.querySelector<HTMLElement>(`[data-org-id="${safeOrgId}"]`);
    if (!target) return;

    const padding = typeof options?.padding === "number" ? options.padding : 12;
    const containerRect = container.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();

    if (options?.alignTop) {
      const offset = targetRect.top - containerRect.top - padding;
      container.scrollTo({
        top: container.scrollTop + offset,
        behavior: "smooth",
      });
      return;
    }

    if (targetRect.top < containerRect.top + padding) {
      const offset = targetRect.top - containerRect.top - padding;
      container.scrollTo({
        top: container.scrollTop + offset,
        behavior: "smooth",
      });
    } else if (targetRect.bottom > containerRect.bottom - padding) {
      const offset = targetRect.bottom - containerRect.bottom + padding;
      container.scrollTo({
        top: container.scrollTop + offset,
        behavior: "smooth",
      });
    }
  }, []);
  const { user } = db.useAuth();
  const canShowInsights = Boolean(showInsights && showAdvanced);

  const demographicsVisible = insightsState?.demographicsVisible ?? true;
  const demographicsExpanded = insightsState?.demographicsExpanded ?? false;

  const shouldShowDemographicsBar = ENABLE_DEMOGRAPHICS_SECTION && canShowInsights && demographicsVisible;

  const handleOrgsScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const atTop = event.currentTarget.scrollTop <= 2;
    setIsOrgsScrollAtTop((prev) => (prev === atTop ? prev : atTop));
  }, []);
  const handleStatsScrollTopChange = useCallback((atTop: boolean) => {
    setIsStatsScrollAtTop((prev) => (prev === atTop ? prev : atTop));
  }, []);

  // When a category is cleared from the sidebar, also clear any active stat selection
  // so the choropleth overlay matches the category chips behavior on the map.
  const handleCategoryChange = useCallback(
    (categoryId: string | null) => {
      onCategoryChange?.(categoryId);
      if (categoryId === null) {
        onStatSelect?.(null, { clear: true });
      }
    },
    [onCategoryChange, onStatSelect],
  );

  const handleOpenIssueModal = useCallback((org: Organization) => {
    setIssueModalOrg(org);
    setIssueFeedback(null);
  }, []);

  const handleCloseIssueModal = useCallback(() => {
    setIssueModalOrg(null);
  }, []);

  const handleSubmitIssue = useCallback(
    async (details: string) => {
      if (!issueModalOrg) {
        throw new Error("No organization selected");
      }

      const payload = {
        orgId: issueModalOrg.id,
        orgName: issueModalOrg.name,
        text: details,
        source: "Issue Button",
        reporterId: user?.id ?? null,
        reporterEmail: typeof user?.email === "string" ? user.email : null,
        pageUrl: typeof window !== "undefined" ? window.location.href : null,
        locale: typeof navigator !== "undefined" ? navigator.language : null,
      };

      const response = await fetch("/api/report-issue", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      let data: any = null;
      try {
        data = await response.json();
      } catch {
        // ignored
      }

      if (!response.ok) {
        const message = typeof data?.error === "string" ? data.error : "Failed to submit issue report.";
        throw new Error(message);
      }

      setIssueFeedback("Thanks for flagging this location. We'll review it shortly.");
    },
    [issueModalOrg, user],
  );

  const highlightedIds = new Set(highlightedOrganizationIds ?? []);
  const selectedOrgIdsSet = new Set(selectedOrgIds);
  const primarySelectedOrgId = selectedOrgIds.length > 0 ? selectedOrgIds[0] : null;
  
  // Helper to determine if zoom button should be shown for an org
  // Show zoom button when org is selected, but hide if already at max zoom
  const shouldShowZoomButton = useCallback((orgId: string) => {
    if (!selectedOrgIdsSet.has(orgId)) return false;
    
    // Check if already at maximum zoom level
    if (!cameraState) return true; // Show if we don't know the zoom level
    
    const currentZoom = cameraState.zoom;
    const maxZoom = variant === "mobile" ? 14.5 : 13.5;
    
    // Hide button if we're already at or very close to max zoom (within 0.1)
    // This accounts for floating point precision and ensures the button disappears
    // when further zooming isn't possible
    return currentZoom < maxZoom - 0.1;
  }, [selectedOrgIdsSet, cameraState, variant]);

  const selectedZips = selectedAreas?.ZIP ?? [];
  const selectedCounties = selectedAreas?.COUNTY ?? [];
  const totalSelectedCount = selectedZips.length + selectedCounties.length;
  const selectedAreaEntriesForStatViz = useMemo(
    () => [
      ...selectedZips.map((id) => ({ kind: "ZIP" as const, id, key: areaKey("ZIP", id) })),
      ...selectedCounties.map((id) => ({ kind: "COUNTY" as const, id, key: areaKey("COUNTY", id) })),
    ],
    [selectedCounties, selectedZips],
  );
  const activeStatVizStatId = useMemo(() => {
    if (selectedStatId) return selectedStatId;
    for (const stat of statsById.values()) {
      if (stat.name.toLowerCase() === "population") return stat.id;
    }
    return null;
  }, [selectedStatId, statsById]);
  const hasMultiYearSeriesForActiveStat = useMemo(() => {
    if (!activeStatVizStatId) return false;
    const byKind = seriesByStatIdByKind.get(activeStatVizStatId);
    if (!byKind || byKind.size === 0) return false;
    for (const entries of byKind.values()) {
      if (!entries || entries.length === 0) continue;
      const uniqueDates = new Set<string>();
      for (const entry of entries) {
        if (!entry?.date) continue;
        uniqueDates.add(entry.date);
        if (uniqueDates.size > 1) return true;
      }
    }
    return false;
  }, [activeStatVizStatId, seriesByStatIdByKind]);
  const isStatVizLineModeVisible = useMemo(
    () =>
      Boolean(
        showAdvanced &&
          selectedStatId &&
          selectedAreaEntriesForStatViz.length > 0 &&
          selectedAreaEntriesForStatViz.length < 4 &&
          hasMultiYearSeriesForActiveStat,
      ),
    [
      hasMultiYearSeriesForActiveStat,
      selectedAreaEntriesForStatViz.length,
      selectedStatId,
      showAdvanced,
    ],
  );
  const statVizLineColorByAreaKey = useMemo(() => {
    if (!isStatVizLineModeVisible) return null;
    const map = new Map<string, string>();
    selectedAreaEntriesForStatViz.slice(0, MAX_LINE_AREA_SERIES).forEach((entry, index) => {
      const palette = entry.kind === "ZIP" ? LINE_COLORS_ZIP : LINE_COLORS_COUNTY;
      map.set(entry.key, palette[index % palette.length]);
    });
    return map;
  }, [isStatVizLineModeVisible, selectedAreaEntriesForStatViz]);

  const {
    inSelection: rawInSelection = [],
    all: rawAll = [],
    recent: rawRecent = [],
    totalSourceCount = 0,
    visibleInViewport,
  } = organizations ?? { inSelection: [], all: [], recent: [], totalSourceCount: 0 };

  // Filter organizations by category when a category filter is active
  const inSelection = useMemo(() => {
    if (!categoryFilter) return rawInSelection;
    return rawInSelection.filter((org) => org.category === categoryFilter);
  }, [rawInSelection, categoryFilter]);

  const all = useMemo(() => {
    if (!categoryFilter) return rawAll;
    return rawAll.filter((org) => org.category === categoryFilter);
  }, [rawAll, categoryFilter]);

  const recent = useMemo(() => {
    if (!categoryFilter) return rawRecent;
    return rawRecent.filter((org) => org.category === categoryFilter);
  }, [rawRecent, categoryFilter]);
  // Keep a searched org visibly pinned at the top while it remains selected.
  const searchPinnedOrg = useMemo(() => {
    if (!searchPinnedOrgId) return null;
    // Prefer the full search source so a sidebar-selected org pins immediately
    // even when viewport-filtered sidebar buckets haven't refreshed yet.
    const searchSource = searchOrganizations.length > 0 ? searchOrganizations : rawAll;
    const directMatch = searchSource.find((org) => org.id === searchPinnedOrgId);
    if (directMatch) return directMatch;
    const candidates = [inSelection, all, recent, rawInSelection, rawAll, rawRecent];
    for (const list of candidates) {
      const match = list.find((org) => org.id === searchPinnedOrgId);
      if (match) return match;
    }
    return null;
  }, [all, inSelection, rawAll, rawInSelection, rawRecent, recent, searchOrganizations, searchPinnedOrgId]);
  const pinnedOrgIdSet = useMemo(
    () => new Set(searchPinnedOrg ? [searchPinnedOrg.id] : []),
    [searchPinnedOrg],
  );
  const visibleInSelection = useMemo(
    () => inSelection.filter((org) => !pinnedOrgIdSet.has(org.id)),
    [inSelection, pinnedOrgIdSet],
  );
  const visibleAll = useMemo(
    () => all.filter((org) => !pinnedOrgIdSet.has(org.id)),
    [all, pinnedOrgIdSet],
  );
  const visibleRecent = useMemo(
    () => recent.filter((org) => !pinnedOrgIdSet.has(org.id)),
    [recent, pinnedOrgIdSet],
  );
  const searchPinnedAll = useMemo(() => {
    const byId = new Map<string, Organization>();
    for (const org of visibleInSelection) byId.set(org.id, org);
    for (const org of visibleRecent) byId.set(org.id, org);
    for (const org of visibleAll) byId.set(org.id, org);
    return Array.from(byId.values());
  }, [visibleAll, visibleInSelection, visibleRecent]);
  const hasSearchPinnedSection = Boolean(searchPinnedOrg);
  const allSectionOrgs = hasSearchPinnedSection ? searchPinnedAll : visibleAll;
  const showSelectedSection = Boolean(searchPinnedOrg);
  const showRecentSection = !hasSearchPinnedSection && visibleRecent.length > 0;
  const showInSelectionSection = !hasSearchPinnedSection && visibleInSelection.length > 0;
  const showAllSectionHeading =
    (hasSearchPinnedSection && allSectionOrgs.length > 0) ||
    (!hasSearchPinnedSection &&
      (totalSelectedCount > 0 ||
        (directOrgSelectionActive && allSectionOrgs.length > 0) ||
        (visibleRecent.length > 0 && allSectionOrgs.length > 0)));
  const searchResults = useSidebarSearch({
    query: searchText,
    organizations: searchOrganizations.length > 0 ? searchOrganizations : rawAll,
    statsById,
  });
  const searchSourceOrganizations = searchOrganizations.length > 0 ? searchOrganizations : rawAll;
  const searchOrgCategoryById = useMemo(() => {
    const map = new Map<string, Organization["category"]>();
    for (const org of searchSourceOrganizations) {
      if (!org?.id) continue;
      map.set(org.id, org.category);
    }
    return map;
  }, [searchSourceOrganizations]);
  const hasSearchText = searchText.trim().length >= 2;
  const showSearchDropdown =
    variant === "desktop" && isSearchDropdownOpen && hasSearchText && searchResults.length > 0;
  const highlightedSearchResult =
    highlightedSearchIndex >= 0 && highlightedSearchIndex < searchResults.length
      ? searchResults[highlightedSearchIndex]
      : null;

  const clearSearchDropdownTimeout = useCallback(() => {
    if (typeof window === "undefined") return;
    if (searchDropdownTimeoutRef.current === null) return;
    window.clearTimeout(searchDropdownTimeoutRef.current);
    searchDropdownTimeoutRef.current = null;
  }, []);

  const scheduleSearchDropdownClose = useCallback(() => {
    if (typeof window === "undefined") return;
    clearSearchDropdownTimeout();
    searchDropdownTimeoutRef.current = window.setTimeout(() => {
      setIsSearchDropdownOpen(false);
      searchDropdownTimeoutRef.current = null;
    }, 120);
  }, [clearSearchDropdownTimeout]);

  const clearOrgSearchScrollTimeout = useCallback(() => {
    if (typeof window === "undefined") return;
    if (orgSearchScrollTimeoutRef.current === null) return;
    window.clearTimeout(orgSearchScrollTimeoutRef.current);
    orgSearchScrollTimeoutRef.current = null;
  }, []);

  const clearSearchPinnedClearTimeout = useCallback(() => {
    if (typeof window === "undefined") return;
    if (searchPinnedClearTimeoutRef.current === null) return;
    window.clearTimeout(searchPinnedClearTimeoutRef.current);
    searchPinnedClearTimeoutRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      clearSearchDropdownTimeout();
      clearOrgSearchScrollTimeout();
      clearSearchPinnedClearTimeout();
    };
  }, [clearSearchDropdownTimeout, clearOrgSearchScrollTimeout, clearSearchPinnedClearTimeout]);

  useEffect(() => {
    if (!hasSearchText) {
      setIsSearchDropdownOpen(false);
    }
  }, [hasSearchText]);

  useEffect(() => {
    if (variant !== "desktop") return;
    if (typeof window === "undefined") return;
    if (hasAppliedInitialSearchFocusRef.current) return;

    let attempts = 0;
    let rafId = 0;
    let timeoutId: number | null = null;
    const maxAttempts = 8;

    // Retry briefly because map/layout initialization can steal focus on mount.
    const tryFocus = () => {
      const input = desktopSearchInputRef.current;
      if (!input) return;

      const active = document.activeElement as HTMLElement | null;
      const isTypingTarget =
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        Boolean(active?.isContentEditable);
      if (isTypingTarget && active !== input) {
        hasAppliedInitialSearchFocusRef.current = true;
        return;
      }

      input.focus({ preventScroll: true });
      if (document.activeElement === input) {
        hasAppliedInitialSearchFocusRef.current = true;
        return;
      }

      if (attempts >= maxAttempts) {
        hasAppliedInitialSearchFocusRef.current = true;
        return;
      }
      attempts += 1;
      timeoutId = window.setTimeout(() => {
        rafId = window.requestAnimationFrame(tryFocus);
      }, 80);
    };

    timeoutId = window.setTimeout(() => {
      rafId = window.requestAnimationFrame(tryFocus);
    }, 120);

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [variant]);

  useEffect(() => {
    if (!showSearchDropdown) {
      setHighlightedSearchIndex(-1);
      return;
    }
    setHighlightedSearchIndex((current) => {
      if (current < searchResults.length) return current;
      return searchResults.length - 1;
    });
  }, [showSearchDropdown, searchResults.length]);

  useEffect(() => {
    if (variant !== "desktop" || collapsed || !onCollapse) return;
    const handlePointerDown = (event: PointerEvent) => {
      const sidebarEl = sidebarRef.current;
      const target = event.target;
      if (!sidebarEl || !(target instanceof Node)) {
        lastSidebarPointerDownRef.current = false;
        return;
      }
      lastSidebarPointerDownRef.current = sidebarEl.contains(target);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const sidebarEl = sidebarRef.current;
      const target = event.target;
      const activeElement = document.activeElement;
      const eventFromSidebar = Boolean(sidebarEl && target instanceof Node && sidebarEl.contains(target));
      const focusInSidebar =
        Boolean(sidebarEl && activeElement instanceof Node && sidebarEl.contains(activeElement));
      const eventFromMap = Boolean(
        (target instanceof Element &&
          target.closest(".maplibregl-canvas, .maplibregl-canvas-container, .maplibregl-map")) ||
          (activeElement instanceof Element &&
            activeElement.closest(".maplibregl-canvas, .maplibregl-canvas-container, .maplibregl-map")),
      );
      if (!eventFromSidebar && !focusInSidebar && !lastSidebarPointerDownRef.current && !eventFromMap) return;
      onCollapse(true);
      lastSidebarPointerDownRef.current = false;
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [collapsed, onCollapse, variant]);

  const handleSearchResultSelect = useCallback(
    (result: SidebarSearchResult) => {
      // Auto-expand sidebar when selecting a search result while collapsed
      if (collapsed) onCollapse?.(false);
      if (categoryFilter) {
        const resultCategory =
          result.type === "org"
            ? searchOrgCategoryById.get(result.id) ?? null
            : result.type === "stat"
            ? statsById.get(result.id)?.category ?? null
            : null;
        if (resultCategory && resultCategory !== categoryFilter) {
          // Search can return cross-category matches, so clear active category when selecting one.
          onCategoryChange?.(null);
        }
      }
      if (result.type === "org") {
        setActiveTabWithSync("orgs");
        onOrganizationClick?.(result.id);
        setExpandedOrgId(result.id);
        setSearchPinnedOrgId(result.id);
        if (typeof window !== "undefined") {
          clearOrgSearchScrollTimeout();
          // Wait for tab/content updates, then show the section header and selected card.
          orgSearchScrollTimeoutRef.current = window.setTimeout(() => {
            orgsScrollRef.current?.scrollTo({
              top: 0,
              behavior: "smooth",
            });
            orgSearchScrollTimeoutRef.current = null;
          }, 120);
        }
      } else if (result.type === "stat") {
        setActiveTabWithSync("stats");
        onStatSelect?.(result.id, {});
      } else {
        onLocationSearch?.(result.id);
      }
      setSearchText(result.label);
      selectAllSearchTextOnNextFocusRef.current = true;
      setIsSearchDropdownOpen(false);
      setHighlightedSearchIndex(-1);
    },
    [
      clearOrgSearchScrollTimeout,
      collapsed,
      onCollapse,
      categoryFilter,
      onCategoryChange,
      onLocationSearch,
      onOrganizationClick,
      onStatSelect,
      searchOrgCategoryById,
      setActiveTabWithSync,
      statsById,
    ],
  );

  useEffect(() => {
    if (!searchPinnedOrgId) return;
    if (selectedOrgIds.includes(searchPinnedOrgId)) {
      clearSearchPinnedClearTimeout();
      return;
    }
    if (typeof window === "undefined") {
      setSearchPinnedOrgId(null);
      return;
    }
    const pendingPinnedOrgId = searchPinnedOrgId;
    clearSearchPinnedClearTimeout();
    // Let parent selection state settle before clearing; search selections update through callbacks.
    searchPinnedClearTimeoutRef.current = window.setTimeout(() => {
      setSearchPinnedOrgId((current) => (current === pendingPinnedOrgId ? null : current));
      searchPinnedClearTimeoutRef.current = null;
    }, 120);
  }, [clearSearchPinnedClearTimeout, searchPinnedOrgId, selectedOrgIds]);

  // Only apply auto-pin once on first load so sidebar clicks continue to select in-place.
  useEffect(() => {
    if (hasAppliedInitialSelectionPinRef.current) return;
    hasAppliedInitialSelectionPinRef.current = true;
    if (selectedOrgIds.length !== 1) return;
    const selectedId = selectedOrgIds[0];
    if (!selectedId) return;
    setSearchPinnedOrgId(selectedId);
  }, [selectedOrgIds]);

  // Determine the "IN SELECTION" label - show area name if only one area is selected
  const inSelectionLabel = useMemo(() => {
    if (selectionLabelOverride && directOrgSelectionActive) {
      return selectionLabelOverride;
    }
    // Direct org selection mode (clicked org centroids or small clusters)
    if (directOrgSelectionActive) {
      if (inSelection.length === 1) {
        return "SELECTED";
      }
      return "IN SELECTION";
    }

    // Area-based selection mode
    if (totalSelectedCount === 1) {
      const selectedZip = selectedZips[0];
      const selectedCounty = selectedCounties[0];
      if (selectedZip && areaNameLookup) {
        const areaName = areaNameLookup("ZIP", selectedZip);
        return areaName ? `IN ${areaName}` : `IN ${selectedZip}`;
      }
      if (selectedCounty && areaNameLookup) {
        const areaName = areaNameLookup("COUNTY", selectedCounty);
        return areaName ? `IN ${areaName}` : `IN ${selectedCounty}`;
      }
      // Fallback to code if no lookup function available
      if (selectedZip) {
        return `IN ${selectedZip}`;
      }
      if (selectedCounty) {
        return `IN ${selectedCounty}`;
      }
    }
    return "IN SELECTION";
  }, [directOrgSelectionActive, inSelection.length, totalSelectedCount, selectedZips, selectedCounties, areaNameLookup]);

  const visibleCount =
    typeof visibleInViewport === "number" ? visibleInViewport : inSelection.length + all.length;
  // When a category filter is active, the actual filtered count may differ from visibleCount
  const categoryFilteredCount = categoryFilter
    ? inSelection.length + all.length + recent.length
    : visibleCount;
  const hasActiveTimeFilter = Boolean(timeSelection);
  const renderTimeFilterBanner = () => (
    <div
      className={`mx-4 mt-3 rounded-lg px-3 py-2 ${
        hasActiveTimeFilter
          ? "border border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-900/20"
          : "bg-slate-100/40 dark:bg-slate-800/20"
      }`}
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onChangeTimeFilter}
          disabled={!onChangeTimeFilter}
          className={`-mx-2 -my-1 flex flex-1 items-center gap-2 rounded-md px-2 py-1 text-left disabled:cursor-default ${
            hasActiveTimeFilter
              ? "hover:bg-brand-100 dark:hover:bg-brand-800/50 disabled:hover:bg-transparent"
              : "hover:bg-slate-200 dark:hover:bg-slate-700/70 disabled:hover:bg-transparent"
          }`}
          title={hasActiveTimeFilter ? "Change time filter" : "Filter by hours of operation"}
        >
          <svg
            className={`h-4 w-4 ${
              hasActiveTimeFilter ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"
            }`}
            viewBox="0 0 24 24"
            fill="none"
          >
            <path
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span
            className={`text-sm font-medium ${
              hasActiveTimeFilter ? "text-brand-900 dark:text-brand-100" : "text-slate-500 dark:text-slate-400"
            }`}
          >
            {hasActiveTimeFilter
              ? `Only orgs open at ${formatTimeSelection(timeSelection ?? null)}`
              : "Filter by hours of operation"}
          </span>
        </button>
        {hasActiveTimeFilter && onClearTimeFilter ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClearTimeFilter();
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md text-brand-600 hover:bg-brand-200 hover:text-brand-800 dark:text-brand-400 dark:hover:bg-brand-800 dark:hover:text-brand-200"
            title="Clear time filter"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none">
              <path
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
  useEffect(() => {
    if (activeTab !== "orgs") return;
    const node = orgsScrollRef.current;
    if (!node) return;
    const atTop = node.scrollTop <= 2;
    setIsOrgsScrollAtTop((prev) => (prev === atTop ? prev : atTop));
  }, [
    activeTab,
    categoryFilteredCount,
    showSelectedSection,
    showRecentSection,
    showInSelectionSection,
    allSectionOrgs.length,
    visibleInSelection.length,
    visibleRecent.length,
  ]);
  const baseTotalCount = typeof totalSourceCount === "number" ? totalSourceCount : visibleCount;
  // If area selection yields no direct matches, keep showing viewport count
  // so the ORGS tab label doesn't get stuck at 0 while results still exist in "ALL".
  const countForTab =
    totalSelectedCount > 0 && inSelection.length > 0 ? inSelection.length : visibleCount;
  const countyVisibleCount =
    typeof viewportCountyVisibleCount === "number" ? viewportCountyVisibleCount : visibleCount;
  const countyZoomContext = useMemo(() => {
    if (!cameraState) return null;
    if (!zipScopeDisplayName) return null;
    if (typeof viewportCountyOrgCount !== "number" || viewportCountyOrgCount <= 0) return null;
    const hiddenCount = Math.max(viewportCountyOrgCount - countyVisibleCount, 0);
    if (hiddenCount <= 0) return null;
    // Use zipScopeDisplayName for both label and as identifier (already title-cased from scope)
    const label = `${zipScopeDisplayName} County`;
    return {
      countyLabel: label,
      totalCount: viewportCountyOrgCount,
      hiddenCount,
    };
  }, [
    cameraState,
    zipScopeDisplayName,
    viewportCountyOrgCount,
    countyVisibleCount,
  ]);
  const totalCount = countyZoomContext?.totalCount ?? baseTotalCount;
  const missingCount = countyZoomContext?.hiddenCount ?? Math.max(totalCount - visibleCount, 0);
  const hideCategoryTags = Boolean(categoryFilter);
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);
  // Close category dropdown when clicking outside
  useEffect(() => {
    if (!categoryDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) {
        setCategoryDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [categoryDropdownOpen]);

  // Jump to the list top whenever the map triggers a direct org selection.
  useEffect(() => {
    const container = orgsScrollRef.current;
    if (!container) return;

    const selectionKey = directOrgSelectionActive ? selectedOrgIds.join("|") : null;
    const prev = directSelectionStateRef.current;
    const shouldScroll =
      directOrgSelectionActive && (!prev.active || prev.selectionKey !== selectionKey);

    directSelectionStateRef.current = {
      active: directOrgSelectionActive,
      selectionKey,
    };

    if (!shouldScroll) return;

    container.scrollTo({
      top: 0,
      behavior: variant === "mobile" ? "auto" : "smooth",
    });
  }, [directOrgSelectionActive, selectedOrgIds, variant]);

  useEffect(() => {
    if (!expandedOrgId) return;
    if (activeTab !== "orgs") return;
    scrollOrgIntoView(expandedOrgId, { padding: 24 });
  }, [activeTab, expandedOrgId, scrollOrgIntoView]);

  useEffect(() => {
    if (variant !== "mobile") return;
    if (!selectedOrgIdsFromMap) return;
    if (selectedOrgIds.length !== 1) return;

    const targetId = primarySelectedOrgId;
    if (!targetId) return;
    if (lastMapExpandedOrgRef.current === targetId && expandedOrgId === targetId) {
      return;
    }

    const targetOrg =
      inSelection.find((org) => org.id === targetId) ??
      all.find((org) => org.id === targetId) ??
      recent.find((org) => org.id === targetId) ??
      null;
    if (!targetOrg) return;
    if (formatHoursLines(targetOrg.hours).length === 0) return;

    lastMapExpandedOrgRef.current = targetId;
    setExpandedOrgId(targetId);
  }, [
    all,
    expandedOrgId,
    inSelection,
    recent,
    selectedOrgIds,
    primarySelectedOrgId,
    selectedOrgIdsFromMap,
    variant,
  ]);

  useEffect(() => {
    if (selectedOrgIds.length === 0) {
      lastNonMapSelectionKeyRef.current = null;
      return;
    }
    if (activeTab !== "orgs") return;
    if (selectedOrgIdsFromMap) return;
    if (!primarySelectedOrgId) return;

    const selectionKey = selectedOrgIds.join("|");
    if (lastNonMapSelectionKeyRef.current === selectionKey) return;
    lastNonMapSelectionKeyRef.current = selectionKey;
    scrollOrgIntoView(primarySelectedOrgId, { padding: 24 });
  }, [
    activeTab,
    primarySelectedOrgId,
    scrollOrgIntoView,
    selectedOrgIds,
    selectedOrgIdsFromMap,
  ]);

  useEffect(() => {
    const hasAnyVisibleOrgs = categoryFilteredCount > 0;
    const visible = hasAnyVisibleOrgs && keepOrgsOnMap;
    onOrgPinsVisibleChange?.(visible);
  }, [keepOrgsOnMap, onOrgPinsVisibleChange, categoryFilteredCount]);

  useEffect(() => {
    if (!issueFeedback) return;
    if (typeof window === "undefined") return;
    const timeout = window.setTimeout(() => setIssueFeedback(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [issueFeedback]);

  useEffect(() => {
    if (variant !== "desktop") {
      setSearchText("");
      setIsSearchDropdownOpen(false);
    }
  }, [variant]);

  // Respond to external force-hide requests (e.g., closing the Orgs chip on the map)
  const lastForceHideNonceRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (typeof forceHideOrgsNonce !== "number") {
      return;
    }
    if (lastForceHideNonceRef.current === forceHideOrgsNonce) {
      return;
    }
    if (lastForceHideNonceRef.current !== undefined) {
      setKeepOrgsOnMap(false);
      setActiveTabWithSync("stats");
    }
    lastForceHideNonceRef.current = forceHideOrgsNonce;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceHideOrgsNonce]);

  // Respond to external force-show requests (e.g., brand/logo reset)
  const lastForceShowNonceRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (typeof forceShowOrgsNonce !== "number") return;
    if (lastForceShowNonceRef.current === forceShowOrgsNonce) return;
    if (lastForceShowNonceRef.current !== undefined) {
      setKeepOrgsOnMap(true);
      setActiveTabWithSync("orgs");
    }
    lastForceShowNonceRef.current = forceShowOrgsNonce;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceShowOrgsNonce]);

  useEffect(() => {
    if (!onTabChange) return;
    if (activeTab === initialTab) return;
    setActiveTabWithSync(initialTab);
  }, [activeTab, initialTab, onTabChange, setActiveTabWithSync]);

  // Switch to Statistics tab when advanced mode is enabled and user is not already on stats tab
  const prevShowAdvancedRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    // Only switch if advanced mode transitions from false to true
    if (showAdvanced && prevShowAdvancedRef.current === false && activeTab !== "stats") {
      setActiveTabWithSync("stats");
    }
    prevShowAdvancedRef.current = showAdvanced;
  }, [showAdvanced, activeTab, setActiveTabWithSync]);

  const handleToggleKeepOrgs = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setKeepOrgsOnMap((prev) => !prev);
  };

  const handleToggleAdvanced = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    onAdvancedToggle?.(!showAdvanced);
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTabWithSync(tab);
  };

  const tabClasses = (isActive: boolean) =>
    `justify-center px-4 h-8 -mb-[5px] text-[11px] leading-none font-semibold uppercase tracking-wide border-b-2 inline-flex items-center gap-2 rounded-t-md rounded-b-none transition-colors ${
      isActive
        ? "border-brand-500 bg-slate-100 text-brand-700 dark:bg-slate-800 dark:text-brand-300"
        : "border-transparent text-slate-500 hover:text-brand-700 hover:bg-slate-100/70 dark:text-slate-500 dark:hover:bg-slate-800/70"
    }`;
  const selectedCategoryLabel = categoryFilter ? getCategoryLabel(categoryFilter as any) : "All Categories";
  const categoryToolbarLabel = categoryFilter
    ? abbreviateCategoryFilterLabel(selectedCategoryLabel)
    : selectedCategoryLabel;
  const countyZoomOrgNoun = `${categoryFilter ? `${selectedCategoryLabel} ` : ""}org`;
  const missingZoomCategoryText = categoryFilter ? ` ${selectedCategoryLabel}` : "";
  const shouldShowContentTopFade =
    variant === "desktop" &&
    ((activeTab === "orgs" && !isOrgsScrollAtTop) || (activeTab === "stats" && !isStatsScrollAtTop));

  const containerClassName = useMemo(() => {
    if (variant === "mobile") {
      return [
        "relative flex h-full min-h-0 w-full flex-col bg-white dark:bg-slate-900",
        className,
      ]
        .filter(Boolean)
        .join(" ");
    }
    // When collapsed, sidebar chrome (bg, border, blur) is hidden so only the search bar shows
    return [
      "relative flex h-full min-h-0 w-full max-w-sm flex-col",
      collapsed
        ? ""
        : "border-r border-slate-200 bg-white/60 backdrop-blur dark:border-slate-800 dark:bg-slate-900/60",
      className,
    ]
      .filter(Boolean)
      .join(" ");
  }, [variant, className, collapsed]);

  return (
    <>
      <aside ref={sidebarRef} className={containerClassName}>
      {issueFeedback && !collapsed ? (
        <div className="mx-4 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 shadow-sm dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
          {issueFeedback}
        </div>
      ) : null}
      {variant === "desktop" && (
        <div
          className={`relative px-4 pt-4 ${collapsed ? "pointer-events-auto" : ""}`}
          onFocus={() => {
            clearSearchDropdownTimeout();
          }}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (next && event.currentTarget.contains(next)) return;
            scheduleSearchDropdownClose();
          }}
        >
          {/* Search bar row: input + collapse button side by side */}
          <div className="flex gap-2">
          <label className="relative flex-1">
            <span className="sr-only">Search organizations, statistics, cities, or addresses</span>
            <MagnifyingGlassIcon
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500"
            />
            <input
              ref={desktopSearchInputRef}
              type="search"
              autoFocus
              value={searchText}
              onChange={(event) => {
                const next = event.target.value;
                selectAllSearchTextOnNextFocusRef.current = false;
                setSearchText(next);
                setIsSearchDropdownOpen(next.trim().length >= 2);
                setHighlightedSearchIndex(-1);
              }}
              onFocus={(event) => {
                if (selectAllSearchTextOnNextFocusRef.current && event.currentTarget.value) {
                  requestAnimationFrame(() => {
                    event.currentTarget.select();
                  });
                }
                if (hasSearchText && searchResults.length > 0) {
                  setIsSearchDropdownOpen(true);
                }
              }}
              onClick={(event) => {
                if (selectAllSearchTextOnNextFocusRef.current && event.currentTarget.value) {
                  event.currentTarget.select();
                }
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setIsSearchDropdownOpen(false);
                  setHighlightedSearchIndex(-1);
                  event.currentTarget.blur();
                  return;
                }
                if (
                  (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                  hasSearchText &&
                  searchResults.length > 0
                ) {
                  event.preventDefault();
                  setIsSearchDropdownOpen(true);
                  setHighlightedSearchIndex((current) => {
                    if (event.key === "ArrowDown") {
                      if (current < 0 || current >= searchResults.length - 1) {
                        return 0;
                      }
                      return current + 1;
                    }
                    if (current <= 0) {
                      return searchResults.length - 1;
                    }
                    return current - 1;
                  });
                  return;
                }
                if (event.key === "Enter" && showSearchDropdown) {
                  event.preventDefault();
                  handleSearchResultSelect(highlightedSearchResult ?? searchResults[0]);
                }
              }}
              placeholder="Stats, orgs, cities, zips, addresses..."
              className="search-input-brand-cancel h-8 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 placeholder:font-light placeholder:text-slate-300 shadow-sm outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-400 dark:focus:border-brand-600 dark:focus:ring-brand-900/40"
            />
          </label>
          {/* Toggle button — close (X) when expanded, open (hamburger) when collapsed */}
          <button
            type="button"
            onClick={() => onCollapse?.(!collapsed)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-300 shadow-sm transition hover:border-slate-300 hover:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-300"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <Bars3Icon className="h-4 w-4" /> : <XMarkIcon className="h-4 w-4" />}
          </button>
          </div>
          {showSearchDropdown && (
            <ul className="absolute left-4 right-4 z-50 mt-1 max-h-[12rem] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
              {searchResults.map((result, index) => {
                const Icon =
                  result.type === "org"
                    ? BuildingOfficeIcon
                    : result.type === "stat"
                    ? ChartBarIcon
                    : result.type === "city"
                    ? MapPinIcon
                    : MapIcon;
                return (
                  <li key={`${result.type}-${result.id}`}>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setHighlightedSearchIndex(index)}
                      onClick={() => handleSearchResultSelect(result)}
                      className={`flex w-full items-start gap-2 px-3 py-2 text-left transition ${
                        index === highlightedSearchIndex
                          ? "bg-brand-50 dark:bg-brand-900/30"
                          : "hover:bg-slate-100 dark:hover:bg-slate-800"
                      }`}
                    >
                      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500" />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-700 dark:text-slate-200">
                          {result.label}
                        </span>
                        {result.sublabel ? (
                          <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                            {result.sublabel}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
      {/* Everything below the search bar fades when collapsed */}
      <div className={[
        "flex min-h-0 flex-1 flex-col transition-opacity duration-150 ease-out",
        collapsed ? "pointer-events-none opacity-0" : "opacity-100",
      ].join(" ")}>
      {/* Tabs Header — all items in one row with uniform gap-2 */}
      <div className={`border-b border-slate-200 dark:border-slate-700 pb-1 flex items-end gap-2 px-4 ${variant === "desktop" ? "pt-2" : "pt-3"}`}>
          <button
            type="button"
            className={tabClasses(activeTab === "orgs")}
            onClick={() => handleTabChange("orgs")}
          >
            <span className="whitespace-nowrap">Orgs ({countForTab})</span>
            {/* Keep Orgs On Map Toggle */}
            <span
              role="switch"
              aria-checked={keepOrgsOnMap}
              aria-label="Keep Orgs On Map"
              title="Keep Orgs On Map"
              tabIndex={0}
              className={`relative inline-flex h-3 w-6 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                keepOrgsOnMap ? "bg-brand-500" : "bg-slate-300 dark:bg-slate-500"
              }`}
              onClick={handleToggleKeepOrgs}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleToggleKeepOrgs(e);
                }
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onTouchStart={(e) => e.stopPropagation()}
            >
              <span
                className="inline-block h-2 w-2 transform rounded-full bg-white shadow transition"
                style={{ transform: keepOrgsOnMap ? "translateX(14px)" : "translateX(2px)" }}
              />
            </span>
          </button>
          <button
            type="button"
            className={tabClasses(activeTab === "stats")}
            onClick={() => {
              track("sidebar_tab_click", { tab: "statistics", device: variant ?? "desktop" });
              handleTabChange("stats");
            }}
          >
            <span>Stats</span>
            {variant === "desktop" && (
              <span
                role="switch"
                aria-checked={showAdvanced}
                aria-label="Advanced areas data"
                title="Advanced areas data"
                tabIndex={0}
                className={`relative inline-flex h-3 w-6 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 ${
                  showAdvanced ? "bg-brand-500" : "bg-slate-300 dark:bg-slate-500"
                }`}
                onClick={handleToggleAdvanced}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleToggleAdvanced(e);
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
              >
                <span
                  className="inline-block h-2 w-2 transform rounded-full bg-white shadow transition"
                  style={{ transform: showAdvanced ? "translateX(14px)" : "translateX(2px)" }}
                />
              </span>
            )}
          </button>

        {/* Category Filter + Collapse (desktop only) */}
        {variant === "desktop" && (
          <>
            <div className="ml-auto flex items-center gap-1 self-start">
              <div className="relative" ref={categoryDropdownRef}>
                <button
                  type="button"
                  onClick={() => setCategoryDropdownOpen((prev) => !prev)}
                  className={`flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-normal transition ${
                    categoryFilter
                      ? "bg-brand-50 text-brand-600 hover:bg-brand-100 dark:bg-brand-400/10 dark:text-brand-300 dark:hover:bg-brand-400/20"
                      : "bg-slate-50/80 text-slate-400 hover:bg-slate-100 dark:bg-slate-800/60 dark:text-slate-500 dark:hover:bg-slate-700"
                  }`}
                  title={`Change category filter (${selectedCategoryLabel})`}
                >
                  <span className="whitespace-nowrap">{categoryToolbarLabel}</span>
                  <svg
                    className={`h-3 w-3 ${categoryFilter ? "text-brand-600 dark:text-brand-300" : "text-slate-400 dark:text-slate-500"}`}
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
                {categoryDropdownOpen && (
                  <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-md border border-slate-200 bg-white text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                    <button
                      type="button"
                      onClick={() => {
                        handleCategoryChange(null);
                        setCategoryDropdownOpen(false);
                      }}
                      className={`block w-full px-3 py-1.5 text-left text-xs transition hover:bg-slate-100 dark:hover:bg-slate-800 ${!categoryFilter ? "bg-slate-100 font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100" : "font-medium text-slate-600 dark:text-slate-300"}`}
                    >
                      All Categories
                    </button>
                    {sidebarCategories.map((cat) => (
                      <button
                        key={cat.slug}
                        type="button"
                        onClick={() => {
                          handleCategoryChange(cat.slug);
                          setCategoryDropdownOpen(false);
                        }}
                        className={`block w-full px-3 py-1.5 text-left text-xs transition hover:bg-slate-100 dark:hover:bg-slate-800 ${
                          categoryFilter === cat.slug
                            ? "bg-slate-100 font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                            : "font-medium text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        {cat.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {categoryFilter && (
                <button
                  type="button"
                  onClick={() => {
                    handleCategoryChange(null);
                    setCategoryDropdownOpen(false);
                  }}
                  className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-50 text-brand-600 hover:bg-brand-100 dark:bg-brand-400/10 dark:text-brand-300 dark:hover:bg-brand-400/20"
                  title="Clear category filter"
                >
                  <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              )}
            </div>
          </>
        )}
      </div>
      {/* Content */}
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {shouldShowContentTopFade && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-gradient-to-b from-slate-100/95 via-slate-100/55 to-transparent dark:from-slate-800/95 dark:via-slate-800/55 dark:to-transparent"
          />
        )}
        {/* Statistics Tab */}
        {activeTab === "stats" && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Demographics summary sits inside STATS tab, above StatViz/stat list content */}
            {shouldShowDemographicsBar && (
              <DemographicsBar
                snapshot={demographicsSnapshot ?? null}
                expanded={demographicsExpanded}
                onExpandedChange={(next) => onInsightsStateChange?.({ demographicsExpanded: next })}
                onExport={onExport}
                onClearAreas={onClearAreas}
                selectedAreas={selectedAreas}
                activeAreaKind={activeAreaKind}
                areaNameLookup={areaNameLookup}
                onRemoveArea={onRemoveArea}
                onAddAreas={onAddAreas}
                lineColorByAreaKey={statVizLineColorByAreaKey}
              />
            )}
            <StatList
              variant={variant}
              onScrollTopChange={handleStatsScrollTopChange}
              statsById={statsById}
              statSummariesById={statSummariesById}
              statDataById={statDataById}
              statRelationsByParent={statRelationsByParent}
              statRelationsByChild={statRelationsByChild}
              selectedAreas={selectedAreas}
              activeAreaKind={activeAreaKind}
              areaNameLookup={areaNameLookup}
              zipScopeDisplayName={zipScopeDisplayName}
              countyScopeDisplayName={countyScopeDisplayName}
              categoryFilter={categoryFilter}
              onClearCategory={() => handleCategoryChange(null)}
              secondaryStatId={secondaryStatId}
              selectedStatId={selectedStatId}
              selectedStatLoading={selectedStatLoading}
              onStatSelect={onStatSelect}
              onRetryStatData={onRetryStatData}
              // StatViz props for embedded chart (only shown when showAdvanced is true)
              showAdvanced={showAdvanced}
              seriesByStatIdByKind={seriesByStatIdByKind}
              pinnedAreas={pinnedAreas}
              hoveredArea={hoveredArea}
              onHoverArea={onHoverArea}
              getZipParentCounty={getZipParentCounty}
            />
          </div>
        )}

        {/* Organizations Tab */}
        {activeTab === "orgs" && (
          <div
            ref={orgsScrollRef}
            onScroll={handleOrgsScroll}
            className="flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            {categoryFilteredCount === 0 && !searchPinnedOrg ? (
              categoryFilter ? (
                <div className="pb-6">
                  {renderTimeFilterBanner()}
                  <div className="px-4 pt-3 text-sm text-slate-500 dark:text-slate-400">
                  <p className="mb-2">No organizations yet for this category.</p>
                  <button
                    type="button"
                    onClick={() => handleCategoryChange(null)}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    Clear category
                  </button>
                  </div>
                </div>
              ) : (
                <div className="pb-6">
                  {renderTimeFilterBanner()}
                  <p className="px-4 pt-3 text-sm text-slate-500 dark:text-slate-400">
                    No organizations found. Add one to get started.
                  </p>
                </div>
              )
            ) : timeSelection &&
              visibleInSelection.length === 0 &&
              allSectionOrgs.length === 0 &&
              visibleRecent.length === 0 &&
              !searchPinnedOrg ? (
              <div className="pb-6">
                {renderTimeFilterBanner()}
                <p className="px-4 pt-3 text-sm text-slate-500 dark:text-slate-400">
                  No organizations are open at the selected time.
                </p>
              </div>
            ) : (
                <div className="flex-1">

                {/* Search-selected org pinned to top for stronger orientation after selection. */}
                {showSelectedSection && searchPinnedOrg && (
                  <>
                    <h3 className="px-8 pt-3 pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      SELECTED
                    </h3>
                    <ul className="space-y-2 px-4">
                      <OrganizationListItem
                        key={searchPinnedOrg.id}
                        org={searchPinnedOrg}
                        isSelected={selectedOrgIdsSet.has(searchPinnedOrg.id)}
                        isHighlighted={highlightedIds.has(searchPinnedOrg.id)}
                        isExpanded={expandedOrgId === searchPinnedOrg.id}
                        onHover={onHover}
                        onCategoryClick={onCategoryClick}
                        onOrganizationClick={onOrganizationClick}
                        onToggleExpand={(id) =>
                          setExpandedOrgId((prev) => (prev === id ? null : id))
                        }
                        onIssueClick={handleOpenIssueModal}
                        showZoomButton={shouldShowZoomButton(searchPinnedOrg.id)}
                        onZoomClick={onZoomToOrg}
                        hideCategoryTag={hideCategoryTags}
                        selectionStyleVariant={selectionStyleVariant}
                        getCategoryLabel={getCategoryLabel}
                      />
                    </ul>
                  </>
                )}

                {/* Recently Added Section */}
                {showRecentSection && (
                  <>
                    <h3 className="px-8 pt-3 pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      RECENTLY ADDED
                    </h3>
                    <ul className="space-y-2 px-4">
                      {visibleRecent.map((org) => (
                        <OrganizationListItem
                          key={org.id}
                          org={org}
                          isSelected={selectedOrgIdsSet.has(org.id)}
                          isHighlighted={highlightedIds.has(org.id)}
                          isExpanded={expandedOrgId === org.id}
                          onHover={onHover}
                          onCategoryClick={onCategoryClick}
                          onOrganizationClick={onOrganizationClick}
                          onToggleExpand={(id) =>
                            setExpandedOrgId((prev) => (prev === id ? null : id))
                          }
                          onIssueClick={handleOpenIssueModal}
                          showZoomButton={shouldShowZoomButton(org.id)}
                          onZoomClick={onZoomToOrg}
                          hideCategoryTag={hideCategoryTags}
                          selectionStyleVariant={selectionStyleVariant}
                          getCategoryLabel={getCategoryLabel}
                        />
                      ))}
                    </ul>
                  </>
                )}

                {/* In Selection Section */}
                {showInSelectionSection && (
                  <>
                    <h3 className="px-8 pt-3 pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      {inSelectionLabel}
                    </h3>
                    <ul className="space-y-2 px-4">
                      {visibleInSelection.map((org) => (
                        <OrganizationListItem
                          key={org.id}
                          org={org}
                          isSelected={selectedOrgIdsSet.has(org.id)}
                          isHighlighted={highlightedIds.has(org.id)}
                          isExpanded={expandedOrgId === org.id}
                          onHover={onHover}
                          onCategoryClick={onCategoryClick}
                          onOrganizationClick={onOrganizationClick}
                          onToggleExpand={(id) =>
                            setExpandedOrgId((prev) => (prev === id ? null : id))
                          }
                          onIssueClick={handleOpenIssueModal}
                          showZoomButton={shouldShowZoomButton(org.id)}
                          onZoomClick={onZoomToOrg}
                          hideCategoryTag={hideCategoryTags}
                          selectionStyleVariant={selectionStyleVariant}
                          getCategoryLabel={getCategoryLabel}
                        />
                      ))}
                    </ul>
                  </>
                )}

                {renderTimeFilterBanner()}

                {/* All Section */}
                {showAllSectionHeading && (
                  <h3 className="px-8 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    ALL
                  </h3>
                )}
                <ul className={`space-y-2 px-4 pb-6 ${showAllSectionHeading ? "" : "pt-2"}`}>
                  {allSectionOrgs.map((org) => (
                    <OrganizationListItem
                      key={org.id}
                      org={org}
                      isSelected={selectedOrgIdsSet.has(org.id)}
                      isHighlighted={highlightedIds.has(org.id)}
                      onHover={onHover}
                      onCategoryClick={onCategoryClick}
                      onOrganizationClick={onOrganizationClick}
                      isExpanded={expandedOrgId === org.id}
                      onToggleExpand={(id) =>
                        setExpandedOrgId((prev) => (prev === id ? null : id))
                      }
                      onIssueClick={handleOpenIssueModal}
                      showZoomButton={shouldShowZoomButton(org.id)}
                      onZoomClick={onZoomToOrg}
                      hideCategoryTag={hideCategoryTags}
                      selectionStyleVariant={selectionStyleVariant}
                      getCategoryLabel={getCategoryLabel}
                    />
                  ))}

                  {/* Zoom Out Link */}
                  {(countyZoomContext || missingCount > 0) && (
                    <li className="px-0 pt-0 pb-0">
                      <button
                        type="button"
                        className="block w-full text-left text-xs font-normal text-brand-300 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-200 px-4 pb-4 pt-2 transition-colors"
                        onClick={() => {
                          if (countyZoomContext && zipScopeCountyCode && onZoomToCounty) {
                            onZoomToCounty(zipScopeCountyCode);
                            if (variant === "mobile") {
                              onRequestCollapseSheet?.();
                            }
                            return;
                          }
                          onZoomOutAll?.();
                          if (variant === "mobile") {
                            onRequestCollapseSheet?.();
                          }
                        }}
                      >
                        {countyZoomContext
                          ? `See all ${countyZoomContext.totalCount} ${countyZoomContext.countyLabel} ${countyZoomOrgNoun}${
                              countyZoomContext.totalCount === 1 ? "" : "s"
                            } (Zoom out)`
                          : `${missingCount} more${missingZoomCategoryText} not visible (Zoom out)`}
                      </button>
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
      </div>{/* end fade wrapper */}
      </aside>
      <IssueReportModal
        org={issueModalOrg}
        isOpen={Boolean(issueModalOrg)}
        onClose={handleCloseIssueModal}
        onSubmit={handleSubmitIssue}
      />
    </>
  );
};

interface OrganizationListItemProps {
  org: Organization;
  isSelected: boolean;
  isHighlighted?: boolean;
  isExpanded: boolean;
  onHover?: (idOrIds: string | string[] | null) => void;
  onCategoryClick?: (categoryId: string) => void;
  onOrganizationClick?: (organizationId: string) => void;
  onToggleExpand?: (id: string) => void;
  onIssueClick?: (org: Organization) => void;
  // Show zoom button when in county zoom range and org is selected
  showZoomButton?: boolean;
  onZoomClick?: (organizationId: string) => void;
  hideCategoryTag?: boolean;
  selectionStyleVariant?: "default" | "searchResults";
  getCategoryLabel: (slug: string) => string;
}

const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/**
 * Detects if the user is on a mobile device and returns platform info.
 */
const getMobilePlatform = (): { isMobile: boolean; isIOS: boolean; isAndroid: boolean } => {
  if (typeof window === "undefined") {
    return { isMobile: false, isIOS: false, isAndroid: false };
  }
  
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isMobile = isIOS || isAndroid || 
    /webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
    (window.matchMedia && window.matchMedia("(max-width: 768px)").matches);
  
  return { isMobile, isIOS, isAndroid };
};

/**
 * Builds a maps URL from organization address components.
 * On mobile: opens native maps app (Apple Maps on iOS, Google Maps on Android).
 * On desktop: opens Google Maps web.
 */
const buildMapsUrl = (org: Organization): string | null => {
  const segments = [
    org.address,
    org.city,
    org.state,
    org.postalCode,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  
  if (segments.length === 0) return null;
  
  const { isMobile, isIOS, isAndroid } = getMobilePlatform();
  const query = encodeURIComponent(segments.join(", "));
  
  // On mobile, use platform-specific URL schemes to open native maps app
  if (isMobile) {
    // iOS: Use Apple Maps URL scheme
    if (isIOS) {
      // If we have coordinates, use them for precise location
      if (typeof org.latitude === "number" && typeof org.longitude === "number" && 
          isFinite(org.latitude) && isFinite(org.longitude)) {
        return `http://maps.apple.com/?ll=${org.latitude},${org.longitude}`;
      }
      // Otherwise, use address query
      return `http://maps.apple.com/?q=${query}`;
    }
    
    // Android: Use geo: URI scheme (opens Google Maps)
    if (isAndroid) {
      // If we have coordinates, use them for precise location
      if (typeof org.latitude === "number" && typeof org.longitude === "number" && 
          isFinite(org.latitude) && isFinite(org.longitude)) {
        return `geo:${org.latitude},${org.longitude}`;
      }
      // Otherwise, use address query
      return `geo:0,0?q=${query}`;
    }
    
    // Other mobile devices: try geo: URI as fallback
    if (typeof org.latitude === "number" && typeof org.longitude === "number" && 
        isFinite(org.latitude) && isFinite(org.longitude)) {
      return `geo:${org.latitude},${org.longitude}`;
    }
    return `geo:0,0?q=${query}`;
  }
  
  // On desktop, use Google Maps web
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripAddressTail = (value: string): string =>
  value
    // Remove trailing country markers
    .replace(/,\s*(?:USA|United States(?: of America)?)\.?$/i, "")
    // Remove trailing state + zip (e.g., ", OK 74145" or ", OK")
    .replace(/,\s*[A-Z]{2}(?:\s*\d{5}(?:-\d{4})?)?$/i, "")
    .trim()
    // Collapse duplicate whitespace that can appear after replacements
    .replace(/\s{2,}/g, " ");

const formatShortAddress = (org: Organization): string | null => {
  const street = typeof org.address === "string" ? org.address.trim() : "";
  const city = typeof org.city === "string" ? org.city.trim() : "";

  if (!street && !city) {
    return null;
  }

  if (street && city) {
    const cityPattern = new RegExp(`,\\s*${escapeRegExp(city)}(?:,.*)?$`, "i");
    const streetWithoutCity = street.replace(cityPattern, "").trim();
    const baseStreet = streetWithoutCity.length > 0 ? streetWithoutCity : street;
    const cleanedStreet = stripAddressTail(baseStreet).replace(/,\s*$/, "").trim();

    if (cleanedStreet.length === 0) {
      return city;
    }

    return `${cleanedStreet}, ${city}`;
  }

  if (street) {
    return stripAddressTail(street);
  }

  return city;
};

const formatHoursLines = (hours: OrganizationHours | null | undefined): string[] => {
  if (!hours) return [];
  if (Array.isArray(hours.weekdayText) && hours.weekdayText.length > 0) {
    return hours.weekdayText;
  }

  if (!Array.isArray(hours.periods) || hours.periods.length === 0) {
    return [];
  }

  const map = new Map<number, string[]>();
  for (const period of hours.periods) {
    if (typeof period?.day !== "number") continue;
    const dayIndex = Math.min(Math.max(period.day, 0), DAY_LABELS.length - 1);
    const segments: string[] = [];
    const open = period.openTime ?? null;
    const close = period.closeTime ?? null;
    if (open && close) {
      segments.push(`${open} – ${close}${period.isOvernight ? " (+1)" : ""}`);
    } else if (open) {
      segments.push(`Opens ${open}`);
    } else if (close) {
      segments.push(`Closes ${close}`);
    } else {
      segments.push("Closed");
    }

    const existing = map.get(dayIndex) ?? [];
    existing.push(...segments);
    map.set(dayIndex, existing);
  }

  const lines: string[] = [];
  for (const [dayIndex, segments] of map.entries()) {
    const label = DAY_LABELS[dayIndex] ?? `Day ${dayIndex}`;
    lines.push(`${label}: ${segments.join(", ")}`);
  }
  return lines;
};

const renderHours = (hours: OrganizationHours | null | undefined) => {
  const lines = formatHoursLines(hours);
  if (lines.length === 0) return null;
  const isUnverified = hours?.isUnverified;
  const statusLabel =
    typeof hours?.status === "string" && hours.status.trim().length > 0
      ? hours.status
      : null;

  return (
    <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
      <div className="mb-1 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        <span>Hours</span>
        <div className="flex items-center gap-2">
          {statusLabel ? <span className="capitalize text-slate-400">{statusLabel.toLowerCase()}</span> : null}
          {isUnverified ? (
            <span className="rounded bg-amber-100 px-2 py-[1px] text-[10px] font-medium uppercase tracking-wide text-amber-800 dark:bg-amber-400/20 dark:text-amber-200">
              Unverified
            </span>
          ) : null}
        </div>
      </div>
      <ul className="space-y-1">
        {lines.map((line, idx) => (
          <li key={`${line}-${idx}`} className="leading-snug">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
};

const OrganizationListItem = ({
  org,
  isSelected,
  isHighlighted = false,
  isExpanded,
  onHover,
  onCategoryClick,
  onOrganizationClick,
  onToggleExpand,
  onIssueClick,
  showZoomButton = false,
  onZoomClick,
  hideCategoryTag = false,
  selectionStyleVariant = "default",
  getCategoryLabel,
}: OrganizationListItemProps) => {
  const lastClickTimeRef = useRef<number>(0);
  const categoryLabel = typeof org.category === "string" ? getCategoryLabel(org.category) : null;
  const showCategoryChip = Boolean(!hideCategoryTag && categoryLabel);

  const handleMouseEnter = () => onHover?.(org.id);
  const handleMouseLeave = () => onHover?.(null);

  const handleCategoryClick = (event?: React.MouseEvent | React.KeyboardEvent) => {
    event?.stopPropagation();
    const cat = (org as any).category as string | undefined;
    if (cat) {
      onCategoryClick?.(cat);
    }
  };

  const handleToggle = () => {
    const now = Date.now();
    const timeSinceLastClick = now - lastClickTimeRef.current;
    const isDoubleClick = timeSinceLastClick < 300; // 300ms threshold for double-click
    
    // If card is already expanded and selected, and this is a quick second click (double-click),
    // don't toggle the expand state - just trigger selection (which will zoom if already selected)
    // This keeps the hours/card expanded when zooming
    if (isExpanded && isSelected && isDoubleClick) {
      // Just select (which will trigger zoom if already selected)
      onOrganizationClick?.(org.id);
      lastClickTimeRef.current = now;
      return;
    }
    
    // If card is already expanded, don't collapse it - just select it
    // Only collapse when clicking a different card (handled by onToggleExpand)
    if (isExpanded) {
      // Just select without toggling expand state
      onOrganizationClick?.(org.id);
      lastClickTimeRef.current = now;
      return;
    }
    
    lastClickTimeRef.current = now;
    
    // Normal click behavior: expand and select (only collapses if clicking a different card)
    onToggleExpand?.(org.id);
    onOrganizationClick?.(org.id);
  };

  const handleToggleExpandOnly = () => {
    // Toggle expand/collapse without selecting the org
    onToggleExpand?.(org.id);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLLIElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleToggle();
    }
  };

  const selectedClass =
    selectionStyleVariant === "searchResults"
      ? "border-0 bg-brand-50/70 dark:bg-slate-800/60"
      : "border border-brand-200 bg-brand-50/70 dark:border-brand-500/60 dark:bg-slate-800";
  const cardStateClass = isSelected
    ? selectedClass
    : isHighlighted
    ? "border-0 bg-brand-50/70 dark:bg-slate-800/50"
    : "border-0 bg-slate-100/40 hover:bg-brand-50 dark:bg-slate-800/20 dark:hover:bg-slate-800/70";
  const shortAddress = formatShortAddress(org);

  return (
    <li
      data-org-id={org.id}
      className={`group relative rounded-xl px-4 py-3 transition duration-200 ease-out ${cardStateClass}`}
      onMouseEnter={handleMouseEnter}
      onFocus={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onBlur={handleMouseLeave}
      onClick={handleToggle}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      onKeyDown={handleKeyDown}
    >
      <div className="flex items-start gap-2">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{org.name}</p>
        {org.status && org.status !== "active" && (
          <span className="rounded-full bg-amber-100 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-400/20 dark:text-amber-200">
            {org.status}
          </span>
        )}
      </div>
      {shortAddress && (
        <p className="mt-1 text-xs font-light text-slate-400 dark:text-slate-500">
          {(() => {
            const mapsUrl = buildMapsUrl(org);

            if (mapsUrl) {
              return (
                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline"
                  onClick={(event) => event.stopPropagation()}
                >
                  {shortAddress}
                </a>
              );
            }
            return shortAddress;
          })()}
        </p>
      )}
      {org.phone && (
        <p className="mt-1 text-xs font-light text-slate-400 dark:text-slate-500">
          <span className="font-medium text-slate-400 dark:text-slate-500">Phone:</span>{" "}
          <a
            href={`tel:${org.phone}`}
            className="hover:underline"
            onClick={(event) => event.stopPropagation()}
          >
            {org.phone}
          </a>
        </p>
      )}
      {/* Actions row: Visit site + Category on left, Hours tag on right */}
      <div className="mt-1 flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          {org.website && (
            <a
              href={org.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 transition-colors hover:text-brand-900 dark:text-slate-300 dark:hover:text-slate-100"
              onClick={(event) => event.stopPropagation()}
            >
              Website
              <span aria-hidden="true" className="text-[1em] leading-none">
                ↗
              </span>
            </a>
          )}
          {showCategoryChip ? (
            <span
              role="button"
              tabIndex={0}
              className="inline-flex items-center rounded-full bg-slate-50 px-2 py-[2px] text-[10px] font-normal text-slate-500 dark:bg-slate-800/70 dark:text-slate-400 cursor-pointer"
              onClick={(event) => handleCategoryClick(event)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  handleCategoryClick(e);
                }
              }}
            >
              {categoryLabel}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {showZoomButton && (
            <button
              type="button"
              className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-[2px] text-[10px] font-medium text-indigo-700 transition-colors group-hover:bg-indigo-200 group-hover:text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-300 dark:group-hover:bg-indigo-800/60 dark:group-hover:text-indigo-100"
              onClick={(event) => {
                event.stopPropagation();
                onZoomClick?.(org.id);
              }}
              aria-label="Zoom to location"
            >
              Zoom
            </button>
          )}
          <button
            type="button"
            className="inline-flex items-center rounded-full bg-slate-100 px-2 py-[2px] text-[10px] font-normal text-slate-400 transition-colors group-hover:bg-red-100 group-hover:text-brand-900 dark:bg-slate-800/60 dark:text-slate-400 dark:group-hover:bg-red-900/30 dark:group-hover:text-slate-100"
            onClick={(event) => {
              event.stopPropagation();
              onIssueClick?.(org);
            }}
          >
            Issue?
          </button>
          {formatHoursLines(org.hours).length > 0 ? (
            <button
              type="button"
              className="inline-flex items-center rounded-full bg-slate-100 px-2 py-[2px] text-[10px] font-normal text-slate-400 transition-colors group-hover:bg-brand-100 group-hover:text-brand-900 dark:bg-slate-800/60 dark:text-slate-400 dark:group-hover:bg-slate-700 dark:group-hover:text-slate-100"
              onClick={(event) => {
                event.stopPropagation();
                handleToggleExpandOnly();
              }}
            >
              Hours
            </button>
          ) : null}
        </div>
      </div>
      {isExpanded ? renderHours(org.hours) : null}
    </li>
  );
};
