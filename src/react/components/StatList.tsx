import { useMemo, useState } from "react";
import type { Stat } from "../../types/stat";
import { formatStatValue } from "../../lib/format";

interface SeriesEntry {
  date: string;
  type: string;
  data: Record<string, number>;
}

type StatSelectMeta = { shiftKey?: boolean; clear?: boolean };

interface StatListProps {
  statsById?: Map<string, Stat>;
  seriesByStatId?: Map<string, SeriesEntry[]>;
  selectedZips?: string[];
  categoryFilter?: string | null;
  secondaryStatId?: string | null;
  selectedStatId?: string | null;
  onStatSelect?: (statId: string | null, meta?: StatSelectMeta) => void;
}

interface StatRow {
  id: string;
  name: string;
  value: number;
  score: number;
  type: string;
  cityAvg: number;
}

const computeCityAvg = (entry: SeriesEntry | undefined): number => {
  if (!entry) return 0;
  const vals = Object.values(entry.data || {});
  const nums = vals.filter((x) => typeof x === "number") as number[];
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
};

export const StatList = ({
  statsById = new Map(),
  seriesByStatId = new Map(),
  selectedZips = [],
  categoryFilter = null,
  secondaryStatId = null,
  selectedStatId = null,
  onStatSelect,
}: StatListProps) => {
  // Compute stat rows
  const rows = useMemo<StatRow[]>(() => {
    const stats: Stat[] = Array.from(statsById.values()).filter((s) =>
      categoryFilter ? s.category === categoryFilter : true
    );

    const result: StatRow[] = [];

    for (const s of stats) {
      const series = seriesByStatId.get(s.id) || [];
      const latest = series[series.length - 1];
      if (!latest) continue;

      const cityAvg = computeCityAvg(latest);
      const values = Object.values(latest.data || {});
      const min = values.length ? Math.min(...values) : 0;
      const max = values.length ? Math.max(...values) : 0;
      const range = Math.max(0, max - min);

      let displayValue = cityAvg;
      let score = 0;

      if (selectedZips.length === 0) {
        displayValue = cityAvg;
      } else if (selectedZips.length === 1) {
        const z = selectedZips[0];
        const v = typeof latest.data[z] === "number" ? (latest.data[z] as number) : 0;
        displayValue = v;
        score = range > 0 ? (v - min) / range : 0;
      } else {
        const nums = selectedZips.map((z) =>
          typeof latest.data[z] === "number" ? (latest.data[z] as number) : 0
        );
        const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        displayValue = avg;
        const diff = Math.abs(avg - cityAvg);
        score = range > 0 ? diff / range : 0;
      }

      result.push({
        id: s.id,
        name: s.name,
        value: displayValue,
        score,
        type: latest.type,
        cityAvg,
      });
    }

    // Sort
    if (selectedZips.length === 0) {
      result.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      result.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    }

    return result;
  }, [statsById, seriesByStatId, selectedZips, categoryFilter]);

  // Subtitle text
  const subtitle = useMemo(() => {
    if (selectedZips.length === 1) {
      return `Most significant stats for ${selectedZips[0]}`;
    } else if (selectedZips.length > 1) {
      return `Most significant stats for Selected Areas (${selectedZips.length})`;
    }
    return null;
  }, [selectedZips]);

  return (
    <div className="flex-1 overflow-y-auto px-4 pb-6">
      {subtitle && (
        <p className="px-1 pt-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {subtitle}
        </p>
      )}
      <ul className="space-y-2">
        {rows.map((row) => (
          <StatListItem
            key={row.id}
            row={row}
            isSelected={selectedStatId === row.id}
            isSecondary={secondaryStatId === row.id}
            showCityAvg={selectedZips.length > 0}
            onStatSelect={onStatSelect}
          />
        ))}
      </ul>
    </div>
  );
};

interface StatListItemProps {
  row: StatRow;
  isSelected: boolean;
  isSecondary: boolean;
  showCityAvg: boolean;
  onStatSelect?: (statId: string | null, meta?: StatSelectMeta) => void;
}

const StatListItem = ({
  row,
  isSelected,
  isSecondary,
  showCityAvg,
  onStatSelect,
}: StatListItemProps) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

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
    "group relative flex items-center justify-between rounded-full border px-3 py-2 shadow-sm transition-colors cursor-pointer select-none";

  const className = isSelected
    ? `${common} border-2 border-brand-500 bg-brand-50 dark:border-brand-400 dark:bg-brand-400/15`
    : `${common} border-slate-200/70 bg-white/70 hover:border-brand-200 hover:bg-brand-50 dark:border-slate-700/70 dark:bg-slate-900/50 dark:hover:border-slate-600 dark:hover:bg-slate-800/70`;

  const handleClearClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    setShowTooltip(false);
    setIsHovered(false);
    onStatSelect?.(null, { clear: true });
  };

  return (
    <li
      className={className}
      data-stat-id={row.id}
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => {
        setIsHovered(false);
        setShowTooltip(false);
      }}
    >
      <div className="min-w-0 flex flex-1 items-center pr-3 text-sm text-slate-600 dark:text-slate-300">
        <span className="truncate whitespace-nowrap">{row.name}</span>
        {isSecondary && (
          <span className="ml-2 inline-block h-2 w-2 rounded-full bg-teal-500 dark:bg-teal-400 shrink-0" />
        )}
      </div>

      <div className="ml-2 shrink-0 text-right text-sm font-semibold text-slate-700 tabular-nums dark:text-slate-200 flex items-center">
        {showCityAvg && (
          <span
            className="mr-2 text-xs font-medium text-slate-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 dark:text-slate-500"
            onMouseEnter={handleAvgHover}
            onMouseMove={handleAvgHover}
            onMouseLeave={() => setShowTooltip(false)}
          >
            {formatStatValue(row.cityAvg, row.type)}
          </span>
        )}
        <span>{formatStatValue(row.value, row.type)}</span>
      </div>

      {isSelected && isHovered && (
        <button
          type="button"
          className="absolute right-1 top-1/2 z-10 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-brand-50/90 text-xs font-bold text-brand-500 shadow-sm transition hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-brand-400/20 dark:text-brand-100 dark:hover:text-white"
          onClick={handleClearClick}
        >
          <span aria-hidden="true">×</span>
          <span className="sr-only">Clear selected stat</span>
        </button>
      )}

      {showTooltip && (
        <div
          className="pointer-events-none absolute z-10 rounded border border-black/10 bg-slate-800 px-1.5 py-0.5 text-[10px] text-white shadow-sm dark:border-white/20 dark:bg-slate-200 dark:text-slate-900"
          style={{
            left: `${tooltipPos.x + 8}px`,
            top: `${tooltipPos.y - 18}px`,
          }}
        >
          city average
        </div>
      )}
    </li>
  );
};
