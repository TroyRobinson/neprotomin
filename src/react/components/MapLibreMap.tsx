import { useEffect, useRef } from "react";
import type { BoundaryMode } from "../../types/boundaries";
import type { Organization } from "../../types/organization";
import type { AreaId, AreaKind } from "../../types/areas";
import type { AreasMode } from "../lib/mapUrl";
import { createMapView, type MapViewController, type SelectedStatChipOption } from "../imperative/mapView";

interface AreaSelectionChange {
  kind: AreaKind;
  selected: string[];
  pinned: string[];
  transient: string[];
}

interface MapLibreMapProps {
  organizations?: Organization[];
  orgPinsVisible?: boolean;
  initialMapPosition?: { lng: number; lat: number; zoom: number } | null;
  zoomOutRequestNonce?: number;
  // When incremented, explicitly clear the map's category chips
  clearMapCategoryNonce?: number;
  // Request from map chip to toggle organization pin visibility.
  onRequestHideOrgs?: () => void;
  onTimeChipClick?: () => void;
  boundaryMode?: BoundaryMode;
  selectedZips?: string[];
  pinnedZips?: string[];
  hoveredZip?: string | null;
  selectedCounties?: string[];
  pinnedCounties?: string[];
  hoveredCounty?: string | null;
  activeOrganizationId?: string | null;
  selectedOrgIds?: string[];
  categoryFilter?: string | null;
  areasMode?: AreasMode;
  selectedStatId?: string | null;
  selectedStatOptions?: SelectedStatChipOption[];
  secondaryStatId?: string | null;
  onHover?: (idOrIds: string | string[] | null) => void;
  onOrganizationClick?: (organizationId: string, meta?: { source: "point" | "centroid" }) => void;
  onClusterClick?: (
    organizationIds: string[],
    meta: { count: number; longitude: number; latitude: number },
  ) => void;
  onVisibleIdsChange?: (ids: string[], totalInSource: number, allSourceIds: string[]) => void;
  onZipSelectionChange?: (selectedZips: string[], meta?: { pinned: string[]; transient: string[] }) => void;
  onZipHoverChange?: (zip: string | null) => void;
  onCountySelectionChange?: (selectedCounties: string[], meta?: { pinned: string[]; transient: string[] }) => void;
  onCountyHoverChange?: (county: string | null) => void;
  onAreaSelectionChange?: (change: AreaSelectionChange) => void;
  onAreaHoverChange?: (area: AreaId | null) => void;
  onStatSelectionChange?: (statId: string | null) => void;
  onSecondaryStatChange?: (statId: string | null) => void;
  onCategorySelectionChange?: (categoryId: string | null) => void;
  onBoundaryModeChange?: (mode: BoundaryMode) => void;
  onAreasModeChange?: (mode: AreasMode) => void;
  onZipScopeChange?: (scope: string, neighbors: string[]) => void;
  onCameraChange?: (state: { center: [number, number]; zoom: number }) => void;
  autoBoundarySwitch?: boolean;
  onMapDragStart?: () => void;
  isMobile?: boolean;
  legendInset?: number;
  onControllerReady?: (controller: MapViewController | null) => void;
  userLocation?: { lng: number; lat: number } | null;
  onTimeChipClear?: () => void;
  onExportCsvAreasDownload?: () => void;
  exportCsvAreasAvailable?: boolean;
  onLocationSearch?: (query: string) => void;
  timeFilterAvailable?: boolean;
  onLegendSettingsClick?: () => void;
  onSidebarExpand?: () => void;
  legendRangeMode?: "dynamic" | "scoped" | "global";
  onboardingTourAutoPromptEnabled?: boolean;
  visibleStatIds?: string[] | null;
}

/**
 * MapLibreMap - A thin React wrapper around the imperative MapLibre GL setup
 *
 * This component initializes the map once and exposes it via an imperative controller.
 * All interactions are handled through props that update the underlying map state.
 */
