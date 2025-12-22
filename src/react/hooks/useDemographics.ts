import { useMemo } from "react";
import { db } from "../../lib/reactDb";
import type { AreaKind } from "../../types/areas";
import {
  DEFAULT_PARENT_AREA_BY_KIND,
  DEFAULT_SCOPE_LABEL_BY_KIND,
} from "../../types/areas";
import { useAreas } from "./useAreas";
import { normalizeScopeLabel, buildScopeLabelAliases } from "../../lib/scopeLabels";
import { useAuthSession } from "./useAuthSession";

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
const ENABLE_DEMOGRAPHIC_BREAKDOWNS = true;

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

const buildDefaultLabel = (kind: SupportedAreaKind, zipScopeLabel?: string | null): string => {
  if (kind === "COUNTY") {
    return "Oklahoma";
  }
  if (kind === "ZIP" && zipScopeLabel) {
    // Extract just the county name without "County" suffix for brevity
    const countyName = zipScopeLabel.replace(/\s+County$/i, "").trim();
    return countyName;
  }
  return (DEFAULT_SCOPE_LABEL_BY_KIND[kind] || kind).toUpperCase();
};

const buildFullLabel = (kind: SupportedAreaKind, zipScopeLabel?: string | null): string => {
  if (kind === "COUNTY") {
    return "Oklahoma Counties";
  }
  if (kind === "ZIP" && zipScopeLabel) {
    return `${zipScopeLabel} ZIPs`;
  }
  return (DEFAULT_SCOPE_LABEL_BY_KIND[kind] || kind).toUpperCase();
};

const pluralLabelForKind = (kind: SupportedAreaKind): string =>
  kind === "ZIP" ? "OK ZIPs" : kind === "COUNTY" ? "OK Counties" : "areas";

const isBreakdownGroupKey = (value: unknown): value is BreakdownGroupKey =>
  typeof value === "string" && (BREAKDOWN_KEYS as string[]).includes(value);

type ParentAreaFilter = string | string[] | null | undefined;

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
  fullLabel?: string;
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
  getZipParentCounty?: (zipCode: string) => { code: string; name: string } | null;
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

const normalizeParentAreas = (value: ParentAreaFilter, fallback: string | null | undefined): string[] => {
  const base = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const normalized = base
    .map((entry) => normalizeScopeLabel(entry) ?? null)
    .filter((entry): entry is string => Boolean(entry));
  if (normalized.length > 0) return normalized;
  const normalizedFallback = normalizeScopeLabel(fallback ?? null);
  return normalizedFallback ? [normalizedFallback] : [];
};

const collectLatestRootRows = (
  rows: any[] | undefined,
  statId: string | null,
  parentAreaOverride: Partial<Record<SupportedAreaKind, ParentAreaFilter>>,
  selectedByKind: Partial<Record<SupportedAreaKind, string[]>>,
): Map<SupportedAreaKind, RootEntry> => {
  const map = new Map<SupportedAreaKind, RootEntry>();
  if (!rows || !statId) return map;

  for (const row of rows) {
    if (!row || row.statId !== statId) continue;
    if (row.name !== "root") continue;
    const kind = row.boundaryType as SupportedAreaKind | undefined;
    if (!kind || !SUPPORTED_AREA_KINDS.includes(kind)) continue;
    const selection = dedupe(selectedByKind[kind]);
    const hasSelection = selection.length > 0;

    if (!hasSelection) {
      const expectedParents = normalizeParentAreas(
        parentAreaOverride[kind],
        DEFAULT_PARENT_AREA_BY_KIND[kind],
      );
      const aliasSets = expectedParents.map((parent) => buildScopeLabelAliases(parent));
      const normalizedActual = normalizeScopeLabel(
        typeof row.parentArea === "string" ? (row.parentArea as string) : null,
      );

      if (aliasSets.length > 0) {
        const matches = aliasSets.some((aliases) => {
          if (aliases.length === 0) return false;
          if (!normalizedActual) return false;
          return aliases.includes(normalizedActual);
        });
        if (!matches) continue;
      }
    }

    const incoming: RootEntry = {
      data: (row?.data ?? {}) as Record<string, number>,
      date: parseDate(row?.date),
      type: typeof row?.type === "string" ? (row.type as string) : null,
      parentArea: typeof row?.parentArea === "string" ? (row.parentArea as string) : null,
    };
    const existing = map.get(kind);
    if (!existing) {
      map.set(kind, { ...incoming, data: { ...incoming.data } });
      continue;
    }
    const incomingDate = incoming.date ?? "";
    const existingDate = existing.date ?? "";
    if (incomingDate > existingDate) {
      map.set(kind, { ...incoming, data: { ...incoming.data } });
    } else if (incomingDate === existingDate) {
      map.set(kind, {
        ...existing,
        data: { ...existing.data, ...incoming.data },
      });
    }
  }

  return map;
};

