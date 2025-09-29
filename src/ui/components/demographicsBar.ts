export interface DemographicStats {
  selectedCount: number;
  label?: string;
  population?: number; // total
  avgAge?: number; // weighted average
  marriedPercent?: number; // weighted average
}

export interface DemographicsBarController {
  element: HTMLElement;
  setStats: (stats: DemographicStats | null) => void;
  setBreakdowns: (groups: Map<string, { key: string; segments: { key: string; label: string; colorToken: string; valuePercent: number }[] }>) => void;
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

export const createDemographicsBar = (): DemographicsBarController => {
  const container = document.createElement("div");
  container.className =
    "flex flex-col border-b border-slate-200 bg-white/70 text-xs dark:border-slate-800 dark:bg-slate-900/70";

  const headerRow = document.createElement("div");
  headerRow.className = "flex items-center px-4 py-2 cursor-pointer select-none";
  headerRow.setAttribute("role", "button");
  headerRow.tabIndex = 0;

  const title = document.createElement("div");
  title.className = "font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400";
  title.textContent = DEFAULT_TITLE;

  const stats = document.createElement("div");
  stats.className = "flex items-center gap-4 text-slate-600 dark:text-slate-300 ml-3";

  const pop = document.createElement("span");
  const age = document.createElement("span");
  const married = document.createElement("span");

  stats.appendChild(pop);
  stats.appendChild(age);
  stats.appendChild(married);

  headerRow.appendChild(title);
  headerRow.appendChild(stats);

  // Expandable panel
  const panel = document.createElement("div");
  panel.className = "px-4 pb-3 hidden";

  const mkGroup = (labelText: string): { root: HTMLElement; bar: HTMLElement; label: HTMLElement } => {
    const root = document.createElement("div");
    root.className = "mt-2 relative";
    const label = document.createElement("div");
    label.className = "mb-1 text-[11px] font-medium text-slate-500 dark:text-slate-400";
    label.textContent = labelText;
    const bar = document.createElement("div");
    bar.className = "relative w-full h-5 rounded bg-slate-200 dark:bg-slate-800 overflow-hidden";
    root.appendChild(label);
    root.appendChild(bar);
    return { root, bar, label };
  };

  const grpEth = mkGroup("Ethnicity");
  const grpInc = mkGroup("Income Level");
  const grpEdu = mkGroup("Education Level");

  panel.appendChild(grpEth.root);
  panel.appendChild(grpInc.root);
  panel.appendChild(grpEdu.root);

  container.appendChild(headerRow);
  container.appendChild(panel);

  const setStats = (s: DemographicStats | null) => {
    const nextTitle = s?.label?.trim() ? s.label : DEFAULT_TITLE;
    title.textContent = nextTitle;

    if (!s || s.selectedCount <= 0) {
      pop.innerHTML = `<span class="font-medium text-slate-400 dark:text-slate-500">Pop:</span> <span class="text-slate-400 dark:text-slate-500">—</span>`;
      age.innerHTML = `<span class="font-medium text-slate-400 dark:text-slate-500">Avg Age:</span> <span class="text-slate-400 dark:text-slate-500">—</span>`;
      married.innerHTML = `<span class="font-medium text-slate-400 dark:text-slate-500">Married:</span> <span class="text-slate-400 dark:text-slate-500">—</span>`;
      return;
    }
    pop.innerHTML = `<span class="font-medium text-slate-400 dark:text-slate-500">Pop:</span> <span class="text-slate-400 dark:text-slate-500">${formatPopulation(s.population)}</span>`;
    age.innerHTML = `<span class="font-medium text-slate-400 dark:text-slate-500">Avg Age:</span> <span class="text-slate-400 dark:text-slate-500">${formatNumber(s.avgAge)}</span>`;
    married.innerHTML = `<span class="font-medium text-slate-400 dark:text-slate-500">Married:</span> <span class="text-slate-400 dark:text-slate-500">${formatPercent(s.marriedPercent)}</span>`;
  };

  const clearBar = (bar: HTMLElement) => {
    while (bar.firstChild) bar.removeChild(bar.firstChild);
  };

  const COLOR_CLASS: Record<string, string> = {
    "brand-200": "bg-brand-200",
    "brand-300": "bg-brand-300",
    "brand-400": "bg-brand-400",
    "brand-500": "bg-brand-500",
    "brand-700": "bg-brand-700",
  };

  const tipByRoot = new WeakMap<HTMLElement, HTMLDivElement>();
  const ensureTip = (root: HTMLElement): HTMLDivElement => {
    const existing = tipByRoot.get(root);
    if (existing) return existing;
    const tip = document.createElement("div");
    tip.className = "pointer-events-none absolute z-10 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-medium text-white shadow";
    tip.style.display = "none";
    root.appendChild(tip);
    tipByRoot.set(root, tip);
    return tip;
  };

  const renderSegments = (bar: HTMLElement, segments: { key: string; label: string; colorToken: string; valuePercent: number }[]) => {
    clearBar(bar);
    // Build stacked segments across the full width
    let cumulative = 0;
    segments.forEach((seg) => {
      const width = Math.max(0, Math.min(100, Math.round(seg.valuePercent)));
      if (width <= 0) return;
      const div = document.createElement("div");
      const colorClass = COLOR_CLASS[seg.colorToken] || "bg-brand-300";
      div.className = `absolute top-0 bottom-0 ${colorClass}`;
      div.style.left = `${cumulative}%`;
      div.style.width = `${width}%`;
      // Hover tooltip
      const root = bar.parentElement as HTMLElement;
      const tip = ensureTip(root);
      const show = (clientX: number) => {
        tip.textContent = `${seg.label}: ${width}%`;
        tip.style.display = "block";
        const rootRect = root.getBoundingClientRect();
        // Position horizontally near cursor, clamped within root
        // Compute provisional left, then clamp after measuring tip width
        const provisionalLeft = clientX - rootRect.left;
        // Temporarily position to measure width
        tip.style.left = `${provisionalLeft}px`;
        tip.style.top = `${bar.offsetTop - 8 - tip.offsetHeight}px`;
        const tipHalf = tip.offsetWidth / 2;
        const minLeft = tipHalf + 4;
        const maxLeft = rootRect.width - tipHalf - 4;
        const clampedLeft = Math.max(minLeft, Math.min(maxLeft, provisionalLeft));
        tip.style.left = `${clampedLeft - tipHalf}px`;
      };
      div.addEventListener("mouseenter", (e: MouseEvent) => show(e.clientX));
      div.addEventListener("mousemove", (e: MouseEvent) => show(e.clientX));
      div.addEventListener("mouseleave", () => {
        const root = bar.parentElement as HTMLElement;
        const tip = ensureTip(root);
        tip.style.display = "none";
      });
      bar.appendChild(div);
      cumulative += width;
    });
  };

  const setBreakdowns = (
    groups: Map<string, { key: string; segments: { key: string; label: string; colorToken: string; valuePercent: number }[] }>,
  ) => {
    const eth = groups.get("ethnicity");
    const inc = groups.get("income");
    const edu = groups.get("education");
    if (eth) renderSegments(grpEth.bar, eth.segments);
    if (inc) renderSegments(grpInc.bar, inc.segments);
    if (edu) renderSegments(grpEdu.bar, edu.segments);
  };

  let expanded = false;
  const applyExpanded = () => {
    if (expanded) {
      panel.classList.remove("hidden");
      headerRow.setAttribute("aria-expanded", "true");
      // Add a very slight grey tint when expanded
      container.classList.remove("bg-white/70", "dark:bg-slate-900/70");
      container.classList.add("bg-slate-50/70", "dark:bg-slate-800/70");
    } else {
      panel.classList.add("hidden");
      headerRow.setAttribute("aria-expanded", "false");
      // Revert tint when collapsed
      container.classList.add("bg-white/70", "dark:bg-slate-900/70");
      container.classList.remove("bg-slate-50/70", "dark:bg-slate-800/70");
    }
  };
  headerRow.addEventListener("click", () => { expanded = !expanded; applyExpanded(); });
  headerRow.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); expanded = !expanded; applyExpanded(); }
  });
  applyExpanded();

  // Initialize empty state
  setStats(null);

  return { element: container, setStats, setBreakdowns };
};
