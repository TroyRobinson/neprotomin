import { db } from "../lib/db";

export type PointOfInterestBoundaryType = "ZIP" | "COUNTY";
export type PointOfInterestExtremaKind = "high" | "low";
export type PointOfInterestScopeKey = "oklahoma" | "tulsa_area" | "okc_area";

export interface PointOfInterestRow {
  id: string;
  poiKey: string;
  statId: string;
  statCategory: string;
  statName: string | null;
  boundaryType: PointOfInterestBoundaryType;
  extremaKind: PointOfInterestExtremaKind;
  scopeKey: PointOfInterestScopeKey | null;
  areaCode: string;
  goodIfUp: boolean | null;
  computedAt: number;
}

export interface PointsOfInterestSnapshot {
  rows: PointOfInterestRow[];
  byBoundary: Record<PointOfInterestBoundaryType, PointOfInterestRow[]>;
  byBoundaryAndCategory: Record<PointOfInterestBoundaryType, Map<string, PointOfInterestRow[]>>;
}

type Listener = (snapshot: PointsOfInterestSnapshot) => void;

const POINTS_OF_INTEREST_QUERY = {
  pointsOfInterest: {
    $: {
      where: { isActive: true },
      limit: 2000,
    },
  },
};

const emptyByBoundary = (): Record<PointOfInterestBoundaryType, PointOfInterestRow[]> => ({
  ZIP: [],
  COUNTY: [],
});

const emptyByBoundaryAndCategory = (): Record<
  PointOfInterestBoundaryType,
  Map<string, PointOfInterestRow[]>
> => ({
  ZIP: new Map(),
  COUNTY: new Map(),
});

const EMPTY_SNAPSHOT: PointsOfInterestSnapshot = {
  rows: [],
  byBoundary: emptyByBoundary(),
  byBoundaryAndCategory: emptyByBoundaryAndCategory(),
};

export const emptyPointsOfInterestSnapshot = (): PointsOfInterestSnapshot => ({
  rows: [],
  byBoundary: emptyByBoundary(),
  byBoundaryAndCategory: emptyByBoundaryAndCategory(),
});

const normalizeCategory = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
};

const normalizeBoundaryType = (value: unknown): PointOfInterestBoundaryType | null => {
  if (value === "ZIP" || value === "COUNTY") return value;
  return null;
};

const normalizeExtremaKind = (value: unknown): PointOfInterestExtremaKind | null => {
  if (value === "high" || value === "low") return value;
  return null;
};

const normalizeScopeKey = (value: unknown): PointOfInterestScopeKey | null => {
  if (value === "oklahoma" || value === "tulsa_area" || value === "okc_area") return value;
  return null;
};

const normalizeRows = (rawRows: any[]): PointsOfInterestSnapshot => {
  // Keep one row per poiKey (latest wins) so map rendering stays deterministic.
  const dedupedByPoiKey = new Map<string, PointOfInterestRow>();

  for (const raw of rawRows) {
    if (!raw || typeof raw !== "object") continue;
    const id = typeof raw.id === "string" ? raw.id : null;
    const poiKey = typeof raw.poiKey === "string" ? raw.poiKey : null;
    const statId = typeof raw.statId === "string" ? raw.statId : null;
    const statCategory = normalizeCategory(raw.statCategory);
    const statName =
      typeof raw.statName === "string" && raw.statName.trim().length > 0
        ? raw.statName.trim()
        : null;
    const boundaryType = normalizeBoundaryType(raw.boundaryType);
    const extremaKind = normalizeExtremaKind(raw.extremaKind);
    const scopeKey = normalizeScopeKey(raw.scopeKey);
    const areaCode = typeof raw.areaCode === "string" ? raw.areaCode.trim() : "";
    const computedAt = typeof raw.computedAt === "number" && Number.isFinite(raw.computedAt)
      ? raw.computedAt
      : 0;

    if (
      !id ||
      !poiKey ||
      !statId ||
      !statCategory ||
      !boundaryType ||
      !extremaKind ||
      areaCode.length === 0
    ) {
      continue;
    }

    const normalized: PointOfInterestRow = {
      id,
      poiKey,
      statId,
      statCategory,
      statName,
      boundaryType,
      extremaKind,
      scopeKey,
      areaCode,
      goodIfUp: typeof raw.goodIfUp === "boolean" ? raw.goodIfUp : null,
      computedAt,
    };

    const existing = dedupedByPoiKey.get(poiKey);
    if (!existing || normalized.computedAt >= existing.computedAt) {
      dedupedByPoiKey.set(poiKey, normalized);
    }
  }

  const rows = Array.from(dedupedByPoiKey.values()).sort((a, b) => {
    if (a.boundaryType !== b.boundaryType) return a.boundaryType.localeCompare(b.boundaryType);
    if (a.extremaKind !== b.extremaKind) return a.extremaKind.localeCompare(b.extremaKind);
    if ((a.scopeKey ?? "") !== (b.scopeKey ?? "")) return (a.scopeKey ?? "").localeCompare(b.scopeKey ?? "");
    if (a.statCategory !== b.statCategory) return a.statCategory.localeCompare(b.statCategory);
    if (a.areaCode !== b.areaCode) return a.areaCode.localeCompare(b.areaCode);
    return a.poiKey.localeCompare(b.poiKey);
  });

  const byBoundary = emptyByBoundary();
  const byBoundaryAndCategory = emptyByBoundaryAndCategory();

  for (const row of rows) {
    byBoundary[row.boundaryType].push(row);
    const categoryRows = byBoundaryAndCategory[row.boundaryType].get(row.statCategory) ?? [];
    categoryRows.push(row);
    byBoundaryAndCategory[row.boundaryType].set(row.statCategory, categoryRows);
  }

  return {
    rows,
    byBoundary,
    byBoundaryAndCategory,
  };
};

export const getPointsOfInterestRows = (
  snapshot: PointsOfInterestSnapshot,
  boundaryType: PointOfInterestBoundaryType,
  categoryId: string | null,
): PointOfInterestRow[] => {
  const normalizedCategory = normalizeCategory(categoryId);
  if (!normalizedCategory) return snapshot.byBoundary[boundaryType];
  return snapshot.byBoundaryAndCategory[boundaryType].get(normalizedCategory) ?? [];
};

class PointsOfInterestStore {
  private listeners = new Set<Listener>();
  private snapshot: PointsOfInterestSnapshot = EMPTY_SNAPSHOT;
  private unsubscribe: (() => void) | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    this.initialize();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.teardown();
    };
  }

  private initialize() {
    if (this.unsubscribe) return;

    try {
      this.unsubscribe = db.subscribeQuery(POINTS_OF_INTEREST_QUERY, (resp) => {
        if (!resp?.data) return;
        const rows = Array.isArray((resp.data as any).pointsOfInterest)
          ? ((resp.data as any).pointsOfInterest as any[])
          : [];
        this.snapshot = normalizeRows(rows);
        this.emit();
      });
    } catch (error) {
      console.error("Failed to subscribe to pointsOfInterest", error);
    }
  }

  private teardown() {
    if (!this.unsubscribe) return;
    this.unsubscribe();
    this.unsubscribe = null;
  }

  private emit() {
    this.listeners.forEach((listener) => listener(this.snapshot));
  }
}

export const pointsOfInterestStore = new PointsOfInterestStore();
