import { describe, expect, it } from "vitest";
import { getMapStyle, isCustomMapSource } from "./mapStyle";
import { SOURCE_ID } from "../constants/map";

describe("mapStyle", () => {
  it("selects Carto light and dark basemap styles", () => {
    expect(getMapStyle("light")).toContain("positron-gl-style");
    expect(getMapStyle("dark")).toContain("dark-matter-gl-style");
  });

  it("identifies app-owned map sources", () => {
    expect(isCustomMapSource(SOURCE_ID)).toBe(true);
    expect(isCustomMapSource("carto-basemap")).toBe(false);
    expect(isCustomMapSource(undefined)).toBe(false);
  });
});
