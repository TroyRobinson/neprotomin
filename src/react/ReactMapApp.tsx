import { useState, lazy, Suspense, useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { BoundaryToolbar } from "./components/BoundaryToolbar";
import { MapLibreMap } from "./components/MapLibreMap";
import { Sidebar } from "./components/Sidebar";
import { useDemographics } from "./hooks/useDemographics";
import { useStats } from "./hooks/useStats";
import { useOrganizations } from "./hooks/useOrganizations";
import { useAreas } from "./hooks/useAreas";
import type { Organization } from "../types/organization";
import { findZipForLocation } from "../lib/zipBoundaries";
import { findCountyForLocation } from "../lib/countyBoundaries";
import { useMemo } from "react";
import type { BoundaryMode } from "../types/boundaries";
import { AuthModal } from "./components/AuthModal";
import { db } from "../lib/reactDb";
import type { AreaId, AreaKind, PersistedAreaSelection } from "../types/areas";
type SupportedAreaKind = "ZIP" | "COUNTY";
const ReportScreen = lazy(() => import("./components/ReportScreen").then((m) => ({ default: m.ReportScreen })));
const DataScreen = lazy(() => import("./components/DataScreen").then((m) => ({ default: m.default })));

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

export const ReactMapApp = () => {
  const [boundaryMode, setBoundaryMode] = useState<BoundaryMode>("zips");
  const [areaSelections, setAreaSelections] = useState<AreaSelectionMap>(createInitialAreaSelections);
  const [hoveredArea, setHoveredArea] = useState<AreaId | null>(null);
  const [activeOrganizationId, setActiveOrganizationId] = useState<string | null>(null);
  const [highlightedOrganizationIds, setHighlightedOrganizationIds] = useState<string[] | null>(null);
  const [selectedStatId, setSelectedStatId] = useState<string | null>(null);
  const [secondaryStatId, setSecondaryStatId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [activeScreen, setActiveScreen] = useState<"map" | "report" | "data">("map");
  const [authOpen, setAuthOpen] = useState(false);
  const [cameraState, setCameraState] = useState<{ center: [number, number]; zoom: number } | null>(null);

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
  };

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

  const { combinedSnapshot } = useDemographics({
    selectedByKind: {
      ZIP: selectedZips,
      COUNTY: selectedCounties,
    },
    defaultContext: defaultAreaContext,
  });

  const { statsById, seriesByStatId, seriesByStatIdByKind, statDataByBoundary } = useStats();
  const { organizations } = useOrganizations();

  const areaNameLookup = useMemo(
    () => (kind: SupportedAreaKind, code: string) => getAreaLabel(kind, code) ?? code,
    [getAreaLabel],
  );

  const selectedAreasMap = useMemo(
    () => ({ ZIP: selectedZips, COUNTY: selectedCounties }),
    [selectedZips, selectedCounties],
  );

  const pinnedAreasMap = useMemo(
    () => ({ ZIP: pinnedZips, COUNTY: pinnedCounties }),
    [pinnedZips, pinnedCounties],
  );
  // areasByKey removed; population/age/married now sourced from statData
  const orgZipById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const o of organizations) {
      const zip = findZipForLocation(o.longitude, o.latitude);
      map.set(o.id, zip);
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

  const statDataByStatId = useMemo(
    () =>
      new Map<
        string,
        Partial<Record<"ZIP" | "COUNTY", { type: string; data: Record<string, number>; min: number; max: number }>>
      >(
        Array.from(statDataByBoundary.entries()).map(([statId, entry]) => {
          const payload: Partial<Record<"ZIP" | "COUNTY", { type: string; data: Record<string, number>; min: number; max: number }>> =
            {};
          if (entry.ZIP) payload.ZIP = entry.ZIP;
          if (entry.COUNTY) payload.COUNTY = entry.COUNTY;
          return [statId, payload];
        }),
      ),
    [statDataByBoundary],
  );


  const [orgPinsVisible, setOrgPinsVisible] = useState(false);
  const [orgsVisibleIds, setOrgsVisibleIds] = useState<string[]>([]);
  const [orgsAllSourceIds, setOrgsAllSourceIds] = useState<string[]>([]);
  const [zoomOutNonce, setZoomOutNonce] = useState(0);
  // Nonce to explicitly clear map category chips when clearing stat from sidebar
  const [clearMapCategoryNonce, setClearMapCategoryNonce] = useState(0);

  const handleBrandClick = () => {
    console.log("Brand clicked - would reset map view");
    applyAreaSelection("ZIP", { selected: [], pinned: [], transient: [] });
    applyAreaSelection("COUNTY", { selected: [], pinned: [], transient: [] });
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
        if (s?.name === name) {
          return entry?.ZIP ?? entry?.COUNTY ?? null;
        }
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
        const sd = statDataByStatId.get(col.id)?.ZIP;
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
        const sd = statDataByStatId.get(col.id)?.ZIP;
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
            boundaryMode={boundaryMode}
            selections={toolbarSelections}
            hoveredArea={hoveredArea}
            stickyTopClass="top-16"
            onBoundaryModeChange={setBoundaryMode}
            onHoverArea={setHoveredAreaState}
            onExport={handleExport}
            onUpdateSelection={handleUpdateAreaSelection}
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
                  const entryMap = statDataByStatId.get(selectedStatId);
                  if (entryMap) {
                    const zipEntry = entryMap.ZIP;
                    const countyEntry = entryMap.COUNTY;
                    const scoreFor = (org: Organization): number => {
                      if (zipEntry) {
                        const zip = orgZipById.get(org.id);
                        if (zip) {
                          const v = zipEntry.data?.[zip];
                          if (typeof v === "number" && Number.isFinite(v)) {
                            return v;
                          }
                        }
                      }
                      if (countyEntry) {
                        const county = orgCountyById.get(org.id);
                        if (county) {
                          const v = countyEntry.data?.[county];
                          if (typeof v === "number" && Number.isFinite(v)) {
                            return v;
                          }
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
                const totalSourceCount = sourceIds.size || fromSource.length;
                return { inSelection, all: rest, totalSourceCount };
              })()}
              activeOrganizationId={activeOrganizationId}
              highlightedOrganizationIds={highlightedOrganizationIds ?? undefined}
              statsById={statsById}
              seriesByStatIdByKind={seriesByStatIdByKind}
              statDataById={statDataByStatId}
              combinedDemographics={combinedSnapshot}
              selectedAreas={selectedAreasMap}
              pinnedAreas={pinnedAreasMap}
              areaNameLookup={areaNameLookup}
              hoveredArea={hoveredArea}
              selectedStatId={selectedStatId}
              secondaryStatId={secondaryStatId}
              categoryFilter={categoryFilter}
              onHover={handleHover}
              onHoverArea={handleAreaHoverChange}
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
                selectedCounties={selectedCounties}
                pinnedCounties={pinnedCounties}
                hoveredCounty={hoveredCounty}
                activeOrganizationId={activeOrganizationId}
                onHover={handleHover}
                selectedStatId={selectedStatId}
                secondaryStatId={secondaryStatId}
                categoryFilter={categoryFilter}
                onAreaSelectionChange={handleAreaSelectionChange}
                onAreaHoverChange={handleAreaHoverChange}
                onStatSelectionChange={setSelectedStatId}
                onCategorySelectionChange={setCategoryFilter}
                onVisibleIdsChange={(ids, _totalInSource, allSourceIds) => {
                  setOrgsVisibleIds(ids);
                  setOrgsAllSourceIds(allSourceIds);
                }}
                onBoundaryModeChange={setBoundaryMode}
                onCameraChange={setCameraState}
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
              boundaryMode={boundaryMode}
              selections={toolbarSelections}
              hoveredArea={hoveredArea}
              stickyTopClass="top-0"
              onBoundaryModeChange={setBoundaryMode}
              onHoverArea={setHoveredAreaState}
              onExport={handleExport}
              onUpdateSelection={handleUpdateAreaSelection}
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
                  for (const [id, entry] of statDataByStatId.entries()) {
                    const zipEntry = entry.ZIP ?? entry.COUNTY;
                    if (!zipEntry) continue;
                    map.set(id, { type: zipEntry.type, data: zipEntry.data });
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
