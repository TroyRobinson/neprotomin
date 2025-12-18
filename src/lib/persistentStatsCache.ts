// Persistent (cross-refresh/tab) cache for stat summaries + heavy stat maps.
// Uses IndexedDB so we can store large payloads without blocking the UI thread.

export type StatBoundaryType = "ZIP" | "COUNTY";

export type StatSummaryRow = {
  statId: string;
  name: "root";
  parentArea: string;
  boundaryType: StatBoundaryType;
  date: string;
  type: string;
  count: number;
  sum: number;
  avg: number;
  min?: number;
  max?: number;
  updatedAt: number;
};

export type StatMapRow = {
  statId: string;
  name: "root";
  parentArea: string;
  boundaryType: StatBoundaryType;
  date: string;
  type: string;
  data: Record<string, number>;
};

export type PersistedSummaryCache = {
  key: string;
  savedAt: number;
  parentArea: string;
  boundaryType: StatBoundaryType;
  rows: StatSummaryRow[];
};

export type PersistedStatMapCache = {
  key: string;
  savedAt: number;
  lastAccessedAt: number;
  statId: string;
  parentArea: string;
  boundaryType: StatBoundaryType;
  date: string;
  type: string;
  data: Record<string, number>;
  min: number;
  max: number;
  summaryUpdatedAt: number | null;
};

export type CacheEvent =
  | { type: "updated"; store: "summaries" | "statMaps"; key: string }
  | { type: "cleared" };

export const PERSISTED_STAT_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_STAT_MAP_LRU_LIMIT = 24;

const CACHE_DB_NAME = "neprotomin-cache";
const CACHE_DB_VERSION = 1;
const CACHE_SCHEMA_VERSION = 1;

const STORE_META = "meta";
const STORE_SUMMARIES = "summaries";
const STORE_STAT_MAPS = "statMaps";

const META_SCHEMA_KEY = "schemaVersion";

const SUMMARY_KEY = (parentArea: string, boundaryType: StatBoundaryType) =>
  `v${CACHE_SCHEMA_VERSION}:summaries:${parentArea}:${boundaryType}`;

const STAT_MAP_KEY = (statId: string, parentArea: string, boundaryType: StatBoundaryType) =>
  `v${CACHE_SCHEMA_VERSION}:statMap:${statId}:${parentArea}:${boundaryType}`;

const channel: BroadcastChannel | null =
  typeof window !== "undefined" && typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("neprotomin-cache")
    : null;

export const subscribeToCacheEvents = (handler: (event: CacheEvent) => void): (() => void) => {
  if (!channel) return () => {};
  const onMessage = (event: MessageEvent) => {
    const data = event?.data as CacheEvent | undefined;
    if (!data || typeof data !== "object" || typeof (data as any).type !== "string") return;
    handler(data);
  };
  channel.addEventListener("message", onMessage);
  return () => channel.removeEventListener("message", onMessage);
};

const publishCacheEvent = (event: CacheEvent) => {
  try {
    channel?.postMessage(event);
  } catch {
    // Best-effort cross-tab update only.
  }
};

const requestToPromise = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const txDone = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
  });

const openDbRaw = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_SUMMARIES)) {
        db.createObjectStore(STORE_SUMMARIES, { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains(STORE_STAT_MAPS)) {
        const store = db.createObjectStore(STORE_STAT_MAPS, { keyPath: "key" });
        store.createIndex("lastAccessedAt", "lastAccessedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

let dbPromise: Promise<IDBDatabase> | null = null;

const getDb = async (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const db = await openDbRaw();
    await ensureSchemaVersion(db);
    return db;
  })();
  return dbPromise;
};

const ensureSchemaVersion = async (db: IDBDatabase) => {
  const tx = db.transaction([STORE_META, STORE_SUMMARIES, STORE_STAT_MAPS], "readwrite");
  const meta = tx.objectStore(STORE_META);
  const existing = await requestToPromise<{ key: string; value: number } | undefined>(
    meta.get(META_SCHEMA_KEY),
  );
  const current = typeof existing?.value === "number" ? existing.value : null;
  if (current === CACHE_SCHEMA_VERSION) {
    await txDone(tx).catch(() => {});
    return;
  }
  tx.objectStore(STORE_SUMMARIES).clear();
  tx.objectStore(STORE_STAT_MAPS).clear();
  meta.put({ key: META_SCHEMA_KEY, value: CACHE_SCHEMA_VERSION });
  await txDone(tx).catch(() => {});
};

const withStore = async <T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore, tx: IDBTransaction) => Promise<T>,
): Promise<T> => {
  const db = await getDb();
  const tx = db.transaction(storeName, mode);
  const store = tx.objectStore(storeName);
  const result = await fn(store, tx);
  await txDone(tx).catch(() => {});
  return result;
};

