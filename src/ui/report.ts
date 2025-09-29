import type { Area } from "../types/area";
import type { Organization } from "../types/organization";
import type { Stat } from "../types/stat";
import { formatStatValue } from "../lib/format";

type StatDataMap = Map<string, { type: string; data: Record<string, number> }>;
type SeriesEntry = { date: string; type: string; data: Record<string, number> };
type StatSeriesMap = Map<string, SeriesEntry[]>;

const HIGHLIGHT_COLORS = ["#375bff", "#8f20f8", "#cf873f", "#ff7f00"];
// Match toolbar chip colors in line mode
const CHIP_LINE_COLORS = ["#375bff", "#8f20f8", "#a76d44", "#b4a360"];

export interface ReportController {
  element: HTMLElement;
  setAreasByKey: (areas: Map<string, Area>) => void;
  setSelectedZips: (zips: string[]) => void;
  setOrganizations: (orgs: Organization[], orgZipMap: Map<string, string | null>) => void;
  setStatsMeta: (stats: Map<string, Stat>) => void;
  setStatDataById: (byId: StatDataMap) => void;
  setStatSeriesById: (byId: StatSeriesMap) => void;
}

export const createReportView = (): ReportController => {
  const container = document.createElement("section");
  container.className = "relative flex-1 overflow-y-auto bg-white dark:bg-slate-900";

  const inner = document.createElement("div");
  inner.className = "mx-auto w-full max-w-6xl px-6 py-6";
  container.appendChild(inner);

  // Sections
  const header = document.createElement("div");
  header.className = "mb-4";
  const headerTop = document.createElement("div");
  headerTop.className = "flex items-end justify-between";
  const title = document.createElement("h2");
  title.className = "text-xl font-semibold text-slate-800 dark:text-slate-100";
  title.textContent = "Report";
  const sub = document.createElement("p");
  sub.className = "text-sm text-slate-500 dark:text-slate-400";
  sub.textContent = "Select one or more ZIPs to generate a report.";
  const zipList = document.createElement("p");
  zipList.className = "text-xs text-slate-400 dark:text-slate-500 mt-1";
  zipList.style.display = "none";
  headerTop.appendChild(title);
  headerTop.appendChild(sub);
  header.appendChild(headerTop);
  header.appendChild(zipList);

  const callouts = document.createElement("div");
  callouts.className = "grid grid-cols-1 gap-3 sm:grid-cols-3";

  const mkCallout = (label: string) => {
    const card = document.createElement("div");
    card.className = "rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40";
    const l = document.createElement("p");
    l.className = "text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400";
    l.textContent = label;
    const v = document.createElement("p");
    v.className = "mt-1 text-lg font-semibold text-slate-800 dark:text-white";
    card.appendChild(l);
    card.appendChild(v);
    return { card, valueEl: v };
  };

  const { card: popCard, valueEl: popValue } = mkCallout("Population");
  const { card: ageCard, valueEl: ageValue } = mkCallout("Average age");
  const { card: marriedCard, valueEl: marriedValue } = mkCallout("Married %");
  callouts.appendChild(popCard);
  callouts.appendChild(ageCard);
  callouts.appendChild(marriedCard);

  const rankingSection = document.createElement("div");
  rankingSection.className = "mt-6";
  const rankingTitle = document.createElement("h3");
  rankingTitle.className = "mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
  rankingTitle.textContent = "Top differences vs city";
  const rankingGrid = document.createElement("div");
  rankingGrid.className = "grid grid-cols-1 gap-3 sm:grid-cols-2";
  const rankingListLeft = document.createElement("ul");
  rankingListLeft.className = "divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800";
  const rankingListRight = document.createElement("ul");
  rankingListRight.className = "divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800";
  rankingGrid.appendChild(rankingListLeft);
  rankingGrid.appendChild(rankingListRight);
  rankingSection.appendChild(rankingTitle);
  rankingSection.appendChild(rankingGrid);

  // Highlights: four bar charts for the top four stats
  const highlightsSection = document.createElement("div");
  highlightsSection.className = "mt-6";
  const highlightsTitle = document.createElement("h3");
  highlightsTitle.className = "mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
  highlightsTitle.textContent = "Highlights";
  const highlightsSubtitle = document.createElement("p");
  highlightsSubtitle.className = "mb-3 text-xs text-slate-400 dark:text-slate-500";
  highlightsSubtitle.textContent = "Sorted by highest value for ZIP(s) compared to city";
  const highlightsGrid = document.createElement("div");
  highlightsGrid.className = "grid grid-cols-1 gap-4 md:grid-cols-2";
  highlightsSection.appendChild(highlightsTitle);
  highlightsSection.appendChild(highlightsSubtitle);
  highlightsSection.appendChild(highlightsGrid);

  const orgsSection = document.createElement("div");
  orgsSection.className = "mt-6";
  const orgsTitle = document.createElement("h3");
  orgsTitle.className = "mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
  orgsTitle.textContent = "Organizations in selection";
  const orgsList = document.createElement("ul");
  orgsList.className = "grid grid-cols-1 gap-2 sm:grid-cols-2";
  orgsSection.appendChild(orgsTitle);
  orgsSection.appendChild(orgsList);

  inner.appendChild(header);
  inner.appendChild(callouts);
  inner.appendChild(highlightsSection);
  inner.appendChild(rankingSection);
  inner.appendChild(orgsSection);

  // Reactive state
  let areasByKey: Map<string, Area> = new Map();
  let selectedZips: string[] = [];
  let organizations: Organization[] = [];
  let orgZipMap: Map<string, string | null> = new Map();
  let statsById: Map<string, Stat> = new Map();
  let statDataById: StatDataMap = new Map();
  let statSeriesById: StatSeriesMap = new Map();
  const highlightsExpanded = new Set<string>();
  // When selection is in line mode in the toolbar (<4), chips are colored in order
  let selectedZipColors: Map<string, string> = new Map();

  const updateHeader = () => {
    if (selectedZips.length > 0) {
      const label = selectedZips.length === 1 ? selectedZips[0] : `${selectedZips.length} ZIPs`;
      title.textContent = `Report · ${label}`;
      sub.textContent = "";
      
      // Show ZIP list when multiple ZIPs are selected
      if (selectedZips.length > 1) {
        zipList.textContent = selectedZips.join(", ");
        zipList.style.display = "block";
      } else {
        zipList.style.display = "none";
      }
    } else {
      title.textContent = "Report";
      sub.textContent = "Select one or more ZIPs to generate a report.";
      zipList.style.display = "none";
    }
  };

  const updateCallouts = () => {
    if (selectedZips.length === 0) {
      popValue.textContent = "—";
      ageValue.textContent = "—";
      marriedValue.textContent = "—";
      return;
    }
    let totalPop = 0;
    let weightedAge = 0;
    let weightedMarried = 0;
    let any = false;
    for (const zip of selectedZips) {
      const a = areasByKey.get(zip);
      if (!a) continue;
      any = true;
      const p = Math.max(0, Math.round(a.population));
      totalPop += p;
      weightedAge += a.avgAge * p;
      weightedMarried += a.marriedPercent * p;
    }
    if (!any || totalPop === 0) {
      popValue.textContent = "—";
      ageValue.textContent = "—";
      marriedValue.textContent = "—";
      return;
    }
    const avgAge = weightedAge / totalPop;
    const avgMarried = weightedMarried / totalPop;
    popValue.textContent = formatStatValue(totalPop, "count");
    ageValue.textContent = formatStatValue(avgAge, "years");
    marriedValue.textContent = formatStatValue(avgMarried, "percent");
  };

  // Compute ranking consistent with sidebar's "Most significant stats" logic:
  // - If one ZIP selected: score = normalized position within the stat's distribution
  // - If multiple ZIPs: score = normalized abs difference from city average
  // - Sort by score desc, then name, show top 6

  const updateRanking = () => {
    rankingListLeft.innerHTML = "";
    rankingListRight.innerHTML = "";
    if (selectedZips.length === 0 || statsById.size === 0 || statDataById.size === 0) {
      const empty = document.createElement("li");
      empty.className = "px-4 py-6 text-sm text-slate-500 dark:text-slate-400";
      empty.textContent = "No selection.";
      rankingListLeft.appendChild(empty);
      return;
    }

    type Row = { statId: string; name: string; type: string; selectedValue: number; cityValue: number; diff: number; score: number };
    const rows: Row[] = [];
    for (const [statId, entry] of statDataById) {
      // Distribution stats (latest snapshot): min, max, city average
      const distValues = Object.values(entry.data || {}).filter((x) => typeof x === "number" && Number.isFinite(x)) as number[];
      if (distValues.length === 0) continue;
      const min = Math.min(...distValues);
      const max = Math.max(...distValues);
      const range = Math.max(0, max - min);
      const cAvg = distValues.reduce((a, b) => a + b, 0) / distValues.length;

      // Selected value: single zip value or average across selected zips
      let selectedValue = 0;
      if (selectedZips.length === 1) {
        const z = selectedZips[0];
        selectedValue = typeof entry.data[z] === "number" ? (entry.data[z] as number) : 0;
      } else {
        const vals: number[] = [];
        for (const z of selectedZips) {
          const v = entry.data?.[z];
          if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
        }
        if (vals.length === 0) continue;
        selectedValue = vals.reduce((a, b) => a + b, 0) / vals.length;
      }

      // Score: normalized by range
      let score = 0;
      if (selectedZips.length === 1) {
        score = range > 0 ? (selectedValue - min) / range : 0;
      } else {
        const diff = Math.abs(selectedValue - cAvg);
        score = range > 0 ? diff / range : 0;
      }
      const s = statsById.get(statId);
      if (!s) continue;
      rows.push({ statId, name: s.name, type: entry.type, selectedValue, cityValue: cAvg, diff: selectedValue - cAvg, score });
    }
    rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    const top = rows.slice(0, 6);

    const buildItem = (r: Row) => {
      const li = document.createElement("li");
      li.className = "flex items-center justify-between bg-white px-4 py-3 dark:bg-slate-900";
      const left = document.createElement("div");
      left.className = "min-w-0";
      const name = document.createElement("p");
      name.className = "truncate text-sm font-medium text-slate-700 dark:text-slate-200";
      name.textContent = r.name;
      const sub = document.createElement("p");
      sub.className = "text-xs text-slate-500 dark:text-slate-400";
      sub.textContent = `City: ${formatStatValue(r.cityValue, r.type)}`;
      left.appendChild(name);
      left.appendChild(sub);
      const right = document.createElement("div");
      right.className = "text-right";
      const val = document.createElement("p");
      val.className = "text-sm font-semibold text-slate-800 dark:text-white";
      val.textContent = formatStatValue(r.selectedValue, r.type);
      const diff = document.createElement("p");
      const up = r.diff >= 0;
      const meta = statsById.get(r.statId);
      const goodIfUp = (meta && typeof (meta as any).goodIfUp === "boolean") ? (meta as any).goodIfUp as boolean : undefined;
      const isGood = goodIfUp === undefined ? up : (up ? goodIfUp : !goodIfUp);
      diff.className = isGood
        ? "text-xs font-medium text-emerald-600"
        : "text-xs font-medium text-rose-600";
      const sign = up ? "+" : "-";
      diff.textContent = `${sign}${formatStatValue(Math.abs(r.diff), r.type)} vs city`;
      right.appendChild(val);
      right.appendChild(diff);
      li.appendChild(left);
      li.appendChild(right);
      return li;
    };

    const leftItems = top.slice(0, 3);
    const rightItems = top.slice(3);

    for (const r of leftItems) rankingListLeft.appendChild(buildItem(r));
    for (const r of rightItems) rankingListRight.appendChild(buildItem(r));

    // Render highlights using the top four rows
    renderHighlights(rows.slice(0, 4));
  };

  const renderHighlights = (topFour: { statId: string; name: string; type: string }[]) => {
    highlightsGrid.innerHTML = "";
    if (topFour.length === 0) {
      const empty = document.createElement("p");
      empty.className = "px-1 py-2 text-sm text-slate-500 dark:text-slate-400";
      empty.textContent = "No highlights available.";
      highlightsGrid.appendChild(empty);
      return;
    }

    if (topFour.length > 0 && !highlightsExpanded.has(topFour[0].statId)) {
      highlightsExpanded.add(topFour[0].statId);
    }

    // Compute CityAvg per stat and a set of ZIPs for bar mode.
    // Default shows 4 total bars (CityAvg + 3 areas). If this card is a bar chart
    // and its neighbor in the 2-col grid is a line chart, expand bars to 7 total
    // to better balance vertical space next to the line chart.
    for (const item of topFour) {
      const entry = statDataById.get(item.statId);
      if (!entry) continue;
      const thisIndex = topFour.findIndex((x) => x.statId === item.statId);
      const neighborIndex = thisIndex % 2 === 0 ? thisIndex + 1 : thisIndex - 1;
      const thisExpanded = highlightsExpanded.has(item.statId);
      const neighborExpanded = neighborIndex >= 0 && neighborIndex < topFour.length
        ? highlightsExpanded.has(topFour[neighborIndex].statId)
        : false;
      const expandBarsForLayout = !thisExpanded && neighborExpanded;
      const maxAreas = expandBarsForLayout ? 6 : 3; // non-city bars to display
      const pairs: { zip: string; value: number }[] = [];
      for (const [zip, v] of Object.entries(entry.data || {})) {
        if (typeof v === "number" && Number.isFinite(v)) pairs.push({ zip, value: v });
      }
      if (pairs.length === 0) continue;
      // City average across all zips we have data for this stat
      const cityAvg = pairs.reduce((a, b) => a + b.value, 0) / pairs.length;

      // Ensure selected zips appear among the shown set, even if at the bottom
      const pairsByZip = new Map(pairs.map((p) => [p.zip, p.value] as const));
      const selectedIncluded: { zip: string; value: number }[] = [];
      for (const z of selectedZips) {
        const v = pairsByZip.get(z);
        if (typeof v === "number") selectedIncluded.push({ zip: z, value: v });
      }
      // Cap selected to at most maxAreas
      selectedIncluded.sort((a, b) => b.value - a.value);
      const selectedCapped = selectedIncluded.slice(0, maxAreas);
      // Fill remaining slots with top non-selected
      const need = Math.max(0, maxAreas - selectedCapped.length);
      const nonSelectedTop: { zip: string; value: number }[] = [];
      const selectedSet = new Set(selectedCapped.map((s) => s.zip));
      pairs.sort((a, b) => b.value - a.value);
      for (const p of pairs) {
        if (nonSelectedTop.length >= need) break;
        if (!selectedSet.has(p.zip)) nonSelectedTop.push(p);
      }
      // Order: CityAvg + non-selected top chunk sorted; selected appended at bottom
      const barsBase = [{ label: "CityAvg", value: cityAvg } as { label: string; value: number }]
        .concat(nonSelectedTop.map((p) => ({ label: p.zip, value: p.value })));
      barsBase.sort((a, b) => b.value - a.value);
      const selectedBars = selectedCapped.map((p) => ({ label: p.zip, value: p.value }));

      // Card container
      const card = document.createElement("div");
      card.className = "rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900";
      const title = document.createElement("div");
      title.className = "mb-2 flex items-baseline justify-between";
      const name = document.createElement("h4");
      name.className = "text-sm font-semibold text-slate-800 dark:text-slate-100";
      name.textContent = item.name;
      title.appendChild(name);

      const chart = document.createElement("div");
      chart.className = "mt-2";

      const renderBars = () => {
        chart.innerHTML = "";
        const combined = barsBase
          .concat(selectedBars.map((b) => ({ ...b, selected: true })) as any)
          // Ensure bars render from highest to lowest value
          .sort((a: any, b: any) => (b.value - a.value) || String(a.label).localeCompare(String(b.label)));
        const max = Math.max(...combined.map((b: any) => b.value), 1);
        for (const b of combined as ({ label: string; value: number; selected?: boolean })[]) {
          const row = document.createElement("div");
          // Slightly larger vertical spacing when expanded to 7 bars
          row.className = (expandBarsForLayout ? "mb-1.5" : "mb-1") + " flex items-center gap-2";
          const lbl = document.createElement("span");
          lbl.className = "w-16 shrink-0 text-[11px] text-slate-500 dark:text-slate-400";
          lbl.textContent = b.label;
          const barWrap = document.createElement("div");
          barWrap.className = "relative h-3 flex-1 rounded bg-slate-100 dark:bg-slate-800";
          const bar = document.createElement("div");
          const isCity = b.label === "CityAvg";
          
          // Use same color mapping as line chart for selected ZIPs
          if (isCity) {
            bar.className = "h-3 rounded bg-slate-400/70";
          } else if (b.selected) {
            // Use the same color as the line chart for this ZIP, but more muted
            const zipColor = selectedZipColors.get(b.label);
            if (zipColor) {
              bar.className = "h-3 rounded";
              bar.style.backgroundColor = zipColor + "80"; // Add 50% opacity for muted effect
            } else {
              bar.className = "h-3 rounded bg-brand-500/80";
            }
          } else {
            bar.className = "h-3 rounded bg-slate-400/60";
          }
          
          const w = Math.max(0, Math.round((b.value / max) * 100));
          bar.style.width = `${w}%`;
          const val = document.createElement("span");
          val.className = "ml-2 w-14 shrink-0 text-right text-[11px] tabular-nums text-slate-500 dark:text-slate-400";
          val.textContent = formatStatValue(b.value, item.type);
          barWrap.appendChild(bar);
          row.appendChild(lbl);
          row.appendChild(barWrap);
          row.appendChild(val);
          chart.appendChild(row);
        }
      };

      const renderLines = () => {
        chart.innerHTML = "";
        const series = statSeriesById.get(item.statId) || [];
        if (series.length === 0) {
          const p = document.createElement("p");
          p.className = "text-xs text-slate-500 dark:text-slate-400";
          p.textContent = "No historical data";
          chart.appendChild(p);
          return;
        }
        // Build city average points
        const cityPoints = series.map((e) => {
          const vals = Object.values(e.data || {});
          const nums = vals.filter((x) => typeof x === "number") as number[];
          const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
          return { date: e.date, value: avg, label: "CityAvg" };
        });
        // Only show lines for the selected ZIPs
        const labels = selectedZips.slice();

        // Assign colors: use toolbar chip colors for selected zips when available; otherwise fall back to highlight palette
        const colorByZip = new Map<string, string>();
        const used = new Set<string>();
        for (const zip of labels) {
          const col = selectedZipColors.get(zip);
          if (col) {
            colorByZip.set(zip, col);
            used.add(col);
          }
        }
        for (const zip of labels) {
          if (colorByZip.has(zip)) continue;
          const next = HIGHLIGHT_COLORS.find((c) => !used.has(c)) || HIGHLIGHT_COLORS[0];
          colorByZip.set(zip, next);
          used.add(next);
        }

        // Layout: left value rail + full-width plot
        const layout = document.createElement("div");
        // Reduce gap between value rail and plot so the chart starts flush left
        layout.className = "flex w-full gap-1";
        const rail = document.createElement("div");
        // Position y-axis labels absolutely so they align with gridlines
        rail.className = "relative w-12 text-right text-[11px] text-slate-400 dark:text-slate-500";
        const plotWrapper = document.createElement("div");
        // Make sure the svg area can expand to fill remaining card width
        plotWrapper.className = "relative flex-1 min-w-0";
        layout.appendChild(rail);
        layout.appendChild(plotWrapper);
        chart.appendChild(layout);

        // Measure after layout; if initial width is tiny (not yet laid out), schedule a re-render next frame
        const width = Math.max(320, Math.floor(plotWrapper.clientWidth || chart.clientWidth || 320));
        if (width <= 330) {
          requestAnimationFrame(() => renderLines());
        }
        const height = 140;
        // Keep rail height in sync with the SVG so absolute-positioned labels align
        rail.style.height = `${height}px`;
        // Remove internal left margin so the plot abuts the left value rail
        const margin = { top: 6, right: 8, bottom: 22, left: 0 };
        const innerW = width - margin.left - margin.right;
        const innerH = height - margin.top - margin.bottom;
        const dates = series.map((s) => s.date);
        const x = (i: number) => (dates.length <= 1 ? innerW / 2 : (i / (dates.length - 1)) * innerW);
        const allVals: number[] = [];
        for (const p of cityPoints) allVals.push(p.value);
        for (const z of labels) {
          for (const e of series) {
            const v = e.data[z];
            allVals.push(typeof v === "number" ? v : 0);
          }
        }
        const minV = Math.min(...allVals);
        const maxV = Math.max(...allVals);
        const midV = (minV + maxV) / 2;
        // Add a small bottom padding so the lowest tick/label isn't flush with the chart bottom
        const range = Math.max(1e-9, maxV - minV);
        const padBottom = range * 0.05; // 5% bottom padding so floor is a bit lower
        const yMin = minV - padBottom;
        const yMax = maxV; // keep top tight
        const y = (v: number) => innerH - ((v - yMin) / Math.max(1e-9, (yMax - yMin))) * innerH;

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.setAttribute("width", String(width));
        svg.setAttribute("height", String(height));
        const g = document.createElementNS(svg.namespaceURI, "g");
        g.setAttribute("transform", `translate(${margin.left},${margin.top})`);
        svg.appendChild(g);

        // Minimal y ticks (3)
        const ticks = 3;
        for (let i = 0; i <= ticks; i++) {
          const t = i / ticks;
          const v = minV + (maxV - minV) * t;
          const yPos = y(v);
          const line = document.createElementNS(svg.namespaceURI, "line");
          line.setAttribute("x1", "0");
          line.setAttribute("x2", String(innerW));
          line.setAttribute("y1", String(yPos));
          line.setAttribute("y2", String(yPos));
          line.setAttribute("stroke", "#cbd5e1");
          line.setAttribute("stroke-width", "1");
          line.setAttribute("opacity", "0.25");
          g.appendChild(line);
        }
        // x labels: first and last year
        if (dates.length > 0) {
          const first = document.createElementNS(svg.namespaceURI, "text");
          first.setAttribute("x", "0");
          first.setAttribute("y", String(innerH + 14));
          first.setAttribute("fill", "#94a3b8");
          first.setAttribute("font-size", "10");
          first.textContent = dates[0];
          g.appendChild(first);
          const last = document.createElementNS(svg.namespaceURI, "text");
          last.setAttribute("x", String(innerW));
          last.setAttribute("y", String(innerH + 14));
          last.setAttribute("text-anchor", "end");
          last.setAttribute("fill", "#94a3b8");
          last.setAttribute("font-size", "10");
          last.textContent = dates[dates.length - 1];
          g.appendChild(last);
        }

        // Left value rail labels, positioned to align exactly with gridlines
        const mk = (v: number) => {
          const s = document.createElement("span");
          s.textContent = formatStatValue(v, item.type);
          s.style.position = "absolute";
          s.style.right = "0";
          s.style.top = `${margin.top + y(v)}px`;
          s.style.transform = "translateY(-50%)";
          return s;
        };
        rail.appendChild(mk(maxV));
        rail.appendChild(mk(midV));
        rail.appendChild(mk(minV));

        // Helper to create smooth cubic-bezier path
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

        // Helper to draw smooth line
        const drawLine = (vals: number[], stroke: string, dashed = false) => {
          const path = document.createElementNS(svg.namespaceURI, "path");
          const pts = vals.map((v, i) => ({ x: x(i), y: y(v) }));
          const d = buildSmoothPath(pts, 0.2);
          path.setAttribute("d", d);
          path.setAttribute("fill", "none");
          path.setAttribute("stroke", stroke);
          path.setAttribute("stroke-width", dashed ? "2.2" : "1.9");
          if (dashed) path.setAttribute("stroke-dasharray", "4 3");
          g.appendChild(path);
        };

        // City line first (dashed)
        drawLine(cityPoints.map((p) => p.value), "#94a3b8", true);
        // Each chosen zip with assigned colors (muted)
        labels.forEach((zip) => {
          const vals = series.map((e) => (typeof e.data[zip] === "number" ? (e.data[zip] as number) : 0));
          const baseColor = colorByZip.get(zip) || HIGHLIGHT_COLORS[0];
          // Make line colors more muted by reducing opacity
          const stroke = baseColor + "CC"; // Add ~80% opacity for muted effect
          drawLine(vals, stroke, false);
        });

        plotWrapper.appendChild(svg);

        // Minimal legend at bottom
        const legend = document.createElement("div");
        legend.className = "mt-2 flex flex-wrap items-center gap-3";
        const mkLegend = (label: string, stroke: string, dashed = false) => {
          const item = document.createElement("div");
          item.className = "flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400";
          const swatch = document.createElement("span");
          swatch.className = "inline-block h-2 w-3";
          swatch.style.background = dashed ? "transparent" : stroke;
          swatch.style.borderBottom = dashed ? `2px dashed ${stroke}` : `2px solid ${stroke}`;
          const text = document.createElement("span");
          text.textContent = label;
          item.appendChild(swatch);
          item.appendChild(text);
          legend.appendChild(item);
        };
        mkLegend("CityAvg", "#94a3b8", true);
        labels.forEach((zip) => {
          const baseColor = colorByZip.get(zip) || HIGHLIGHT_COLORS[0];
          const mutedColor = baseColor + "CC"; // Match the muted line color
          mkLegend(zip, mutedColor);
        });
        chart.appendChild(legend);
      };

      card.appendChild(title);
      card.appendChild(chart);
      highlightsGrid.appendChild(card);

      const toggleMode = () => {
        if (highlightsExpanded.has(item.statId)) {
          highlightsExpanded.delete(item.statId);
        } else {
          highlightsExpanded.add(item.statId);
        }
        // Re-render all highlight cards so adjacency-aware bar expansion recalculates
        renderHighlights(topFour);
      };
      // Initial render depends on expanded state
      if (highlightsExpanded.has(item.statId)) renderLines(); else renderBars();
      // Toggle on click anywhere in card
      card.addEventListener("click", toggleMode);
    }
  };

  const updateOrgs = () => {
    orgsList.innerHTML = "";
    if (selectedZips.length === 0) {
      const empty = document.createElement("p");
      empty.className = "px-1 py-2 text-sm text-slate-500 dark:text-slate-400";
      empty.textContent = "No ZIPs selected.";
      orgsList.appendChild(empty);
      return;
    }
    const sel = new Set(selectedZips);
    const inSel = organizations.filter((o) => {
      const z = orgZipMap.get(o.id);
      return z ? sel.has(z) : false;
    });
    if (inSel.length === 0) {
      const empty = document.createElement("p");
      empty.className = "px-1 py-2 text-sm text-slate-500 dark:text-slate-400";
      empty.textContent = "No organizations found in selection.";
      orgsList.appendChild(empty);
      return;
    }
    for (const org of inSel) {
      const li = document.createElement("li");
      li.className = "rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-800/40";
      const name = document.createElement("p");
      name.className = "text-sm font-medium text-slate-700 dark:text-slate-200";
      name.textContent = org.name;
      const row = document.createElement("div");
      row.className = "mt-1 flex items-center justify-between";
      const link = document.createElement("a");
      link.href = org.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.className = "text-xs font-medium text-slate-500 hover:text-brand-700 dark:text-slate-400";
      link.textContent = "Visit site";
      const badge = document.createElement("span");
      badge.className = "rounded-full bg-slate-100 px-2 py-[2px] text-[10px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-200";
      badge.textContent = (org as any).category as string;
      row.appendChild(badge);
      row.appendChild(link);
      li.appendChild(name);
      li.appendChild(row);
      orgsList.appendChild(li);
    }
  };

  const showEmptyState = () => {
    // Hide all content sections
    callouts.style.display = "none";
    highlightsSection.style.display = "none";
    rankingSection.style.display = "none";
    orgsSection.style.display = "none";
    
    // Show empty state message if it doesn't exist
    let emptyState = inner.querySelector('.empty-state-message');
    if (!emptyState) {
      emptyState = document.createElement("div");
      emptyState.className = "empty-state-message flex flex-col items-center justify-center py-16 text-center";
      emptyState.innerHTML = `
        <div class="mb-4">
          <svg class="mx-auto h-12 w-12 text-slate-400 dark:text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
        </div>
        <h3 class="mb-2 text-lg font-semibold text-slate-800 dark:text-slate-100">No area selected</h3>
        <p class="text-sm text-slate-500 dark:text-slate-400">Please enter a ZIP above or select one on the map</p>
      `;
      inner.appendChild(emptyState);
    }
    (emptyState as HTMLElement).style.display = "flex";
  };

  const hideEmptyState = () => {
    // Show all content sections
    callouts.style.display = "";
    highlightsSection.style.display = "";
    rankingSection.style.display = "";
    orgsSection.style.display = "";
    
    // Hide empty state message
    const emptyState = inner.querySelector('.empty-state-message');
    if (emptyState) {
      (emptyState as HTMLElement).style.display = "none";
    }
  };

  const updateAll = () => {
    updateHeader();
    if (selectedZips.length === 0) {
      showEmptyState();
    } else {
      hideEmptyState();
      updateCallouts();
      updateRanking();
      updateOrgs();
    }
  };

  return {
    element: container,
    setAreasByKey: (areas) => {
      areasByKey = areas;
      updateAll();
    },
    setSelectedZips: (zips) => {
      selectedZips = zips;
      // Build selected zip color mapping to mirror toolbar chip ordering when in line mode
      const map = new Map<string, string>();
      if (selectedZips.length > 0 && selectedZips.length < 4) {
        selectedZips.forEach((z, i) => map.set(z, CHIP_LINE_COLORS[i % CHIP_LINE_COLORS.length]));
      }
      selectedZipColors = map;
      // Reset highlight modes to default on area changes
      highlightsExpanded.clear();
      updateAll();
    },
    setOrganizations: (orgs, map) => {
      organizations = orgs;
      orgZipMap = map;
      updateAll();
    },
    setStatsMeta: (stats) => {
      statsById = stats;
      updateAll();
    },
    setStatDataById: (byId) => {
      statDataById = byId;
      updateAll();
    },
    setStatSeriesById: (byId) => {
      statSeriesById = byId;
      updateAll();
    },
  };
};


