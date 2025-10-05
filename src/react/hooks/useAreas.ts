import { useMemo } from "react";
import { db } from "../../lib/reactDb";
import type { Area } from "../../types/area";

export const useAreas = () => {
  const { data, isLoading, error } = db.useQuery({
    areas: {
      $: { order: { key: "asc" as const } },
    },
  });

  const areasByKey = useMemo(() => {
    const map = new Map<string, Area>();
    for (const row of data?.areas ?? []) {
      if (
        row?.id &&
        typeof row.id === "string" &&
        row?.key &&
        typeof row.key === "string" &&
        row?.type === "ZIP" &&
        typeof row.population === "number" &&
        typeof row.avgAge === "number" &&
        typeof row.marriedPercent === "number"
      ) {
        map.set(row.key, {
          id: row.id,
          key: row.key,
          type: "ZIP",
          population: row.population,
          avgAge: row.avgAge,
          marriedPercent: row.marriedPercent,
        });
      }
    }
    return map;
  }, [data?.areas]);

  return { areasByKey, isLoading, error };
};


