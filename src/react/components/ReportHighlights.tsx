import { useMemo, useRef, useEffect } from "react";

type SeriesEntry = { date: string; type: string; data: Record<string, number> };

interface HighlightItem {
  statId: string;
  name: string;
  type: string;
}

interface ReportHighlightsProps {
  items: HighlightItem[];
  selectedZips: string[];
  statDataById: Map<string, { type: string; data: Record<string, number> }>;
  seriesByStatId: Map<string, SeriesEntry[]>;
}

const HIGHLIGHT_COLORS = ["#375bff", "#8f20f8", "#cf873f", "#ff7f00"];

export const ReportHighlights = ({ items, selectedZips, statDataById, seriesByStatId }: ReportHighlightsProps) => {
  const expandedFirstId = items[0]?.statId || null;

  const cards = useMemo(() => {
    const isLineCard = (id: string) => id === expandedFirstId;
    const shouldExpandBarsForLayout = (i: number) => {
      const thisIsLine = isLineCard(items[i].statId);
      const neighborIdx = i % 2 === 0 ? i + 1 : i - 1;
      const neighborIsLine = neighborIdx >= 0 && neighborIdx < items.length ? isLineCard(items[neighborIdx].statId) : false;
      return !thisIsLine && neighborIsLine;
    };

    return items.map((item, index) => {
      const entry = statDataById.get(item.statId);
      const series = seriesByStatId.get(item.statId) || [];
      const isLine = isLineCard(item.statId);

      // Compute bars
      let bars: { label: string; value: number; selected?: boolean }[] = [];
      if (entry) {
        const pairs: { zip: string; value: number }[] = [];
        for (const [zip, v] of Object.entries(entry.data || {})) {
          if (typeof v === "number" && Number.isFinite(v)) pairs.push({ zip, value: v });
        }
        const cityAvg = pairs.length ? pairs.reduce((a, b) => a + b.value, 0) / pairs.length : 0;
        const maxAreas = shouldExpandBarsForLayout(index) ? 6 : 3; // non-city bars to display
        const pairsByZip = new Map(pairs.map((p) => [p.zip, p.value] as const));
        const selectedIncluded: { zip: string; value: number }[] = [];
        for (const z of selectedZips) {
          const v = pairsByZip.get(z);
          if (typeof v === "number") selectedIncluded.push({ zip: z, value: v });
        }
        selectedIncluded.sort((a, b) => b.value - a.value);
        const selectedCapped = selectedIncluded.slice(0, maxAreas);
        const need = Math.max(0, maxAreas - selectedCapped.length);
        const selectedSet = new Set(selectedCapped.map((s) => s.zip));
        pairs.sort((a, b) => b.value - a.value);
        const nonSelectedTop: { zip: string; value: number }[] = [];
        for (const p of pairs) {
          if (nonSelectedTop.length >= need) break;
          if (!selectedSet.has(p.zip)) nonSelectedTop.push(p);
        }
        const base = [{ label: "CityAvg", value: cityAvg }].concat(nonSelectedTop.map((p) => ({ label: p.zip, value: p.value })));
        base.sort((a, b) => b.value - a.value);
        const selectedBars = selectedCapped.map((p) => ({ label: p.zip, value: p.value, selected: true }));
        bars = base.concat(selectedBars).sort((a, b) => b.value - a.value || String(a.label).localeCompare(String(b.label)));
      }

      return { item, series, isLine, bars };
    });
  }, [items, selectedZips, statDataById, seriesByStatId, expandedFirstId]);

  return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Highlights</h3>
      <p className="mb-3 text-xs text-slate-400 dark:text-slate-500">Sorted by highest value for ZIP(s) compared to city</p>
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
                {isLine ? <LineMiniChart series={series} selectedZips={selectedZips} /> : <BarsMiniChart bars={bars} type={item.type} selectedZips={selectedZips} />}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

function formatValueByType(v: number, type: string): string {
  if (!Number.isFinite(v)) return "—";
  if (type === "percent") return `${Math.round(v)}%`;
  if (type === "years") return `${v.toFixed(1)}`;
  return new Intl.NumberFormat().format(Math.round(v));
}

const BarsMiniChart = ({ bars, type, selectedZips }: { bars: { label: string; value: number; selected?: boolean }[]; type: string; selectedZips: string[] }) => {
  const colorByZip = new Map<string, string>();
  const used = new Set<string>();
  for (const z of selectedZips) {
    if (!colorByZip.has(z)) {
      const next = HIGHLIGHT_COLORS[Array.from(used).length % HIGHLIGHT_COLORS.length];
      colorByZip.set(z, next);
      used.add(next);
    }
  }

  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <div>
      {bars.map((b, idx) => {
        const isCity = b.label === "CityAvg";
        const isSelected = !!b.selected;
        const barColor = isCity ? "#94a3b8" : isSelected ? (colorByZip.get(b.label) || "#375bff") + "80" : "#94a3b8A0";
        const widthPct = Math.max(0, Math.round((b.value / max) * 100));
        return (
          <div key={`${b.label}-${idx}`} className="mb-1.5 flex items-center gap-2">
            <span className="w-16 shrink-0 text-[11px] text-slate-500 dark:text-slate-400">{b.label}</span>
            <div className="relative h-3 flex-1 rounded bg-slate-100 dark:bg-slate-800">
              <div className="h-3 rounded" style={{ width: `${widthPct}%`, background: barColor }} />
            </div>
            <span className="ml-2 w-14 shrink-0 text-right text-[11px] tabular-nums text-slate-500 dark:text-slate-400">{formatValueByType(b.value, type)}</span>
          </div>
        );
      })}
    </div>
  );
};

