import { describe, expect, it } from "vitest";
import {
  areaSelectionsEqual,
  arraysEqual,
  createEmptySelection,
  dedupeIds,
  normalizeAreaSelection,
} from "./areaSelection";

describe("areaSelection", () => {
  it("creates empty selection state", () => {
    expect(createEmptySelection()).toEqual({
      selected: [],
      pinned: [],
      transient: [],
    });
  });

  it("deduplicates ids while preserving order", () => {
    expect(dedupeIds(["74104", "74105", "74104", "74120"])).toEqual([
      "74104",
      "74105",
      "74120",
    ]);
  });

  it("compares arrays by order and value", () => {
    expect(arraysEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(arraysEqual(["a", "b"], ["b", "a"])).toBe(false);
    expect(arraysEqual(["a"], ["a", "b"])).toBe(false);
  });

  it("normalizes and compares area selection states", () => {
    const normalized = normalizeAreaSelection({
      selected: ["a", "a", "b"],
      pinned: ["b", "b"],
      transient: ["c", "c"],
    });

    expect(normalized).toEqual({
      selected: ["a", "b"],
      pinned: ["b"],
      transient: ["c"],
    });
    expect(
      areaSelectionsEqual(normalized, {
        selected: ["a", "b"],
        pinned: ["b"],
        transient: ["c"],
      }),
    ).toBe(true);
  });
});
