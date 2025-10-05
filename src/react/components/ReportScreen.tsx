import { useMemo } from "react";
import type { Organization } from "../../types/organization";
import type { Stat } from "../../types/stat";
import { ReportHighlights } from "./ReportHighlights";

type SeriesEntry = { date: string; type: string; data: Record<string, number> };

interface ReportScreenProps {
  selectedZips: string[];
  areasByKey: Map<string, { population: number; avgAge: number; marriedPercent: number } & { key: string; type: string }>;
  organizations: Organization[];
  orgZipById: Map<string, string | null>;
  statsById: Map<string, Stat>;
  statDataById: Map<string, { type: string; data: Record<string, number> }>;
  seriesByStatId: Map<string, SeriesEntry[]>;
}

function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat().format(Math.round(n));
}

function formatPercent(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)}%`;
}

function formatYears(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}`;
}

export const ReportScreen = ({
  selectedZips,
  areasByKey,
  organizations,
  orgZipById,
  statsById,
  statDataById,
  seriesByStatId,
}: ReportScreenProps) => {
  const header = useMemo(() => {
    if (selectedZips.length === 0) return { title: "Report", sub: "Select one or more ZIPs to generate a report.", zipList: null as string | null };
    const label = selectedZips.length === 1 ? selectedZips[0] : `${selectedZips.length} ZIPs`;
    return {
      title: `Report · ${label}`,
      sub: "",
      zipList: selectedZips.length > 1 ? selectedZips.join(", ") : null,
    };
  }, [selectedZips]);

  const callouts = useMemo(() => {
    if (selectedZips.length === 0) return { population: "—", avgAge: "—", married: "—" };
    let totalPop = 0;
    let weightedAge = 0;
    let weightedMarried = 0;
    for (const z of selectedZips) {
      const a = areasByKey.get(z);
      if (!a) continue;
      const p = Math.max(0, Math.round(a.population));
      totalPop += p;
      weightedAge += a.avgAge * p;
      weightedMarried += a.marriedPercent * p;
    }
    if (totalPop === 0) return { population: "—", avgAge: "—", married: "—" };
    const avgAge = weightedAge / totalPop;
    const avgMarried = weightedMarried / totalPop;
    return { population: formatNumber(totalPop), avgAge: formatYears(avgAge), married: formatPercent(avgMarried) };
  }, [selectedZips, areasByKey]);

  const ranking = useMemo(() => {
    type Row = { statId: string; name: string; type: string; selectedValue: number; cityValue: number; diff: number; score: number };
    const rows: Row[] = [];
    for (const [statId, entry] of statDataById) {
      const distValues = Object.values(entry.data || {}).filter((x) => typeof x === "number" && Number.isFinite(x)) as number[];
      if (distValues.length === 0) continue;
      const min = Math.min(...distValues);
      const max = Math.max(...distValues);
      const range = Math.max(0, max - min);
      const cAvg = distValues.reduce((a, b) => a + b, 0) / distValues.length;

      let selectedValue = 0;
      if (selectedZips.length === 1) {
        const z = selectedZips[0];
        selectedValue = typeof entry.data[z] === "number" ? (entry.data[z] as number) : 0;
      } else {
        const vals: number[] = [];
        for (const z of selectedZips) {
          const v = entry.data?.[z];
          if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
        }
        if (vals.length === 0) continue;
        selectedValue = vals.reduce((a, b) => a + b, 0) / vals.length;
      }

      let score = 0;
      if (selectedZips.length === 1) score = range > 0 ? (selectedValue - min) / range : 0;
      else score = range > 0 ? Math.abs(selectedValue - cAvg) / range : 0;
      const s = statsById.get(statId);
      if (!s) continue;
      rows.push({ statId, name: s.name, type: entry.type, selectedValue, cityValue: cAvg, diff: selectedValue - cAvg, score });
    }
    rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const top = rows.slice(0, 6);
    const left = top.slice(0, 3);
    const right = top.slice(3);
    return { left, right };
  }, [selectedZips, statDataById, statsById]);

  const highlights = useMemo(() => {
    const topFour = ranking.left.concat(ranking.right).slice(0, 4).map((r) => ({ statId: r.statId, name: r.name, type: r.type }));
    return topFour;
  }, [ranking]);

  const orgsInSelection = useMemo(() => {
    if (selectedZips.length === 0) return [] as Organization[];
    const sel = new Set(selectedZips);
    return organizations.filter((o) => {
      const z = orgZipById.get(o.id);
      return !!z && sel.has(z);
    });
  }, [organizations, orgZipById, selectedZips]);

  return (
    <section className="relative flex-1 overflow-y-auto bg-white dark:bg-slate-900">
      <div className="mx-auto w-full max-w-6xl px-6 py-6">
        {/* Header */}
        <div className="mb-4">
          <div className="flex items-end justify-between">
            <h2 className="text-xl font-semibold text-slate-800 dark:text-slate-100">{header.title}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">{header.sub}</p>
          </div>
          {header.zipList && (
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">{header.zipList}</p>
          )}
        </div>

        {selectedZips.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="mb-4">
              <svg className="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
            </div>
            <h3 className="mb-2 text-lg font-semibold text-slate-800 dark:text-slate-100">No area selected</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400">Please enter a ZIP above or select one on the map</p>
          </div>
        ) : (
          <>
            {/* Callouts */}
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

            {/* Highlights */}
            <ReportHighlights
              items={highlights}
              selectedZips={selectedZips}
              statDataById={statDataById}
              seriesByStatId={seriesByStatId}
            />

            {/* Ranking */}
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Top differences vs city</h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                  {ranking.left.length === 0 && (
                    <li className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400">No selection.</li>
                  )}
                  {ranking.left.map((r) => (
                    <li key={r.statId} className="flex items-center justify-between bg-white px-4 py-3 dark:bg-slate-900">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{r.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">City: {/* simplified */}{r.cityValue.toFixed(2)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-800 dark:text-white">{r.selectedValue.toFixed(2)}</p>
                        <p className={`text-xs font-medium ${r.diff >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {r.diff >= 0 ? "+" : "-"}
                          {Math.abs(r.diff).toFixed(2)} vs city
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
                <ul className="divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                  {ranking.right.map((r) => (
                    <li key={r.statId} className="flex items-center justify-between bg-white px-4 py-3 dark:bg-slate-900">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-200">{r.name}</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">City: {r.cityValue.toFixed(2)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-slate-800 dark:text-white">{r.selectedValue.toFixed(2)}</p>
                        <p className={`text-xs font-medium ${r.diff >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                          {r.diff >= 0 ? "+" : "-"}
                          {Math.abs(r.diff).toFixed(2)} vs city
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Orgs in selection */}
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Organizations in selection</h3>
              {orgsInSelection.length === 0 ? (
                <p className="px-1 py-2 text-sm text-slate-500 dark:text-slate-400">No organizations found in selection.</p>
              ) : (
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {orgsInSelection.map((org) => (
                    <li key={org.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40">
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{org.name}</p>
                      <div className="mt-1 flex items-center justify-between">
                        <span className="rounded-full bg-slate-100 px-2 py-[2px] text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-200">{org.category}</span>
                        <a href={org.url} target="_blank" rel="noopener noreferrer" className="text-xs font-medium text-slate-500 hover:text-brand-700 dark:text-slate-400">Visit site</a>
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


