import { db } from "../lib/db";

type SeriesEntry = {
  date: string; // e.g., "2023"
  type: string; // stat type (percent | rate | years | currency | count)
  data: Record<string, number>;
};

type Listener = (byStatId: Map<string, SeriesEntry[]>) => void;

const QUERY = {
  statData: {
    $: {
      order: { date: "asc" as const },
    },
  },
};

const getParentArea = (row: any): string | undefined => {
  if (row && typeof row.parentArea === "string" && row.parentArea.length > 0) {
    return row.parentArea;
  }
  return undefined;
};

class StatSeriesStore {
  private listeners = new Set<Listener>();
  private byStatId: Map<string, SeriesEntry[]> = new Map();
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
        const filtered = rows.filter((row) =>
          Boolean(
            row?.id &&
              typeof (row as any)?.statId === "string" &&
              (row as any)?.name === "root" &&
              (row as any)?.boundaryType === "ZIP" &&
              typeof (row as any)?.date === "string" &&
              typeof (row as any)?.type === "string" &&
              typeof (row as any)?.data === "object" &&
              typeof getParentArea(row) === "string" &&
              getParentArea(row) === "Tulsa",
          ),
        );

        const map = new Map<string, SeriesEntry[]>();
        for (const row of filtered) {
          const statId = (row as any).statId as string;
          const entry: SeriesEntry = {
            date: (row as any).date,
            type: (row as any).type,
            data: ((row as any).data ?? {}) as Record<string, number>,
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

        this.byStatId = map;
        this.emit();
      });
    } catch (error) {
      console.error("Failed to subscribe to stat series", error);
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

export const statSeriesStore = new StatSeriesStore();