const collectBreakdownSources = (
  rows: any[] | undefined,
  statId: string | null,
  latestDates: Map<SupportedAreaKind, string | null>,
  parentAreaOverride: Partial<Record<SupportedAreaKind, ParentAreaFilter>>,
  selectedByKind: Partial<Record<SupportedAreaKind, string[]>>,
): BreakdownSourceMap => {
  const map: BreakdownSourceMap = new Map();
  if (!rows || !statId) return map;

  for (const row of rows) {
    if (!row || row.statId !== statId) continue;
    if (row.name === "root") continue;
    const kind = row.boundaryType as SupportedAreaKind | undefined;
    if (!kind || !SUPPORTED_AREA_KINDS.includes(kind)) continue;
    const selection = dedupe(selectedByKind[kind]);
    const hasSelection = selection.length > 0;

    if (!hasSelection) {
      const expectedParents = normalizeParentAreas(
        parentAreaOverride[kind],
        DEFAULT_PARENT_AREA_BY_KIND[kind],
      );
      const aliasSets = expectedParents.map((parent) => buildScopeLabelAliases(parent));
      const normalizedActual = normalizeScopeLabel(
        typeof row.parentArea === "string" ? (row.parentArea as string) : null,
      );
      if (aliasSets.length > 0) {
        const matches = aliasSets.some((aliases) => {
          if (aliases.length === 0) return false;
          if (!normalizedActual) return false;
          return aliases.includes(normalizedActual);
        });
        if (!matches) continue;
      }
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
  getZipParentCounty?: (zipCode: string) => { code: string; name: string } | null,
): string => {
  if (resolvedSelection.length === 1) {
    return getAreaName(kind, resolvedSelection[0]) ?? resolvedSelection[0];
  }
  if (resolvedSelection.length > 1) {
    // For ZIPs: check if all selected ZIPs are from the same county
    if (kind === "ZIP" && getZipParentCounty) {
      const countySet = new Set<string>();
      let countyName: string | null = null;
      for (const zipCode of resolvedSelection) {
        const parent = getZipParentCounty(zipCode);
        if (parent) {
          countySet.add(parent.code.toLowerCase());
          countyName = parent.name;
        }
      }
      // If all ZIPs are from the same county, use county-specific label
      if (countySet.size === 1 && countyName) {
        const shortCountyName = countyName.charAt(0).toUpperCase() + countyName.slice(1).toLowerCase();
        return `${shortCountyName} ZIPs`;
      }
    }
    return pluralLabelForKind(kind);
  }
  if (fallbackIds.length === 1) {
    return getAreaName(kind, fallbackIds[0]) ?? fallbackIds[0];
  }
  return buildDefaultLabel(kind, zipScopeLabel);
};

export const useDemographics = ({
  selectedByKind,
  defaultContext = null,
  zipScope = null,
  getZipParentCounty,
}: UseDemographicsOptions): DemographicsResult => {
  const { authReady } = useAuthSession();
  const { areasByKindAndCode } = useAreas();

  const { data: statsResp } = db.useQuery(
    authReady
      ? {
          stats: {
            $: {
              fields: ["id", "name"],
              order: { name: "asc" as const },
            },
          },
        }
      : null,
  );
  const statsRows: any[] = Array.isArray(statsResp?.stats) ? statsResp.stats : [];

  const populationStatId = useMemo(() => {
    const provided = "29d2b2e4-52e1-4f36-b212-abd06de3f92a";
    if (statsRows.some((s) => s?.id === provided)) return provided;
    const byName = statsRows.find((s) => s?.name === "Population");
    return byName?.id || null;
  }, [statsRows]);

  const avgAgeStatId = useMemo(() => {
    if (statsRows.length === 0) return null;
    const candidates = ["Median Age", "Average Age"];
    for (const label of candidates) {
      const match = statsRows.find((s) => s?.name === label);
      if (match?.id) return match.id;
    }
    return null;
  }, [statsRows]);

  const marriedPercentStatId = useMemo(
    () => statsRows.find((s) => s?.name === "Married Percent")?.id || null,
    [statsRows],
  );

  const fallbackZipScope =
    normalizeScopeLabel(DEFAULT_PARENT_AREA_BY_KIND.ZIP ?? "Oklahoma") ?? "Oklahoma";

  const zipSelectionParents = useMemo(() => {
    // When specific ZIPs are selected, pin the stat scope to their parent counties
    // so viewport-based scope changes don't swap in the wrong aggregate.
    const parents = new Set<string>();
    const zipRecords = areasByKindAndCode.get("ZIP");
    const countyRecords = areasByKindAndCode.get("COUNTY");
    for (const zip of dedupe(selectedByKind.ZIP)) {
      const zipRecord = zipRecords?.get(zip);
      const countyCode = zipRecord?.parentCode ?? null;
      const countyRecord = countyCode ? countyRecords?.get(countyCode) : null;
      const parentLabel = normalizeScopeLabel(
        countyRecord?.name ?? countyRecord?.code ?? zipRecord?.parentCode ?? null,
      );
      if (parentLabel) parents.add(parentLabel);
    }
    return Array.from(parents);
  }, [areasByKindAndCode, selectedByKind.ZIP]);

  const normalizedZipScope = useMemo<ParentAreaFilter>(() => {
    if (zipSelectionParents.length > 0) {
      return zipSelectionParents;
    }
    return normalizeScopeLabel(zipScope) ?? fallbackZipScope;
  }, [fallbackZipScope, zipScope, zipSelectionParents]);

  const primaryZipScopeLabel =
    Array.isArray(normalizedZipScope) ? normalizedZipScope[0] ?? null : normalizedZipScope;

  const parentAreaOverride = useMemo<Partial<Record<SupportedAreaKind, ParentAreaFilter>>>(
    () => ({ ZIP: normalizedZipScope }),
    [normalizedZipScope],
  );

  const demographicStatIds = useMemo(() => {
    const ids = new Set<string>();
    if (populationStatId) ids.add(populationStatId);
    if (avgAgeStatId) ids.add(avgAgeStatId);
    if (marriedPercentStatId) ids.add(marriedPercentStatId);
    return Array.from(ids);
  }, [avgAgeStatId, marriedPercentStatId, populationStatId]);

  const parentAreasForQuery = useMemo(() => {
    const set = new Set<string>();
    const add = (value: string | null | undefined) => {
      const normalized = normalizeScopeLabel(value ?? null);
      if (normalized) set.add(normalized);
    };
    add(DEFAULT_PARENT_AREA_BY_KIND.ZIP ?? "Oklahoma");
    add(DEFAULT_PARENT_AREA_BY_KIND.COUNTY ?? "Oklahoma");
    if (Array.isArray(normalizedZipScope)) {
      for (const scope of normalizedZipScope) add(scope);
    } else {
      add(normalizedZipScope ?? null);
    }
    return Array.from(set);
  }, [normalizedZipScope]);

  const statDataQuery = useMemo(() => {
    if (!authReady || demographicStatIds.length === 0) return null;
    const where = {
      statId: { $in: demographicStatIds },
      boundaryType: { $in: SUPPORTED_AREA_KINDS },
      ...(parentAreasForQuery.length > 0 ? { parentArea: { $in: parentAreasForQuery } } : {}),
    };
    return {
      statData: {
        $: {
          where,
          fields: ["statId", "name", "parentArea", "boundaryType", "date", "type", "data"],
          order: { date: "asc" as const },
        },
      },
    } satisfies Parameters<typeof db.useQuery>[0];
  }, [authReady, demographicStatIds, parentAreasForQuery]);

  const { data: statDataResp } = db.useQuery(statDataQuery);
  const statDataRows: any[] = Array.isArray(statDataResp?.statData) ? statDataResp.statData : [];

  const countyCodeForZipScope = useMemo(() => {
    if (!primaryZipScopeLabel) return null;
    const countyRecords = areasByKindAndCode.get("COUNTY");
    if (!countyRecords) return null;
    const targetAliases = new Set(buildScopeLabelAliases(primaryZipScopeLabel));
    for (const [code, record] of countyRecords.entries()) {
      const aliases = buildScopeLabelAliases(record.name ?? record.code);
      if (aliases.some((alias) => targetAliases.has(alias))) {
        return code;
      }
    }
    return null;
  }, [areasByKindAndCode, primaryZipScopeLabel]);

  const populationRoots = useMemo(
    () => collectLatestRootRows(statDataRows, populationStatId, parentAreaOverride, selectedByKind),
    [statDataRows, populationStatId, parentAreaOverride, selectedByKind],
  );

  const avgAgeRoots = useMemo(
    () => collectLatestRootRows(statDataRows, avgAgeStatId, parentAreaOverride, selectedByKind),
    [statDataRows, avgAgeStatId, parentAreaOverride, selectedByKind],
  );

  const marriedRoots = useMemo(
    () =>
      collectLatestRootRows(statDataRows, marriedPercentStatId, parentAreaOverride, selectedByKind),
    [statDataRows, marriedPercentStatId, parentAreaOverride, selectedByKind],
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
    return collectBreakdownSources(
      statDataRows,
      populationStatId,
      latestPopulationDates,
      parentAreaOverride,
      selectedByKind,
    );
  }, [statDataRows, populationStatId, latestPopulationDates, parentAreaOverride, selectedByKind]);

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
            // Married percent stored as ratio (0-1); convert to percentage points for display
            if (typeof marriedValue === "number" && Number.isFinite(marriedValue) && safePop > 0) {
              const marriedPct = marriedValue * 100;
              weightedMarried += marriedPct * safePop;
              weightedMarriedDenominator += safePop;
            }
          }
        }
      }

      let stats: AggregatedStats | null = null;
      if (populationEntry && (totalPopulation > 0 || populationCount > 0)) {
        const label = buildAreaLabel(kind, resolvedSelection, targetIds, getAreaName, primaryZipScopeLabel, getZipParentCounty);
        const fullLabel = buildFullLabel(kind, primaryZipScopeLabel);
        stats = {
          selectedCount: rawSelection.length,
          label,
          fullLabel,
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
            const valuePercent = Math.max(0, Math.min(100, Math.round(avg * 100)));
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

      if (
        kind === "ZIP" &&
        breakdowns.size === 0 &&
        ENABLE_DEMOGRAPHIC_BREAKDOWNS &&
        resolvedSelection.length === 0 &&
        countyCodeForZipScope
      ) {
        // When no ZIPs are explicitly selected, fall back to the current county's breakdown rows
        // so the sidebar shows meaningful demographics for the active viewport scope.
        const countyBreakdowns = breakdownSources.get("COUNTY");
        if (countyBreakdowns) {
          for (const groupKey of BREAKDOWN_KEYS) {
            const segments = countyBreakdowns.get(groupKey);
            if (!segments || segments.length === 0) continue;
            const orderedSegments = SEGMENT_ORDER[groupKey].map((segKey, index) => {
              const match = segments.find((seg) => seg.key === segKey);
              const v = match?.values?.[countyCodeForZipScope];
              const avg = typeof v === "number" && Number.isFinite(v) ? v : 0;
              const valuePercent = Math.max(0, Math.min(100, Math.round(avg * 100)));
              const colorToken =
                match?.colorToken ?? BRAND_SHADE_TOKENS[Math.min(index, BRAND_SHADE_TOKENS.length - 1)];
              const label = match?.label ?? SEGMENT_LABELS[groupKey][segKey] ?? segKey;
              return { key: segKey, label, colorToken, valuePercent };
            });
            breakdowns.set(groupKey, { key: groupKey, segments: orderedSegments });
          }
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
    countyCodeForZipScope,
    primaryZipScopeLabel,
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
          // Stored as ratio (0-1); convert to percentage points
          if (typeof marriedValue === "number" && Number.isFinite(marriedValue)) {
            weightedMarried += marriedValue * 100 * weight;
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
            const percent = acc.weight > 0 ? Math.round((sum / acc.weight) * 100) : 0;
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
