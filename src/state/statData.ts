import type { StatData } from "../types/statData";
import { db } from "../lib/db";
import type { AreaKind } from "../types/areas";
import { DEFAULT_PARENT_AREA_BY_KIND } from "../types/areas";

type BoundaryStatEntry = {
  id: string;
  statId: string;
  name: string;
  parentArea: string;
  boundaryType: string;
  date: string;
  type: string;
  data: Record<string, number>;
  min: number;
  max: number;
};

type BoundaryTypeKey = Extract<AreaKind, "ZIP" | "COUNTY">;

type StatDataMapEntry = Partial<Record<BoundaryTypeKey, BoundaryStatEntry>>;

type Listener = (byStatId: Map<string, StatDataMapEntry>) => void;

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

class StatDataStore {
  private listeners = new Set<Listener>();
  private byStatId: Map<string, StatDataMapEntry> = new Map();
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
              typeof (row as any)?.name === "string" &&
              typeof (row as any)?.boundaryType === "string" &&
              typeof (row as any)?.date === "string" &&
              typeof (row as any)?.type === "string" &&
              typeof (row as any)?.data === "object" &&
              typeof getParentArea(row) === "string",
          ),
        ) as StatData[];

        const relevantBoundaryTypes: Partial<Record<BoundaryTypeKey, string>> = {
          ZIP: DEFAULT_PARENT_AREA_BY_KIND.ZIP ?? undefined,
          COUNTY: DEFAULT_PARENT_AREA_BY_KIND.COUNTY ?? undefined,
        };

        const grouped = new Map<string, StatData[]>();
        for (const row of filtered) {
          const rawType = row.boundaryType;
          if (rawType !== "ZIP" && rawType !== "COUNTY") continue;
          const boundaryType = rawType as BoundaryTypeKey;
          const parentArea = getParentArea(row);
          if (!parentArea) continue;
          const expectedArea = relevantBoundaryTypes[boundaryType];
          if (!expectedArea || parentArea !== expectedArea) continue;
          if (row.name !== "root") continue;
          const key = `${row.statId}::${boundaryType}`;
          const list = grouped.get(key) || [];
          list.push(row);
          grouped.set(key, list);
        }

        const map = new Map<string, StatDataMapEntry>();
        for (const [, list] of grouped) {
          list.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
          const latest = list[0];
          const entries = Object.values(latest.data ?? {}).filter(
            (value): value is number => typeof value === "number" && Number.isFinite(value),
          );
          const min = entries.length ? Math.min(...entries) : 0;
          const max = entries.length ? Math.max(...entries) : 0;
          const boundaryType = latest.boundaryType as BoundaryTypeKey;
          const parentArea = getParentArea(latest);
          if (!parentArea) continue;
          const statEntry: BoundaryStatEntry = {
            id: latest.id,
            statId: latest.statId,
            name: latest.name,
            parentArea,
            boundaryType: latest.boundaryType,
            date: latest.date,
            type: latest.type,
            data: latest.data ?? {},
            min,
            max,
          };
          const statMapEntry = map.get(latest.statId) || ({} as StatDataMapEntry);
          statMapEntry[boundaryType] = statEntry;
          map.set(latest.statId, statMapEntry);
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
