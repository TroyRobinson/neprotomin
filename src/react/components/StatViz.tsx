import { useState, useMemo } from "react";
import type { Stat } from "../../types/stat";
import { formatStatValue } from "../../lib/format";

interface SeriesEntry {
  date: string;
  type: string;
  data: Record<string, number>;
}

interface StatVizProps {
  statsById?: Map<string, Stat>;
  seriesByStatId?: Map<string, SeriesEntry[]>;
  selectedZips?: string[];
  selectedStatId?: string | null;
  hoveredZip?: string | null;
  pinnedZips?: string[];
  onHoverZip?: (zip: string | null) => void;
}

const LINE_COLORS = ["#375bff", "#8f20f8", "#cf873f", "#ff7f00"];
const PINNED_BAR_COLOR = "#85a3ff";

const getAvgColor = () =>
  document.documentElement.classList.contains("dark") ? "#b3b6bd" : "#64748b";

const shade = (hex: string, amount: number): string => {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return hex;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  const adj = (c: number) => (amount >= 0 ? c + (255 - c) * amount : c + c * amount);
  return (
    "#" +
    clamp(adj(r)).toString(16).padStart(2, "0") +
    clamp(adj(g)).toString(16).padStart(2, "0") +
    clamp(adj(b)).toString(16).padStart(2, "0")
  );
};

