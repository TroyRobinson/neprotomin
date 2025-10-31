import { useState, lazy, Suspense, useEffect, useMemo, useRef, useCallback } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { TopBar } from "./components/TopBar";
import { BoundaryToolbar } from "./components/BoundaryToolbar";
import { MapLibreMap } from "./components/MapLibreMap";
import { Sidebar } from "./components/Sidebar";
import { WelcomeModal } from "./components/WelcomeModal";
import { ZipSearchModal } from "./components/ZipSearchModal";
import { useDemographics, type CombinedDemographicsSnapshot } from "./hooks/useDemographics";
import { useStats } from "./hooks/useStats";
import type { StatBoundaryEntry, SeriesByKind, SeriesEntry } from "./hooks/useStats";
import { useOrganizations } from "./hooks/useOrganizations";
import { useAreas } from "./hooks/useAreas";
import { type Organization, OKLAHOMA_CENTER, OKLAHOMA_DEFAULT_ZOOM } from "../types/organization";
import { findZipForLocation, getZipBounds } from "../lib/zipBoundaries";
import { findCountyForLocation, getCountyBounds } from "../lib/countyBoundaries";
import type { BoundaryMode } from "../types/boundaries";
import { AuthModal } from "./components/AuthModal";
import { db } from "../lib/reactDb";
import type { AreaId, AreaKind, PersistedAreaSelection } from "../types/areas";
import { DEFAULT_PARENT_AREA_BY_KIND } from "../types/areas";
import { normalizeScopeLabel, buildScopeLabelAliases } from "../lib/scopeLabels";
import { useMediaQuery } from "./hooks/useMediaQuery";
import type { MapViewController } from "./imperative/mapView";
import { isAdminEmail } from "../lib/admin";
type SupportedAreaKind = "ZIP" | "COUNTY";
const ReportScreen = lazy(() => import("./components/ReportScreen").then((m) => ({ default: m.ReportScreen })));
const DataScreen = lazy(() => import("./components/DataScreen").then((m) => ({ default: m.default })));
const AddOrganizationScreen = lazy(() =>
  import("./components/AddOrganizationScreen").then((m) => ({ default: m.AddOrganizationScreen })),
);
const QueueScreen = lazy(() =>
  import("./components/QueueScreen").then((m) => ({ default: m.QueueScreen })),
);

const COUNTY_MODE_ENABLE_ZOOM = 9;
const COUNTY_MODE_DISABLE_ZOOM = 9.6;

// Feature flag: if true, always show welcome modal on app load (for testing)
const ALWAYS_SHOW_WELCOME_MODAL = false;

const FALLBACK_ZIP_SCOPE = normalizeScopeLabel(DEFAULT_PARENT_AREA_BY_KIND.ZIP ?? "Oklahoma") ?? "Oklahoma";
const DEFAULT_PRIMARY_STAT_ID = "8383685c-2741-40a2-96ff-759c42ddd586";
const DEFAULT_TOP_BAR_HEIGHT = 64;
const MOBILE_MAX_WIDTH_QUERY = "(max-width: 767px)";
const MOBILE_SHEET_PEEK_HEIGHT = 136;
const MOBILE_SHEET_DRAG_THRESHOLD = 72;

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

