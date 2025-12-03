import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Stat } from "../../types/stat";
import type { AreaId } from "../../types/areas";
import { areaIdKey } from "../../types/areas";
import type { SeriesByKind, SeriesEntry, StatBoundaryEntry } from "../hooks/useStats";
import { formatStatValue } from "../../lib/format";

const LINE_COLORS_ZIP = ["#375bff", "#8f20f8", "#cf873f", "#ff7f00"];
const LINE_COLORS_COUNTY = ["#0ea5e9", "#10b981", "#f97316", "#a855f7"];
const BAR_COLOR_ZIP = "#64748b";
const BAR_COLOR_COUNTY = "#64748b";
const PINNED_BAR_COLOR = "#85a3ff";

const getAvgColor = () =>
  document.documentElement.classList.contains("dark") ? "#b3b6bd" : "#64748b";

const computeCityAvgSeries = (entries: SeriesEntry[]): { date: string; value: number }[] =>
  entries.map((e) => {
    const values = Object.values(e.data ?? {});
    const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const avg = nums.length ? nums.reduce((sum, v) => sum + v, 0) / nums.length : 0;
    return { date: e.date, value: avg };
  });

const computeCityAvgValue = (entry: StatBoundaryEntry | undefined): number => {
  if (!entry) return 0;
  const values = Object.values(entry.data ?? {});
  const nums = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  if (nums.length === 0) return 0;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
};

const getLineColorForKind = (kind: SupportedAreaKind, index: number): string => {
  const palette = kind === "ZIP" ? LINE_COLORS_ZIP : LINE_COLORS_COUNTY;
  return palette[index % palette.length];
};

const getBarColorForKind = (kind: SupportedAreaKind): string =>
  kind === "ZIP" ? BAR_COLOR_ZIP : BAR_COLOR_COUNTY;

interface AreaSeriesEntry {
  key: string;
  kind: SupportedAreaKind;
  id: string;
  label: string;
  isPinned: boolean;
}

type SupportedAreaKind = "ZIP" | "COUNTY";
type SelectedAreasMap = Partial<Record<SupportedAreaKind, string[]>>;
type PinnedAreasMap = Partial<Record<SupportedAreaKind, string[]>>;

type SeriesByKindMap = Map<string, SeriesByKind>;
type StatDataByKindMap = Map<string, Partial<Record<SupportedAreaKind, StatBoundaryEntry>>>;

const SUPPORTED_KINDS: SupportedAreaKind[] = ["ZIP", "COUNTY"];

interface StatVizProps {
  statsById?: Map<string, Stat>;
  seriesByStatIdByKind?: SeriesByKindMap;
  statDataById?: StatDataByKindMap;
  selectedAreas?: SelectedAreasMap;
  pinnedAreas?: PinnedAreasMap;
  selectedStatId?: string | null;
  hoveredArea?: AreaId | null;
  areaNameLookup?: (kind: SupportedAreaKind, code: string) => string;
  onHoverArea?: (area: AreaId | null) => void;
  activeAreaKind?: SupportedAreaKind | null;
  zipScopeDisplayName?: string | null;
}

interface LineChartProps {
  series: {
    label: string;
    color: string;
    points: { date: string; value: number }[];
    areaKey?: string;
    isAverage?: boolean;
  }[];
  statType?: string | null;
  onHoverLine?: (label: string | null, areaKey?: string) => void;
}

