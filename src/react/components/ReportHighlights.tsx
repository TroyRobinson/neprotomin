import { useEffect, useMemo, useRef } from "react";

import type { AreaId } from "../../types/areas";
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
  supplementalAreas?: AreaId[];
  areaNameLookup: (kind: SupportedAreaKind, code: string) => string;
  statDataById: Map<string, Partial<Record<SupportedAreaKind, StatBoundaryEntry>>>;
  seriesByStatIdByKind: Map<string, SeriesByKind>;
}

const HIGHLIGHT_COLORS = ["#375bff", "#8f20f8", "#cf873f", "#ff7f00"];

type AreaEntry = {
  kind: SupportedAreaKind;
  code: string;
  label: string;
  isPrimary: boolean;
};

type AreaMetric = AreaEntry & { value: number };

const formatValueByType = (value: number, type: string): string => {
  if (!Number.isFinite(value)) return "—";
  if (type === "percent") return `${Math.round(value)}%`;
  if (type === "years") return `${value.toFixed(1)}`;
  return new Intl.NumberFormat().format(Math.round(value));
};

const buildAreaEntries = (
  selectedKind: SupportedAreaKind | null,
  selectedCodes: string[],
  supplementalAreas: AreaId[] | undefined,
  areaNameLookup: (kind: SupportedAreaKind, code: string) => string,
): { primary: AreaEntry[]; extras: AreaEntry[] } => {
  const primary: AreaEntry[] = [];
  const seen = new Set<string>();
  if (selectedKind) {
    for (const code of selectedCodes) {
      const key = `${selectedKind}:${code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      primary.push({
        kind: selectedKind,
        code,
        label: areaNameLookup(selectedKind, code) || code,
        isPrimary: true,
      });
    }
  }
  const extras: AreaEntry[] = [];
  for (const area of supplementalAreas ?? []) {
    if (area.kind !== "ZIP" && area.kind !== "COUNTY") continue;
    const key = `${area.kind}:${area.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    extras.push({
      kind: area.kind,
      code: area.id,
      label: areaNameLookup(area.kind, area.id) || area.id,
      isPrimary: false,
    });
  }
  return { primary, extras };
};

export const ReportHighlights = ({
  items,
  selectedKind,
  selectedCodes,
  supplementalAreas,
  areaNameLookup,
  statDataById,
  seriesByStatIdByKind,
}: ReportHighlightsProps) => {
  const { primary, extras } = useMemo(
    () => buildAreaEntries(selectedKind, selectedCodes, supplementalAreas, areaNameLookup),
    [areaNameLookup, selectedCodes, selectedKind, supplementalAreas],
  );

  const baselineLabel = selectedKind === "COUNTY" ? "StateAvg" : "CityAvg";
  const expandedFirstId = items[0]?.statId ?? null;

  const cards = useMemo(() => {
    if (!selectedKind || primary.length === 0) return [];
    const shouldExpandBarsForLayout = (index: number) => {
      const thisIsLine = items[index]?.statId === expandedFirstId;
      const neighborIdx = index % 2 === 0 ? index + 1 : index - 1;
      const neighborIsLine =
        neighborIdx >= 0 && neighborIdx < items.length && items[neighborIdx]?.statId === expandedFirstId;
      return !thisIsLine && neighborIsLine;
    };

    return items
      .map((item, index) => {
        const entryByKind = statDataById.get(item.statId);
        const primaryEntry = entryByKind?.[selectedKind];
        if (!primaryEntry) return null;

        const seriesByKind = seriesByStatIdByKind.get(item.statId) ?? new Map<SupportedAreaKind, SeriesEntry[]>();
        const maxAreas = shouldExpandBarsForLayout(index) ? 6 : 3;

        const chosenAreas: AreaEntry[] = [];
        const seenPrimary = new Set<string>();
        const pushArea = (area: AreaEntry) => {
          if (chosenAreas.length >= maxAreas) return;
          if (area.kind === selectedKind) {
            if (seenPrimary.has(area.code)) return;
            seenPrimary.add(area.code);
          }
          chosenAreas.push(area);
        };

        primary.forEach(pushArea);
        extras.forEach(pushArea);

        if (chosenAreas.length < maxAreas && primaryEntry) {
          const fallbackPairs = Object.entries(primaryEntry.data || {})
            .filter((pair): pair is [string, number] => typeof pair[1] === "number" && Number.isFinite(pair[1]))
            .sort((a, b) => b[1] - a[1]);
          for (const [code] of fallbackPairs) {
            if (chosenAreas.length >= maxAreas) break;
            if (seenPrimary.has(code)) continue;
            pushArea({ kind: selectedKind, code, label: areaNameLookup(selectedKind, code) || code, isPrimary: false });
          }
        }

        if (chosenAreas.length === 0) return null;

        const dataEntries = Object.entries(primaryEntry.data || {}).filter(
          (pair): pair is [string, number] => typeof pair[1] === "number" && Number.isFinite(pair[1]),
        );
        const pairs = dataEntries.map(([code, value]) => ({ code, value }));
        const averagePrimary = pairs.length ? pairs.reduce((sum, pair) => sum + pair.value, 0) / pairs.length : 0;

        const areaMetrics: AreaMetric[] = [];
        for (const area of chosenAreas) {
          const entryForKind = entryByKind?.[area.kind];
          if (!entryForKind) continue;
          const raw = entryForKind.data?.[area.code];
          if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
          areaMetrics.push({ ...area, value: raw });
        }
        if (areaMetrics.length === 0) return null;

        const bars = [
          { label: baselineLabel, value: averagePrimary },
          ...areaMetrics.map((area) => ({
            code: area.code,
            kind: area.kind,
            label: area.label,
            value: area.value,
            selected: area.isPrimary,
          })),
        ].sort((a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label)));

        return {
          item,
          seriesByKind,
          areaMetrics,
          baseline: averagePrimary,
          isLine: item.statId === expandedFirstId,
          bars,
        };
      })
      .filter(Boolean) as Array<{
        item: HighlightItem;
        seriesByKind: Map<SupportedAreaKind, SeriesEntry[]>;
        areaMetrics: AreaMetric[];
        baseline: number;
        isLine: boolean;
        bars: { label: string; value: number; selected?: boolean; kind?: SupportedAreaKind; code?: string }[];
      }>;
  }, [baselineLabel, expandedFirstId, extras, items, primary, selectedKind, seriesByStatIdByKind, statDataById]);

  return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Highlights</h3>
      <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">
        Sorted by highest value for selected {selectedKind === "COUNTY" ? "counties" : "ZIPs"} compared to {baselineLabel}. Additional pinned areas appear in grey when space allows.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {cards.length === 0 ? (
          <p className="px-1 py-2 text-sm text-slate-500 dark:text-slate-400">No highlights available.</p>
        ) : (
          cards.map(({ item, isLine, bars, areaMetrics, seriesByKind }) => (
            <div key={item.statId} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="mb-2 flex items-baseline justify-between">
                <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{item.name}</h4>
                <span className="text-[11px] text-slate-400">{item.type}</span>
              </div>
              <div className="mt-2">
                {isLine ? (
                  <LineMiniChart
                    primaryKind={selectedKind}
                    areaMetrics={areaMetrics}
                    seriesByKind={seriesByKind}
                    baselineLabel={baselineLabel}
                    valueType={item.type}
                  />
                ) : (
                  <BarsMiniChart bars={bars} type={item.type} baselineLabel={baselineLabel} />
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
  baselineLabel,
}: {
  bars: { label: string; value: number; selected?: boolean }[];
  type: string;
  baselineLabel: string;
}) => {
  const maxValue = Math.max(...bars.map((bar) => bar.value), 1);
  return (
    <div>
      {bars.map((bar, idx) => {
        const isBaseline = bar.label === baselineLabel;
        const color = isBaseline
          ? "#94a3b8"
          : bar.selected
          ? `${HIGHLIGHT_COLORS[idx % HIGHLIGHT_COLORS.length]}CC`
          : "#94a3b880";
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
  primaryKind,
  areaMetrics,
  seriesByKind,
  baselineLabel,
  valueType,
}: {
  primaryKind: SupportedAreaKind | null;
  areaMetrics: AreaMetric[];
  seriesByKind: Map<SupportedAreaKind, SeriesEntry[]>;
  baselineLabel: string;
  valueType: string;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const baselineSeries = primaryKind ? seriesByKind.get(primaryKind) ?? [] : [];
    if (!primaryKind || baselineSeries.length === 0) {
      el.innerHTML = "<div class='text-xs text-slate-400 dark:text-slate-500'>No time series data.</div>";
      return;
    }

    const measuredWidth = Math.floor(el.clientWidth || 0);
    const width = measuredWidth > 0 ? measuredWidth : 320;
    const height = 140;
    const margin = { top: 6, right: 8, bottom: 22, left: 0 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const dates = baselineSeries.map((entry) => entry.date);
    const x = (i: number) => (dates.length <= 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW);

    const allValues: number[] = [];
    const baselinePoints = baselineSeries.map((entry) => {
      const nums = Object.values(entry.data || {}).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
      const avg = nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : 0;
      allValues.push(avg);
      return avg;
    });

    areaMetrics.forEach((area) => {
      const areaSeries = seriesByKind.get(area.kind) ?? [];
      areaSeries.forEach((entry) => {
        const value = entry.data?.[area.code];
        if (typeof value === "number" && Number.isFinite(value)) allValues.push(value);
      });
    });

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

    const gridLines = 3;
    for (let i = 0; i <= gridLines; i++) {
      const frac = i / gridLines;
      const value = minValue + (maxValue - minValue) * frac;
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

    const baselinePath = document.createElementNS(ns, "path");
    const baselineCoords = baselinePoints.map((value, idx) => ({ x: x(idx), y: y(value) }));
    baselinePath.setAttribute("d", buildSmoothPath(baselineCoords, 0.2));
    baselinePath.setAttribute("fill", "none");
    baselinePath.setAttribute("stroke", "#94a3b8");
    baselinePath.setAttribute("stroke-width", "2.2");
    baselinePath.setAttribute("stroke-dasharray", "4 3");
    g.appendChild(baselinePath);

    const colorForIndex = (area: AreaMetric, idx: number) =>
      area.isPrimary ? `${HIGHLIGHT_COLORS[idx % HIGHLIGHT_COLORS.length]}CC` : "#94a3b880";

    const lineGroups = areaMetrics.map((area, idx) => {
      const areaSeries = seriesByKind.get(area.kind) ?? [];
      const vals = areaSeries.map((entry) => {
        const raw = entry.data?.[area.code];
        return typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
      });
      const pts = vals.map((value, i) => ({ x: x(i), y: y(value), value }));
      const path = document.createElementNS(ns, "path");
      path.setAttribute("d", buildSmoothPath(pts, 0.2));
      path.setAttribute("fill", "none");
      const color = colorForIndex(area, idx);
      path.setAttribute("stroke", color);
      path.setAttribute("stroke-width", "1.9");
      g.appendChild(path);
      return { key: `${area.kind}:${area.code}`, label: area.label, color, points: pts };
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

    const markerByKey = new Map<string, SVGCircleElement>();
    for (const group of lineGroups) {
      const marker = document.createElementNS(ns, "circle");
      marker.setAttribute("r", "3");
      marker.setAttribute("fill", group.color);
      marker.setAttribute("opacity", "0");
      g.appendChild(marker);
      markerByKey.set(group.key, marker);
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
        const marker = markerByKey.get(group.key);
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
      const idx = Math.round(fraction * (dates.length - 1));
      showAtIndex(idx, event.clientX, event.clientY);
    };

    const handleLeave = () => {
      guide.setAttribute("opacity", "0");
      tooltip.style.opacity = "0";
      for (const marker of markerByKey.values()) marker.setAttribute("opacity", "0");
    };

    overlay.addEventListener("mousemove", handleMove);
    overlay.addEventListener("mouseleave", handleLeave);

    return () => {
      overlay.removeEventListener("mousemove", handleMove);
      overlay.removeEventListener("mouseleave", handleLeave);
    };
  }, [areaMetrics, baselineLabel, primaryKind, seriesByKind, valueType]);

  return <div ref={containerRef} className="relative w-full" />;
};

function buildSmoothPath(points: { x: number; y: number }[], tension = 0.2): string {
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
}