const LineMiniChart = ({ series, selectedZips }: { series: SeriesEntry[]; selectedZips: string[] }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const width = Math.max(320, Math.floor(el.clientWidth || 320));
    const height = 140;
    const margin = { top: 6, right: 8, bottom: 22, left: 0 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;
    const dates = series.map((s) => s.date);
    const x = (i: number) => (dates.length <= 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW);

    const allVals: number[] = [];
    const cityPoints = series.map((e) => {
      const vals = Object.values(e.data || {}) as number[];
      const nums = vals.filter((v) => typeof v === "number");
      const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      allVals.push(avg);
      return avg;
    });
    const labels = selectedZips.slice();
    labels.forEach((zip) => series.forEach((e) => allVals.push((e.data?.[zip] as number) ?? 0)));
    const minV = Math.min(...allVals);
    const maxV = Math.max(...allVals);
    const range = Math.max(1e-9, maxV - minV);
    const padBottom = range * 0.05;
    const yMin = minV - padBottom;
    const yMax = maxV;
    const y = (v: number) => innerH - ((v - yMin) / Math.max(1e-9, (yMax - yMin))) * innerH;

    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    const g = document.createElementNS(ns, "g");
    g.setAttribute("transform", `translate(${margin.left},${margin.top})`);
    svg.appendChild(g);

    // gridlines
    const ticks = 3;
    for (let i = 0; i <= ticks; i++) {
      const t = i / ticks;
      const v = minV + (maxV - minV) * t;
      const yPos = y(v);
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

    // city line (dashed)
    const cityPath = document.createElementNS(ns, "path");
    const cityPts = cityPoints.map((v, i) => ({ x: x(i), y: y(v) }));
    cityPath.setAttribute("d", buildSmoothPath(cityPts, 0.2));
    cityPath.setAttribute("fill", "none");
    cityPath.setAttribute("stroke", "#94a3b8");
    cityPath.setAttribute("stroke-width", "2.2");
    cityPath.setAttribute("stroke-dasharray", "4 3");
    g.appendChild(cityPath);

    // selected lines
    const colorByZip = new Map<string, string>();
    const used = new Set<string>();
    selectedZips.forEach((zip) => {
      if (colorByZip.has(zip)) return;
      const next = HIGHLIGHT_COLORS[Array.from(used).length % HIGHLIGHT_COLORS.length];
      colorByZip.set(zip, next);
      used.add(next);
    });
    const lineGroups: { zip: string; color: string; path: SVGPathElement; points: { x: number; y: number; v: number }[] }[] = [];
    selectedZips.forEach((zip) => {
      const path = document.createElementNS(ns, "path");
      const vals = series.map((e) => (typeof e.data[zip] === "number" ? (e.data[zip] as number) : 0));
      const pts = vals.map((v, i) => ({ x: x(i), y: y(v), v }));
      path.setAttribute("d", buildSmoothPath(pts, 0.2));
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", (colorByZip.get(zip) || "#375bff") + "CC");
      path.setAttribute("stroke-width", "1.9");
      g.appendChild(path);
      lineGroups.push({ zip, color: (colorByZip.get(zip) || "#375bff") + "CC", path, points: pts });
    });

    // x labels (first/last)
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

    // mount
    el.innerHTML = "";
    el.appendChild(svg);

    // Hover interaction: vertical guide + circles + tooltip
    const guide = document.createElementNS(ns, "line");
    guide.setAttribute("x1", "0");
    guide.setAttribute("x2", "0");
    guide.setAttribute("y1", "0");
    guide.setAttribute("y2", String(innerH));
    guide.setAttribute("stroke", "#94a3b8");
    guide.setAttribute("stroke-width", "1");
    guide.setAttribute("opacity", "0");
    g.appendChild(guide);

    const markerByZip = new Map<string, SVGCircleElement>();
    for (const lg of lineGroups) {
      const c = document.createElementNS(ns, "circle");
      c.setAttribute("r", "3");
      c.setAttribute("fill", lg.color);
      c.setAttribute("opacity", "0");
      g.appendChild(c);
      markerByZip.set(lg.zip, c);
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
    tooltip.style.border = "1px solid #e2e8f0"; // slate-200
    tooltip.style.borderRadius = "8px";
    tooltip.style.boxShadow = "0 4px 10px rgba(0,0,0,0.08)";
    tooltip.style.padding = "6px 8px";
    tooltip.style.fontSize = "11px";
    tooltip.style.color = "#0f172a"; // slate-900
    tooltip.style.opacity = "0";
    el.appendChild(tooltip);

    const showAtIndex = (i: number, clientX: number, clientY: number) => {
      if (i < 0 || i >= dates.length) return;
      const gx = x(i);
      guide.setAttribute("x1", String(gx));
      guide.setAttribute("x2", String(gx));
      guide.setAttribute("opacity", "0.8");

      const rows: { label: string; color: string; value: number; y: number }[] = [];
      for (const lg of lineGroups) {
        const p = lg.points[i];
        if (!p) continue;
        const circle = markerByZip.get(lg.zip)!;
        circle.setAttribute("cx", String(gx));
        circle.setAttribute("cy", String(p.y));
        circle.setAttribute("opacity", "1");
        rows.push({ label: lg.zip, color: lg.color, value: p.v, y: p.y });
      }
      // City avg point
      const cityVal = cityPoints[i];
      rows.push({ label: "CityAvg", color: "#94a3b8", value: cityVal, y: y(cityVal) });
      rows.sort((a, b) => b.value - a.value);

      // Tooltip content
      tooltip.innerHTML = rows
        .map(
          (r) =>
            `<div style="display:flex;align-items:center;gap:6px;white-space:nowrap"><span style="display:inline-block;width:10px;height:2px;background:${r.color};"></span><span>${r.label}</span><span style="margin-left:6px;color:#64748b">${r.value.toFixed(2)}</span></div>`
        )
        .join("");
      tooltip.style.opacity = "1";

      // Position tooltip near cursor but keep inside container
      const rect = el.getBoundingClientRect();
      const tx = Math.min(rect.width - 160, Math.max(8, clientX - rect.left + 12));
      const ty = Math.min(rect.height - 60, Math.max(8, clientY - rect.top - 24));
      tooltip.style.left = `${tx}px`;
      tooltip.style.top = `${ty}px`;
    };

    const handleMove = (evt: MouseEvent) => {
      const rect = svg.getBoundingClientRect();
      const px = evt.clientX - rect.left - margin.left;
      const t = Math.max(0, Math.min(innerW, px));
      const frac = innerW <= 0 || dates.length <= 1 ? 0 : t / innerW;
      const i = Math.round(frac * (dates.length - 1));
      showAtIndex(i, evt.clientX, evt.clientY);
    };
    const handleLeave = () => {
      guide.setAttribute("opacity", "0");
      tooltip.style.opacity = "0";
      for (const c of markerByZip.values()) c.setAttribute("opacity", "0");
    };
    overlay.addEventListener("mousemove", handleMove);
    overlay.addEventListener("mouseleave", handleLeave);

    return () => {
      overlay.removeEventListener("mousemove", handleMove);
      overlay.removeEventListener("mouseleave", handleLeave);
    };
  }, [series, selectedZips]);

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