export const MapLibreMap = ({
  organizations = [],
  orgPinsVisible = false,
  initialMapPosition = null,
  zoomOutRequestNonce,
  clearMapCategoryNonce,
  onRequestHideOrgs,
  onTimeChipClick,
  onTimeChipClear,
  onExportCsvAreasDownload,
  exportCsvAreasAvailable = false,
  boundaryMode = "zips",
  selectedZips = [],
  pinnedZips = [],
  hoveredZip = null,
  selectedCounties = [],
  pinnedCounties = [],
  hoveredCounty = null,
  activeOrganizationId = null,
  selectedOrgIds = [],
  categoryFilter = null,
  areasMode = "auto",
  selectedStatId = null,
  selectedStatOptions = [],
  secondaryStatId = null,
  onHover,
  onVisibleIdsChange,
  onZipSelectionChange,
  onZipHoverChange,
  onCountySelectionChange,
  onCountyHoverChange,
  onAreaSelectionChange,
  onAreaHoverChange,
  onStatSelectionChange,
  onSecondaryStatChange,
  onCategorySelectionChange,
  onBoundaryModeChange,
  onAreasModeChange,
  onZipScopeChange,
  onCameraChange,
  autoBoundarySwitch = true,
  onMapDragStart,
  onOrganizationClick,
  onClusterClick,
  isMobile = false,
  legendInset,
  onControllerReady,
  userLocation = null,
  onLocationSearch,
  timeFilterAvailable = true,
  onLegendSettingsClick,
  onSidebarExpand,
  legendRangeMode = "scoped",
  onboardingTourAutoPromptEnabled = true,
  visibleStatIds = null,
}: MapLibreMapProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapControllerRef = useRef<MapViewController | null>(null);
  const isInternalUpdateRef = useRef(false);
  const appliedBoundaryModeRef = useRef<BoundaryMode | null>(null);

  // Use refs for callbacks so we can update them in the wrapper
  const onZipSelectionChangeRef = useRef(onZipSelectionChange);
  const onHoverRef = useRef(onHover);
  const onOrganizationClickRef = useRef(onOrganizationClick);
  const onClusterClickRef = useRef(onClusterClick);
  const onVisibleIdsChangeRef = useRef(onVisibleIdsChange);
  const onZipHoverChangeRef = useRef(onZipHoverChange);
  const onCountySelectionChangeRef = useRef(onCountySelectionChange);
  const onCountyHoverChangeRef = useRef(onCountyHoverChange);
  const onAreaSelectionChangeRef = useRef(onAreaSelectionChange);
  const onAreaHoverChangeRef = useRef(onAreaHoverChange);
  const onStatSelectionChangeRef = useRef(onStatSelectionChange);
  const onSecondaryStatChangeRef = useRef(onSecondaryStatChange);
  const onCategorySelectionChangeRef = useRef(onCategorySelectionChange);
  const onBoundaryModeChangeRef = useRef(onBoundaryModeChange);
  const onAreasModeChangeRef = useRef(onAreasModeChange);
  const onZipScopeChangeRef = useRef(onZipScopeChange);
  const onCameraChangeRef = useRef(onCameraChange);
  const shouldAutoSwitchRef = useRef<boolean>(autoBoundarySwitch);
  const onMapDragStartRef = useRef(onMapDragStart);
  const onTimeChipClickRef = useRef(onTimeChipClick);
  const onTimeChipClearRef = useRef(onTimeChipClear);
  const onExportCsvAreasDownloadRef = useRef(onExportCsvAreasDownload);
  const onLocationSearchRef = useRef(onLocationSearch);
  const setLegendInsetRef = useRef<(pixels: number) => void>(() => {});
  const onLegendSettingsClickRef = useRef(onLegendSettingsClick);
  const legendRangeModeRef = useRef<"dynamic" | "scoped" | "global">(legendRangeMode);
  const visibleStatIdsRef = useRef<string[] | null>(visibleStatIds);

  useEffect(() => { onZipSelectionChangeRef.current = onZipSelectionChange; }, [onZipSelectionChange]);
  useEffect(() => { onHoverRef.current = onHover; }, [onHover]);
  useEffect(() => { onOrganizationClickRef.current = onOrganizationClick; }, [onOrganizationClick]);
  useEffect(() => { onClusterClickRef.current = onClusterClick; }, [onClusterClick]);
  useEffect(() => { onVisibleIdsChangeRef.current = onVisibleIdsChange; }, [onVisibleIdsChange]);
  useEffect(() => { onZipHoverChangeRef.current = onZipHoverChange; }, [onZipHoverChange]);
  useEffect(() => { onCountySelectionChangeRef.current = onCountySelectionChange; }, [onCountySelectionChange]);
  useEffect(() => { onCountyHoverChangeRef.current = onCountyHoverChange; }, [onCountyHoverChange]);
  useEffect(() => { onAreaSelectionChangeRef.current = onAreaSelectionChange; }, [onAreaSelectionChange]);
  useEffect(() => { onAreaHoverChangeRef.current = onAreaHoverChange; }, [onAreaHoverChange]);
  useEffect(() => { onStatSelectionChangeRef.current = onStatSelectionChange; }, [onStatSelectionChange]);
  useEffect(() => { onSecondaryStatChangeRef.current = onSecondaryStatChange; }, [onSecondaryStatChange]);
  useEffect(() => { onCategorySelectionChangeRef.current = onCategorySelectionChange; }, [onCategorySelectionChange]);
  useEffect(() => { onBoundaryModeChangeRef.current = onBoundaryModeChange; }, [onBoundaryModeChange]);
  useEffect(() => { onAreasModeChangeRef.current = onAreasModeChange; }, [onAreasModeChange]);
  useEffect(() => { onZipScopeChangeRef.current = onZipScopeChange; }, [onZipScopeChange]);
  useEffect(() => { onCameraChangeRef.current = onCameraChange; }, [onCameraChange]);
  useEffect(() => { shouldAutoSwitchRef.current = autoBoundarySwitch; }, [autoBoundarySwitch]);
  useEffect(() => { onMapDragStartRef.current = onMapDragStart; }, [onMapDragStart]);
  useEffect(() => { onTimeChipClickRef.current = onTimeChipClick; }, [onTimeChipClick]);
  useEffect(() => { onTimeChipClearRef.current = onTimeChipClear; }, [onTimeChipClear]);
  useEffect(() => { onExportCsvAreasDownloadRef.current = onExportCsvAreasDownload; }, [onExportCsvAreasDownload]);
  const onSidebarExpandRef = useRef(onSidebarExpand);
  useEffect(() => { onSidebarExpandRef.current = onSidebarExpand; }, [onSidebarExpand]);
  useEffect(() => { onLocationSearchRef.current = onLocationSearch; }, [onLocationSearch]);
  useEffect(() => { onLegendSettingsClickRef.current = onLegendSettingsClick; }, [onLegendSettingsClick]);
  useEffect(() => { legendRangeModeRef.current = legendRangeMode; }, [legendRangeMode]);
  useEffect(() => { visibleStatIdsRef.current = visibleStatIds; }, [visibleStatIds]);
  useEffect(() => {
    const controller = mapControllerRef.current;
    if (controller) {
      setLegendInsetRef.current = controller.setLegendInset;
      if (typeof legendInset === "number") {
        controller.setLegendInset(legendInset);
      } else {
        controller.setLegendInset(16);
      }
    }
  }, []);

  useEffect(() => {
    if (typeof legendInset === "number") {
      setLegendInsetRef.current?.(legendInset);
    }
  }, [legendInset]);

  // Initialize map once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const mapController = createMapView({
      initialAreasMode: areasMode,
      initialUserLocation: userLocation,
      initialMapPosition,
      onHover: (v) => onHoverRef.current?.(v),
      onVisibleIdsChange: (ids, total, all) => onVisibleIdsChangeRef.current?.(ids, total, all),
      onZipSelectionChange: (zips, meta) => {
        // Mark that this is coming from the map, not from React
        isInternalUpdateRef.current = true;
        onZipSelectionChangeRef.current?.(zips, meta);
        // Reset after state updates complete
        setTimeout(() => {
          isInternalUpdateRef.current = false;
        }, 0);
      },
      onZipHoverChange: (zip) => onZipHoverChangeRef.current?.(zip),
      onCountySelectionChange: (counties, meta) => {
        isInternalUpdateRef.current = true;
        onCountySelectionChangeRef.current?.(counties, meta);
        setTimeout(() => {
          isInternalUpdateRef.current = false;
        }, 0);
      },
      onCountyHoverChange: (county) => onCountyHoverChangeRef.current?.(county),
      onAreaSelectionChange: (change) => {
        isInternalUpdateRef.current = true;
        onAreaSelectionChangeRef.current?.(change);
        setTimeout(() => {
          isInternalUpdateRef.current = false;
        }, 0);
      },
      onAreaHoverChange: (area) => onAreaHoverChangeRef.current?.(area),
      onStatSelectionChange: (id) => onStatSelectionChangeRef.current?.(id),
      onSecondaryStatChange: (id) => onSecondaryStatChangeRef.current?.(id),
      onCategorySelectionChange: (id) => onCategorySelectionChangeRef.current?.(id),
      onBoundaryModeChange: (mode) => {
        appliedBoundaryModeRef.current = mode;
        onBoundaryModeChangeRef.current?.(mode);
      },
      onAreasModeChange: (mode) => onAreasModeChangeRef.current?.(mode),
      onZipScopeChange: (scope, neighbors) => onZipScopeChangeRef.current?.(scope, neighbors),
      shouldAutoBoundarySwitch: () => shouldAutoSwitchRef.current,
      onMapDragStart: () => onMapDragStartRef.current?.(),
      onOrganizationClick: (id, meta) => onOrganizationClickRef.current?.(id, meta),
      onClusterClick: (ids, meta) => onClusterClickRef.current?.(ids, meta),
      isMobile,
      onRequestHideOrgs: () => {
        try { onRequestHideOrgs?.(); } catch {}
      },
      onTimeChipClick: () => {
        try { onTimeChipClickRef.current?.(); } catch {}
      },
      onTimeChipClear: () => {
        try { onTimeChipClearRef.current?.(); } catch {}
      },
      onExportCsvAreasDownload: () => {
        try { onExportCsvAreasDownloadRef.current?.(); } catch {}
      },
      exportCsvAreasAvailable,
      onSidebarExpand: () => {
        try { onSidebarExpandRef.current?.(); } catch {}
      },
      onLocationSearch: (query) => {
        try { onLocationSearchRef.current?.(query); } catch {}
      },
      onLegendSettingsClick: () => {
        try { onLegendSettingsClickRef.current?.(); } catch {}
      },
      legendRangeMode,
      onboardingAutoPromptEnabled: onboardingTourAutoPromptEnabled,
    });

    containerRef.current.appendChild(mapController.element);
    mapControllerRef.current = mapController;
    mapController.setVisibleStatIds(visibleStatIdsRef.current);
    mapController.setSelectedStatOptions(selectedStatOptions);
    mapController.setExportCsvAreasVisible(Boolean(exportCsvAreasAvailable));
    setLegendInsetRef.current = mapController.setLegendInset;
    if (typeof legendInset === "number") {
      mapController.setLegendInset(legendInset);
    } else {
      mapController.setLegendInset(16);
    }
    onControllerReady?.(mapController);

    const unsubscribeCamera = mapController.onCameraChange((lng, lat, zoom) => {
      onCameraChangeRef.current?.({ center: [lng, lat], zoom });
    });

    return () => {
      unsubscribeCamera?.();
      onControllerReady?.(null);
      mapController.destroy();
      mapControllerRef.current = null;
      setLegendInsetRef.current = () => {};
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setAreasMode(areasMode);
    }
  }, [areasMode]);

  // Update organizations when they change
  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setOrganizations(organizations);
    }
  }, [organizations]);

  // Update organization pins visibility
  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setOrganizationPinsVisible(Boolean(orgPinsVisible));
    }
  }, [orgPinsVisible]);

  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setLegendRangeMode(legendRangeModeRef.current);
    }
  }, [legendRangeMode]);

  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setOnboardingTourAutoPromptEnabled(Boolean(onboardingTourAutoPromptEnabled));
    }
  }, [onboardingTourAutoPromptEnabled]);

  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setUserLocation(userLocation ?? null);
    }
  }, [userLocation]);

  // Update time filter availability (controls visibility of the Hours Open chip)
  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setTimeFilterAvailable(Boolean(timeFilterAvailable));
    }
  }, [timeFilterAvailable]);

  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setExportCsvAreasVisible(Boolean(exportCsvAreasAvailable));
    }
  }, [exportCsvAreasAvailable]);

  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setVisibleStatIds(visibleStatIds);
    }
  }, [visibleStatIds]);

  // Handle zoom out all trigger
  useEffect(() => {
    if (mapControllerRef.current && typeof zoomOutRequestNonce === "number") {
      mapControllerRef.current.fitAllOrganizations();
    }
  }, [zoomOutRequestNonce]);

  // Explicitly clear category chips when requested (e.g., clearing from sidebar)
  useEffect(() => {
    if (typeof clearMapCategoryNonce === "number" && mapControllerRef.current) {
      mapControllerRef.current.setCategoryFilter(null);
    }
  }, [clearMapCategoryNonce]);

  // Update boundary mode
  useEffect(() => {
    if (mapControllerRef.current) {
      if (appliedBoundaryModeRef.current !== boundaryMode) {
        appliedBoundaryModeRef.current = boundaryMode;
        mapControllerRef.current.setBoundaryMode(boundaryMode);
      }
    }
  }, [boundaryMode]);

  // Update pinned zips
  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setPinnedZips(pinnedZips);
    }
  }, [pinnedZips]);

  // Update pinned counties
  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setPinnedCounties(pinnedCounties);
    }
  }, [pinnedCounties]);

  // Update hovered zip
  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setHoveredZip(hoveredZip);
    }
  }, [hoveredZip]);

  // Update hovered county
  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setHoveredCounty(hoveredCounty);
    }
  }, [hoveredCounty]);

  // Update active organization
  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setActiveOrganization(activeOrganizationId);
    }
  }, [activeOrganizationId]);

  // Update selected org IDs
  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setSelectedOrgIds(selectedOrgIds);
    }
  }, [selectedOrgIds]);

  // Update category filter
  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setCategoryFilter(categoryFilter);
    }
  }, [categoryFilter]);

  // Update selected stat
  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setSelectedStat(selectedStatId);
    }
  }, [selectedStatId]);

  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setSelectedStatOptions(selectedStatOptions);
    }
  }, [selectedStatOptions]);

  // Update secondary stat
  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setSecondaryStat(secondaryStatId);
    }
  }, [secondaryStatId]);

  // Handle selected zips changes from external sources (like toolbar add button)
  // Track what we last sent to prevent circular updates from map callbacks
  const lastSentZipsRef = useRef<string>("");
  const lastSentCountiesRef = useRef<string>("");

  useEffect(() => {
    // Create a stable string representation to check if zips actually changed
    const pinnedKey = [...pinnedZips].sort().join(",");
    const selectedKey = [...selectedZips].sort().join(",");
    const currentKey = `${selectedKey}|${pinnedKey}`;

    // Always track what React state looks like, even if we skip the map update.
    // This ensures subsequent clears detect a change when comparing keys.
    const keyChanged = currentKey !== lastSentZipsRef.current;
    lastSentZipsRef.current = currentKey;

    // Skip sending to map if controller not ready or this is an echo from map's own update
    if (!mapControllerRef.current || isInternalUpdateRef.current) return;

    // Only update map if the zips actually changed
    if (keyChanged) {
      // Calculate transient zips (selected but not pinned)
      const transientZips = selectedZips.filter((z) => !pinnedZips.includes(z));

      // Clear and re-add transient selection
      mapControllerRef.current.clearTransientSelection();
      if (transientZips.length > 0) {
        mapControllerRef.current.addTransientZips(transientZips);
      }
    }
  }, [selectedZips, pinnedZips]);

  useEffect(() => {
    const pinnedKey = [...pinnedCounties].sort().join(",");
    const selectedKey = [...selectedCounties].sort().join(",");
    const currentKey = `${selectedKey}|${pinnedKey}`;

    // Always track what React state looks like, even if we skip the map update
    const keyChanged = currentKey !== lastSentCountiesRef.current;
    lastSentCountiesRef.current = currentKey;

    // Skip sending to map if controller not ready or this is an echo from map's own update
    if (!mapControllerRef.current || isInternalUpdateRef.current) return;

    if (keyChanged) {
      const transient = selectedCounties.filter((id) => !pinnedCounties.includes(id));
      mapControllerRef.current.clearCountyTransientSelection();
      if (transient.length > 0) {
        mapControllerRef.current.addTransientCounties(transient);
      }
    }
  }, [selectedCounties, pinnedCounties]);

  return (
    <div
      ref={containerRef}
      className="relative flex flex-1"
      style={{ minHeight: 0, minWidth: 0 }}
    />
  );
};
