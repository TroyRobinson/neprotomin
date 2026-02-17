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

// Diverging scale for percent change: plum (negative) -> neutral -> indigo (positive)
// Negative values: light plum tint to #784578, darker as more negative
export const DIVERGING_NEGATIVE_COLORS = [
  "#f6f0f7", // very light tint
  "#ead9ec", // light plum
  "#d7b7dc", // medium-light plum
  "#c08fc7", // medium plum
  "#a56cab", // medium-dark plum
  "#8a5a92", // softened strongest negative (based on #784578)
];

// Positive values: indigo scale, darker as more positive
export const DIVERGING_POSITIVE_COLORS = [
  "#eef2ff", // very light indigo
  "#e0e7ff", // indigo-100
  "#c7d2fe", // indigo-200
  "#a5b4fc", // indigo-300
  "#818cf8", // indigo-400
  "#6366f1", // indigo-500 - brand
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

// For diverging data (percent change): returns { isPositive, index }
// index 0 = closest to zero, higher = further from zero
export const getDivergingColor = (
  value: number,
  min: number,
  max: number,
): string => {
  if (!Number.isFinite(value)) return DIVERGING_POSITIVE_COLORS[0];
  
  const negColors = DIVERGING_NEGATIVE_COLORS;
  const posColors = DIVERGING_POSITIVE_COLORS;
  
  if (value >= 0) {
    // Positive: scale from 0 to max
    const maxAbs = Math.max(0.001, max);
    const ratio = Math.min(1, value / maxAbs);
    const idx = Math.floor(ratio * (posColors.length - 1));
    return posColors[Math.min(posColors.length - 1, Math.max(0, idx))];
  } else {
    // Negative: scale from min to 0
    const minAbs = Math.abs(Math.min(-0.001, min));
    const ratio = Math.min(1, Math.abs(value) / minAbs);
    const idx = Math.floor(ratio * (negColors.length - 1));
    return negColors[Math.min(negColors.length - 1, Math.max(0, idx))];
  }
};
