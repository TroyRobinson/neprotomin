import { useMemo } from "react";
import { db } from "../../lib/reactDb";
import type { AreaKind } from "../../types/areas";
import {
  DEFAULT_PARENT_AREA_BY_KIND,
  DEFAULT_SCOPE_LABEL_BY_KIND,
} from "../../types/areas";
import { useAreas } from "./useAreas";
import { normalizeScopeLabel, buildScopeLabelAliases } from "../../lib/scopeLabels";

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

// Hide demographic breakdowns until we ingest real data, so synthetic legacy rows
// don't appear in the UI and confuse users.
const ENABLE_DEMOGRAPHIC_BREAKDOWNS = false;

export interface BreakdownSegment {
  key: string;
  label: string;
  colorToken: string;
  valuePercent: number;
}

export interface BreakdownGroup {
  key: string;
  segments: BreakdownSegment[];
}

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

type SelectedAreasByKind = Partial<Record<SupportedAreaKind, string[]>>;

interface AggregatedStats {
  selectedCount: number;
  label?: string;
  population?: number;
  avgAge?: number;
  marriedPercent?: number;
}

type AreaSelectionEntry = { kind: SupportedAreaKind; code: string };

interface DefaultContextOption {
  label: string;
  areas: AreaSelectionEntry[];
}

interface UseDemographicsOptions {
  selectedByKind: SelectedAreasByKind;
  defaultContext?: DefaultContextOption | null;
  zipScope?: string | null;
}

export interface DemographicKindSnapshot {
  kind: SupportedAreaKind;
  stats: AggregatedStats | null;
  breakdowns: Map<string, BreakdownGroup>;
  availableIds: string[];
  isMissing: boolean;
}

export interface DemographicsResult {
  demographicsByKind: Map<SupportedAreaKind, DemographicKindSnapshot>;
  combinedSnapshot: CombinedDemographicsSnapshot | null;
}

export interface CombinedDemographicsSnapshot {
  label: string;
  stats: AggregatedStats | null;
  breakdowns: Map<string, BreakdownGroup>;
  isMissing: boolean;
  areaCount: number;
  missingAreaCount: number;
}

