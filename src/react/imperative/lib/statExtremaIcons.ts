export const STAT_EXTREME_GOOD_COLOR = "#6fc284";
export const STAT_EXTREME_BAD_COLOR = "#f15b41";
export const STAT_EXTREME_NEUTRAL_COLOR = "#f8d837";
export const STAT_EXTREME_GOOD_ICON_ID = "stat-extreme-triangle-good";
export const STAT_EXTREME_BAD_ICON_ID = "stat-extreme-triangle-bad";
export const STAT_EXTREME_NEUTRAL_ICON_ID = "stat-extreme-triangle-neutral";
export const STAT_EXTREME_ICON_SIZE = 1.08;

export type ExtremaTone = "good" | "bad" | "neutral";

export const statExtremeCombinedIconId = (highTone: ExtremaTone, lowTone: ExtremaTone) =>
  `stat-extreme-combined-${highTone}-${lowTone}`;

export const createStatExtremeArrowImage = (color: string): ImageData | null => {
  if (typeof document === "undefined") return null;
  const size = 20;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.clearRect(0, 0, size, size);
  // Straight-corner triangle marker for min/max indicators.
  ctx.beginPath();
  ctx.moveTo(size / 2, 3);
  ctx.lineTo(size - 3, size - 4);
  ctx.lineTo(3, size - 4);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();

  // White edge keeps markers readable over the choropleth.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.6;
  ctx.lineJoin = "miter";
  ctx.lineCap = "butt";
  ctx.stroke();

  return ctx.getImageData(0, 0, size, size);
};

// Two stacked triangles on a single icon: high (up) in topColor, low (down) in bottomColor.
export const createStatExtremeCombinedImage = (topColor: string, bottomColor: string): ImageData | null => {
  if (typeof document === "undefined") return null;
  const w = 20;
  const h = 30;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, w, h);

  const drawTriangle = (color: string, tipX: number, tipY: number, baseY: number) => {
    const halfBase = 7;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(tipX - halfBase, baseY);
    ctx.lineTo(tipX + halfBase, baseY);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.4;
    ctx.lineJoin = "miter";
    ctx.stroke();
  };

  drawTriangle(topColor, w / 2, 2, 13);
  drawTriangle(bottomColor, w / 2, h - 2, h - 13);

  return ctx.getImageData(0, 0, w, h);
};
