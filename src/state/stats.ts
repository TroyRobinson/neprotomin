import type { Stat } from "../types/stat";
import { db } from "../lib/db";
import { ensureStatsSeeded, ensureStatDataSeeded } from "../lib/seed";

const STATS_QUERY = {
  stats: {
    $: {
      order: { name: "asc" as const },
    },
  },
};

type Listener = (stats: Stat[]) => void;

class StatsStore {
  private listeners = new Set<Listener>();
  private data: Stat[] = [];
  private unsubscribe: (() => void) | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.data);
    this.initialize();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.teardown();
    };
  }

  private initialize() {
    if (this.unsubscribe) return;
    try {
      this.unsubscribe = db.subscribeQuery(STATS_QUERY, (resp) => {
        const rows = resp?.data?.stats ?? ([] as any[]);
        const normalized: Stat[] = rows
          .filter((row): row is Stat =>
            Boolean(
              row?.id &&
              typeof (row as any)?.name === "string" &&
              typeof (row as any)?.category === "string",
            ),
          )
          .map((row) => ({
            id: row.id,
            name: (row as any).name,
            category: (row as any).category,
          }));
        this.data = normalized;
        this.emit();
      });
    } catch (error) {
      console.error("Failed to subscribe to stats", error);
    }

    void ensureStatsSeeded();
    // Also seed stat data (root, Tulsa ZIP 2025) once
    void ensureStatDataSeeded();
  }

  private teardown() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private emit() {
    this.listeners.forEach((listener) => listener(this.data));
  }
}

export const statsStore = new StatsStore();
