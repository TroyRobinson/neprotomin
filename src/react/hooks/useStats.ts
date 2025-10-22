import { useMemo } from "react";
import { db } from "../../lib/reactDb";
import type { Stat } from "../../types/stat";
import type { Category } from "../../types/organization";
import type { AreaKind } from "../../types/areas";
import { DEFAULT_PARENT_AREA_BY_KIND } from "../../types/areas";

type SupportedAreaKind = Extract<AreaKind, "ZIP" | "COUNTY">;

export interface SeriesEntry {
  date: string;
  type: string;
  data: Record<string, number>;
  parentArea: string | null;
}

export type SeriesByKind = Map<SupportedAreaKind, SeriesEntry[]>;

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
  const { isLoading: isAuthLoading } = db.useAuth();

  // Query stats and statData directly from InstantDB
  // Wait for auth to be ready to avoid race conditions (especially in Safari)
  const { data, isLoading, error } = db.useQuery(
    isAuthLoading
      ? null
      : {
          stats: {
            $: {
              order: { name: "asc" as const },
            },
          },
          statData: {
            $: {
              order: { date: "asc" as const },
            },
          },
        },
  );

  // Normalize stats once to reuse everywhere
  const statsById = useMemo(() => {
    const map = new Map<string, Stat>();
    if (!data?.stats) return map;

    for (const row of data.stats) {
      if (row?.id && typeof row.name === "string" && typeof row.category === "string") {
        map.set(row.id, {
          id: row.id,
          name: row.name,
          category: row.category as Category,
          goodIfUp: typeof row.goodIfUp === "boolean" ? row.goodIfUp : undefined,
        });
      }
    }
    return map;
  }, [data?.stats]);

  // Build time series per stat and area kind (ZIP vs COUNTY for now)
  const seriesByStatIdByKind = useMemo(() => {
    const map = new Map<string, SeriesByKind>();
    if (!data?.statData) return map;

    for (const row of data.statData) {
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
  }, [data?.statData]);

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
    statDataByBoundary,
    isLoading,
    error,
  };
};
