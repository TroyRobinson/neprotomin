import type { Stat } from "../types/stat";
import { normalizeStatVisibility } from "../types/stat";
import { db } from "../lib/db";

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
        if (!resp.data) return;
        const rows = resp?.data?.stats ?? ([] as any[]);
        const normalized: Stat[] = rows
          .filter(
            (row) =>
              Boolean(
                row?.id &&
                typeof (row as any)?.name === "string" &&
                typeof (row as any)?.category === "string",
              ),
          )
          .map((row) => ({
            id: row.id,
            name: (row as any).name,
            label: typeof (row as any).label === "string" ? (row as any).label : undefined,
            description:
              typeof (row as any).description === "string" && (row as any).description.trim()
                ? (row as any).description
                : undefined,
            source:
              typeof (row as any).source === "string" && (row as any).source.trim()
                ? (row as any).source
                : undefined,
            category: (row as any).category,
            goodIfUp: typeof (row as any).goodIfUp === "boolean" ? (row as any).goodIfUp : undefined,
            pointsOfInterestEnabled:
              typeof (row as any).pointsOfInterestEnabled === "boolean"
                ? (row as any).pointsOfInterestEnabled
                : undefined,
            featured: typeof (row as any).featured === "boolean" ? (row as any).featured : undefined,
            homeFeatured:
              typeof (row as any).homeFeatured === "boolean" ? (row as any).homeFeatured : undefined,
            active: typeof (row as any).active === "boolean" ? (row as any).active : undefined,
            visibility: normalizeStatVisibility((row as any).visibility) ?? undefined,
            visibilityEffective:
              normalizeStatVisibility((row as any).visibilityEffective) ?? undefined,
            createdBy: typeof (row as any).createdBy === "string" ? (row as any).createdBy : undefined,
          }));
        this.data = normalized;
        this.emit();
      });
    } catch (error) {
      console.error("Failed to subscribe to stats", error);
    }

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
