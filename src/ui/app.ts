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
import { statDataStore } from "../state/statData";
import { statSeriesStore } from "../state/statSeries";
import { statsStore } from "../state/stats";
import type { Stat } from "../types/stat";

export interface AppInstance {
  destroy: () => void;
}

export const createApp = (root: HTMLElement): AppInstance => {
  root.innerHTML = "";
  // Fix overall scrolling: lock the app to the viewport height so the
  // page itself never scrolls. Only the sidebar list should scroll, and
  // the map should fill from the bottom of the boundary toolbar to the
  // bottom of the window.
  root.className =
    "flex h-screen flex-col overflow-hidden bg-slate-50 dark:bg-slate-950";

  const topBar = createTopBar();
  const defaultBoundary: BoundaryMode = "zips";
  const CITY_LABEL = "TULSA";

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
  let currentBoundaryMode: BoundaryMode = defaultBoundary;
  let currentSelectedStatId: string | null = null;
  let currentSelectedCategoryId: string | null = null;
  let statDataByStatId: Map<string, { type: string; data: Record<string, number> }> = new Map();
  let statSeriesByStatId: Map<string, { date: string; type: string; data: Record<string, number> }[]> = new Map();
  let statsById: Map<string, Stat> = new Map();

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

  // Get stats for overall city (e.g. Tulsa in demographics bar)
  const getAreasForCurrentBoundary = (): Area[] => {
    if (areasByKey.size === 0) return [];
    const allAreas = Array.from(areasByKey.values());
    if (currentBoundaryMode === "zips") {
      return allAreas.filter((area) => area.type === "ZIP");
    }

    const areasByType = new Map<string, Area[]>();
    for (const area of allAreas) {
      const bucket = areasByType.get(area.type);
      if (bucket) bucket.push(area);
      else areasByType.set(area.type, [area]);
    }

    if (areasByType.has("ZIP")) return areasByType.get("ZIP") ?? [];
    const first = areasByType.values().next();
    return first.done ? [] : first.value;
  };

  const computeCityDemographics = () => {
    const areas = getAreasForCurrentBoundary();
    if (areas.length === 0) return null;

    let totalPop = 0;
    let weightedAge = 0;
    let weightedMarried = 0;

    for (const area of areas) {
      const p = Math.max(0, Math.round(area.population));
      totalPop += p;
      weightedAge += area.avgAge * p;
      weightedMarried += area.marriedPercent * p;
    }

    const avgAge = totalPop > 0 ? weightedAge / totalPop : undefined;
    const marriedPercent = totalPop > 0 ? weightedMarried / totalPop : undefined;

    return {
      selectedCount: areas.length,
      label: CITY_LABEL,
      population: totalPop,
      avgAge,
      marriedPercent,
    };
  };

  const recalcDemographics = () => {
    if (!sidebar) return;
    const keys = Array.from(selectedZips);
    if (keys.length === 0) {
      const cityStats = computeCityDemographics();
      sidebar.setDemographics(cityStats);
      return;
    }
    const label = keys.length === 1 ? keys[0] : `SELECTED(${keys.length})`;
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
      sidebar.setDemographics({ selectedCount: keys.length, label });
      return;
    }
    const avgAge = totalPop > 0 ? weightedAge / totalPop : undefined;
    const marriedPercent = totalPop > 0 ? weightedMarried / totalPop : undefined;
    sidebar.setDemographics({ selectedCount: keys.length, label, population: totalPop, avgAge, marriedPercent });
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
      // Update sidebar stat viz selection
      sidebar?.setSelectedZips(Array.from(selectedZips));
    },
    onZipHoverChange: (zip) => {
      // Mirror map hover to chips and chart
      boundaryToolbar.setHoveredZip(zip);
      sidebar?.setHoveredZip(zip);
    },
    onStatSelectionChange: (statId) => {
      currentSelectedStatId = statId;
      sidebar?.setSelectedStatId(currentSelectedStatId);
    },
    onCategorySelectionChange: (categoryId) => {
      currentSelectedCategoryId = categoryId;
    },
  });
  sidebar = createSidebar({
    onHover: (id) => handleHover(id),
    onZoomOutAll: () => mapView.fitAllOrganizations(),
    onCategoryClick: (categoryId) => mapView.setCategoryFilter(categoryId),
    onHoverZip: (zip) => mapView.setHoveredZip(zip),
  });

  const boundaryToolbar = createBoundaryToolbar({
    defaultValue: defaultBoundary,
    onChange: (mode) => {
      currentBoundaryMode = mode;
      mapView.setBoundaryMode(mode);
      recalcDemographics();
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
    onClearSelection: () => {
      mapView.clearTransientSelection();
    },
    onExport: () => {
      // Build and download CSV of selected/pinned areas + demographics + selected stat (if any)
      const zips = Array.from(selectedZips).sort();
      if (zips.length === 0) return;

      const headers: string[] = ["zip", "population", "avg_age", "married_percent"]; // base

      // Determine stat columns: if a category is selected, include all stats in that category; else include only selected stat (if any)
      const selectedCategory = currentSelectedCategoryId;
      const allStats = Array.from(statsById.values());
      const statColumns: { id: string; header: string }[] = [];
      if (selectedCategory) {
        const inCategory = allStats.filter((s) => s.category === selectedCategory);
        for (const s of inCategory) {
          const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
          statColumns.push({ id: s.id, header: slug || `stat_${s.id.slice(0,6)}` });
        }
      } else if (currentSelectedStatId) {
        const s = statsById.get(currentSelectedStatId);
        if (s) {
          const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
          statColumns.push({ id: s.id, header: slug || `stat_${s.id.slice(0,6)}` });
        }
      }
      for (const c of statColumns) headers.push(c.header);

      // Include active org count column if a category is selected
      let orgCountHeader: string | null = null;
      const activeOrgsByZip = new Map<string, number>();
      if (selectedCategory) {
        orgCountHeader = `number_of_${selectedCategory}_orgs_active`;
        headers.splice(4, 0, orgCountHeader); // place after married_percent

        // Count organizations by zip for the selected category, limited by current sourceIds
        const idsFilter = sourceIds; // current map source subset
        const fromSource = organizations.filter((o) => !idsFilter || idsFilter.has(o.id));
        const catOrgs = fromSource.filter((o) => o.category === selectedCategory);
        for (const org of catOrgs) {
          const zip = organizationZips.get(org.id);
          if (!zip) continue;
          activeOrgsByZip.set(zip, (activeOrgsByZip.get(zip) || 0) + 1);
        }
      }

      const rows: (string | number)[][] = [];
      const r1 = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);

      let totalPop = 0;
      let weightedAge = 0;
      let weightedMarried = 0;
      const statSums = new Map<string, number>();
      const statCounts = new Map<string, number>();

      for (const zip of zips) {
        const area = areasByKey.get(zip);
        if (!area) continue;
        const pop = Math.max(0, Math.round(area.population));
        const age = area.avgAge;
        const married = area.marriedPercent;

        totalPop += pop;
        weightedAge += age * pop;
        weightedMarried += married * pop;

        const base: (string | number)[] = [zip, pop, r1(age), r1(married)];
        if (orgCountHeader) base.splice(4, 0, activeOrgsByZip.get(zip) || 0);
        const row: (string | number)[] = base;

        for (const col of statColumns) {
          const sd = statDataByStatId.get(col.id);
          const v = sd?.data?.[zip];
          if (typeof v === "number") {
            row.push(r1(v));
            statSums.set(col.id, (statSums.get(col.id) || 0) + v);
            statCounts.set(col.id, (statCounts.get(col.id) || 0) + 1);
          } else {
            row.push("");
          }
        }

        rows.push(row);
      }

      // Summary row: totals/weighted averages for demographics
      const avgAge = totalPop > 0 ? weightedAge / totalPop : 0;
      const avgMarried = totalPop > 0 ? weightedMarried / totalPop : 0;
      const summaryBase: (string | number)[] = ["ALL_AREAS", totalPop, r1(avgAge), r1(avgMarried)];
      if (orgCountHeader) summaryBase.splice(4, 0, zips.reduce((acc, z) => acc + (activeOrgsByZip.get(z) || 0), 0));
      const summary: (string | number)[] = summaryBase;
      for (const col of statColumns) {
        const c = statCounts.get(col.id) || 0;
        if (c > 0) summary.push(r1((statSums.get(col.id) || 0) / c));
        else summary.push("");
      }

      // City row: totals/averages across entire city (all ZIPs we have areas for)
      const allCityZips = Array.from(areasByKey.keys()).sort();
      let cityPop = 0;
      let cityWeightedAge = 0;
      let cityWeightedMarried = 0;
      const cityStatSums = new Map<string, number>();
      const cityStatCounts = new Map<string, number>();
      let cityOrgCount = 0;
      if (orgCountHeader) {
        // total orgs active in category across all zips
        cityOrgCount = Array.from(activeOrgsByZip.values()).reduce((a, b) => a + b, 0);
      }
      for (const zip of allCityZips) {
        const a = areasByKey.get(zip);
        if (!a) continue;
        const p = Math.max(0, Math.round(a.population));
        cityPop += p;
        cityWeightedAge += a.avgAge * p;
        cityWeightedMarried += a.marriedPercent * p;
        for (const col of statColumns) {
          const sd = statDataByStatId.get(col.id);
          const v = sd?.data?.[zip];
          if (typeof v === "number") {
            cityStatSums.set(col.id, (cityStatSums.get(col.id) || 0) + v);
            cityStatCounts.set(col.id, (cityStatCounts.get(col.id) || 0) + 1);
          }
        }
      }
      const cityAvgAge = cityPop > 0 ? cityWeightedAge / cityPop : 0;
      const cityAvgMarried = cityPop > 0 ? cityWeightedMarried / cityPop : 0;
      const cityBase: (string | number)[] = ["CITY_TULSA", cityPop, r1(cityAvgAge), r1(cityAvgMarried)];
      if (orgCountHeader) cityBase.splice(4, 0, cityOrgCount);
      const cityRow: (string | number)[] = cityBase;
      for (const col of statColumns) {
        const c = cityStatCounts.get(col.id) || 0;
        if (c > 0) cityRow.push(r1((cityStatSums.get(col.id) || 0) / c));
        else cityRow.push("");
      }

      // Assemble CSV text
      const lines: string[] = [];
      lines.push(headers.join(","));
      for (const row of rows) {
        lines.push(row.join(","));
      }
      lines.push(summary.join(","));
      lines.push(cityRow.join(","));

      const csv = lines.join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const now = new Date();
      const ts = now.toISOString().replace(/[:T]/g, "-").slice(0, 19);
      const statSuffix = selectedCategory ? `_${selectedCategory}` : (currentSelectedStatId ? `_${(statsById.get(currentSelectedStatId)?.name || "stat").replace(/\s+/g, "_")}` : "");
      a.download = `areas_export${statSuffix}_${ts}.csv`;
      a.href = url;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
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

  // Subscribe to stats and stat data for export/meta
  const unsubscribeStats = statsStore.subscribe((rows) => {
    const map = new Map<string, Stat>();
    for (const s of rows) map.set(s.id, s);
    statsById = map;
    sidebar?.setStatsMeta(statsById);
  });
  const unsubscribeStatData = statDataStore.subscribe((byId) => {
    const map = new Map<string, { type: string; data: Record<string, number> }>();
    for (const [id, entry] of byId) {
      map.set(id, { type: (entry as any).type, data: (entry as any).data || {} });
    }
    statDataByStatId = map;
  });

  const unsubscribeStatSeries = statSeriesStore.subscribe((byId) => {
    statSeriesByStatId = byId as any;
    sidebar?.setStatSeries(statSeriesByStatId);
  });

  root.appendChild(topBar.element);
  root.appendChild(boundaryToolbar.element);
  root.appendChild(layout);

  return {
    destroy: () => {
      unsubscribe();
      unsubscribeAreas();
      unsubscribeStats();
      unsubscribeStatData();
      unsubscribeStatSeries();
      topBar.destroy();
      boundaryToolbar.destroy();
      mapView.destroy();
      root.innerHTML = "";
    },
  };
};
