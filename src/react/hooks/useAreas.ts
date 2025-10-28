import { useMemo } from "react";
import { db } from "../../lib/reactDb";
import type { AreaKind, AreaRecord } from "../../types/areas";
import { AREA_KINDS, areaCodeKey, parseAreaKind } from "../../types/areas";

type AreasIndex = {
  all: AreaRecord[];
  byKind: Map<AreaKind, AreaRecord[]>;
  byKindAndCode: Map<AreaKind, Map<string, AreaRecord>>;
};

const EMPTY_INDEX: AreasIndex = {
  all: [],
  byKind: new Map(),
  byKindAndCode: new Map(),
};

/**
 * Subscribe to the InstantDB `areas` entity and normalize it into quick-look maps.
 * This keeps area labels and centroids handy for any component that needs them.
 */
export const useAreas = () => {
  const { isLoading: isAuthLoading } = db.useAuth();

  const { data, isLoading, error } = db.useQuery(
    isAuthLoading
      ? null
      : {
          areas: {
            $: {
              order: { name: "asc" as const },
            },
          },
        },
  );

  const index = useMemo<AreasIndex>(() => {
    const rows = data?.areas ?? [];
    if (!rows || rows.length === 0) return EMPTY_INDEX;

    const accum: AreasIndex = {
      all: [],
      byKind: new Map(),
      byKindAndCode: new Map(),
    };

    for (const row of rows) {
      if (!row?.id || row?.isActive === false) continue;
      const kind = parseAreaKind((row as any)?.kind);
      if (!kind) continue;
      const code = typeof row?.code === "string" ? row.code : null;
      const name = typeof row?.name === "string" ? row.name : null;
      if (!code || !name) continue;

      const isActive = typeof row?.isActive === "boolean" ? (row.isActive as boolean) : true;

      const record: AreaRecord = {
        id: row.id as string,
        code,
        kind,
        name,
        parentCode: typeof row?.parentCode === "string" ? row.parentCode : null,
        centroid: Array.isArray(row?.centroid) ? (row.centroid as [number, number]) : null,
        bounds: Array.isArray(row?.bounds) ? (row.bounds as [[number, number], [number, number]]) : null,
        isActive,
      };

      accum.all.push(record);

      const list = accum.byKind.get(kind) ?? [];
      list.push(record);
      accum.byKind.set(kind, list);

      const byCode = accum.byKindAndCode.get(kind) ?? new Map<string, AreaRecord>();
      byCode.set(record.code, record);
      accum.byKindAndCode.set(kind, byCode);
    }

    for (const kind of AREA_KINDS) {
      if (!accum.byKind.has(kind)) accum.byKind.set(kind, []);
      if (!accum.byKindAndCode.has(kind)) accum.byKindAndCode.set(kind, new Map());
    }

    return accum;
  }, [data?.areas]);

  const areasByKey = useMemo(() => {
    const map = new Map<string, AreaRecord>();
    for (const record of index.all) {
      map.set(areaCodeKey(record.kind, record.code), record);
    }
    return map;
  }, [index.all]);

  const getAreaRecord = useMemo(() => {
    return (kind: AreaKind, code: string): AreaRecord | null => {
      return index.byKindAndCode.get(kind)?.get(code) ?? null;
    };
  }, [index.byKindAndCode]);

  const getAreaLabel = useMemo(() => {
    return (kind: AreaKind, code: string, { fallbackToCode = true }: { fallbackToCode?: boolean } = {}): string | null => {
      const record = getAreaRecord(kind, code);
      if (!record) return fallbackToCode ? code : null;
      if (record.name && record.name.trim().length > 0) return record.name;
      return fallbackToCode ? code : null;
    };
  }, [getAreaRecord]);

  return {
    areas: index.all,
    areasByKind: index.byKind,
    areasByKindAndCode: index.byKindAndCode,
    areasByKey,
    getAreaRecord,
    getAreaLabel,
    isLoading,
    error,
  };
};
