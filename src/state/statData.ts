import { db } from "../lib/db";
import { formatCountyScopeLabel, normalizeScopeLabel } from "../lib/scopeLabels";
import type { StatData } from "../types/statData";
import type { AreaKind } from "../types/areas";
import {
  acquireCacheLock,
  DEFAULT_STAT_MAP_LRU_LIMIT,
  PERSISTED_STAT_CACHE_TTL_MS,
  readStatMapCache,
  subscribeToCacheEvents,
  writeStatMapCache,
  type PersistedStatMapCache,
  type StatBoundaryType as PersistedBoundaryType,
} from "../lib/persistentStatsCache";

type BoundaryStatEntry = {
  id: string;
  statId: string;
  name: string;
  parentArea: string;
  boundaryType: string;
  date: string;
  type: string;
  data: Record<string, number>;
  min: number;
  max: number;
};

type BoundaryTypeKey = Extract<AreaKind, "ZIP" | "COUNTY">;

type ParentAreaKey = string;

type StatDataMapEntry = Partial<Record<BoundaryTypeKey, BoundaryStatEntry>>;

export type StatDataByParentArea = Map<ParentAreaKey, StatDataMapEntry>;

type Listener = (byStatId: Map<string, StatDataByParentArea>) => void;

const normalizeBoundaryType = (value: unknown): BoundaryTypeKey | null => {
  if (value === "ZIP") return "ZIP";
  if (value === "COUNTY") return "COUNTY";
  return null;
};

const normalizeParentAreaKeys = (value: unknown): string[] => {
  const normalized = normalizeScopeLabel(typeof value === "string" ? value : null);
  if (!normalized) return [];
  // "Oklahoma" is our statewide bucket; don't auto-alias to "Oklahoma County".
  if (normalized === "Oklahoma") return ["Oklahoma"];

  const keys = new Set<string>();
  keys.add(normalized);

  // If we already have a county label, also include a base label (without suffix)
  // so we can match older statData rows that used "Tulsa" instead of "Tulsa County".
  if (/\s+County$/i.test(normalized)) {
    const base = normalizeScopeLabel(normalized.replace(/\s+County$/i, ""));
    if (base) keys.add(base);
    return Array.from(keys);
  }

  // If it's not a county label, include the "County" formatted alias too.
  const county = formatCountyScopeLabel(normalized);
  if (county && county !== "Oklahoma County") keys.add(county);
  return Array.from(keys);
};

const expandScopeParentAreasForQuery = (parentAreas: string[]): string[] => {
  const out = new Set<string>();
  for (const value of parentAreas) {
    for (const key of normalizeParentAreaKeys(value)) out.add(key);
  }
  return Array.from(out);
};

const statMapKey = (statId: string, parentArea: string, boundaryType: BoundaryTypeKey) =>
  `${statId}::${parentArea}::${boundaryType}`;

