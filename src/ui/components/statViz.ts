import type { Stat } from "../../types/stat";

type SeriesEntry = {
  date: string;
  type: string;
  data: Record<string, number>;
};

export interface StatVizController {
  element: HTMLElement;
  setStatsMeta: (statsById: Map<string, Stat>) => void;
  setSeries: (byStatId: Map<string, SeriesEntry[]>) => void;
  setSelectedZips: (zips: string[]) => void;
  setSelectedStatId: (statId: string | null) => void;
  setHoveredZip: (zip: string | null) => void;
  setPinnedZips: (zips: string[]) => void;
}

// Line chart palette: brand blue, purple, orange, yellow
const LINE_COLORS = ["#375bff", "#8f20f8", "#a76d44", "#b4a360"];
const PINNED_BAR_COLOR = "#85a3ff"; // brand-300 (muted brand blue)
const getAvgColor = () => (document.documentElement.classList.contains("dark") ? "#b3b6bd" : "#64748b"); // city average line (dashed, brighter in dark mode)

export const createStatViz = (opts: { onHoverZip?: (zip: string | null) => void } = {}): StatVizController => {
  const container = document.createElement("div");
  container.className = "border-b border-slate-200 bg-white/70 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/70";

  const title = document.createElement("div");
  title.className = "mb-2 flex items-center justify-between cursor-pointer select-none";
  const label = document.createElement("h3");
  label.className = "text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
  label.textContent = "Trend";
  const sub = document.createElement("div");
  sub.className = "text-xs text-slate-400 dark:text-slate-500";
  title.appendChild(label);
  title.appendChild(sub);

  const graph = document.createElement("div");
  graph.className = "relative w-full";
  graph.style.overflow = "visible"; // allow value labels to extend right

  // Tiny popover for line hover labels
  const hoverTip = document.createElement("div");
  hoverTip.className =
    "absolute z-10 hidden rounded border border-black/10 bg-slate-800 px-1.5 py-0.5 text-[10px] text-white shadow-sm " +
    "dark:border-white/20 dark:bg-slate-200 dark:text-slate-900 pointer-events-none";
  const showHoverTip = (label: string, clientX: number, clientY: number) => {
    const rect = graph.getBoundingClientRect();
    hoverTip.textContent = label;
    const x = Math.max(4, Math.min(rect.width - 4, clientX - rect.left));
    const y = Math.max(4, Math.min(rect.height - 4, clientY - rect.top));
    hoverTip.style.left = `${x + 8}px`;
    hoverTip.style.top = `${y - 18}px`;
    hoverTip.classList.remove("hidden");
  };
  const hideHoverTip = () => {
    hoverTip.classList.add("hidden");
  };

  const empty = document.createElement("div");
  empty.className = "text-xs text-slate-400 dark:text-slate-500";
  empty.textContent = "No data";

  container.appendChild(title);
  container.appendChild(graph);

  // State
  let statsById: Map<string, Stat> = new Map();
  let seriesByStatId: Map<string, SeriesEntry[]> = new Map();
  let selectedZips: string[] = [];
  let selectedStatId: string | null = null;
  let hoveredZip: string | null = null;
  let collapsed = false;
  let pinnedZips: Set<string> = new Set();

  const getDefaultStatId = (): string | null => {
    for (const s of statsById.values()) {
      if (s.name.toLowerCase() === "population") return s.id;
    }
    return null;
  };

  const setStatsMeta = (map: Map<string, Stat>) => {
    statsById = map;
    render();
  };
  const setSeries = (byId: Map<string, SeriesEntry[]>) => {
    seriesByStatId = byId;
    render();
  };
  const setSelectedZips = (zips: string[]) => {
    selectedZips = zips.slice(0, 100);
    render();
  };
  const setSelectedStatId = (id: string | null) => {
    selectedStatId = id;
    render();
  };
  const setHoveredZip = (zip: string | null) => {
    hoveredZip = zip;
    // Only meaningful in bar mode; safe to re-render either way
    render();
  };
  const setPinnedZips = (zips: string[]) => {
    pinnedZips = new Set(zips);
    // Affects bar mode colors
    render();
  };

  const setCollapsed = (next: boolean) => {
    collapsed = next;
    graph.style.display = collapsed ? "none" : "block";
    // Always re-render so the subtitle switches between date range and value summary
    render();
  };

  // Toggle collapse on title click
  title.addEventListener("click", () => setCollapsed(!collapsed));

  const computeCityAvg = (entries: SeriesEntry[]): { date: string; value: number }[] => {
    return entries.map((e) => {
      const vals = Object.values(e.data || {});
      const nums = vals.filter((v) => typeof v === "number") as number[];
      const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      return { date: e.date, value: avg };
    });
  };

  // Compute a single summary value for collapsed view:
  // - if 1 zip selected: that zip's latest value
  // - if multiple zips selected: average of selected zips (latest)
  // - if no zips selected: city average (latest)
  const latestSummaryValue = (series: SeriesEntry[], selected: string[]): number | null => {
    if (!series.length) return null;
    const latest = series[series.length - 1];
    if (selected.length === 0) {
      const cityAvg = computeCityAvg(series);
      const v = cityAvg[cityAvg.length - 1]?.value;
      return typeof v === "number" ? v : null;
    }
    if (selected.length === 1) {
      const v = latest.data[selected[0]];
      return typeof v === "number" ? v : 0;
    }
    // multiple zips: average across selected zips
    const nums = selected.map((z) => (typeof latest.data[z] === "number" ? (latest.data[z] as number) : 0));
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
  };

  // Create a smooth cubic-bezier path via a Cardinal-like spline
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

  const buildLineChart = (
    series: { label: string; color: string; points: { date: string; value: number }[] }[],
  ): SVGSVGElement => {
    const width = Math.max(280, Math.floor(graph.clientWidth || 320));
    const height = 120;
    const margin = { top: 8, right: 8, bottom: 16, left: 48 };
    const innerW = width - margin.left - margin.right;
    const innerH = height - margin.top - margin.bottom;

    const dates = series.length > 0 ? series[0].points.map((p) => p.date) : [];
    const allVals: number[] = [];
    for (const s of series) for (const p of s.points) allVals.push(p.value);
    const maxVRaw = Math.max(0, ...allVals);
    const yMin = 0; // lock baseline at zero
    const yPad = maxVRaw * 0.08;
    const yMax = Math.max(1, maxVRaw + yPad);
    const y = (v: number) => innerH - ((v - yMin) / (yMax - yMin)) * innerH;
    const x = (i: number) => (dates.length <= 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));

    const g = document.createElementNS(svg.namespaceURI, "g");
    g.setAttribute("transform", "translate(" + margin.left + "," + margin.top + ")");
    svg.appendChild(g);
    svg.addEventListener("mouseleave", () => hideHoverTip());

    const isDark = document.documentElement.classList.contains("dark");
    const gridStroke = isDark ? "#334155" : "#cbd5e1"; // slate-700 vs slate-300
    const gridOpacity = "0.35"; // lower contrast in both modes
    const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

    // y grid + ticks
    const ticks = 3;
    for (let i = 0; i <= ticks; i++) {
      const t = i / ticks;
      const v = yMin + (yMax - yMin) * t;
      const yPos = y(v);
      const line = document.createElementNS(svg.namespaceURI, "line");
      line.setAttribute("x1", "0");
      line.setAttribute("x2", String(innerW));
      line.setAttribute("y1", String(yPos));
      line.setAttribute("y2", String(yPos));
      line.setAttribute("stroke", gridStroke);
      line.setAttribute("stroke-width", "1");
      line.setAttribute("opacity", gridOpacity);
      g.appendChild(line);

      const txt = document.createElementNS(svg.namespaceURI, "text");
      txt.setAttribute("x", "-6");
      txt.setAttribute("y", String(yPos));
      txt.setAttribute("text-anchor", "end");
      txt.setAttribute("dominant-baseline", "middle");
      txt.setAttribute("fill", "#94a3b8");
      txt.setAttribute("font-size", "10");
      txt.textContent = fmt(v);
      g.appendChild(txt);
    }

    // x labels
    dates.forEach((d, i) => {
      const txt = document.createElementNS(svg.namespaceURI, "text");
      txt.setAttribute("x", String(x(i)));
      txt.setAttribute("y", String(innerH + 12));
      txt.setAttribute("text-anchor", i === 0 ? "start" : i === dates.length - 1 ? "end" : "middle");
      txt.setAttribute("fill", "#94a3b8");
      txt.setAttribute("font-size", "10");
      txt.textContent = d;
      g.appendChild(txt);
    });

    // lines (smoothed)
    for (const s of series) {
      const path = document.createElementNS(svg.namespaceURI, "path") as SVGPathElement;
      const pts = s.points.map((p, i) => ({ x: x(i), y: y(p.value) }));
      const d = buildSmoothPath(pts, 0.2);
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", s.color);
      // Emphasize the city average line
      path.setAttribute("stroke-width", s.label === "CityAv" ? "2.5" : "2");
      path.setAttribute("stroke-dasharray", s.label === "CityAv" ? "4 3" : "0");
      // Hover label for this line
      path.style.cursor = "default";
      path.addEventListener("mouseenter", (ev) => {
        const e = ev as MouseEvent;
        showHoverTip(s.label, e.clientX, e.clientY);
      });
      path.addEventListener("mousemove", (ev) => {
        const e = ev as MouseEvent;
        showHoverTip(s.label, e.clientX, e.clientY);
      });
      path.addEventListener("mouseleave", () => hideHoverTip());
      g.appendChild(path);
    }

    return svg;
  };

  const buildBars = (entries: { label: string; color: string; value: number }[]): SVGSVGElement => {
    const width = Math.max(280, Math.floor(graph.clientWidth || 320));
    const barH = 16;
    const gap = 6;
    const left = 40;
    const right = 90; // extra space for value labels
    const top = 6;
    const height = top + entries.length * (barH + gap);
    const innerW = width - left - right;
    const max = Math.max(1, ...entries.map((e) => e.value));

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));

    entries.forEach((e, i) => {
      const yPos = top + i * (barH + gap);
      const w = (e.value / max) * innerW;

      const lbl = document.createElementNS(svg.namespaceURI, "text");
      lbl.setAttribute("x", String(left - 6));
      lbl.setAttribute("y", String(yPos + barH / 2));
      lbl.setAttribute("text-anchor", "end");
      lbl.setAttribute("dominant-baseline", "middle");
      lbl.setAttribute("fill", "#64748b");
      lbl.setAttribute("font-size", "10");
      lbl.textContent = e.label;
      svg.appendChild(lbl);

      const rect = document.createElementNS(svg.namespaceURI, "rect") as SVGRectElement;
      rect.setAttribute("x", String(left));
      rect.setAttribute("y", String(yPos));
      rect.setAttribute("width", String(Math.max(0, w)));
      rect.setAttribute("height", String(barH));
      // Slightly shade the hovered ZIP
      const isZip = e.label && e.label !== "CityAv";
      const isHovered = isZip && hoveredZip === e.label;
      rect.setAttribute("fill", isHovered ? shade(e.color, 0.15) : e.color);
      rect.setAttribute("rx", "3");
      rect.setAttribute("ry", "3");
      if (isZip) {
        rect.style.cursor = "pointer";
        rect.addEventListener("mouseenter", () => opts.onHoverZip?.(e.label));
        rect.addEventListener("mouseleave", () => opts.onHoverZip?.(null));
      }
      svg.appendChild(rect);

      const val = document.createElementNS(svg.namespaceURI, "text");
      val.setAttribute("x", String(left + Math.max(6, w + 4)));
      val.setAttribute("y", String(yPos + barH / 2));
      val.setAttribute("dominant-baseline", "middle");
      val.setAttribute("fill", "#94a3b8");
      val.setAttribute("font-size", "10");
      val.textContent = String(Math.round(e.value));
      svg.appendChild(val);
    });

    return svg;
  };

  const render = () => {
    const statId = selectedStatId || getDefaultStatId();
    const stat = statId ? statsById.get(statId) || null : null;
    const series = statId ? seriesByStatId.get(statId) || [] : [];

    // Always keep title up to date
    label.textContent = stat ? stat.name : "Trend";

    // Collapsed: show a single value summary in the subtitle and skip chart rendering
    if (collapsed) {
      const value = latestSummaryValue(series, selectedZips.slice(0, 50));
      sub.textContent = value == null ? "" : String(Math.round(value));
      graph.replaceChildren();
      return;
    }

    const dates = series.map((s) => s.date);
    sub.textContent = "";

    graph.replaceChildren();
    // Ensure tooltip is hidden between renders
    hideHoverTip();
    if (!stat || series.length === 0) {
      graph.appendChild(empty);
      graph.appendChild(hoverTip);
      return;
    }

    const cityAvg = computeCityAvg(series);
    const selected = selectedZips.slice(0, 50);

    if (selected.length >= 4) {
      const latest = series[series.length - 1];
      const BAR_COLOR = "#64748b"; // neutral
      const CITY_BAR_COLOR = "#94a3b8"; // slightly lighter for CityAv
      const entries = selected
        .map((zip) => ({
          label: zip,
          color: pinnedZips.has(zip) ? PINNED_BAR_COLOR : BAR_COLOR,
          value: latest.data[zip] ?? 0,
        }))
        .concat([{ label: "CityAv", color: CITY_BAR_COLOR, value: cityAvg[cityAvg.length - 1]?.value ?? 0 }])
        .sort((a, b) => b.value - a.value);
      // For bar mode, show only the latest year
      sub.textContent = latest?.date || "";
      const svg = buildBars(entries);
      graph.appendChild(svg);
      graph.appendChild(hoverTip);
    } else {
      const zipSeries = selected.map((zip, i) => ({
        label: zip,
        color: LINE_COLORS[i % LINE_COLORS.length],
        points: series.map((e) => ({ date: e.date, value: e.data[zip] ?? 0 })),
      }));
      const allSeries = zipSeries.concat([{ label: "CityAv", color: getAvgColor(), points: cityAvg }]);
      // For line mode, show full range
      if (dates.length > 0) sub.textContent = String(dates[0] + "-" + dates[dates.length - 1]);
      const svg = buildLineChart(allSeries);
      graph.appendChild(svg);
      graph.appendChild(hoverTip);
    }
  };


  // initial state
  setCollapsed(false);
  render();

  return { element: container, setStatsMeta, setSeries, setSelectedZips, setSelectedStatId, setHoveredZip, setPinnedZips };
};

// Utility to shade a color by a factor (0.15 -> lighten a bit)
function shade(hex: string, amount: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return hex;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  const adj = (c: number) => (amount >= 0 ? c + (255 - c) * amount : c + c * amount);
  return (
    "#" +
    clamp(adj(r)).toString(16).padStart(2, "0") +
    clamp(adj(g)).toString(16).padStart(2, "0") +
    clamp(adj(b)).toString(16).padStart(2, "0")
  );
}
