import { useMemo, useRef } from "react";
import { db } from "../../lib/reactDb";
import { useAuthSession } from "./useAuthSession";
import type { Stat } from "../../types/stat";
import type { Category } from "../../types/organization";
import type { AreaKind } from "../../types/areas";
import { DEFAULT_PARENT_AREA_BY_KIND } from "../../types/areas";
import { normalizeScopeLabel } from "../../lib/scopeLabels";

type SupportedAreaKind = Extract<AreaKind, "ZIP" | "COUNTY">;

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

export const useStats = () => {
  const { authReady } = useAuthSession();
  const queryEnabled = authReady;

  // Query stats and statData directly from InstantDB
  // Wait for auth to be ready to avoid race conditions (especially in Safari)
  const { data, isLoading, error } = db.useQuery(
    queryEnabled
      ? {
          stats: {
            $: {
              order: { name: "asc" as const },
            },
          },
          statData: {
            $: {
              where: { name: "root" },
              fields: [
                "statId",
                "name",
                "parentArea",
                "boundaryType",
                "date",
                "type",
                "data",
              ],
              order: { date: "asc" as const },
            },
          },
        }
      : null,
  );

  // Cache the last valid data response to prevent UI flashes during transient loading states
  const cachedDataRef = useRef(data);
  if (data) {
    cachedDataRef.current = data;
  }
  const effectiveData = data || cachedDataRef.current;

  // Normalize stats once to reuse everywhere
  const statsById = useMemo(() => {
    const map = new Map<string, Stat>();
    if (!effectiveData?.stats) return map;

    for (const row of effectiveData.stats) {
      if (row?.id && typeof row.name === "string" && typeof row.category === "string") {
        map.set(row.id, {
          id: row.id,
          name: row.name,
          label: typeof row.label === "string" && row.label.trim() ? row.label : undefined,
          category: row.category as Category,
          goodIfUp: typeof row.goodIfUp === "boolean" ? row.goodIfUp : undefined,
          active: typeof row.active === "boolean" ? row.active : undefined,
        });
      }
    }
    return map;
  }, [effectiveData?.stats]);

  // Build time series per stat and area kind (ZIP vs COUNTY for now)
  const seriesByStatIdByKind = useMemo(() => {
    const map = new Map<string, SeriesByKind>();
    if (!effectiveData?.statData) return map;

    for (const row of effectiveData.statData) {
      if (
        !row?.id ||
        typeof row.statId !== "string" ||
        row.name !== "root" ||
        typeof row.boundaryType !== "string"
      ) {
        continue;
      }
      const boundaryType = row.boundaryType as SupportedAreaKind;
      if (!SUPPORTED_AREA_KINDS.includes(boundaryType)) continue;
      const expectedParent = DEFAULT_PARENT_AREA_BY_KIND[boundaryType];
      if (expectedParent && row.parentArea !== expectedParent) continue;
      if (typeof row.date !== "string" || typeof row.type !== "string" || typeof row.data !== "object") {
        continue;
      }

      const entry: SeriesEntry = {
        date: row.date,
        type: row.type,
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
        !row?.id ||
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
        type: row.type,
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
        !row?.id ||
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
        type: typeof row.type === "string" ? row.type : "count",
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

  return {
    statsById,
    seriesByStatId: legacySeriesByStatId,
    seriesByStatIdByKind,
    seriesByStatIdByParent,
    statDataByBoundary,
    statDataByParent,
    isLoading,
    error,
  };
};
