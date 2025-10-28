import { useMemo, useState } from "react";
import type { Stat } from "../../types/stat";
import { formatStatValue } from "../../lib/format";
import type { StatBoundaryEntry } from "../hooks/useStats";

type SupportedAreaKind = "ZIP" | "COUNTY";
type SelectedAreasMap = Partial<Record<SupportedAreaKind, string[]>>;

type StatDataById = Map<string, Partial<Record<SupportedAreaKind, StatBoundaryEntry>>>;

type StatSelectMeta = { shiftKey?: boolean; clear?: boolean };

type AreaEntry = { kind: SupportedAreaKind; code: string };

type StatRow = {
  id: string;
  name: string;
  value: number;
  score: number;
  type: string;
  contextAvg: number;
  hasData: boolean;
  goodIfUp?: boolean;
};

interface StatListProps {
  statsById?: Map<string, Stat>;
  statDataById?: StatDataById;
  selectedAreas?: SelectedAreasMap;
  activeAreaKind?: SupportedAreaKind | null;
  areaNameLookup?: (kind: SupportedAreaKind, code: string) => string;
  categoryFilter?: string | null;
  secondaryStatId?: string | null;
  selectedStatId?: string | null;
  onStatSelect?: (statId: string | null, meta?: StatSelectMeta) => void;
}

const SUPPORTED_KINDS: SupportedAreaKind[] = ["ZIP", "COUNTY"];

const computeContextAverage = (entry: StatBoundaryEntry | undefined): number => {
  if (!entry) return 0;
  const values = Object.values(entry.data || {});
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return 0;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
};

const buildAreaEntries = (selectedAreas?: SelectedAreasMap): AreaEntry[] => {
  const entries: AreaEntry[] = [];
  for (const kind of SUPPORTED_KINDS) {
    const codes = selectedAreas?.[kind] ?? [];
    for (const code of codes) {
      if (typeof code === "string" && code.trim().length > 0) {
        entries.push({ kind, code });
      }
    }
  }
  return entries;
};

