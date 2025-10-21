import { useMemo } from "react";
import { db } from "../../lib/reactDb";
import type { DemographicStats, BreakdownGroup } from "../components/DemographicsBar";
import type { AreaKind } from "../../types/areas";
import {
  DEFAULT_PARENT_AREA_BY_KIND,
  DEFAULT_SCOPE_LABEL_BY_KIND,
} from "../../types/areas";
import { useAreas } from "./useAreas";

type SupportedAreaKind = Extract<AreaKind, "ZIP" | "COUNTY">;

type BreakdownGroupKey = "ethnicity" | "income" | "education";

const SUPPORTED_AREA_KINDS: SupportedAreaKind[] = ["ZIP", "COUNTY"];

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

const BRAND_SHADE_TOKENS = ["brand-200", "brand-300", "brand-400", "brand-500", "brand-700"];

const BREAKDOWN_KEYS: BreakdownGroupKey[] = ["ethnicity", "income", "education"];

const dedupe = (values: string[] | undefined): string[] => {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      seen.add(value.trim());
    }
  }
  return Array.from(seen);
};

const parseDate = (value: unknown): string | null => {
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  return null;
};

const buildDefaultLabel = (kind: SupportedAreaKind): string =>
  (DEFAULT_SCOPE_LABEL_BY_KIND[kind] || kind).toUpperCase();

const pluralLabelForKind = (kind: SupportedAreaKind): string =>
  kind === "ZIP" ? "ZIPs" : kind === "COUNTY" ? "counties" : "areas";

const isBreakdownGroupKey = (value: unknown): value is BreakdownGroupKey =>
  typeof value === "string" && (BREAKDOWN_KEYS as string[]).includes(value);

type RootEntry = {
  data: Record<string, number>;
  date: string | null;
  type: string | null;
  parentArea: string | null;
};

type BreakdownSourceSegment = {
  key: string;
  label: string;
  colorToken: string;
  values: Record<string, number>;
};

type BreakdownSourceMap = Map<SupportedAreaKind, Map<BreakdownGroupKey, BreakdownSourceSegment[]>>;

type SelectedAreasByKind = Partial<Record<AreaKind, string[]>>;

export interface DemographicKindSnapshot {
  kind: SupportedAreaKind;
  stats: DemographicStats | null;
  breakdowns: Map<string, BreakdownGroup>;
  availableIds: string[];
  isMissing: boolean;
}

export interface DemographicsResult {
  demographicsByKind: Map<SupportedAreaKind, DemographicKindSnapshot>;
}

const collectLatestRootRows = (
  rows: any[] | undefined,
  statId: string | null,
): Map<SupportedAreaKind, RootEntry> => {
  const map = new Map<SupportedAreaKind, RootEntry>();
  if (!rows || !statId) return map;

  const grouped = new Map<string, any[]>();

  for (const row of rows) {
    if (!row || row.statId !== statId) continue;
    if (row.name !== "root") continue;
    const kind = row.boundaryType as SupportedAreaKind | undefined;
    if (!kind || !SUPPORTED_AREA_KINDS.includes(kind)) continue;
    const expectedParent = DEFAULT_PARENT_AREA_BY_KIND[kind];
    if (expectedParent && row.parentArea !== expectedParent) continue;
    const key = `${kind}::${expectedParent ?? ""}`;
    const list = grouped.get(key) ?? [];
    list.push(row);
    grouped.set(key, list);
  }

  for (const [, list] of grouped) {
    if (!list.length) continue;
    list.sort((a, b) => {
      const da = parseDate(a?.date) ?? "";
      const db = parseDate(b?.date) ?? "";
      return da.localeCompare(db);
    });
    const latest = list[list.length - 1];
    const kind = latest?.boundaryType as SupportedAreaKind | undefined;
    if (!kind || !SUPPORTED_AREA_KINDS.includes(kind)) continue;
    map.set(kind, {
      data: (latest?.data ?? {}) as Record<string, number>,
      date: parseDate(latest?.date),
      type: typeof latest?.type === "string" ? (latest.type as string) : null,
      parentArea: typeof latest?.parentArea === "string" ? (latest.parentArea as string) : null,
    });
  }

  return map;
};

