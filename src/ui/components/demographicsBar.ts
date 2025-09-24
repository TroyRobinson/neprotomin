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
    "flex items-center border-b border-slate-200 bg-white/70 px-4 py-2 text-xs dark:border-slate-800 dark:bg-slate-900/70";

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

  container.appendChild(title);
  container.appendChild(stats);

  const setStats = (s: DemographicStats | null) => {
    const nextTitle = s?.label?.trim() ? s.label : DEFAULT_TITLE;
    title.textContent = nextTitle;

    if (!s || s.selectedCount <= 0) {
      pop.innerHTML = `<span class="font-semibold text-slate-500 dark:text-slate-400">Pop:</span> <span class="text-slate-400 dark:text-slate-500">—</span>`;
      age.innerHTML = `<span class="font-semibold text-slate-500 dark:text-slate-400">Avg Age:</span> <span class="text-slate-400 dark:text-slate-500">—</span>`;
      married.innerHTML = `<span class="font-semibold text-slate-500 dark:text-slate-400">Married:</span> <span class="text-slate-400 dark:text-slate-500">—</span>`;
      return;
    }
    pop.innerHTML = `<span class="font-semibold text-slate-500 dark:text-slate-400">Pop:</span> <span class="text-slate-400 dark:text-slate-500">${formatPopulation(s.population)}</span>`;
    age.innerHTML = `<span class="font-semibold text-slate-500 dark:text-slate-400">Avg Age:</span> <span class="text-slate-400 dark:text-slate-500">${formatNumber(s.avgAge)}</span>`;
    married.innerHTML = `<span class="font-semibold text-slate-500 dark:text-slate-400">Married:</span> <span class="text-slate-400 dark:text-slate-500">${formatPercent(s.marriedPercent)}</span>`;
  };

  // Initialize empty state
  setStats(null);

  return { element: container, setStats };
};
