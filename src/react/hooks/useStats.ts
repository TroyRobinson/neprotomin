import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../../lib/reactDb";
import { useAuthSession } from "./useAuthSession";
import {
  PERSISTED_STAT_CACHE_TTL_MS,
  readStatSummaryCache,
  subscribeToCacheEvents,
  writeStatSummaryCache,
  type StatBoundaryType as PersistedBoundaryType,
  type StatSummaryRow as PersistedStatSummaryRow,
} from "../../lib/persistentStatsCache";
import type {
  Stat,
  StatRelation,
  StatRelationsByChild,
  StatRelationsByParent,
} from "../../types/stat";
import type { Category } from "../../types/organization";
import type { AreaKind } from "../../types/areas";
import { DEFAULT_PARENT_AREA_BY_KIND } from "../../types/areas";
import { normalizeScopeLabel } from "../../lib/scopeLabels";
import { isDevEnv } from "../../lib/env";

type SupportedAreaKind = Extract<AreaKind, "ZIP" | "COUNTY">;

const STAT_DATA_CACHE_TTL_MS = PERSISTED_STAT_CACHE_TTL_MS;
const NAME_FOR_SORT = (stat: Stat) => (stat.label || stat.name || "").toLowerCase();

export interface SeriesEntry {
  date: string;
  type: string;
  data: Record<string, number>;
  parentArea: string | null;
}

export type SeriesByKind = Map<SupportedAreaKind, SeriesEntry[]>;
export type SeriesByParent = Map<string, SeriesByKind>;

export type StatBoundaryEntry = {
  type: string;
  data: Record<string, number>;
  min: number;
  max: number;
};

const SUPPORTED_AREA_KINDS: SupportedAreaKind[] = ["ZIP", "COUNTY"];

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

interface UseStatsOptions {
  statDataEnabled?: boolean;
  priorityStatIds?: string[];
  categoryFilter?: string | null;
  zipScopes?: string[];
  countyScopes?: string[];
  summaryKinds?: SupportedAreaKind[];
  initialBatchSize?: number;
  batchSize?: number;
  enableTrickle?: boolean;
}