class StatDataStore {
  private listeners = new Set<Listener>();
  private byStatId: Map<string, StatDataByParentArea> = new Map();
  private enabled = true;
  private priorityStatIds: string[] = [];
  private prefetchStatIds: string[] = [];
  private scopeParentAreas: string[] = [];
  private refreshTimeout: ReturnType<typeof setTimeout> | null = null;
  private scheduledTtlTimeout: ReturnType<typeof setTimeout> | null = null;
  private inflightRefresh: Promise<void> | null = null;
  private queuedRefreshForce = false;
  private refreshQueued = false;
  private hydratedKeys = new Set<string>();
  private metaByKey = new Map<
    string,
    { date: string; summaryUpdatedAt: number | null; savedAt: number }
  >();
  private unsubscribeCacheEvents: (() => void) | null = null;
  private focusHydratePromise: Promise<void> | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.byStatId);
    this.initialize();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.teardown();
    };
  }

  private initialize() {
    if (!this.enabled) return;
    if (!this.unsubscribeCacheEvents) {
      this.unsubscribeCacheEvents = subscribeToCacheEvents((event) => {
        if (event.type === "cleared") {
          this.byStatId = new Map();
          this.hydratedKeys.clear();
          this.metaByKey.clear();
          this.emit();
          this.scheduleRefresh({ force: true });
          return;
        }
        if (event.type === "updated" && event.store === "statMaps") {
          const parts = String(event.key).split(":");
          // key format: v{n}:statMap:{statId}:{parentArea}:{boundaryType}
          if (parts.length >= 5 && parts[1] === "statMap") {
            const statId = parts[2];
            const parentArea = parts[3];
            const boundaryType = normalizeBoundaryType(parts[4]);
            if (statId && parentArea && boundaryType) {
              const metaKey = statMapKey(statId, parentArea, boundaryType);
              this.hydratedKeys.delete(metaKey);
              // If this tab is currently focused on this stat/scope, rehydrate immediately.
              const isFocused =
                (this.priorityStatIds.includes(statId) || this.prefetchStatIds.includes(statId)) &&
                this.getExpandedParentAreas().includes(parentArea);
              if (isFocused) {
                this.hydrateFromCache([{ statId, parentArea, boundaryType }]).catch(() => {});
              }
            }
          }
        }
      });
    }
    this.scheduleRefresh({ force: false });
  }

  private teardown() {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
    if (this.scheduledTtlTimeout) {
      clearTimeout(this.scheduledTtlTimeout);
      this.scheduledTtlTimeout = null;
    }
    if (this.unsubscribeCacheEvents) {
      this.unsubscribeCacheEvents();
      this.unsubscribeCacheEvents = null;
    }
  }

  private emit() {
    this.listeners.forEach((l) => l(this.byStatId));
  }

  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.teardown();
    } else if (this.listeners.size > 0) {
      this.initialize();
    }
  }

  // MapLibre uses this store for choropleth layers. Keep the store focused by
  // only fetching heavy per-area maps for the currently-selected stat(s) and
  // current scope parent areas.
  setPriorityStatIds(statIds: string[]) {
    const next = Array.from(
      new Set(
        (Array.isArray(statIds) ? statIds : [])
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
      ),
    );
    const changed =
      next.length !== this.priorityStatIds.length ||
      next.some((id, idx) => id !== this.priorityStatIds[idx]);
    if (!changed) return;
    this.priorityStatIds = next;
    this.hydrateFocusFromCache().catch(() => {});
    this.scheduleRefresh({ force: false });
  }

  setPrefetchStatIds(statIds: string[]) {
    const next = Array.from(
      new Set(
        (Array.isArray(statIds) ? statIds : [])
          .filter((id): id is string => typeof id === "string" && id.trim().length > 0),
      ),
    ).slice(0, 8);
    const changed =
      next.length !== this.prefetchStatIds.length ||
      next.some((id, idx) => id !== this.prefetchStatIds[idx]);
    if (!changed) return;
    this.prefetchStatIds = next;
    this.hydrateFocusFromCache().catch(() => {});
    this.scheduleRefresh({ force: false });
  }

  setScopeParentAreas(parentAreas: string[]) {
    const next = Array.from(
      new Set(
        (Array.isArray(parentAreas) ? parentAreas : [])
          .map((label) => normalizeScopeLabel(label))
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    );
    const changed =
      next.length !== this.scopeParentAreas.length ||
      next.some((value, idx) => value !== this.scopeParentAreas[idx]);
    if (!changed) return;
    this.scopeParentAreas = next;
    this.hydrateFocusFromCache().catch(() => {});
    this.scheduleRefresh({ force: false });
  }

  private scheduleRefresh({ force }: { force: boolean }) {
    if (!this.enabled) return;
    if (this.listeners.size === 0) return;

    if (this.inflightRefresh) {
      this.refreshQueued = true;
      this.queuedRefreshForce = this.queuedRefreshForce || force;
      return;
    }

    if (this.refreshTimeout) clearTimeout(this.refreshTimeout);
    this.refreshTimeout = setTimeout(() => {
      this.refreshTimeout = null;
      this.refresh({ force }).catch(() => {});
    }, 120);
  }

  private getExpandedParentAreas(): string[] {
    const requested = Array.from(
      new Set(
        [
          ...this.scopeParentAreas,
          normalizeScopeLabel("Oklahoma") ?? "Oklahoma",
        ].filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    );
    return expandScopeParentAreasForQuery(requested);
  }

  private async hydrateFocusFromCache(): Promise<void> {
    if (!this.enabled) return;
    if (this.listeners.size === 0) return;
    if (typeof window === "undefined") return;
    if (this.focusHydratePromise) return this.focusHydratePromise;

    const statIds = Array.from(new Set([...this.priorityStatIds, ...this.prefetchStatIds]));
    if (statIds.length === 0) return;
    const parentAreas = this.getExpandedParentAreas();
    const boundaryTypes: BoundaryTypeKey[] = ["ZIP", "COUNTY"];

    this.focusHydratePromise = this.hydrateFromCache(
      statIds.flatMap((statId) =>
        parentAreas.flatMap((parentArea) =>
          boundaryTypes.map((boundaryType) => ({ statId, parentArea, boundaryType })),
        ),
      ),
    ).finally(() => {
      this.focusHydratePromise = null;
    });

    return this.focusHydratePromise;
  }

  private scheduleTtlRefresh() {
    if (typeof window === "undefined") return;
    if (this.scheduledTtlTimeout) clearTimeout(this.scheduledTtlTimeout);
    this.scheduledTtlTimeout = setTimeout(() => {
      this.scheduledTtlTimeout = null;
      this.scheduleRefresh({ force: true });
    }, PERSISTED_STAT_CACHE_TTL_MS);
  }

  private async hydrateFromCache(desiredKeys: Array<{ statId: string; parentArea: string; boundaryType: BoundaryTypeKey }>) {
    const updates: Array<{
      statId: string;
      parentArea: string;
      boundaryType: BoundaryTypeKey;
      cached: PersistedStatMapCache;
    }> = [];

    for (const key of desiredKeys) {
      const parentKeys = normalizeParentAreaKeys(key.parentArea);
      if (parentKeys.length === 0) continue;
      for (const parentAreaKey of parentKeys) {
        const metaKey = statMapKey(key.statId, parentAreaKey, key.boundaryType);
        if (this.hydratedKeys.has(metaKey)) continue;
        this.hydratedKeys.add(metaKey);
        const cached = await readStatMapCache({
          statId: key.statId,
          parentArea: parentAreaKey,
          boundaryType: key.boundaryType as PersistedBoundaryType,
        });
        if (!cached) continue;
        updates.push({
          statId: key.statId,
          parentArea: parentAreaKey,
          boundaryType: key.boundaryType,
          cached,
        });
        break;
      }
    }

    if (updates.length === 0) return;

    const nextByStatId = new Map(this.byStatId);
    for (const update of updates) {
      const byParent = nextByStatId.get(update.statId) ?? new Map();
      const byBoundary = byParent.get(update.parentArea) ?? {};
      byBoundary[update.boundaryType] = {
        id: update.cached.key,
        statId: update.statId,
        name: "root",
        parentArea: update.parentArea,
        boundaryType: update.boundaryType,
        date: update.cached.date,
        type: update.cached.type,
        data: update.cached.data ?? {},
        min: update.cached.min ?? 0,
        max: update.cached.max ?? 0,
      };
      byParent.set(update.parentArea, byBoundary);
      nextByStatId.set(update.statId, byParent);
      this.metaByKey.set(statMapKey(update.statId, update.parentArea, update.boundaryType), {
        date: update.cached.date,
        summaryUpdatedAt: update.cached.summaryUpdatedAt ?? null,
        savedAt: update.cached.savedAt ?? 0,
      });
    }

    this.byStatId = nextByStatId;
    this.emit();
  }

  private async refresh({ force }: { force: boolean }) {
    if (this.inflightRefresh) return this.inflightRefresh;
    if (this.priorityStatIds.length === 0) return;

    this.inflightRefresh = (async () => {
      const statIds = Array.from(new Set([...this.priorityStatIds, ...this.prefetchStatIds]));
      const requestedParentAreas = Array.from(
        new Set(
          [
            ...this.scopeParentAreas,
            normalizeScopeLabel("Oklahoma") ?? "Oklahoma",
          ].filter((value): value is string => typeof value === "string" && value.length > 0),
        ),
      );
      const parentAreasForQuery = expandScopeParentAreasForQuery(requestedParentAreas);
      const boundaryTypes: BoundaryTypeKey[] = ["ZIP", "COUNTY"];

      await this.hydrateFocusFromCache();

      // Cross-tab dedupe: only one tab should do the live Instant fetch at a time.
      const lock = acquireCacheLock("statData-refresh", 15_000);
      if (!lock.acquired) {
        // Another tab is refreshing; we'll likely get a cache update event soon.
        setTimeout(() => this.scheduleRefresh({ force: false }), 500);
        return;
      }

      try {
        // First hit summaries (small) so we only fetch the latest full maps (heavy).
        let summaries: any[] = [];
        try {
          const resp = await db.queryOnce({
            statDataSummaries: {
              $: {
                where: {
                  name: "root",
                  statId: { $in: statIds },
                  parentArea: { $in: parentAreasForQuery },
                  boundaryType: { $in: boundaryTypes },
                },
                limit: 10000,
                fields: ["statId", "name", "parentArea", "boundaryType", "date", "type", "updatedAt"],
              },
            },
          });
          summaries = Array.isArray((resp as any)?.data?.statDataSummaries)
            ? ((resp as any).data.statDataSummaries as any[])
            : [];
        } catch (error) {
          console.warn("[statDataStore] Failed to query summaries", error);
          summaries = [];
        }

        type DesiredEntry = {
          statId: string;
          parentAreaKey: string;
          rawParentArea: string;
          boundaryType: BoundaryTypeKey;
          date: string;
          type: string;
          updatedAt: number;
        };

        const desired = new Map<string, DesiredEntry>();
        if (summaries.length > 0) {
          for (const row of summaries) {
            const statId = typeof row?.statId === "string" ? row.statId : null;
            if (!statId) continue;
            if (row?.name !== "root") continue;
            const boundaryType = normalizeBoundaryType(row?.boundaryType);
            if (!boundaryType) continue;
            const rawParentArea = typeof row?.parentArea === "string" ? row.parentArea : null;
            if (!rawParentArea) continue;
            const parentAreaKeys = normalizeParentAreaKeys(rawParentArea);
            if (parentAreaKeys.length === 0) continue;
            const date =
              typeof row?.date === "string" ? row.date : typeof row?.date === "number" ? String(row.date) : null;
            const type = typeof row?.type === "string" ? row.type : null;
            const updatedAt =
              typeof row?.updatedAt === "number" && Number.isFinite(row.updatedAt) ? row.updatedAt : null;
            if (!date || !type || updatedAt === null) continue;
            for (const parentAreaKey of parentAreaKeys) {
              const key = statMapKey(statId, parentAreaKey, boundaryType);
              desired.set(key, { statId, parentAreaKey, rawParentArea, boundaryType, date, type, updatedAt });
            }
          }
        }

        const toFetch: DesiredEntry[] = [];
        for (const entry of desired.values()) {
          const key = statMapKey(entry.statId, entry.parentAreaKey, entry.boundaryType);
          const meta = this.metaByKey.get(key);
          const cachedUpdatedAt = meta?.summaryUpdatedAt ?? null;
          const cachedDate = meta?.date ?? null;
          if (!force && cachedUpdatedAt !== null && cachedUpdatedAt === entry.updatedAt && cachedDate === entry.date) {
            continue;
          }
          toFetch.push(entry);
        }

        const shouldFallbackToDirectStatData =
          summaries.length === 0 || toFetch.length === 0;

        const fetchFromStatData = async ({
          restrictToDates,
        }: {
          restrictToDates: boolean;
        }): Promise<any[]> => {
          const statIdsToFetch = statIds;
          const boundariesToFetch = boundaryTypes;
          const datesToFetch = restrictToDates ? Array.from(new Set(toFetch.map((e) => e.date))) : [];

          const where: any = {
            name: "root",
            statId: { $in: statIdsToFetch },
            parentArea: { $in: parentAreasForQuery },
            boundaryType: { $in: boundariesToFetch },
          };
          if (restrictToDates && datesToFetch.length > 0) where.date = { $in: datesToFetch };

          const resp = await db.queryOnce({
            statData: {
              $: {
                where,
                limit: 10000,
                fields: ["id", "statId", "name", "parentArea", "boundaryType", "date", "type", "data"],
                order: { date: "asc" as const },
              },
            },
          });
          return Array.isArray((resp as any)?.data?.statData) ? ((resp as any).data.statData as any[]) : [];
        };

        let statRows: any[] = [];
        if (!shouldFallbackToDirectStatData) {
          try {
            statRows = await fetchFromStatData({ restrictToDates: true });
          } catch (error) {
            console.warn("[statDataStore] Failed to query statData maps (targeted)", error);
            statRows = [];
          }
        }

        // If summaries are missing (or targeted date fetch missed), fall back to pulling
        // all available dates for the focused stat(s) + scope and select latest client-side.
        if (shouldFallbackToDirectStatData || statRows.length === 0) {
          try {
            statRows = await fetchFromStatData({ restrictToDates: false });
          } catch (error) {
            console.warn("[statDataStore] Failed to query statData maps (fallback)", error);
            statRows = [];
          }
        }

      const rowsByParentKey = new Map<
        string,
        Map<string, StatData>
      >();
      for (const row of statRows) {
        if (!row?.id) continue;
        const statId = typeof row?.statId === "string" ? row.statId : null;
        if (!statId) continue;
        if (row?.name !== "root") continue;
        const boundaryType = normalizeBoundaryType(row?.boundaryType);
        if (!boundaryType) continue;
        const rawParentArea = typeof row?.parentArea === "string" ? row.parentArea : null;
        if (!rawParentArea) continue;
        const parentKeys = normalizeParentAreaKeys(rawParentArea);
        if (parentKeys.length === 0) continue;
        const date =
          typeof row?.date === "string" ? row.date : typeof row?.date === "number" ? String(row.date) : null;
        if (!date) continue;

        const outer = `${statId}::${boundaryType}::${date}`;
        const inner = rowsByParentKey.get(outer) ?? new Map<string, StatData>();
        for (const parentKey of parentKeys) {
          inner.set(parentKey, row as StatData);
        }
        rowsByParentKey.set(outer, inner);
      }

      let didUpdate = false;
      const nextByStatId = new Map(this.byStatId);
      let entriesToApply: DesiredEntry[] = toFetch.length > 0 ? toFetch : Array.from(desired.values());

      // If we fell back to fetching multiple dates, select the latest per key.
      const latestDateByKey = new Map<string, { date: string; row: StatData }>();
      if (toFetch.length === 0) {
        for (const row of statRows) {
          const statId = typeof row?.statId === "string" ? row.statId : null;
          const boundaryType = normalizeBoundaryType(row?.boundaryType);
          const rawParentArea = typeof row?.parentArea === "string" ? row.parentArea : null;
          const date =
            typeof row?.date === "string" ? row.date : typeof row?.date === "number" ? String(row.date) : null;
          if (!statId || !boundaryType || !rawParentArea || !date) continue;
          for (const parentKey of normalizeParentAreaKeys(rawParentArea)) {
            const key = statMapKey(statId, parentKey, boundaryType);
            const existing = latestDateByKey.get(key);
            if (!existing || date.localeCompare(existing.date) > 0) {
              latestDateByKey.set(key, { date, row: row as StatData });
            }
          }
        }
      }

      if (entriesToApply.length === 0 && latestDateByKey.size > 0) {
        entriesToApply = Array.from(latestDateByKey.entries()).map(([key, value]) => {
          const [statId, parentAreaKey, boundaryTypeRaw] = key.split("::");
          const boundaryType = normalizeBoundaryType(boundaryTypeRaw) ?? "ZIP";
          return {
            statId,
            parentAreaKey,
            rawParentArea: parentAreaKey,
            boundaryType,
            date: value.date,
            type: typeof (value.row as any)?.type === "string" ? (value.row as any).type : "count",
            updatedAt: 0,
          } satisfies DesiredEntry;
        });
      }

      for (const entry of entriesToApply) {
        let row: StatData | undefined;
        let effectiveDate = entry.date;

        if (toFetch.length > 0) {
          const matchKey = `${entry.statId}::${entry.boundaryType}::${entry.date}`;
          row = rowsByParentKey.get(matchKey)?.get(entry.parentAreaKey);
        } else {
          const found = latestDateByKey.get(statMapKey(entry.statId, entry.parentAreaKey, entry.boundaryType));
          row = found?.row;
          if (found?.date) effectiveDate = found.date;
        }

        if (!row) continue;
        const data = (row.data ?? {}) as Record<string, number>;
        const values = Object.values(data).filter(
          (value): value is number => typeof value === "number" && Number.isFinite(value),
        );
        const min = values.length ? Math.min(...values) : 0;
        const max = values.length ? Math.max(...values) : 0;

        const byParent = nextByStatId.get(entry.statId) ?? new Map();
        const byBoundary = byParent.get(entry.parentAreaKey) ?? {};
        byBoundary[entry.boundaryType] = {
          id: row.id,
          statId: entry.statId,
          name: "root",
          parentArea: entry.parentAreaKey,
          boundaryType: entry.boundaryType,
          date: effectiveDate,
          type: typeof row.type === "string" ? row.type : entry.type,
          data,
          min,
          max,
        };
        byParent.set(entry.parentAreaKey, byBoundary);
        nextByStatId.set(entry.statId, byParent);
        this.metaByKey.set(statMapKey(entry.statId, entry.parentAreaKey, entry.boundaryType), {
          date: effectiveDate,
          summaryUpdatedAt: toFetch.length > 0 ? entry.updatedAt : null,
          savedAt: Date.now(),
        });

        writeStatMapCache({
          statId: entry.statId,
          parentArea: entry.parentAreaKey,
          boundaryType: entry.boundaryType,
          date: effectiveDate,
          type: typeof row.type === "string" ? row.type : entry.type,
          data,
          min,
          max,
          summaryUpdatedAt: toFetch.length > 0 ? entry.updatedAt : null,
          maxEntries: DEFAULT_STAT_MAP_LRU_LIMIT,
        }).catch(() => {});

        didUpdate = true;
      }

        if (didUpdate) {
          this.byStatId = nextByStatId;
          this.emit();
        }

        this.scheduleTtlRefresh();
      } finally {
        lock.release();
      }
    })().finally(() => {
      this.inflightRefresh = null;
      if (this.refreshQueued) {
        const force = this.queuedRefreshForce;
        this.refreshQueued = false;
        this.queuedRefreshForce = false;
        // Run immediately (no debounce) so stat switching stays snappy.
        setTimeout(() => this.refresh({ force }).catch(() => {}), 0);
      }
    });

    return this.inflightRefresh;
  }
}

export const statDataStore = new StatDataStore();
export const setStatDataSubscriptionEnabled = (enabled: boolean) =>
  statDataStore.setEnabled(enabled);

export const setStatDataPriorityStatIds = (statIds: string[]) =>
  statDataStore.setPriorityStatIds(statIds);

export const setStatDataScopeParentAreas = (parentAreas: string[]) =>
  statDataStore.setScopeParentAreas(parentAreas);

export const setStatDataPrefetchStatIds = (statIds: string[]) =>
  statDataStore.setPrefetchStatIds(statIds);