const createInitialAreaSelections = (): AreaSelectionMap => ({
  ZIP: createEmptySelection(),
  COUNTY: createEmptySelection(),
  TRACT: createEmptySelection(),
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
  const [boundaryMode, setBoundaryMode] = useState<BoundaryMode>("zips");
  const [boundaryControlMode, setBoundaryControlMode] = useState<"auto" | "manual">("auto");
  const [areaSelections, setAreaSelections] = useState<AreaSelectionMap>(createInitialAreaSelections);
  const [hoveredArea, setHoveredArea] = useState<AreaId | null>(null);
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(null);
  const [highlightedOrganizationIds, setHighlightedOrganizationIds] = useState<string[] | null>(null);
  const [selectedStatId, setSelectedStatId] = useState<string | null>(null);
  const [secondaryStatId, setSecondaryStatId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [hasAppliedDefaultStat, setHasAppliedDefaultStat] = useState(false);
  const [hasSyncedDefaultCategory, setHasSyncedDefaultCategory] = useState(false);
  const [activeScreen, setActiveScreen] = useState<"map" | "report" | "data" | "queue" | "addOrg">("map");
  const [authOpen, setAuthOpen] = useState(false);
  const [cameraState, setCameraState] = useState<{ center: [number, number]; zoom: number } | null>(null);
  const [zipScope, setZipScope] = useState<string>(DEFAULT_PARENT_AREA_BY_KIND.ZIP ?? "Oklahoma");
  const [zipNeighborScopes, setZipNeighborScopes] = useState<string[]>([]);
  const isMobile = useMediaQuery(MOBILE_MAX_WIDTH_QUERY);
  const [topBarHeight, setTopBarHeight] = useState(DEFAULT_TOP_BAR_HEIGHT);
  const [sheetState, setSheetState] = useState<"peek" | "expanded">("peek");
  const [sheetDragOffset, setSheetDragOffset] = useState(0);
  const [isDraggingSheet, setIsDraggingSheet] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(() => {
    if (typeof window === "undefined") return 0;
    const viewport = window.visualViewport;
    return Math.round(viewport?.height ?? window.innerHeight);
  });
  const [userLocation, setUserLocation] = useState<{ lng: number; lat: number } | null>(null);
  const [isRequestingLocation, setIsRequestingLocation] = useState(false);
  const [userLocationError, setUserLocationError] = useState<string | null>(null);
  const [showWelcomeModal, setShowWelcomeModal] = useState(false);
  const [showZipSearchModal, setShowZipSearchModal] = useState(false);
  const [expandMobileSearch, setExpandMobileSearch] = useState(false);
  const sheetPointerIdRef = useRef<number | null>(null);
  const sheetDragStateRef = useRef<{ startY: number; startState: "peek" | "expanded" } | null>(null);
  const pendingContentDragRef = useRef<{ pointerId: number; startY: number } | null>(null);
  const sheetContentRef = useRef<HTMLDivElement | null>(null);
  const mapControllerRef = useRef<MapViewController | null>(null);
  const sheetAvailableHeight = Math.max(viewportHeight - topBarHeight, 0);
  const sheetPeekOffset = Math.max(sheetAvailableHeight - MOBILE_SHEET_PEEK_HEIGHT, 0);

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

  const buildBoundsAroundPoint = useCallback((lng: number, lat: number) => {
    const lngDelta = isMobile ? 0.075 : 0.18;
    const latDelta = isMobile ? 0.045 : 0.12;
    return [
      [lng - lngDelta, lat - latDelta] as [number, number],
      [lng + lngDelta, lat + latDelta] as [number, number],
    ] as [[number, number], [number, number]];
  }, [isMobile]);

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
    if (!userLocation) {
      requestUserLocation();
      return;
    }
    setActiveScreen("map");
    
    // Find and select the ZIP code for the user's location
    const zipCode = findZipForLocation(userLocation.lng, userLocation.lat);
    if (zipCode) {
      // Clear existing selections before selecting the new ZIP
      applyAreaSelection("ZIP", { selected: [], pinned: [], transient: [] });
      applyAreaSelection("COUNTY", { selected: [], pinned: [], transient: [] });

      // Select the ZIP containing the user's location
      applyAreaSelection("ZIP", {
        selected: [zipCode],
        pinned: [zipCode],
        transient: [],
      });
      
      // Switch to ZIP mode if needed
      setBoundaryMode("zips");
    }
    
    const controller = mapControllerRef.current;
    if (controller) {
      const bounds = buildBoundsAroundPoint(userLocation.lng, userLocation.lat);
      controller.fitBounds(bounds, { padding: isMobile ? 40 : 72, maxZoom: isMobile ? 13 : 11 });
    } else if (mapControllerRef.current?.setCamera) {
      const targetZoom = isMobile ? 12.6 : 10.5;
      mapControllerRef.current.setCamera(userLocation.lng, userLocation.lat, targetZoom);
    }
    if (isMobile) {
      collapseSheet();
    }
  }, [buildBoundsAroundPoint, collapseSheet, isMobile, requestUserLocation, userLocation, applyAreaSelection, setBoundaryMode]);

  const startSheetDrag = useCallback(
    (pointerId: number, clientY: number, startState: "peek" | "expanded") => {
      if (sheetPeekOffset <= 0) {
        expandSheet();
        return;
      }
      sheetPointerIdRef.current = pointerId;
      sheetDragStateRef.current = { startY: clientY, startState };
      setIsDraggingSheet(true);
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
      } else {
        setSheetState(delta < -MOBILE_SHEET_DRAG_THRESHOLD ? "expanded" : "peek");
      }
    },
    [expandSheet, sheetPeekOffset],
  );

  const handleHandlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!isMobile) return;
      event.preventDefault();
      startSheetDrag(event.pointerId, event.clientY, sheetState);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [isMobile, sheetState, startSheetDrag],
  );

  const handleHandleClick = useCallback(() => {
    if (!isMobile) return;
    if (sheetState === "peek") {
      expandSheet();
    } else {
      collapseSheet();
    }
  }, [collapseSheet, expandSheet, isMobile, sheetState]);

  const handleContentPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isMobile || sheetState !== "expanded") return;
      if (event.pointerType === "mouse" && event.buttons !== 1) return;
      const content = sheetContentRef.current;
      if (!content) return;
      if (content.scrollTop > 0) {
        pendingContentDragRef.current = null;
        return;
      }
      pendingContentDragRef.current = { pointerId: event.pointerId, startY: event.clientY };
    },
    [isMobile, sheetState],
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

  const { isLoading: isAuthLoading, user } = db.useAuth();
  const isAdmin = useMemo(() => {
    if (!user || user.isGuest) return false;
    if (typeof user.email !== "string" || user.email.trim().length === 0) return false;
    return isAdminEmail(user.email);
  }, [user]);
  useEffect(() => {
    if (isAuthLoading) return;
    if (!user) {
      db.auth.signInAsGuest().catch(() => {
        // ignore; may be offline or already attempted
      });
    }
  }, [isAuthLoading, user]);

  useEffect(() => {
    if (!isAdmin && activeScreen === "queue") {
      setActiveScreen("map");
    }
    if (!isAdmin && activeScreen === "data") {
      setActiveScreen("map");
    }
  }, [isAdmin, activeScreen]);

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

  const sheetTranslateY = useMemo(() => {
    if (!isMobile) return 0;
    if (sheetPeekOffset <= 0) return 0;
    if (sheetState === "expanded") {
      return Math.min(Math.max(sheetDragOffset, 0), sheetPeekOffset);
    }
    const adjustment = Math.max(-sheetPeekOffset, Math.min(sheetDragOffset, 0));
    return sheetPeekOffset + adjustment;
  }, [isMobile, sheetState, sheetDragOffset, sheetPeekOffset]);

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

      if (!isDraggingSheet) return;
      if (sheetPointerIdRef.current !== null && event.pointerId !== sheetPointerIdRef.current) return;
      const dragState = sheetDragStateRef.current;
      if (!dragState) return;
      const delta = event.clientY - dragState.startY;
      if (dragState.startState === "expanded") {
        const clamped = Math.max(0, Math.min(delta, sheetPeekOffset));
        setSheetDragOffset(clamped);
      } else {
        const clamped = Math.max(-sheetPeekOffset, Math.min(delta, 0));
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

  // Check if welcome modal should be shown (not dismissed)
  useEffect(() => {
    if (typeof window === "undefined") return;
    
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
  }, []);

  // Persisted UI state: load on auth ready
  useEffect(() => {
    if (isAuthLoading) return;
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
  }, [isAuthLoading, user?.id]);

  // Persisted UI state: save with debounce
  useEffect(() => {
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
  }, [user?.id, selectedZips, pinnedZips, selectedCounties, pinnedCounties, boundaryMode]);

  const { areasByKindAndCode, getAreaLabel } = useAreas();

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

  const { combinedSnapshot, demographicsByKind } = useDemographics({
    selectedByKind: {
      ZIP: selectedZips,
      COUNTY: selectedCounties,
    },
    defaultContext: defaultAreaContext,
    zipScope,
  });

  const {
    statsById,
    seriesByStatIdByKind,
    seriesByStatIdByParent,
    statDataByParent,
    isLoading: areStatsLoading,
  } = useStats();
  const { organizations } = useOrganizations();

  const areaNameLookup = useMemo(
    () => (kind: SupportedAreaKind, code: string) => getAreaLabel(kind, code) ?? code,
    [getAreaLabel],
  );

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

      for (const scope of relevantScopes) {
        const entry = byParent.get(scope);
        const incoming = entry?.ZIP;
        if (incoming) {
          aggregate.ZIP = mergeStatEntry(aggregate.ZIP, incoming);
        }
      }

      for (const scope of countyScopes) {
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
  }, [statDataByParent, relevantScopes, countyScopes]);

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

  const inactiveOrganizations = useMemo(
    () => organizations.filter((org) => org.status && org.status !== "active"),
    [organizations],
  );

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

      for (const scope of relevantScopes) {
        const scopeEntry = byParent.get(scope);
        if (!scopeEntry) continue;
        const zipBucket = buckets.get("ZIP") ?? new Map<string, SeriesEntry>();
        mergeSeriesInto(zipBucket, scopeEntry.get("ZIP"));
        if (zipBucket.size > 0) {
          buckets.set("ZIP", zipBucket);
        }
      }

      for (const scope of countyScopes) {
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
  }, [seriesByStatIdByParent, relevantScopes, countyScopes]);

  useEffect(() => {
    if (hasAppliedDefaultStat) return;
    if (!DEFAULT_PRIMARY_STAT_ID) {
      setHasAppliedDefaultStat(true);
      return;
    }

    const defaultStat = statsById.get(DEFAULT_PRIMARY_STAT_ID);

    if (defaultStat) {
      setSelectedStatId(DEFAULT_PRIMARY_STAT_ID);
      setHasAppliedDefaultStat(true);
      return;
    }

    if (!areStatsLoading) {
      setHasAppliedDefaultStat(true);
    }
  }, [areStatsLoading, hasAppliedDefaultStat, statsById]);

  useEffect(() => {
    if (hasSyncedDefaultCategory) return;
    if (categoryFilter) {
      setHasSyncedDefaultCategory(true);
      return;
    }
    if (!selectedStatId) return;
    const stat = statsById.get(selectedStatId);
    if (stat?.category) {
      setCategoryFilter(stat.category);
      setHasSyncedDefaultCategory(true);
    }
  }, [categoryFilter, hasSyncedDefaultCategory, selectedStatId, statsById]);


  const [orgPinsVisible, setOrgPinsVisible] = useState(true);
  const [orgsVisibleIds, setOrgsVisibleIds] = useState<string[]>([]);
  const [orgsAllSourceIds, setOrgsAllSourceIds] = useState<string[]>([]);
  const [zoomOutNonce, setZoomOutNonce] = useState(0);
  // Nonce to explicitly clear map category chips when clearing stat from sidebar
  const [clearMapCategoryNonce, setClearMapCategoryNonce] = useState(0);
  // Nonce to force Sidebar switch to Statistics and hide orgs toggle
  const [forceHideOrgsNonce, setForceHideOrgsNonce] = useState(0);

  const handleBrandClick = () => {
    applyAreaSelection("ZIP", { selected: [], pinned: [], transient: [] });
    applyAreaSelection("COUNTY", { selected: [], pinned: [], transient: [] });
    setActiveScreen("map");
    const controller = mapControllerRef.current;
    if (controller) {
      controller.setCamera(
        OKLAHOMA_CENTER.longitude,
        OKLAHOMA_CENTER.latitude,
        OKLAHOMA_DEFAULT_ZOOM,
      );
    }
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
        expandSheet();
      }
    },
    [expandSheet, isMobile],
  );

  const handleCloseAddOrganization = useCallback(() => {
    setActiveScreen("map");
  }, []);

  const handleFindNearbyOrg = useCallback(async () => {
    // First try to get user's location
    try {
      const location = await requestUserLocation();
      // If location is successfully obtained, zoom to it
      setActiveScreen("map");
      
      // Find and select the ZIP code for the user's location
      const zipCode = findZipForLocation(location.lng, location.lat);
      if (zipCode) {
        // Clear existing selections before selecting the new ZIP
        applyAreaSelection("ZIP", { selected: [], pinned: [], transient: [] });
        applyAreaSelection("COUNTY", { selected: [], pinned: [], transient: [] });

        // Select the ZIP containing the user's location
        applyAreaSelection("ZIP", {
          selected: [zipCode],
          pinned: [zipCode],
          transient: [],
        });
        
        // Switch to ZIP mode if needed
        setBoundaryMode("zips");
      }
      
      const controller = mapControllerRef.current;
      if (controller) {
        const bounds = buildBoundsAroundPoint(location.lng, location.lat);
        controller.fitBounds(bounds, { padding: isMobile ? 40 : 72, maxZoom: isMobile ? 13 : 11 });
      } else if (mapControllerRef.current?.setCamera) {
        const targetZoom = isMobile ? 12.6 : 10.5;
        mapControllerRef.current.setCamera(location.lng, location.lat, targetZoom);
      }
      if (isMobile) {
        collapseSheet();
      }
    } catch (error) {
      // Location failed, open zip search modal on desktop or expand mobile search on mobile
      if (isMobile) {
        setExpandMobileSearch(true);
        setTimeout(() => setExpandMobileSearch(false), 200);
      } else {
        setShowZipSearchModal(true);
      }
    }
  }, [isMobile, requestUserLocation, buildBoundsAroundPoint, collapseSheet, applyAreaSelection, setBoundaryMode]);

  const handleHover = useCallback((idOrIds: string | string[] | null) => {
    if (Array.isArray(idOrIds)) {
      setHighlightedOrganizationIds(idOrIds);
      return;
    }
    setHighlightedOrganizationIds(null);
    setActiveOrganizationId(idOrIds);
  }, []);

  const handleOrganizationClick = useCallback(
    (id: string) => {
      if (!id) return;
      setActiveScreen("map");
      setActiveOrganizationId(id);
      setHighlightedOrganizationIds(null);
      if (isMobile) {
        expandSheet();
      }
    },
    [expandSheet, isMobile],
  );

  const handleClusterClick = useCallback(
    (ids: string[], _meta: { count: number; longitude: number; latitude: number }) => {
      if (!Array.isArray(ids) || ids.length === 0) return;
      const uniqueIds = dedupeIds(ids);
      setActiveScreen("map");
      if (uniqueIds.length === 1) {
        setActiveOrganizationId(uniqueIds[0]);
        setHighlightedOrganizationIds(null);
      } else {
        setActiveOrganizationId(null);
        setHighlightedOrganizationIds(uniqueIds);
      }
      if (isMobile) {
        expandSheet();
      }
    },
    [expandSheet, isMobile],
  );

  const handleUpdateAreaSelection = (kind: AreaKind, selection: { selected: string[]; pinned: string[] }) => {
    applyAreaSelection(kind, {
      selected: dedupeIds(selection.selected),
      pinned: dedupeIds(selection.pinned),
      transient: [],
    });
  };

  const handleAreaSelectionChange = (change: { kind: AreaKind; selected: string[]; pinned: string[]; transient: string[] }) => {
    applyAreaSelection(change.kind, {
      selected: change.selected,
      pinned: change.pinned,
      transient: change.transient,
    });
  };

  const handleAreaHoverChange = (area: AreaId | null) => {
    setHoveredAreaState(area);
  };

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
  }, []);

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
    (rawQuery: string) => {
      const query = rawQuery.trim();
      if (!query) return;

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
      if (isMobile && sheetState === "expanded") {
        collapseSheet();
      }
    },
    [
      areasByKindAndCode,
      countyRecords,
      zipRecords,
      collapseSheet,
      isMobile,
      sheetState,
      applyAreaSelection,
      setBoundaryMode,
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
      const fromSource = activeOrganizations.filter(
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

  const handleStatSelect = (
    statId: string | null,
    meta?: { shiftKey?: boolean; clear?: boolean }
  ) => {
    if (statId === null) {
      setSelectedStatId(null);
      setSecondaryStatId(null);
      if (meta?.clear) {
        setCategoryFilter(null);
        // Ensure the map overlay category chip also clears even if
        // categoryFilter was already null (no state change to trigger effects).
        setClearMapCategoryNonce((n) => n + 1);
      }
      return;
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
    const fromSource = activeOrganizations.filter((o) => sourceIds.size === 0 || sourceIds.has(o.id));
    const visible = fromSource.filter((o) => visibleIds.size === 0 || visibleIds.has(o.id));
    const zipSel = new Set(selectedZips);
    const countySel = new Set(selectedCounties);
    let inSelection: Organization[] = [];
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
    const inactiveSorted = inactiveOrganizations.slice().sort((a, b) => a.name.localeCompare(b.name));
    const totalSourceCount = (sourceIds.size || fromSource.length) + inactiveOrganizations.length;
    const visibleInViewport = inSelection.length + rest.length;
    return { inSelection, all: [...rest, ...inactiveSorted], totalSourceCount, visibleInViewport };
  })();

  const visibleCount =
    typeof sidebarOrganizations.visibleInViewport === "number"
      ? sidebarOrganizations.visibleInViewport
      : sidebarOrganizations.inSelection.length + sidebarOrganizations.all.length;
  // Always show viewport count in mobile peek mode, regardless of area selection
  const mobileOrganizationsCount = visibleCount;

  const handleTopBarNavigate = useCallback(
    (screen: "map" | "report" | "data" | "queue") => {
      if (screen === "queue" && !isAdmin) {
        setActiveScreen("map");
        return;
      }
      if (screen === "data" && !isAdmin) {
        setActiveScreen("map");
        return;
      }
      setActiveScreen(screen);
    },
    [isAdmin, setActiveScreen],
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
      // Zoom to location immediately with the resolved location
      setActiveScreen("map");
      
      // Find and select the ZIP code for the user's location
      const zipCode = findZipForLocation(location.lng, location.lat);
      if (zipCode) {
        // Clear existing selections before selecting the new ZIP
        applyAreaSelection("ZIP", { selected: [], pinned: [], transient: [] });
        applyAreaSelection("COUNTY", { selected: [], pinned: [], transient: [] });

        // Select the ZIP containing the user's location
        applyAreaSelection("ZIP", {
          selected: [zipCode],
          pinned: [zipCode],
          transient: [],
        });
        
        // Switch to ZIP mode if needed
        setBoundaryMode("zips");
      }
      
      const controller = mapControllerRef.current;
      if (controller) {
        const bounds = buildBoundsAroundPoint(location.lng, location.lat);
        controller.fitBounds(bounds, { padding: isMobile ? 40 : 72, maxZoom: isMobile ? 13 : 11 });
      } else if (mapControllerRef.current?.setCamera) {
        const targetZoom = isMobile ? 12.6 : 10.5;
        mapControllerRef.current.setCamera(location.lng, location.lat, targetZoom);
      }
      if (isMobile) {
        collapseSheet();
      }
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
  }, [handleCloseWelcomeModal, requestUserLocation, isMobile, buildBoundsAroundPoint, collapseSheet, applyAreaSelection, setBoundaryMode]);

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

  return (
    <div className="app-shell relative flex flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
      <TopBar
        onBrandClick={handleBrandClick}
        onNavigate={handleTopBarNavigate}
        active={
          activeScreen === "report"
            ? "report"
            : activeScreen === "data"
            ? "data"
            : activeScreen === "queue"
            ? "queue"
            : "map"
        }
        onOpenAuth={() => setAuthOpen(true)}
        isMobile={isMobile}
        onMobileLocationSearch={handleMobileLocationSearch}
        onAddOrganization={handleOpenAddOrganization}
        expandMobileSearch={expandMobileSearch}
      />
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {!isMobile && (
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
        <main className="relative flex flex-1 flex-col overflow-hidden md:flex-row">
          <div className="relative flex flex-1 flex-col overflow-hidden">
              <MapLibreMap
                key={isMobile ? "mobile" : "desktop"}
                organizations={activeOrganizations}
                orgPinsVisible={orgPinsVisible}
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
                  setOrgsVisibleIds(ids);
                  setOrgsAllSourceIds(allSourceIds);
                }}
                onBoundaryModeChange={handleMapBoundaryModeChange}
                onZipScopeChange={(scope, neighbors) => {
                  setZipScope(scope);
                  setZipNeighborScopes(neighbors);
                }}
                onCameraChange={setCameraState}
                onMapDragStart={() => {
                  if (isMobile) collapseSheet();
                }}
                isMobile={isMobile}
                legendInset={legendInset}
                onControllerReady={handleMapControllerReady}
                userLocation={userLocation}
              />
              {/* Desktop-only overlay still shows the location button inline */}
              {!isMobile && (
                <div className={["pointer-events-none absolute right-4 z-30"].join(" ")} style={{ bottom: 16 }}>
                  <button
                    type="button"
                    onClick={() => {
                      if (isRequestingLocation) return;
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
          {!isMobile && (
            <Sidebar
              organizations={sidebarOrganizations}
              activeOrganizationId={activeOrganizationId}
              highlightedOrganizationIds={highlightedOrganizationIds ?? undefined}
              statsById={statsById}
              seriesByStatIdByKind={seriesByStatIdScoped}
              statDataById={statDataByStatId}
              demographicsSnapshot={activeDemographicsSnapshot ?? combinedSnapshot}
              selectedAreas={selectedAreasMap}
              pinnedAreas={pinnedAreasMap}
              activeAreaKind={activeAreaKind}
              areaNameLookup={areaNameLookup}
              zipScopeDisplayName={zipScopeDisplayName}
              countyScopeDisplayName={countyScopeDisplayName}
              hoveredArea={hoveredArea}
              selectedStatId={selectedStatId}
              secondaryStatId={secondaryStatId}
              categoryFilter={categoryFilter}
              onHover={handleHover}
              onHoverArea={handleAreaHoverChange}
              onZoomOutAll={handleZoomOutAll}
              onStatSelect={handleStatSelect}
              onOrgPinsVisibleChange={setOrgPinsVisible}
              forceHideOrgsNonce={forceHideOrgsNonce}
              variant="desktop"
            />
          )}
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
                  aria-expanded={sheetState === "expanded"}
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
                  <span className="h-1.5 w-12 rounded-full bg-slate-300 transition-colors group-active:bg-slate-400 dark:bg-slate-600 dark:group-active:bg-slate-500" />
                  {sheetState === "peek" ? (
                    <span className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full ring-1 ring-black/5 dark:ring-white/10"
                        style={{ backgroundColor: "#fdba74" }}
                      />
                      <span>{mobileOrganizationsCount} Food Providers</span>
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
                    activeOrganizationId={activeOrganizationId}
                    highlightedOrganizationIds={highlightedOrganizationIds ?? undefined}
                    statsById={statsById}
                    seriesByStatIdByKind={seriesByStatIdScoped}
                    statDataById={statDataByStatId}
                    demographicsSnapshot={activeDemographicsSnapshot ?? combinedSnapshot}
                    selectedAreas={selectedAreasMap}
                    pinnedAreas={pinnedAreasMap}
                    activeAreaKind={activeAreaKind}
                    areaNameLookup={areaNameLookup}
                    zipScopeDisplayName={zipScopeDisplayName}
                    countyScopeDisplayName={countyScopeDisplayName}
                    hoveredArea={hoveredArea}
                    selectedStatId={selectedStatId}
                    secondaryStatId={secondaryStatId}
                    categoryFilter={categoryFilter}
                    onHover={handleHover}
                    onHoverArea={handleAreaHoverChange}
                    onZoomOutAll={handleZoomOutAll}
                    onStatSelect={handleStatSelect}
                    onOrgPinsVisibleChange={setOrgPinsVisible}
                    forceHideOrgsNonce={forceHideOrgsNonce}
                    variant="mobile"
                    showInsights={false}
                    className="h-full"
                  />
                </div>
              </div>
            </div>
          </div>
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
    </div>
  );
};
