import { useState, lazy, Suspense, useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { BoundaryToolbar } from "./components/BoundaryToolbar";
import { MapLibreMap } from "./components/MapLibreMap";
import { Sidebar } from "./components/Sidebar";
import { useDemographics } from "./hooks/useDemographics";
import { useStats } from "./hooks/useStats";
import { useOrganizations } from "./hooks/useOrganizations";
import type { Organization } from "../types/organization";
import { findZipForLocation } from "../lib/zipBoundaries";
import { useMemo } from "react";
import type { BoundaryMode } from "../types/boundaries";
import { AuthModal } from "./components/AuthModal";
import { db } from "../lib/reactDb";
const ReportScreen = lazy(() => import("./components/ReportScreen").then((m) => ({ default: m.ReportScreen })));
const DataScreen = lazy(() => import("./components/DataScreen").then((m) => ({ default: m.default })));

export const ReactMapApp = () => {
  const [boundaryMode, setBoundaryMode] = useState<BoundaryMode>("zips");
  const [selectedZips, setSelectedZips] = useState<string[]>([]);
  const [pinnedZips, setPinnedZips] = useState<string[]>([]);
  const [hoveredZip, setHoveredZip] = useState<string | null>(null);
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(null);
  const [highlightedOrganizationIds, setHighlightedOrganizationIds] = useState<string[] | null>(null);
  const [selectedStatId, setSelectedStatId] = useState<string | null>(null);
  const [secondaryStatId, setSecondaryStatId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [activeScreen, setActiveScreen] = useState<"map" | "report" | "data">("map");
  const [authOpen, setAuthOpen] = useState(false);

  const { isLoading: isAuthLoading, user } = db.useAuth();
  useEffect(() => {
    if (isAuthLoading) return;
    if (!user) {
      db.auth.signInAsGuest().catch(() => {
        // ignore; may be offline or already attempted
      });
    }
  }, [isAuthLoading, user]);

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
            const sel = entry.selection as { zips?: string[]; pinned?: string[]; boundaryMode?: string | null };
            if (Array.isArray(sel.zips)) setSelectedZips(sel.zips);
            if (Array.isArray(sel.pinned)) setPinnedZips(sel.pinned);
            if (sel.boundaryMode === "neighborhoods") setBoundaryMode("zips");
            else if (sel.boundaryMode === "zips" || sel.boundaryMode === "counties" || sel.boundaryMode === "none") {
              setBoundaryMode(sel.boundaryMode as BoundaryMode);
            }
            return;
          }
        } catch {}
      }
      // Fallback to localStorage
      try {
        const raw = localStorage.getItem("uiState.selection");
        if (raw) {
          const sel = JSON.parse(raw);
          if (Array.isArray(sel.zips)) setSelectedZips(sel.zips);
          if (Array.isArray(sel.pinned)) setPinnedZips(sel.pinned);
          if (sel.boundaryMode === "neighborhoods") setBoundaryMode("zips");
          else if (sel.boundaryMode === "zips" || sel.boundaryMode === "counties" || sel.boundaryMode === "none") {
            setBoundaryMode(sel.boundaryMode as BoundaryMode);
          }
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
    const selection = { zips: selectedZips, pinned: pinnedZips, boundaryMode };
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
  }, [user?.id, selectedZips, pinnedZips, boundaryMode]);

  // Subscribe to demographics and stats stores
  const { demographics, breakdowns } = useDemographics(selectedZips);
  const { statsById, seriesByStatId } = useStats();
  const { organizations } = useOrganizations();
  // areasByKey removed; population/age/married now sourced from statData
  const orgZipById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const o of organizations) {
      const zip = findZipForLocation(o.longitude, o.latitude);
      map.set(o.id, zip);
    }
    return map;
  }, [organizations]);

  const statDataByStatId = useMemo(() => {
    const map = new Map<string, { type: string; data: Record<string, number> }>();
    for (const [id, series] of (seriesByStatId || new Map())) {
      const last = series[series.length - 1];
      if (!last) continue;
      map.set(id, { type: last.type, data: last.data });
    }
    return map;
  }, [seriesByStatId]);


  const [orgPinsVisible, setOrgPinsVisible] = useState(false);
  const [orgsVisibleIds, setOrgsVisibleIds] = useState<string[]>([]);
  const [orgsAllSourceIds, setOrgsAllSourceIds] = useState<string[]>([]);
  const [zoomOutNonce, setZoomOutNonce] = useState(0);
  // Nonce to explicitly clear map category chips when clearing stat from sidebar
  const [clearMapCategoryNonce, setClearMapCategoryNonce] = useState(0);

  const handleBrandClick = () => {
    console.log("Brand clicked - would reset map view");
    setSelectedZips([]);
    setPinnedZips([]);
    setActiveScreen("map");
  };

  const handleHover = (idOrIds: string | string[] | null) => {
    if (Array.isArray(idOrIds)) {
      setHighlightedOrganizationIds(idOrIds);
      return;
    }
    setHighlightedOrganizationIds(null);
    setActiveOrganizationId(idOrIds);
  };

  const handleToggleZipPin = (zip: string, pinned: boolean) => {
    if (pinned) {
      setPinnedZips((prev) => [...prev, zip]);
      if (!selectedZips.includes(zip)) {
        setSelectedZips((prev) => [...prev, zip]);
      }
    } else {
      setPinnedZips((prev) => prev.filter((z) => z !== zip));
    }
  };

  const handleAddZips = (zips: string[]) => {
    setSelectedZips((prev) => {
      const newSet = new Set([...prev, ...zips]);
      return Array.from(newSet);
    });
  };

  const handleClearSelection = () => {
    setSelectedZips([]);
    setPinnedZips([]);
  };

  const handleExport = () => {
    const zips = Array.from(selectedZips).sort();
    if (zips.length === 0) return;

    const headers: string[] = ["zip", "population", "avg_age", "married_percent"];

    const selectedCategory = categoryFilter;
    const allStats = Array.from(statsById.values());
    const statColumns: { id: string; header: string }[] = [];
    if (selectedCategory) {
      const inCategory = allStats.filter((s) => s.category === selectedCategory);
      for (const s of inCategory) {
        const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        statColumns.push({ id: s.id, header: slug || `stat_${s.id.slice(0, 6)}` });
      }
    } else if (selectedStatId) {
      const s = statsById.get(selectedStatId);
      if (s) {
        const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
        statColumns.push({ id: s.id, header: slug || `stat_${s.id.slice(0, 6)}` });
      }
    }
    for (const c of statColumns) headers.push(c.header);

    let orgCountHeader: string | null = null;
    const activeOrgsByZip = new Map<string, number>();
    if (selectedCategory) {
      orgCountHeader = `number_of_${selectedCategory}_orgs_active`;
      headers.splice(4, 0, orgCountHeader);

      const idsFilter = new Set(orgsAllSourceIds);
      const fromSource = organizations.filter((o) => idsFilter.size === 0 || idsFilter.has(o.id));
      const catOrgs = fromSource.filter((o) => o.category === selectedCategory);
      for (const org of catOrgs) {
        const zip = orgZipById.get(org.id);
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

    // Helpers to look up stat data by stat name
    const getEntryByName = (name: string): { data: Record<string, number> } | null => {
      for (const [statId, entry] of statDataByStatId) {
        const s = statsById.get(statId);
        if (s?.name === name) return entry as any;
      }
      return null;
    };

    const popEntry = getEntryByName("Population");
    const ageEntry = getEntryByName("Average Age");
    const marriedEntry = getEntryByName("Married Percent");
    if (!popEntry) return;

    for (const zip of zips) {
      const pop = Math.max(0, Math.round((popEntry.data || ({} as any))[zip] || 0));
      const age = (ageEntry?.data || ({} as any))[zip];
      const married = (marriedEntry?.data || ({} as any))[zip];

      totalPop += pop;
      weightedAge += age * pop;
      weightedMarried += married * pop;

      const base: (string | number)[] = [zip, pop, typeof age === "number" ? r1(age) : "", typeof married === "number" ? r1(married) : ""];
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

    const allCityZips = Object.keys(popEntry.data || {}).sort();
    let cityPop = 0;
    let cityWeightedAge = 0;
    let cityWeightedMarried = 0;
    const cityStatSums = new Map<string, number>();
    const cityStatCounts = new Map<string, number>();
    let cityOrgCount = 0;
    if (orgCountHeader) {
      cityOrgCount = Array.from(activeOrgsByZip.values()).reduce((a, b) => a + b, 0);
    }
    for (const zip of allCityZips) {
      const p = Math.max(0, Math.round((popEntry.data || ({} as any))[zip] || 0));
      cityPop += p;
      const age = (ageEntry?.data || ({} as any))[zip];
      const married = (marriedEntry?.data || ({} as any))[zip];
      if (typeof age === "number") cityWeightedAge += age * p;
      if (typeof married === "number") cityWeightedMarried += married * p;
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

    const lines: string[] = [];
    lines.push(headers.join(","));
    for (const row of rows) lines.push(row.join(","));
    lines.push(summary.join(","));
    lines.push(cityRow.join(","));

    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const now = new Date();
    const ts = now.toISOString().replace(/[:T]/g, "-").slice(0, 19);
    const statSuffix = selectedCategory
      ? `_${selectedCategory}`
      : selectedStatId
      ? `_${(statsById.get(selectedStatId)?.name || "stat").replace(/\s+/g, "_")}`
      : "";
    a.download = `areas_export${statSuffix}_${ts}.csv`;
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
    }
  };

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
      <TopBar onBrandClick={handleBrandClick} onNavigate={setActiveScreen} active={activeScreen} onOpenAuth={() => setAuthOpen(true)} />
      {/* Map section (always mounted) */}
          <BoundaryToolbar
            selectedZips={selectedZips}
            pinnedZips={pinnedZips}
            boundaryMode={boundaryMode}
            hoveredZip={hoveredZip}
            stickyTopClass="top-16"
            onBoundaryModeChange={setBoundaryMode}
            onToggleZipPin={handleToggleZipPin}
            onAddZips={handleAddZips}
            onClearSelection={handleClearSelection}
            onExport={handleExport}
            onHoverZip={setHoveredZip}
          />
          <main className="flex flex-1 overflow-hidden">
            {/* Sidebar */}
            <Sidebar
              organizations={(() => {
                // Compute groups for orgs tab using current visible ids and selection
                const sourceIds = new Set(orgsAllSourceIds);
                const visibleIds = new Set(orgsVisibleIds);
                const fromSource = organizations.filter((o) => sourceIds.size === 0 || sourceIds.has(o.id));
                const visible = fromSource.filter((o) => visibleIds.size === 0 || visibleIds.has(o.id));
                let inSelection: Organization[] = [];
                if (selectedZips.length > 0) {
                  const sel = new Set(selectedZips);
                  inSelection = visible.filter((o) => {
                    const zip = orgZipById.get(o.id);
                    return !!zip && sel.has(zip);
                  });
                }
                const inSelectionIds = new Set(inSelection.map((o) => o.id));
                let rest = visible.filter((o) => !inSelectionIds.has(o.id));

                // If a stat is selected, sort organizations by the stat value of their ZIP (desc)
                if (selectedStatId) {
                  const entry = statDataByStatId.get(selectedStatId);
                  if (entry) {
                    const scoreFor = (org: Organization): number => {
                      const zip = orgZipById.get(org.id);
                      if (!zip) return Number.NEGATIVE_INFINITY;
                      const v = (entry.data || ({} as Record<string, number>))[zip];
                      return typeof v === "number" && Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
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
                const totalSourceCount = sourceIds.size || fromSource.length;
                return { inSelection, all: rest, totalSourceCount };
              })()}
              activeOrganizationId={activeOrganizationId}
              highlightedOrganizationIds={highlightedOrganizationIds ?? undefined}
              demographics={demographics}
              breakdowns={breakdowns}
              statsById={statsById}
              seriesByStatId={seriesByStatId}
              selectedZips={selectedZips}
              pinnedZips={pinnedZips}
              hoveredZip={hoveredZip}
              selectedStatId={selectedStatId}
              secondaryStatId={secondaryStatId}
              categoryFilter={categoryFilter}
              onHover={handleHover}
              onHoverZip={setHoveredZip}
              onZoomOutAll={handleZoomOutAll}
              onStatSelect={handleStatSelect}
              onOrgPinsVisibleChange={setOrgPinsVisible}
            />

            {/* Map */}
            <div className="flex flex-1 flex-col overflow-hidden">
              <MapLibreMap
                organizations={organizations}
                orgPinsVisible={orgPinsVisible}
                zoomOutRequestNonce={zoomOutNonce}
                clearMapCategoryNonce={clearMapCategoryNonce}
                boundaryMode={boundaryMode}
                selectedZips={selectedZips}
                pinnedZips={pinnedZips}
                hoveredZip={hoveredZip}
                activeOrganizationId={activeOrganizationId}
                onHover={handleHover}
                selectedStatId={selectedStatId}
                secondaryStatId={secondaryStatId}
                categoryFilter={categoryFilter}
                onZipSelectionChange={(zips, meta) => {
                  console.log("ZIP selection changed:", zips, meta);
                  if (meta) {
                    setSelectedZips(zips);
                    setPinnedZips(meta.pinned);
                  }
                }}
                onZipHoverChange={setHoveredZip}
                onStatSelectionChange={setSelectedStatId}
                onCategorySelectionChange={setCategoryFilter}
                onVisibleIdsChange={(ids, _totalInSource, allSourceIds) => {
                  setOrgsVisibleIds(ids);
                  setOrgsAllSourceIds(allSourceIds);
                }}
                onBoundaryModeChange={setBoundaryMode}
              />
            </div>
          </main>
      {/* Report overlay (hidden via aria/visibility to ensure map stays laid out) */}
      <div
        aria-hidden={activeScreen !== "report"}
        style={{ visibility: activeScreen === "report" ? "visible" : "hidden" }}
        className="absolute left-0 right-0 bottom-0 top-16 z-30"
      >
        <div className="flex h-full w-full overflow-hidden bg-white dark:bg-slate-900 pt-10">
          {/* Toolbar in report overlay */}
          <div className="absolute left-0 right-0 top-0 z-10">
            <BoundaryToolbar
              selectedZips={selectedZips}
              pinnedZips={pinnedZips}
              boundaryMode={boundaryMode}
              hoveredZip={hoveredZip}
              stickyTopClass="top-0"
              onBoundaryModeChange={setBoundaryMode}
              onToggleZipPin={handleToggleZipPin}
              onAddZips={handleAddZips}
              onClearSelection={handleClearSelection}
              onExport={handleExport}
              onHoverZip={setHoveredZip}
            />
          </div>
          {activeScreen === "report" && (
            <Suspense fallback={<div className="flex flex-1 items-center justify-center text-sm text-slate-500">Loading report…</div>}>
              <ReportScreen
                selectedZips={selectedZips}
                organizations={organizations}
                orgZipById={orgZipById}
                statsById={statsById}
                statDataById={(() => {
                  const map = new Map<string, { type: string; data: Record<string, number> }>();
                  for (const [id, series] of (seriesByStatId || new Map())) {
                    const last = series[series.length - 1];
                    if (!last) continue;
                    map.set(id, { type: last.type, data: last.data });
                  }
                  return map;
                })()}
                seriesByStatId={seriesByStatId}
              />
            </Suspense>
          )}
        </div>
      </div>

      {/* Data overlay */}
      <div
        aria-hidden={activeScreen !== "data"}
        style={{ visibility: activeScreen === "data" ? "visible" : "hidden" }}
        className="absolute left-0 right-0 bottom-0 top-16 z-30"
      >
        {activeScreen === "data" && (
          <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-slate-500">Loading data…</div>}>
            <div className="flex h-full w-full overflow-auto bg-white dark:bg-slate-900">
              <DataScreen />
            </div>
          </Suspense>
        )}
      </div>
      <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
    </div>
  );
};
