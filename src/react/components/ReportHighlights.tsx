import { useEffect, useMemo, useRef } from "react";

import type { SeriesByKind, StatBoundaryEntry } from "../hooks/useStats";

type SupportedAreaKind = "ZIP" | "COUNTY";

type SeriesEntry = { date: string; type: string; data: Record<string, number> };

interface HighlightItem {
  statId: string;
  name: string;
  type: string;
}

interface ReportHighlightsProps {
  items: HighlightItem[];
  selectedKind: SupportedAreaKind | null;
  selectedCodes: string[];
  areaNameLookup: (kind: SupportedAreaKind, code: string) => string;
  statDataById: Map<string, Partial<Record<SupportedAreaKind, StatBoundaryEntry>>>;
  seriesByStatIdByKind: Map<string, SeriesByKind>;
}

const HIGHLIGHT_COLORS = ["#375bff", "#8f20f8", "#cf873f", "#ff7f00"];

const formatValueByType = (value: number, type: string): string => {
  if (!Number.isFinite(value)) return "—";
  if (type === "percent") return `${Math.round(value)}%`;
  if (type === "years") return `${value.toFixed(1)}`;
  return new Intl.NumberFormat().format(Math.round(value));
};

export const ReportHighlights = ({
  items,
  selectedKind,
  selectedCodes,
  areaNameLookup,
  statDataById,
  seriesByStatIdByKind,
}: ReportHighlightsProps) => {
  const selectedAreas = useMemo(
    () =>
      selectedKind
        ? selectedCodes.map((code) => ({
            code,
            label: areaNameLookup(selectedKind, code) || code,
          }))
        : [],
    [areaNameLookup, selectedCodes, selectedKind],
  );

  const baselineLabel = selectedKind === "COUNTY" ? "StateAvg" : "CityAvg";
  const expandedFirstId = items[0]?.statId ?? null;

  const cards = useMemo(() => {
    if (!selectedKind || selectedAreas.length === 0) return [];
    const shouldExpandBarsForLayout = (index: number) => {
      const thisIsLine = items[index]?.statId === expandedFirstId;
      const neighborIdx = index % 2 === 0 ? index + 1 : index - 1;
      const neighborIsLine = neighborIdx >= 0 && neighborIdx < items.length && items[neighborIdx]?.statId === expandedFirstId;
      return !thisIsLine && neighborIsLine;
    };

    return items
      .map((item, index) => {
        const entryByKind = statDataById.get(item.statId);
        const entry = entryByKind?.[selectedKind];
        if (!entry) return null;
        const series = seriesByStatIdByKind.get(item.statId)?.get(selectedKind) ?? [];
        const isLine = item.statId === expandedFirstId;

        const dataEntries = Object.entries(entry.data || {}).filter(
          (pair): pair is [string, number] => typeof pair[1] === "number" && Number.isFinite(pair[1]),
        );
        const pairs = dataEntries.map(([code, value]) => ({ code, value }));
        const cityAverage = pairs.length ? pairs.reduce((sum, pair) => sum + pair.value, 0) / pairs.length : 0;
        const selectedSet = new Set(selectedAreas.map((area) => area.code));
        const maxAreas = shouldExpandBarsForLayout(index) ? 6 : 3;

        const selectedEntries = selectedAreas
          .map((area) => {
            const v = entry.data?.[area.code];
            return typeof v === "number" ? { ...area, value: v } : null;
          })
          .filter((value): value is { code: string; label: string; value: number } => value !== null)
          .sort((a, b) => b.value - a.value)
          .slice(0, maxAreas);

        const remainingSlots = Math.max(0, maxAreas - selectedEntries.length);
        const topNonSelected = pairs
          .filter((pair) => !selectedSet.has(pair.code))
          .sort((a, b) => b.value - a.value)
          .slice(0, remainingSlots)
          .map(({ code, value }) => ({
            code,
            label: areaNameLookup(selectedKind, code) || code,
            value,
            selected: false,
          }));

        const baselineEntry = { label: baselineLabel, value: cityAverage };
        const selectedBars = selectedEntries.map(({ code, label, value }) => ({
          code,
          label,
          value,
          selected: true,
        }));
        const bars = [baselineEntry, ...topNonSelected, ...selectedBars].sort(
          (a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label)),
        );

        return {
          item,
          series,
          isLine,
          bars,
        };
      })
      .filter(Boolean) as { item: HighlightItem; series: SeriesEntry[]; isLine: boolean; bars: { code?: string; label: string; value: number; selected?: boolean }[] }[];
  }, [
    areaNameLookup,
    baselineLabel,
    expandedFirstId,
    items,
    selectedAreas,
    selectedKind,
    statDataById,
    seriesByStatIdByKind,
  ]);

  return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Highlights</h3>
      <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
        Sorted by highest value for selected {selectedKind === "COUNTY" ? "counties" : "ZIPs"} compared to {baselineLabel}
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {cards.length === 0 ? (
          <p className="px-1 py-2 text-sm text-slate-500 dark:text-slate-400">No highlights available.</p>
        ) : (
          cards.map(({ item, isLine, series, bars }) => (
            <div key={item.statId} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-2 flex items-baseline justify-between">
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{item.name}</h4>
                <span className="text-[11px] text-slate-400">{item.type}</span>
              </div>
              <div className="mt-2">
                {isLine ? (
                  <LineMiniChart series={series} baselineLabel={baselineLabel} selectedAreas={selectedAreas} valueType={item.type} />
                ) : (
                  <BarsMiniChart bars={bars} type={item.type} selectedAreas={selectedAreas} baselineLabel={baselineLabel} />
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

const BarsMiniChart = ({
  bars,
  type,
  selectedAreas,
  baselineLabel,
}: {
  bars: { code?: string; label: string; value: number; selected?: boolean }[];
  type: string;
  selectedAreas: { code: string; label: string }[];
  baselineLabel: string;
}) => {
  const colorByCode = new Map<string, string>();
  const usedColors = new Set<string>();
  for (const { code } of selectedAreas) {
    if (colorByCode.has(code)) continue;
    const next = HIGHLIGHT_COLORS[colorByCode.size % HIGHLIGHT_COLORS.length];
    colorByCode.set(code, next);
    usedColors.add(next);
  }

  const maxValue = Math.max(...bars.map((bar) => bar.value), 1);
  return (
    <div>
      {bars.map((bar, idx) => {
        const isBaseline = bar.label === baselineLabel;
        const color = isBaseline
          ? "#94a3b8"
          : bar.selected
          ? (colorByCode.get(bar.code ?? "") || HIGHLIGHT_COLORS[idx % HIGHLIGHT_COLORS.length]) + "CC"
          : "#94a3b8A0";
        const width = Math.max(0, Math.round((bar.value / maxValue) * 100));
        return (
          <div key={`${bar.label}-${idx}`} className="mb-1.5 flex items-center gap-2">
            <span className="w-24 shrink-0 truncate text-[11px] text-slate-500 dark:text-slate-400">{bar.label}</span>
            <div className="relative h-3 flex-1 rounded bg-slate-100 dark:bg-slate-800">
              <div className="h-3 rounded" style={{ width: `${width}%`, background: color }} />
            </div>
            <span className="ml-2 w-16 shrink-0 text-right text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
              {formatValueByType(bar.value, type)}
            </span>
          </div>
        );
      })}
    </div>
  );
};

const LineMiniChart = ({
  series,
  baselineLabel,
  selectedAreas,
  valueType,
}: {
  series: SeriesEntry[];
  baselineLabel: string;
  selectedAreas: { code: string; label: string }[];
  valueType: string;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!series || series.length === 0) {
      el.innerHTML = "<div class='text-xs text-slate-400 dark:text-slate-500'>No time series data.</div>";
      return;
    }

    const width = Math.max(320, Math.floor(el.clientWidth || 320));
    const height = 140;
    const margin = { top: 6, right: 8, bottom: 22, left: 0 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const dates = series.map((entry) => entry.date);
    const x = (i: number) => (dates.length <= 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW);

    const allValues: number[] = [];
    const baselinePoints = series.map((entry) => {
      const vals = Object.values(entry.data || {}) as number[];
      const numbers = vals.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      const avg = numbers.length ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : 0;
      allValues.push(avg);
      return avg;
    });
    selectedAreas.forEach(({ code }) =>
      series.forEach((entry) => {
        const value = entry.data?.[code];
        if (typeof value === "number") allValues.push(value);
      }),
    );
    const minValue = Math.min(...allValues);
    const maxValue = Math.max(...allValues);
    const range = Math.max(1e-9, maxValue - minValue);
    const y = (value: number) => innerH - ((value - minValue) / range) * innerH;

    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    const g = document.createElementNS(ns, "g");
    g.setAttribute("transform", `translate(${margin.left},${margin.top})`);
    svg.appendChild(g);

    // grid
    const gridLines = 3;
    for (let i = 0; i <= gridLines; i++) {
      const t = i / gridLines;
      const value = minValue + (maxValue - minValue) * t;
      const yPos = y(value);
      const line = document.createElementNS(ns, "line");
      line.setAttribute("x1", "0");
      line.setAttribute("x2", String(innerW));
      line.setAttribute("y1", String(yPos));
      line.setAttribute("y2", String(yPos));
      line.setAttribute("stroke", "#cbd5e1");
      line.setAttribute("stroke-width", "1");
      line.setAttribute("opacity", "0.25");
      g.appendChild(line);
    }

    // baseline
    const baselinePath = document.createElementNS(ns, "path");
    const baselineCoords = baselinePoints.map((value, idx) => ({ x: x(idx), y: y(value) }));
    baselinePath.setAttribute("d", buildSmoothPath(baselineCoords, 0.2));
    baselinePath.setAttribute("fill", "none");
    baselinePath.setAttribute("stroke", "#94a3b8");
    baselinePath.setAttribute("stroke-width", "2.2");
    baselinePath.setAttribute("stroke-dasharray", "4 3");
    g.appendChild(baselinePath);

    // selected lines
    const colorByCode = new Map<string, string>();
    selectedAreas.forEach((area, idx) => {
      colorByCode.set(area.code, HIGHLIGHT_COLORS[idx % HIGHLIGHT_COLORS.length]);
    });

    const lineGroups = selectedAreas.map((area) => {
      const vals = series.map((entry) =>
        typeof entry.data?.[area.code] === "number" ? (entry.data?.[area.code] as number) : 0,
      );
      const pts = vals.map((value, idx) => ({ x: x(idx), y: y(value), value }));
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", buildSmoothPath(pts, 0.2));
      path.setAttribute("fill", "none");
      const color = (colorByCode.get(area.code) || "#375bff") + "CC";
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", "1.9");
      g.appendChild(path);
      return { code: area.code, label: area.label, color, path, points: pts };
    });

    if (dates.length > 0) {
      const first = document.createElementNS(ns, "text");
      first.setAttribute("x", "0");
      first.setAttribute("y", String(innerH + 14));
      first.setAttribute("fill", "#94a3b8");
      first.setAttribute("font-size", "10");
      first.textContent = dates[0];
      g.appendChild(first);

      const last = document.createElementNS(ns, "text");
      last.setAttribute("x", String(innerW));
      last.setAttribute("y", String(innerH + 14));
      last.setAttribute("text-anchor", "end");
      last.setAttribute("fill", "#94a3b8");
      last.setAttribute("font-size", "10");
      last.textContent = dates[dates.length - 1];
      g.appendChild(last);
    }

    el.innerHTML = "";
    el.appendChild(svg);

    const guide = document.createElementNS(ns, "line");
    guide.setAttribute("x1", "0");
    guide.setAttribute("x2", "0");
    guide.setAttribute("y1", "0");
    guide.setAttribute("y2", String(innerH));
    guide.setAttribute("stroke", "#94a3b8");
    guide.setAttribute("stroke-width", "1");
    guide.setAttribute("opacity", "0");
    g.appendChild(guide);

    const markerByCode = new Map<string, SVGCircleElement>();
    for (const group of lineGroups) {
      const marker = document.createElementNS(ns, "circle");
      marker.setAttribute("r", "3");
      marker.setAttribute("fill", group.color);
      marker.setAttribute("opacity", "0");
      g.appendChild(marker);
      markerByCode.set(group.code, marker);
    }

    const overlay = document.createElementNS(ns, "rect");
    overlay.setAttribute("x", "0");
    overlay.setAttribute("y", "0");
    overlay.setAttribute("width", String(innerW));
    overlay.setAttribute("height", String(innerH));
    overlay.setAttribute("fill", "transparent");
    g.appendChild(overlay);

    const tooltip = document.createElement("div");
    tooltip.style.position = "absolute";
    tooltip.style.pointerEvents = "none";
    tooltip.style.background = "rgba(255,255,255,0.95)";
    tooltip.style.border = "1px solid #e2e8f0";
    tooltip.style.borderRadius = "8px";
    tooltip.style.boxShadow = "0 4px 10px rgba(0,0,0,0.08)";
    tooltip.style.padding = "6px 8px";
    tooltip.style.fontSize = "11px";
    tooltip.style.color = "#0f172a";
    tooltip.style.opacity = "0";
    el.appendChild(tooltip);

    const showAtIndex = (index: number, clientX: number, clientY: number) => {
      if (index < 0 || index >= dates.length) return;
      const gx = x(index);
      guide.setAttribute("x1", String(gx));
      guide.setAttribute("x2", String(gx));
      guide.setAttribute("opacity", "0.8");

      const rows: { label: string; color: string; value: number; y: number }[] = [];
      for (const group of lineGroups) {
        const point = group.points[index];
        if (!point) continue;
        const marker = markerByCode.get(group.code);
        if (marker) {
          marker.setAttribute("cx", String(gx));
          marker.setAttribute("cy", String(point.y));
          marker.setAttribute("opacity", "1");
        }
        rows.push({ label: group.label, color: group.color, value: point.value, y: point.y });
      }

      const baselineValue = baselinePoints[index];
      rows.push({ label: baselineLabel, color: "#94a3b8", value: baselineValue, y: y(baselineValue) });
      rows.sort((a, b) => b.value - a.value);

      tooltip.innerHTML = rows
        .map(
          (row) =>
            `<div style="display:flex;align-items:center;gap:6px;white-space:nowrap">
              <span style="display:inline-block;width:10px;height:2px;background:${row.color};"></span>
              <span>${row.label}</span>
              <span style="margin-left:6px;color:#64748b">${formatValueByType(row.value, valueType)}</span>
            </div>`,
        )
        .join("");
      tooltip.style.opacity = "1";

      const rect = el.getBoundingClientRect();
      const tx = Math.min(rect.width - 160, Math.max(8, clientX - rect.left + 12));
      const ty = Math.min(rect.height - 60, Math.max(8, clientY - rect.top - 24));
      tooltip.style.left = `${tx}px`;
      tooltip.style.top = `${ty}px`;
    };

    const handleMove = (event: MouseEvent) => {
      const rect = svg.getBoundingClientRect();
      const px = event.clientX - rect.left - margin.left;
      const t = Math.max(0, Math.min(innerW, px));
      const fraction = innerW <= 0 || dates.length <= 1 ? 0 : t / innerW;
      const index = Math.round(fraction * (dates.length - 1));
      showAtIndex(index, event.clientX, event.clientY);
    };

    const handleLeave = () => {
      guide.setAttribute("opacity", "0");
      tooltip.style.opacity = "0";
      for (const marker of markerByCode.values()) marker.setAttribute("opacity", "0");
    };

    overlay.addEventListener("mousemove", handleMove);
    overlay.addEventListener("mouseleave", handleLeave);

    return () => {
      overlay.removeEventListener("mousemove", handleMove);
      overlay.removeEventListener("mouseleave", handleLeave);
    };
  }, [baselineLabel, selectedAreas, series, valueType]);

  return <div ref={containerRef} className="relative w-full" />;
};

function buildSmoothPath(points: { x: number; y: number }[], tension = 0.2): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  const path: string[] = [`M${points[0].x},${points[0].y}`];
  for (let i = 0; i < points.length - 1; i += 1) {
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
}
