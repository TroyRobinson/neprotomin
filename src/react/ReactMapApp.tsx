import { useState, lazy, Suspense, useEffect, useMemo, useRef, useCallback } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { track } from "@vercel/analytics";
import { TopBar } from "./components/TopBar";
import { BoundaryToolbar } from "./components/BoundaryToolbar";
import { MapLibreMap } from "./components/MapLibreMap";
import { Sidebar } from "./components/Sidebar";
import { WelcomeModal } from "./components/WelcomeModal";
import { ZipSearchModal } from "./components/ZipSearchModal";
import { TimeSelectorModal } from "./components/TimeSelectorModal";
import { useDemographics, type CombinedDemographicsSnapshot } from "./hooks/useDemographics";
import { useStats } from "./hooks/useStats";
import type { StatBoundaryEntry, SeriesByKind, SeriesEntry } from "./hooks/useStats";
import { useOrganizations } from "./hooks/useOrganizations";
import { useRecentOrganizations } from "./hooks/useRecentOrganizations";
import { useAreas } from "./hooks/useAreas";
import { type Organization, OKLAHOMA_CENTER, OKLAHOMA_DEFAULT_ZOOM } from "../types/organization";
import { findZipForLocation, getZipBounds } from "../lib/zipBoundaries";
import { findCountyForLocation, getCountyBounds, getCountyCodeByName } from "../lib/countyBoundaries";
import type { BoundaryMode } from "../types/boundaries";
import { AuthModal } from "./components/AuthModal";
import { db } from "../lib/reactDb";
import type { AreaId, AreaKind, PersistedAreaSelection } from "../types/areas";
import { DEFAULT_PARENT_AREA_BY_KIND } from "../types/areas";
import { normalizeScopeLabel, buildScopeLabelAliases } from "../lib/scopeLabels";
import { useMediaQuery } from "./hooks/useMediaQuery";
import type { MapViewController } from "./imperative/mapView";
import { isAdminEmail } from "../lib/admin";
import { type TimeSelection, isOrganizationOpenAtTime, toTimeSelection } from "./lib/timeFilters";
import { findCitySearchTarget, DEFAULT_CITY_ZOOM } from "./lib/citySearchTargets";
import { parseFullAddress, geocodeAddress, looksLikeAddress } from "./lib/geocoding";
import { normalizeForSearch, computeSimilarityFromNormalized } from "./lib/fuzzyMatch";
import { getMapStateFromUrl, updateUrlWithMapState, type AreasMode } from "./lib/mapUrl";
import { getDomainDefaults, isFoodMapDomain } from "./lib/domains";
import { useAuthSession } from "./hooks/useAuthSession";
import { setStatDataSubscriptionEnabled } from "../state/statData";
import { MapSettingsModal } from "./components/MapSettingsModal";
import { useCensusImportQueue } from "./hooks/useCensusImportQueue";
import { getPerformanceTier } from "../lib/device";
import { REDUCED_DATA_LOADING_KEY, readBoolSetting, writeBoolSetting } from "../lib/settings";
import { getStatDisplayName } from "../types/stat";
type SupportedAreaKind = "ZIP" | "COUNTY";
type ScreenName = "map" | "report" | "roadmap" | "data" | "queue" | "addOrg" | "admin";
const ReportScreen = lazy(() => import("./components/ReportScreen").then((m) => ({ default: m.ReportScreen })));
const DataScreen = lazy(() => import("./components/DataScreen").then((m) => ({ default: m.default })));
const RoadmapScreen = lazy(() => import("./components/RoadmapScreen").then((m) => ({ default: m.default })));
const AddOrganizationScreen = lazy(() =>
  import("./components/AddOrganizationScreen").then((m) => ({ default: m.AddOrganizationScreen })),
);
const QueueScreen = lazy(() =>
  import("./components/QueueScreen").then((m) => ({ default: m.QueueScreen })),
);
const AdminScreen = lazy(() =>
  import("./components/AdminScreen").then((m) => ({ default: m.AdminScreen })),
);

const COUNTY_MODE_ENABLE_ZOOM = 9;
const COUNTY_MODE_DISABLE_ZOOM = 9.6;

// Feature flag: if true, always show welcome modal on app load (for testing)
const ALWAYS_SHOW_WELCOME_MODAL = false;

const FALLBACK_ZIP_SCOPE = normalizeScopeLabel(DEFAULT_PARENT_AREA_BY_KIND.ZIP ?? "Oklahoma") ?? "Oklahoma";

const expandScopeAliases = (scopes: string[]): string[] => {
  const set = new Set<string>();
  for (const scope of scopes) {
    const normalized = normalizeScopeLabel(scope);
    if (!normalized) continue;
    if (normalized === "Oklahoma") {
      set.add("Oklahoma");
      continue;
    }
    for (const alias of buildScopeLabelAliases(normalized)) {
      set.add(alias);
    }
  }
  return Array.from(set);
};

const DEFAULT_TOP_BAR_HEIGHT = 64;
const MOBILE_MAX_WIDTH_QUERY = "(max-width: 767px)";
const MOBILE_SHEET_PEEK_HEIGHT = 136;
const MOBILE_PARTIAL_MIN_MAP_RATIO = 0.05; // Min amount of viewport for the map when sheet is partial
const MOBILE_PARTIAL_TARGET_SHEET_HEIGHT = 560; // Aim for this sheet height before applying other clamps
const MOBILE_PARTIAL_MAP_HEIGHT_SCALE = 1; // Scale the computed map height when we have room above the minimum
const MOBILE_PARTIAL_FOCUS_ANCHOR = 0.12; // Portion of visible sheet height to align with viewport center
const MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MIN = 0.7; // Offset multiplier for taller mobile screens
const MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MAX = 1; // Offset multiplier for shorter mobile screens
const MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MIN_HEIGHT = 640; // Heights at or below this use the max multiplier
const MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MAX_HEIGHT = 920; // Heights at or above this use the min multiplier
const MOBILE_SHEET_DRAG_THRESHOLD = 72;
const MOBILE_TAP_THRESHOLD = 10; // pixels - movement below this is considered a tap, not a drag
const ORGANIZATION_MATCH_THRESHOLD = 0.55;

const HASH_TO_SCREEN: Record<string, ScreenName> = {
  "#roadmap": "roadmap",
  "#queue": "queue",
  "#admin": "admin",
};

const screenFromHash = (hash: string): ScreenName | null => {
  if (!hash) return null;
  return HASH_TO_SCREEN[hash.toLowerCase()] ?? null;
};

const hashForScreen = (screen: ScreenName): string | null => {
  switch (screen) {
    case "roadmap":
      return "#roadmap";
    case "queue":
      return "#queue";
    case "admin":
      return "#admin";
    default:
      return null;
  }
};

const isHashRoutedScreen = (screen: ScreenName): boolean => screen === "roadmap" || screen === "queue" || screen === "admin";

interface AreaSelectionState {
  selected: string[];
  pinned: string[];
  transient: string[];
}

interface AreaSelectionSnapshot {
  kind: AreaKind;
  selected: string[];
  pinned: string[];
}

type AreaSelectionMap = Record<AreaKind, AreaSelectionState>;

const createEmptySelection = (): AreaSelectionState => ({
  selected: [],
  pinned: [],
  transient: [],
});

const dedupeIds = (ids: string[]): string[] => {
  if (!ids || ids.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }
  return result;
};

