export const CHOROPLETH_COLORS = [
  "#f0f1ff",
  "#e3e5ff",
  "#ccd0ff",
  "#a8afff",
  "#8a93ff",
  "#7d87f0",
  "#737de6",
];

export const TEAL_COLORS = [
  "#f9fffd",
  "#e9fffb",
  "#c9fbf2",
  "#99f0e3",
  "#63dfd0",
  "#24c7b8",
  "#0f766e",
];

export const getClassIndex = (
  value: number,
  min: number,
  max: number,
  numClasses: number,
): number => {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(min) || !Number.isFinite(max) || numClasses <= 1) return 0;
  const range = max - min;
  if (range <= 0) return Math.floor((numClasses - 1) / 2);
  const r = (value - min) / range;
  return Math.max(0, Math.min(numClasses - 1, Math.floor(r * (numClasses - 1))));
};


