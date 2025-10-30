export interface SecondaryChoroplethLegendController {
  element: HTMLElement;
  setVisible: (visible: boolean) => void;
  setRange: (min: number, max: number, type?: string) => void;
  setColors: (lowHex: string, highHex: string) => void;
  destroy: () => void;
}

const wrap = (n: number, digits = 1): string => {
  return (Math.round(n * Math.pow(10, digits)) / Math.pow(10, digits)).toString();
};

const formatValue = (value: number, type?: string): string => {
  const t = (type || "").toLowerCase();
  if (t === "currency") {
    const k = Math.round(value / 1000);
    return `$${k}k`;
  }
  if (t === "percent") {
    const hasFrac = Math.abs(value % 1) > 1e-6;
    return `${hasFrac ? wrap(value, 1) : Math.round(value)}%`;
  }
  if (t === "years" || t === "rate") {
    const hasFrac = Math.abs(value % 1) > 1e-6;
    return hasFrac ? wrap(value, 1) : String(Math.round(value));
  }
  if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)}k`;
  return String(Math.round(value));
};

export const createSecondaryChoroplethLegend = (): SecondaryChoroplethLegendController => {
  const wrapper = document.createElement("div");
  wrapper.className = "pointer-events-none absolute bottom-4 right-44 z-10";

  const pill = document.createElement("div");
  pill.className = [
    "inline-flex items-center gap-3 rounded-lg border px-3 py-1.5 text-xs font-medium",
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
  maxGroup.appendChild(maxDot);
  maxGroup.appendChild(maxLabel);

  pill.appendChild(minGroup);
  pill.appendChild(sep);
  pill.appendChild(maxGroup);
  wrapper.appendChild(pill);

  const setVisible = (visible: boolean) => {
    wrapper.classList.toggle("hidden", !visible);
  };

  const setRange = (min: number, max: number, type?: string) => {
    minLabel.textContent = formatValue(min, type);
    maxLabel.textContent = formatValue(max, type);
  };

  const setColors = (lowHex: string, highHex: string) => {
    minDot.style.backgroundColor = lowHex;
    maxDot.style.backgroundColor = highHex;
  };

  const destroy = () => {
    wrapper.remove();
  };

  setVisible(false);

  return { element: wrapper, setVisible, setRange, setColors, destroy };
};