const buildSmoothPath = (points: { x: number; y: number }[], tension = 0.2): string => {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  const path: string[] = [`M${points[0].x},${points[0].y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;
    path.push(`C${cp1x},${cp1y},${cp2x},${cp2y},${p2.x},${p2.y}`);
  }
  return path.join(" ");
};

interface LineChartProps {
  series: { label: string; color: string; points: { date: string; value: number }[] }[];
  onHoverLine?: (label: string | null) => void;
}

const LineChart = ({ series, onHoverLine }: LineChartProps) => {
  const width = 320;
  const height = 120;

  const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
  const allVals: number[] = [];
  for (const s of series) for (const p of s.points) allVals.push(p.value);
  const maxVRaw = Math.max(0, ...allVals);
  const yMin = 0;
  const yPad = maxVRaw * 0.08;
  const yMax = Math.max(1, maxVRaw + yPad);

  const maxLabel = fmt(yMax);
  const labelWidth = maxLabel.length * 6;
  const dynamicLeftMargin = Math.max(16, labelWidth + 8);

  const margin = { top: 8, right: 8, bottom: 16, left: dynamicLeftMargin };
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const dates = series.length > 0 ? series[0].points.map((p) => p.date) : [];
  const y = (v: number) => innerH - ((v - yMin) / (yMax - yMin)) * innerH;
  const x = (i: number) => (dates.length <= 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW);

  const isDark = document.documentElement.classList.contains("dark");
  const gridStroke = isDark ? "#334155" : "#cbd5e1";
  const gridOpacity = "0.35";

  const ticks = 3;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
      <g transform={`translate(${margin.left},${margin.top})`}>
        {/* Grid lines and Y-axis labels */}
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const t = i / ticks;
          const v = yMin + (yMax - yMin) * t;
          const yPos = y(v);
          return (
            <g key={i}>
              <line
                x1={0}
                x2={innerW}
                y1={yPos}
                y2={yPos}
                stroke={gridStroke}
                strokeWidth={1}
                opacity={gridOpacity}
              />
              <text
                x={-margin.left}
                y={yPos}
                textAnchor="start"
                dominantBaseline="middle"
                fill="#64748b"
                fontSize={10}
              >
                {fmt(v)}
              </text>
            </g>
          );
        })}

        {/* X-axis labels */}
        {dates.map((d, i) => (
          <text
            key={i}
            x={x(i)}
            y={innerH + 12}
            textAnchor={i === 0 ? "start" : i === dates.length - 1 ? "end" : "middle"}
            fill="#64748b"
            fontSize={10}
          >
            {d}
          </text>
        ))}

        {/* Lines */}
        {series.map((s, idx) => {
          const pts = s.points.map((p, i) => ({ x: x(i), y: y(p.value) }));
          const d = buildSmoothPath(pts, 0.2);
          return (
            <path
              key={idx}
              d={d}
              fill="none"
              stroke={s.color}
              strokeOpacity={0.6}
              strokeWidth={s.label === "CityAv" ? 2.5 : 2}
              strokeDasharray={s.label === "CityAv" ? "4 3" : "0"}
              style={{ cursor: "default" }}
              onMouseEnter={() => onHoverLine?.(s.label)}
              onMouseLeave={() => onHoverLine?.(null)}
            />
          );
        })}
      </g>
    </svg>
  );
};

interface BarChartProps {
  entries: { label: string; color: string; value: number }[];
  hoveredZip?: string | null;
  statType: string;
  onHoverBar?: (label: string | null) => void;
}

const BarChart = ({ entries, hoveredZip, statType, onHoverBar }: BarChartProps) => {
  const width = 320;
  const barH = 16;
  const gap = 6;
  const left = 40;
  const right = 90;
  const top = 6;
  const height = top + entries.length * (barH + gap);
  const innerW = width - left - right;
  const max = Math.max(1, ...entries.map((e) => e.value));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
      {entries.map((e, i) => {
        const yPos = top + i * (barH + gap);
        const w = (e.value / max) * innerW;
        const isZip = e.label && e.label !== "CityAv";
        const isHovered = isZip && hoveredZip === e.label;
        const fillColor = isHovered ? shade(e.color, 0.15) : e.color;

        return (
          <g key={i}>
            <text
              x={left - 6}
              y={yPos + barH / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fill="#64748b"
              fontSize={10}
            >
              {e.label}
            </text>
            <rect
              x={left}
              y={yPos}
              width={Math.max(0, w)}
              height={barH}
              fill={fillColor}
              rx={3}
              ry={3}
              style={{ cursor: isZip ? "pointer" : "default" }}
              onMouseEnter={() => isZip && onHoverBar?.(e.label)}
              onMouseLeave={() => isZip && onHoverBar?.(null)}
            />
            <text
              x={left + Math.max(6, w + 4)}
              y={yPos + barH / 2}
              dominantBaseline="middle"
              fill="#94a3b8"
              fontSize={10}
            >
              {formatStatValue(e.value, statType)}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export const StatViz = ({
  statsById = new Map(),
  seriesByStatId = new Map(),
  selectedZips = [],
  selectedStatId = null,
  hoveredZip = null,
  pinnedZips = [],
  onHoverZip,
}: StatVizProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredLine, setHoveredLine] = useState<string | null>(null);

  const pinnedZipsSet = new Set(pinnedZips);

  const getDefaultStatId = (): string | null => {
    for (const s of statsById.values()) {
      if (s.name.toLowerCase() === "population") return s.id;
    }
    return null;
  };

  const statId = selectedStatId || getDefaultStatId();
  const stat = statId ? statsById.get(statId) || null : null;
  const series = statId ? seriesByStatId.get(statId) || [] : [];

  const computeCityAvg = (entries: SeriesEntry[]): { date: string; value: number }[] => {
    return entries.map((e) => {
      const vals = Object.values(e.data || {});
      const nums = vals.filter((v) => typeof v === "number") as number[];
      const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      return { date: e.date, value: avg };
    });
  };

  const latestSummaryValue = useMemo(() => {
    if (!series.length) return null;
    const latest = series[series.length - 1];
    if (selectedZips.length === 0) {
      const cityAvg = computeCityAvg(series);
      const v = cityAvg[cityAvg.length - 1]?.value;
      return typeof v === "number" ? v : null;
    }
    if (selectedZips.length === 1) {
      const v = latest.data[selectedZips[0]];
      return typeof v === "number" ? v : 0;
    }
    const nums = selectedZips.map((z) =>
      typeof latest.data[z] === "number" ? (latest.data[z] as number) : 0
    );
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  }, [series, selectedZips]);

  const dates = series.map((s) => s.date);
  const cityAvg = computeCityAvg(series);
  const selected = selectedZips.slice(0, 50);

  const subtitle = useMemo(() => {
    if (collapsed) {
      return latestSummaryValue == null ? "" : String(Math.round(latestSummaryValue));
    }
    if (selected.length >= 4) {
      const latest = series[series.length - 1];
      return latest?.date || "";
    }
    if (dates.length > 0) {
      return String(dates[0] + "-" + dates[dates.length - 1]);
    }
    return "";
  }, [collapsed, latestSummaryValue, selected.length, series, dates]);

  const chartData = useMemo(() => {
    if (selected.length >= 4) {
      const latest = series[series.length - 1];
      const BAR_COLOR = "#64748b";
      const CITY_BAR_COLOR = "#94a3b8";
      return selected
        .map((zip) => ({
          label: zip,
          color: pinnedZipsSet.has(zip) ? PINNED_BAR_COLOR : BAR_COLOR,
          value: latest.data[zip] ?? 0,
        }))
        .concat([
          { label: "CityAv", color: CITY_BAR_COLOR, value: cityAvg[cityAvg.length - 1]?.value ?? 0 },
        ])
        .sort((a, b) => b.value - a.value);
    } else {
      const zipSeries = selected.map((zip, i) => ({
        label: zip,
        color: LINE_COLORS[i % LINE_COLORS.length],
        points: series.map((e) => ({ date: e.date, value: e.data[zip] ?? 0 })),
      }));
      return zipSeries.concat([{ label: "CityAv", color: getAvgColor(), points: cityAvg }]);
    }
  }, [selected, series, cityAvg, pinnedZipsSet]);

  const isBarMode = selected.length >= 4;
  const statType = series.length > 0 ? series[0].type : "count";

  return (
    <div
      className={`border-b border-slate-200 px-4 py-3 dark:border-slate-800 ${
        collapsed
          ? "bg-white/70 dark:bg-slate-900/70"
          : "bg-slate-50/70 dark:bg-slate-800/70"
      }`}
    >
      <div
        className={`flex cursor-pointer select-none items-center justify-between ${
          collapsed ? "mb-0" : "mb-2"
        }`}
        onClick={() => setCollapsed(!collapsed)}
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {stat ? stat.name : "Trend"}
        </h3>
        <div className="text-xs text-slate-400 dark:text-slate-500">{subtitle}</div>
      </div>

      {!collapsed && (
        <div className="relative w-full" style={{ overflow: "visible" }}>
          {!stat || series.length === 0 ? (
            <div className="text-xs text-slate-400 dark:text-slate-500">No data</div>
          ) : (
            <>
              {isBarMode ? (
                <BarChart
                  entries={chartData as { label: string; color: string; value: number }[]}
                  hoveredZip={hoveredZip}
                  statType={statType}
                  onHoverBar={onHoverZip}
                />
              ) : (
                <LineChart
                  series={
                    chartData as {
                      label: string;
                      color: string;
                      points: { date: string; value: number }[];
                    }[]
                  }
                  onHoverLine={setHoveredLine}
                />
              )}

              {/* Hover tooltip for line chart */}
              {hoveredLine && !isBarMode && (
                <div className="pointer-events-none absolute z-10 hidden rounded border border-black/10 bg-slate-800 px-1.5 py-0.5 text-[10px] text-white shadow-sm dark:border-white/20 dark:bg-slate-200 dark:text-slate-900">
                  {hoveredLine}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
