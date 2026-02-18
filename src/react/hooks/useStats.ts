import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { buildEffectiveStatMetaById, isStatVisibleOnMap, normalizeStatVisibility } from "../../types/stat";
import type { Category } from "../../types/organization";
import type { AreaKind } from "../../types/areas";
import { DEFAULT_PARENT_AREA_BY_KIND } from "../../types/areas";
import { normalizeScopeLabel } from "../../lib/scopeLabels";
import { isDevEnv } from "../../lib/env";

type SupportedAreaKind = Extract<AreaKind, "ZIP" | "COUNTY">;

const STAT_DATA_CACHE_TTL_MS = PERSISTED_STAT_CACHE_TTL_MS;
const STAT_DATA_DERIVE_DEBOUNCE_MS = 250;
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

const getContextSet = (
  map: Map<string, Set<string>>,
  contextKey: string,
): Set<string> => map.get(contextKey) ?? new Set<string>();

const addIdsToContext = (
  prev: Map<string, Set<string>>,
  contextKey: string,
  ids: Iterable<string>,
): Map<string, Set<string>> => {
  const existing = prev.get(contextKey) ?? new Set<string>();
  const nextSet = new Set(existing);
  let changed = false;
  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0) continue;
    if (!nextSet.has(id)) {
      nextSet.add(id);
      changed = true;
    }
  }
  if (!changed) return prev;
  const next = new Map(prev);
  next.set(contextKey, nextSet);
  return next;
};

const removeIdsFromContext = (
  prev: Map<string, Set<string>>,
  contextKey: string,
  ids: Iterable<string>,
): Map<string, Set<string>> => {
  const existing = prev.get(contextKey);
  if (!existing || existing.size === 0) return prev;
  const removeSet = new Set<string>();
  for (const id of ids) {
    if (typeof id === "string" && id.length > 0) removeSet.add(id);
  }
  if (removeSet.size === 0) return prev;
  let changed = false;
  const nextSet = new Set(existing);
  for (const id of removeSet) {
    if (nextSet.delete(id)) changed = true;
  }
  if (!changed) return prev;
  const next = new Map(prev);
  if (nextSet.size === 0) next.delete(contextKey);
  else next.set(contextKey, nextSet);
  return next;
};

const removeIdsFromAllContexts = (
  prev: Map<string, Set<string>>,
  ids: Iterable<string>,
): Map<string, Set<string>> => {
  const removeSet = new Set<string>();
  for (const id of ids) {
    if (typeof id === "string" && id.length > 0) removeSet.add(id);
  }
  if (removeSet.size === 0 || prev.size === 0) return prev;

  let changed = false;
  const next = new Map<string, Set<string>>();
  for (const [contextKey, contextIds] of prev.entries()) {
    const nextSet = new Set(contextIds);
    for (const id of removeSet) {
      if (nextSet.delete(id)) changed = true;
    }
    if (nextSet.size > 0) next.set(contextKey, nextSet);
  }
  return changed ? next : prev;
};

interface UseStatsOptions {
  statDataEnabled?: boolean;
  statMapsEnabled?: boolean;
  enableTimeSeries?: boolean;
  priorityStatIds?: string[];
  categoryFilter?: string | null;
  zipScopes?: string[];
  countyScopes?: string[];
  summaryKinds?: SupportedAreaKind[];
  initialBatchSize?: number;
  batchSize?: number;
  enableTrickle?: boolean;
  maxCachedStatIds?: number;
  limitStatDataToScopes?: boolean;
  trickleDelayMs?: number;
  statDataBoundaryTypes?: SupportedAreaKind[];
  viewerId?: string | null;
  isAdmin?: boolean;
}