const LineChart = ({ series, onHoverLine, statType }: LineChartProps) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  const height = 120;
  const [hoverState, setHoverState] = useState<{
    index: number;
    clientX: number;
    clientY: number;
    plotY: number;
  } | null>(null);
  const hoverLineHandlerRef = useRef(onHoverLine);

  // Keep the latest onHoverLine handler without retriggering downstream effects.
  useEffect(() => {
    hoverLineHandlerRef.current = onHoverLine;
  }, [onHoverLine]);

  useEffect(() => {
    const container = svgRef.current?.parentElement;
    if (!container) return;
    const update = () => {
      const next = container.clientWidth;
      if (next > 0) {
        setWidth((prev) => (Math.abs(prev - next) > 1 ? next : prev));
      }
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => update());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const allVals: number[] = [];
  for (const s of series)
    for (const p of s.points) if (Number.isFinite(p.value)) allVals.push(p.value);
  const hasValues = allVals.length > 0;
  const minVRaw = hasValues ? Math.min(...allVals) : 0;
  const maxVRaw = hasValues ? Math.max(...allVals) : 0;

  const baseMin = Math.min(0, minVRaw);
  const baseMax = Math.max(1, maxVRaw);
  const baseRange = Math.max(1e-6, baseMax - baseMin);
  const basePad = baseRange * 0.08;

  let yMin = baseMin;
  let yMax = baseMax + basePad;

  // If the data sits far from the chart edges, tighten the domain and mark breaks.
  const gapTop = yMax - maxVRaw;
  const gapBottom = minVRaw - yMin;
  const gapRatioTop = yMax > yMin ? gapTop / (yMax - yMin) : 0;
  const gapRatioBottom = yMax > yMin ? gapBottom / (yMax - yMin) : 0;
  const clampPad = Math.max(basePad * 0.5, baseRange * 0.05);

  if (gapRatioTop > 0.28 && maxVRaw !== 0) {
    yMax = maxVRaw + clampPad;
  }
  if (gapRatioBottom > 0.28 && minVRaw > 0) {
    yMin = minVRaw - clampPad;
  }
  if (yMax - yMin < 1e-6) yMax = yMin + 1;

  const fmt = (n: number) => formatStatValue(n, statType ?? "count");
  const maxLabel = fmt(yMax);
  const labelWidth = maxLabel.length * 6;
  const dynamicLeftMargin = Math.max(16, labelWidth + 8);

  const margin = { top: 8, right: 8, bottom: 16, left: dynamicLeftMargin };
  const innerW = Math.max(16, width - margin.left - margin.right);
  const innerH = height - margin.top - margin.bottom;

  const dates = series.length > 0 ? series[0].points.map((p) => p.date) : [];
  const y = (v: number) => innerH - ((v - yMin) / (yMax - yMin)) * innerH;
  const x = (i: number) => (dates.length <= 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW);

  const isDark = document.documentElement.classList.contains("dark");
  const gridStroke = isDark ? "#334155" : "#cbd5e1";
  const gridOpacity = "0.35";
  const ticks = 3;

  const handlePointer = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (dates.length === 0) {
        setHoverState(null);
        return;
      }
      const svg = svgRef.current;
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const px = event.clientX - rect.left - margin.left;
      const py = event.clientY - rect.top - margin.top;
      if (py < 0 || py > innerH) {
        setHoverState(null);
        return;
      }
      const tx = Math.max(0, Math.min(innerW, px));
      const fraction = innerW <= 0 || dates.length <= 1 ? 0 : tx / innerW;
      const idx = Math.round(fraction * (dates.length - 1));
      const nextState = {
        index: idx,
        clientX: event.clientX,
        clientY: event.clientY,
        plotY: Math.max(0, Math.min(innerH, py)),
      };
      setHoverState(nextState);
    },
    [dates.length, innerH, innerW, margin.left, margin.top],
  );

  const handleLeave = useCallback(() => {
    setHoverState(null);
  }, []);

  const activeRows = useMemo(() => {
    if (!hoverState || dates.length === 0) return null;
    const idx = hoverState.index;
    const entries = series
      .map((s) => ({
        label: s.label,
        color: s.color,
        value: s.points[idx]?.value ?? null,
        areaKey: s.areaKey,
        isAverage: s.isAverage ?? false,
        yCoord: (() => {
          const point = s.points[idx];
          return point ? y(point.value) : null;
        })(),
      }))
      .filter((row) => row.value != null)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    if (entries.length === 0) return null;
    return { index: idx, rows: entries };
  }, [hoverState, series, dates.length]);

  const primaryHoverRow = useMemo(() => {
    if (!activeRows) return null;
    const withArea = activeRows.rows.filter((row) => row.areaKey);
    if (withArea.length === 0) return activeRows.rows[0] ?? null;
    if (!hoverState) return withArea[0];
    const targetY = hoverState.plotY;
    return withArea.reduce((best, row) => {
      if (!best) return row;
      if (row.yCoord == null) return best;
      if (best.yCoord == null) return row;
      const dist = Math.abs(row.yCoord - targetY);
      const bestDist = Math.abs(best.yCoord - targetY);
      return dist < bestDist ? row : best;
    }, withArea[0] ?? null);
  }, [activeRows, hoverState]);

  useEffect(() => {
    const handler = hoverLineHandlerRef.current;
    if (!handler) return;
    if (primaryHoverRow) {
      handler(primaryHoverRow.label, primaryHoverRow.areaKey);
    } else {
      handler(null);
    }
  }, [primaryHoverRow]);

  useEffect(() => {
    const tooltip = tooltipRef.current;
    const svg = svgRef.current;
    if (!tooltip || !svg || !hoverState || !activeRows) {
      if (tooltip) tooltip.style.opacity = "0";
      return;
    }
    const rect = svg.getBoundingClientRect();
    const tx = Math.min(rect.width - 160, Math.max(12, hoverState.clientX - rect.left + 14));
    const ty = Math.min(rect.height - 40, Math.max(12, hoverState.clientY - rect.top + 36));
    tooltip.style.left = `${tx}px`;
    tooltip.style.top = `${ty}px`;
    tooltip.style.opacity = "1";
  }, [hoverState, activeRows]);

  const guideX = hoverState && hoverState.index < dates.length ? x(hoverState.index) : null;

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        onPointerMove={handlePointer}
        onPointerEnter={handlePointer}
        onPointerLeave={handleLeave}
      >
        <g transform={`translate(${margin.left},${margin.top})`}>
        {Array.from({ length: ticks + 1 }).map((_, i) => {
          const t = i / ticks;
          const v = yMin + (yMax - yMin) * t;
          const yPos = y(v);
          return (
            <g key={i}>
              <line x1={0} x2={innerW} y1={yPos} y2={yPos} stroke={gridStroke} strokeWidth={1} opacity={gridOpacity} />
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

        {series.map((s, idx) => {
          const pts = s.points.map((p, i) => ({ x: x(i), y: y(p.value), value: p.value }));
          if (pts.length === 0) return null;
          const path = buildSmoothPath(pts, 0.2);
          const marker = hoverState ? pts[hoverState.index] : null;
          const isHighlighted = primaryHoverRow?.label === s.label;
          const isAverageSeries = s.isAverage === true;
          const baseStroke = isAverageSeries ? (isHighlighted ? 3 : 2.5) : isHighlighted ? 3 : 2;
          const strokeOpacity = isHighlighted ? 0.9 : 0.6;
          return (
            <g key={idx}>
              <path
                d={path}
                fill="none"
                stroke={s.color}
                strokeOpacity={strokeOpacity}
                strokeWidth={baseStroke}
                strokeDasharray={isAverageSeries ? "4 3" : "0"}
                style={{ cursor: "crosshair" }}
              />
              {marker && (
                <circle
                  cx={marker.x}
                  cy={marker.y}
                  r={3}
                  fill={s.color}
                  stroke={isDark ? "#1e293b" : "#e2e8f0"}
                  strokeWidth={1}
                  opacity={0.9}
                />
              )}
            </g>
          );
        })}

        {guideX != null && (
          <line
            x1={guideX}
            x2={guideX}
            y1={0}
            y2={innerH}
            stroke={isDark ? "#475569" : "#94a3b8"}
            strokeWidth={1}
            strokeDasharray="2 2"
            opacity={0.8}
          />
        )}
      </g>
      </svg>
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-10 rounded border border-slate-200/80 bg-white/95 px-2 py-1 text-[10px] text-slate-800 shadow-lg transition-opacity duration-75 dark:border-slate-700/60 dark:bg-slate-900/95 dark:text-slate-100"
        style={{ opacity: 0, minWidth: "120px" }}
      >
        {activeRows && (
          <div className="space-y-0.5">
            <div className="text-[9px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {dates[activeRows.index]}
            </div>
            {activeRows.rows.map((row) => (
              <div
                key={row.label}
                className={`flex items-center justify-between gap-2 whitespace-nowrap ${
                  row.label === primaryHoverRow?.label ? "font-semibold text-slate-700 dark:text-slate-100" : ""
                }`}
              >
                <span className="flex items-center gap-2 text-[10px]">
                  <span
                    className="inline-block h-[3px] w-3 rounded-full"
                    style={{ backgroundColor: row.color }}
                  />
                  {row.label}
                </span>
                <span className="tabular-nums text-[10px] text-slate-500 dark:text-slate-300">
                  {formatStatValue(row.value ?? 0, statType ?? "count")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
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

interface BarChartEntry {
  label: string;
  color: string;
  value: number;
  areaKey?: string;
}

interface BarChartProps {
  entries: BarChartEntry[];
  statType: string;
  hoveredAreaKey?: string | null;
  onHoverArea?: (areaKey: string | null) => void;
}

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

const BarChart = ({ entries, statType, hoveredAreaKey, onHoverArea }: BarChartProps) => {
  const width = 320;
  const barH = 16;
  const gap = 6;
  const right = 90;
  const top = 6;

  const maxLabelWidth = useMemo(() => {
    if (entries.length === 0) return 0;
    const fallback = Math.max(...entries.map((entry) => entry.label.length)) * 6;
    if (typeof document === "undefined") return fallback;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return fallback;
    context.font = "10px Inter, system-ui, sans-serif";
    return entries.reduce((max, entry) => Math.max(max, context.measureText(entry.label).width), 0);
  }, [entries]);

  // Ensure the chart has enough left margin for the longest label so county names never clip.
  const left = Math.max(32, Math.ceil(maxLabelWidth) + 2);
  const height = top + entries.length * (barH + gap);
  const innerW = Math.max(16, width - left - right);
  const max = Math.max(1, ...entries.map((e) => e.value));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
      {entries.map((entry, i) => {
        const yPos = top + i * (barH + gap);
        const w = (entry.value / max) * innerW;
        const isHoverable = entry.areaKey && !entry.areaKey.startsWith("AVG-");
        const isHovered = isHoverable && entry.areaKey === hoveredAreaKey;
        const fillColor = isHovered ? shade(entry.color, 0.15) : entry.color;

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
              {entry.label}
            </text>
            <rect
              x={left}
              y={yPos}
              width={Math.max(0, w)}
              height={barH}
              fill={fillColor}
              rx={3}
              ry={3}
              style={{ cursor: isHoverable ? "pointer" : "default" }}
              onMouseEnter={() => isHoverable && onHoverArea?.(entry.areaKey ?? null)}
              onMouseLeave={() => isHoverable && onHoverArea?.(null)}
            />
            <text
              x={left + Math.max(6, w + 4)}
              y={yPos + barH / 2}
              dominantBaseline="middle"
              fill="#94a3b8"
              fontSize={10}
            >
              {formatStatValue(entry.value, statType)}
            </text>
          </g>
        );
      })}
    </svg>
  );
};

export const StatViz = ({
  statsById = new Map(),
  seriesByStatIdByKind = new Map(),
  statDataById = new Map(),
  selectedAreas,
  pinnedAreas,
  selectedStatId = null,
  hoveredArea = null,
  areaNameLookup,
  activeAreaKind = null,
  onHoverArea,
  zipScopeDisplayName = null,
}: StatVizProps) => {
  const [collapsed, setCollapsed] = useState(false);
  const [hoveredLineLabel, setHoveredLineLabel] = useState<string | null>(null);

  const areaEntries = useMemo<AreaSeriesEntry[]>(() => {
    const entries: AreaSeriesEntry[] = [];
    const pinnedZipSet = new Set(pinnedAreas?.ZIP ?? []);
    const pinnedCountySet = new Set(pinnedAreas?.COUNTY ?? []);

    const buildLabel = (kind: SupportedAreaKind, code: string) => {
      if (areaNameLookup) {
        const label = areaNameLookup(kind, code);
        if (label) return label;
      }
      return kind === "ZIP" ? code : `${code}`;
    };

    const pushEntries = (kind: SupportedAreaKind, codes: string[] | undefined, pinnedSet: Set<string>) => {
      for (const code of codes ?? []) {
        if (typeof code !== "string" || code.trim().length === 0) continue;
        const key = areaIdKey({ kind, id: code });
        entries.push({
          key,
          kind,
          id: code,
          label: buildLabel(kind, code),
          isPinned: pinnedSet.has(code),
        });
      }
    };

    pushEntries("ZIP", selectedAreas?.ZIP, pinnedZipSet);
    pushEntries("COUNTY", selectedAreas?.COUNTY, pinnedCountySet);

    return entries;
  }, [selectedAreas, pinnedAreas, areaNameLookup]);

  const areaKeyToAreaId = useMemo(() => {
    const map = new Map<string, AreaId>();
    for (const entry of areaEntries) {
      map.set(entry.key, { kind: entry.kind, id: entry.id });
    }
    return map;
  }, [areaEntries]);

  const pinnedAreaKeys = useMemo(() => new Set(areaEntries.filter((e) => e.isPinned).map((e) => e.key)), [areaEntries]);
  const hoveredAreaKey = hoveredArea ? areaIdKey(hoveredArea) : null;

  const getDefaultStatId = (): string | null => {
    for (const stat of statsById.values()) {
      if (stat.name.toLowerCase() === "population") return stat.id;
    }
    return null;
  };

  const statId = selectedStatId || getDefaultStatId();
  const stat = statId ? statsById.get(statId) ?? null : null;
  const seriesByKind = statId ? seriesByStatIdByKind.get(statId) ?? new Map() : new Map();
  const rawStatDataByKind = statId ? statDataById.get(statId) : undefined;
  const statDataByKind: Partial<Record<SupportedAreaKind, StatBoundaryEntry>> = rawStatDataByKind ?? {};

  const cityAvgByKind = useMemo(() => {
    const map = new Map<SupportedAreaKind, number>();
    for (const kind of SUPPORTED_KINDS) {
      const entry = statDataByKind[kind];
      if (entry) map.set(kind, computeCityAvgValue(entry));
    }
    return map;
  }, [statDataByKind]);

  const { latestSummaryValue, latestSummaryType } = useMemo(() => {
    const primaryKind = areaEntries[0]?.kind ?? activeAreaKind ?? "ZIP";
    const summaryType = statDataByKind[primaryKind]?.type ?? "count";

    const values: number[] = [];
    for (const entry of areaEntries) {
      const boundary = statDataByKind[entry.kind];
      const raw = boundary?.data?.[entry.id];
      if (typeof raw === "number" && Number.isFinite(raw)) values.push(raw);
    }

    if (values.length === 0) {
      const fallback = cityAvgByKind.get("ZIP") ?? cityAvgByKind.get("COUNTY") ?? 0;
      return { latestSummaryValue: fallback, latestSummaryType: summaryType };
    }

    if (summaryType === "percent") {
      const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
      return { latestSummaryValue: avg, latestSummaryType: summaryType };
    }

    const total = values.reduce((sum, v) => sum + v, 0);
    return { latestSummaryValue: total, latestSummaryType: summaryType };
  }, [areaEntries, statDataByKind, cityAvgByKind, stat, activeAreaKind]);

  const hasMultiYearSeries = useMemo(() => {
    if (!statId) return false;
    if (!seriesByKind || seriesByKind.size === 0) return false;
    for (const [, entries] of seriesByKind) {
      if (!entries || entries.length === 0) continue;
      const dateSet = new Set<string>();
      for (const e of entries) {
        if (e && typeof e.date === "string") {
          dateSet.add(e.date);
          if (dateSet.size > 1) {
            return true;
          }
        }
      }
    }
    return false;
  }, [statId, seriesByKind]);

  const chartMode = !hasMultiYearSeries || areaEntries.length >= 4 ? "bar" : "line";

  const chartData = useMemo(() => {
    if (!statId || !stat) return null;

    if (chartMode === "bar") {
      const entries: BarChartEntry[] = areaEntries.map((area) => {
        const boundary = statDataByKind[area.kind];
        const raw = boundary?.data?.[area.id];
        const value = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
        const color = pinnedAreaKeys.has(area.key)
          ? PINNED_BAR_COLOR
          : getBarColorForKind(area.kind);
        return { label: area.label, color, value, areaKey: area.key };
      });

      // Add average to entries before sorting
      const avgKind = areaEntries[0]?.kind;
      if (avgKind) {
        const avgValue = cityAvgByKind.get(avgKind);
        if (typeof avgValue === "number") {
          const scopeName = zipScopeDisplayName
            ? zipScopeDisplayName.charAt(0).toUpperCase() + zipScopeDisplayName.slice(1).toLowerCase()
            : null;
          const avgLabel =
            avgKind === "ZIP"
              ? scopeName
                ? `${scopeName} Avg`
                : "ZIP Avg"
              : "County Avg";
          entries.push({
            label: avgLabel,
            color: getAvgColor(),
            value: avgValue,
            areaKey: `AVG-${avgKind}`,
          });
        }
      }

      // Sort all entries from greatest to least
      entries.sort((a, b) => b.value - a.value);

      const primaryKind = areaEntries[0]?.kind ?? activeAreaKind ?? "ZIP";
      return {
        mode: "bar" as const,
        entries,
        statType: statDataByKind[primaryKind]?.type ?? "count",
      };
    }

    const lineSeries: {
      label: string;
      color: string;
      points: { date: string; value: number }[];
      areaKey?: string;
      isAverage?: boolean;
    }[] = [];
    areaEntries.forEach((area, index) => {
      const series = seriesByKind.get(area.kind) ?? [];
      if (series.length === 0) return;
      const points = series.map((entry: SeriesEntry) => ({
        date: entry.date,
        value: typeof entry.data?.[area.id] === "number" ? (entry.data[area.id] as number) : 0,
      }));
      lineSeries.push({
        label: area.label,
        color: getLineColorForKind(area.kind, index),
        points,
        areaKey: area.key,
      });
    });

    // Fall back to the active boundary mode so averages render even before a selection is made.
    const avgKind = areaEntries[0]?.kind ?? activeAreaKind ?? "ZIP";
    const avgSeriesEntries = seriesByKind.get(avgKind) ?? [];
    const avgSeries = computeCityAvgSeries(avgSeriesEntries);
    if (avgSeries.length > 0) {
      const scopeName = zipScopeDisplayName
        ? zipScopeDisplayName.charAt(0).toUpperCase() + zipScopeDisplayName.slice(1).toLowerCase()
        : null;
      const avgLabel = avgKind === "COUNTY" ? "State Avg" : scopeName ? `${scopeName} Average` : "City Average";
      lineSeries.push({ label: avgLabel, color: getAvgColor(), points: avgSeries, isAverage: true });
    }

    return { mode: "line" as const, series: lineSeries, statType: avgSeriesEntries[0]?.type ?? "count" };
  }, [stat, statId, chartMode, areaEntries, seriesByKind, statDataByKind, cityAvgByKind, pinnedAreaKeys, activeAreaKind, zipScopeDisplayName]);

  const subtitle = useMemo(() => {
    if (collapsed) {
      if (latestSummaryValue == null) return "";
      return formatStatValue(latestSummaryValue, latestSummaryType ?? "count");
    }
    if (chartData?.mode === "bar") {
      return "";
    }
    if (chartData?.mode === "line") {
      const series = chartData.series;
      if (!series || series.length === 0) return "";
      const firstSeries = series[0];
      if (!firstSeries) return "";
      const dates = firstSeries.points.map((p) => p.date);
      if (dates.length >= 2) return `${dates[0]}-${dates[dates.length - 1]}`;
      return dates[0] ?? "";
    }
    return "";
  }, [collapsed, chartData, stat, latestSummaryValue]);

  const handleHoverAreaKey = (areaKey: string | null) => {
    if (!areaKey) {
      onHoverArea?.(null);
      return;
    }
    const area = areaKeyToAreaId.get(areaKey);
    if (area) onHoverArea?.(area);
  };

  return (
    <div
      className={`border-b border-slate-200 px-4 py-3 dark:border-slate-800 ${
        collapsed ? "bg-white/70 dark:bg-slate-900/70" : "bg-slate-50/70 dark:bg-slate-800/70"
      }`}
    >
      <div
        className={`flex cursor-pointer select-none items-center justify-between ${collapsed ? "mb-0" : "mb-2"}`}
        onClick={() => setCollapsed(!collapsed)}
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          {stat ? (stat.label || stat.name) : "Trend"}
        </h3>
        <div className="text-xs text-slate-400 dark:text-slate-500">{subtitle}</div>
      </div>

      {!collapsed && (
        <div className="relative w-full" style={{ overflow: "visible" }}>
          {!stat || !chartData ? (
            <div className="text-xs text-slate-400 dark:text-slate-500">No data</div>
          ) : chartData.mode === "bar" ? (
            <BarChart
              entries={chartData.entries}
              statType={chartData.statType}
              hoveredAreaKey={hoveredAreaKey}
              onHoverArea={handleHoverAreaKey}
            />
          ) : (
            <LineChart
              series={chartData.series}
              statType={chartData.statType}
              onHoverLine={(label, areaKey) => {
                setHoveredLineLabel(label);
                if (areaKey) handleHoverAreaKey(areaKey);
                else onHoverArea?.(null);
              }}
            />
          )}

          {hoveredLineLabel && chartData?.mode === "line" && (
            <div className="pointer-events-none absolute z-10 hidden rounded border border-black/10 bg-slate-800 px-1.5 py-0.5 text-[10px] text-white shadow-sm dark:border-white/20 dark:bg-slate-200 dark:text-slate-900">
              {hoveredLineLabel}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
