import type { Stat } from "../../types/stat";

type SeriesEntry = {
  date: string;
  type: string; // percent | rate | years | currency | count
  data: Record<string, number>;
};

export interface StatListController {
  element: HTMLElement;
  setStatsMeta: (statsById: Map<string, Stat>) => void;
  setSeries: (byStatId: Map<string, SeriesEntry[]>) => void;
  setSelectedZips: (zips: string[]) => void;
  setCategoryFilter: (categoryId: string | null) => void;
  setSecondaryStatId: (statId: string | null) => void;
  setSelectedStatId: (statId: string | null) => void;
}

export const createStatList = (opts: { onStatSelect?: (statId: string, meta?: { shiftKey?: boolean }) => void } = {}): StatListController => {
  const wrapper = document.createElement("div");
  wrapper.className = "flex-1 overflow-y-auto px-4 pb-6";

  const subtitle = document.createElement("p");
  subtitle.className = "px-1 pt-2 pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500";
  subtitle.style.display = "none";
  wrapper.appendChild(subtitle);

  const list = document.createElement("ul");
  list.className = "space-y-2";
  wrapper.appendChild(list);

  // State
  let statsById: Map<string, Stat> = new Map();
  let seriesByStatId: Map<string, SeriesEntry[]> = new Map();
  let selectedZips: string[] = [];
  let categoryFilter: string | null = null;
  let secondaryStatId: string | null = null;
  let selectedPrimaryStatId: string | null = null;

  const formatValue = (v: number, type: string): string => {
    if (!isFinite(v)) return "";
    switch (type) {
      case "percent":
        return `${Math.round(v * 10) / 10}\u2009%`;
      case "currency":
        return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Math.round(v));
      case "years":
      case "rate":
        return (Math.round(v * 10) / 10).toLocaleString("en-US");
      case "count":
      default:
        return Math.round(v).toLocaleString("en-US");
    }
  };

  const computeCityAvg = (entry: SeriesEntry | undefined): number => {
    if (!entry) return 0;
    const vals = Object.values(entry.data || {});
    const nums = vals.filter((x) => typeof x === "number") as number[];
    if (nums.length === 0) return 0;
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  };

  const render = () => {
    // Build items
    const stats: Stat[] = Array.from(statsById.values())
      .filter((s) => (categoryFilter ? s.category === (categoryFilter as any) : true));

    type Row = {
      id: string;
      name: string;
      value: number; // display value (city avg or selection avg)
      score: number; // for sorting significance (0..1, higher first)
      type: string;
      cityAvg: number;
    };

    const rows: Row[] = [];
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
        // Alphabetical will be applied later; score not used
        displayValue = cityAvg;
      } else if (selectedZips.length === 1) {
        const z = selectedZips[0];
        const v = typeof latest.data[z] === "number" ? (latest.data[z] as number) : 0;
        displayValue = v;
        // Normalize within this stat's distribution (0..1)
        score = range > 0 ? (v - min) / range : 0;
      } else {
        const nums = selectedZips.map((z) => (typeof latest.data[z] === "number" ? (latest.data[z] as number) : 0));
        const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
        displayValue = avg;
        const diff = Math.abs(avg - cityAvg);
        score = range > 0 ? diff / range : 0;
      }

      rows.push({ id: s.id, name: s.name, value: displayValue, score, type: latest.type, cityAvg });
    }

    // Sort
    if (selectedZips.length === 0) {
      rows.sort((a, b) => a.name.localeCompare(b.name));
    } else if (selectedZips.length === 1) {
      rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    } else {
      rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    }

    // Subtitle
    if (selectedZips.length === 1) {
      subtitle.style.display = "block";
      subtitle.textContent = `Most significant stats for ${selectedZips[0]}`;
    } else if (selectedZips.length > 1) {
      subtitle.style.display = "block";
      subtitle.textContent = `Most significant stats for Selected Areas (${selectedZips.length})`;
    } else {
      subtitle.style.display = "none";
    }

    // Render list
    list.replaceChildren();
    for (const r of rows) {
      const li = document.createElement("li");
      const isPrimarySelected = selectedPrimaryStatId === r.id;
      li.className = [
        "group relative flex items-center justify-between rounded-full border px-3 py-2 shadow-sm transition-colors cursor-pointer select-none",
        // base light/dark
        "border-slate-200/70 bg-white/70 hover:border-brand-200 hover:bg-brand-50",
        "dark:border-slate-700/70 dark:bg-slate-900/50 dark:hover:border-slate-600 dark:hover:bg-slate-800/70",
        // primary selected accent
        isPrimarySelected ? "border-2 border-brand-300 bg-brand-50 dark:border-brand-400/40" : "",
      ].filter(Boolean).join(" ");
      li.dataset.statId = r.id;

      const left = document.createElement("div");
      left.className = "min-w-0 flex flex-1 items-center pr-3 text-sm text-slate-600 dark:text-slate-300";
      // Ellipsis if too long; keep inline so the dot sits on the same line
      const title = document.createElement("span");
      title.className = "truncate whitespace-nowrap";
      title.textContent = r.name;
      left.appendChild(title);
      // Secondary stat indicator (tiny teal dot to the right of the name)
      if (secondaryStatId === r.id) {
        const dot = document.createElement("span");
        dot.className = "ml-2 inline-block h-2 w-2 rounded-full bg-teal-500 dark:bg-teal-400 shrink-0";
        left.appendChild(dot);
      }

      const right = document.createElement("div");
      right.className = "ml-2 shrink-0 text-right text-sm font-semibold text-slate-700 tabular-nums dark:text-slate-200 flex items-center";

      // Avg pill appears on hover when there is a selection
      if (selectedZips.length > 0) {
        const avg = document.createElement("span");
        avg.className = "mr-2 text-xs font-medium text-slate-400 opacity-0 transition-opacity duration-150 group-hover:opacity-100 dark:text-slate-500";
        avg.textContent = formatValue(r.cityAvg, r.type);

        // Tiny tooltip for double-hover over the avg pill
        const tip = document.createElement("div");
        tip.className =
          "pointer-events-none absolute z-10 hidden rounded border border-black/10 bg-slate-800 px-1.5 py-0.5 text-[10px] text-white shadow-sm " +
          "dark:border-white/20 dark:bg-slate-200 dark:text-slate-900";
        tip.textContent = "city average";
        li.appendChild(tip);

        const showTip = (e: MouseEvent) => {
          const liRect = li.getBoundingClientRect();
          const x = e.clientX - liRect.left;
          const y = e.clientY - liRect.top;
          tip.style.left = `${x + 8}px`;
          tip.style.top = `${y - 18}px`;
          tip.classList.remove("hidden");
        };
        const hideTip = () => tip.classList.add("hidden");

        avg.addEventListener("mouseenter", showTip);
        avg.addEventListener("mousemove", showTip);
        avg.addEventListener("mouseleave", hideTip);
        li.addEventListener("mouseleave", hideTip);

        right.appendChild(avg);
      }

      const valueEl = document.createElement("span");
      valueEl.textContent = formatValue(r.value, r.type);
      right.appendChild(valueEl);

      li.appendChild(left);
      li.appendChild(right);
      list.appendChild(li);

      if (opts.onStatSelect) {
        li.addEventListener("click", (ev) => {
          const mouseEvent = ev as MouseEvent;
          if (mouseEvent.shiftKey) {
            ev.preventDefault(); // Disable browser default selection behavior
          }
          opts.onStatSelect!(r.id, { shiftKey: mouseEvent.shiftKey });
        });
      }
    }
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
  const setCategoryFilter = (id: string | null) => {
    categoryFilter = id;
    render();
  };
  const setSecondaryStatId = (id: string | null) => {
    secondaryStatId = id;
    render();
  };
  const setSelectedStatId = (id: string | null) => {
    selectedPrimaryStatId = id;
    render();
  };

  // Initial
  render();

  return { element: wrapper, setStatsMeta, setSeries, setSelectedZips, setCategoryFilter, setSecondaryStatId, setSelectedStatId };
};
