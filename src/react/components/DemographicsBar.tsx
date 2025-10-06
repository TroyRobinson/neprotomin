import { useRef, useState } from "react";

export interface DemographicStats {
  selectedCount: number;
  label?: string;
  population?: number;
  avgAge?: number;
  marriedPercent?: number;
}

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

interface DemographicsBarProps {
  stats: DemographicStats | null;
  breakdowns?: Map<string, BreakdownGroup>;
}

const DEFAULT_TITLE = "TULSA";

const formatPopulation = (value: number | undefined): string => {
  if (!Number.isFinite(value || NaN)) return "—";
  const v = value as number;
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return `${Math.round(v)}`;
};

const formatNumber = (value: number | undefined): string =>
  Number.isFinite(value || NaN) ? `${Math.round(value as number)}` : "—";

const formatPercent = (value: number | undefined): string =>
  Number.isFinite(value || NaN) ? `${Math.round(value as number)}%` : "—%";

const COLOR_CLASS: Record<string, string> = {
  "brand-200": "bg-brand-200",
  "brand-300": "bg-brand-300",
  "brand-400": "bg-brand-400",
  "brand-500": "bg-brand-500",
  "brand-700": "bg-brand-700",
};

interface SegmentBarProps {
  segments: BreakdownSegment[];
}

const SegmentBar = ({ segments }: SegmentBarProps) => {
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  let cumulative = 0;

  return (
    <div className="relative" ref={containerRef}>
      <div className="relative h-5 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
        {segments.map((seg) => {
          const width = Math.max(0, Math.min(100, Math.round(seg.valuePercent)));
          if (width <= 0) return null;

          const colorClass = COLOR_CLASS[seg.colorToken] || "bg-brand-300";
          const left = cumulative;
          cumulative += width;

          return (
            <div
              key={seg.key}
              className={`absolute bottom-0 top-0 ${colorClass}`}
              style={{ left: `${left}%`, width: `${width}%` }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const containerRect = containerRef.current?.getBoundingClientRect();
                setTooltip({
                  text: `${seg.label}: ${width}%`,
                  x: containerRect ? e.clientX - containerRect.left : e.clientX,
                  y: containerRect ? rect.top - containerRect.top : rect.top,
                });
              }}
              onMouseMove={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const containerRect = containerRef.current?.getBoundingClientRect();
                setTooltip({
                  text: `${seg.label}: ${width}%`,
                  x: containerRect ? e.clientX - containerRect.left : e.clientX,
                  y: containerRect ? rect.top - containerRect.top : rect.top,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
            />
          );
        })}
      </div>
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-medium text-white shadow"
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

interface BreakdownGroupProps {
  label: string;
  segments: BreakdownSegment[];
}

const BreakdownGroup = ({ label, segments }: BreakdownGroupProps) => (
  <div className="relative mt-2">
    <div className="mb-1 text-[11px] font-medium text-slate-500 dark:text-slate-400">{label}</div>
    <SegmentBar segments={segments} />
  </div>
);

export const DemographicsBar = ({ stats, breakdowns }: DemographicsBarProps) => {
  const [expanded, setExpanded] = useState(false);

  const title = stats?.label?.trim() ? stats.label : DEFAULT_TITLE;
  const hasData =
    Number.isFinite((stats?.population as number) ?? NaN) &&
    Number.isFinite((stats?.avgAge as number) ?? NaN) &&
    Number.isFinite((stats?.marriedPercent as number) ?? NaN);

  const ethnicity = breakdowns?.get("ethnicity");
  const income = breakdowns?.get("income");
  const education = breakdowns?.get("education");

  return (
    <div
      className={`flex flex-col border-b border-slate-200 text-xs dark:border-slate-800 ${
        expanded
          ? "bg-slate-50/70 dark:bg-slate-800/70"
          : "bg-white/70 dark:bg-slate-900/70"
      }`}
    >
      <div
        className="flex cursor-pointer select-none items-center px-4 py-2"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        <div className="font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {title}
        </div>
        <div className="ml-3 flex items-center gap-4 text-slate-600 dark:text-slate-300">
          <span>
            <span className={`font-medium ${hasData ? "text-slate-400 dark:text-slate-500" : "text-slate-400 dark:text-slate-500"}`}>
              Pop:
            </span>{" "}
            <span className={hasData ? "text-slate-400 dark:text-slate-500" : "text-slate-400 dark:text-slate-500"}>
              {hasData && stats ? formatPopulation(stats.population) : "—"}
            </span>
          </span>
          <span>
            <span className={`font-medium ${hasData ? "text-slate-400 dark:text-slate-500" : "text-slate-400 dark:text-slate-500"}`}>
              Avg Age:
            </span>{" "}
            <span className={hasData ? "text-slate-400 dark:text-slate-500" : "text-slate-400 dark:text-slate-500"}>
              {hasData && stats ? formatNumber(stats.avgAge) : "—"}
            </span>
          </span>
          <span>
            <span className={`font-medium ${hasData ? "text-slate-400 dark:text-slate-500" : "text-slate-400 dark:text-slate-500"}`}>
              Married:
            </span>{" "}
            <span className={hasData ? "text-slate-400 dark:text-slate-500" : "text-slate-400 dark:text-slate-500"}>
              {hasData && stats ? formatPercent(stats.marriedPercent) : "—%"}
            </span>
          </span>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-3">
          {ethnicity && <BreakdownGroup label="Ethnicity" segments={ethnicity.segments} />}
          {income && <BreakdownGroup label="Income Level" segments={income.segments} />}
          {education && <BreakdownGroup label="Education Level" segments={education.segments} />}
        </div>
      )}
    </div>
  );
};