export const clearPersistentStatsCache = async (): Promise<void> => {
  try {
    await withStore(STORE_SUMMARIES, "readwrite", async (store) => {
      await requestToPromise(store.clear());
    });
    await withStore(STORE_STAT_MAPS, "readwrite", async (store) => {
      await requestToPromise(store.clear());
    });
    publishCacheEvent({ type: "cleared" });
  } catch (error) {
    console.warn("[cache] Failed to clear persistent cache", error);
  }
};

export const readStatSummaryCache = async ({
  parentArea,
  boundaryType,
}: {
  parentArea: string;
  boundaryType: StatBoundaryType;
}): Promise<PersistedSummaryCache | null> => {
  const key = SUMMARY_KEY(parentArea, boundaryType);
  try {
    const record = await withStore(STORE_SUMMARIES, "readonly", async (store) => {
      return requestToPromise<PersistedSummaryCache | undefined>(store.get(key));
    });
    if (!record || !Array.isArray(record.rows)) return null;
    return record;
  } catch {
    return null;
  }
};

export const writeStatSummaryCache = async ({
  parentArea,
  boundaryType,
  rows,
  savedAt = Date.now(),
}: {
  parentArea: string;
  boundaryType: StatBoundaryType;
  rows: StatSummaryRow[];
  savedAt?: number;
}): Promise<void> => {
  const key = SUMMARY_KEY(parentArea, boundaryType);
  try {
    await withStore(STORE_SUMMARIES, "readwrite", async (store) => {
      await requestToPromise(
        store.put({
          key,
          savedAt,
          parentArea,
          boundaryType,
          rows,
        } satisfies PersistedSummaryCache),
      );
    });
    publishCacheEvent({ type: "updated", store: "summaries", key });
  } catch (error) {
    console.warn("[cache] Failed to persist summaries", error);
  }
};

export const readStatMapCache = async ({
  statId,
  parentArea,
  boundaryType,
}: {
  statId: string;
  parentArea: string;
  boundaryType: StatBoundaryType;
}): Promise<PersistedStatMapCache | null> => {
  const key = STAT_MAP_KEY(statId, parentArea, boundaryType);
  try {
    const record = await withStore(STORE_STAT_MAPS, "readwrite", async (store) => {
      const existing = await requestToPromise<PersistedStatMapCache | undefined>(store.get(key));
      if (!existing) return null;
      const now = Date.now();
      const touched: PersistedStatMapCache = { ...existing, lastAccessedAt: now };
      await requestToPromise(store.put(touched));
      return touched;
    });
    return record;
  } catch {
    return null;
  }
};

const enforceStatMapLimit = async (maxEntries: number) => {
  if (maxEntries <= 0) return;
  await withStore(STORE_STAT_MAPS, "readwrite", async (store) => {
    const index = store.index("lastAccessedAt");
    const keysToDelete: string[] = [];
    let count = 0;
    await new Promise<void>((resolve, reject) => {
      // Descending cursor: keep newest entries, evict oldest.
      const cursorReq = index.openCursor(null, "prev");
      cursorReq.onerror = () => reject(cursorReq.error);
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result as IDBCursorWithValue | null;
        if (!cursor) {
          resolve();
          return;
        }
        count += 1;
        if (count > maxEntries) {
          const value = cursor.value as PersistedStatMapCache;
          if (value?.key) keysToDelete.push(String(value.key));
        }
        cursor.continue();
      };
    });
    for (const key of keysToDelete) store.delete(key);
  });
};

export const writeStatMapCache = async ({
  statId,
  parentArea,
  boundaryType,
  date,
  type,
  data,
  min,
  max,
  summaryUpdatedAt,
  savedAt = Date.now(),
  maxEntries = DEFAULT_STAT_MAP_LRU_LIMIT,
}: {
  statId: string;
  parentArea: string;
  boundaryType: StatBoundaryType;
  date: string;
  type: string;
  data: Record<string, number>;
  min: number;
  max: number;
  summaryUpdatedAt: number | null;
  savedAt?: number;
  maxEntries?: number;
}): Promise<void> => {
  const key = STAT_MAP_KEY(statId, parentArea, boundaryType);
  const lastAccessedAt = Date.now();
  try {
    await withStore(STORE_STAT_MAPS, "readwrite", async (store) => {
      await requestToPromise(
        store.put({
          key,
          savedAt,
          lastAccessedAt,
          statId,
          parentArea,
          boundaryType,
          date,
          type,
          data,
          min,
          max,
          summaryUpdatedAt,
        } satisfies PersistedStatMapCache),
      );
    });
    await enforceStatMapLimit(maxEntries);
    publishCacheEvent({ type: "updated", store: "statMaps", key });
  } catch (error) {
    console.warn("[cache] Failed to persist stat map", error);
  }
};

export const statMapCacheKeyFor = STAT_MAP_KEY;
export const statSummaryCacheKeyFor = SUMMARY_KEY;
