import { useMemo } from "react";
import { db } from "../../lib/reactDb";
import type { Stat } from "../../types/stat";
import type { Category } from "../../types/organization";

interface SeriesEntry {
  date: string;
  type: string;
  data: Record<string, number>;
}

export const useStats = () => {
  // Query stats and statData directly from InstantDB
  const { data, isLoading, error } = db.useQuery({
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
  });

  // Transform stats into a Map
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

  // Transform statData into time series by statId
  const seriesByStatId = useMemo(() => {
    const map = new Map<string, SeriesEntry[]>();
    if (!data?.statData) return map;

    const filtered = data.statData.filter(
      (row) =>
        row?.id &&
        typeof row.statId === "string" &&
        row.name === "root" &&
        row.area === "Tulsa" &&
        row.boundaryType === "ZIP" &&
        typeof row.date === "string" &&
        typeof row.type === "string" &&
        typeof row.data === "object"
    );

    for (const row of filtered) {
      const statId = row.statId as string;
      const entry: SeriesEntry = {
        date: row.date as string,
        type: row.type as string,
        data: (row.data ?? {}) as Record<string, number>,
      };
      const bucket = map.get(statId);
      if (bucket) bucket.push(entry);
      else map.set(statId, [entry]);
    }

    // Ensure each series is sorted by date ascending
    for (const [id, arr] of map) {
      arr.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      map.set(id, arr);
    }

    return map;
  }, [data?.statData]);

  return { statsById, seriesByStatId, isLoading, error };
};
