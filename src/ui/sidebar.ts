import type { Organization } from "../types/organization";
import { createDemographicsBar, type DemographicStats } from "./components/demographicsBar";
import { getCategoryLabel } from "../types/categories";
import { createStatViz, type StatVizController } from "./components/statViz";

interface SidebarOptions {
  onHover: (idOrIds: string | string[] | null) => void;
  onZoomOutAll: () => void;
  onCategoryClick?: (categoryId: string) => void;
  onHoverZip?: (zip: string | null) => void;
}

export interface SidebarController {
  element: HTMLElement;
  setOrganizations: (groups: { inSelection: Organization[]; all: Organization[]; totalSourceCount?: number }) => void;
  setActiveOrganization: (id: string | null) => void;
  setHighlightedOrganizations: (ids: string[] | null) => void;
  setDemographics: (stats: DemographicStats | null) => void;
  // Stat viz hooks
  setStatsMeta: (statsById: Map<string, { id: string; name: string; category: string }>) => void;
  setStatSeries: (
    byStatId: Map<
      string,
      { date: string; type: string; data: Record<string, number> }[]
    >,
  ) => void;
  setSelectedZips: (zips: string[]) => void;
  setSelectedStatId: (statId: string | null) => void;
  setHoveredZip: (zip: string | null) => void;
}

const createListItem = (
  org: Organization,
  onHover: SidebarOptions["onHover"],
  onCategoryClick?: SidebarOptions["onCategoryClick"],
): HTMLLIElement => {
  const item = document.createElement("li");
  item.dataset.orgId = org.id;
  item.className =
    "group relative rounded-xl border border-transparent px-4 py-3 transition duration-200 ease-out bg-slate-100/40 hover:border-brand-200 hover:bg-brand-50 dark:bg-slate-800/20 dark:hover:border-slate-700 dark:hover:bg-slate-800/70";

  const name = document.createElement("p");
  name.className = "text-sm font-medium text-slate-600 dark:text-slate-300";
  name.textContent = org.name;

  const link = document.createElement("a");
  link.href = org.url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.className =
    "mt-1 inline-flex items-center gap-1 text-xs font-medium text-slate-400 transition-colors hover:text-brand-900 dark:text-slate-300 dark:hover:text-slate-100";
  link.innerHTML = `Visit site
    <span aria-hidden="true" class="text-[1em] leading-none">↗</span>
  `;

  item.appendChild(name);
  item.appendChild(link);

  // Category badge just to the right of the link
  const categoryBadge = document.createElement("span");
  categoryBadge.className =
    "mt-1 ml-2 inline-flex items-center rounded-full bg-slate-50 px-2 py-[2px] text-[10px] font-medium text-slate-600 dark:bg-slate-800/70 dark:text-slate-300 cursor-pointer";
  categoryBadge.textContent = getCategoryLabel(org.category);
  categoryBadge.setAttribute("role", "button");
  categoryBadge.tabIndex = 0;
  const handleBadgeClick = () => {
    const cat = (org as any).category as string | undefined;
    if (cat) {
      onCategoryClick?.(cat);
    }
  };
  categoryBadge.addEventListener("click", handleBadgeClick);
  categoryBadge.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleBadgeClick();
    }
  });
  item.appendChild(categoryBadge);

  const handleEnter = () => onHover(org.id);
  const handleLeave = () => onHover(null);

  item.addEventListener("mouseenter", handleEnter);
  item.addEventListener("focusin", handleEnter);
  item.addEventListener("mouseleave", handleLeave);
  item.addEventListener("focusout", handleLeave);

  return item;
};

// Helper to create the zoom out link as a list item
const createZoomOutListItem = (onZoomOutAll: () => void): HTMLLIElement => {
  const li = document.createElement("li");
  li.className = "px-0 pt-0 pb-0"; // Remove extra padding, let button handle it

  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "block w-full text-left text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 px-4 pb-4 pt-2";
  button.addEventListener("click", () => onZoomOutAll());

  li.appendChild(button);
  return li;
};