const collectLatestRootRows = (
  rows: any[] | undefined,
  statId: string | null,
  parentAreaOverride: Partial<Record<SupportedAreaKind, string | null>>,
): Map<SupportedAreaKind, RootEntry> => {
  const map = new Map<SupportedAreaKind, RootEntry>();
  if (!rows || !statId) return map;

  const grouped = new Map<string, any[]>();

  for (const row of rows) {
    if (!row || row.statId !== statId) continue;
    if (row.name !== "root") continue;
    const kind = row.boundaryType as SupportedAreaKind | undefined;
    if (!kind || !SUPPORTED_AREA_KINDS.includes(kind)) continue;
    const expectedParent = parentAreaOverride[kind] ?? DEFAULT_PARENT_AREA_BY_KIND[kind];
    const aliases = buildScopeLabelAliases(expectedParent);
    const normalizedActual = normalizeScopeLabel(
      typeof row.parentArea === "string" ? (row.parentArea as string) : null,
    );
    if (aliases.length > 0) {
      if (!normalizedActual || !aliases.includes(normalizedActual)) continue;
    }
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
  parentAreaOverride: Partial<Record<SupportedAreaKind, string | null>>,
): BreakdownSourceMap => {
  const map: BreakdownSourceMap = new Map();
  if (!rows || !statId) return map;

  for (const row of rows) {
    if (!row || row.statId !== statId) continue;
    if (row.name === "root") continue;
    const kind = row.boundaryType as SupportedAreaKind | undefined;
    if (!kind || !SUPPORTED_AREA_KINDS.includes(kind)) continue;
    const expectedParent = parentAreaOverride[kind] ?? DEFAULT_PARENT_AREA_BY_KIND[kind];
    const aliases = buildScopeLabelAliases(expectedParent);
    const normalizedActual = normalizeScopeLabel(
      typeof row.parentArea === "string" ? (row.parentArea as string) : null,
    );
    if (aliases.length > 0) {
      if (!normalizedActual || !aliases.includes(normalizedActual)) continue;
    }
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
  zipScopeLabel?: string | null,
): string => {
  if (resolvedSelection.length === 1) {
    return getAreaName(kind, resolvedSelection[0]) ?? resolvedSelection[0];
  }
  if (resolvedSelection.length > 1) {
    return pluralLabelForKind(kind);
  }
  if (fallbackIds.length === 1) {
    return getAreaName(kind, fallbackIds[0]) ?? fallbackIds[0];
  }
  if (kind === "ZIP" && zipScopeLabel) {
    return `${zipScopeLabel} ZIPs`.toUpperCase();
  }
  return buildDefaultLabel(kind);
};

export const useDemographics = ({
  selectedByKind,
  defaultContext = null,
  zipScope = null,
}: UseDemographicsOptions): DemographicsResult => {
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

  const avgAgeStatId = useMemo(() => {
    if (!data?.stats) return null;
    const candidates = ["Median Age", "Average Age"];
    for (const label of candidates) {
      const match = data.stats.find((s) => s?.name === label);
      if (match?.id) return match.id;
    }
    return null;
  }, [data?.stats]);

  const marriedPercentStatId = useMemo(
    () => data?.stats?.find((s) => s?.name === "Married Percent")?.id || null,
    [data?.stats],
  );

  const normalizedZipScope =
    normalizeScopeLabel(zipScope) ??
    (normalizeScopeLabel(DEFAULT_PARENT_AREA_BY_KIND.ZIP ?? "Oklahoma") ?? "Oklahoma");
  const parentAreaOverride = useMemo<Partial<Record<SupportedAreaKind, string | null>>>(
    () => ({ ZIP: normalizedZipScope }),
    [normalizedZipScope],
  );

  const populationRoots = useMemo(
    () => collectLatestRootRows(data?.statData, populationStatId, parentAreaOverride),
    [data?.statData, populationStatId, parentAreaOverride],
  );

  const avgAgeRoots = useMemo(
    () => collectLatestRootRows(data?.statData, avgAgeStatId, parentAreaOverride),
    [data?.statData, avgAgeStatId, parentAreaOverride],
  );

  const marriedRoots = useMemo(
    () => collectLatestRootRows(data?.statData, marriedPercentStatId, parentAreaOverride),
    [data?.statData, marriedPercentStatId, parentAreaOverride],
  );

  const latestPopulationDates = useMemo(() => {
    const map = new Map<SupportedAreaKind, string | null>();
    for (const [kind, entry] of populationRoots.entries()) {
      map.set(kind, entry?.date ?? null);
    }
    return map;
  }, [populationRoots]);

  const breakdownSources = useMemo(() => {
    if (!ENABLE_DEMOGRAPHIC_BREAKDOWNS) {
      return new Map<SupportedAreaKind, Map<BreakdownGroupKey, BreakdownSourceSegment[]>>();
    }
    return collectBreakdownSources(data?.statData, populationStatId, latestPopulationDates, parentAreaOverride);
  }, [data?.statData, populationStatId, latestPopulationDates, parentAreaOverride]);

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

      let stats: AggregatedStats | null = null;
      if (populationEntry && (totalPopulation > 0 || populationCount > 0)) {
      const label = buildAreaLabel(kind, resolvedSelection, targetIds, getAreaName, normalizedZipScope);
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
      if (ENABLE_DEMOGRAPHIC_BREAKDOWNS && breakdownSource) {
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

  const combinedSnapshot = useMemo(() => {
    const uniqueAreas = (entries: AreaSelectionEntry[]): AreaSelectionEntry[] => {
      const seen = new Set<string>();
      const result: AreaSelectionEntry[] = [];
      for (const entry of entries) {
        const key = `${entry.kind}:${entry.code}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(entry);
      }
      return result;
    };

    const aggregateAreas = (
      areas: AreaSelectionEntry[],
      label: string,
      selectedCount: number,
    ): CombinedDemographicsSnapshot => {
      const distinctAreas = uniqueAreas(areas);
      const areaCount = distinctAreas.length;

      let totalPopulation = 0;
      let weightedAge = 0;
      let weightedAgeDenominator = 0;
      let weightedMarried = 0;
      let weightedMarriedDenominator = 0;
      let areasWithPopulation = 0;

      const breakdownAccumulator = new Map<
        string,
        { weight: number; totals: Map<string, number> }
      >();

      for (const area of distinctAreas) {
        const populationEntry = populationRoots.get(area.kind);
        const popValue = populationEntry?.data?.[area.code];
        const weight = typeof popValue === "number" && Number.isFinite(popValue)
          ? Math.max(popValue, 0)
          : 0;

        if (weight > 0) {
          areasWithPopulation += 1;
          totalPopulation += weight;

          const ageValue = avgAgeRoots.get(area.kind)?.data?.[area.code];
          if (typeof ageValue === "number" && Number.isFinite(ageValue)) {
            weightedAge += ageValue * weight;
            weightedAgeDenominator += weight;
          }

          const marriedValue = marriedRoots.get(area.kind)?.data?.[area.code];
          if (typeof marriedValue === "number" && Number.isFinite(marriedValue)) {
            weightedMarried += marriedValue * weight;
            weightedMarriedDenominator += weight;
          }

          const source = ENABLE_DEMOGRAPHIC_BREAKDOWNS ? breakdownSources.get(area.kind) : undefined;
          if (ENABLE_DEMOGRAPHIC_BREAKDOWNS && source) {
            for (const [groupKey, segments] of source) {
              const acc = breakdownAccumulator.get(groupKey) ?? { weight: 0, totals: new Map<string, number>() };
              for (const segment of segments) {
                const v = segment.values?.[area.code];
                if (typeof v === "number" && Number.isFinite(v)) {
                  acc.totals.set(segment.key, (acc.totals.get(segment.key) ?? 0) + v * weight);
                }
              }
              acc.weight += weight;
              breakdownAccumulator.set(groupKey, acc);
            }
          }
        }
      }

      let stats: AggregatedStats | null = null;
      if (areasWithPopulation > 0) {
        stats = {
          selectedCount,
          label,
          population: totalPopulation || undefined,
        };
        if (weightedAgeDenominator > 0) {
          stats.avgAge = weightedAge / weightedAgeDenominator;
        }
        if (weightedMarriedDenominator > 0) {
          stats.marriedPercent = weightedMarried / weightedMarriedDenominator;
        }
      }

      const breakdowns = new Map<string, BreakdownGroup>();
      if (ENABLE_DEMOGRAPHIC_BREAKDOWNS) {
        for (const [groupKey, acc] of breakdownAccumulator.entries()) {
          const typedGroupKey = groupKey as BreakdownGroupKey;
          const order = SEGMENT_ORDER[typedGroupKey] ?? [];
          const segments: BreakdownSegment[] = order.map((segKey, index) => {
            const sum = acc.totals.get(segKey) ?? 0;
            const percent = acc.weight > 0 ? Math.round(sum / acc.weight) : 0;
            return {
              key: segKey,
              label: SEGMENT_LABELS[typedGroupKey]?.[segKey] ?? segKey,
              colorToken: BRAND_SHADE_TOKENS[Math.min(index, BRAND_SHADE_TOKENS.length - 1)],
              valuePercent: Math.max(0, Math.min(100, percent)),
            };
          });
          breakdowns.set(groupKey, { key: groupKey, segments });
        }
      }

      return {
        label,
        stats,
        breakdowns,
        isMissing: areasWithPopulation === 0,
        areaCount,
        missingAreaCount: areaCount - areasWithPopulation,
      };
    };

    const selectedEntries: AreaSelectionEntry[] = [];
    for (const kind of SUPPORTED_AREA_KINDS) {
      const codes = dedupe(selectedByKind[kind]);
      for (const code of codes) {
        if (typeof code === "string" && code.length > 0) {
          selectedEntries.push({ kind, code });
        }
      }
    }

    const activeEntries = selectedEntries.length > 0
      ? selectedEntries
      : defaultContext?.areas ?? [];

    if (activeEntries.length === 0) {
      return null;
    }

    let label: string;
    if (selectedEntries.length > 0) {
      if (selectedEntries.length === 1) {
        const entry = selectedEntries[0];
        label = getAreaName(entry.kind, entry.code) ?? entry.code;
      } else {
        label = `Selected Areas (${selectedEntries.length})`;
      }
    } else {
      label = defaultContext?.label ?? "All Oklahoma";
    }

    return aggregateAreas(activeEntries, label, selectedEntries.length);
  }, [
    selectedByKind,
    defaultContext,
    populationRoots,
    avgAgeRoots,
    marriedRoots,
    breakdownSources,
    getAreaName,
  ]);

  return { demographicsByKind, combinedSnapshot };
};
