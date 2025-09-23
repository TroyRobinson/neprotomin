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
  let organizations: Organization[] = [];
  let visibleIds: Set<string> | null = null;

  const getVisibleOrganizations = (): Organization[] => {
    if (!visibleIds) return organizations;
    return organizations.filter((o) => visibleIds!.has(o.id));
  };

  const handleHover = (id: string | null) => {
    if (activeId === id) {
      return;
    }

    activeId = id;
    sidebar.setActiveOrganization(activeId);
    mapView.setActiveOrganization(activeId);
  };

  const mapView = createMapView({
    onHover: (id) => handleHover(id),
    onVisibleIdsChange: (ids) => {
      visibleIds = new Set(ids);
      sidebar.setOrganizations(getVisibleOrganizations(), organizations.length);
    },
  });
  const sidebar = createSidebar({
    onHover: (id) => handleHover(id),
    onZoomOutAll: () => mapView.fitAllOrganizations(),
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
