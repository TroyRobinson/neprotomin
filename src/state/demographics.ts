import { db } from "../lib/db";

type BreakdownGroupKey = "ethnicity" | "income" | "education";

export type DemographicBreakdown = {
  key: BreakdownGroupKey;
  segments: { key: string; label: string; colorToken: string; valueByZip: Record<string, number> }[];
};

type Listener = (breakdowns: Map<BreakdownGroupKey, DemographicBreakdown>) => void;

const STAT_QUERY = {
  stats: { $: { order: { name: "asc" as const } } },
};

const DATA_QUERY = {
  statData: { $: { order: { date: "asc" as const } } },
};

const SEGMENT_LABELS: Record<BreakdownGroupKey, Record<string, string>> = {
  ethnicity: { white: "White", black: "Black", hispanic: "Hispanic", asian: "Asian", other: "Other" },
  income: { low: "Low", middle: "Middle", high: "High" },
  education: { hs_or_less: "HS or Less", some_college: "Some College", bachelor_plus: "Bachelor+" },
};

const SEGMENT_ORDER: Record<BreakdownGroupKey, string[]> = {
  ethnicity: ["white", "black", "hispanic", "asian", "other"],
  income: ["low", "middle", "high"],
  education: ["hs_or_less", "some_college", "bachelor_plus"],
};

// Use brand color shades for segments; order them light -> dark
const BRAND_SHADE_TOKENS = ["brand-200", "brand-300", "brand-400", "brand-500", "brand-700"];

const getParentArea = (row: any): string | undefined => {
  if (row && typeof row.parentArea === "string" && row.parentArea.length > 0) {
    return row.parentArea;
  }
  return undefined;
};

class DemographicsStore {
  private listeners = new Set<Listener>();
  private byGroup: Map<BreakdownGroupKey, DemographicBreakdown> = new Map();
  private unsubscribeStats: (() => void) | null = null;
  private unsubscribeData: (() => void) | null = null;
  private populationStatId: string | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.byGroup);
    this.initialize();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.teardown();
    };
  }

  private initialize() {
    if (this.unsubscribeStats && this.unsubscribeData) return;
    try {
      this.unsubscribeStats = db.subscribeQuery(STAT_QUERY, (resp) => {
        const rows = (resp?.data?.stats ?? []) as any[];
        const pop = rows.find((r) => (r as any)?.name === "Population");
        const nextId = pop?.id || null;
        if (nextId !== this.populationStatId) {
          this.populationStatId = nextId;
          this.recompute();
        }
      });
      this.unsubscribeData = db.subscribeQuery(DATA_QUERY, () => {
        this.recompute();
      });
    } catch (error) {
      console.error("Failed to subscribe to demographics", error);
    }
  }

  private teardown() {
    if (this.unsubscribeStats) {
      this.unsubscribeStats();
      this.unsubscribeStats = null;
    }
    if (this.unsubscribeData) {
      this.unsubscribeData();
      this.unsubscribeData = null;
    }
  }

  private async recompute() {
    const statId = this.populationStatId;
    if (!statId) {
      this.byGroup = new Map();
      return this.emit();
    }

    try {
      const { data } = await db.queryOnce({
        statData: {
          $: { order: { date: "asc" as const } },
        },
      });

      const rows = ((data?.statData ?? []) as any[]).filter(
        (row) =>
          (row as any)?.statId === statId &&
          getParentArea(row) === "Tulsa" &&
          (row as any)?.boundaryType === "ZIP" &&
          (row as any)?.date === "2025",
      );
      const byGroup = new Map<BreakdownGroupKey, DemographicBreakdown>();
      for (const groupKey of Object.keys(SEGMENT_ORDER) as BreakdownGroupKey[]) {
        const segments: { key: string; label: string; colorToken: string; valueByZip: Record<string, number> }[] = [];
        const order = SEGMENT_ORDER[groupKey];
        for (let i = 0; i < order.length; i++) {
          const segKey = order[i];
          const name = `${groupKey}:${segKey}`;
          const row = rows.find((r) => (r as any)?.name === name);
          const colorToken = BRAND_SHADE_TOKENS[Math.min(i, BRAND_SHADE_TOKENS.length - 1)];
          segments.push({
            key: segKey,
            label: SEGMENT_LABELS[groupKey][segKey] || segKey,
            colorToken,
            valueByZip: ((row as any)?.data ?? {}) as Record<string, number>,
          });
        }
        byGroup.set(groupKey, { key: groupKey, segments });
      }

      this.byGroup = byGroup;
      this.emit();
    } catch (error) {
      console.error("Failed to compute demographic breakdowns", error);
    }
  }

  private emit() {
    this.listeners.forEach((l) => l(this.byGroup));
  }
}

export const demographicsStore = new DemographicsStore();
