import { useMemo } from "react";

import type { AreaId } from "../../types/areas";
import type { Organization } from "../../types/organization";
import type { Stat } from "../../types/stat";
import { ReportHighlights } from "./ReportHighlights";
import type { SeriesByKind, StatBoundaryEntry } from "../hooks/useStats";

type SupportedAreaKind = "ZIP" | "COUNTY";

interface ReportScreenProps {
  activeKind: SupportedAreaKind | null;
  activeAreas: AreaId[];
  supplementalAreas?: AreaId[];
  organizations: Organization[];
  orgZipById: Map<string, string | null>;
  orgCountyById: Map<string, string | null>;
  statsById: Map<string, Stat>;
  statDataById: Map<string, Partial<Record<SupportedAreaKind, StatBoundaryEntry>>>;
  seriesByStatIdByKind: Map<string, SeriesByKind>;
  areaNameLookup: (kind: SupportedAreaKind, code: string) => string;
}

const comparisonLabelByKind: Record<SupportedAreaKind, string> = {
  ZIP: "City",
  COUNTY: "State",
};

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat().format(Math.round(n));
}

function formatPercent(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const percentValue = n <= 1 ? n * 100 : n;
  return `${Math.round(percentValue * 10) / 10}%`;
}

function formatYears(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}`;
}

export const ReportScreen = ({
  activeKind,
  activeAreas,
  supplementalAreas = [],
  organizations,
  orgZipById,
  orgCountyById,
  statsById,
  statDataById,
  seriesByStatIdByKind,
  areaNameLookup,
}: ReportScreenProps) => {
  const primaryKind = activeKind;

  const primaryCodes = useMemo(() => {
    if (!primaryKind) return [] as string[];
    return activeAreas.filter((area) => area.kind === primaryKind).map((area) => area.id);
  }, [activeAreas, primaryKind]);

  const supplementalByKind = useMemo(
    () => ({
      ZIP: supplementalAreas.filter((area) => area.kind === "ZIP").map((area) => area.id),
      COUNTY: supplementalAreas.filter((area) => area.kind === "COUNTY").map((area) => area.id),
    }),
    [supplementalAreas],
  );

  const hasMixedSelection = supplementalAreas.some((area) => area.kind !== (primaryKind ?? "ZIP"));

  const header = useMemo(() => {
    if (!primaryKind || primaryCodes.length === 0) {
      return { title: "Report", sub: "", list: null as string | null };
    }
    const labels = primaryCodes.map((code) => areaNameLookup(primaryKind, code) || code);
    const labelSuffix = primaryKind === "ZIP" ? "ZIPs" : "counties";
    const titleLabel = labels.length === 1 ? labels[0] : `${labels.length} ${labelSuffix}`;
    const sub =
      primaryKind === "COUNTY" && supplementalByKind.ZIP.length > 0
        ? "ZIP selections appear separately in the sidebar."
        : "";
    return {
      title: `Report · ${titleLabel}`,
      sub,
      list: labels.length > 1 ? labels.join(", ") : null,
    };
  }, [areaNameLookup, hasMixedSelection, primaryCodes, primaryKind, supplementalByKind.ZIP.length]);

  const callouts = useMemo(() => {
    if (!primaryKind || primaryCodes.length === 0) return { population: "—", avgAge: "—", married: "—" };
    const getEntryByName = (name: string): StatBoundaryEntry | null => {
      for (const [statId, entry] of statDataById.entries()) {
        const stat = statsById.get(statId);
        if (stat?.name === name) {
          return entry?.[primaryKind] ?? null;
        }
      }
      return null;
    };

    const populationEntry = getEntryByName("Population");
    const ageEntry = getEntryByName("Median Age") ?? getEntryByName("Average Age");
    const marriedEntry = getEntryByName("Married Percent");
    if (!populationEntry) return { population: "—", avgAge: "—", married: "—" };

    let totalPopulation = 0;
    let weightedAge = 0;
    let weightedMarried = 0;
    for (const code of primaryCodes) {
      const population = Math.max(0, Math.round((populationEntry.data || ({} as Record<string, number>))[code] || 0));
      totalPopulation += population;
      const age = (ageEntry?.data || ({} as Record<string, number>))[code];
      if (typeof age === "number") weightedAge += age * population;
      const married = (marriedEntry?.data || ({} as Record<string, number>))[code];
      if (typeof married === "number") weightedMarried += married * population;
    }
    if (totalPopulation === 0) return { population: "—", avgAge: "—", married: "—" };
    const averageAge = weightedAge > 0 ? weightedAge / totalPopulation : NaN;
    const averageMarried = weightedMarried > 0 ? weightedMarried / totalPopulation : NaN;
    return {
      population: formatNumber(totalPopulation),
      avgAge: formatYears(averageAge),
      married: formatPercent(averageMarried),
    };
  }, [primaryCodes, primaryKind, statDataById, statsById]);

  const comparisonLabel = primaryKind ? comparisonLabelByKind[primaryKind] : "City";

  const ranking = useMemo(() => {
    if (!primaryKind || primaryCodes.length === 0) return { left: [], right: [] };
    type Row = {
      statId: string;
      name: string;
      type: string;
      selectedValue: number;
      comparisonValue: number;
      diff: number;
      score: number;
    };
    const rows: Row[] = [];
    for (const [statId, byKind] of statDataById.entries()) {
      const entry = byKind?.[primaryKind];
      if (!entry) continue;
      const values = Object.values(entry.data || {}).filter(
        (value): value is number => typeof value === "number" && Number.isFinite(value),
      );
      if (values.length === 0) continue;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const range = Math.max(0, max - min);
      const comparisonAverage = values.reduce((sum, value) => sum + value, 0) / values.length;

      let selectedValue = 0;
      if (primaryCodes.length === 1) {
        const code = primaryCodes[0];
        const value = entry.data?.[code];
        selectedValue = typeof value === "number" ? value : 0;
      } else {
        const selectedValues = primaryCodes
          .map((code) => entry.data?.[code])
          .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
        if (selectedValues.length === 0) continue;
        selectedValue = selectedValues.reduce((sum, value) => sum + value, 0) / selectedValues.length;
      }

      const stat = statsById.get(statId);
      if (!stat) continue;
      const score =
        primaryCodes.length === 1
          ? range > 0
            ? (selectedValue - min) / range
            : 0
          : range > 0
          ? Math.abs(selectedValue - comparisonAverage) / range
          : 0;
      const diff = selectedValue - comparisonAverage;
      rows.push({
        statId,
        name: stat.name,
        type: entry.type,
        selectedValue,
        comparisonValue: comparisonAverage,
        diff,
        score,
      });
    }
    rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const top = rows.slice(0, 6);
    return { left: top.slice(0, 3), right: top.slice(3) };
  }, [primaryCodes, primaryKind, statDataById, statsById]);

  const highlights = useMemo(
    () => ranking.left.concat(ranking.right).slice(0, 4).map((row) => ({ statId: row.statId, name: row.name, type: row.type })),
    [ranking],
  );

  const orgsInSelection = useMemo(() => {
    if (!primaryKind || primaryCodes.length === 0) return [] as Organization[];
    const selectedSet = new Set(primaryCodes);
    if (primaryKind === "ZIP") {
      return organizations.filter((org) => {
        const zip = orgZipById.get(org.id);
        return !!zip && selectedSet.has(zip);
      });
    }
    return organizations.filter((org) => {
      const county = orgCountyById.get(org.id);
      return !!county && selectedSet.has(county);
    });
  }, [orgCountyById, orgZipById, organizations, primaryCodes, primaryKind]);

  return (
    <section className="relative flex-1 overflow-y-auto bg-white dark:bg-slate-900">
      <div className="mx-auto w-full max-w-6xl px-6 py-6">
        <div className="mb-4">
          <div className="flex items-end justify-between">
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{header.title}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{header.sub}</p>
          </div>
          {header.list && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{header.list}</p>}
        </div>

        {primaryCodes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4">
              <svg className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.5"
                  d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-slate-800 dark:text-slate-100">No area selected</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {hasMixedSelection ? "Add a ZIP or county to generate a report." : "Please enter a ZIP or county above, or select one on the map."}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Population</p>
                <p className="mt-1 text-lg font-semibold text-slate-800 dark:text-white">{callouts.population}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Average age</p>
                <p className="mt-1 text-lg font-semibold text-slate-800 dark:text-white">{callouts.avgAge}</p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">Married %</p>
                <p className="mt-1 text-lg font-semibold text-slate-800 dark:text-white">{callouts.married}</p>
              </div>
            </div>

            <ReportHighlights
              items={highlights}
              selectedKind={primaryKind}
              selectedCodes={primaryCodes}
              supplementalAreas={supplementalAreas}
              areaNameLookup={areaNameLookup}
              statDataById={statDataById}
              seriesByStatIdByKind={seriesByStatIdByKind}
            />

            <div className="mt-6">
              <h3 className="mb-1 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Top differences vs {comparisonLabel.toLowerCase()}
              </h3>
              {primaryKind && (
                <p className="-mt-1 mb-2 text-xs text-slate-400 dark:text-slate-500">
                  For selected {primaryKind === "ZIP" ? "ZIPs" : "counties"}
                </p>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                  {ranking.left.length === 0 && <li className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No selection.</li>}
                  {ranking.left.map((row) => (
                    <li key={row.statId} className="flex items-center justify-between bg-white px-4 py-3 dark:bg-slate-900">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{row.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {comparisonLabel}: {row.comparisonValue.toFixed(2)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-800 dark:text-white">{row.selectedValue.toFixed(2)}</p>
                        <p className={`text-xs font-medium ${row.diff >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {row.diff >= 0 ? "+" : "-"}
                          {Math.abs(row.diff).toFixed(2)} vs {comparisonLabel.toLowerCase()}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                  {ranking.right.map((row) => (
                    <li key={row.statId} className="flex items-center justify-between bg-white px-4 py-3 dark:bg-slate-900">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{row.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {comparisonLabel}: {row.comparisonValue.toFixed(2)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-800 dark:text-white">{row.selectedValue.toFixed(2)}</p>
                        <p className={`text-xs font-medium ${row.diff >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {row.diff >= 0 ? "+" : "-"}
                          {Math.abs(row.diff).toFixed(2)} vs {comparisonLabel.toLowerCase()}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Organizations in selection</h3>
              {orgsInSelection.length === 0 ? (
                <p className="px-1 py-2 text-sm text-slate-500 dark:text-slate-400">No organizations found in selection.</p>
              ) : (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {orgsInSelection.map((org) => (
                    <li key={org.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{org.name}</p>
                      <div className="mt-1 flex items-center justify-between gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-[2px] text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                          {org.category}
                        </span>
                        {org.status && org.status !== "active" && (
                          <span className="rounded-full bg-amber-100 px-2 py-[2px] text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-400/20 dark:text-amber-200">
                            {org.status}
                          </span>
                        )}
                        {org.website && (
                          <a
                            href={org.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs font-medium text-slate-500 hover:text-brand-700 dark:text-slate-400"
                          >
                            Visit site
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
};