export const createSidebar = ({ onHover, onZoomOutAll, onCategoryClick, onHoverZip }: SidebarOptions): SidebarController => {
  const container = document.createElement("aside");
  container.className =
    "relative flex w-full max-w-sm flex-col border-r border-slate-200 bg-white/60 backdrop-blur dark:border-slate-800 dark:bg-slate-900/60";

  // Demographics summary bar
  const demographics = createDemographicsBar();
  const statViz: StatVizController = createStatViz({ onHoverZip: (zip) => onHoverZip?.(zip) });

  const header = document.createElement("div");
  header.className = "flex items-center justify-between px-6 pt-4 pb-0";

  const title = document.createElement("h2");
  title.className = "text-sm font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-400 pl-2 pt-2";
  title.textContent = "Organizations";

  const totalLabel = document.createElement("span");
  totalLabel.className = "text-xs font-medium text-slate-400 dark:text-slate-500";
  totalLabel.textContent = "0";

  header.appendChild(title);
  header.appendChild(totalLabel);

  // Content wrapper (scroll area)
  const scroll = document.createElement("div");
  scroll.className = "flex-1 overflow-y-auto";

  // Section: IN SELECTION
  const inSelHeader = document.createElement("h3");
  inSelHeader.className = "px-8 pt-3 pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";
  inSelHeader.textContent = "IN SELECTION";
  const listInSelection = document.createElement("ul");
  listInSelection.className = "space-y-2 px-4";

  // Section: ALL
  const allHeader = document.createElement("h3");
  allHeader.className = "px-8 pt-4 pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";
  allHeader.textContent = "ALL";
  const listAll = document.createElement("ul");
  listAll.className = "space-y-2 px-4 pb-6";

  const emptyState = document.createElement("p");
  emptyState.className = "px-4 pt-3 pb-6 text-sm text-slate-500 dark:text-slate-400";
  emptyState.textContent = "No organizations found. Add one to get started.";

  let activeId: string | null = null;
  let highlightedIds: Set<string> = new Set();
  let totalCount: number = 0;

  // Create the zoom out list item (li > button)
  const zoomOutListItem = createZoomOutListItem(onZoomOutAll);
  const zoomOutButton = zoomOutListItem.querySelector("button")!;

  // Registry of DOM nodes by org id so we can move items across sections
  const nodeRegistry = new Map<string, HTMLLIElement>();

  const updateActiveState = () => {
    const items = container.querySelectorAll<HTMLLIElement>("ul li");
    items.forEach((item) => {
      // Don't apply active state to the zoom out link
      if (item === zoomOutListItem) return;
      const id = item.dataset.orgId || "";
      const isActive = id === activeId || highlightedIds.has(id);
      item.classList.toggle("border-brand-300", isActive);
      item.classList.toggle("ring-2", isActive);
      item.classList.toggle("ring-brand-200/80", isActive);
      item.classList.toggle("bg-brand-50/70", isActive);
      item.classList.toggle("dark:bg-slate-800", isActive);
    });
  };

  const resetInlineLayout = (el: HTMLLIElement) => {
    el.style.height = "";
    el.style.marginTop = "";
    el.style.marginBottom = "";
    el.style.paddingTop = "";
    el.style.paddingBottom = "";
    el.style.transition = "";
  };

  const ensureVisible = (el: HTMLLIElement) => {
    el.classList.remove("opacity-0", "translate-y-1");
    resetInlineLayout(el);
  };

  const collapseAndRemove = (el: HTMLLIElement) => {
    // Guard: if already detached, skip
    if (!el.isConnected) return;
    const prevTransition = el.style.transition;
    const h = el.offsetHeight;
    el.style.height = `${h}px`;
    // Force layout
    void el.offsetHeight;
    el.style.transition = "height 120ms ease, opacity 120ms linear, transform 120ms ease, margin 120ms ease, padding 120ms ease";
    el.classList.add("opacity-0", "translate-y-1");
    el.style.height = "0px";
    el.style.marginTop = "0px";
    el.style.marginBottom = "0px";
    el.style.paddingTop = "0px";
    el.style.paddingBottom = "0px";
    const onEnd = () => {
      const id = el.dataset.orgId;
      el.remove();
      if (id) nodeRegistry.delete(id);
      el.style.transition = prevTransition;
    };
    const to = window.setTimeout(onEnd, 200);
    el.addEventListener("transitionend", () => {
      window.clearTimeout(to);
      onEnd();
    }, { once: true });
  };

  const diffAndRenderList = (listEl: HTMLUListElement, organizations: Organization[], globalDesiredIds: Set<string>) => {
    const desiredIds = new Set(organizations.map((o) => o.id));

    // Remove/move existing children based on desired sets
    Array.from(listEl.querySelectorAll<HTMLLIElement>("li")).forEach((li) => {
      if (li === zoomOutListItem) return;
      const id = li.dataset.orgId;
      if (!id) return;
      if (!desiredIds.has(id)) {
        if (globalDesiredIds.has(id)) {
          // Will be re-parented by the other section; remove synchronously
          li.remove();
        } else {
          // Truly leaving the sidebar; collapse with animation
          collapseAndRemove(li);
        }
      }
    });

    // Build ordered fragment and append/move nodes
    const frag = document.createDocumentFragment();
    for (const org of organizations) {
      let li = nodeRegistry.get(org.id);
      if (!li) {
        li = createListItem(org, onHover, onCategoryClick);
        nodeRegistry.set(org.id, li);
        // New node: start hidden, animate in
        li.classList.add("opacity-0", "translate-y-1");
        requestAnimationFrame(() => ensureVisible(li!));
      } else {
        // Reused node: if it was previously removed from DOM, treat as entering
        const reappearing = !li.isConnected;
        if (reappearing) {
          resetInlineLayout(li);
          li.classList.add("opacity-0", "translate-y-1");
          requestAnimationFrame(() => ensureVisible(li!));
        } else {
          ensureVisible(li);
        }
      }
      frag.appendChild(li);
    }

    // Remove zoom out link if present in this list before re-adding elsewhere
    if (zoomOutListItem.parentElement === listEl) {
      listEl.removeChild(zoomOutListItem);
    }

    listEl.appendChild(frag);
  };

  const setOrganizations = (groups: { inSelection: Organization[]; all: Organization[]; totalSourceCount?: number }) => {
    const inSel = groups.inSelection ?? [];
    const all = groups.all ?? [];
    totalCount = typeof groups.totalSourceCount === "number" ? groups.totalSourceCount : (inSel.length + all.length);

    // Update counts
    const visibleCount = inSel.length + all.length;
    totalLabel.textContent = `${visibleCount}`;

    // Section visibility
    inSelHeader.style.display = inSel.length > 0 ? "" : "none";
    listInSelection.style.display = inSel.length > 0 ? "" : "none";

    // Render lists with global desired id set for move vs remove decisions
    const globalDesired = new Set([...inSel, ...all].map((o) => o.id));
    diffAndRenderList(listInSelection, inSel, globalDesired);
    diffAndRenderList(listAll, all, globalDesired);

    // Zoom-out button goes at the end of ALL list
    const missing = Math.max(totalCount - visibleCount, 0);
    if (missing > 0) {
      zoomOutButton.textContent = `${missing} more not visible (Zoom out)`;
      // Add slight brand color to the zoom-out link
      zoomOutButton.classList.add(
        "text-brand-300",
        "hover:text-brand-800", 
        "transition-colors",
        "font-normal"
      );
      listAll.appendChild(zoomOutListItem);
      zoomOutListItem.hidden = false;
    } else {
      zoomOutListItem.hidden = true;
    }

    // Empty state visibility
    const isEmpty = visibleCount === 0;
    emptyState.hidden = !isEmpty || missing > 0;
    if (isEmpty && missing === 0) {
      activeId = null;
    }

    updateActiveState();
  };

  const setActiveOrganization = (id: string | null) => {
    activeId = id;
    updateActiveState();
  };

  const setHighlightedOrganizations = (ids: string[] | null) => {
    highlightedIds = new Set(ids ?? []);
    updateActiveState();
  };

  const content = document.createElement("div");
  content.className = "flex flex-1 flex-col overflow-hidden";
  // Empty state and lists live in the scroll area
  scroll.appendChild(emptyState);
  scroll.appendChild(inSelHeader);
  scroll.appendChild(listInSelection);
  scroll.appendChild(allHeader);
  scroll.appendChild(listAll);
  content.appendChild(scroll);

  container.appendChild(demographics.element);
  // Visualization lives just below demographics bar, above Organizations
  container.appendChild(statViz.element);
  container.appendChild(header);
  container.appendChild(content);

  return {
    element: container,
    setOrganizations,
    setActiveOrganization,
    setHighlightedOrganizations,
    setDemographics: (stats) => demographics.setStats(stats),
    setStatsMeta: (byId) => statViz.setStatsMeta(byId as any),
    setStatSeries: (byId) => statViz.setSeries(byId as any),
    setSelectedZips: (zips) => statViz.setSelectedZips(zips),
    setSelectedStatId: (id) => statViz.setSelectedStatId(id),
    setHoveredZip: (zip) => statViz.setHoveredZip(zip),
  };
};
