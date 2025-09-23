import { organizationStore } from "../state/organizations";
import type { Organization } from "../types/organization";
import { createMapView } from "./mapView";
import { createSidebar } from "./sidebar";
import { createTopBar } from "./topbar";

export interface AppInstance {
  destroy: () => void;
}

export const createApp = (root: HTMLElement): AppInstance => {
  root.innerHTML = "";
  root.className =
    "flex min-h-screen flex-col bg-slate-50 dark:bg-slate-950";

  const topBar = createTopBar();

  const layout = document.createElement("main");
  layout.className =
    "flex flex-1 overflow-hidden border-t border-transparent dark:border-slate-800";

  let activeId: string | null = null;
  let highlightedIds: Set<string> = new Set();
  let organizations: Organization[] = [];
  let visibleIds: Set<string> | null = null;

  const getVisibleOrganizations = (): Organization[] => {
    if (!visibleIds) return organizations;
    return organizations.filter((o) => visibleIds!.has(o.id));
  };

  const handleHover = (idOrIds: string | string[] | null) => {
    // Cluster hover -> highlight many list items; do not change map point highlight
    if (Array.isArray(idOrIds)) {
      highlightedIds = new Set(idOrIds);
      sidebar.setHighlightedOrganizations(idOrIds);
      return;
    }

    // Single id or null
    const id = idOrIds;
    if (activeId === id && highlightedIds.size === 0) {
      return;
    }

    highlightedIds.clear();
    sidebar.setHighlightedOrganizations(null);
    activeId = id;
    sidebar.setActiveOrganization(activeId);
    mapView.setActiveOrganization(activeId);
  };

  const mapView = createMapView({
    onHover: (id) => handleHover(id),
    onVisibleIdsChange: (ids, totalInSource) => {
      visibleIds = new Set(ids);
      sidebar.setOrganizations(getVisibleOrganizations(), totalInSource);
    },
  });
  const sidebar = createSidebar({
    onHover: (id) => handleHover(id),
    onZoomOutAll: () => mapView.fitAllOrganizations(),
    onCategoryClick: (categoryId) => mapView.setCategoryFilter(categoryId),
  });

  layout.appendChild(sidebar.element);
  layout.appendChild(mapView.element);

  const unsubscribe = organizationStore.subscribe((next) => {
    organizations = next;
    mapView.setOrganizations(organizations);
    sidebar.setOrganizations(getVisibleOrganizations(), organizations.length);

    if (activeId && !organizations.some((org) => org.id === activeId)) {
      activeId = null;
      sidebar.setActiveOrganization(null);
      mapView.setActiveOrganization(null);
    }
  });

  root.appendChild(topBar.element);
  root.appendChild(layout);

  return {
    destroy: () => {
      unsubscribe();
      topBar.destroy();
      mapView.destroy();
      root.innerHTML = "";
    },
  };
};
