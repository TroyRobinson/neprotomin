import { useEffect, useRef } from "react";
import type { BoundaryMode } from "../../types/boundaries";
import type { Organization } from "../../types/organization";
import { createMapView, type MapViewController } from "../imperative/mapView";

interface MapLibreMapProps {
  organizations?: Organization[];
  orgPinsVisible?: boolean;
  zoomOutRequestNonce?: number;
  boundaryMode?: BoundaryMode;
  selectedZips?: string[];
  pinnedZips?: string[];
  hoveredZip?: string | null;
  activeOrganizationId?: string | null;
  categoryFilter?: string | null;
  selectedStatId?: string | null;
  secondaryStatId?: string | null;
  onHover?: (idOrIds: string | string[] | null) => void;
  onVisibleIdsChange?: (ids: string[], totalInSource: number, allSourceIds: string[]) => void;
  onZipSelectionChange?: (selectedZips: string[], meta?: { pinned: string[]; transient: string[] }) => void;
  onZipHoverChange?: (zip: string | null) => void;
  onStatSelectionChange?: (statId: string | null) => void;
  onCategorySelectionChange?: (categoryId: string | null) => void;
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
  zoomOutRequestNonce,
  boundaryMode = "zips",
  selectedZips = [],
  pinnedZips = [],
  hoveredZip = null,
  activeOrganizationId = null,
  categoryFilter = null,
  selectedStatId = null,
  secondaryStatId = null,
  onHover,
  onVisibleIdsChange,
  onZipSelectionChange,
  onZipHoverChange,
  onStatSelectionChange,
  onCategorySelectionChange,
}: MapLibreMapProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapControllerRef = useRef<MapViewController | null>(null);
  const isInternalUpdateRef = useRef(false);

  // Use refs for callbacks so we can update them in the wrapper
  const onZipSelectionChangeRef = useRef(onZipSelectionChange);
  useEffect(() => {
    onZipSelectionChangeRef.current = onZipSelectionChange;
  }, [onZipSelectionChange]);

  // Initialize map once on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const mapController = createMapView({
      onHover: onHover || (() => {}),
      onVisibleIdsChange,
      onZipSelectionChange: (zips, meta) => {
        // Mark that this is coming from the map, not from React
        isInternalUpdateRef.current = true;
        onZipSelectionChangeRef.current?.(zips, meta);
        // Reset after state updates complete
        setTimeout(() => {
          isInternalUpdateRef.current = false;
        }, 0);
      },
      onZipHoverChange,
      onStatSelectionChange,
      onCategorySelectionChange,
    });

    containerRef.current.appendChild(mapController.element);
    mapControllerRef.current = mapController;
    

    return () => {
      mapController.destroy();
      mapControllerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Handle zoom out all trigger
  useEffect(() => {
    if (mapControllerRef.current && typeof zoomOutRequestNonce === "number") {
      mapControllerRef.current.fitAllOrganizations();
    }
  }, [zoomOutRequestNonce]);

  // Update boundary mode
  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setBoundaryMode(boundaryMode);
    }
  }, [boundaryMode]);

  // Update pinned zips
  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setPinnedZips(pinnedZips);
    }
  }, [pinnedZips]);

  // Update hovered zip
  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setHoveredZip(hoveredZip);
    }
  }, [hoveredZip]);

  // Update active organization
  useEffect(() => {
    if (mapControllerRef.current) {
      mapControllerRef.current.setActiveOrganization(activeOrganizationId);
    }
  }, [activeOrganizationId]);

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

  // Update secondary stat
  useEffect(() => {
    if (mapControllerRef.current && mapControllerRef.current.setSecondaryStat) {
      mapControllerRef.current.setSecondaryStat(secondaryStatId);
    }
  }, [secondaryStatId]);

  // Handle selected zips changes from external sources (like toolbar add button)
  // Track what we last sent to prevent circular updates from map callbacks
  const lastSentZipsRef = useRef<string>("");

  useEffect(() => {
    if (!mapControllerRef.current || isInternalUpdateRef.current) return;

    // Create a stable string representation to check if zips actually changed
    const pinnedKey = [...pinnedZips].sort().join(",");
    const selectedKey = [...selectedZips].sort().join(",");
    const currentKey = `${selectedKey}|${pinnedKey}`;

    // Only update if the zips actually changed from what we last sent
    if (currentKey !== lastSentZipsRef.current) {
      lastSentZipsRef.current = currentKey;

      // Calculate transient zips (selected but not pinned)
      const transientZips = selectedZips.filter((z) => !pinnedZips.includes(z));

      // Clear and re-add transient selection
      mapControllerRef.current.clearTransientSelection();
      if (transientZips.length > 0) {
        mapControllerRef.current.addTransientZips(transientZips);
      }
    }
  }, [selectedZips, pinnedZips]);

  return (
    <div
      ref={containerRef}
      className="relative flex flex-1"
      style={{ minHeight: 0, minWidth: 0 }}
    />
  );
};
