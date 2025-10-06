import { useMemo } from "react";
import { db } from "../../lib/reactDb";
import type { DemographicStats, BreakdownGroup } from "../components/DemographicsBar";

type BreakdownGroupKey = "ethnicity" | "income" | "education";

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

export const useDemographics = (selectedZips: string[]) => {
  const { isLoading: isAuthLoading } = db.useAuth();

  // Query stats and statData directly from InstantDB
  // Wait for auth to be ready to avoid race conditions (especially in Safari)
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
        }
  );


  // Population/AvgAge/Married stat ids (prefer provided constant for population; others by name)
  const populationStatId = useMemo(() => {
    const PROVIDED = "29d2b2e4-52e1-4f36-b212-abd06de3f92a";
    if (data?.stats?.some((s) => s?.id === PROVIDED)) return PROVIDED;
    const byName = data?.stats?.find((s) => s?.name === "Population");
    return byName?.id || null;
  }, [data?.stats]);

  const avgAgeStatId = useMemo(() => {
    return data?.stats?.find((s) => s?.name === "Average Age")?.id || null;
  }, [data?.stats]);

  const marriedPercentStatId = useMemo(() => {
    return data?.stats?.find((s) => s?.name === "Married Percent")?.id || null;
  }, [data?.stats]);

  // Population values per ZIP from statData root row
  const populationByZip = useMemo(() => {
    const empty: Record<string, number> = {};
    if (!data?.statData || !populationStatId) return empty;
    const row = data.statData.find(
      (r) =>
        r?.statId === populationStatId &&
        r?.name === "root" &&
        r?.area === "Tulsa" &&
        r?.boundaryType === "ZIP" &&
        r?.date === "2025"
    );
    return ((row?.data as Record<string, number>) || empty);
  }, [data?.statData, populationStatId]);

  // Optional: avg age + married percent by ZIP from statData if present
  const avgAgeByZip = useMemo(() => {
    const empty: Record<string, number> = {};
    if (!data?.statData || !avgAgeStatId) return empty;
    const row = data.statData.find(
      (r) =>
        r?.statId === avgAgeStatId &&
        r?.name === "root" &&
        r?.area === "Tulsa" &&
        r?.boundaryType === "ZIP" &&
        r?.date === "2025"
    );
    return ((row?.data as Record<string, number>) || empty);
  }, [data?.statData, avgAgeStatId]);

  const marriedPercentByZip = useMemo(() => {
    const empty: Record<string, number> = {};
    if (!data?.statData || !marriedPercentStatId) return empty;
    const row = data.statData.find(
      (r) =>
        r?.statId === marriedPercentStatId &&
        r?.name === "root" &&
        r?.area === "Tulsa" &&
        r?.boundaryType === "ZIP" &&
        r?.date === "2025"
    );
    return ((row?.data as Record<string, number>) || empty);
  }, [data?.statData, marriedPercentStatId]);

  // Build breakdown source from statData
  const breakdownsSource = useMemo(() => {
    const map = new Map<BreakdownGroupKey, {
      key: BreakdownGroupKey;
      segments: { key: string; label: string; colorToken: string; valueByZip: Record<string, number> }[];
    }>();

    if (!data?.statData || !populationStatId) return map;

    const rows = data.statData.filter(
      (row) =>
        row?.statId === populationStatId &&
        row?.area === "Tulsa" &&
        row?.boundaryType === "ZIP" &&
        row?.date === "2025"
    );

    for (const groupKey of Object.keys(SEGMENT_ORDER) as BreakdownGroupKey[]) {
      const segments: {
        key: string;
        label: string;
        colorToken: string;
        valueByZip: Record<string, number>;
      }[] = [];
      const order = SEGMENT_ORDER[groupKey];
      for (let i = 0; i < order.length; i++) {
        const segKey = order[i];
        const name = `${groupKey}:${segKey}`;
        const row = rows.find((r) => r?.name === name);
        const colorToken = BRAND_SHADE_TOKENS[Math.min(i, BRAND_SHADE_TOKENS.length - 1)];
        segments.push({
          key: segKey,
          label: SEGMENT_LABELS[groupKey][segKey] || segKey,
          colorToken,
          valueByZip: (row?.data ?? {}) as Record<string, number>,
        });
      }
      map.set(groupKey, { key: groupKey, segments });
    }

    return map;
  }, [data?.statData, populationStatId]);

  // Compute demographics stats based on selected zips (or all zips when none selected)
  const demographics = useMemo<DemographicStats | null>(() => {
    // If we don't even have population yet, defer rendering
    const availableZips = Object.keys(populationByZip);
    if (availableZips.length === 0) return null;

    const zips = selectedZips.length > 0 ? selectedZips : availableZips;

    let totalPop = 0;
    let weightedAge = 0;
    let weightedMarried = 0;

    for (const z of zips) {
      const p = Math.max(0, Math.round(populationByZip[z] || 0));
      totalPop += p;
      // Use statData-based values for age and married percent
      const age = avgAgeByZip[z];
      const married = marriedPercentByZip[z];
      if (typeof age === "number" && p > 0) weightedAge += age * p;
      if (typeof married === "number" && p > 0) weightedMarried += married * p;
    }

    const label = selectedZips.length === 0 ? "TULSA" : selectedZips.length === 1 ? selectedZips[0] : `${selectedZips.length} ZIPs`;

    if (totalPop <= 0) return { selectedCount: selectedZips.length, label };

    const result: DemographicStats = {
      selectedCount: selectedZips.length,
      label,
      population: totalPop,
    };

    // Age / married stay best-effort until we migrate them too
    if (weightedAge > 0 && totalPop > 0) result.avgAge = weightedAge / totalPop;
    if (weightedMarried > 0 && totalPop > 0) result.marriedPercent = weightedMarried / totalPop;

    return result;
  }, [populationByZip, avgAgeByZip, marriedPercentByZip, selectedZips]);

  // Compute breakdowns (aggregated by selected zips)
  const breakdowns = useMemo<Map<string, BreakdownGroup>>(() => {
    const groups = new Map<string, BreakdownGroup>();

    if (!breakdownsSource || breakdownsSource.size === 0) {
      return groups;
    }

    const zips =
      selectedZips.length > 0
        ? selectedZips
        : (() => {
            // Use any group/segment to derive the list of city zips
            for (const g of breakdownsSource.values()) {
              const firstSeg = g.segments[0];
              if (firstSeg) return Object.keys(firstSeg.valueByZip || {});
            }
            return [] as string[];
          })();

    const denom = Math.max(zips.length, 1);

    for (const [key, g] of breakdownsSource) {
      const segs = g.segments.map((seg) => {
        let sum = 0;
        for (const z of zips) {
          const v = seg.valueByZip[z];
          if (typeof v === "number" && Number.isFinite(v)) sum += v;
        }
        const avg = sum / denom; // simple mean across zips
        return {
          key: seg.key,
          label: seg.label,
          colorToken: seg.colorToken,
          valuePercent: Math.max(0, Math.min(100, Math.round(avg))),
        };
      });

      // Normalize rounding drift to sum to 100
      const total = segs.reduce((a, s) => a + s.valuePercent, 0);
      let diff = 100 - total;
      if (diff !== 0 && segs.length > 0) {
        // Adjust the largest segment by the diff
        let idx = 0;
        let max = -1;
        for (let i = 0; i < segs.length; i++)
          if (segs[i].valuePercent > max) {
            max = segs[i].valuePercent;
            idx = i;
          }
        segs[idx] = {
          ...segs[idx],
          valuePercent: Math.max(0, Math.min(100, segs[idx].valuePercent + diff)),
        };
      }

      groups.set(key, { key, segments: segs });
    }

    return groups;
  }, [breakdownsSource, selectedZips]);

  return { demographics, breakdowns };
};
