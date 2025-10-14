import type { StatData } from "../types/statData";
import { db } from "../lib/db";

type StatDataEntry = {
  id: string;
  statId: string;
  name: string;
  area: string;
  boundaryType: string;
  date: string;
  type: string;
  data: Record<string, number>;
  min: number;
  max: number;
};

type Listener = (byStatId: Map<string, StatDataEntry>) => void;

const QUERY = {
  statData: {
    $: {
      order: { date: "asc" as const },
    },
  },
};

class StatDataStore {
  private listeners = new Set<Listener>();
  private byStatId: Map<string, StatDataEntry> = new Map();
  private unsubscribe: (() => void) | null = null;

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
    if (this.unsubscribe) return;
    try {
      this.unsubscribe = db.subscribeQuery(QUERY, (resp) => {
        const rows = (resp?.data?.statData ?? []) as any[];
        const filtered = rows
          .filter((row) =>
            Boolean(
              row?.id &&
                typeof (row as any)?.statId === "string" &&
                typeof (row as any)?.name === "string" &&
                typeof (row as any)?.area === "string" &&
                typeof (row as any)?.boundaryType === "string" &&
                typeof (row as any)?.date === "string" &&
                typeof (row as any)?.type === "string" &&
                typeof (row as any)?.data === "object",
            ),
          )
          .filter(
            (row) =>
              (row as any).area === "Tulsa" &&
              (row as any).boundaryType === "ZIP" &&
              (row as any).name === "root",
          ) as StatData[];

        // Group by statId and select the latest date for each stat
        const byStatIdDate = new Map<string, StatData[]>();
        for (const row of filtered) {
          const list = byStatIdDate.get(row.statId) || [];
          list.push(row);
          byStatIdDate.set(row.statId, list);
        }

        const map = new Map<string, StatDataEntry>();
        for (const [statId, list] of byStatIdDate) {
          // Sort by date descending, pick the latest
          list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
          const latest = list[0];
          const entries = Object.values(latest.data ?? {}) as number[];
          const min = entries.length ? Math.min(...entries) : 0;
          const max = entries.length ? Math.max(...entries) : 0;
          map.set(statId, {
            id: latest.id,
            statId: latest.statId,
            name: latest.name,
            area: latest.area,
            boundaryType: latest.boundaryType,
            date: latest.date,
            type: latest.type,
            data: latest.data ?? {},
            min,
            max,
          });
        }

        this.byStatId = map;
        this.emit();
      });
    } catch (error) {
      console.error("Failed to subscribe to statData", error);
    }
  }

  private teardown() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private emit() {
    this.listeners.forEach((l) => l(this.byStatId));
  }
}

export const statDataStore = new StatDataStore();

