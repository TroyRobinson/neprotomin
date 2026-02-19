import { formatStatValueCompact } from "../../../lib/format";

export interface SecondaryChoroplethLegendController {
  element: HTMLElement;
  pill: HTMLElement;
  setVisible: (visible: boolean) => void;
  setLoading: (loading: boolean) => void;
  setRange: (min: number, max: number, type?: string) => void;
  setColors: (lowHex: string, highHex: string) => void;
  destroy: () => void;
}

const formatValue = (value: number, type?: string, isMobile?: boolean): string => {
  const t = (type || "count").toLowerCase();
  if (isMobile && t === "percent") {
    const percentValue = value <= 1 ? value * 100 : value;
    return `${Math.round(percentValue)}%`;
  }
  if (isMobile && t === "percent_change") {
    const pct = value * 100;
    const sign = value > 0 ? "+" : "";
    return `${sign}${Math.round(pct)}%`;
  }
  return formatStatValueCompact(value, t);
};

export const createSecondaryChoroplethLegend = (isMobile?: boolean): SecondaryChoroplethLegendController => {
  const wrapper = document.createElement("div");
  // Wrapper is positioned by parent legend row
  wrapper.className = "pointer-events-none";

  const pill = document.createElement("div");
  pill.className = [
    "pointer-events-auto inline-flex items-center gap-3 rounded-lg border px-3 py-1.5 text-xs font-medium cursor-pointer",
    "bg-white/90 text-slate-600 border-teal-300 shadow-sm backdrop-blur-sm",
    "dark:bg-slate-900/80 dark:text-slate-300 dark:border-teal-700",
    "sm:py-1.5 py-2.5", // More vertical padding on mobile
  ].join(" ");

  const minGroup = document.createElement("div");
  minGroup.className = "flex items-center gap-2";
  const minDot = document.createElement("span");
  minDot.className = "h-2.5 w-2.5 rounded-full ring-1 ring-black/5 dark:ring-white/10";
  const minLabel = document.createElement("span");
  minLabel.className = "tabular-nums";
  minLabel.textContent = "—";
  minGroup.appendChild(minDot);
  minGroup.appendChild(minLabel);

  const sep = document.createElement("span");
  sep.textContent = "–";
  sep.className = "opacity-60";

  const maxGroup = document.createElement("div");
  maxGroup.className = "flex items-center gap-2";
  const maxDot = document.createElement("span");
  maxDot.className = "h-2.5 w-2.5 rounded-full ring-1 ring-black/5 dark:ring-white/10";
  const maxLabel = document.createElement("span");
  maxLabel.className = "tabular-nums";
  maxLabel.textContent = "—";
  maxGroup.appendChild(maxDot);
  maxGroup.appendChild(maxLabel);

  const spinnerWrap = document.createElement("span");
  spinnerWrap.className = "ml-0.5 hidden items-center justify-center text-teal-600 dark:text-teal-400";
  spinnerWrap.setAttribute("aria-hidden", "true");
  const spinner = document.createElement("span");
  spinner.className = "h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent";
  spinnerWrap.appendChild(spinner);

  pill.appendChild(minGroup);
  pill.appendChild(sep);
  pill.appendChild(maxGroup);
  pill.appendChild(spinnerWrap);
  wrapper.appendChild(pill);

  const setVisible = (visible: boolean) => {
    wrapper.classList.toggle("hidden", !visible);
  };

  const setLoading = (loading: boolean) => {
    spinnerWrap.classList.toggle("hidden", !loading);
    spinnerWrap.classList.toggle("inline-flex", loading);
  };

  const setRange = (min: number, max: number, type?: string) => {
    minLabel.textContent = formatValue(min, type, isMobile);
    maxLabel.textContent = formatValue(max, type, isMobile);
  };

  const setColors = (lowHex: string, highHex: string) => {
    minDot.style.backgroundColor = lowHex;
    maxDot.style.backgroundColor = highHex;
  };

  const destroy = () => {
    wrapper.remove();
  };

  setVisible(false);

  return { element: wrapper, pill, setVisible, setLoading, setRange, setColors, destroy };
};
