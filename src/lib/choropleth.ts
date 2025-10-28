export const CHOROPLETH_COLORS = [
  "#e9efff",
  "#cdd9ff",
  "#aebfff",
  "#85a3ff",
  "#6d8afc",
  "#4a6af9",
  "#3755f0",
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