export const StatList = ({
  statsById = new Map(),
  statDataById = new Map(),
  selectedAreas,
  activeAreaKind = null,
  areaNameLookup,
  categoryFilter = null,
  secondaryStatId = null,
  selectedStatId = null,
  onStatSelect,
}: StatListProps) => {
  const areaEntries = useMemo(() => buildAreaEntries(selectedAreas), [selectedAreas]);

  // Determine which boundary level to use: prefer activeAreaKind if set, otherwise infer from selections
  const effectiveAreaKind = useMemo<SupportedAreaKind | null>(() => {
    if (activeAreaKind) return activeAreaKind;
    const hasCountySelection = areaEntries.some((area) => area.kind === "COUNTY");
    const hasZipSelection = areaEntries.some((area) => area.kind === "ZIP");
    if (hasCountySelection && !hasZipSelection) return "COUNTY";
    if (hasZipSelection && !hasCountySelection) return "ZIP";
    return null;
  }, [activeAreaKind, areaEntries]);

  const averageLabel = useMemo(() => {
    // Only show context average label when areas are actually selected
    if (areaEntries.length === 0) return null;
    if (effectiveAreaKind === "COUNTY") return "State Avg";
    if (effectiveAreaKind === "ZIP") return "City Avg";
    return null;
  }, [effectiveAreaKind, areaEntries.length]);

  const rows = useMemo<StatRow[]>(() => {
    const stats: Stat[] = Array.from(statsById.values()).filter((s) =>
      categoryFilter ? s.category === categoryFilter : true,
    );

    const result: StatRow[] = [];

    // Use effectiveAreaKind to determine which dataset to prefer
    const preferCounty = effectiveAreaKind === "COUNTY";

    for (const s of stats) {
      const entryMap = statDataById.get(s.id);
      if (!entryMap) continue;

      const contextAvgByKind = new Map<SupportedAreaKind, number>();
      for (const kind of SUPPORTED_KINDS) {
        const entry = entryMap[kind];
        if (entry) contextAvgByKind.set(kind, computeContextAverage(entry));
      }

      // Use COUNTY data when at county level, otherwise prefer ZIP
      const fallbackEntry = preferCounty
        ? (entryMap.COUNTY ?? entryMap.ZIP ?? Object.values(entryMap)[0])
        : (entryMap.ZIP ?? entryMap.COUNTY ?? Object.values(entryMap)[0]);
      if (!fallbackEntry) continue;

      const fallbackContextAvg = preferCounty
        ? (contextAvgByKind.get("COUNTY") ?? contextAvgByKind.get("ZIP") ?? computeContextAverage(fallbackEntry))
        : (contextAvgByKind.get("ZIP") ?? contextAvgByKind.get("COUNTY") ?? computeContextAverage(fallbackEntry));

      const valuesForSelection = areaEntries
        .map((area) => {
          const entry = entryMap[area.kind];
          if (!entry) return null;
          const raw = entry.data?.[area.code];
          if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
          return { area, entry, value: raw };
        })
        .filter((v): v is { area: AreaEntry; entry: StatBoundaryEntry; value: number } => v !== null);

      let displayValue = fallbackContextAvg;
      if (areaEntries.length === 1 && valuesForSelection.length === 1) {
        displayValue = valuesForSelection[0].value;
      } else if (areaEntries.length > 1 && valuesForSelection.length > 0) {
        displayValue =
          valuesForSelection.reduce((sum, item) => sum + item.value, 0) /
          valuesForSelection.length;
      }

      const normalizedDiffs = valuesForSelection.map(({ value, entry, area }) => {
        const range = Math.max(entry.max - entry.min, 0);
        const contextAvg = contextAvgByKind.get(area.kind) ?? fallbackContextAvg;
        if (range <= 0) return 0;
        return Math.abs(value - contextAvg) / range;
      });
      const score = normalizedDiffs.length
        ? normalizedDiffs.reduce((sum, v) => sum + v, 0) / normalizedDiffs.length
        : 0;

      result.push({
        id: s.id,
        name: s.name,
        value: displayValue,
        score,
        type: fallbackEntry.type,
        contextAvg: fallbackContextAvg,
        hasData: valuesForSelection.length > 0 || areaEntries.length === 0,
        goodIfUp: s.goodIfUp,
      });
    }

    if (areaEntries.length === 0) {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      result.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    }

    return result;
  }, [statsById, statDataById, areaEntries, categoryFilter, effectiveAreaKind]);

  const subtitle = useMemo(() => {
    if (areaEntries.length === 1) {
      const area = areaEntries[0];
      const label = areaNameLookup ? areaNameLookup(area.kind, area.code) : `${area.kind} ${area.code}`;
      return `Most significant stats for ${label}`;
    }
    if (areaEntries.length > 1) {
      return `Most significant stats for Selected Areas (${areaEntries.length})`;
    }
    return null;
  }, [areaEntries, areaNameLookup]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Banner for secondary stat hint */}
      {selectedStatId !== null && secondaryStatId === null && (
        <div className="px-4 py-2">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Shift+click another stat for secondary overlay
          </p>
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 pb-6">
        {subtitle && (
          <p className="px-1 pt-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            {subtitle}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="px-1 pt-2 text-xs text-slate-500 dark:text-slate-400">
            No statistics to display for the current selection.
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <StatListItem
                key={row.id}
                row={row}
                isSelected={selectedStatId === row.id}
                isSecondary={secondaryStatId === row.id}
                averageLabel={averageLabel}
                onStatSelect={onStatSelect}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

interface StatListItemProps {
  row: StatRow;
  isSelected: boolean;
  isSecondary: boolean;
  averageLabel: string | null;
  onStatSelect?: (statId: string | null, meta?: StatSelectMeta) => void;
}

const StatListItem = ({
  row,
  isSelected,
  isSecondary,
  averageLabel,
  onStatSelect,
}: StatListItemProps) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Determine color based on goodIfUp and whether value is above/below average
  // Only apply color when there's a selection (averageLabel is shown)
  const valueColorClass = (() => {
    if (!averageLabel || typeof row.goodIfUp !== 'boolean') {
      return 'text-slate-700 dark:text-slate-200';
    }

    const isAboveAverage = row.value > row.contextAvg;
    const isGood = row.goodIfUp ? isAboveAverage : !isAboveAverage;

    return isGood
      ? 'text-green-600 dark:text-green-400'
      : 'text-red-600 dark:text-red-400';
  })();

  const handleClick = (e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
      onStatSelect?.(row.id, { shiftKey: true });
      return;
    }

    if (isSelected) {
      onStatSelect?.(null, { clear: true });
    } else {
      onStatSelect?.(row.id);
    }
  };

  const handleAvgHover = (e: React.MouseEvent) => {
    const li = e.currentTarget.closest("li");
    if (!li) return;
    const liRect = li.getBoundingClientRect();
    const x = e.clientX - liRect.left;
    const y = e.clientY - liRect.top;
    setTooltipPos({ x, y });
    setShowTooltip(true);
  };

  const common =
    "group relative flex items-center justify-between rounded-2xl border px-3 py-2 shadow-sm transition-colors cursor-pointer select-none";

  const className = isSelected
    ? `${common} border-2 border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-400/15`
    : isSecondary
    ? `${common} border-2 border-teal-500 bg-teal-50 dark:border-teal-400 dark:bg-teal-400/15`
    : `${common} border-slate-200/70 bg-white/70 hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700/70 dark:bg-slate-900/50 dark:hover:border-slate-600 dark:hover:bg-slate-800/70`;

  const valueLabel = row.hasData ? formatStatValue(row.value, row.type) : "—";

  return (
    <li className={className} onClick={handleClick} onMouseLeave={() => setShowTooltip(false)}>
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-300">{row.name}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
          {row.hasData ? (
            <>
              {averageLabel && (
                <span
                  className="mr-2 inline-flex items-center gap-1 text-[10px] uppercase tracking-wide"
                  onMouseEnter={handleAvgHover}
                  onMouseLeave={() => setShowTooltip(false)}
                >
                  {averageLabel}
                  <span className="font-semibold text-slate-500 dark:text-slate-300">
                    {formatStatValue(row.contextAvg, row.type)}
                  </span>
                </span>
              )}
            </>
          ) : (
            <span className="italic text-slate-400 dark:text-slate-500">No data for selection</span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className={`text-sm font-semibold ${valueColorClass}`}>
          {valueLabel}
        </span>
      </div>

      {showTooltip && averageLabel && (
        <div
          className="pointer-events-none absolute z-10 rounded border border-black/10 bg-slate-800 px-1.5 py-1 text-[10px] text-white shadow-sm dark:border-white/20 dark:bg-slate-200 dark:text-slate-900"
          style={{ left: tooltipPos.x, top: tooltipPos.y - 32 }}
        >
          {averageLabel} across all areas
        </div>
      )}
    </li>
  );
};