const arraysEqual = (a: string[], b: string[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const expandBounds = (
  bounds: [[number, number], [number, number]],
  factor: number,
): [[number, number], [number, number]] => {
  // Expand the bounding box slightly so the camera shows neighboring areas.
  const [[minLng, minLat], [maxLng, maxLat]] = bounds;
  const width = Math.max(maxLng - minLng, 0);
  const height = Math.max(maxLat - minLat, 0);
  const padLng = Math.max(width * factor, 0.02);
  const padLat = Math.max(height * factor, 0.02);
  return [
    [minLng - padLng, minLat - padLat],
    [maxLng + padLng, maxLat + padLat],
  ];
};

export const ReactMapApp = () => {
  const { isRunning: isCensusImportRunning } = useCensusImportQueue();
  // Parse initial map state from URL once (must be first to be available for other initializers)
  const [initialMapState] = useState(() => getMapStateFromUrl());
  const initialMapPosition = initialMapState.position;
  // Initialize boundary state from URL areasMode
  const [boundaryMode, setBoundaryMode] = useState<BoundaryMode>(() => {
    const areasMode = initialMapState.areasMode;
    if (areasMode === "zips" || areasMode === "counties" || areasMode === "none") return areasMode;
    return "zips"; // default for "auto"
  });
  const [boundaryControlMode, setBoundaryControlMode] = useState<"auto" | "manual">(() => {
    return initialMapState.areasMode === "auto" ? "auto" : "manual";
  });
  const [areaSelections, setAreaSelections] = useState<AreaSelectionMap>(() => ({
    ZIP: { selected: initialMapState.selectedZips, pinned: [], transient: [] },
    COUNTY: { selected: initialMapState.selectedCounties, pinned: [], transient: [] },
    TRACT: createEmptySelection(),
  }));
  const [hoveredArea, setHoveredArea] = useState<AreaId | null>(null);
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(null);
  const [highlightedOrganizationIds, setHighlightedOrganizationIds] = useState<string[] | null>(null);
  // Direct org selection (from clicking org centroids or small clusters) - takes priority over area-based selection
  const [selectedOrgIds, setSelectedOrgIds] = useState<string[]>(() => initialMapState.orgIds);
  // Track whether the direct org selection originated from the map (vs sidebar click)
  const [selectedOrgIdsFromMap, setSelectedOrgIdsFromMap] = useState<boolean>(false);
  const [selectedStatId, setSelectedStatId] = useState<string | null>(() => initialMapState.statId);
  const [secondaryStatId, setSecondaryStatId] = useState<string | null>(() => initialMapState.secondaryStatId);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(() => initialMapState.category);
  const [sidebarTab, setSidebarTab] = useState<"orgs" | "stats">(() => initialMapState.sidebarTab);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => initialMapState.sidebarCollapsed);
  const [hasAppliedDefaultStat, setHasAppliedDefaultStat] = useState(false);
  const [searchSelectionMeta, setSearchSelectionMeta] = useState<{ term: string; ids: string[] } | null>(null);
  const [activeScreen, setActiveScreen] = useState<ScreenName>(() => {
    if (typeof window === "undefined") return "map";
    return screenFromHash(window.location.hash) ?? "map";
  });
  const domainDefaults = useMemo(() => getDomainDefaults(), []);
  const isFoodDomain = useMemo(() => isFoodMapDomain(), []);
  const [authOpen, setAuthOpen] = useState(false);
  const [cameraState, setCameraState] = useState<{ center: [number, number]; zoom: number } | null>(null);
  const [hasInteractedWithMap, setHasInteractedWithMap] = useState(false);
  const [sidebarFollowsMap, setSidebarFollowsMap] = useState(true);
  const [orgPinsVisible, setOrgPinsVisible] = useState<boolean>(() => initialMapState.orgPinsVisible);
  const [orgsVisibleIds, setOrgsVisibleIds] = useState<string[]>([]);
  const [orgsAllSourceIds, setOrgsAllSourceIds] = useState<string[]>([]);
  const latestVisibleIdsRef = useRef<{ visible: string[]; all: string[] }>({ visible: [], all: [] });
  const sidebarFollowsMapRef = useRef(sidebarFollowsMap);
  useEffect(() => {
    sidebarFollowsMapRef.current = sidebarFollowsMap;
    if (sidebarFollowsMap) {
      const snapshot = latestVisibleIdsRef.current;
      setOrgsVisibleIds(snapshot.visible);
      setOrgsAllSourceIds(snapshot.all);
    }
  }, [sidebarFollowsMap]);
  const applyMapVisibleIds = useCallback(
    (ids: string[], allSourceIds: string[]) => {
      const snapshot = {
        visible: [...ids],
        all: [...allSourceIds],
      };
      latestVisibleIdsRef.current = snapshot;
      if (sidebarFollowsMapRef.current) {
        setOrgsVisibleIds(snapshot.visible);
        setOrgsAllSourceIds(snapshot.all);
      }
    },
    [setOrgsAllSourceIds, setOrgsVisibleIds],
  );
  const setSidebarFollowMode = useCallback((mode: "map" | "sidebar") => {
    setSidebarFollowsMap((prev) => {
      const next = mode === "map";
      return prev === next ? prev : next;
    });
  }, []);
  const [zipScope, setZipScope] = useState<string>(DEFAULT_PARENT_AREA_BY_KIND.ZIP ?? "Oklahoma");
  const [zipNeighborScopes, setZipNeighborScopes] = useState<string[]>([]);
  const isMobile = useMediaQuery(MOBILE_MAX_WIDTH_QUERY);
  const performanceTier = useMemo(() => getPerformanceTier(), []);
  const lowMemoryMode = performanceTier === "low";
  const [reducedDataLoading, setReducedDataLoading] = useState(() =>
    readBoolSetting(REDUCED_DATA_LOADING_KEY, false),
  );
  const [topBarHeight, setTopBarHeight] = useState(DEFAULT_TOP_BAR_HEIGHT);
  const [sheetState, setSheetState] = useState<"peek" | "partial" | "expanded">("peek");

  useEffect(() => {
    writeBoolSetting(REDUCED_DATA_LOADING_KEY, reducedDataLoading);
  }, [reducedDataLoading]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== REDUCED_DATA_LOADING_KEY) return;
      setReducedDataLoading(event.newValue === "true");
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const [sheetDragOffset, setSheetDragOffset] = useState(0);
  const [isDraggingSheet, setIsDraggingSheet] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(() => initialMapState.showAdvanced);
  const [sidebarInsightsState, setSidebarInsightsState] = useState(() => ({
    demographicsVisible: initialMapState.sidebarInsights.demographicsVisible,
    demographicsExpanded: initialMapState.sidebarInsights.demographicsExpanded,
    statVizVisible: initialMapState.sidebarInsights.statVizVisible,
    statVizCollapsed: initialMapState.sidebarInsights.statVizCollapsed,
  }));
  const [legendRangeMode, setLegendRangeMode] = useState<"dynamic" | "scoped" | "global">("dynamic");
  const [mapSettingsOpen, setMapSettingsOpen] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(() => {
    if (typeof window === "undefined") return 0;
    const viewport = window.visualViewport;
    return Math.round(viewport?.height ?? window.innerHeight);
  });

  // Pause the heavy statData live subscription while in Admin to avoid timeout noise during imports.
  useEffect(() => {
    const enableLiveStatData = activeScreen !== "admin";
    setStatDataSubscriptionEnabled(enableLiveStatData);
    return () => {
      setStatDataSubscriptionEnabled(true);
    };
  }, [activeScreen]);
  const [userLocation, setUserLocation] = useState<{ lng: number; lat: number } | null>(null);
  const [userLocationSource, setUserLocationSource] = useState<"device" | "search" | null>(null);
  const [isRequestingLocation, setIsRequestingLocation] = useState(false);
  const [userLocationError, setUserLocationError] = useState<string | null>(null);
  const lastDeviceLocationRef = useRef<{ lng: number; lat: number } | null>(null);
  const geocodeCacheRef = useRef<Map<string, { lng: number; lat: number }>>(new Map());
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [showZipSearchModal, setShowZipSearchModal] = useState(false);
  const [showTimeSelectorModal, setShowTimeSelectorModal] = useState(false);
  const [timeSelectionState, setTimeSelectionState] = useState<TimeSelection | null>(null);
  const timeSelection = useMemo(() => toTimeSelection(timeSelectionState), [timeSelectionState]);
  const setTimeSelection = useCallback((selection: TimeSelection | null) => {
    setTimeSelectionState(toTimeSelection(selection));
  }, [setTimeSelectionState]);
  const [expandMobileSearch, setExpandMobileSearch] = useState(false);
  const sheetPointerIdRef = useRef<number | null>(null);
  const sheetDragStateRef = useRef<{ startY: number; startState: "peek" | "partial" | "expanded" } | null>(null);
  const pendingContentDragRef = useRef<{ pointerId: number; startY: number } | null>(null);
  const sheetContentRef = useRef<HTMLDivElement | null>(null);
  const mapControllerRef = useRef<MapViewController | null>(null);
  const skipSidebarCenteringRef = useRef(false);
  const suppressAreaSelectionClearRef = useRef<{ ZIP: number; COUNTY: number }>({ ZIP: 0, COUNTY: 0 });
  const sheetAvailableHeight = Math.max(viewportHeight - topBarHeight, 0);
  const sheetPeekOffset = Math.max(sheetAvailableHeight - MOBILE_SHEET_PEEK_HEIGHT, 0);
  const sheetPartialOffset = useMemo(() => {
    if (sheetPeekOffset <= 0) return 0;
    const minMapHeight = Math.round(Math.max(viewportHeight * MOBILE_PARTIAL_MIN_MAP_RATIO, 0));
    const desiredMapHeight = Math.max(
      minMapHeight,
      sheetAvailableHeight - MOBILE_PARTIAL_TARGET_SHEET_HEIGHT,
    );
    const baseMapHeight = Math.min(sheetPeekOffset, Math.max(desiredMapHeight, minMapHeight));
    const adjustedMapHeight = Math.min(
      sheetPeekOffset,
      Math.max(minMapHeight, Math.round(baseMapHeight * MOBILE_PARTIAL_MAP_HEIGHT_SCALE)),
    );
    return Math.max(0, adjustedMapHeight);
  }, [sheetAvailableHeight, sheetPeekOffset, viewportHeight]);

  // Scale map offset based on viewport height so taller screens nudge less
  const mobilePartialFocusOffsetScale = useMemo(() => {
    if (!isMobile) return 1;
    if (viewportHeight <= 0) return MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MAX;
    const minHeight = MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MIN_HEIGHT;
    const maxHeight = MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MAX_HEIGHT;
    if (maxHeight <= minHeight) return MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MAX;
    const clampedHeight = Math.min(Math.max(viewportHeight, minHeight), maxHeight);
    const progress = (clampedHeight - minHeight) / (maxHeight - minHeight);
    const range = MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MAX - MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MIN;
    return MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MAX - progress * range;
  }, [isMobile, viewportHeight]);

  const { user, authReady } = useAuthSession();
  const persistSidebarInsights = showAdvanced;
  const isAdmin = useMemo(() => {
    if (!user || user.isGuest) return false;
    if (typeof user.email !== "string" || user.email.trim().length === 0) return false;
    return isAdminEmail(user.email);
  }, [user]);

  // When Advanced is toggled back on, restore default Insights state.
  // When Advanced is toggled off, the sections hide and URL params clear.
  const prevShowAdvancedRef = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    const prev = prevShowAdvancedRef.current;
    prevShowAdvancedRef.current = showAdvanced;
    if (prev === undefined) return;
    if (prev === false && showAdvanced === true) {
      // Open sidebar if it's collapsed when advanced mode is enabled
      setSidebarCollapsed(false);
      setSidebarInsightsState({
        demographicsVisible: true,
        demographicsExpanded: false,
        statVizVisible: true,
        statVizCollapsed: false,
      });
    }
  }, [showAdvanced]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleHashChange = () => {
      const hash = window.location.hash;
      const next = screenFromHash(hash);
      if (!next) {
        setActiveScreen((prev) => (isHashRoutedScreen(prev) ? "map" : prev));
        return;
      }
      if ((next === "queue" || next === "admin") && authReady && !isAdmin) {
        setActiveScreen("map");
        return;
      }
      if (next === "report" && (!authReady || !user || user.isGuest || !showAdvanced)) {
        setActiveScreen("map");
        return;
      }
      setActiveScreen((prev) => (prev === next ? prev : next));
    };

    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, [authReady, isAdmin]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const targetHash = hashForScreen(activeScreen);
    const currentHash = window.location.hash.toLowerCase();
    if (targetHash) {
      if ((activeScreen === "queue" || activeScreen === "admin") && (!authReady || !isAdmin)) {
        return;
      }
      if (currentHash !== targetHash) {
        window.location.hash = targetHash.slice(1);
      }
      return;
    }
    if (currentHash && HASH_TO_SCREEN[currentHash]) {
      const url = `${window.location.pathname}${window.location.search}`;
      window.history.replaceState(null, "", url);
    }
  }, [activeScreen, authReady, isAdmin]);

  useEffect(() => {
    if (activeScreen !== "report") return;
    if (!authReady || !user || user.isGuest || !showAdvanced) {
      setActiveScreen("map");
    }
  }, [activeScreen, authReady, user, showAdvanced]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const header = document.querySelector<HTMLElement>("[data-role='topbar']");
    if (!header) return;

    const updateHeight = () => {
      const next = Math.max(Math.round(header.getBoundingClientRect().height), 0) || DEFAULT_TOP_BAR_HEIGHT;
      setTopBarHeight(next);
    };

    updateHeight();
    const resizeObserver = new ResizeObserver(() => updateHeight());
    resizeObserver.observe(header);
    window.addEventListener("resize", updateHeight);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  const zipSelection = areaSelections.ZIP;
  const countySelection = areaSelections.COUNTY;
  const tractSelection = areaSelections.TRACT;
  const selectedZips = zipSelection.selected;
  const pinnedZips = zipSelection.pinned;
  const selectedCounties = countySelection.selected;
  const pinnedCounties = countySelection.pinned;
  const hoveredZip = hoveredArea?.kind === "ZIP" ? hoveredArea.id : null;
  const hoveredCounty = hoveredArea?.kind === "COUNTY" ? hoveredArea.id : null;
  const toolbarSelections: Record<AreaKind, AreaSelectionSnapshot | undefined> = {
    ZIP: { kind: "ZIP", selected: selectedZips, pinned: pinnedZips },
    COUNTY: { kind: "COUNTY", selected: selectedCounties, pinned: pinnedCounties },
    TRACT:
      tractSelection.selected.length > 0 || tractSelection.pinned.length > 0
        ? { kind: "TRACT", selected: tractSelection.selected, pinned: tractSelection.pinned }
        : undefined,
  };

  const applyAreaSelection = (kind: AreaKind, selection: AreaSelectionState) => {
    const normalized: AreaSelectionState = {
      selected: dedupeIds(selection.selected),
      pinned: dedupeIds(selection.pinned),
      transient: dedupeIds(selection.transient),
    };
    setAreaSelections((prev) => {
      const current = prev[kind];
      if (
        arraysEqual(current.selected, normalized.selected) &&
        arraysEqual(current.pinned, normalized.pinned) &&
        arraysEqual(current.transient, normalized.transient)
      ) {
        return prev;
      }
      return { ...prev, [kind]: normalized };
    });
  };

  const getAreaSelection = (kind: AreaKind): AreaSelectionState => areaSelections[kind];
  const setHoveredAreaState = (area: AreaId | null) => {
    setHoveredArea((prev) => {
      if (prev?.kind === area?.kind && prev?.id === area?.id) {
        return prev;
      }
      return area;
    });
  };

  const collapseSheet = useCallback(() => {
    setSheetState("peek");
    setSheetDragOffset(0);
    setIsDraggingSheet(false);
    sheetPointerIdRef.current = null;
    sheetDragStateRef.current = null;
    pendingContentDragRef.current = null;
  }, []);

  const expandSheet = useCallback(() => {
    setSheetState("expanded");
    setSheetDragOffset(0);
    setIsDraggingSheet(false);
    sheetPointerIdRef.current = null;
    sheetDragStateRef.current = null;
    pendingContentDragRef.current = null;
  }, []);

  const previewSheet = useCallback(() => {
    if (sheetPartialOffset <= 0) {
      expandSheet();
      return;
    }
    setSheetState("partial");
    setSheetDragOffset(0);
    setIsDraggingSheet(false);
    sheetPointerIdRef.current = null;
    sheetDragStateRef.current = null;
    pendingContentDragRef.current = null;
  }, [expandSheet, sheetPartialOffset]);

  const buildBoundsAroundPoint = useCallback((lng: number, lat: number) => {
    const lngDelta = isMobile ? 0.075 : 0.18;
    const latDelta = isMobile ? 0.045 : 0.12;
    return [
      [lng - lngDelta, lat - latDelta] as [number, number],
      [lng + lngDelta, lat + latDelta] as [number, number],
    ] as [[number, number], [number, number]];
  }, [isMobile]);

  const focusOnLocation = useCallback(
    (location: { lng: number; lat: number }) => {
      setActiveScreen("map");

      applyAreaSelection("ZIP", { selected: [], pinned: [], transient: [] });
      applyAreaSelection("COUNTY", { selected: [], pinned: [], transient: [] });

      const zipCode = findZipForLocation(location.lng, location.lat);
      if (zipCode) {
        applyAreaSelection("ZIP", {
          selected: [zipCode],
          pinned: [zipCode],
          transient: [],
        });
      }
      setBoundaryMode("zips");

      const controller = mapControllerRef.current;
      if (controller) {
        const bounds = buildBoundsAroundPoint(location.lng, location.lat);
        controller.fitBounds(bounds, { padding: isMobile ? 40 : 72, maxZoom: isMobile ? 13 : 11 });
      } else {
        const targetZoom = isMobile ? 12.6 : 10.5;
        mapControllerRef.current?.setCamera(location.lng, location.lat, targetZoom);
      }

      if (isMobile && sheetState !== "peek") {
        collapseSheet();
      }
    },
    [
      applyAreaSelection,
      buildBoundsAroundPoint,
      collapseSheet,
      isMobile,
      setBoundaryMode,
      sheetState,
    ],
  );

  const requestUserLocation = useCallback((): Promise<{ lng: number; lat: number }> => {
    return new Promise((resolve, reject) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        const error = "Geolocation is not supported in this browser.";
        setUserLocationError(error);
        reject(new Error(error));
        return;
      }
      if (isRequestingLocation) {
        reject(new Error("Location request already in progress"));
        return;
      }
      setIsRequestingLocation(true);
      setUserLocationError(null);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setIsRequestingLocation(false);
          const { longitude, latitude } = position.coords;
          const location = { lng: longitude, lat: latitude };
          setUserLocation(location);
          setUserLocationSource("device");
          lastDeviceLocationRef.current = location;
          setActiveScreen("map");
          resolve(location);
        },
        (error) => {
          setIsRequestingLocation(false);
          const errorMessage = error.message || "Unable to access your location.";
          setUserLocationError(errorMessage);
          reject(new Error(errorMessage));
        },
        {
          enableHighAccuracy: false,
          maximumAge: 60_000,
          timeout: 10_000,
        },
      );
    });
  }, [isRequestingLocation]);

  const focusUserLocation = useCallback(() => {
    const focusWithSelection = (location: { lng: number; lat: number }) => {
      setUserLocation(location);
      setUserLocationSource("device");
      focusOnLocation(location);
    };

    if (userLocationSource === "device" && userLocation) {
      focusOnLocation(userLocation);
      return;
    }

    const storedDeviceLocation = lastDeviceLocationRef.current;
    if (storedDeviceLocation) {
      focusWithSelection(storedDeviceLocation);
      void requestUserLocation().catch(() => {});
      return;
    }

    requestUserLocation()
      .then((location) => {
        focusWithSelection(location);
      })
      .catch(() => {});
  }, [focusOnLocation, requestUserLocation, userLocation, userLocationSource]);

  const startSheetDrag = useCallback(
    (pointerId: number, clientY: number, startState: "peek" | "partial" | "expanded") => {
      if (sheetPeekOffset <= 0) {
        expandSheet();
        return;
      }
      sheetPointerIdRef.current = pointerId;
      sheetDragStateRef.current = { startY: clientY, startState };
      // Don't set isDraggingSheet immediately - wait for movement beyond tap threshold
      // This allows click events to fire for taps on iOS
    },
    [expandSheet, sheetPeekOffset],
  );

  const finishSheetDrag = useCallback(
    (clientY: number | null) => {
      const dragState = sheetDragStateRef.current;
      sheetDragStateRef.current = null;
      sheetPointerIdRef.current = null;
      setIsDraggingSheet(false);
      setSheetDragOffset(0);
      if (!dragState || clientY === null || sheetPeekOffset <= 0) {
        if (sheetPeekOffset <= 0) expandSheet();
        return;
      }
      const delta = clientY - dragState.startY;
      if (dragState.startState === "expanded") {
        setSheetState(delta > MOBILE_SHEET_DRAG_THRESHOLD ? "peek" : "expanded");
      } else if (dragState.startState === "peek") {
        setSheetState(delta < -MOBILE_SHEET_DRAG_THRESHOLD ? "expanded" : "peek");
      } else {
        if (delta < -MOBILE_SHEET_DRAG_THRESHOLD) {
          setSheetState("expanded");
        } else if (delta > MOBILE_SHEET_DRAG_THRESHOLD) {
          setSheetState("peek");
        } else {
          setSheetState("partial");
        }
      }
    },
    [expandSheet, sheetPeekOffset],
  );

  const handleHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!isMobile) return;
      // Don't preventDefault immediately - let click events fire for taps
      // Only prevent default once actual dragging starts in pointermove
      startSheetDrag(event.pointerId, event.clientY, sheetState);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [isMobile, sheetState, startSheetDrag],
  );

  const handleHandleClick = useCallback(() => {
    if (!isMobile) return;
    if (sheetState === "peek") {
      expandSheet();
    } else if (sheetState === "partial") {
      expandSheet();
    } else {
      collapseSheet();
    }
  }, [collapseSheet, expandSheet, isMobile, sheetState]);

  const handleContentPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isMobile) return;
      if (sheetState === "partial") {
        startSheetDrag(event.pointerId, event.clientY, "partial");
        return;
      }
      if (sheetState !== "expanded") return;
      if (event.pointerType === "mouse" && event.buttons !== 1) return;
      const content = sheetContentRef.current;
      if (!content) return;
      if (content.scrollTop > 0) {
        pendingContentDragRef.current = null;
        return;
      }
      pendingContentDragRef.current = { pointerId: event.pointerId, startY: event.clientY };
    },
    [isMobile, sheetState, startSheetDrag],
  );

  const hydrateFromPersistedSelection = (sel: PersistedAreaSelection | null | undefined) => {
    if (!sel || typeof sel !== "object") return;
    const areaSelections = sel.areaSelections ?? {};
    const pickAreaConfig = (kind: AreaKind) =>
      areaSelections[kind] ??
      areaSelections[kind.toLowerCase()] ??
      areaSelections[kind.toUpperCase()];
    const sanitizeList = (value: unknown, fallback: string[]): string[] => {
      if (!Array.isArray(value)) return [...fallback];
      return value.filter((item): item is string => typeof item === "string");
    };

    const currentZip = getAreaSelection("ZIP");
    const zipConfig = pickAreaConfig("ZIP");
    const nextSelectedZips = sanitizeList(zipConfig?.selected ?? sel.zips, currentZip.selected);
    const nextPinnedZips = sanitizeList(zipConfig?.pinned ?? sel.pinned, currentZip.pinned);
    applyAreaSelection("ZIP", {
      selected: nextSelectedZips,
      pinned: nextPinnedZips,
      transient: [],
    });

    const currentCounty = getAreaSelection("COUNTY");
    const countyConfig = pickAreaConfig("COUNTY");
    const nextSelectedCounties = sanitizeList(countyConfig?.selected ?? sel.counties?.selected, currentCounty.selected);
    const nextPinnedCounties = sanitizeList(countyConfig?.pinned ?? sel.counties?.pinned, currentCounty.pinned);
    applyAreaSelection("COUNTY", {
      selected: nextSelectedCounties,
      pinned: nextPinnedCounties,
      transient: [],
    });

    if (sel.boundaryMode === "neighborhoods") setBoundaryMode("zips");
    else if (sel.boundaryMode === "zips" || sel.boundaryMode === "counties" || sel.boundaryMode === "none") {
      setBoundaryMode(sel.boundaryMode as BoundaryMode);
    }
    setBoundaryControlMode("auto");
  };

  useEffect(() => {
    if (!authReady) return;
    if (!isAdmin && (activeScreen === "queue" || activeScreen === "data" || activeScreen === "admin")) {
      setActiveScreen("map");
    }
  }, [authReady, isAdmin, activeScreen]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const readViewportHeight = () => {
      const viewport = window.visualViewport;
      return Math.round(viewport?.height ?? window.innerHeight);
    };
    const applyHeight = () => {
      setViewportHeight(readViewportHeight());
    };
    if (!isMobile) {
      applyHeight();
      return;
    }
    applyHeight();
    const viewport = window.visualViewport;
    viewport?.addEventListener("resize", applyHeight);
    viewport?.addEventListener("scroll", applyHeight);
    window.addEventListener("orientationchange", applyHeight);
    window.addEventListener("resize", applyHeight);
    return () => {
      viewport?.removeEventListener("resize", applyHeight);
      viewport?.removeEventListener("scroll", applyHeight);
      window.removeEventListener("orientationchange", applyHeight);
      window.removeEventListener("resize", applyHeight);
    };
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) {
      setSheetState("peek");
      setSheetDragOffset(0);
      setIsDraggingSheet(false);
      sheetPointerIdRef.current = null;
      sheetDragStateRef.current = null;
      pendingContentDragRef.current = null;
    }
  }, [isMobile]);

  useEffect(() => {
    if (sheetState === "peek" && sheetContentRef.current) {
      sheetContentRef.current.scrollTop = 0;
    }
  }, [sheetState]);

  useEffect(() => {
    if (!isMobile) return;
    if (sheetPeekOffset <= 0 && sheetState === "peek") {
      expandSheet();
    }
  }, [expandSheet, isMobile, sheetPeekOffset, sheetState]);

  useEffect(() => {
    if (!isMobile) return;
    if (sheetState !== "partial") return;
    // Collapse sheet if we don't have a small selection (1-3 orgs)
    if (selectedOrgIds.length < 1 || selectedOrgIds.length > 3) {
      collapseSheet();
    }
  }, [collapseSheet, isMobile, selectedOrgIds.length, sheetState]);

  const sheetTranslateY = useMemo(() => {
    if (!isMobile) return 0;
    if (sheetPeekOffset <= 0) return 0;
    if (sheetState === "expanded") {
      return Math.min(Math.max(sheetDragOffset, 0), sheetPeekOffset);
    }
    if (sheetState === "partial") {
      const maxDown = Math.max(0, sheetPeekOffset - sheetPartialOffset);
      const adjustment = Math.max(-sheetPartialOffset, Math.min(sheetDragOffset, maxDown));
      return sheetPartialOffset + adjustment;
    }
    const adjustment = Math.max(-sheetPeekOffset, Math.min(sheetDragOffset, 0));
    return sheetPeekOffset + adjustment;
  }, [isMobile, sheetState, sheetDragOffset, sheetPartialOffset, sheetPeekOffset]);

  const showMobileSheet = isMobile && activeScreen === "map";

  const legendInset = useMemo(() => {
    if (!isMobile) return 16;
    // Attach just above the sheet in peek state with a small gap
    if (sheetState === "peek" && !isDraggingSheet) {
      // The sheet wrapper is at topBarHeight, and the sheet itself has translateY
      // So the top of the sheet is at: topBarHeight + sheetTranslateY
      // Position legend row's bottom edge exactly at the sheet's top edge
      // Bottom position from bottom = viewportHeight - sheetTop
      const sheetTop = topBarHeight + sheetTranslateY;
      const legendBottom = viewportHeight - sheetTop;
      // Subtract a small amount to account for any CSS spacing/borders
      // This positions the legend row slightly overlapping or touching the sheet
      return Math.max(8, legendBottom - 60);
    }
    // Otherwise, keep safely near bottom; it will be hidden when dragging/expanded
    return 16;
  }, [isMobile, sheetState, isDraggingSheet, sheetTranslateY, viewportHeight, topBarHeight]);

  // Update legend position - use bottom positioning (simpler and accounts for legend row height)
  useEffect(() => {
    const controller = mapControllerRef.current;
    if (!controller) return;
    // Always use bottom positioning - it's simpler and accounts for legend row height naturally
    try { controller.setLegendInset(legendInset); } catch {}
  }, [legendInset]);

  useEffect(() => {
    if (!isMobile) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (pendingContentDragRef.current && event.pointerId === pendingContentDragRef.current.pointerId) {
        const delta = event.clientY - pendingContentDragRef.current.startY;
        if (delta > 6 && (sheetContentRef.current?.scrollTop ?? 0) <= 0) {
          const content = sheetContentRef.current;
          pendingContentDragRef.current = null;
          startSheetDrag(event.pointerId, event.clientY, "expanded");
          content?.setPointerCapture?.(event.pointerId);
        } else if (delta < -6) {
          pendingContentDragRef.current = null;
        }
      }

      // Check if we should enter dragging mode based on movement threshold
      if (!isDraggingSheet && sheetDragStateRef.current && event.pointerId === sheetPointerIdRef.current) {
        const delta = Math.abs(event.clientY - sheetDragStateRef.current.startY);
        if (delta > MOBILE_TAP_THRESHOLD) {
          setIsDraggingSheet(true);
        }
      }

      if (!isDraggingSheet) return;
      if (sheetPointerIdRef.current !== null && event.pointerId !== sheetPointerIdRef.current) return;
      const dragState = sheetDragStateRef.current;
      if (!dragState) return;
      const delta = event.clientY - dragState.startY;
      if (dragState.startState === "expanded") {
        const clamped = Math.max(0, Math.min(delta, sheetPeekOffset));
        setSheetDragOffset(clamped);
      } else if (dragState.startState === "peek") {
        const clamped = Math.max(-sheetPeekOffset, Math.min(delta, 0));
        setSheetDragOffset(clamped);
      } else {
        const maxDown = Math.max(0, sheetPeekOffset - sheetPartialOffset);
        const clamped = Math.max(-sheetPartialOffset, Math.min(delta, maxDown));
        setSheetDragOffset(clamped);
      }
      event.preventDefault();
    };

    const handlePointerEnd = (event: PointerEvent) => {
      if (pendingContentDragRef.current && event.pointerId === pendingContentDragRef.current.pointerId) {
        pendingContentDragRef.current = null;
      }
      if (!isDraggingSheet) return;
      if (sheetPointerIdRef.current !== null && event.pointerId !== sheetPointerIdRef.current) return;
      finishSheetDrag(event.clientY);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: false });
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
    };
  }, [isMobile, isDraggingSheet, finishSheetDrag, sheetPeekOffset, startSheetDrag]);

  // Check if welcome modal should be shown on food-map domains only.
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (!isFoodDomain) {
      setShowWelcomeModal(false);
      return;
    }

    // Feature flag: always show for testing if enabled
    if (ALWAYS_SHOW_WELCOME_MODAL) {
      setShowWelcomeModal(true);
      return;
    }

    // Normal behavior: check localStorage for dismissal
    try {
      const dismissed = localStorage.getItem("welcomeModal.dismissed");
      if (!dismissed) {
        setShowWelcomeModal(true);
      }
    } catch {}
  }, [isFoodDomain]);

  // Track map interaction: detect when user pans/zooms away from initial position
  useEffect(() => {
    if (!cameraState || hasInteractedWithMap) return;
    if (!sidebarFollowsMapRef.current) return;
    
    const initialCenter: [number, number] = [OKLAHOMA_CENTER.longitude, OKLAHOMA_CENTER.latitude];
    const initialZoom = OKLAHOMA_DEFAULT_ZOOM;
    const tolerance = 0.01; // Small tolerance for floating-point precision
    
    const { center, zoom } = cameraState;
    const centerDelta = Math.sqrt(
      Math.pow(center[0] - initialCenter[0], 2) + Math.pow(center[1] - initialCenter[1], 2)
    );
    const zoomDelta = Math.abs(zoom - initialZoom);
    
    // Mark as interacted if camera moved significantly from initial position
    if (centerDelta > tolerance || zoomDelta > tolerance) {
      setHasInteractedWithMap(true);
    }
  }, [cameraState, hasInteractedWithMap]);

  // Mark as interacted when user selects areas or orgs
  useEffect(() => {
    if (selectedZips.length > 0 || selectedCounties.length > 0) {
      setHasInteractedWithMap(true);
      return;
    }
    if (selectedOrgIdsFromMap && selectedOrgIds.length > 0) {
      setHasInteractedWithMap(true);
    }
  }, [selectedZips.length, selectedCounties.length, selectedOrgIds.length, selectedOrgIdsFromMap]);

  // Persisted UI state: load on auth ready
  useEffect(() => {
    if (!authReady) return;
    const owner = user?.id;
    const load = async () => {
      // Try server first
      if (owner) {
        try {
          const { data } = await db.queryOnce({
            uiState: {
              $: { where: { owner }, limit: 1, order: { updatedAt: "desc" } },
            },
          });
          const entry = (data as any)?.uiState?.[0];
          if (entry?.selection) {
            hydrateFromPersistedSelection(entry.selection as PersistedAreaSelection);
            return;
          }
        } catch {}
      }
      // Fallback to localStorage
      try {
        const raw = localStorage.getItem("uiState.selection");
        if (raw) {
          const sel = JSON.parse(raw) as PersistedAreaSelection;
          hydrateFromPersistedSelection(sel);
        } else {
          applyAreaSelection("COUNTY", { selected: [], pinned: [], transient: [] });
        }
      } catch {}
    };
    load();
    // only when auth readiness changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, user?.id]);

  // Persisted UI state: save with debounce
  useEffect(() => {
    if (!authReady) return;
    const owner = user?.id;
    const selection: PersistedAreaSelection = {
      version: 2,
      boundaryMode,
      areaSelections: {
        ZIP: { selected: [...selectedZips], pinned: [...pinnedZips] },
        COUNTY: { selected: [...selectedCounties], pinned: [...pinnedCounties] },
      },
      zips: [...selectedZips],
      pinned: [...pinnedZips],
      counties: { selected: [...selectedCounties], pinned: [...pinnedCounties] },
    };
    const updatedAt = Date.now();
    const timeout = setTimeout(() => {
      // Save to localStorage always for fast restore
      try {
        localStorage.setItem("uiState.selection", JSON.stringify(selection));
      } catch {}
      // Save to server for cross-device
      if (owner) {
        const id = owner; // one row per owner; use stable id
        db.transact(
          db.tx.uiState[id].update({ owner, selection, updatedAt })
        ).catch(() => {});
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [authReady, user?.id, selectedZips, pinnedZips, selectedCounties, pinnedCounties, boundaryMode]);

  const { areasByKindAndCode, getAreaLabel, getAreaRecord } = useAreas();

  const countyRecords = useMemo(
    () => Array.from(areasByKindAndCode.get("COUNTY")?.values() ?? []),
    [areasByKindAndCode],
  );
  const zipRecords = useMemo(
    () => Array.from(areasByKindAndCode.get("ZIP")?.values() ?? []),
    [areasByKindAndCode],
  );
  const defaultAreaContext = useMemo(() => {
    if (!cameraState || countyRecords.length === 0) return null;
    const { center, zoom } = cameraState;
    const [lng, lat] = center;

    const allCountyAreas = countyRecords.map((record) => ({
      kind: "COUNTY" as SupportedAreaKind,
      code: record.code,
    }));

    const stateContext = {
      label: "All Oklahoma",
      areas: allCountyAreas,
    };

    if (zoom < 8.5) return stateContext;

    const containsPoint = (bounds: [[number, number], [number, number]] | null | undefined) => {
      if (!bounds) return false;
      const [[minLng, minLat], [maxLng, maxLat]] = bounds;
      return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
    };

    const countyRecord = countyRecords.find((record) => containsPoint(record.bounds));
    if (!countyRecord) return stateContext;

    const isTulsaCounty = countyRecord.name?.toLowerCase() === "tulsa";
    if (isTulsaCounty && zoom >= 10 && zipRecords.length > 0) {
      return {
        label: "Tulsa",
        areas: zipRecords.map((record) => ({ kind: "ZIP" as SupportedAreaKind, code: record.code })),
      };
    }

    return {
      label: countyRecord.name ?? countyRecord.code,
      areas: [
        {
          kind: "COUNTY" as SupportedAreaKind,
          code: countyRecord.code,
        },
      ],
    };
  }, [cameraState, countyRecords, zipRecords]);

  const normalizedZipScope = normalizeScopeLabel(zipScope) ?? FALLBACK_ZIP_SCOPE;
  const defaultCountyScope = useMemo(
    () => normalizeScopeLabel(DEFAULT_PARENT_AREA_BY_KIND.COUNTY ?? "Oklahoma") ?? "Oklahoma",
    [],
  );
  const normalizedNeighborScopes = useMemo(() => {
    const set = new Set<string>();
    for (const scope of zipNeighborScopes) {
      const normalized = normalizeScopeLabel(scope);
      if (normalized) set.add(normalized);
    }
    return Array.from(set);
  }, [zipNeighborScopes]);

  const legendZipScopes = useMemo(() => {
    const set = new Set<string>();
    if (normalizedZipScope) set.add(normalizedZipScope);
    for (const scope of normalizedNeighborScopes) set.add(scope);
    return Array.from(set);
  }, [normalizedNeighborScopes, normalizedZipScope]);

  const relevantScopes = useMemo(() => {
    const set = new Set<string>();
    if (normalizedZipScope) set.add(normalizedZipScope);
    for (const scope of normalizedNeighborScopes) set.add(scope);
    if (set.size === 0) set.add(FALLBACK_ZIP_SCOPE);
    return Array.from(set);
  }, [normalizedZipScope, normalizedNeighborScopes]);

  const countyScopes = useMemo(() => {
    const set = new Set<string>();
    if (defaultCountyScope) set.add(defaultCountyScope);
    for (const scope of normalizedNeighborScopes) set.add(scope);
    if (normalizedZipScope) set.add(normalizedZipScope);
    return Array.from(set);
  }, [defaultCountyScope, normalizedNeighborScopes, normalizedZipScope]);

  const expandedZipScopes = useMemo(() => expandScopeAliases(relevantScopes), [relevantScopes]);
  const expandedCountyScopes = useMemo(() => expandScopeAliases(countyScopes), [countyScopes]);

  const [reportPriorityStatIds, setReportPriorityStatIds] = useState<string[]>([]);
  // Children of the selected stat — populated after statRelations load (one-render lag, self-stabilizing)
  const [selectedStatChildren, setSelectedStatChildren] = useState<string[]>([]);
  const priorityStatIds = useMemo(
    () =>
      [selectedStatId, secondaryStatId, ...selectedStatChildren, ...reportPriorityStatIds].filter(
        (id): id is string => typeof id === "string",
      ),
    [selectedStatId, selectedStatChildren, secondaryStatId, reportPriorityStatIds],
  );
  const allowBackgroundStatLoading = !lowMemoryMode && !reducedDataLoading;
  const enableTimeSeries =
    showAdvanced && (sidebarTab === "stats" || activeScreen === "report");
  const statDataProfile = useMemo(() => {
    // Smaller batches when time series is enabled — each stat fetches ALL historical dates,
    // so large batches cause massive queries that delay the selected stat's line chart.
    if (enableTimeSeries) {
      if (performanceTier === "low") return { initial: 1, batch: 1, cache: 14 };
      if (performanceTier === "medium") return { initial: 2, batch: 2, cache: 20 };
      return { initial: 3, batch: 2, cache: 24 };
    }
    if (performanceTier === "medium") return { initial: 10, batch: 10, cache: 20 };
    if (performanceTier === "low") return { initial: 6, batch: 6, cache: 14 };
    return { initial: 12, batch: 12, cache: 24 };
  }, [performanceTier, enableTimeSeries]);
  // Pause trickle loading when the user is actively viewing a stat chart to avoid
  // continuous recompute/re-render avalanches from background data streaming.
  const isViewingStatChart = showAdvanced && sidebarTab === "stats" && !!selectedStatId;
  const shouldPrefetchFullStatData =
    allowBackgroundStatLoading && (selectedZips.length > 0 || selectedCounties.length > 0) && !isViewingStatChart;
  // NOTE: Do NOT reduce maxCachedStatIds dynamically — shrinking the cache mid-session
  // creates an evict→reload→evict infinite loop ("Maximum update depth exceeded").
  const statDataCacheLimit = allowBackgroundStatLoading ? statDataProfile.cache : 10;
  const statDataInitialBatchSize = shouldPrefetchFullStatData ? statDataProfile.initial : 0;
  const statDataBatchSize = shouldPrefetchFullStatData ? statDataProfile.batch : 0;

  const summaryKinds = useMemo(() => {
    if (boundaryMode === "counties") return ["COUNTY"] as const;
    return ["ZIP"] as const;
  }, [boundaryMode]);

  const statMapsEnabled = !lowMemoryMode;
  const limitStatDataToScopes = lowMemoryMode || reducedDataLoading || !enableTimeSeries;
  const limitedStatBoundaryTypes = useMemo(() => {
    if (!limitStatDataToScopes) return undefined;
    const set = new Set<SupportedAreaKind>();
    if (selectedZips.length > 0) set.add("ZIP");
    if (selectedCounties.length > 0) set.add("COUNTY");
    if (set.size === 0) {
      for (const kind of summaryKinds) set.add(kind as SupportedAreaKind);
    }
    return Array.from(set);
  }, [limitStatDataToScopes, selectedZips.length, selectedCounties.length, summaryKinds]);

  const {
    statsById,
    seriesByStatIdByKind,
    seriesByStatIdByParent,
    statDataByParent,
    statDataSummaryByParent,
    statRelationsByParent,
    statRelationsByChild,
    pendingStatIds,
    isLoading: areStatsLoading,
    retryStatData,
  } = useStats({
    statDataEnabled: activeScreen !== "admin",
    statMapsEnabled,
    enableTimeSeries,
    priorityStatIds,
    categoryFilter,
    zipScopes: relevantScopes,
    countyScopes,
    summaryKinds: summaryKinds as any,
    initialBatchSize: statDataInitialBatchSize,
    batchSize: statDataBatchSize,
    enableTrickle: shouldPrefetchFullStatData,
    trickleDelayMs: enableTimeSeries ? 2000 : 0,
    maxCachedStatIds: statDataCacheLimit,
    limitStatDataToScopes,
    statDataBoundaryTypes: limitedStatBoundaryTypes,
    selectedStatId,
    selectedZipIds: selectedZips,
    selectedCountyIds: selectedCounties,
    viewerId: user?.id ?? null,
    isAdmin,
  });

  const isSelectedStatLoading = selectedStatId ? pendingStatIds.has(selectedStatId) : false;

  // Derive children of selected stat so they're included in priority batch for fast line charts
  useEffect(() => {
    if (!selectedStatId || !statRelationsByParent) {
      setSelectedStatChildren((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const byAttribute = statRelationsByParent.get(selectedStatId);
    if (!byAttribute) {
      setSelectedStatChildren((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    const children: string[] = [];
    const seen = new Set<string>();
    for (const relations of byAttribute.values()) {
      for (const rel of relations) {
        if (!seen.has(rel.childStatId)) {
          seen.add(rel.childStatId);
          children.push(rel.childStatId);
        }
      }
    }
    setSelectedStatChildren((prev) => {
      if (prev.length === children.length && prev.every((id, i) => id === children[i])) return prev;
      return children;
    });
  }, [selectedStatId, statRelationsByParent]);

  const visibleStatIds = useMemo(() => Array.from(statsById.keys()), [statsById]);

  useEffect(() => {
    if (areStatsLoading) return;
    if (!selectedStatId || statsById.has(selectedStatId)) return;
    setSelectedStatId(null);
  }, [areStatsLoading, selectedStatId, statsById]);

  useEffect(() => {
    if (areStatsLoading) return;
    if (!secondaryStatId || statsById.has(secondaryStatId)) return;
    setSecondaryStatId(null);
  }, [areStatsLoading, secondaryStatId, statsById]);

  useEffect(() => {
    if (activeScreen !== "report") {
      setReportPriorityStatIds((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    if (statsById.size === 0) return;

    const idsByName = new Map<string, string>();
    for (const stat of statsById.values()) {
      if (typeof stat.name === "string") idsByName.set(stat.name, stat.id);
    }

    const populationId = idsByName.get("Population") ?? null;
    const ageId = idsByName.get("Median Age") ?? idsByName.get("Average Age") ?? null;
    const marriedId = idsByName.get("Married Percent") ?? null;
    const featuredIds = Array.from(statsById.values())
      .filter((stat) => stat.featured === true && stat.visibility !== "inactive")
      .slice(0, 4)
      .map((stat) => stat.id);

    const nextSet = new Set<string>();
    if (populationId) nextSet.add(populationId);
    if (ageId) nextSet.add(ageId);
    if (marriedId) nextSet.add(marriedId);
    for (const id of featuredIds) nextSet.add(id);

    const next = Array.from(nextSet);

    setReportPriorityStatIds((prev) => {
      if (prev.length === next.length && prev.every((value, index) => value === next[index])) {
        return prev;
      }
      return next;
    });
  }, [activeScreen, statsById]);

  const { organizations } = useOrganizations();
  const { recentOrganizations } = useRecentOrganizations();
  const organizationSearchIndex = useMemo(
    () =>
      organizations
        .map((org) => {
          const normalized = new Set<string>();
          const addField = (value: string | null | undefined) => {
            if (!value) return;
            const normalizedValue = normalizeForSearch(value);
            if (normalizedValue) normalized.add(normalizedValue);
          };
          addField(org.name);
          addField(org.city ? `${org.city} ${org.name}` : null);
          addField(org.address ? `${org.name} ${org.address}` : null);
          addField(org.address ? `${org.address}` : null);
          addField(org.city ? `${org.city}` : null);
          return {
            org,
            normalizedPrimary: normalizeForSearch(org.name) ?? "",
            normalizedNames: Array.from(normalized),
          };
        })
        .filter((entry) => entry.normalizedPrimary.length > 0),
    [organizations],
  );

  const findOrganizationMatches = useCallback(
    (query: string, maxResults = 5) => {
      const normalizedQuery = normalizeForSearch(query);
      if (!normalizedQuery || normalizedQuery.length < 2) return [];

      const matches: { org: Organization; score: number }[] = [];

      for (const entry of organizationSearchIndex) {
        let entryScore = 0;

        if (entry.normalizedPrimary === normalizedQuery) {
          entryScore = 1.2;
        } else if (
          entry.normalizedPrimary.includes(normalizedQuery) ||
          normalizedQuery.includes(entry.normalizedPrimary)
        ) {
          entryScore = 1.05;
        } else {
          for (const name of entry.normalizedNames) {
            const score = computeSimilarityFromNormalized(name, normalizedQuery);
            if (score > entryScore) entryScore = score;
          }
        }

        if (entryScore >= ORGANIZATION_MATCH_THRESHOLD) {
          matches.push({ org: entry.org, score: entryScore });
        }
      }

      matches.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.org.name.localeCompare(b.org.name);
      });

      return matches.slice(0, Math.max(1, maxResults));
    },
    [organizationSearchIndex],
  );
  const searchSelectionLabel = useMemo(() => {
    if (!searchSelectionMeta) return null;
    if (searchSelectionMeta.ids.length === 1) return "SELECTED";
    const rawTerm = searchSelectionMeta.term?.trim();
    if (!rawTerm) return "RESULTS";
    const MAX_LEN = 36;
    const displayTerm = rawTerm.length > MAX_LEN ? `${rawTerm.slice(0, MAX_LEN - 1)}…` : rawTerm;
    return `RESULTS (${displayTerm})`;
  }, [searchSelectionMeta]);
  const selectionStyleVariant: "default" | "searchResults" =
    searchSelectionMeta && searchSelectionMeta.ids.length > 1 ? "searchResults" : "default";

  const areaNameLookup = useMemo(
    () => (kind: SupportedAreaKind, code: string) => getAreaLabel(kind, code) ?? code,
    [getAreaLabel],
  );

  const getZipParentCounty = useMemo(
    () => (zipCode: string): { code: string; name: string } | null => {
      const zipRecord = getAreaRecord("ZIP", zipCode);
      if (!zipRecord?.parentCode) return null;
      // parentCode stores the county name (e.g., "Tulsa"), not the FIPS code
      // Use it directly as both code and name for grouping/display
      return { code: zipRecord.parentCode, name: zipRecord.parentCode };
    },
    [getAreaRecord],
  );

  const { combinedSnapshot, demographicsByKind } = useDemographics({
    selectedByKind: {
      ZIP: selectedZips,
      COUNTY: selectedCounties,
    },
    defaultContext: defaultAreaContext,
    zipScope,
    getZipParentCounty,
  });

  const selectedAreasMap = useMemo(
    () => ({ ZIP: selectedZips, COUNTY: selectedCounties }),
    [selectedZips, selectedCounties],
  );

  const allSelectedAreas = useMemo(
    () => [
      ...selectedZips.map<AreaId>((zip) => ({ kind: "ZIP", id: zip })),
      ...selectedCounties.map<AreaId>((county) => ({ kind: "COUNTY", id: county })),
    ],
    [selectedCounties, selectedZips],
  );

  const activeAreaKind: SupportedAreaKind | null = useMemo(() => {
    if (boundaryMode === "zips") return "ZIP";
    if (boundaryMode === "counties") return "COUNTY";
    return null;
  }, [boundaryMode]);

  const activeSelectedCodes = useMemo(() => {
    if (!activeAreaKind) return [] as string[];
    return activeAreaKind === "ZIP" ? selectedZips : selectedCounties;
  }, [activeAreaKind, selectedCounties, selectedZips]);

  const selectedAreasForReport = useMemo(
    () =>
      activeAreaKind
        ? activeSelectedCodes.map<AreaId>((code) => ({ kind: activeAreaKind, id: code }))
        : [],
    [activeAreaKind, activeSelectedCodes],
  );

  const autoBoundarySwitch = boundaryControlMode === "auto";

  useEffect(() => {
    if (!autoBoundarySwitch || !cameraState) return;
    const { zoom } = cameraState;
    let nextMode = boundaryMode;
    if (zoom <= COUNTY_MODE_ENABLE_ZOOM) nextMode = "counties";
    else if (zoom >= COUNTY_MODE_DISABLE_ZOOM) nextMode = "zips";
    if (nextMode !== boundaryMode) {
      setBoundaryMode(nextMode);
    }
  }, [autoBoundarySwitch, cameraState, boundaryMode]);

  // Compute areasMode from boundaryControlMode and boundaryMode for URL
  const areasMode: AreasMode = boundaryControlMode === "auto" ? "auto" : boundaryMode;

  // Keep URL in sync with shareable map state.
  useEffect(() => {
    if (!cameraState) return;
    const [lng, lat] = cameraState.center;
    updateUrlWithMapState(
      lat,
      lng,
      cameraState.zoom,
      selectedStatId,
      secondaryStatId,
      categoryFilter,
      selectedOrgIds,
      showAdvanced,
      orgPinsVisible,
      areasMode,
      selectedZips,
      selectedCounties,
      sidebarTab,
      sidebarInsightsState,
      persistSidebarInsights,
      sidebarCollapsed,
    );
  }, [
    cameraState,
    selectedStatId,
    secondaryStatId,
    categoryFilter,
    selectedOrgIds,
    showAdvanced,
    orgPinsVisible,
    areasMode,
    selectedZips,
    selectedCounties,
    sidebarTab,
    sidebarInsightsState,
    persistSidebarInsights,
    sidebarCollapsed,
  ]);

  const mergeStatEntry = (
    existing: StatBoundaryEntry | undefined,
    incoming: StatBoundaryEntry,
  ): StatBoundaryEntry => {
    const data = { ...(existing?.data ?? {}), ...incoming.data };
    const values = Object.values(data).filter(
      (value): value is number => typeof value === "number" && Number.isFinite(value),
    );
    return {
      type: existing?.type ?? incoming.type,
      data,
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 0,
    };
  };

  const statDataByStatId = useMemo(() => {
    const map = new Map<string, Partial<Record<"ZIP" | "COUNTY", StatBoundaryEntry>>>();
    for (const [statId, byParent] of statDataByParent.entries()) {
      const aggregate: Partial<Record<"ZIP" | "COUNTY", StatBoundaryEntry>> = {};

      // ZIP-level data: prefer county-scoped buckets for the current context,
      // but fall back to the statewide "Oklahoma" bucket when no scoped rows
      // exist (e.g., newly imported Census stats that only write a root ZIP
      // payload with parentArea="Oklahoma").
      let hasScopedZip = false;
      for (const scope of expandedZipScopes) {
        const entry = byParent.get(scope);
        const incoming = entry?.ZIP;
        if (incoming) {
          hasScopedZip = true;
          aggregate.ZIP = mergeStatEntry(aggregate.ZIP, incoming);
        }
      }

      if (!hasScopedZip) {
        const statewide = byParent.get(FALLBACK_ZIP_SCOPE)?.ZIP;
        if (statewide) {
          aggregate.ZIP = mergeStatEntry(aggregate.ZIP, statewide);
        }
      }

      if (aggregate.ZIP) {
        let legendMin = Number.POSITIVE_INFINITY;
        let legendMax = Number.NEGATIVE_INFINITY;

        if (legendRangeMode === "global") {
          for (const parentEntry of byParent.values()) {
            const entry = parentEntry?.ZIP;
            if (!entry) continue;
            for (const value of Object.values(entry.data ?? {})) {
              if (typeof value === "number" && Number.isFinite(value)) {
                if (value < legendMin) legendMin = value;
                if (value > legendMax) legendMax = value;
              }
            }
          }
        } else {
          // dynamic/scoped: base on scoped counties (and neighbors)
          const scopesForLegend = expandScopeAliases(
            legendZipScopes.length > 0 ? legendZipScopes : [normalizedZipScope ?? FALLBACK_ZIP_SCOPE],
          );
          for (const scope of scopesForLegend) {
            const entry = byParent.get(scope)?.ZIP;
            if (!entry) continue;
            for (const value of Object.values(entry.data ?? {})) {
              if (typeof value === "number" && Number.isFinite(value)) {
                if (value < legendMin) legendMin = value;
                if (value > legendMax) legendMax = value;
              }
            }
          }
        }

        if (Number.isFinite(legendMin) && Number.isFinite(legendMax)) {
          aggregate.ZIP = { ...aggregate.ZIP, min: legendMin, max: legendMax };
        }
      }

      // COUNTY-level data already includes the default statewide bucket via
      // countyScopes (which contains the normalized DEFAULT_PARENT_AREA_BY_KIND.COUNTY)
      // plus any nearby county scopes.
      for (const scope of expandedCountyScopes) {
        const entry = byParent.get(scope);
        const incoming = entry?.COUNTY;
        if (incoming) {
          aggregate.COUNTY = mergeStatEntry(aggregate.COUNTY, incoming);
        }
      }

      if (Object.keys(aggregate).length > 0) {
        map.set(statId, aggregate);
      }
    }
    return map;
  }, [statDataByParent, expandedZipScopes, expandedCountyScopes, normalizedZipScope, legendZipScopes, legendRangeMode]);

  type StatSummaryEntry = {
    type: string;
    date: string;
    count: number;
    sum: number;
    avg: number;
    min: number;
    max: number;
  };

  const statSummariesByStatId = useMemo(() => {
    const mergeSummary = (
      existing: StatSummaryEntry | undefined,
      incoming: StatSummaryEntry,
    ): StatSummaryEntry => {
      const count = (existing?.count ?? 0) + (incoming.count ?? 0);
      const sum = (existing?.sum ?? 0) + (incoming.sum ?? 0);
      const avg = count > 0 ? sum / count : 0;
      const min = existing ? Math.min(existing.min, incoming.min) : incoming.min;
      const max = existing ? Math.max(existing.max, incoming.max) : incoming.max;
      const date = existing && existing.date.localeCompare(incoming.date) >= 0 ? existing.date : incoming.date;
      return {
        type: existing?.type ?? incoming.type,
        date,
        count,
        sum,
        avg,
        min: Number.isFinite(min) ? min : 0,
        max: Number.isFinite(max) ? max : 0,
      };
    };

    const map = new Map<string, Partial<Record<"ZIP" | "COUNTY", StatSummaryEntry>>>();
    for (const [statId, byParent] of statDataSummaryByParent.entries()) {
      const aggregate: Partial<Record<"ZIP" | "COUNTY", StatSummaryEntry>> = {};

      let hasScopedZip = false;
      for (const scope of relevantScopes) {
        const incoming = byParent.get(scope)?.ZIP as StatSummaryEntry | undefined;
        if (incoming) {
          hasScopedZip = true;
          aggregate.ZIP = mergeSummary(aggregate.ZIP, incoming);
        }
      }
      if (!hasScopedZip) {
        const statewide = byParent.get(FALLBACK_ZIP_SCOPE)?.ZIP as StatSummaryEntry | undefined;
        if (statewide) {
          aggregate.ZIP = mergeSummary(aggregate.ZIP, statewide);
        }
      }

      for (const scope of countyScopes) {
        const incoming = byParent.get(scope)?.COUNTY as StatSummaryEntry | undefined;
        if (incoming) {
          aggregate.COUNTY = mergeSummary(aggregate.COUNTY, incoming);
        }
      }

      if (Object.keys(aggregate).length > 0) {
        map.set(statId, aggregate);
      }
    }
    return map;
  }, [countyScopes, relevantScopes, statDataSummaryByParent]);

  const zipScopeDisplayName = useMemo(() => {
    if (!normalizedZipScope) return null;
    const aliases = buildScopeLabelAliases(normalizedZipScope);
    const best = aliases.find((alias) => !/county$/i.test(alias)) ?? normalizedZipScope;
    return best.toUpperCase();
  }, [normalizedZipScope]);

  const countyScopeDisplayName = useMemo(() => {
    if (!defaultCountyScope) return null;
    return defaultCountyScope.toUpperCase();
  }, [defaultCountyScope]);

  const pinnedAreasMap = useMemo(
    () => ({ ZIP: pinnedZips, COUNTY: pinnedCounties }),
    [pinnedZips, pinnedCounties],
  );

  const activeDemographicsSnapshot = useMemo(() => {
    if (!activeAreaKind) return null;
    const entry = demographicsByKind.get(activeAreaKind);
    if (!entry) return null;
    const count = entry.stats?.selectedCount ?? activeSelectedCodes.length;
    const label = entry.stats?.label
      ?? (count > 1
        ? `${count} ${activeAreaKind === "ZIP" ? "ZIPs" : "Counties"}`
        : count === 1
        ? areaNameLookup(activeAreaKind, activeSelectedCodes[0])
        : activeAreaKind === "ZIP"
        ? zipScopeDisplayName
          ? `${zipScopeDisplayName} ZIPs`
          : "ZIPs"
        : countyScopeDisplayName
        ? `${countyScopeDisplayName} COUNTIES`
        : "Counties");
    return {
      label,
      stats: entry.stats,
      breakdowns: entry.breakdowns,
      isMissing: entry.isMissing,
      areaCount: count,
      missingAreaCount: 0,
    } as CombinedDemographicsSnapshot;
  }, [
    activeAreaKind,
    activeSelectedCodes,
    areaNameLookup,
    demographicsByKind,
    countyScopeDisplayName,
    zipScopeDisplayName,
  ]);
  // areasByKey removed; population/age/married now sourced from statData
  const orgZipById = useMemo(() => {
    const map = new Map<string, string | null>();
    const normalizePostal = (value: string | null | undefined): string | null => {
      if (!value) return null;
      const match = value.match(/\b\d{5}\b/);
      return match ? match[0] : null;
    };
    for (const org of organizations) {
      const postal = normalizePostal(org.postalCode);
      if (postal) {
        map.set(org.id, postal);
        continue;
      }
      const resolved = findZipForLocation(org.longitude, org.latitude);
      map.set(org.id, resolved);
    }
    return map;
  }, [organizations]);

  const orgCountyById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const o of organizations) {
      const county = findCountyForLocation(o.longitude, o.latitude);
      map.set(o.id, county);
    }
    return map;
  }, [organizations]);

  const activeOrganizations = useMemo(
    () => organizations.filter((org) => !org.status || org.status === "active"),
    [organizations],
  );

  const availableOrganizations = useMemo(
    () => {
      if (!timeSelection) return activeOrganizations;
      return activeOrganizations.filter((org) => isOrganizationOpenAtTime(org, timeSelection));
    },
    [activeOrganizations, timeSelection],
  );
  const categoryScopedOrganizations = useMemo(() => {
    if (!categoryFilter) return availableOrganizations;
    return availableOrganizations.filter((org) => org.category === categoryFilter);
  }, [availableOrganizations, categoryFilter]);

  const orgCountsByCounty = useMemo(() => {
    const counts = new Map<string, number>();
    for (const org of categoryScopedOrganizations) {
      const county = orgCountyById.get(org.id);
      if (!county) continue;
      counts.set(county, (counts.get(county) ?? 0) + 1);
    }
    return counts;
  }, [categoryScopedOrganizations, orgCountyById]);

  // Derive viewport county org count from zipScope (viewport-dominance based, not center-point)
  const zipScopeCountyCode = useMemo(() => {
    if (!normalizedZipScope) return null;
    return getCountyCodeByName(normalizedZipScope) ?? null;
  }, [normalizedZipScope]);

  const viewportCountyOrgCount = zipScopeCountyCode
    ? orgCountsByCounty.get(zipScopeCountyCode) ?? 0
    : null;

  const inactiveOrganizations = useMemo(
    () => organizations.filter((org) => org.status && org.status !== "active"),
    [organizations],
  );

  // Determine if any organizations in the current data source have hours information.
  // Used to decide whether the "Hours Open" chip should be shown.
  const hasAnyHoursInSource = useMemo(() => {
    if (!organizations || organizations.length === 0) return false;
    const hasHours = (org: Organization): boolean => {
      const periods = org.hours?.periods;
      if (!Array.isArray(periods) || periods.length === 0) return false;
      return periods.some((p) => Boolean(p.openTime || p.closeTime));
    };
    const idSet = new Set(orgsAllSourceIds);
    if (idSet.size === 0) {
      return organizations.some(hasHours);
    }
    return organizations.some((org) => idSet.has(org.id) && hasHours(org));
  }, [organizations, orgsAllSourceIds]);

  const seriesByStatIdScoped = useMemo(() => {
    const map = new Map<string, SeriesByKind>();

    const mergeSeriesInto = (
      bucketMap: Map<string, SeriesEntry>,
      entries: SeriesEntry[] | undefined,
    ) => {
      if (!entries) return;
      for (const entry of entries) {
        const key = entry.date;
        const existing = bucketMap.get(key);
        if (!existing) {
          bucketMap.set(key, {
            date: entry.date,
            type: entry.type,
            data: { ...(entry.data ?? {}) },
            parentArea: entry.parentArea ?? null,
          });
          continue;
        }
        const mergedData = {
          ...existing.data,
          ...(entry.data ?? {}),
        };
        bucketMap.set(key, {
          date: existing.date,
          type: existing.type || entry.type,
          data: mergedData,
          parentArea: existing.parentArea ?? entry.parentArea ?? null,
        });
      }
    };

    for (const [statId, byParent] of seriesByStatIdByParent.entries()) {
      const buckets = new Map<SupportedAreaKind, Map<string, SeriesEntry>>();

      for (const scope of expandedZipScopes) {
        const scopeEntry = byParent.get(scope);
        if (!scopeEntry) continue;
        const zipBucket = buckets.get("ZIP") ?? new Map<string, SeriesEntry>();
        mergeSeriesInto(zipBucket, scopeEntry.get("ZIP"));
        if (zipBucket.size > 0) {
          buckets.set("ZIP", zipBucket);
        }
      }

      for (const scope of expandedCountyScopes) {
        const scopeEntry = byParent.get(scope);
        if (!scopeEntry) continue;
        const countyBucket = buckets.get("COUNTY") ?? new Map<string, SeriesEntry>();
        mergeSeriesInto(countyBucket, scopeEntry.get("COUNTY"));
        if (countyBucket.size > 0) {
          buckets.set("COUNTY", countyBucket);
        }
      }

      if (buckets.size === 0) continue;

      const normalized = new Map<SupportedAreaKind, SeriesEntry[]>();
      for (const [kind, byDate] of buckets.entries()) {
        const series = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
        if (series.length > 0) {
          normalized.set(kind, series);
        }
      }

      if (normalized.size > 0) {
        map.set(statId, normalized);
      }
    }
    return map;
  }, [seriesByStatIdByParent, expandedZipScopes, expandedCountyScopes]);

  useEffect(() => {
    if (hasAppliedDefaultStat) return;
    // If stat was already set from URL, skip applying defaults
    if (selectedStatId) {
      setHasAppliedDefaultStat(true);
      return;
    }
    const allStats = Array.from(statsById.values());

    // Helper: first stat marked as homeFeatured + featured + active
    const pickHomeFeatured = () =>
      allStats.find((s) => s.homeFeatured === true && s.featured === true && s.visibility !== "inactive") ?? null;
    const pickConfiguredStat = () => {
      for (const id of domainDefaults.defaultStatIds) {
        if (!id) continue;
        const stat = statsById.get(id);
        if (stat && stat.visibility !== "inactive") return stat.id;
      }
      for (const name of domainDefaults.defaultStatNames) {
        const match = allStats.find(
          (s) =>
            (s.name === name || s.label === name) &&
            s.visibility !== "inactive",
        );
        if (match?.id) return match.id;
      }
      return null;
    };

    if (isFoodDomain) {
      const configuredStatId = pickConfiguredStat();
      if (configuredStatId) {
        setSelectedStatId(configuredStatId);
        setHasAppliedDefaultStat(true);
        return;
      }

      // Fallback on okfoodmap.com: use a homeFeatured stat if configured
      const homeDefault = pickHomeFeatured();
      if (homeDefault) {
        setSelectedStatId(homeDefault.id);
        setHasAppliedDefaultStat(true);
        return;
      }

      if (!areStatsLoading) {
        setHasAppliedDefaultStat(true);
      }
      return;
    }

    // Non-okfood domains: prefer domain-configured stat, then homeFeatured if present
    const configuredStatId = pickConfiguredStat();
    if (configuredStatId) {
      setSelectedStatId(configuredStatId);
      setHasAppliedDefaultStat(true);
      return;
    }

    const homeDefault = pickHomeFeatured();
    if (homeDefault) {
      setSelectedStatId(homeDefault.id);
      setHasAppliedDefaultStat(true);
      return;
    }

    if (!areStatsLoading) {
      setHasAppliedDefaultStat(true);
    }
  }, [areStatsLoading, hasAppliedDefaultStat, statsById]);

  // When the stat changes, clear any map-driven org selection so the views stay in sync.
  const previousSelectedStatIdRef = useRef<string | null>(null);
  useEffect(() => {
    const previousStatId = previousSelectedStatIdRef.current;
    const statChanged = selectedStatId !== previousStatId;
    if (
      statChanged &&
      selectedStatId &&
      selectedOrgIdsFromMap &&
      selectedOrgIds.length > 0
    ) {
      setSelectedOrgIds([]);
      setSelectedOrgIdsFromMap(false);
    }
    previousSelectedStatIdRef.current = selectedStatId ?? null;
  }, [selectedStatId, selectedOrgIdsFromMap, selectedOrgIds.length]);

  useEffect(() => {
    if (!searchSelectionMeta) return;
    if (!arraysEqual(searchSelectionMeta.ids, selectedOrgIds)) {
      setSearchSelectionMeta(null);
    }
  }, [searchSelectionMeta, selectedOrgIds]);

  const [zoomOutNonce, setZoomOutNonce] = useState(0);
  // Nonce to explicitly clear map category chips when clearing stat from sidebar
  const [clearMapCategoryNonce] = useState(0);
  // Nonce to force Sidebar switch to Statistics and hide orgs toggle
  const [forceHideOrgsNonce, setForceHideOrgsNonce] = useState(0);
  const [forceShowOrgsNonce, setForceShowOrgsNonce] = useState(0);

  const handleBrandClick = () => {
    // Reset all URL-driven state to defaults
    setSelectedStatId(null);
    setHasAppliedDefaultStat(false); // allow default stat to re-apply
    setSecondaryStatId(null);
    setCategoryFilter(null);
    setSelectedOrgIds([]);
    setShowAdvanced(false);
    setOrgPinsVisible(true);
    setForceShowOrgsNonce((n) => n + 1); // reset sidebar's keepOrgsOnMap + switch to orgs tab
    setBoundaryMode("zips");
    setBoundaryControlMode("auto");
    applyAreaSelection("ZIP", { selected: [], pinned: [], transient: [] });
    applyAreaSelection("COUNTY", { selected: [], pinned: [], transient: [] });
    setSidebarTab("orgs");
    setSidebarCollapsed(true);
    setSidebarInsightsState({
      statVizVisible: true,
      statVizCollapsed: false,
      demographicsVisible: true,
      demographicsExpanded: false,
    });
    setActiveScreen("map");
    const controller = mapControllerRef.current;
    if (controller) {
      controller.setCamera(
        OKLAHOMA_CENTER.longitude,
        OKLAHOMA_CENTER.latitude,
        OKLAHOMA_DEFAULT_ZOOM,
      );
    }
    // Clear all URL params to reset to base state
    window.history.replaceState(null, "", window.location.pathname);
  };

  const handleOpenAddOrganization = useCallback(() => {
    setActiveScreen("addOrg");
    if (isMobile) {
      collapseSheet();
    }
  }, [collapseSheet, isMobile]);

  const handleOrganizationCreated = useCallback(
    (organization: { id: string; latitude: number; longitude: number }) => {
      setActiveScreen("map");
      setActiveOrganizationId(organization.id);
      setHighlightedOrganizationIds([organization.id]);
      setOrgPinsVisible(true);
      const controller = mapControllerRef.current;
      if (controller) {
        const zoomLevel = isMobile ? 13.2 : 14.6;
        const latOffset = isMobile ? 0.01 : 0.006;
        controller.setCamera(
          organization.longitude,
          organization.latitude + latOffset,
          zoomLevel,
        );
      }
      if (isMobile) {
        previewSheet();
      }
    },
    [isMobile, previewSheet],
  );

  const handleCloseAddOrganization = useCallback(() => {
    setActiveScreen("map");
  }, []);

  const handleFindNearbyOrg = useCallback(async () => {
    // First try to get user's location
    try {
      const location = await requestUserLocation();
      setUserLocation(location);
      setUserLocationSource("device");
      focusOnLocation(location);
    } catch (error) {
      // Location failed, open zip search modal on desktop or expand mobile search on mobile
      if (isMobile) {
        setExpandMobileSearch(true);
        setTimeout(() => setExpandMobileSearch(false), 200);
      } else {
        setShowZipSearchModal(true);
      }
    }
  }, [focusOnLocation, isMobile, requestUserLocation, setUserLocation, setUserLocationSource]);

  const handleHover = useCallback((idOrIds: string | string[] | null) => {
    if (Array.isArray(idOrIds)) {
      setHighlightedOrganizationIds(idOrIds);
      return;
    }
    setHighlightedOrganizationIds(null);
    setActiveOrganizationId(idOrIds);
  }, []);

  type SelectOrganizationOptions = {
    treatAsMapSelection?: boolean;
    source?: "map" | "sidebar";
  };

  const selectOrganization = useCallback(
    (id: string, options: SelectOrganizationOptions = {}) => {
      if (!id) return;
      const { treatAsMapSelection = false, source = "map" } = options;
      if (searchSelectionMeta) {
        setSearchSelectionMeta(null);
      }
      const shouldFollowMap = treatAsMapSelection || source === "map";
      setSidebarFollowMode(shouldFollowMap ? "map" : "sidebar");
      // Switch to orgs tab when clicking org from map (both mobile and desktop)
      if (source === "map" && sidebarTab !== "orgs") {
        setSidebarTab("orgs");
      }
      // On desktop, always reveal the sidebar when selecting an org from the map.
      if (source === "map" && !isMobile) {
        setSidebarCollapsed(false);
      }

      // Check if clicking the same organization that's already selected (second click)
      const isAlreadySelected = selectedOrgIds.length === 1 && selectedOrgIds[0] === id;

      // On mobile, re-open the sheet if it's hidden (peek state) even when reselecting the same org
      if (
        isAlreadySelected &&
        isMobile &&
        sheetState === "peek" &&
        treatAsMapSelection
      ) {
        setActiveScreen("map");
        setActiveOrganizationId(id);
        setHighlightedOrganizationIds(null);
        setSelectedOrgIds([id]);
        setSelectedOrgIdsFromMap(true);
        previewSheet();
        return;
      }

      // On second click of already-selected org: zoom in further
      if (isAlreadySelected && cameraState) {
        const controller = mapControllerRef.current;
        if (controller) {
          // Calculate target zoom: zoom in by 2-3 levels, but cap at reasonable maximum
          const currentZoom = cameraState.zoom;
          const zoomIncrement = 2.5;
          const maxZoom = isMobile ? 14.5 : 13.5;
          const targetZoom = Math.min(currentZoom + zoomIncrement, maxZoom);

          // Ensure the org stays selected while preserving whether the interaction came from the map or sidebar
          setSelectedOrgIds([id]);
          setSelectedOrgIdsFromMap(treatAsMapSelection);

          // Use centerOnOrganization for smooth animated zoom
          if (source === "sidebar") {
            skipSidebarCenteringRef.current = true;
          }
          controller.centerOnOrganization(id, { animate: true, zoom: targetZoom });
          track("map_organization_double_click_zoom", {
            organizationId: id,
            device: isMobile ? "mobile" : "desktop",
            source,
            fromZoom: currentZoom,
            toZoom: targetZoom,
          });
          if (isMobile && source === "sidebar") {
            // Collapse the sheet so the zoom change is visible on mobile sidebar interactions
            collapseSheet();
          }
          return;
        }
      }

      // First click: select the organization normally
      track("map_organization_click", {
        organizationId: id,
        device: isMobile ? "mobile" : "desktop",
        source,
      });
      setActiveScreen("map");
      setActiveOrganizationId(id);
      setHighlightedOrganizationIds(null);
      // Set this org as the only selected org (direct selection takes priority over area selection)
      setSelectedOrgIds([id]);
      setSelectedOrgIdsFromMap(treatAsMapSelection);
      if (isMobile) {
        previewSheet();
      }
    },
    [
      cameraState,
      collapseSheet,
      searchSelectionMeta,
      isMobile,
      previewSheet,
      selectedOrgIds,
      setSidebarFollowMode,
      sidebarTab,
      setSidebarTab,
      setSidebarCollapsed,
      sheetState,
      setSearchSelectionMeta,
    ],
  );

  const handleOrganizationClick = useCallback(
    (id: string, _meta?: { source: "point" | "centroid" }) => {
      selectOrganization(id, { treatAsMapSelection: true, source: "map" });
    },
    [selectOrganization],
  );

  const handleSidebarOrganizationClick = useCallback(
    (id: string) => {
      const preserveMapSelection = selectedOrgIdsFromMap && selectedOrgIds.includes(id);
      selectOrganization(id, {
        treatAsMapSelection: preserveMapSelection,
        source: "sidebar",
      });
    },
    [selectOrganization, selectedOrgIds, selectedOrgIdsFromMap],
  );

  const handleZoomToOrg = useCallback(
    (id: string) => {
      const preserveMapSelection = selectedOrgIdsFromMap && selectedOrgIds.includes(id);
      if (searchSelectionMeta) {
        setSearchSelectionMeta(null);
      }
      setSidebarFollowMode(preserveMapSelection ? "map" : "sidebar");
      const controller = mapControllerRef.current;
      if (controller && cameraState) {
        // Calculate target zoom: zoom in by 2-3 levels, but cap at reasonable maximum
        const currentZoom = cameraState.zoom;
        const zoomIncrement = 2.5;
        const maxZoom = isMobile ? 14.5 : 13.5;
        const targetZoom = Math.min(currentZoom + zoomIncrement, maxZoom);

        // Ensure the org is selected so the sidebar reflects the zoom target
        setSelectedOrgIds([id]);
        setSelectedOrgIdsFromMap(preserveMapSelection);

        skipSidebarCenteringRef.current = true;
        controller.centerOnOrganization(id, { animate: true, zoom: targetZoom });
        track("map_organization_zoom_button_click", {
          organizationId: id,
          device: isMobile ? "mobile" : "desktop",
          fromZoom: currentZoom,
          toZoom: targetZoom,
        });
        if (isMobile) {
          // Zoom button is in the sidebar; collapsing reveals the map on mobile
          collapseSheet();
        }
      }
    },
    [
      cameraState,
      collapseSheet,
      isMobile,
      selectedOrgIds,
      selectedOrgIdsFromMap,
      searchSelectionMeta,
      setSidebarFollowMode,
      setSearchSelectionMeta,
    ],
  );

  const handleClusterClick = useCallback(
    (ids: string[], _meta: { count: number; longitude: number; latitude: number }) => {
      if (!Array.isArray(ids) || ids.length === 0) return;
      setSidebarFollowMode("map");
      const uniqueIds = dedupeIds(ids);
      track("map_cluster_click", {
        organizationCount: uniqueIds.length,
        clusterAction: uniqueIds.length <= 3 ? "select" : "highlight",
        device: isMobile ? "mobile" : "desktop",
      });
      setActiveScreen("map");
      // Switch to orgs tab when clicking small cluster (both mobile and desktop)
      if (uniqueIds.length <= 3 && sidebarTab !== "orgs") {
        setSidebarTab("orgs");
      }
      // On desktop, reveal the sidebar when selecting a small cluster from the map.
      if (uniqueIds.length <= 3 && !isMobile) {
        setSidebarCollapsed(false);
      }
      if (uniqueIds.length === 1) {
        setActiveOrganizationId(uniqueIds[0]);
        setHighlightedOrganizationIds(null);
        // Single org in cluster - select it
        setSelectedOrgIds([uniqueIds[0]]);
        setSelectedOrgIdsFromMap(true);
      } else if (uniqueIds.length <= 3) {
        // Small cluster (2-3 orgs) - select all orgs in cluster
        setActiveOrganizationId(null);
        setHighlightedOrganizationIds(uniqueIds);
        setSelectedOrgIds(uniqueIds);
        setSelectedOrgIdsFromMap(true);
      } else {
        // Large cluster (>3 orgs) - just highlight, don't change selection
        setActiveOrganizationId(null);
        setHighlightedOrganizationIds(uniqueIds);
      }
      if (isMobile) {
        // For 1-3 orgs: partial sheet with offset centering
        // For >3 orgs: full expansion
        if (uniqueIds.length <= 3) {
          previewSheet();
        } else {
          expandSheet();
        }
      }
    },
    [expandSheet, isMobile, previewSheet, setSidebarCollapsed, setSidebarFollowMode, setSidebarTab, sidebarTab],
  );

  const handleUpdateAreaSelection = (kind: AreaKind, selection: { selected: string[]; pinned: string[] }) => {
    const normalizedSelected = dedupeIds(selection.selected);
    const normalizedPinned = dedupeIds(selection.pinned);
    const isNonEmpty = normalizedSelected.length > 0 || normalizedPinned.length > 0;
    const current = areaSelections[kind];
    const differs =
      !arraysEqual(current.selected, normalizedSelected) || !arraysEqual(current.pinned, normalizedPinned);
    if (isNonEmpty && differs) {
      setSelectedOrgIds([]);
      setSelectedOrgIdsFromMap(false);
    }
    applyAreaSelection(kind, {
      selected: normalizedSelected,
      pinned: normalizedPinned,
      transient: [],
    });
  };

  const handleClearAreas = useCallback(() => {
    handleUpdateAreaSelection("ZIP", { selected: [], pinned: [] });
    handleUpdateAreaSelection("COUNTY", { selected: [], pinned: [] });
  }, [handleUpdateAreaSelection]);

  const handleRemoveArea = useCallback(
    (area: { kind: "ZIP" | "COUNTY"; id: string }) => {
      const current = areaSelections[area.kind];
      handleUpdateAreaSelection(area.kind, {
        selected: current.selected.filter((value) => value !== area.id),
        pinned: current.pinned.filter((value) => value !== area.id),
      });
    },
    [areaSelections, handleUpdateAreaSelection],
  );

  const handleAddAreas = useCallback(
    (kind: "ZIP" | "COUNTY", ids: string[]) => {
      if (ids.length < 1) return;
      const current = areaSelections[kind];
      const merged = [...current.selected];
      const seen = new Set(merged);
      for (const id of ids) {
        if (seen.has(id)) continue;
        merged.push(id);
        seen.add(id);
      }
      const nextPinned = current.pinned.filter((id) => seen.has(id));
      handleUpdateAreaSelection(kind, { selected: merged, pinned: nextPinned });
    },
    [areaSelections, handleUpdateAreaSelection],
  );

  const handleAreaSelectionChange = (change: { kind: AreaKind; selected: string[]; pinned: string[]; transient: string[] }) => {
    setSidebarFollowMode("map");
    const current = areaSelections[change.kind];
    const hasChanged =
      !current ||
      !(
        arraysEqual(current.selected, change.selected) &&
        arraysEqual(current.pinned, change.pinned) &&
        arraysEqual(current.transient, change.transient)
      );
    const isNonEmpty = change.selected.length > 0 || change.pinned.length > 0;
    const suppressKey = change.kind === "ZIP" || change.kind === "COUNTY" ? change.kind : null;
    if (suppressKey && suppressAreaSelectionClearRef.current[suppressKey] > 0) {
      suppressAreaSelectionClearRef.current[suppressKey] -= 1;
    } else if (isNonEmpty && hasChanged) {
      setSelectedOrgIds([]);
      setSelectedOrgIdsFromMap(false);
    }
    applyAreaSelection(change.kind, {
      selected: change.selected,
      pinned: change.pinned,
      transient: change.transient,
    });
    if (hasChanged) {
      track("map_area_selected", {
        areaKind: change.kind,
        selectedCount: change.selected.length,
        pinnedCount: change.pinned.length,
        transientCount: change.transient.length,
        device: isMobile ? "mobile" : "desktop",
      });
    }
  };

  // Throttle React hover state updates to reduce re-renders
  const lastHoverUpdateRef = useRef(0);
  const pendingHoverRef = useRef<AreaId | null>(null);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const HOVER_THROTTLE_MS = 32; // ~2 frames, reduced from 50ms for snappier feel

  const handleAreaHoverChange = useCallback((area: AreaId | null) => {
    const now = performance.now();
    pendingHoverRef.current = area;
    
    // Clear any pending timeout
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    
    // If enough time has passed, update immediately
    if (now - lastHoverUpdateRef.current >= HOVER_THROTTLE_MS) {
      lastHoverUpdateRef.current = now;
      setHoveredAreaState(area);
    } else {
      // Schedule update for later
      hoverTimeoutRef.current = setTimeout(() => {
        hoverTimeoutRef.current = null;
        lastHoverUpdateRef.current = performance.now();
        setHoveredAreaState(pendingHoverRef.current);
      }, HOVER_THROTTLE_MS);
    }
  }, []);

  const handleBoundaryControlModeChange = (mode: "auto" | "manual") => {
    setBoundaryControlMode(mode);
  };

  const handleBoundaryModeManualSelect = (mode: BoundaryMode) => {
    setBoundaryControlMode("manual");
    setBoundaryMode(mode);
  };

  const handleMapBoundaryModeChange = (mode: BoundaryMode) => {
    setBoundaryMode(mode);
  };

  const handleMapControllerReady = useCallback((controller: MapViewController | null) => {
    mapControllerRef.current = controller;
    // Sync initial sidebar expand button visibility
    controller?.setSidebarExpandVisible(sidebarCollapsed);
  }, [sidebarCollapsed]);

  // Show/hide sidebar expand button on map when sidebar collapses/expands
  useEffect(() => {
    mapControllerRef.current?.setSidebarExpandVisible(sidebarCollapsed);
    // Resize map to fill the space when sidebar collapses/expands
    mapControllerRef.current?.resize();
    // Trigger one more resize shortly after width change settles
    const timeoutId = window.setTimeout(() => {
      mapControllerRef.current?.resize();
    }, 200);
    return () => window.clearTimeout(timeoutId);
  }, [sidebarCollapsed, isMobile]);

  const desktopLayoutVars = {
    "--desktop-sidebar-width": "24rem",
    "--map-chips-left-offset": "calc(var(--desktop-sidebar-width) + 0.25rem)",
  } as CSSProperties;

  // Keep the combined legend row visible - always on desktop, only in peek on mobile
  useEffect(() => {
    const controller = mapControllerRef.current;
    if (!controller) return;
    // Show on desktop always, or on mobile when sheet is in peek and not dragging
    const shouldShow = !isMobile || (sheetState === "peek" && !isDraggingSheet);
    try { controller.setLegendVisible(shouldShow); } catch {}
  }, [isMobile, sheetState, isDraggingSheet]);

  // Inject/update the My Location button into the legend row (right side) - mobile only
  useEffect(() => {
    const controller = mapControllerRef.current;
    if (!controller || !isMobile) {
      // On desktop, clear the injected button (desktop has its own overlay)
      if (controller && !isMobile) {
        try { controller.setLegendRightContent(null); } catch {}
      }
      return;
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = [
      "flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60",
      "min-w-[2.5rem] flex-1 w-full", // Fill available space but maintain minimum width for icon
      userLocationError
        ? "border border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
        : "border border-slate-200 bg-white text-slate-700 hover:border-brand-200 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white",
    ].join(" ");
    btn.disabled = isRequestingLocation;
    btn.setAttribute(
      "aria-label",
      isRequestingLocation ? "Locating..." : userLocationError ? userLocationError : userLocation ? "Zoom" : "My Location",
    );
    btn.addEventListener("click", () => {
      if (isRequestingLocation) return;
      track("map_my_location_click", {
        variant: "mobile",
        action: userLocation ? "zoom" : "request",
      });
      if (userLocation) {
        focusUserLocation();
      } else {
        requestUserLocation();
      }
    });
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 20 20");
    icon.setAttribute("aria-hidden", "true");
    icon.setAttribute("class", "h-4 w-4 flex-shrink-0"); // Icon should never shrink
    const p1 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p1.setAttribute("fill", "currentColor");
    p1.setAttribute(
      "d",
      "M10 2.5a.75.75 0 01.75.75v1.54a5.25 5.25 0 014.46 4.46H16.5a.75.75 0 010 1.5h-1.29a5.25 5.25 0 01-4.46 4.46v1.54a.75.75 0 01-1.5 0v-1.54a5.25 5.25 0 01-4.46-4.46H3.5a.75.75 0 010-1.5h1.29a5.25 5.25 0 014.46-4.46V3.25A.75.75 0 0110 2.5zm0 4a4 4 0 100 8 4 4 0 000-8z",
    );
    const p2 = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p2.setAttribute("fill", "currentColor");
    p2.setAttribute("d", "M10 8.25a1.75 1.75 0 110 3.5 1.75 1.75 0 010-3.5z");
    icon.appendChild(p1);
    icon.appendChild(p2);
    const label = document.createElement("span");
    label.className = "truncate min-w-0"; // Allow text to truncate
    label.textContent = isRequestingLocation
      ? "Locating..."
      : userLocationError
      ? userLocationError
      : userLocation
      ? "Zoom"
      : "My Location";
    if (isRequestingLocation) {
      const spinner = document.createElement("span");
      spinner.className = "h-4 w-4 flex-shrink-0 animate-spin rounded-full border-2 border-slate-400 border-t-transparent dark:border-slate-500";
      btn.appendChild(spinner);
    } else {
      btn.appendChild(icon);
    }
    btn.appendChild(label);

    try { controller.setLegendRightContent(btn); } catch {}
  }, [isMobile, isRequestingLocation, userLocation, userLocationError, focusUserLocation, requestUserLocation]);

  const handleMobileLocationSearch = useCallback(
    async (rawQuery: string) => {
      const query = rawQuery.trim();
      if (!query) return;

      const cityTarget = findCitySearchTarget(query);
      if (cityTarget) {
        // Clear area selections so the viewport jump represents the city context
        suppressAreaSelectionClearRef.current.ZIP += 1;
        suppressAreaSelectionClearRef.current.COUNTY += 1;
        applyAreaSelection("ZIP", { selected: [], pinned: [], transient: [] });
        applyAreaSelection("COUNTY", { selected: [], pinned: [], transient: [] });
        setActiveOrganizationId(null);
        setHighlightedOrganizationIds(null);
        setSelectedOrgIds([]);
        setSelectedOrgIdsFromMap(false);

        const mapController = mapControllerRef.current;
        if (mapController) {
          const [lng, lat] = cityTarget.center;
          const targetZoom = cityTarget.zoom ?? DEFAULT_CITY_ZOOM;

          if (cityTarget.bounds) {
            mapController.fitBounds(cityTarget.bounds, {
              padding: 72,
              maxZoom: Math.max(targetZoom, DEFAULT_CITY_ZOOM),
            });
          }

          mapController.setCamera(lng, lat, targetZoom);
        }

        setBoundaryMode("zips");
        setActiveScreen("map");
        if (isMobile && sheetState !== "peek") {
          collapseSheet();
        }
        setHasInteractedWithMap(true);
        return;
      }

      const normalized = query.toLowerCase();
      const zipRecordsMap = areasByKindAndCode.get("ZIP") ?? new Map<string, any>();

      let targetKind: SupportedAreaKind | null = null;
      let targetRecord: { code: string; bounds?: [[number, number], [number, number]] | null; centroid?: [number, number] | null } | null = null;

      // Try to resolve the query to a ZIP match first, then fall back to county names.
      if (/^\d{5}$/.test(query)) {
        const zipRecord = zipRecordsMap.get(query);
        if (zipRecord) {
          targetKind = "ZIP";
          targetRecord = zipRecord;
        }
      }

      if (!targetRecord) {
        const sanitized = normalized.replace(/\s+county$/, "").trim();
        for (const record of countyRecords) {
          const name = record.name?.toLowerCase();
          if (!name) continue;
          if (name === normalized || name === sanitized) {
            targetKind = "COUNTY";
            targetRecord = record;
            break;
          }
        }
      }

      if (!targetRecord) {
        // Prioritize explicit address geocoding before fuzzy org matching so full addresses don't get hijacked.
        const parsedAddress = parseFullAddress(query);
        const shouldAttemptGeocode = Boolean(parsedAddress) || looksLikeAddress(query);

        if (shouldAttemptGeocode) {
          const cacheKey = parsedAddress
            ? JSON.stringify({
                address: (parsedAddress.address ?? "").toLowerCase(),
                city: (parsedAddress.city ?? "").toLowerCase(),
                state: (parsedAddress.state ?? "").toLowerCase(),
                zip: (parsedAddress.zip ?? "").toLowerCase(),
              })
            : normalized;

          let cachedLocation = geocodeCacheRef.current.get(cacheKey);

          if (!cachedLocation) {
            try {
              const geocodeResult = await geocodeAddress(
                parsedAddress && (parsedAddress.address || parsedAddress.city || parsedAddress.state || parsedAddress.zip)
                  ? parsedAddress
                  : query,
              );
              if ("error" in geocodeResult) {
                console.warn("Address geocode failed:", geocodeResult.error);
                setUserLocationError(geocodeResult.error);
              } else {
                cachedLocation = { lng: geocodeResult.longitude, lat: geocodeResult.latitude };
                geocodeCacheRef.current.set(cacheKey, cachedLocation);
              }
            } catch (error) {
              console.error("Address geocode error:", error);
            }
          }

          if (cachedLocation) {
            setActiveOrganizationId(null);
            setHighlightedOrganizationIds(null);
            setSelectedOrgIds([]);
            setSelectedOrgIdsFromMap(false);
            setUserLocation(cachedLocation);
            setUserLocationSource("search");
            setUserLocationError(null);
            focusOnLocation(cachedLocation);
            setHasInteractedWithMap(true);
            return;
          }
        }
      }

      if (!targetRecord) {
        const orgMatches = findOrganizationMatches(query, 6);
        if (orgMatches.length > 0) {
          suppressAreaSelectionClearRef.current.ZIP += 1;
          suppressAreaSelectionClearRef.current.COUNTY += 1;
          applyAreaSelection("ZIP", { selected: [], pinned: [], transient: [] });
          applyAreaSelection("COUNTY", { selected: [], pinned: [], transient: [] });

          const matchIds = orgMatches.map((entry) => entry.org.id);
          setActiveScreen("map");
          setOrgPinsVisible(true);
          setActiveOrganizationId(matchIds[0]);
          setHighlightedOrganizationIds(matchIds.length > 1 ? matchIds : null);
          setSidebarFollowMode("map");
          setSelectedOrgIds(matchIds);
          setSelectedOrgIdsFromMap(true);
          setSearchSelectionMeta({
            term: query,
            ids: matchIds,
          });

          const controller = mapControllerRef.current;
          if (controller) {
            try {
              controller.centerOnOrganization(matchIds[0], { animate: true });
            } catch {}
          }

          if (isMobile) {
            if (matchIds.length <= 3) {
              previewSheet();
            } else {
              expandSheet();
            }
          }

          track("map_search_organization_match", {
            query,
            matchCount: matchIds.length,
            topOrganizationId: matchIds[0],
            topScore: Number(orgMatches[0].score.toFixed(3)),
          });
          setHasInteractedWithMap(true);
          return;
        }
      }

      if (!targetRecord) {
        const zipByName = zipRecords.find((record) => record.name?.toLowerCase() === normalized);
        if (zipByName) {
          targetKind = "ZIP";
          targetRecord = zipByName;
        }
      }

      if (!targetRecord) {
        const countyFallback = countyRecords.find((record) => {
          const name = record.name?.toLowerCase();
          if (!name) return false;
          return name.includes(normalized);
        });
        if (countyFallback) {
          targetKind = "COUNTY";
          targetRecord = countyFallback;
        }
      }

      if (!targetKind || !targetRecord) {
        console.warn("No area match for search query:", query);
        return;
      }

      // Clear existing selections before selecting the searched area
      applyAreaSelection("ZIP", { selected: [], pinned: [], transient: [] });
      applyAreaSelection("COUNTY", { selected: [], pinned: [], transient: [] });

      // Select the searched area by adding it to selected and pinned arrays
      const targetCode = targetRecord.code;
      applyAreaSelection(targetKind, {
        selected: [targetCode],
        pinned: [targetCode],
        transient: [],
      });

      const bounds =
        targetRecord.bounds ??
        (targetKind === "ZIP" ? getZipBounds(targetRecord.code) : getCountyBounds(targetRecord.code));

      const mapController = mapControllerRef.current;
      if (mapController && bounds) {
        const expanded =
          targetKind === "ZIP" ? expandBounds(bounds, 0.25) : expandBounds(bounds, 0.15);
        mapController.fitBounds(expanded, {
          padding: targetKind === "ZIP" ? 80 : 96,
          maxZoom: targetKind === "ZIP" ? 10.9 : 8.9,
        });
      } else if (mapController && targetRecord.centroid) {
        const [lng, lat] = targetRecord.centroid;
        mapController.setCamera(
          lng,
          lat,
          targetKind === "ZIP" ? 10.5 : 8.2,
        );
      }

      setBoundaryMode(targetKind === "ZIP" ? "zips" : "counties");
      setActiveScreen("map");
      if (isMobile && sheetState !== "peek") {
        collapseSheet();
      }
      setHasInteractedWithMap(true);
    },
    [
      areasByKindAndCode,
      countyRecords,
      zipRecords,
      collapseSheet,
      focusOnLocation,
      isMobile,
      sheetState,
      previewSheet,
      expandSheet,
      findOrganizationMatches,
      applyAreaSelection,
      setBoundaryMode,
      setHasInteractedWithMap,
      setSidebarFollowMode,
      setActiveOrganizationId,
      setActiveScreen,
      setHighlightedOrganizationIds,
      setOrgPinsVisible,
      setSelectedOrgIds,
      setSelectedOrgIdsFromMap,
      setUserLocation,
      setUserLocationSource,
      setUserLocationError,
      geocodeCacheRef,
      track,
    ],
  );

  const handleExport = () => {
    const primaryKind = activeAreaKind;
    if (!primaryKind) return;

    const areaCodes = [...activeSelectedCodes].sort();
    if (areaCodes.length === 0) return;

    const otherKind: SupportedAreaKind = primaryKind === "ZIP" ? "COUNTY" : "ZIP";
    const primaryKeySet = new Set(areaCodes.map((code) => `${primaryKind}:${code}`));
    const contextKeySet = new Set<string>();
    const contextAreas: AreaId[] = [];
    const addContextArea = (kind: SupportedAreaKind, code: string) => {
      const key = `${kind}:${code}`;
      if (primaryKeySet.has(key) || contextKeySet.has(key)) return;
      contextKeySet.add(key);
      contextAreas.push({ kind, id: code });
    };

    const pinnedOther = otherKind === "ZIP" ? pinnedZips : pinnedCounties;
    pinnedOther.forEach((code) => addContextArea(otherKind, code));

    const headers: string[] = ["area_kind", "area_code", "area_name", "is_context"];

    const selectedCategory = categoryFilter;
    const allStats = Array.from(statsById.values());
    const columnEntries: Array<{
      id: string;
      header: string;
      entries: Partial<Record<SupportedAreaKind, StatBoundaryEntry>>;
    }> = [];

    const addColumn = (statId: string, header: string) => {
      const entries = statDataByStatId.get(statId);
      if (!entries) return;
      columnEntries.push({ id: statId, header, entries });
    };

    if (selectedCategory) {
      const inCategory = allStats.filter((stat) => stat.category === selectedCategory);
      for (const stat of inCategory) {
        const slug = stat.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        addColumn(stat.id, slug || `stat_${stat.id.slice(0, 6)}`);
      }
    } else if (selectedStatId) {
      const stat = statsById.get(selectedStatId);
      if (stat) {
        const slug = stat.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        addColumn(stat.id, slug || `stat_${stat.id.slice(0, 6)}`);
      }
    }

    let orgCountHeader: string | null = null;
    const orgCountsByKind: Record<SupportedAreaKind, Map<string, number>> = {
      ZIP: new Map(),
      COUNTY: new Map(),
    };

    if (selectedCategory) {
      orgCountHeader = `number_of_${selectedCategory}_orgs_active`;
      headers.push(orgCountHeader);

      const idsFilter = new Set(orgsAllSourceIds);
      const fromSource = availableOrganizations.filter(
        (org) => idsFilter.size === 0 || idsFilter.has(org.id),
      );
      const catOrgs = fromSource.filter((org) => org.category === selectedCategory);
      for (const org of catOrgs) {
        const zip = orgZipById.get(org.id);
        if (zip) orgCountsByKind.ZIP.set(zip, (orgCountsByKind.ZIP.get(zip) || 0) + 1);
        const county = orgCountyById.get(org.id);
        if (county) orgCountsByKind.COUNTY.set(county, (orgCountsByKind.COUNTY.get(county) || 0) + 1);
      }
    }

    headers.push("population", "avg_age", "married_percent");
    for (const column of columnEntries) headers.push(column.header);

    const r1 = (value: number): string => (Math.round(value * 10) / 10).toFixed(1);

    const getEntriesByName = (name: string): Partial<Record<SupportedAreaKind, StatBoundaryEntry>> | null => {
      for (const [statId, entries] of statDataByStatId.entries()) {
        const stat = statsById.get(statId);
        if (stat?.name === name) return entries;
      }
      return null;
    };

    const populationEntries = getEntriesByName("Population");
    const ageEntries = getEntriesByName("Median Age") ?? getEntriesByName("Average Age");
    const marriedEntries = getEntriesByName("Married Percent");
    const populationPrimary = populationEntries?.[primaryKind];
    if (!populationPrimary) return;

    const rows: (string | number)[][] = [];
    let totalPopulation = 0;
    let weightedAge = 0;
    let weightedMarried = 0;
    let weightedAgeDenominator = 0;
    let weightedMarriedDenominator = 0;
    const statSums = new Map<string, number>();
    const statCounts = new Map<string, number>();

    const buildRow = (
      kind: SupportedAreaKind,
      code: string,
      isContext: boolean,
    ): {
      row: (string | number)[];
      population: number | null;
      age: number | null;
      married: number | null;
    } => {
      const populationEntry = populationEntries?.[kind];
      const ageEntry = ageEntries?.[kind];
      const marriedEntry = marriedEntries?.[kind];
      const popRaw = populationEntry?.data?.[code];
      const population = typeof popRaw === "number" && Number.isFinite(popRaw) ? Math.max(0, Math.round(popRaw)) : null;
      const ageRaw = ageEntry?.data?.[code];
      const age = typeof ageRaw === "number" && Number.isFinite(ageRaw) ? ageRaw : null;
      const marriedRaw = marriedEntry?.data?.[code];
      const married = typeof marriedRaw === "number" && Number.isFinite(marriedRaw) ? marriedRaw : null;

      const row: (string | number)[] = [
        kind,
        code,
        areaNameLookup(kind, code) || code,
        isContext ? "1" : "0",
      ];
      if (orgCountHeader) row.push(orgCountsByKind[kind].get(code) || 0);
      row.push(
        population ?? "",
        age != null ? r1(age) : "",
        married != null ? r1(married) : "",
      );
      for (const column of columnEntries) {
        const value = column.entries[kind]?.data?.[code];
        row.push(typeof value === "number" && Number.isFinite(value) ? r1(value) : "");
      }
      return { row, population, age, married };
    };

    for (const code of areaCodes) {
      const { row, population, age, married } = buildRow(primaryKind, code, false);
      rows.push(row);

      const populationValue = population ?? 0;
      totalPopulation += populationValue;
      if (age != null && populationValue > 0) {
        weightedAge += age * populationValue;
        weightedAgeDenominator += populationValue;
      }
      if (married != null && populationValue > 0) {
        weightedMarried += married * populationValue;
        weightedMarriedDenominator += populationValue;
      }

      for (const column of columnEntries) {
        const value = column.entries[primaryKind]?.data?.[code];
        if (typeof value === "number" && Number.isFinite(value)) {
          statSums.set(column.id, (statSums.get(column.id) || 0) + value);
          statCounts.set(column.id, (statCounts.get(column.id) || 0) + 1);
        }
      }
    }

    const contextRows = contextAreas
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
      .map(({ kind, id }) => buildRow(kind as SupportedAreaKind, id, true).row)
      .filter((row) => row != null);

    const averageAge = weightedAgeDenominator > 0 ? weightedAge / weightedAgeDenominator : 0;
    const averageMarried = weightedMarriedDenominator > 0 ? weightedMarried / weightedMarriedDenominator : 0;
    const summaryRow: (string | number)[] = [
      primaryKind,
      primaryKind === "ZIP" ? "ALL_SELECTED_ZIPS" : "ALL_SELECTED_COUNTIES",
      "—",
      "0",
    ];
    if (orgCountHeader) summaryRow.push(areaCodes.reduce((sum, code) => sum + (orgCountsByKind[primaryKind].get(code) || 0), 0));
    summaryRow.push(totalPopulation, r1(averageAge), r1(averageMarried));
    for (const column of columnEntries) {
      const count = statCounts.get(column.id) || 0;
      if (count > 0) summaryRow.push(r1((statSums.get(column.id) || 0) / count));
      else summaryRow.push("");
    }

    const baselineLabel = primaryKind === "ZIP" ? "CITY_TULSA" : "STATE_OKLAHOMA";
    const baselineName = primaryKind === "ZIP" ? "Tulsa" : "Oklahoma";
    const baselineStatSums = new Map<string, number>();
    const baselineStatCounts = new Map<string, number>();
    let baselinePopulation = 0;
    let baselineWeightedAge = 0;
    let baselineWeightedMarried = 0;
    const allAreaKeys = Object.keys(populationPrimary.data || {}).sort();
    for (const code of allAreaKeys) {
      const popRaw = populationPrimary.data?.[code];
      const population = typeof popRaw === "number" && Number.isFinite(popRaw) ? Math.max(0, Math.round(popRaw)) : 0;
      baselinePopulation += population;
      const ageRaw = ageEntries?.[primaryKind]?.data?.[code];
      if (typeof ageRaw === "number" && Number.isFinite(ageRaw)) baselineWeightedAge += ageRaw * population;
      const marriedRaw = marriedEntries?.[primaryKind]?.data?.[code];
      if (typeof marriedRaw === "number" && Number.isFinite(marriedRaw)) baselineWeightedMarried += marriedRaw * population;
      for (const column of columnEntries) {
        const value = column.entries[primaryKind]?.data?.[code];
        if (typeof value === "number" && Number.isFinite(value)) {
          baselineStatSums.set(column.id, (baselineStatSums.get(column.id) || 0) + value);
          baselineStatCounts.set(column.id, (baselineStatCounts.get(column.id) || 0) + 1);
        }
      }
    }

    const baselineRow: (string | number)[] = [
      primaryKind,
      baselineLabel,
      baselineName,
      "0",
    ];
    if (orgCountHeader) {
      baselineRow.push(Array.from(orgCountsByKind[primaryKind].values()).reduce((sum, count) => sum + count, 0));
    }
    baselineRow.push(
      baselinePopulation,
      baselinePopulation > 0 ? r1(baselineWeightedAge / baselinePopulation) : "",
      baselinePopulation > 0 ? r1(baselineWeightedMarried / baselinePopulation) : "",
    );
    for (const column of columnEntries) {
      const count = baselineStatCounts.get(column.id) || 0;
      if (count > 0) baselineRow.push(r1((baselineStatSums.get(column.id) || 0) / count));
      else baselineRow.push("");
    }

    const lines: string[] = [];
    lines.push(headers.join(","));
    for (const row of rows) lines.push(row.join(","));
    for (const row of contextRows) lines.push(row.join(","));
    lines.push(summaryRow.join(","));
    lines.push(baselineRow.join(","));

    const csv = lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const statSuffix = selectedCategory
      ? `_${selectedCategory}`
      : selectedStatId
      ? `_${(statsById.get(selectedStatId)?.name || "stat").replace(/\s+/g, "_")}`
      : "";
    const scopeSuffix = primaryKind === "ZIP" ? "_zips" : "_counties";
    link.download = `areas_export${scopeSuffix}${statSuffix}_${timestamp}.csv`;
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleZoomOutAll = () => {
    setZoomOutNonce((n) => n + 1);
  };
  const handleZoomToCounty = useCallback(
    (countyCode: string) => {
      const mapController = mapControllerRef.current;
      if (!mapController) return;
      const countyMap = areasByKindAndCode.get("COUNTY");
      const record = countyMap?.get(countyCode) ?? null;
      const bounds = record?.bounds ?? getCountyBounds(countyCode);
      const centerFromBounds = bounds
        ? [
            (bounds[0][0] + bounds[1][0]) / 2,
            (bounds[0][1] + bounds[1][1]) / 2,
          ]
        : null;
      const center =
        record?.centroid ??
        centerFromBounds ??
        [OKLAHOMA_CENTER.longitude, OKLAHOMA_CENTER.latitude];
      if (!center) {
        setZoomOutNonce((n) => n + 1);
        return;
      }
      const [lng, lat] = center;
      const currentZoom = cameraState?.zoom ?? 10.6;
      const preferredZoom = Math.min(currentZoom - 0.6, 10.3);
      const targetZoom = Math.max(preferredZoom, 10.0);
      mapController.setCamera(lng, lat, targetZoom, { animate: true });
      setBoundaryMode("zips");
      setSidebarFollowMode("map");
      setHasInteractedWithMap(true);
    },
    [areasByKindAndCode, cameraState, setBoundaryMode, setHasInteractedWithMap, setSidebarFollowMode, setZoomOutNonce],
  );

  const handleStatSelect = (
    statId: string | null,
    meta?: { shiftKey?: boolean; clear?: boolean }
  ) => {
    if (statId === null) {
      setSelectedStatId(null);
      setSecondaryStatId(null);
      // Note: We intentionally do NOT clear categoryFilter here when deselecting a stat.
      // The category should remain selected so users can easily select another stat from the same category.
      return;
    }

    // If a stat is selected and there are orgs selected from the map, deselect them
    if (selectedOrgIdsFromMap && selectedOrgIds.length > 0) {
      setSelectedOrgIds([]);
      setSelectedOrgIdsFromMap(false);
    }

    if (meta?.shiftKey) {
      // Shift-click: toggle secondary stat
      setSecondaryStatId((prev) => (prev === statId ? null : statId));
    } else {
      // Normal click: set primary stat
      setSelectedStatId(statId);
      // On mobile, collapse the bottom sheet to reveal the map with the stat overlay
      if (isMobile) {
        setActiveScreen("map");
        collapseSheet();
      }
    }
  };

  const sidebarOrganizations = (() => {
    const sourceIds = new Set(orgsAllSourceIds);
    const visibleIds = new Set(orgsVisibleIds);
    const fromSource = availableOrganizations.filter((o) => sourceIds.size === 0 || sourceIds.has(o.id));
    const visible = fromSource.filter((o) => visibleIds.size === 0 || visibleIds.has(o.id));
    const visibleCountByCounty = new Map<string, number>();
    for (const org of visible) {
      const county = orgCountyById.get(org.id);
      if (!county) continue;
      visibleCountByCounty.set(county, (visibleCountByCounty.get(county) ?? 0) + 1);
    }
    const zipSel = new Set(selectedZips);
    const countySel = new Set(selectedCounties);
    let inSelection: Organization[] = [];
    const selectedOrgSet = new Set(selectedOrgIds);
    
    // Show recent organizations until the user meaningfully interacts with the map.
    // Sidebar-driven selections should not hide this section; only map-driven picks or area filters should.
    const shouldShowRecent = !hasInteractedWithMap &&
      selectedZips.length === 0 &&
      selectedCounties.length === 0 &&
      (!selectedOrgIdsFromMap || selectedOrgIds.length === 0);

    // Direct org selection (from clicking org centroids or small clusters)
    // moves to the inSelection section only when originating from the map.
    // Sidebar-driven selections stay in-place within the "All" section.
    if (selectedOrgIds.length > 0 && selectedOrgIdsFromMap && sidebarFollowsMap) {
      inSelection = visible.filter((o) => selectedOrgSet.has(o.id));
    } else if (selectedOrgIds.length === 0) {
      // No direct org selection - use area-based selection
      if (activeAreaKind === "ZIP" && zipSel.size > 0) {
        inSelection = visible.filter((o) => {
          const zip = orgZipById.get(o.id);
          return !!zip && zipSel.has(zip);
        });
      } else if (activeAreaKind === "COUNTY" && countySel.size > 0) {
        inSelection = visible.filter((o) => {
          const county = orgCountyById.get(o.id);
          return !!county && countySel.has(county);
        });
      } else if (zipSel.size > 0) {
        inSelection = visible.filter((o) => {
          const zip = orgZipById.get(o.id);
          return !!zip && zipSel.has(zip);
        });
      } else if (countySel.size > 0) {
        inSelection = visible.filter((o) => {
          const county = orgCountyById.get(o.id);
          return !!county && countySel.has(county);
        });
      }
    }
    const inSelectionIds = new Set(inSelection.map((o) => o.id));
    let rest = visible.filter((o) => !inSelectionIds.has(o.id));

    if (selectedStatId) {
      const entryMap = statDataByStatId.get(selectedStatId);
      if (entryMap) {
        const zipEntry = entryMap.ZIP;
        const countyEntry = entryMap.COUNTY;
        const scoreFor = (org: Organization): number => {
          if (zipEntry) {
            const zip = orgZipById.get(org.id);
            if (zip) {
              const v = zipEntry.data?.[zip];
              if (typeof v === "number" && Number.isFinite(v)) return v;
            }
          }
          if (countyEntry) {
            const county = orgCountyById.get(org.id);
            if (county) {
              const v = countyEntry.data?.[county];
              if (typeof v === "number" && Number.isFinite(v)) return v;
            }
          }
          return Number.NEGATIVE_INFINITY;
        };
        const cmp = (a: Organization, b: Organization) => {
          const sa = scoreFor(a);
          const sb = scoreFor(b);
          if (sb !== sa) return sb - sa;
          return a.name.localeCompare(b.name);
        };
        inSelection = inSelection.slice().sort(cmp);
        rest = rest.slice().sort(cmp);
      }
    }
    const matchingInactive = timeSelection
      ? inactiveOrganizations.filter((org) => isOrganizationOpenAtTime(org, timeSelection))
      : inactiveOrganizations;
    const inactiveSorted = matchingInactive.slice().sort((a, b) => a.name.localeCompare(b.name));
    
    // If showing recent orgs, filter and sort them, then show rest alphabetically
    let allOrgs: Organization[] = [];
    let recentOrgsToShow: Organization[] = [];
    
    if (shouldShowRecent && recentOrganizations.length > 0) {
      // Filter recent orgs to only include visible ones that aren't already in selection
      const recentIds = new Set(recentOrganizations.map(o => o.id));
      const recentVisible = recentOrganizations.filter((org) => {
        if (inSelectionIds.has(org.id)) return false;
        if (sourceIds.size > 0 && !sourceIds.has(org.id)) return false;
        if (visibleIds.size > 0 && !visibleIds.has(org.id)) return false;
        return true;
      });
      
      // Filter rest to exclude recent orgs
      const restWithoutRecent = rest.filter((o) => !recentIds.has(o.id));
      
      // Sort rest alphabetically
      const restSorted = restWithoutRecent.slice().sort((a, b) => a.name.localeCompare(b.name));
      
      recentOrgsToShow = recentVisible;
      allOrgs = [...restSorted, ...inactiveSorted];
    } else {
      // Normal mode: show rest alphabetically
      allOrgs = [...rest.slice().sort((a, b) => a.name.localeCompare(b.name)), ...inactiveSorted];
    }
    
    const totalSourceCount = (sourceIds.size || fromSource.length) + matchingInactive.length;
    const visibleInViewport = inSelection.length + rest.length;
    return { 
      inSelection, 
      all: allOrgs, 
      recent: recentOrgsToShow,
      totalSourceCount, 
      visibleInViewport,
      visibleCountByCounty,
    };
  })();

  const visibleCount =
    typeof sidebarOrganizations.visibleInViewport === "number"
      ? sidebarOrganizations.visibleInViewport
      : sidebarOrganizations.inSelection.length + sidebarOrganizations.all.length;
  const viewportCountyVisibleCount =
    zipScopeCountyCode && sidebarOrganizations.visibleCountByCounty
      ? sidebarOrganizations.visibleCountByCounty.get(zipScopeCountyCode) ?? 0
      : 0;
  // Always show viewport count in mobile peek mode, regardless of area selection
  const mobileOrganizationsCount = visibleCount;
  const mobileOrgLabel = isFoodDomain ? "Food Providers" : "Organizations (Food, etc.)";
  const selectedStat = selectedStatId ? statsById.get(selectedStatId) ?? null : null;
  const mobilePeekLabel =
    sidebarTab === "stats"
      ? selectedStat
        ? `Stat: ${getStatDisplayName(selectedStat)}`
        : "Stat"
      : `${mobileOrganizationsCount} ${mobileOrgLabel}`;
  const mobilePeekDotClassName = [
    "h-2.5 w-2.5 rounded-full ring-1 ring-black/5 dark:ring-white/10",
    sidebarTab === "stats" ? "bg-brand-500" : "",
  ].join(" ");
  const mobilePeekDotStyle = sidebarTab === "stats" ? undefined : { backgroundColor: "#f5c4ae" };

  const handleTopBarNavigate = useCallback(
    (screen: "map" | "report" | "roadmap" | "data" | "queue" | "admin") => {
      if (screen === "queue" && !isAdmin) {
        setActiveScreen("map");
        return;
      }
      if (screen === "data" && !isAdmin) {
        setActiveScreen("map");
        return;
      }
      if (screen === "admin" && !isAdmin) {
        setActiveScreen("map");
        return;
      }
      if (screen === "report" && !showAdvanced) {
        setActiveScreen("map");
        return;
      }
      setActiveScreen(screen);
    },
    [isAdmin, setActiveScreen, authReady, user, showAdvanced],
  );

  const handleCloseWelcomeModal = useCallback(() => {
    setShowWelcomeModal(false);
    try {
      localStorage.setItem("welcomeModal.dismissed", "true");
    } catch {}
  }, []);

  const handleNeedFood = useCallback(async () => {
    handleCloseWelcomeModal();
    try {
      const location = await requestUserLocation();
      setUserLocation(location);
      setUserLocationSource("device");
      focusOnLocation(location);
    } catch (error) {
      // Location failed, open zip search
      if (isMobile) {
        // Use a small delay to ensure the component is ready
        setTimeout(() => {
          setExpandMobileSearch(true);
          // Reset after a delay to allow TopBar to respond
          setTimeout(() => setExpandMobileSearch(false), 200);
        }, 50);
      } else {
        setShowZipSearchModal(true);
      }
    }
  }, [focusOnLocation, handleCloseWelcomeModal, isMobile, requestUserLocation, setUserLocation, setUserLocationSource]);

  const handleShareFood = useCallback(() => {
    handleCloseWelcomeModal();
    handleOpenAddOrganization();
  }, [handleCloseWelcomeModal, handleOpenAddOrganization]);

  const handleZipSearchSubmit = useCallback(
    (query: string) => {
      handleMobileLocationSearch(query);
      setShowZipSearchModal(false);
    },
    [handleMobileLocationSearch],
  );

  const handleClearTimeFilter = useCallback(() => {
    setTimeSelection(null);
    if (mapControllerRef.current) {
      mapControllerRef.current.setTimeSelection(null);
    }
  }, [setTimeSelection]);

  const handleChangeTimeFilter = useCallback(() => {
    setShowTimeSelectorModal(true);
  }, []);

  // Center the map on sidebar-selected organization(s)
  useEffect(() => {
    if (selectedOrgIdsFromMap) return;
    if (skipSidebarCenteringRef.current) {
      skipSidebarCenteringRef.current = false;
      return;
    }
    if (selectedOrgIds.length !== 1) return;
    if (isMobile && sheetState === "partial") return;
    const controller = mapControllerRef.current;
    if (!controller) return;
    try {
      const focusOptions: { animate: boolean; zoom?: number } = { animate: true };
      controller.centerOnOrganization(selectedOrgIds[0], focusOptions);
    } catch {}
  }, [isMobile, selectedOrgIds, selectedOrgIdsFromMap, sheetState]);

  useEffect(() => {
    if (!isMobile) return;
    if (sheetState !== "partial") return;
    // Support centering for 1-3 selected orgs (single org or small cluster)
    if (selectedOrgIds.length < 1 || selectedOrgIds.length > 3) return;
    if (isDraggingSheet) return;
    if (sheetAvailableHeight <= 0) return;
    const visibleHeight = Math.max(0, Math.min(sheetTranslateY, sheetAvailableHeight));
    if (visibleHeight <= 0) return;
    const desiredY = topBarHeight + visibleHeight * MOBILE_PARTIAL_FOCUS_ANCHOR;
    const offsetY = desiredY - viewportHeight / 2;
    if (Math.abs(offsetY) < 4) return;
    const offsetScale = Number.isFinite(mobilePartialFocusOffsetScale)
      ? mobilePartialFocusOffsetScale
      : MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MAX;
    const offset: [number, number] = [0, Math.round(offsetY * offsetScale)];
    const controller = mapControllerRef.current;
    if (!controller) return;
    try {
      // For small clusters (2-3 orgs), center on the first org
      controller.centerOnOrganization(selectedOrgIds[0], { animate: true, offset });
    } catch {}
  }, [
    isDraggingSheet,
    isMobile,
    selectedOrgIds,
    sheetAvailableHeight,
    mobilePartialFocusOffsetScale,
    sheetState,
    sheetTranslateY,
    topBarHeight,
    viewportHeight,
  ]);

  return (
    <div
      className="app-shell relative flex flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-slate-950"
      style={desktopLayoutVars}
    >
      <TopBar
        onBrandClick={handleBrandClick}
        onNavigate={handleTopBarNavigate}
        active={
          activeScreen === "report"
            ? "report"
            : activeScreen === "roadmap"
            ? "roadmap"
            : activeScreen === "data"
            ? "data"
            : activeScreen === "queue"
            ? "queue"
            : activeScreen === "admin"
            ? "admin"
            : "map"
        }
        onOpenAuth={() => setAuthOpen(true)}
        isMobile={isMobile}
        onMobileLocationSearch={handleMobileLocationSearch}
        onAddOrganization={handleOpenAddOrganization}
        expandMobileSearch={expandMobileSearch}
        showAdvanced={showAdvanced}
        onAdvancedToggle={setShowAdvanced}
      />
      <div className="relative flex flex-1 flex-col overflow-hidden">
        <main className="relative flex flex-1 flex-col overflow-hidden md:flex-row">
          {/* Desktop sidebar — left of map */}
          {!isMobile && (
            <div
              className={[
                "shrink-0",
                // When collapsed: absolute (out of flow so map expands), search bar stays via Sidebar
                sidebarCollapsed
                  ? "pointer-events-none absolute left-0 top-0 z-10 h-full w-[var(--desktop-sidebar-width)]"
                  : "relative w-[var(--desktop-sidebar-width)]",
              ].join(" ")}
            >
              <Sidebar
                collapsed={sidebarCollapsed}
                organizations={sidebarOrganizations}
                searchOrganizations={availableOrganizations}
                activeOrganizationId={activeOrganizationId}
                highlightedOrganizationIds={highlightedOrganizationIds ?? undefined}
                statsById={statsById}
                statSummariesById={statSummariesByStatId}
                seriesByStatIdByKind={seriesByStatIdScoped}
                statDataById={statDataByStatId}
                statRelationsByParent={statRelationsByParent}
                statRelationsByChild={statRelationsByChild}
                demographicsSnapshot={activeDemographicsSnapshot ?? combinedSnapshot}
                selectedAreas={selectedAreasMap}
                pinnedAreas={pinnedAreasMap}
                activeAreaKind={activeAreaKind}
                areaNameLookup={areaNameLookup}
                directOrgSelectionActive={selectedOrgIdsFromMap && selectedOrgIds.length > 0}
                selectedOrgIds={selectedOrgIds}
                selectedOrgIdsFromMap={selectedOrgIdsFromMap}
                zipScopeDisplayName={zipScopeDisplayName}
                countyScopeDisplayName={countyScopeDisplayName}
                getZipParentCounty={getZipParentCounty}
                viewportCountyOrgCount={viewportCountyOrgCount}
                viewportCountyVisibleCount={viewportCountyVisibleCount}
                zipScopeCountyCode={zipScopeCountyCode}
                hoveredArea={hoveredArea}
                selectedStatId={selectedStatId}
                secondaryStatId={secondaryStatId}
                selectedStatLoading={isSelectedStatLoading}
                categoryFilter={categoryFilter}
                onCategoryChange={setCategoryFilter}
                onHover={handleHover}
                onOrganizationClick={handleSidebarOrganizationClick}
                onHoverArea={handleAreaHoverChange}
                onZoomOutAll={handleZoomOutAll}
                onZoomToCounty={handleZoomToCounty}
                onRequestCollapseSheet={isMobile ? collapseSheet : undefined}
                onLocationSearch={handleMobileLocationSearch}
                onStatSelect={handleStatSelect}
                onRetryStatData={retryStatData}
                onExport={handleExport}
                onOrgPinsVisibleChange={setOrgPinsVisible}
                initialOrgPinsVisible={initialMapState.orgPinsVisible}
                onClearAreas={handleClearAreas}
                onRemoveArea={handleRemoveArea}
                onAddAreas={handleAddAreas}
                forceHideOrgsNonce={forceHideOrgsNonce}
                forceShowOrgsNonce={forceShowOrgsNonce}
                timeSelection={timeSelection}
                onClearTimeFilter={handleClearTimeFilter}
                onChangeTimeFilter={handleChangeTimeFilter}
                cameraState={cameraState}
                onZoomToOrg={handleZoomToOrg}
                variant="desktop"
                selectionLabelOverride={searchSelectionLabel}
                selectionStyleVariant={selectionStyleVariant}
                showAdvanced={showAdvanced}
                insightsState={sidebarInsightsState}
                onInsightsStateChange={(patch) =>
                  setSidebarInsightsState((prev) => ({
                    ...prev,
                    ...patch,
                  }))
                }
                initialTab={sidebarTab}
                onTabChange={setSidebarTab}
                onCollapse={setSidebarCollapsed}
              />
            </div>
          )}
          <div className="relative flex flex-1 flex-col overflow-hidden">
            {!isMobile && showAdvanced && (
              <BoundaryToolbar
                boundaryMode={boundaryMode}
                boundaryControlMode={boundaryControlMode}
                selections={toolbarSelections}
                hoveredArea={hoveredArea}
                stickyTopClass="top-0"
                onBoundaryModeChange={handleBoundaryModeManualSelect}
                onBoundaryControlModeChange={handleBoundaryControlModeChange}
                onHoverArea={setHoveredAreaState}
                onExport={handleExport}
                onUpdateSelection={handleUpdateAreaSelection}
              />
            )}
            <MapLibreMap
              key={isMobile ? "mobile" : "desktop"}
              organizations={availableOrganizations}
              orgPinsVisible={orgPinsVisible}
              initialMapPosition={initialMapPosition}
              zoomOutRequestNonce={zoomOutNonce}
              clearMapCategoryNonce={clearMapCategoryNonce}
              onRequestHideOrgs={() => {
                setOrgPinsVisible(false);
                setForceHideOrgsNonce((n) => n + 1);
              }}
              boundaryMode={boundaryMode}
              autoBoundarySwitch={autoBoundarySwitch}
              selectedZips={selectedZips}
              pinnedZips={pinnedZips}
              hoveredZip={hoveredZip}
              selectedCounties={selectedCounties}
              pinnedCounties={pinnedCounties}
              hoveredCounty={hoveredCounty}
              activeOrganizationId={activeOrganizationId}
              selectedOrgIds={selectedOrgIds}
              onHover={handleHover}
              onOrganizationClick={handleOrganizationClick}
              onClusterClick={handleClusterClick}
              selectedStatId={selectedStatId}
              secondaryStatId={secondaryStatId}
              categoryFilter={categoryFilter}
              onAreaSelectionChange={handleAreaSelectionChange}
              onAreaHoverChange={handleAreaHoverChange}
              onStatSelectionChange={setSelectedStatId}
              onSecondaryStatChange={setSecondaryStatId}
              onCategorySelectionChange={setCategoryFilter}
              onVisibleIdsChange={(ids, _totalInSource, allSourceIds) => {
                applyMapVisibleIds(ids, allSourceIds);
              }}
              onBoundaryModeChange={handleMapBoundaryModeChange}
              onZipScopeChange={(scope, neighbors) => {
                setZipScope(scope);
                setZipNeighborScopes(neighbors);
              }}
              onCameraChange={setCameraState}
              onMapDragStart={() => {
                setSidebarFollowMode("map");
                track("map_interaction", { type: "drag", device: isMobile ? "mobile" : "desktop" });
                if (isMobile) collapseSheet();
              }}
              timeFilterAvailable={hasAnyHoursInSource}
              isMobile={isMobile}
              legendInset={legendInset}
              onControllerReady={handleMapControllerReady}
              userLocation={userLocation}
              onLocationSearch={handleMobileLocationSearch}
              onTimeChipClick={() => {
                track("map_time_chip_click", {
                  action: "open",
                  chipState: timeSelection ? "custom" : "open-now",
                  device: isMobile ? "mobile" : "desktop",
                });
                setShowTimeSelectorModal(true);
              }}
              onTimeChipClear={() => {
                track("map_time_chip_click", {
                  action: "clear",
                  chipState: timeSelection ? "custom" : "open-now",
                  device: isMobile ? "mobile" : "desktop",
                });
                handleClearTimeFilter();
              }}
              onLegendSettingsClick={() => setMapSettingsOpen(true)}
              onSidebarExpand={() => setSidebarCollapsed(false)}
              legendRangeMode={legendRangeMode}
              visibleStatIds={visibleStatIds}
            />
            {/* Desktop-only overlay still shows the location button inline */}
            {!isMobile && (
              <div className={["pointer-events-none absolute right-4 z-30"].join(" ")} style={{ bottom: 16 }}>
                <button
                  type="button"
                  onClick={() => {
                    if (isRequestingLocation) return;
                    track("map_my_location_click", {
                      variant: "desktop",
                      action: userLocation ? "zoom" : "request",
                    });
                    if (userLocation) {
                      focusUserLocation();
                    } else {
                      requestUserLocation();
                    }
                  }}
                  disabled={isRequestingLocation}
                  className={[
                    "pointer-events-auto inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-60",
                    userLocationError
                      ? "border border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300"
                      : "border border-slate-200 bg-white text-slate-700 hover:border-brand-200 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white",
                  ].join(" ")}
                  aria-label={isRequestingLocation ? "Locating..." : userLocationError ? userLocationError : userLocation ? "Zoom" : "My Location"}
                >
                  {isRequestingLocation ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent dark:border-slate-500" />
                  ) : (
                    <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
                      <path fill="currentColor" d="M10 2.5a.75.75 0 01.75.75v1.54a5.25 5.25 0 014.46 4.46H16.5a.75.75 0 010 1.5h-1.29a5.25 5.25 0 01-4.46 4.46v1.54a.75.75 0 01-1.5 0v-1.54a5.25 5.25 0 01-4.46-4.46H3.5a.75.75 0 010-1.5h1.29a5.25 5.25 0 014.46-4.46V3.25A.75.75 0 0110 2.5zm0 4a4 4 0 100 8 4 4 0 000-8z" />
                      <path fill="currentColor" d="M10 8.25a1.75 1.75 0 110 3.5 1.75 1.75 0 010-3.5z" />
                    </svg>
                  )}
                  <span>{isRequestingLocation ? "Locating..." : userLocationError ? userLocationError : userLocation ? "Zoom" : "My Location"}</span>
                </button>
              </div>
            )}
          </div>
        </main>
        {showMobileSheet && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 z-20 md:hidden"
            style={{ top: sheetState === "expanded" ? 0 : topBarHeight }}
          >
            <div className="flex h-full w-full flex-col">
              <div
                className="pointer-events-auto flex h-full w-full flex-col rounded-t-3xl border border-slate-200 bg-white pb-safe shadow-xl transition-transform duration-200 ease-out dark:border-slate-800 dark:bg-slate-900"
                style={{ transform: `translate3d(0, ${sheetTranslateY}px, 0)` }}
              >
                <div
                  role="button"
                  className="group relative flex flex-col items-center gap-2 rounded-t-3xl border-b border-slate-200 bg-transparent px-4 pt-3 pb-5 text-sm font-semibold text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 dark:border-slate-700 dark:text-slate-200"
                  onClick={handleHandleClick}
                  onPointerDown={handleHandlePointerDown}
                  aria-expanded={sheetState !== "peek"}
                >
                  {/* Back control on full-height sheet */}
                  {sheetState === "expanded" && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        collapseSheet();
                      }}
                      className="pointer-events-auto absolute left-3 top-2 rounded px-2 py-1 text-xs font-medium text-slate-400 hover:text-slate-600 dark:text-slate-400 dark:hover:text-slate-200"
                    >
                      <span className="inline-flex items-center gap-1">
                        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-3.5 w-3.5">
                          <path fill="currentColor" d="M12.78 15.53a.75.75 0 01-1.06 0l-4.25-4.25a.75.75 0 010-1.06l4.25-4.25a.75.75 0 111.06 1.06L8.56 10l4.22 4.22a.75.75 0 010 1.06z"/>
                        </svg>
                        <span>Back</span>
                      </span>
                    </button>
                  )}
                  {/* Drag bar with subtle arrow shape */}
                  <div className="flex items-center justify-center transition-all duration-200 -space-x-2">
                    <span
                      className={`h-1.5 w-5 rounded-full bg-slate-300 transition-all duration-200 group-active:bg-slate-400 dark:bg-slate-600 dark:group-active:bg-slate-500 ${
                        sheetState !== "expanded"
                          ? "-translate-x-0.5 -translate-y-0.5 -rotate-12"
                          : "-translate-x-0.5 translate-y-0.5 rotate-12"
                      }`}
                    />
                    <span
                      className={`h-1.5 w-5 rounded-full bg-slate-300 transition-all duration-200 group-active:bg-slate-400 dark:bg-slate-600 dark:group-active:bg-slate-500 ${
                        sheetState !== "expanded"
                          ? "translate-x-0.5 -translate-y-0.5 rotate-12"
                          : "translate-x-0.5 translate-y-0.5 -rotate-12"
                      }`}
                    />
                  </div>
                  {sheetState === "peek" ? (
                    <span className="flex items-center gap-2">
                      <span className={mobilePeekDotClassName} style={mobilePeekDotStyle} />
                      <span>{mobilePeekLabel}</span>
                    </span>
                  ) : null}
                </div>
                <div
                  ref={sheetContentRef}
                  onPointerDown={handleContentPointerDown}
                  className="flex-1 overflow-y-auto"
                  style={{
                    visibility: sheetState === "peek" ? "hidden" : "visible",
                    pointerEvents: sheetState === "peek" ? "none" : "auto",
                  }}
                  aria-hidden={sheetState === "peek"}
                >
                  <Sidebar
                    organizations={sidebarOrganizations}
                    searchOrganizations={availableOrganizations}
                    activeOrganizationId={activeOrganizationId}
                    highlightedOrganizationIds={highlightedOrganizationIds ?? undefined}
                    statsById={statsById}
                    statSummariesById={statSummariesByStatId}
                    seriesByStatIdByKind={seriesByStatIdScoped}
                    statDataById={statDataByStatId}
                    statRelationsByParent={statRelationsByParent}
                    statRelationsByChild={statRelationsByChild}
                    demographicsSnapshot={activeDemographicsSnapshot ?? combinedSnapshot}
                    selectedAreas={selectedAreasMap}
                    pinnedAreas={pinnedAreasMap}
                    activeAreaKind={activeAreaKind}
                    areaNameLookup={areaNameLookup}
                    directOrgSelectionActive={selectedOrgIdsFromMap && selectedOrgIds.length > 0}
                    selectedOrgIds={selectedOrgIds}
                    selectedOrgIdsFromMap={selectedOrgIdsFromMap}
                    zipScopeDisplayName={zipScopeDisplayName}
                    countyScopeDisplayName={countyScopeDisplayName}
                    getZipParentCounty={getZipParentCounty}
                    viewportCountyOrgCount={viewportCountyOrgCount}
                    viewportCountyVisibleCount={viewportCountyVisibleCount}
                    zipScopeCountyCode={zipScopeCountyCode}
                    hoveredArea={hoveredArea}
                    selectedStatId={selectedStatId}
                    secondaryStatId={secondaryStatId}
                    selectedStatLoading={isSelectedStatLoading}
                    categoryFilter={categoryFilter}
                    onCategoryChange={setCategoryFilter}
                    onHover={handleHover}
                    onOrganizationClick={handleSidebarOrganizationClick}
                    onHoverArea={handleAreaHoverChange}
                    onZoomOutAll={handleZoomOutAll}
                    onZoomToCounty={handleZoomToCounty}
                    onRequestCollapseSheet={collapseSheet}
                    onStatSelect={handleStatSelect}
                    onRetryStatData={retryStatData}
                    onExport={handleExport}
                    onOrgPinsVisibleChange={setOrgPinsVisible}
                    initialOrgPinsVisible={initialMapState.orgPinsVisible}
                    onClearAreas={handleClearAreas}
                    onRemoveArea={handleRemoveArea}
                    onAddAreas={handleAddAreas}
                    forceHideOrgsNonce={forceHideOrgsNonce}
                    forceShowOrgsNonce={forceShowOrgsNonce}
                    timeSelection={timeSelection}
                    onClearTimeFilter={handleClearTimeFilter}
                    onChangeTimeFilter={handleChangeTimeFilter}
                    cameraState={cameraState}
                  onZoomToOrg={handleZoomToOrg}
                  selectionLabelOverride={searchSelectionLabel}
                  selectionStyleVariant={selectionStyleVariant}
                  variant="mobile"
                  showInsights={true}
                  showAdvanced={showAdvanced}
                  insightsState={sidebarInsightsState}
                  onInsightsStateChange={(patch) =>
                    setSidebarInsightsState((prev) => ({
                      ...prev,
                      ...patch,
                    }))
                  }
                  className="h-full"
                  initialTab={sidebarTab}
                  onTabChange={setSidebarTab}
                />
              </div>
            </div>
            </div>
          </div>
        )}
      </div>
      {/* Roadmap overlay */}
      <div
        aria-hidden={activeScreen !== "roadmap"}
        style={{ visibility: activeScreen === "roadmap" ? "visible" : "hidden", top: topBarHeight }}
        className="absolute left-0 right-0 bottom-0 z-30"
      >
        {activeScreen === "roadmap" && (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-slate-500">Loading roadmap…</div>}>
            <RoadmapScreen />
          </Suspense>
        )}
      </div>
      {/* Report overlay (hidden via aria/visibility to ensure map stays laid out) */}
      <div
        aria-hidden={activeScreen !== "report"}
        style={{ visibility: activeScreen === "report" ? "visible" : "hidden", top: topBarHeight }}
        className="absolute left-0 right-0 bottom-0 z-30"
      >
        <div className="flex h-full w-full overflow-hidden bg-white pt-10 pb-safe dark:bg-slate-900">
          {/* Toolbar in report overlay */}
          <div className="absolute left-0 right-0 top-0 z-10">
            <BoundaryToolbar
              boundaryMode={boundaryMode}
              boundaryControlMode={boundaryControlMode}
              selections={toolbarSelections}
              hoveredArea={hoveredArea}
              stickyTopClass="top-0"
              onBoundaryModeChange={handleBoundaryModeManualSelect}
              onBoundaryControlModeChange={handleBoundaryControlModeChange}
              onHoverArea={setHoveredAreaState}
              onExport={handleExport}
              onUpdateSelection={handleUpdateAreaSelection}
              hideAreaSelect={isMobile}
              isMobile={isMobile}
            />
          </div>
          {activeScreen === "report" && (
            <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-slate-500">Loading report…</div>}>
              <ReportScreen
                activeKind={activeAreaKind}
                activeAreas={selectedAreasForReport}
                supplementalAreas={allSelectedAreas}
                organizations={organizations}
                orgZipById={orgZipById}
                orgCountyById={orgCountyById}
                statsById={statsById}
                statDataById={statDataByStatId}
                seriesByStatIdByKind={seriesByStatIdByKind}
                areaNameLookup={areaNameLookup}
              />
            </Suspense>
          )}
        </div>
      </div>

      {/* Data overlay */}
      <div
        aria-hidden={activeScreen !== "data"}
        style={{ visibility: activeScreen === "data" ? "visible" : "hidden", top: topBarHeight }}
        className="absolute left-0 right-0 bottom-0 z-30"
      >
        {activeScreen === "data" && (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-slate-500">Loading data…</div>}>
            <div className="flex h-full w-full overflow-auto bg-white pb-safe dark:bg-slate-900">
              <DataScreen />
            </div>
          </Suspense>
        )}
      </div>

      {/* Queue overlay */}
      <div
        aria-hidden={activeScreen !== "queue"}
        style={{ visibility: activeScreen === "queue" ? "visible" : "hidden", top: topBarHeight }}
        className="absolute left-0 right-0 bottom-0 z-30"
      >
        {activeScreen === "queue" && (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-slate-500">Loading queue…</div>}>
            <div className="flex h-full w-full overflow-hidden bg-white pb-safe dark:bg-slate-950">
              <QueueScreen />
            </div>
          </Suspense>
        )}
      </div>

      {/* Admin overlay */}
      <div
        aria-hidden={activeScreen !== "admin"}
        style={{ visibility: activeScreen === "admin" ? "visible" : "hidden", top: topBarHeight }}
        className="absolute left-0 right-0 bottom-0 z-30"
      >
        {(activeScreen === "admin" || isCensusImportRunning) && (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-slate-500">Loading admin…</div>}>
            <div className="flex h-full w-full overflow-hidden bg-white pb-safe dark:bg-slate-900">
              <AdminScreen />
            </div>
          </Suspense>
        )}
      </div>

      {/* Add organization overlay */}
      <div
        aria-hidden={activeScreen !== "addOrg"}
        style={{ visibility: activeScreen === "addOrg" ? "visible" : "hidden", top: topBarHeight }}
        className="absolute left-0 right-0 bottom-0 z-40"
      >
        {activeScreen === "addOrg" && (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-slate-500">Loading form…</div>}>
            <div className="flex h-full w-full overflow-hidden bg-white pb-safe dark:bg-slate-950">
              <AddOrganizationScreen
                onCancel={handleCloseAddOrganization}
                onCreated={handleOrganizationCreated}
                onFindNearbyOrg={handleFindNearbyOrg}
              />
            </div>
          </Suspense>
        )}
      </div>
      <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
      <WelcomeModal
        isOpen={showWelcomeModal}
        onClose={handleCloseWelcomeModal}
        onNeedFood={handleNeedFood}
        onShareFood={handleShareFood}
      />
      <ZipSearchModal
        isOpen={showZipSearchModal}
        onClose={() => setShowZipSearchModal(false)}
        onSearch={handleZipSearchSubmit}
      />
      <TimeSelectorModal
        isOpen={showTimeSelectorModal}
        onClose={() => setShowTimeSelectorModal(false)}
        onTimeSelect={(selection) => {
          setTimeSelection(selection);
          if (mapControllerRef.current) {
            mapControllerRef.current.setTimeSelection(selection);
          }
        }}
        initialSelection={timeSelection}
        isMobile={isMobile}
      />
      <MapSettingsModal
        open={mapSettingsOpen}
        onClose={() => setMapSettingsOpen(false)}
        rangeMode={legendRangeMode}
        reducedDataLoading={reducedDataLoading}
        onChangeReducedDataLoading={setReducedDataLoading}
        onChangeRangeMode={(mode) => {
          setLegendRangeMode(mode);
          if (mapControllerRef.current) {
            mapControllerRef.current.setLegendRangeMode(mode);
          }
        }}
      />
    </div>
  );
};
