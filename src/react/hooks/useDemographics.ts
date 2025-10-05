import { useMemo } from "react";
import { db } from "../../lib/reactDb";
import type { DemographicStats, BreakdownGroup } from "../components/DemographicsBar";
import { useAreas } from "./useAreas";

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
  // Query stats and statData directly from InstantDB
  const { data } = db.useQuery({
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
  });

  // Areas (ZIPs) with core demographics
  const { areasByKey } = useAreas();

  // Find the Population stat ID
  const populationStatId = useMemo(() => {
    if (!data?.stats) return null;
    const pop = data.stats.find((s) => s?.name === "Population");
    return pop?.id || null;
  }, [data?.stats]);

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
    // If areas have not loaded yet, don't show anything
    if (!areasByKey || areasByKey.size === 0) return null;

    const zips = selectedZips.length > 0 ? selectedZips : Array.from(areasByKey.keys());

    let totalPop = 0;
    let weightedAge = 0;
    let weightedMarried = 0;

    for (const z of zips) {
      const a = areasByKey.get(z);
      if (!a) continue;
      const p = Math.max(0, Math.round(a.population));
      totalPop += p;
      weightedAge += a.avgAge * p;
      weightedMarried += a.marriedPercent * p;
    }

    if (totalPop <= 0) {
      // No valid population data; surface a header/label but no values
      return {
        selectedCount: selectedZips.length,
        label: selectedZips.length === 0 ? "TULSA" : selectedZips.length === 1 ? selectedZips[0] : `${selectedZips.length} ZIPs`,
      };
    }

    const avgAge = weightedAge / totalPop;
    const avgMarried = weightedMarried / totalPop;

    return {
      selectedCount: selectedZips.length,
      label: selectedZips.length === 0 ? "TULSA" : selectedZips.length === 1 ? selectedZips[0] : `${selectedZips.length} ZIPs`,
      population: totalPop,
      avgAge,
      marriedPercent: avgMarried,
    };
  }, [areasByKey, selectedZips]);

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