const collectBreakdownSources = (
  rows: any[] | undefined,
  statId: string | null,
  latestDates: Map<SupportedAreaKind, string | null>,
): BreakdownSourceMap => {
  const map: BreakdownSourceMap = new Map();
  if (!rows || !statId) return map;

  for (const row of rows) {
    if (!row || row.statId !== statId) continue;
    if (row.name === "root") continue;
    const kind = row.boundaryType as SupportedAreaKind | undefined;
    if (!kind || !SUPPORTED_AREA_KINDS.includes(kind)) continue;
    const expectedParent = DEFAULT_PARENT_AREA_BY_KIND[kind];
    if (expectedParent && row.parentArea !== expectedParent) continue;
    const latestDate = latestDates.get(kind);
    const rowDate = parseDate(row?.date);
    if (latestDate && rowDate && latestDate !== rowDate) continue;
    const name = typeof row?.name === "string" ? (row.name as string) : "";
    const [groupKey, segmentKey] = name.split(":");
    if (!isBreakdownGroupKey(groupKey) || !segmentKey) continue;

    const sourceByKind = map.get(kind) ?? new Map<BreakdownGroupKey, BreakdownSourceSegment[]>();
    const segments = sourceByKind.get(groupKey) ?? [];
    const existing = segments.find((s) => s.key === segmentKey);
    if (existing) {
      existing.values = (row?.data ?? {}) as Record<string, number>;
    } else {
      const idx = SEGMENT_ORDER[groupKey].findIndex((id) => id === segmentKey);
      const token = BRAND_SHADE_TOKENS[Math.min(Math.max(idx, 0), BRAND_SHADE_TOKENS.length - 1)];
      segments.push({
        key: segmentKey,
        label: SEGMENT_LABELS[groupKey][segmentKey] ?? segmentKey,
        colorToken: token,
        values: (row?.data ?? {}) as Record<string, number>,
      });
    }
    sourceByKind.set(groupKey, segments);
    map.set(kind, sourceByKind);
  }

  // Ensure segments follow the declared order for consistency
  return map;
};

const buildAreaLabel = (
  kind: SupportedAreaKind,
  resolvedSelection: string[],
  fallbackIds: string[],
  getAreaName: (kind: SupportedAreaKind, code: string) => string | null,
): string => {
  if (resolvedSelection.length === 1) {
    return getAreaName(kind, resolvedSelection[0]) ?? resolvedSelection[0];
  }
  if (resolvedSelection.length > 1) {
    return `${resolvedSelection.length} ${pluralLabelForKind(kind)}`;
  }
  if (fallbackIds.length === 1) {
    return getAreaName(kind, fallbackIds[0]) ?? fallbackIds[0];
  }
  return buildDefaultLabel(kind);
};

