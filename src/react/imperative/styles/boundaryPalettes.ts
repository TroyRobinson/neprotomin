export type ThemeName = "light" | "dark";

export interface BoundaryPalette {
  fillColor: string;
  fillOpacity: number;
  lineColor: string;
  lineOpacity: number;
}

export const getBoundaryPalette = (theme: ThemeName): BoundaryPalette =>
  theme === "dark"
    ? { fillColor: "#94a3b8", fillOpacity: 0.08, lineColor: "#f1f5f9", lineOpacity: 0.52 }
    : { fillColor: "#1f2937", fillOpacity: 0.04, lineColor: "#94a3b8", lineOpacity: 0.82 };

export const getHoverColors = (
  theme: ThemeName,
  isSelected: boolean,
  isPinned: boolean,
): { fillColor: string; fillOpacity: number; lineColor: string; lineOpacity: number } => {
  if (isPinned || isSelected) {
    return {
      fillColor: "#3755f0",
      fillOpacity: theme === "dark" ? 0.32 : 0.26,
      lineColor: "#4f46e5",
      lineOpacity: 0.9,
    };
  }
  const palette = getBoundaryPalette(theme);
  return {
    fillColor: palette.fillColor,
    fillOpacity: palette.fillOpacity * 1.8,
    lineColor: theme === "dark" ? "#cbd5e1" : "#475569",
    lineOpacity: palette.lineOpacity * 1.5,
  };
};


