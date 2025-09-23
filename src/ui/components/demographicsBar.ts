export interface DemographicStats {
  selectedCount: number;
  population?: number; // total
  avgAge?: number; // weighted average
  marriedPercent?: number; // weighted average
}

export interface DemographicsBarController {
  element: HTMLElement;
  setStats: (stats: DemographicStats | null) => void;
}

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
  title.textContent = "Demo:";

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
    if (!s || !s.selectedCount) {
      pop.textContent = `Population: —`;
      age.textContent = `Avg Age: —`;
      married.textContent = `Married: —`;
      return;
    }
    pop.textContent = `Population: ${formatPopulation(s.population)}`;
    age.textContent = `Avg Age: ${formatNumber(s.avgAge)}`;
    married.textContent = `Married: ${formatPercent(s.marriedPercent)}`;
  };

  // Initialize empty state
  setStats(null);

  return { element: container, setStats };
};
