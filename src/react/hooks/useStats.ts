import { useMemo, useRef } from "react";
import { db } from "../../lib/reactDb";
import { useAuthSession } from "./useAuthSession";
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
}

export const useStats = ({ statDataEnabled = true }: UseStatsOptions = {}) => {
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
          ...(statDataEnabled
            ? {
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
            : {}),
        }
      : null,
  );

  // Cache each payload slice so disabling statData doesn't wipe the last good statData payload.
  type QueryData = NonNullable<typeof data>;
  const cachedStatsRef = useRef<QueryData["stats"] | undefined>(undefined);
  const cachedStatRelationsRef = useRef<QueryData["statRelations"] | undefined>(undefined);
  const cachedStatDataRef = useRef<QueryData["statData"] | undefined>(undefined);

  if (Array.isArray(data?.stats)) {
    cachedStatsRef.current = data.stats;
  }
  if (Array.isArray(data?.statRelations)) {
    cachedStatRelationsRef.current = data.statRelations;
  }
  if (Array.isArray(data?.statData) && data.statData.length > 0) {
    cachedStatDataRef.current = data.statData;
  }

  const effectiveData = {
    stats: Array.isArray(data?.stats)
      ? data?.stats
      : cachedStatsRef.current,
    statRelations: Array.isArray(data?.statRelations)
      ? data?.statRelations
      : cachedStatRelationsRef.current,
    statData: Array.isArray(data?.statData)
      ? data?.statData
      : cachedStatDataRef.current,
  };

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
          featured: typeof row.featured === "boolean" ? row.featured : undefined,
          homeFeatured: typeof row.homeFeatured === "boolean" ? row.homeFeatured : undefined,
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
    statRelationsByParent,
    statRelationsByChild,
    isLoading,
    error,
  };
};
