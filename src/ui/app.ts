import { organizationStore } from "../state/organizations";
import type { Organization } from "../types/organization";
import { createMapView } from "./mapView";
import { createSidebar } from "./sidebar";
import type { SidebarController } from "./sidebar";
import { createTopBar } from "./topbar";
import { createBoundaryToolbar } from "./boundaryToolbar";
import type { BoundaryMode } from "../types/boundaries";
import { findZipForLocation } from "../lib/zipBoundaries";
import type { Area } from "../types/area";
import { areasStore } from "../state/areas";

export interface AppInstance {
  destroy: () => void;
}

export const createApp = (root: HTMLElement): AppInstance => {
  root.innerHTML = "";
  root.className =
    "flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950";

  const topBar = createTopBar();
  const defaultBoundary: BoundaryMode = "zips";

  const layout = document.createElement("main");
  layout.className =
    "flex flex-1 overflow-hidden border-t border-transparent dark:border-slate-800";

  let activeId: string | null = null;
  let highlightedIds: Set<string> = new Set();
  let organizations: Organization[] = [];
  let visibleIds: Set<string> | null = null;
  let sourceIds: Set<string> | null = null;
  let selectedZips: Set<string> = new Set(); // union of pinned + transient from map
  let pinnedZips: Set<string> = new Set();
  let organizationZips: Map<string, string | null> = new Map();
  let areasByKey: Map<string, Area> = new Map();

  let sidebar: SidebarController | null = null;

  const computeSourceOrganizations = () => {
    const sourceFilter = sourceIds;
    return organizations.filter((org) => !sourceFilter || sourceFilter.has(org.id));
  };

  const getVisibleOrganizations = (): Organization[] => {
    const fromSource = computeSourceOrganizations();
    if (!visibleIds) return fromSource;
    const visibleFilter = visibleIds;
    return fromSource.filter((org) => visibleFilter.has(org.id));
  };

  let sidebarUpdateScheduled = false;
  const updateSidebar = () => {
    if (sidebarUpdateScheduled) return;
    sidebarUpdateScheduled = true;
    requestAnimationFrame(() => {
      sidebarUpdateScheduled = false;
      if (!sidebar) return;
      const visible = getVisibleOrganizations();
      let inSelection: Organization[] = [];
      if (selectedZips.size > 0) {
        inSelection = visible.filter((org) => {
          const zip = organizationZips.get(org.id);
          return !!zip && selectedZips.has(zip);
        });
      }
      const inSelectionIds = new Set(inSelection.map((o) => o.id));
      const rest = visible.filter((org) => !inSelectionIds.has(org.id));
      const totalSourceCount = sourceIds ? sourceIds.size : computeSourceOrganizations().length;
      sidebar.setOrganizations({ inSelection, all: rest, totalSourceCount });
    });
  };

  const recalcDemographics = () => {
    if (!sidebar) return;
    const keys = Array.from(selectedZips);
    if (keys.length === 0) {
      sidebar.setDemographics(null);
      return;
    }
    let totalPop = 0;
    let weightedAge = 0;
    let weightedMarried = 0;
    let any = false;
    for (const k of keys) {
      const a = areasByKey.get(k);
      if (!a) continue;
      any = true;
      const p = Math.max(0, Math.round(a.population));
      totalPop += p;
      weightedAge += a.avgAge * p;
      weightedMarried += a.marriedPercent * p;
    }
    if (!any) {
      sidebar.setDemographics({ selectedCount: 0 });
      return;
    }
    const avgAge = totalPop > 0 ? weightedAge / totalPop : undefined;
    const marriedPercent = totalPop > 0 ? weightedMarried / totalPop : undefined;
    sidebar.setDemographics({ selectedCount: keys.length, population: totalPop, avgAge, marriedPercent });
  };

  const recomputeOrganizationZips = (orgs: Organization[]) => {
    const next = new Map<string, string | null>();
    for (const org of orgs) {
      next.set(org.id, findZipForLocation(org.longitude, org.latitude));
    }
    organizationZips = next;
  };

  const handleHover = (idOrIds: string | string[] | null) => {
    // Cluster hover -> highlight many list items; do not change map point highlight
    if (Array.isArray(idOrIds)) {
      highlightedIds = new Set(idOrIds);
      sidebar?.setHighlightedOrganizations(idOrIds);
      return;
    }

    // Single id or null
    const id = idOrIds;
    if (activeId === id && highlightedIds.size === 0) {
      return;
    }

    highlightedIds.clear();
    sidebar?.setHighlightedOrganizations(null);
    activeId = id;
    sidebar?.setActiveOrganization(activeId);
    mapView.setActiveOrganization(activeId);
  };

  const mapView = createMapView({
    onHover: (id) => handleHover(id),
    onVisibleIdsChange: (ids, _totalInSource, allSourceIds) => {
      visibleIds = new Set(ids);
      sourceIds = new Set(allSourceIds);
      updateSidebar();
    },
    onZipSelectionChange: (zips, meta) => {
      selectedZips = new Set(zips);
      // If meta.pinned provided, keep app state in sync
      if (meta?.pinned) pinnedZips = new Set(meta.pinned);
      updateSidebar();
      recalcDemographics();
      // Reflect selected chips in toolbar
      boundaryToolbar.setSelectedZips(Array.from(selectedZips), Array.from(pinnedZips));
    },
    onZipHoverChange: (zip) => {
      boundaryToolbar.setHoveredZip(zip);
    },
  });
  sidebar = createSidebar({
    onHover: (id) => handleHover(id),
    onZoomOutAll: () => mapView.fitAllOrganizations(),
    onCategoryClick: (categoryId) => mapView.setCategoryFilter(categoryId),
  });

  const boundaryToolbar = createBoundaryToolbar({
    defaultValue: defaultBoundary,
    onChange: (mode) => {
      mapView.setBoundaryMode(mode);
    },
    onToggleZipPin: (zip, nextPinned) => {
      const next = new Set(pinnedZips);
      if (nextPinned) next.add(zip);
      else next.delete(zip);
      pinnedZips = next;
      mapView.setPinnedZips(Array.from(pinnedZips));
      boundaryToolbar.setSelectedZips(Array.from(selectedZips), Array.from(pinnedZips));
    },
    onHoverZip: (zip) => {
      mapView.setHoveredZip(zip);
    },
  });

  mapView.setBoundaryMode(defaultBoundary);

  if (!sidebar) {
    throw new Error("Sidebar failed to initialize");
  }

  layout.appendChild(sidebar.element);
  layout.appendChild(mapView.element);

  const unsubscribe = organizationStore.subscribe((next) => {
    organizations = next;
    recomputeOrganizationZips(organizations);
    mapView.setOrganizations(organizations);
    updateSidebar();

    if (activeId && !organizations.some((org) => org.id === activeId)) {
      activeId = null;
      sidebar?.setActiveOrganization(null);
      mapView.setActiveOrganization(null);
    }
  });

  const unsubscribeAreas = areasStore.subscribe((rows) => {
    const map = new Map<string, Area>();
    for (const a of rows) map.set(a.key, a);
    areasByKey = map;
    recalcDemographics();
  });

  root.appendChild(topBar.element);
  root.appendChild(boundaryToolbar.element);
  root.appendChild(layout);

  return {
    destroy: () => {
      unsubscribe();
      unsubscribeAreas();
      topBar.destroy();
      boundaryToolbar.destroy();
      mapView.destroy();
      root.innerHTML = "";
    },
  };
};