export const useStats = ({
  statDataEnabled = true,
  priorityStatIds = [],
  categoryFilter = null,
  zipScopes = [],
  countyScopes = [],
  summaryKinds = SUPPORTED_AREA_KINDS,
  initialBatchSize = 12,
  batchSize = 12,
  enableTrickle = true,
}: UseStatsOptions = {}) => {
  const { authReady } = useAuthSession();
  const queryEnabled = authReady;

  // Persisted summaries: hydrate immediately from IndexedDB so sidebar values render on refresh/new tab.
  const persistedSummaryRowsRef = useRef<any[]>([]);
  const [persistedSummaryRowsVersion, setPersistedSummaryRowsVersion] = useState(0);
  const [cacheClearNonce, setCacheClearNonce] = useState(0);
  const [cacheUpdateNonce, setCacheUpdateNonce] = useState(0);
  useEffect(() => {
    return subscribeToCacheEvents((event) => {
      if (event.type === "cleared") {
        persistedSummaryRowsRef.current = [];
        setPersistedSummaryRowsVersion((v) => v + 1);
        setCacheClearNonce((v) => v + 1);
      }
      if (event.type === "updated" && event.store === "summaries") {
        setCacheUpdateNonce((v) => v + 1);
      }
    });
  }, []);

  // Query stats and statData directly from InstantDB
  // Wait for auth to be ready to avoid race conditions (especially in Safari)
  const [statDataRefreshRequested, setStatDataRefreshRequested] = useState(false);
  const [lastStatDataAt, setLastStatDataAt] = useState<number | null>(null);

  // Cache each payload slice so disabling statData doesn't wipe the last good statData payload.
  const cachedStatsRef = useRef<any[] | undefined>(undefined);
  const cachedStatRelationsRef = useRef<any[] | undefined>(undefined);
  const cachedStatDataByKeyRef = useRef<Map<string, any>>(new Map());
  const [statDataCacheVersion, setStatDataCacheVersion] = useState(0);
  const [loadedStatIds, setLoadedStatIds] = useState<Set<string>>(new Set());
  const [batchGeneration, setBatchGeneration] = useState(0);

  const {
    data: statsResp,
    isLoading: statsLoading,
    error: statsError,
  } = db.useQuery(
    queryEnabled
      ? {
          stats: {
            $: {
              order: { name: "asc" as const },
            },
          },
          statRelations: {
            $: {
              fields: [
                "id",
                "relationKey",
                "parentStatId",
                "childStatId",
                "statAttribute",
                "sortOrder",
                "createdAt",
                "updatedAt",
              ],
              order: { sortOrder: "asc" as const },
            },
          },
        }
      : null,
  );

  if (Array.isArray(statsResp?.stats)) {
    cachedStatsRef.current = statsResp.stats;
  }
  if (Array.isArray(statsResp?.statRelations)) {
    cachedStatRelationsRef.current = statsResp.statRelations;
  }

  useEffect(() => {
    if (!statDataEnabled) return;
    if (lastStatDataAt === null) return;
    if (typeof window === "undefined") return;
    const age = Date.now() - lastStatDataAt;
    if (age >= STAT_DATA_CACHE_TTL_MS) {
      if (!statDataRefreshRequested) {
        setStatDataRefreshRequested(true);
        setLoadedStatIds(new Set());
        setBatchGeneration((prev) => prev + 1);
      }
      return;
    }
    const timeout = window.setTimeout(
      () => setStatDataRefreshRequested(true),
      STAT_DATA_CACHE_TTL_MS - age,
    );
    return () => window.clearTimeout(timeout);
  }, [lastStatDataAt, statDataEnabled, statDataRefreshRequested]);

  const statsRows: any[] | undefined = Array.isArray(statsResp?.stats)
    ? statsResp.stats
    : cachedStatsRef.current;
  const statRelationsRows: any[] | undefined = Array.isArray(statsResp?.statRelations)
    ? statsResp.statRelations
    : cachedStatRelationsRef.current;

  const statsById = useMemo(() => {
    const map = new Map<string, Stat>();
    if (!Array.isArray(statsRows)) return map;
    for (const row of statsRows) {
      if (row?.id && typeof row.name === "string" && typeof row.category === "string") {
        map.set(row.id, {
          id: row.id,
          name: row.name,
          label: typeof row.label === "string" && row.label.trim() ? row.label : undefined,
          category: row.category as Category,
          goodIfUp: typeof row.goodIfUp === "boolean" ? row.goodIfUp : undefined,
          featured: typeof row.featured === "boolean" ? row.featured : undefined,
          homeFeatured: typeof row.homeFeatured === "boolean" ? row.homeFeatured : undefined,
          active: typeof row.active === "boolean" ? row.active : undefined,
          type: typeof row.type === "string" ? row.type : undefined,
        });
      }
    }
    return map;
  }, [statsRows]);

/**
 * Determines the effective type for a stat, using explicit type or name heuristics.
 */
const getEffectiveStatType = (statId: string, declaredType: string, statsById: Map<string, Stat>): string => {
  const stat = statsById.get(statId);
  const explicitType = stat?.type;
  
  // If stat has an explicit type override, use it
  if (explicitType && explicitType !== "count") {
    return explicitType;
  }

  // If the data row already has a specific type (percent, rate, etc.), keep it
  if (declaredType && declaredType !== "count") {
    return declaredType;
  }

  // Otherwise, use name-based heuristics
  if (stat) {
    const name = (stat.label || stat.name || "").toLowerCase();
    if (name.includes("(dollars)") || name.includes("(usd)")) {
      return "currency";
    }
  }

  return declaredType || "count";
};

  const childrenByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!Array.isArray(statRelationsRows)) return map;
    for (const row of statRelationsRows) {
      const parentId = typeof row?.parentStatId === "string" ? row.parentStatId : null;
      const childId = typeof row?.childStatId === "string" ? row.childStatId : null;
      if (!parentId || !childId) continue;
      const list = map.get(parentId) ?? [];
      list.push(childId);
      map.set(parentId, list);
    }
    return map;
  }, [statRelationsRows]);

  const statDataRowKey = (row: any): string | null => {
    const statId = typeof row?.statId === "string" ? row.statId : null;
    const name = typeof row?.name === "string" ? row.name : null;
    const parentArea = typeof row?.parentArea === "string" ? row.parentArea : null;
    const boundaryType = typeof row?.boundaryType === "string" ? row.boundaryType : null;
    const date = typeof row?.date === "string" ? row.date : typeof row?.date === "number" ? String(row.date) : null;
    if (!statId || !name || !parentArea || !boundaryType || !date) return null;
    return `${statId}::${name}::${parentArea}::${boundaryType}::${date}`;
  };

  // Seed loaded set from any cached statData (initial render after cache restore)
  useEffect(() => {
    if (loadedStatIds.size > 0) return;
    const cached = Array.from(cachedStatDataByKeyRef.current.values());
    if (cached.length === 0) return;
    const next = new Set<string>();
    for (const row of cached) {
      if (row && typeof (row as any).statId === "string") next.add((row as any).statId);
    }
    if (next.size > 0) setLoadedStatIds(next);
  }, [loadedStatIds.size]);

  const priorityIds = useMemo(
    () => Array.from(new Set(priorityStatIds.filter((id): id is string => typeof id === "string" && id.trim().length > 0))),
    [priorityStatIds],
  );

  const orderedStatIds = useMemo(() => {
    const stats = Array.from(statsById.values());
    stats.sort((a, b) => NAME_FOR_SORT(a).localeCompare(NAME_FOR_SORT(b)));
    if (!categoryFilter) return stats.map((s) => s.id);
    const preferred = stats.filter((s) => s.category === categoryFilter);
    const rest = stats.filter((s) => s.category !== categoryFilter);
    return [...preferred, ...rest].map((s) => s.id);
  }, [statsById, categoryFilter]);

  const batchIds = useMemo(() => {
    if (!statDataEnabled) return [];
    const batch: string[] = [];
    const seen = new Set<string>();
    const loaded = loadedStatIds;
    const desired = (loaded.size === 0 ? initialBatchSize : batchSize) + priorityIds.length;
    const add = (id?: string | null) => {
      if (!id || typeof id !== "string") return;
      if (loaded.has(id) || seen.has(id)) return;
      seen.add(id);
      batch.push(id);
    };
    const addWithChildren = (id: string, depth: number) => {
      add(id);
      if (depth <= 0) return;
      const children = childrenByParent.get(id) ?? [];
      for (const childId of children) {
        add(childId);
        if (depth > 1) {
          const grandChildren = childrenByParent.get(childId) ?? [];
          for (const gcId of grandChildren) add(gcId);
        }
      }
    };

    // Priority: fetch only the stat itself (not its children) so selecting a stat
    // reliably loads the choropleth data without creating a huge $in batch.
    for (const id of priorityIds) addWithChildren(id, 0);
    for (const id of orderedStatIds) {
      if (!enableTrickle && batch.length >= Math.max(priorityIds.length, initialBatchSize)) break;
      if (batch.length >= Math.max(priorityIds.length, desired)) break;
      addWithChildren(id, 1);
    }
    return batch;
  }, [
    statDataEnabled,
    loadedStatIds,
    priorityIds,
    orderedStatIds,
    initialBatchSize,
    batchSize,
    enableTrickle,
    batchGeneration,
    childrenByParent,
  ]);

  const shouldIncludeStatData =
    statDataEnabled &&
    (batchIds.length > 0 || statDataRefreshRequested || lastStatDataAt === null);

  const {
    data: statDataResp,
    isLoading: statDataLoading,
    error: statDataError,
  } = db.useQuery(
    queryEnabled && shouldIncludeStatData && batchIds.length > 0
      ? {
          statData: {
            $: {
              where: { name: "root", statId: { $in: batchIds } },
              fields: ["statId", "name", "parentArea", "boundaryType", "date", "type", "data"],
              order: { date: "asc" as const },
            },
          },
        }
      : null,
  );

  const lastRequestedBatchKeyRef = useRef<string>("");
  const lastRequestedBatchIdsRef = useRef<string[]>([]);
  useEffect(() => {
    if (!queryEnabled || !shouldIncludeStatData || batchIds.length === 0) return;
    lastRequestedBatchKeyRef.current = `${batchGeneration}::${batchIds.join("|")}`;
    lastRequestedBatchIdsRef.current = batchIds;
  }, [batchGeneration, batchIds, queryEnabled, shouldIncludeStatData]);

  const processedBatchKeyRef = useRef<string>("");
  useEffect(() => {
    if (statDataLoading) return;
    if (!queryEnabled || !shouldIncludeStatData) return;
    const batchKey = lastRequestedBatchKeyRef.current;
    if (!batchKey) return;
    if (processedBatchKeyRef.current === batchKey) return;
    processedBatchKeyRef.current = batchKey;

    const rows = Array.isArray(statDataResp?.statData) ? (statDataResp.statData as any[]) : [];
    if (rows.length === 0) return;
    let didMerge = false;
    for (const row of rows) {
      const key = statDataRowKey(row);
      if (!key) continue;
      cachedStatDataByKeyRef.current.set(key, row);
      didMerge = true;
    }
    if (didMerge) {
      setStatDataCacheVersion((v) => v + 1);
      setLastStatDataAt(Date.now());
    }

    const requested = lastRequestedBatchIdsRef.current;
    setLoadedStatIds((prev) => {
      const next = new Set(prev);
      for (const row of rows) {
        if (row && typeof row.statId === "string") next.add(row.statId);
      }
      // Only mark requested IDs "loaded" if we actually received rows.
      for (const id of requested) next.add(id);
      return next;
    });

    if (statDataRefreshRequested) {
      setStatDataRefreshRequested(false);
    }
  }, [queryEnabled, shouldIncludeStatData, statDataLoading, statDataResp, statDataRefreshRequested]);

  const cachedStatDataRows = useMemo(
    () => Array.from(cachedStatDataByKeyRef.current.values()),
    [statDataCacheVersion],
  );

  const statDataRows = useMemo(() => {
    const merged = new Map<string, any>();
    for (const row of cachedStatDataRows) {
      const key = statDataRowKey(row);
      if (key) merged.set(key, row);
    }
    const incoming = Array.isArray(statDataResp?.statData) ? (statDataResp.statData as any[]) : [];
    for (const row of incoming) {
      const key = statDataRowKey(row);
      if (key) merged.set(key, row);
    }
    return Array.from(merged.values());
  }, [cachedStatDataRows, statDataResp?.statData]);

  const effectiveData = {
    stats: statsRows,
    statRelations: statRelationsRows,
    statData: statDataRows,
  };

  const isLoading = statsLoading || statDataLoading;
  const error = statsError || statDataError;

  const summaryParentAreas = useMemo(() => {
    const set = new Set<string>();
    // Always include the statewide bucket as a fallback.
    // Many stats only have parentArea="Oklahoma" (especially right after imports),
    // so if the user is scoped to a county (e.g. "Tulsa") we still want summary
    // values to appear in the sidebar.
    set.add(normalizeScopeLabel(DEFAULT_PARENT_AREA_BY_KIND.ZIP) ?? "Oklahoma");
    set.add(normalizeScopeLabel(DEFAULT_PARENT_AREA_BY_KIND.COUNTY) ?? "Oklahoma");
    // Only include the primary scopes (not all neighbors) to keep the summary
    // query small and avoid Instant operation timeouts.
    const primaryZipScope = typeof zipScopes[0] === "string" ? normalizeScopeLabel(zipScopes[0]) : null;
    const primaryCountyScope =
      typeof countyScopes[0] === "string" ? normalizeScopeLabel(countyScopes[0]) : null;
    if (primaryZipScope) set.add(primaryZipScope);
    if (primaryCountyScope) set.add(primaryCountyScope);
    return Array.from(set);
  }, [countyScopes, zipScopes]);

  const fallbackParentArea = normalizeScopeLabel(DEFAULT_PARENT_AREA_BY_KIND.ZIP) ?? "Oklahoma";
  const primaryScopedParentArea = summaryParentAreas.find(
    (area) => area !== fallbackParentArea,
  );

  const summaryKindsKey = useMemo(
    () => summaryKinds.slice().sort().join("|"),
    [summaryKinds],
  );

  useEffect(() => {
    if (!statDataEnabled) return;
    if (typeof window === "undefined") return;

    let cancelled = false;
    const hydrate = async () => {
      const parentAreas = [fallbackParentArea, primaryScopedParentArea].filter(
        (value): value is string => typeof value === "string" && value.length > 0,
      );
      if (parentAreas.length === 0) return;

      const rows: any[] = [];
      for (const parentArea of parentAreas) {
        for (const kind of summaryKinds) {
          const boundaryType = kind as PersistedBoundaryType;
          const cached = await readStatSummaryCache({ parentArea, boundaryType });
          if (cached?.rows?.length) {
            rows.push(...cached.rows);
          }
        }
      }

      if (cancelled) return;
      if (rows.length === 0) return;
      persistedSummaryRowsRef.current = rows;
      setPersistedSummaryRowsVersion((v) => v + 1);
    };

    hydrate().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [
    statDataEnabled,
    fallbackParentArea,
    primaryScopedParentArea,
    summaryKindsKey,
    cacheClearNonce,
    cacheUpdateNonce,
  ]);

  // Fetch statewide summaries first (fast and always available), then optionally
  // fetch the current scope (e.g. Tulsa County) in a second small query.
  const {
    data: fallbackSummariesResp,
    error: fallbackSummariesError,
  } = db.useQuery(
    queryEnabled && statDataEnabled
      ? {
          statDataSummaries: {
            $: {
              where: {
                name: "root",
                boundaryType: { $in: summaryKinds },
                parentArea: fallbackParentArea,
              },
              limit: 10000,
              order: { statId: "asc" as const },
              fields: ["statId", "name", "parentArea", "boundaryType", "date", "type", "count", "sum", "avg", "updatedAt"],
            },
          },
        }
      : null,
  );

  const {
    data: scopedSummariesResp,
    error: scopedSummariesError,
  } = db.useQuery(
    queryEnabled && statDataEnabled && Boolean(primaryScopedParentArea) && primaryScopedParentArea !== fallbackParentArea
      ? {
          statDataSummaries: {
            $: {
              where: {
                name: "root",
                boundaryType: { $in: summaryKinds },
                parentArea: primaryScopedParentArea!,
              },
              limit: 10000,
              order: { statId: "asc" as const },
              fields: ["statId", "name", "parentArea", "boundaryType", "date", "type", "count", "sum", "avg", "updatedAt"],
            },
          },
        }
      : null,
  );

  if (isDevEnv() && (fallbackSummariesError || scopedSummariesError)) {
    console.warn("[useStats] statDataSummaries query error", {
      fallbackParentArea,
      primaryScopedParentArea,
      kinds: summaryKinds,
      fallbackSummariesError,
      scopedSummariesError,
    });
  }

  const liveSummaryRows = useMemo(() => {
    const unwrapRows = (resp: any): any[] =>
      Array.isArray(resp?.statDataSummaries)
        ? (resp.statDataSummaries as any[])
        : Array.isArray(resp?.data?.statDataSummaries)
          ? (resp.data.statDataSummaries as any[])
          : [];
    const rows = [...unwrapRows(fallbackSummariesResp), ...unwrapRows(scopedSummariesResp)];
    return rows;
  }, [fallbackSummariesResp, scopedSummariesResp]);

  let liveSummaryRowsMaxUpdatedAt = 0;
  for (const row of liveSummaryRows) {
    const updatedAt = typeof row?.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : 0;
    if (updatedAt > liveSummaryRowsMaxUpdatedAt) liveSummaryRowsMaxUpdatedAt = updatedAt;
  }
  const liveSummaryRowsVersion = `${liveSummaryRows.length}:${liveSummaryRowsMaxUpdatedAt}`;

  const summaryRows = useMemo(() => {
    const persisted = persistedSummaryRowsRef.current;
    if (!persisted.length) return liveSummaryRows;
    // Order matters: live rows appended last so they win when we reduce into Maps below.
    return [...persisted, ...liveSummaryRows];
  }, [liveSummaryRows, persistedSummaryRowsVersion]);

  // Persist live summaries (small) so refresh/new-tab renders sidebar values instantly.
  const summariesPersistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!statDataEnabled) return;
    if (typeof window === "undefined") return;
    if (liveSummaryRows.length === 0) return;

    if (summariesPersistTimeoutRef.current) {
      clearTimeout(summariesPersistTimeoutRef.current);
    }

    summariesPersistTimeoutRef.current = setTimeout(() => {
      const parentsToPersist = new Set<string>();
      parentsToPersist.add(fallbackParentArea);
      if (primaryScopedParentArea) parentsToPersist.add(primaryScopedParentArea);

      const toPersistedRow = (row: any): PersistedStatSummaryRow | null => {
        const statId = typeof row?.statId === "string" ? row.statId : null;
        const name = row?.name === "root" ? ("root" as const) : null;
        const parentArea = normalizeScopeLabel(typeof row?.parentArea === "string" ? row.parentArea : null);
        const boundaryType =
          typeof row?.boundaryType === "string" ? (row.boundaryType as PersistedBoundaryType) : null;
        const date = typeof row?.date === "string" ? row.date : typeof row?.date === "number" ? String(row.date) : null;
        const type = typeof row?.type === "string" ? row.type : null;
        const updatedAt = typeof row?.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : null;
        if (!statId || !name || !parentArea || !boundaryType || !date || !type || updatedAt === null) return null;
        if (!parentsToPersist.has(parentArea)) return null;
        if (!SUPPORTED_AREA_KINDS.includes(boundaryType as SupportedAreaKind)) return null;
        return {
          statId,
          name,
          parentArea,
          boundaryType,
          date,
          type,
          count: typeof row?.count === "number" && Number.isFinite(row.count) ? row.count : 0,
          sum: typeof row?.sum === "number" && Number.isFinite(row.sum) ? row.sum : 0,
          avg: typeof row?.avg === "number" && Number.isFinite(row.avg) ? row.avg : 0,
          min: typeof row?.min === "number" && Number.isFinite(row.min) ? row.min : undefined,
          max: typeof row?.max === "number" && Number.isFinite(row.max) ? row.max : undefined,
          updatedAt,
        };
      };

      const rowsByKey = new Map<string, PersistedStatSummaryRow[]>();
      for (const row of liveSummaryRows) {
        const persisted = toPersistedRow(row);
        if (!persisted) continue;
        const key = `${persisted.parentArea}::${persisted.boundaryType}`;
        const bucket = rowsByKey.get(key) ?? [];
        bucket.push(persisted);
        rowsByKey.set(key, bucket);
      }

      for (const [key, rows] of rowsByKey.entries()) {
        const [parentArea, boundaryType] = key.split("::");
        if (!parentArea || !boundaryType) continue;
        writeStatSummaryCache({
          parentArea,
          boundaryType: boundaryType as PersistedBoundaryType,
          rows,
        }).catch(() => {});
      }
    }, 400);

    return () => {
      if (summariesPersistTimeoutRef.current) {
        clearTimeout(summariesPersistTimeoutRef.current);
      }
    };
  }, [
    liveSummaryRowsVersion,
    statDataEnabled,
    fallbackParentArea,
    primaryScopedParentArea,
    summaryKindsKey,
  ]);

  // Instant can stream large query results and/or mutate arrays in-place.
  // Use a lightweight "version" key so our memo recomputes as rows arrive/refresh.
  let summaryRowsMaxUpdatedAt = 0;
  for (const row of summaryRows) {
    const updatedAt = typeof row?.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : 0;
    if (updatedAt > summaryRowsMaxUpdatedAt) summaryRowsMaxUpdatedAt = updatedAt;
  }
  const summaryRowsVersion = `${summaryRows.length}:${summaryRowsMaxUpdatedAt}`;

  const statDataSummaryByParent = useMemo(() => {
    const map = new Map<string, Map<string, Partial<Record<SupportedAreaKind, any>>>>();

    for (const row of summaryRows) {
      const statId = typeof row?.statId === "string" ? row.statId : null;
      const name = typeof row?.name === "string" ? row.name : null;
      if (!statId || name !== "root") continue;
      const boundaryType = typeof row?.boundaryType === "string" ? (row.boundaryType as SupportedAreaKind) : null;
      if (!boundaryType || !SUPPORTED_AREA_KINDS.includes(boundaryType)) continue;
      const parentArea = normalizeScopeLabel(typeof row?.parentArea === "string" ? row.parentArea : null);
      if (!parentArea) continue;
      const entry = {
        type: getEffectiveStatType(statId, typeof row?.type === "string" ? row.type : "count", statsById),
        date: typeof row?.date === "string" ? row.date : "",
        count: typeof row?.count === "number" && Number.isFinite(row.count) ? row.count : 0,
        sum: typeof row?.sum === "number" && Number.isFinite(row.sum) ? row.sum : 0,
        avg: typeof row?.avg === "number" && Number.isFinite(row.avg) ? row.avg : 0,
        min: typeof row?.min === "number" && Number.isFinite(row.min) ? row.min : 0,
        max: typeof row?.max === "number" && Number.isFinite(row.max) ? row.max : 0,
      };
      const byParent = map.get(statId) ?? new Map<string, Partial<Record<SupportedAreaKind, any>>>();
      const parentEntry = byParent.get(parentArea) ?? {};
      parentEntry[boundaryType] = entry;
      byParent.set(parentArea, parentEntry);
      map.set(statId, byParent);
    }
    return map;
  }, [summaryRowsVersion]);

  // Build time series per stat and area kind (ZIP vs COUNTY for now)
  const seriesByStatIdByKind = useMemo(() => {
    const map = new Map<string, SeriesByKind>();
    if (!effectiveData?.statData) return map;

    for (const row of effectiveData.statData) {
      if (
        typeof row.statId !== "string" ||
        row.name !== "root" ||
        typeof row.boundaryType !== "string"
      ) {
        continue;
      }
      const boundaryType = row.boundaryType as SupportedAreaKind;
      if (!SUPPORTED_AREA_KINDS.includes(boundaryType)) continue;
      const expectedParent = DEFAULT_PARENT_AREA_BY_KIND[boundaryType];
      const normalizedParent = normalizeScopeLabel(typeof row.parentArea === "string" ? row.parentArea : null);
      if (expectedParent && normalizedParent !== normalizeScopeLabel(expectedParent)) continue;
      if (
        (typeof row.date !== "string" && typeof row.date !== "number") ||
        typeof row.type !== "string" ||
        typeof row.data !== "object"
      ) {
        continue;
      }

      const entry: SeriesEntry = {
        date: typeof row.date === "string" ? row.date : String(row.date),
        type: getEffectiveStatType(row.statId, row.type, statsById),
        data: (row.data ?? {}) as Record<string, number>,
        parentArea: typeof row.parentArea === "string" ? (row.parentArea as string) : null,
      };

      const byKind = map.get(row.statId) ?? new Map<SupportedAreaKind, SeriesEntry[]>();
      const bucket = byKind.get(boundaryType) ?? [];
      bucket.push(entry);
      byKind.set(boundaryType, bucket);
      map.set(row.statId, byKind);
    }

    for (const [, byKind] of map) {
      for (const [kind, series] of byKind) {
        series.sort((a, b) => a.date.localeCompare(b.date));
        byKind.set(kind, series);
      }
    }

    return map;
  }, [effectiveData?.statData]);

  // Snapshot the latest statData per boundary type for quick lookup (min/max precomputed)
  const statDataByBoundary = useMemo(() => {
    const map = new Map<string, Partial<Record<SupportedAreaKind, StatBoundaryEntry>>>();
    for (const [statId, byKind] of seriesByStatIdByKind.entries()) {
      const entry: Partial<Record<SupportedAreaKind, StatBoundaryEntry>> = {};
      for (const kind of SUPPORTED_AREA_KINDS) {
        const series = byKind.get(kind);
        if (!series || series.length === 0) continue;
        const latest = series[series.length - 1];
        const values = Object.values(latest.data ?? {}).filter(isFiniteNumber);
        const min = values.length ? Math.min(...values) : 0;
        const max = values.length ? Math.max(...values) : 0;
        entry[kind] = { type: latest.type, data: latest.data ?? {}, min, max };
      }
      if (Object.keys(entry).length > 0) {
        map.set(statId, entry);
      }
    }
    return map;
  }, [seriesByStatIdByKind]);

  const seriesByStatIdByParent = useMemo(() => {
    const map = new Map<string, Map<string, SeriesByKind>>();
    if (!effectiveData?.statData) return map;

    for (const row of effectiveData.statData) {
      if (
        typeof row.statId !== "string" ||
        row.name !== "root" ||
        typeof row.boundaryType !== "string"
      ) {
        continue;
      }
      const boundaryType = row.boundaryType as SupportedAreaKind;
      if (!SUPPORTED_AREA_KINDS.includes(boundaryType)) continue;
      const parentArea = normalizeScopeLabel(typeof row.parentArea === "string" ? row.parentArea : null);
      if (!parentArea) continue;
      if (typeof row.date !== "string" && typeof row.date !== "number") continue;
      if (typeof row.type !== "string" || typeof row.data !== "object") continue;

      const entry: SeriesEntry = {
        date: typeof row.date === "string" ? row.date : String(row.date),
        type: getEffectiveStatType(row.statId, row.type, statsById),
        data: (row.data ?? {}) as Record<string, number>,
        parentArea: row.parentArea as string | null,
      };

      const byParent = map.get(row.statId) ?? new Map<string, SeriesByKind>();
      const byKind = byParent.get(parentArea) ?? new Map<SupportedAreaKind, SeriesEntry[]>();
      const series = byKind.get(boundaryType) ?? [];
      series.push(entry);
      byKind.set(boundaryType, series);
      byParent.set(parentArea, byKind);
      map.set(row.statId, byParent);
    }

    for (const [, byParent] of map) {
      for (const [, byKind] of byParent) {
        for (const [kind, series] of byKind) {
          series.sort((a, b) => a.date.localeCompare(b.date));
          byKind.set(kind, series);
        }
      }
    }

    return map;
  }, [effectiveData?.statData]);

  const statDataByParent = useMemo(() => {
    const latestByKey = new Map<string, { row: any; date: string }>();
    if (!effectiveData?.statData) return new Map<string, Map<string, Partial<Record<SupportedAreaKind, StatBoundaryEntry>>>>();

    for (const row of effectiveData.statData) {
      if (
        typeof row.statId !== "string" ||
        row.name !== "root" ||
        typeof row.boundaryType !== "string"
      ) {
        continue;
      }
      const boundaryType = row.boundaryType as SupportedAreaKind;
      if (!SUPPORTED_AREA_KINDS.includes(boundaryType)) continue;
      const parentArea = normalizeScopeLabel(typeof row.parentArea === "string" ? row.parentArea : null);
      if (!parentArea) continue;
      const date = typeof row.date === "string" ? row.date : typeof row.date === "number" ? String(row.date) : "";
      const key = `${row.statId}::${parentArea}::${boundaryType}`;
      const existing = latestByKey.get(key);
      if (!existing || date.localeCompare(existing.date) >= 0) {
        latestByKey.set(key, { row, date });
      }
    }

    const map = new Map<string, Map<string, Partial<Record<SupportedAreaKind, StatBoundaryEntry>>>>();
    for (const { row } of latestByKey.values()) {
      const statId = row.statId as string;
      const boundaryType = row.boundaryType as SupportedAreaKind;
      const parentArea =
        normalizeScopeLabel(typeof row.parentArea === "string" ? row.parentArea : null) ??
        (boundaryType === "COUNTY"
          ? normalizeScopeLabel(DEFAULT_PARENT_AREA_BY_KIND.COUNTY) ?? "Oklahoma"
          : "Oklahoma");
      const byParent = map.get(statId) ?? new Map<string, Partial<Record<SupportedAreaKind, StatBoundaryEntry>>>();
      const entry = byParent.get(parentArea) ?? {};
      const dataValues = Object.values(row.data ?? {}).filter(isFiniteNumber);
      const min = dataValues.length ? Math.min(...dataValues) : 0;
      const max = dataValues.length ? Math.max(...dataValues) : 0;
      entry[boundaryType] = {
        type: getEffectiveStatType(statId, typeof row.type === "string" ? row.type : "count", statsById),
        data: (row.data ?? {}) as Record<string, number>,
        min,
        max,
      };
      byParent.set(parentArea, entry);
      map.set(statId, byParent);
    }

    return map;
  }, [effectiveData?.statData]);

  // Maintain ZIP-first view for existing consumers while the rest of the app migrates to by-kind lookups.
  const legacySeriesByStatId = useMemo(() => {
    const map = new Map<string, SeriesEntry[]>();
    for (const [statId, byKind] of seriesByStatIdByKind.entries()) {
      const zipSeries = byKind.get("ZIP");
      if (zipSeries && zipSeries.length > 0) {
        map.set(statId, zipSeries);
        continue;
      }
      const countySeries = byKind.get("COUNTY");
      if (countySeries && countySeries.length > 0) {
        map.set(statId, countySeries);
      }
    }
    return map;
  }, [seriesByStatIdByKind]);

  // Build parent/child relationships for stats
  const { statRelationsByParent, statRelationsByChild } = useMemo(() => {
    const byParent: StatRelationsByParent = new Map();
    const byChild: StatRelationsByChild = new Map();
    if (!effectiveData?.statRelations) {
      return { statRelationsByParent: byParent, statRelationsByChild: byChild };
    }

    const seenKeys = new Set<string>();

    const getRelationKey = (parentStatId: string, childStatId: string, statAttribute: string, rawKey?: string) => {
      const normalizedAttribute = statAttribute.trim();
      if (rawKey && typeof rawKey === "string" && rawKey.trim()) return rawKey;
      return `${parentStatId}::${childStatId}::${normalizedAttribute}`;
    };

    for (const row of effectiveData.statRelations as StatRelation[]) {
      if (
        !row ||
        typeof row.id !== "string" ||
        typeof row.parentStatId !== "string" ||
        typeof row.childStatId !== "string" ||
        typeof row.statAttribute !== "string"
      ) {
        continue;
      }

      const parentStatId = row.parentStatId;
      const childStatId = row.childStatId;
      const statAttribute = row.statAttribute.trim();
      if (!statAttribute) continue;

      // Skip relations that refer to missing parents or children (keeps maps coherent)
      if (!statsById.has(parentStatId)) continue;
      const child = statsById.get(childStatId) ?? null;

      const relationKey = getRelationKey(parentStatId, childStatId, statAttribute, row.relationKey);
      if (seenKeys.has(relationKey)) continue;
      seenKeys.add(relationKey);

      const relation: StatRelation & { child: Stat | null } = {
        id: row.id,
        relationKey,
        parentStatId,
        childStatId,
        statAttribute,
        sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : null,
        createdAt: typeof row.createdAt === "number" ? row.createdAt : null,
        updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : null,
        child,
      };

      const byAttribute =
        byParent.get(parentStatId) ?? new Map<string, Array<StatRelation & { child: Stat | null }>>();
      const list = byAttribute.get(statAttribute) ?? [];
      list.push(relation);
      byAttribute.set(statAttribute, list);
      byParent.set(parentStatId, byAttribute);

      const childList = byChild.get(childStatId) ?? [];
      childList.push({
        id: relation.id,
        relationKey: relation.relationKey,
        parentStatId: relation.parentStatId,
        childStatId: relation.childStatId,
        statAttribute: relation.statAttribute,
        sortOrder: relation.sortOrder,
        createdAt: relation.createdAt,
        updatedAt: relation.updatedAt,
      });
      byChild.set(childStatId, childList);
    }

    // Sort children within each attribute by sortOrder then label/name
    const sortRelations = (relations: Array<StatRelation & { child: Stat | null }>) => {
      const safeLabel = (stat: Stat | null): string => {
        if (!stat) return "";
        return (stat.label || stat.name || "").toLowerCase();
      };
      relations.sort((a, b) => {
        const aOrder = a.sortOrder ?? null;
        const bOrder = b.sortOrder ?? null;
        if (aOrder !== null && bOrder !== null && aOrder !== bOrder) return aOrder - bOrder;
        if (aOrder !== null && bOrder === null) return -1;
        if (aOrder === null && bOrder !== null) return 1;
        const attrCompare = a.statAttribute.localeCompare(b.statAttribute);
        if (attrCompare !== 0) return attrCompare;
        const labelCompare = safeLabel(a.child).localeCompare(safeLabel(b.child));
        if (labelCompare !== 0) return labelCompare;
        return a.relationKey.localeCompare(b.relationKey);
      });
    };

    for (const [, attributeMap] of byParent) {
      for (const [, relations] of attributeMap) {
        sortRelations(relations);
      }
    }

    // Sort parent lists for children
    for (const [, relations] of byChild) {
      relations.sort((a, b) => {
        const aOrder = a.sortOrder ?? null;
        const bOrder = b.sortOrder ?? null;
        if (aOrder !== null && bOrder !== null && aOrder !== bOrder) return aOrder - bOrder;
        if (aOrder !== null && bOrder === null) return -1;
        if (aOrder === null && bOrder !== null) return 1;
        return a.statAttribute.localeCompare(b.statAttribute);
      });
    }

    if (isDevEnv() && byParent.size > 0) {
      console.debug("[useStats] statRelationsByParent ready", {
        parents: byParent.size,
        children: byChild.size,
      });
    }

    return { statRelationsByParent: byParent, statRelationsByChild: byChild };
  }, [effectiveData?.statRelations, statsById]);

  return {
    statsById,
    seriesByStatId: legacySeriesByStatId,
    seriesByStatIdByKind,
    seriesByStatIdByParent,
    statDataByBoundary,
    statDataByParent,
    statDataSummaryByParent,
    statRelationsByParent,
    statRelationsByChild,
    isLoading,
    error,
  };
};
