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
              (row as any).date === "2025" &&
              (row as any).name === "root",
          ) as StatData[];

        const map = new Map<string, StatDataEntry>();
        for (const row of filtered) {
          const entries = Object.values(row.data ?? {}) as number[];
          const min = entries.length ? Math.min(...entries) : 0;
          const max = entries.length ? Math.max(...entries) : 0;
          map.set(row.statId, {
            id: row.id,
            statId: row.statId,
            name: row.name,
            area: row.area,
            boundaryType: row.boundaryType,
            date: row.date,
            type: row.type,
            data: row.data ?? {},
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

