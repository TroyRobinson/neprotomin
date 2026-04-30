import { describe, expect, it } from "vitest";
import type { BoundsArray } from "../../../lib/zipBoundaries";
import { boundsArea, intersectionArea } from "./mapBounds";

describe("mapBounds", () => {
  it("calculates positive bounds area", () => {
    expect(boundsArea([[0, 0], [4, 3]])).toBe(12);
  });

  it("returns zero for inverted or flat bounds", () => {
    expect(boundsArea([[4, 0], [0, 3]])).toBe(0);
    expect(boundsArea([[0, 1], [4, 1]])).toBe(0);
  });

  it("calculates overlapping area", () => {
    const a: BoundsArray = [[0, 0], [4, 4]];
    const b: BoundsArray = [[2, 1], [5, 3]];
    expect(intersectionArea(a, b)).toBe(4);
  });

  it("returns zero when bounds do not overlap", () => {
    const a: BoundsArray = [[0, 0], [1, 1]];
    const b: BoundsArray = [[2, 2], [3, 3]];
    expect(intersectionArea(a, b)).toBe(0);
  });
});