export const useStats = ({
  statDataEnabled = true,
  statMapsEnabled = true,
  enableTimeSeries = true,
  priorityStatIds = [],
  categoryFilter = null,
  zipScopes = [],
  countyScopes = [],
  summaryKinds = SUPPORTED_AREA_KINDS,
  initialBatchSize = 12,
  batchSize = 12,
  enableTrickle = true,
  maxCachedStatIds = 24,
  trickleDelayMs = 0,
  limitStatDataToScopes = false,
  statDataBoundaryTypes,
  viewerId = null,
  isAdmin = false,
}: UseStatsOptions = {}) => {
  const { authReady } = useAuthSession();
  const queryEnabled = authReady;
  const statMapsActive = statDataEnabled && statMapsEnabled;
  const timeSeriesEnabled = statMapsActive && enableTimeSeries;

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
  const cachedStatKeysByStatIdRef = useRef<Map<string, Set<string>>>(new Map());
  const cachedStatLastAccessRef = useRef<Map<string, number>>(new Map());
  const [statDataCacheVersion, setStatDataCacheVersion] = useState(0);
  const [statDataSnapshotVersion, setStatDataSnapshotVersion] = useState(0);
  const [statDataDateFilter, setStatDataDateFilter] = useState<string[] | null>(null);
  const [loadedStatIds, setLoadedStatIds] = useState<Set<string>>(new Set());
  const [completedStatIdsByContext, setCompletedStatIdsByContext] = useState<
    Map<string, Set<string>>
  >(new Map());
  const [emptyStatIdsByContext, setEmptyStatIdsByContext] = useState<Map<string, Set<string>>>(
    new Map(),
  );
  const [batchGeneration, setBatchGeneration] = useState(0);

  // Trickle delay: after each batch completes, pause before fetching the next one
  // to avoid overwhelming InstantDB with rapid sequential queries.
  const [trickleReady, setTrickleReady] = useState(true);
  const trickleDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (trickleDelayTimerRef.current) clearTimeout(trickleDelayTimerRef.current);
    };
  }, []);

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
    if (!statMapsActive) return;
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
  }, [lastStatDataAt, statMapsActive, statDataRefreshRequested]);

  const statDataSnapshotTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!statDataEnabled) return;
    if (statDataSnapshotTimeoutRef.current) {
      clearTimeout(statDataSnapshotTimeoutRef.current);
    }
    const targetVersion = statDataCacheVersion;
    statDataSnapshotTimeoutRef.current = setTimeout(() => {
      setStatDataSnapshotVersion(targetVersion);
    }, STAT_DATA_DERIVE_DEBOUNCE_MS);
    return () => {
      if (statDataSnapshotTimeoutRef.current) {
        clearTimeout(statDataSnapshotTimeoutRef.current);
      }
    };
  }, [statDataCacheVersion, statDataEnabled]);

  const statsRows: any[] | undefined = Array.isArray(statsResp?.stats)
    ? statsResp.stats
    : cachedStatsRef.current;
  const statRelationsRows: any[] | undefined = Array.isArray(statsResp?.statRelations)
    ? statsResp.statRelations
    : cachedStatRelationsRef.current;

  const allStatsById = useMemo(() => {
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
          visibility: normalizeStatVisibility(row.visibility) ?? undefined,
          visibilityEffective: normalizeStatVisibility(row.visibilityEffective) ?? undefined,
          createdBy: typeof row.createdBy === "string" ? row.createdBy : undefined,
          type: typeof row.type === "string" ? row.type : undefined,
        });
      }
    }
    return map;
  }, [statsRows]);

  const parentsByChild = useMemo(() => {
    const map = new Map<string, string[]>();
    if (!Array.isArray(statRelationsRows)) return map;
    for (const row of statRelationsRows) {
      const parentId = typeof row?.parentStatId === "string" ? row.parentStatId : null;
      const childId = typeof row?.childStatId === "string" ? row.childStatId : null;
      if (!parentId || !childId) continue;
      const list = map.get(childId) ?? [];
      list.push(parentId);
      map.set(childId, list);
    }
    return map;
  }, [statRelationsRows]);

  const effectiveMetaById = useMemo(
    () => buildEffectiveStatMetaById(allStatsById, parentsByChild),
    [allStatsById, parentsByChild],
  );

  const statsById = useMemo(() => {
    const map = new Map<string, Stat>();
    for (const [id, stat] of allStatsById.entries()) {
      const meta = effectiveMetaById.get(id);
      if (!meta) continue;
      if (!isStatVisibleOnMap(meta, { isAdmin, viewerId })) continue;
      map.set(id, stat);
    }
    return map;
  }, [allStatsById, effectiveMetaById, isAdmin, viewerId]);

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
      if (!statsById.has(parentId)) continue;
      if (!statsById.has(childId)) continue;
      const list = map.get(parentId) ?? [];
      list.push(childId);
      map.set(parentId, list);
    }
    return map;
  }, [statRelationsRows, statsById]);

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

  const priorityIds = useMemo(() => {
    const unique = new Set<string>();
    for (const id of priorityStatIds) {
      if (typeof id !== "string") continue;
      const trimmed = id.trim();
      if (!trimmed) continue;
      if (!statsById.has(trimmed)) continue;
      unique.add(trimmed);
    }
    return Array.from(unique);
  }, [priorityStatIds, statsById]);

  useEffect(() => {
    if (priorityIds.length === 0) return;
    const now = Date.now();
    for (const statId of priorityIds) {
      cachedStatLastAccessRef.current.set(statId, now);
    }
  }, [priorityIds]);

  const enforceStatCacheLimit = ({
    maxStatIds,
    protectedStatIds,
  }: {
    maxStatIds: number;
    protectedStatIds: Set<string>;
  }): string[] => {
    if (maxStatIds <= 0) return [];
    const keysByStat = cachedStatKeysByStatIdRef.current;
    const effectiveMax = Math.max(maxStatIds, protectedStatIds.size);
    if (keysByStat.size <= effectiveMax) return [];

    const lastAccess = cachedStatLastAccessRef.current;
    const candidates: Array<{ statId: string; lastAccess: number }> = [];
    for (const statId of keysByStat.keys()) {
      if (protectedStatIds.has(statId)) continue;
      candidates.push({ statId, lastAccess: lastAccess.get(statId) ?? 0 });
    }
    candidates.sort((a, b) => a.lastAccess - b.lastAccess);

    const evicted: string[] = [];
    let currentSize = keysByStat.size;
    for (const candidate of candidates) {
      if (currentSize <= effectiveMax) break;
      const keys = keysByStat.get(candidate.statId);
      if (!keys) continue;
      for (const key of keys) {
        cachedStatDataByKeyRef.current.delete(key);
      }
      keysByStat.delete(candidate.statId);
      lastAccess.delete(candidate.statId);
      evicted.push(candidate.statId);
      currentSize -= 1;
    }
    return evicted;
  };

  const orderedStatIds = useMemo(() => {
    const stats = Array.from(statsById.values());
    stats.sort((a, b) => NAME_FOR_SORT(a).localeCompare(NAME_FOR_SORT(b)));
    if (!categoryFilter) return stats.map((s) => s.id);
    const preferred = stats.filter((s) => s.category === categoryFilter);
    const rest = stats.filter((s) => s.category !== categoryFilter);
    return [...preferred, ...rest].map((s) => s.id);
  }, [statsById, categoryFilter]);

  const statDataScopeParents = useMemo(() => {
    if (!limitStatDataToScopes) return null;
    const set = new Set<string>();
    const add = (value: string | null | undefined) => {
      const normalized = normalizeScopeLabel(value ?? null);
      if (normalized) set.add(normalized);
    };
    add(DEFAULT_PARENT_AREA_BY_KIND.ZIP ?? "Oklahoma");
    add(DEFAULT_PARENT_AREA_BY_KIND.COUNTY ?? "Oklahoma");
    add(zipScopes[0]);
    add(countyScopes[0]);
    return Array.from(set);
  }, [limitStatDataToScopes, zipScopes, countyScopes]);

  const statDataDateKey = timeSeriesEnabled
    ? "series"
    : statDataDateFilter && statDataDateFilter.length > 0
      ? statDataDateFilter.join("|")
      : "";

  const statDataScopeParentsKey = useMemo(() => {
    if (!statDataScopeParents || statDataScopeParents.length === 0) return "*";
    return [...statDataScopeParents].sort().join("|");
  }, [statDataScopeParents]);

  const statDataBoundaryTypesKey = useMemo(() => {
    if (!statDataBoundaryTypes || statDataBoundaryTypes.length === 0) return "*";
    return [...statDataBoundaryTypes].sort().join("|");
  }, [statDataBoundaryTypes]);

  // Keep request completion state scoped to filters that can change result shape.
  const queryContextKey = useMemo(
    () =>
      [
        `mode:${timeSeriesEnabled ? "series" : "snapshot"}`,
        `date:${statDataDateKey || "*"}`,
        `parents:${statDataScopeParentsKey}`,
        `boundaries:${statDataBoundaryTypesKey}`,
      ].join("::"),
    [timeSeriesEnabled, statDataDateKey, statDataScopeParentsKey, statDataBoundaryTypesKey],
  );

  const completedStatIdsForContext = useMemo(
    () => getContextSet(completedStatIdsByContext, queryContextKey),
    [completedStatIdsByContext, queryContextKey],
  );
  const emptyStatIdsForContext = useMemo(
    () => getContextSet(emptyStatIdsByContext, queryContextKey),
    [emptyStatIdsByContext, queryContextKey],
  );

  const batchIds = useMemo(() => {
    if (!statDataEnabled) return [];
    const batch: string[] = [];
    const seen = new Set<string>();
    const loaded = loadedStatIds;
    const desired = (loaded.size === 0 ? initialBatchSize : batchSize) + priorityIds.length;
    const add = (id?: string | null) => {
      if (!id || typeof id !== "string") return;
      if (
        loaded.has(id) ||
        completedStatIdsForContext.has(id) ||
        emptyStatIdsForContext.has(id) ||
        seen.has(id)
      ) {
        return;
      }
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

    // Priority IDs always included — selected stat + its children render immediately.
    for (const id of priorityIds) addWithChildren(id, 0);

    // Skip trickle when delay is active — only priority IDs fetched until timer expires.
    if (!trickleReady) return batch;

    for (const id of orderedStatIds) {
      if (!enableTrickle && batch.length >= Math.max(priorityIds.length, initialBatchSize)) break;
      if (batch.length >= Math.max(priorityIds.length, desired)) break;
      addWithChildren(id, 1);
    }
    return batch;
  }, [
    statDataEnabled,
    loadedStatIds,
    completedStatIdsForContext,
    emptyStatIdsForContext,
    priorityIds,
    orderedStatIds,
    initialBatchSize,
    batchSize,
    enableTrickle,
    trickleReady,
    batchGeneration,
    childrenByParent,
  ]);

  const shouldIncludeStatData =
    statMapsActive &&
    (batchIds.length > 0 || statDataRefreshRequested || lastStatDataAt === null);
  const canQueryStatData =
    shouldIncludeStatData &&
    (timeSeriesEnabled || (statDataDateFilter && statDataDateFilter.length > 0));

  const {
    data: statDataResp,
    isLoading: statDataLoading,
    error: statDataError,
  } = db.useQuery(
    queryEnabled && canQueryStatData && batchIds.length > 0
      ? {
          statData: {
            $: {
              where: {
                name: "root",
                statId: { $in: batchIds },
                ...(statDataScopeParents && statDataScopeParents.length > 0
                  ? { parentArea: { $in: statDataScopeParents } }
                  : {}),
                ...(statDataBoundaryTypes && statDataBoundaryTypes.length > 0
                  ? { boundaryType: { $in: statDataBoundaryTypes } }
                  : {}),
                ...(!timeSeriesEnabled && statDataDateFilter && statDataDateFilter.length > 0
                  ? { date: { $in: statDataDateFilter } }
                  : {}),
              },
              fields: ["statId", "name", "parentArea", "boundaryType", "date", "type", "data"],
              order: { date: "asc" as const },
            },
          },
        }
      : null,
  );

  const lastRequestedBatchKeyRef = useRef<string>("");
  const lastRequestedBatchIdsRef = useRef<string[]>([]);
  const lastRequestedContextKeyRef = useRef<string>("");
  useEffect(() => {
    if (!queryEnabled || !canQueryStatData || batchIds.length === 0) return;
    lastRequestedBatchKeyRef.current = `${batchGeneration}::${queryContextKey}::${batchIds.join("|")}`;
    lastRequestedBatchIdsRef.current = batchIds;
    lastRequestedContextKeyRef.current = queryContextKey;
  }, [batchGeneration, batchIds, canQueryStatData, queryEnabled, queryContextKey]);

  const processedBatchKeyRef = useRef<string>("");
  useEffect(() => {
    if (statDataLoading) return;
    if (!queryEnabled || !canQueryStatData) return;
    const batchKey = lastRequestedBatchKeyRef.current;
    if (!batchKey) return;
    if (processedBatchKeyRef.current === batchKey) return;
    processedBatchKeyRef.current = batchKey;

    const rows = Array.isArray(statDataResp?.statData) ? (statDataResp.statData as any[]) : [];
    const requested = lastRequestedBatchIdsRef.current;
    const contextKey = lastRequestedContextKeyRef.current || queryContextKey;
    const completedIds = new Set<string>();
    let cacheChanged = false;
    const now = Date.now();
    for (const row of rows) {
      const key = statDataRowKey(row);
      if (!key) continue;
      if (typeof row?.statId === "string") completedIds.add(row.statId);
      cachedStatDataByKeyRef.current.set(key, row);
      const statId = typeof row?.statId === "string" ? row.statId : null;
      if (statId) {
        let keys = cachedStatKeysByStatIdRef.current.get(statId);
        if (!keys) {
          keys = new Set();
          cachedStatKeysByStatIdRef.current.set(statId, keys);
        }
        keys.add(key);
        cachedStatLastAccessRef.current.set(statId, now);
      }
      cacheChanged = true;
    }
    if (cacheChanged) {
      setStatDataCacheVersion((v) => v + 1);
      setLastStatDataAt(now);
    }

    const emptyRequestedIds = requested.filter((id) => !completedIds.has(id));
    if (completedIds.size > 0) {
      setCompletedStatIdsByContext((prev) => addIdsToContext(prev, contextKey, completedIds));
    }
    setEmptyStatIdsByContext((prev) => {
      let next = prev;
      if (completedIds.size > 0) next = removeIdsFromContext(next, contextKey, completedIds);
      if (emptyRequestedIds.length > 0) next = addIdsToContext(next, contextKey, emptyRequestedIds);
      return next;
    });

    setLoadedStatIds((prev) => {
      const next = new Set(prev);
      for (const statId of completedIds) next.add(statId);
      return next;
    });

    // After a batch completes, pause before allowing the next trickle batch.
    if (trickleDelayMs > 0 && enableTrickle) {
      setTrickleReady(false);
      if (trickleDelayTimerRef.current) clearTimeout(trickleDelayTimerRef.current);
      trickleDelayTimerRef.current = setTimeout(() => setTrickleReady(true), trickleDelayMs);
    }

    // Only evict when trickle loading is active (cache is actively growing).
    // When trickle is paused, only priority stats are fetched so the cache is
    // ~stable. Evicting here would thrash recently viewed stats (A evicts B,
    // switching back to B evicts A) and the resulting re-fetch cycle can hit
    // React's "Maximum update depth exceeded" limit.
    if (enableTrickle) {
      const evicted = enforceStatCacheLimit({
        maxStatIds: maxCachedStatIds,
        protectedStatIds: new Set(priorityIds),
      });
      if (evicted.length > 0) {
        setCompletedStatIdsByContext((prev) => removeIdsFromAllContexts(prev, evicted));
        setEmptyStatIdsByContext((prev) => removeIdsFromAllContexts(prev, evicted));
        setLoadedStatIds((prev) => {
          const next = new Set(prev);
          for (const statId of evicted) next.delete(statId);
          return next;
        });
        if (!cacheChanged) {
          setStatDataCacheVersion((v) => v + 1);
        }
      }
    }

    if (statDataRefreshRequested) {
      setStatDataRefreshRequested(false);
    }
  }, [
    canQueryStatData,
    queryEnabled,
    statDataLoading,
    statDataResp,
    statDataRefreshRequested,
    maxCachedStatIds,
    priorityIds,
    enableTrickle,
    trickleDelayMs,
    queryContextKey,
  ]);

  const cachedStatDataRows = useMemo(
    () => Array.from(cachedStatDataByKeyRef.current.values()),
    [statDataSnapshotVersion],
  );

  const statDataRows = useMemo(() => {
    if (!statMapsActive) return [];
    if (cachedStatDataRows.length > 0) return cachedStatDataRows;
    return Array.isArray(statDataResp?.statData) ? (statDataResp.statData as any[]) : [];
  }, [cachedStatDataRows, statDataResp?.statData, statMapsActive]);

  const effectiveData = {
    stats: statsRows,
    statRelations: statRelationsRows,
    statData: statDataRows,
  };

  const pendingStatIds = useMemo(() => {
    if (!canQueryStatData || batchIds.length === 0) return new Set<string>();
    const pending = new Set<string>();
    for (const statId of batchIds) {
      if (completedStatIdsForContext.has(statId) || emptyStatIdsForContext.has(statId)) continue;
      pending.add(statId);
    }
    return pending;
  }, [batchIds, canQueryStatData, completedStatIdsForContext, emptyStatIdsForContext]);

  const isLoading = statsLoading || statDataLoading;
  const error = statsError || statDataError;

  const retryStatData = useCallback(
    (statId?: string | null) => {
      if (!statDataEnabled) return;
      if (!statId || typeof statId !== "string") return;

      const keys = cachedStatKeysByStatIdRef.current.get(statId);
      if (keys) {
        for (const key of keys) {
          cachedStatDataByKeyRef.current.delete(key);
        }
        cachedStatKeysByStatIdRef.current.delete(statId);
      }
      cachedStatLastAccessRef.current.delete(statId);
      setCompletedStatIdsByContext((prev) => removeIdsFromAllContexts(prev, [statId]));
      setEmptyStatIdsByContext((prev) => removeIdsFromAllContexts(prev, [statId]));
      setLoadedStatIds((prev) => {
        if (!prev.has(statId)) return prev;
        const next = new Set(prev);
        next.delete(statId);
        return next;
      });
      setStatDataCacheVersion((v) => v + 1);
      setStatDataRefreshRequested(true);
      setBatchGeneration((prev) => prev + 1);
    },
    [statDataEnabled],
  );

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

  useEffect(() => {
    if (timeSeriesEnabled) {
      setStatDataDateFilter((prev) => (prev === null ? prev : null));
      return;
    }
    if (!statMapsActive) return;
    if (batchIds.length === 0) {
      setStatDataDateFilter((prev) => (prev !== null && prev.length === 0 ? prev : []));
      return;
    }
    const desiredStatIds = new Set(batchIds);
    const allowedParents = statDataScopeParents ? new Set(statDataScopeParents) : null;
    const allowedBoundaries =
      statDataBoundaryTypes && statDataBoundaryTypes.length > 0
        ? new Set(statDataBoundaryTypes)
        : null;
    const nextDates = new Set<string>();
    for (const row of summaryRows) {
      const statId = typeof row?.statId === "string" ? row.statId : null;
      if (!statId || !desiredStatIds.has(statId)) continue;
      const boundaryType = typeof row?.boundaryType === "string" ? (row.boundaryType as SupportedAreaKind) : null;
      if (!boundaryType || (allowedBoundaries && !allowedBoundaries.has(boundaryType))) continue;
      const parentArea = normalizeScopeLabel(typeof row?.parentArea === "string" ? row.parentArea : null);
      if (!parentArea || (allowedParents && !allowedParents.has(parentArea))) continue;
      const date = typeof row?.date === "string" ? row.date : typeof row?.date === "number" ? String(row.date) : null;
      if (!date) continue;
      nextDates.add(date);
    }
    const next = Array.from(nextDates).sort();
    setStatDataDateFilter((prev) => {
      if (!prev || prev.length !== next.length) return next;
      for (let i = 0; i < prev.length; i += 1) {
        if (prev[i] !== next[i]) return next;
      }
      return prev;
    });
  }, [
    batchIds,
    statDataBoundaryTypes,
    statDataScopeParents,
    statMapsActive,
    summaryRowsVersion,
    timeSeriesEnabled,
  ]);

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
    if (!timeSeriesEnabled || !effectiveData?.statData) return map;

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
  }, [effectiveData?.statData, timeSeriesEnabled]);

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
    if (!timeSeriesEnabled || !effectiveData?.statData) return map;

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
  }, [effectiveData?.statData, timeSeriesEnabled]);

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
    pendingStatIds,
    isLoading,
    error,
    retryStatData,
  };
};
