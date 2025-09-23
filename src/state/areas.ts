import type { Area } from "../types/area";
import { db } from "../lib/db";
import { ensureAreasSeeded } from "../lib/seed";

const AREAS_QUERY = {
  areas: {
    $: {
      order: { key: "asc" as const },
    },
  },
};

type Listener = (areas: Area[]) => void;

class AreasStore {
  private listeners = new Set<Listener>();
  private data: Area[] = [];
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
      this.unsubscribe = db.subscribeQuery(AREAS_QUERY, (resp) => {
        const rows = resp?.data?.areas ?? [];
        const normalized: Area[] = rows
          .filter((row): row is Area =>
            Boolean(
              row?.id &&
                typeof (row as any)?.key === "string" &&
                typeof (row as any)?.type === "string" &&
                typeof (row as any)?.population === "number" &&
                typeof (row as any)?.avgAge === "number" &&
                typeof (row as any)?.marriedPercent === "number",
            ),
          )
          .map((row) => ({
            id: row.id,
            key: (row as any).key,
            type: (row as any).type,
            population: (row as any).population,
            avgAge: (row as any).avgAge,
            marriedPercent: (row as any).marriedPercent,
          }));

        this.data = normalized;
        this.emit();
      });
    } catch (error) {
      console.error("Failed to subscribe to areas", error);
    }

    void ensureAreasSeeded();
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

export const areasStore = new AreasStore();

