import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { CombinedDemographicsSnapshot, BreakdownGroup } from "../hooks/useDemographics";

interface DemographicsBarProps {
  snapshot: CombinedDemographicsSnapshot | null;
}

interface BreakdownSegmentDisplay {
  key: string;
  label: string;
  colorToken: string;
  valuePercent: number;
}

const COLOR_CLASS: Record<string, string> = {
  "brand-200": "bg-brand-200",
  "brand-300": "bg-brand-300",
  "brand-400": "bg-brand-400",
  "brand-500": "bg-brand-500",
  "brand-700": "bg-brand-700",
};

const formatPopulation = (value: number | undefined): string => {
  if (!Number.isFinite(value || NaN)) return "—";
  const v = value as number;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}k`;
  return `${Math.round(v)}`;
};

const formatNumber = (value: number | undefined): string =>
  Number.isFinite(value || NaN) ? `${Math.round(value as number)}` : "—";

const formatPercent = (value: number | undefined): string =>
  Number.isFinite(value || NaN) ? `${Math.round(value as number)}%` : "—%";

const SegmentBar = ({ segments }: { segments: BreakdownSegmentDisplay[] }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  let offset = 0;

  const updateTooltip = (text: string, event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      setTooltip({ text, x: event.clientX, y: event.clientY });
      return;
    }
    setTooltip({ text, x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  return (
    <div ref={containerRef} className="relative h-5 w-full">
      <div className="relative h-full w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
        {segments.map((seg) => {
        const width = Math.max(0, Math.min(100, Math.round(seg.valuePercent)));
        const left = offset;
        offset += width;
        if (width <= 0) return null;
        const colorClass = COLOR_CLASS[seg.colorToken] || "bg-brand-300";
        return (
          <div
            key={seg.key}
            className={`absolute bottom-0 top-0 ${colorClass}`}
            style={{ left: `${left}%`, width: `${width}%` }}
            onMouseEnter={(e) => updateTooltip(`${seg.label}: ${width}%`, e)}
            onMouseMove={(e) => updateTooltip(`${seg.label}: ${width}%`, e)}
            onMouseLeave={() => setTooltip(null)}
          />
        );
      })}
      </div>
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-medium text-white shadow dark:bg-slate-200 dark:text-slate-900"
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y - 32}px`,
            transform: "translateX(-50%)",
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
};

const renderBreakdowns = (groups: Map<string, BreakdownGroup>) => {
  if (groups.size === 0) return null;
  return Array.from(groups.entries()).map(([key, group]) => {
    const displaySegments = group.segments.map((seg) => ({
      key: seg.key,
      label: seg.label,
      colorToken: seg.colorToken,
      valuePercent: seg.valuePercent,
    }));
    return (
      <div key={key} className="mt-2">
        <div className="mb-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">
          {key.charAt(0).toUpperCase() + key.slice(1)}
        </div>
        <SegmentBar segments={displaySegments} />
      </div>
    );
  });
};

export const DemographicsBar = ({ snapshot }: DemographicsBarProps) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const snapshotKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!snapshot) {
      snapshotKeyRef.current = null;
      setIsExpanded(false);
      return;
    }
    const key = `${snapshot.label}|${snapshot.areaCount}|${snapshot.stats?.selectedCount ?? 0}|${snapshot.isMissing}`;
    const prevKey = snapshotKeyRef.current;
    snapshotKeyRef.current = key;
    if (prevKey === key || isExpanded) return;
    setIsExpanded(false);
  }, [snapshot, isExpanded]);

  if (!snapshot) {
    return (
      <div className="border-b border-slate-200 bg-white/70 px-4 py-3 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-400">
        Loading demographics…
      </div>
    );
  }

  const stats = snapshot.stats;
  const populationLabel = formatPopulation(stats?.population);
  const avgAgeLabel = formatNumber(stats?.avgAge);
  const marriedLabel = formatPercent(stats?.marriedPercent);
  const hasBreakdowns = snapshot.breakdowns.size > 0;
  const selectedCount = stats?.selectedCount ?? 0;
  const toggleExpanded = () => setIsExpanded((prev) => !prev);
  const showSelectedPill = selectedCount > 1;
  const headerLabel = stats?.label ?? snapshot.label;

  return (
    <div className="border-b border-slate-200 bg-white/70 px-4 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-300">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
      >
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {headerLabel}
            </span>
            {showSelectedPill && (
              <span className="rounded-full bg-slate-100 px-2 py-[2px] text-[10px] font-medium text-slate-600 dark:bg-slate-600 dark:text-slate-200">
                {selectedCount} selected
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-4 text-slate-600 dark:text-slate-300">
            <span>
              <span className="font-medium text-slate-400 dark:text-slate-500">Population:</span> {populationLabel}
            </span>
            <span>
              <span className="font-medium text-slate-400 dark:text-slate-500">Avg Age:</span> {avgAgeLabel}
            </span>
            <span>
              <span className="font-medium text-slate-400 dark:text-slate-500">Married:</span> {marriedLabel}
            </span>
          </div>
        </div>
        <span
          className={`mt-[2px] text-base text-slate-400 transition-transform dark:text-slate-500 ${
            isExpanded ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>

      {isExpanded && (
        <div className="mt-3">
          {snapshot.isMissing ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Data unavailable for this area. Try selecting different areas or check back later.
            </p>
          ) : hasBreakdowns ? (
            <div className="space-y-3">{renderBreakdowns(snapshot.breakdowns)}</div>
          ) : (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Demographic breakdowns are missing right now. They will appear here once real data is loaded.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
