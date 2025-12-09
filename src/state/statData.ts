import { db } from "../lib/db";
import { normalizeScopeLabel } from "../lib/scopeLabels";
import type { StatData } from "../types/statData";
import type { AreaKind } from "../types/areas";

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

type ParentAreaKey = string;

type StatDataMapEntry = Partial<Record<BoundaryTypeKey, BoundaryStatEntry>>;

export type StatDataByParentArea = Map<ParentAreaKey, StatDataMapEntry>;

type Listener = (byStatId: Map<string, StatDataByParentArea>) => void;

const QUERY = {
  statData: {
    $: {
      fields: ["id", "statId", "name", "parentArea", "boundaryType", "date", "type", "data"],
      where: { name: "root", boundaryType: { $in: ["ZIP", "COUNTY"] } },
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
  private byStatId: Map<string, StatDataByParentArea> = new Map();
  private unsubscribe: (() => void) | null = null;
  private enabled = true;

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
    if (!this.enabled) return;
    if (this.unsubscribe) return;
    try {
      this.unsubscribe = db.subscribeQuery(QUERY, (resp) => {
        if (!resp.data) return;
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

        const grouped = new Map<string, Map<ParentAreaKey, Map<BoundaryTypeKey, StatData[]>>>();
        for (const row of filtered) {
          const rawType = row.boundaryType;
          if (rawType !== "ZIP" && rawType !== "COUNTY") continue;
          const boundaryType = rawType as BoundaryTypeKey;
          const parentArea = getParentArea(row);
          if (!parentArea) continue;
          if (row.name !== "root") continue;
          const normalizedParent = normalizeScopeLabel(parentArea);
          if (!normalizedParent) continue;
          const statKey = row.statId;
          let statGroup = grouped.get(statKey);
          if (!statGroup) {
            statGroup = new Map();
            grouped.set(statKey, statGroup);
          }
          let parentGroup = statGroup.get(normalizedParent);
          if (!parentGroup) {
            parentGroup = new Map();
            statGroup.set(normalizedParent, parentGroup);
          }
          const list = parentGroup.get(boundaryType) || [];
          list.push(row);
          parentGroup.set(boundaryType, list);
        }

        const map = new Map<string, StatDataByParentArea>();
        for (const [statId, parentMap] of grouped.entries()) {
          const parentEntries: StatDataByParentArea = new Map();
          for (const [parentArea, boundaryMap] of parentMap.entries()) {
            const boundaryEntries: StatDataMapEntry = {};
            for (const [boundaryType, list] of boundaryMap.entries()) {
              list.sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")));
              const latest = list[0];
              if (!latest) continue;
              const entries = Object.values(latest.data ?? {}).filter(
                (value): value is number => typeof value === "number" && Number.isFinite(value),
              );
              const min = entries.length ? Math.min(...entries) : 0;
              const max = entries.length ? Math.max(...entries) : 0;
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
              boundaryEntries[boundaryType] = statEntry;
            }
            if (Object.keys(boundaryEntries).length > 0) {
              parentEntries.set(parentArea, boundaryEntries);
            }
          }
          if (parentEntries.size > 0) {
            map.set(statId, parentEntries);
          }
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

  setEnabled(enabled: boolean) {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (!enabled) {
      this.teardown();
    } else if (this.listeners.size > 0) {
      this.initialize();
    }
  }
}

export const statDataStore = new StatDataStore();
export const setStatDataSubscriptionEnabled = (enabled: boolean) =>
  statDataStore.setEnabled(enabled);