export const useDemographics = (selectedByKind: SelectedAreasByKind): DemographicsResult => {
  const { isLoading: isAuthLoading } = db.useAuth();
  const { areasByKindAndCode } = useAreas();

  const { data } = db.useQuery(
    isAuthLoading
      ? null
      : {
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
        },
  );

  const populationStatId = useMemo(() => {
    const provided = "29d2b2e4-52e1-4f36-b212-abd06de3f92a";
    if (data?.stats?.some((s) => s?.id === provided)) return provided;
    const byName = data?.stats?.find((s) => s?.name === "Population");
    return byName?.id || null;
  }, [data?.stats]);

  const avgAgeStatId = useMemo(
    () => data?.stats?.find((s) => s?.name === "Average Age")?.id || null,
    [data?.stats],
  );

  const marriedPercentStatId = useMemo(
    () => data?.stats?.find((s) => s?.name === "Married Percent")?.id || null,
    [data?.stats],
  );

  const populationRoots = useMemo(
    () => collectLatestRootRows(data?.statData, populationStatId),
    [data?.statData, populationStatId],
  );

  const avgAgeRoots = useMemo(
    () => collectLatestRootRows(data?.statData, avgAgeStatId),
    [data?.statData, avgAgeStatId],
  );

  const marriedRoots = useMemo(
    () => collectLatestRootRows(data?.statData, marriedPercentStatId),
    [data?.statData, marriedPercentStatId],
  );

  const latestPopulationDates = useMemo(() => {
    const map = new Map<SupportedAreaKind, string | null>();
    for (const [kind, entry] of populationRoots.entries()) {
      map.set(kind, entry?.date ?? null);
    }
    return map;
  }, [populationRoots]);

  const breakdownSources = useMemo(
    () => collectBreakdownSources(data?.statData, populationStatId, latestPopulationDates),
    [data?.statData, populationStatId, latestPopulationDates],
  );

  const getAreaName = (kind: SupportedAreaKind, code: string): string | null => {
    const byCode = areasByKindAndCode.get(kind);
    const record = byCode?.get(code);
    return record?.name ?? null;
  };

  // Aggregate stats + breakdowns for each supported boundary type using the latest stat snapshots.
  const demographicsByKind = useMemo(() => {
    const map = new Map<SupportedAreaKind, DemographicKindSnapshot>();

    for (const kind of SUPPORTED_AREA_KINDS) {
      const populationEntry = populationRoots.get(kind);
      const avgAgeEntry = avgAgeRoots.get(kind);
      const marriedEntry = marriedRoots.get(kind);
      const breakdownSource = breakdownSources.get(kind);

      const availableIds = populationEntry ? Object.keys(populationEntry.data ?? {}) : [];
      const availableSet = new Set(availableIds);

      const rawSelection = dedupe(selectedByKind[kind]);
      const resolvedSelection = rawSelection.filter((code) => availableSet.has(code));
      const targetIds = resolvedSelection.length > 0 ? resolvedSelection : availableIds;

      let totalPopulation = 0;
      let populationCount = 0;
      let weightedAge = 0;
      let weightedAgeDenominator = 0;
      let weightedMarried = 0;
      let weightedMarriedDenominator = 0;

      if (populationEntry) {
        for (const code of targetIds) {
          const popValue = populationEntry.data?.[code];
          if (typeof popValue === "number" && Number.isFinite(popValue)) {
            const safePop = Math.max(0, popValue);
            totalPopulation += safePop;
            populationCount += safePop > 0 ? 1 : 0;

            const ageValue = avgAgeEntry?.data?.[code];
            if (typeof ageValue === "number" && Number.isFinite(ageValue) && safePop > 0) {
              weightedAge += ageValue * safePop;
              weightedAgeDenominator += safePop;
            }

            const marriedValue = marriedEntry?.data?.[code];
            if (typeof marriedValue === "number" && Number.isFinite(marriedValue) && safePop > 0) {
              weightedMarried += marriedValue * safePop;
              weightedMarriedDenominator += safePop;
            }
          }
        }
      }

      let stats: DemographicStats | null = null;
      if (populationEntry && (totalPopulation > 0 || populationCount > 0)) {
        const label = buildAreaLabel(kind, resolvedSelection, targetIds, getAreaName);
        stats = {
          selectedCount: rawSelection.length,
          label,
          population: totalPopulation > 0 ? totalPopulation : undefined,
        };
        if (weightedAgeDenominator > 0) {
          stats.avgAge = weightedAge / weightedAgeDenominator;
        }
        if (weightedMarriedDenominator > 0) {
          stats.marriedPercent = weightedMarried / weightedMarriedDenominator;
        }
      }

      const breakdowns = new Map<string, BreakdownGroup>();
      if (breakdownSource) {
        const baselineIds =
          resolvedSelection.length > 0
            ? resolvedSelection
            : (() => {
                for (const segments of breakdownSource.values()) {
                  const first = segments[0];
                  if (first) return Object.keys(first.values ?? {});
                }
                return availableIds;
              })();
        const denom = Math.max(baselineIds.length, 1);

        for (const groupKey of BREAKDOWN_KEYS) {
          const segments = breakdownSource.get(groupKey);
          if (!segments || segments.length === 0) continue;

          const orderedSegments = SEGMENT_ORDER[groupKey].map((segKey, index) => {
            const match = segments.find((seg) => seg.key === segKey);
            const values = match?.values ?? {};
            let aggregate = 0;
            for (const code of baselineIds) {
              const v = values[code];
              if (typeof v === "number" && Number.isFinite(v)) {
                aggregate += v;
              }
            }
            const avg = aggregate / denom;
            const valuePercent = Math.max(0, Math.min(100, Math.round(avg)));
            const colorToken = match?.colorToken ?? BRAND_SHADE_TOKENS[Math.min(index, BRAND_SHADE_TOKENS.length - 1)];
            const label = match?.label ?? SEGMENT_LABELS[groupKey][segKey] ?? segKey;
            return { key: segKey, label, colorToken, valuePercent };
          });

          const total = orderedSegments.reduce((sum, seg) => sum + seg.valuePercent, 0);
          let remainder = 100 - total;
          if (remainder !== 0 && orderedSegments.length > 0) {
            let idxAdjust = 0;
            let maxValue = -1;
            for (let i = 0; i < orderedSegments.length; i++) {
              if (orderedSegments[i].valuePercent > maxValue) {
                maxValue = orderedSegments[i].valuePercent;
                idxAdjust = i;
              }
            }
            orderedSegments[idxAdjust] = {
              ...orderedSegments[idxAdjust],
              valuePercent: Math.max(
                0,
                Math.min(100, orderedSegments[idxAdjust].valuePercent + remainder),
              ),
            };
          }

          breakdowns.set(groupKey, { key: groupKey, segments: orderedSegments });
        }
      }

      const snapshot: DemographicKindSnapshot = {
        kind,
        stats,
        breakdowns,
        availableIds,
        isMissing: !populationEntry || availableIds.length === 0,
      };

      map.set(kind, snapshot);
    }

    return map;
  }, [
    areasByKindAndCode,
    selectedByKind,
    populationRoots,
    avgAgeRoots,
    marriedRoots,
    breakdownSources,
  ]);

  return { demographicsByKind };
};
