import { useState, lazy, Suspense, useEffect } from "react";
import { TopBar } from "./components/TopBar";
import { BoundaryToolbar } from "./components/BoundaryToolbar";
import { MapLibreMap } from "./components/MapLibreMap";
import { Sidebar } from "./components/Sidebar";
import { useDemographics, type CombinedDemographicsSnapshot } from "./hooks/useDemographics";
import { useStats } from "./hooks/useStats";
import type { StatBoundaryEntry } from "./hooks/useStats";
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

const COUNTY_MODE_ENABLE_ZOOM = 9;
const COUNTY_MODE_DISABLE_ZOOM = 9.6;

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
  const [boundaryControlMode, setBoundaryControlMode] = useState<"auto" | "manual">("auto");
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
    setBoundaryControlMode("auto");
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

  const { combinedSnapshot, demographicsByKind } = useDemographics({
    selectedByKind: {
      ZIP: selectedZips,
      COUNTY: selectedCounties,
    },
    defaultContext: defaultAreaContext,
  });

  const { statsById, seriesByStatIdByKind, statDataByBoundary } = useStats();
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
        ? "ZIP Overview"
        : "County Overview");
    return {
      label,
      stats: entry.stats,
      breakdowns: entry.breakdowns,
      isMissing: entry.isMissing,
      areaCount: count,
      missingAreaCount: 0,
    } as CombinedDemographicsSnapshot;
  }, [activeAreaKind, activeSelectedCodes, areaNameLookup, demographicsByKind]);
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

  const handleExport = () => {
    const primaryKind: SupportedAreaKind | null =
      selectedZips.length > 0 ? "ZIP" : selectedCounties.length > 0 ? "COUNTY" : null;
    if (!primaryKind) return;

    const areaCodes = primaryKind === "ZIP" ? [...selectedZips].sort() : [...selectedCounties].sort();
    if (areaCodes.length === 0) return;

    const areaColumn = primaryKind === "ZIP" ? "zip" : "county";
    const headers: string[] = [areaColumn, "area_name"];

    const selectedCategory = categoryFilter;
    const allStats = Array.from(statsById.values());
    const columnEntries: { id: string; header: string; entry: StatBoundaryEntry }[] = [];
    const addColumn = (statId: string, header: string) => {
      const entry = statDataByStatId.get(statId)?.[primaryKind];
      if (!entry) return;
      columnEntries.push({ id: statId, header, entry });
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
    const activeOrgsByArea = new Map<string, number>();
    if (selectedCategory) {
      orgCountHeader = `number_of_${selectedCategory}_orgs_active`;
      headers.push(orgCountHeader);

      const idsFilter = new Set(orgsAllSourceIds);
      const fromSource = organizations.filter((org) => idsFilter.size === 0 || idsFilter.has(org.id));
      const categoryOrgs = fromSource.filter((org) => org.category === selectedCategory);
      for (const org of categoryOrgs) {
        const code = primaryKind === "ZIP" ? orgZipById.get(org.id) : orgCountyById.get(org.id);
        if (!code) continue;
        activeOrgsByArea.set(code, (activeOrgsByArea.get(code) || 0) + 1);
      }
    }

    headers.push("population", "avg_age", "married_percent");
    for (const column of columnEntries) headers.push(column.header);

    const r1 = (value: number): string => (Math.round(value * 10) / 10).toFixed(1);

    const getEntryByName = (name: string): StatBoundaryEntry | null => {
      for (const [statId, entry] of statDataByStatId.entries()) {
        const stat = statsById.get(statId);
        if (stat?.name === name) {
          return entry?.[primaryKind] ?? null;
        }
      }
      return null;
    };

    const populationEntry = getEntryByName("Population");
    const ageEntry = getEntryByName("Average Age");
    const marriedEntry = getEntryByName("Married Percent");
    if (!populationEntry) return;

    const rows: (string | number)[][] = [];
    let totalPopulation = 0;
    let weightedAge = 0;
    let weightedMarried = 0;
    const statSums = new Map<string, number>();
    const statCounts = new Map<string, number>();

    for (const code of areaCodes) {
      const population = Math.max(0, Math.round((populationEntry.data || ({} as Record<string, number>))[code] || 0));
      const age = (ageEntry?.data || ({} as Record<string, number>))[code];
      const married = (marriedEntry?.data || ({} as Record<string, number>))[code];

      totalPopulation += population;
      if (typeof age === "number") weightedAge += age * population;
      if (typeof married === "number") weightedMarried += married * population;

      const row: (string | number)[] = [
        code,
        areaNameLookup(primaryKind, code) || code,
      ];
      if (orgCountHeader) row.push(activeOrgsByArea.get(code) || 0);
      row.push(
        population,
        typeof age === "number" ? r1(age) : "",
        typeof married === "number" ? r1(married) : "",
      );

      for (const column of columnEntries) {
        const value = column.entry.data?.[code];
        if (typeof value === "number") {
          row.push(r1(value));
          statSums.set(column.id, (statSums.get(column.id) || 0) + value);
          statCounts.set(column.id, (statCounts.get(column.id) || 0) + 1);
        } else {
          row.push("");
        }
      }
      rows.push(row);
    }

    const averageAge = totalPopulation > 0 ? weightedAge / totalPopulation : 0;
    const averageMarried = totalPopulation > 0 ? weightedMarried / totalPopulation : 0;
    const summaryRow: (string | number)[] = [
      primaryKind === "ZIP" ? "ALL_SELECTED_ZIPS" : "ALL_SELECTED_COUNTIES",
      "—",
    ];
    if (orgCountHeader) summaryRow.push(areaCodes.reduce((sum, code) => sum + (activeOrgsByArea.get(code) || 0), 0));
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
    const allAreaKeys = Object.keys(populationEntry.data || {}).sort();
    for (const code of allAreaKeys) {
      const population = Math.max(0, Math.round((populationEntry.data || ({} as Record<string, number>))[code] || 0));
      baselinePopulation += population;
      const age = (ageEntry?.data || ({} as Record<string, number>))[code];
      if (typeof age === "number") baselineWeightedAge += age * population;
      const married = (marriedEntry?.data || ({} as Record<string, number>))[code];
      if (typeof married === "number") baselineWeightedMarried += married * population;

      for (const column of columnEntries) {
        const value = column.entry.data?.[code];
        if (typeof value === "number") {
          baselineStatSums.set(column.id, (baselineStatSums.get(column.id) || 0) + value);
          baselineStatCounts.set(column.id, (baselineStatCounts.get(column.id) || 0) + 1);
        }
      }
    }

    const baselineRow: (string | number)[] = [baselineLabel, baselineName];
    if (orgCountHeader) {
      const totalOrgCount = Array.from(activeOrgsByArea.values()).reduce((sum, count) => sum + count, 0);
      baselineRow.push(totalOrgCount);
    }
    baselineRow.push(
      baselinePopulation,
      r1(baselinePopulation > 0 ? baselineWeightedAge / baselinePopulation : 0),
      r1(baselinePopulation > 0 ? baselineWeightedMarried / baselinePopulation : 0),
    );
    for (const column of columnEntries) {
      const count = baselineStatCounts.get(column.id) || 0;
      if (count > 0) baselineRow.push(r1((baselineStatSums.get(column.id) || 0) / count));
      else baselineRow.push("");
    }

    const lines: string[] = [];
    lines.push(headers.join(","));
    for (const row of rows) lines.push(row.join(","));
    lines.push(summaryRow.join(","));
    lines.push(baselineRow.join(","));

    const csv = lines.join("\n");
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
    }
  };

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
      <TopBar onBrandClick={handleBrandClick} onNavigate={setActiveScreen} active={activeScreen} onOpenAuth={() => setAuthOpen(true)} />
      {/* Map section (always mounted) */}
          <BoundaryToolbar
            boundaryMode={boundaryMode}
            boundaryControlMode={boundaryControlMode}
            selections={toolbarSelections}
            hoveredArea={hoveredArea}
            stickyTopClass="top-16"
            onBoundaryModeChange={handleBoundaryModeManualSelect}
            onBoundaryControlModeChange={handleBoundaryControlModeChange}
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
              demographicsSnapshot={activeDemographicsSnapshot ?? combinedSnapshot}
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
                autoBoundarySwitch={autoBoundarySwitch}
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
                onBoundaryModeChange={handleMapBoundaryModeChange}
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
