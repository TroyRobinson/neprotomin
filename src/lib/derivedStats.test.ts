import { describe, expect, it } from "vitest";

import {
  buildRowsByStatId,
  buildStatDataSummaryKey,
  computeDerivedValues,
  computeSummaryFromData,
  createDerivedStatRows,
  normalizeDataMap,
} from "./derivedStats";

describe("derivedStats helpers", () => {
  it("normalizes numeric data maps and ignores non-finite values", () => {
    expect(
      normalizeDataMap({
        a: 1,
        b: "2.5",
        c: "",
        d: "nope",
        e: Number.POSITIVE_INFINITY,
      }),
    ).toEqual({ a: 1, b: 2.5 });
  });

  it("computes summaries with zero defaults for empty data", () => {
    expect(computeSummaryFromData({ a: 2, b: 4 })).toEqual({
      count: 2,
      sum: 6,
      avg: 3,
      min: 2,
      max: 4,
    });
    expect(computeSummaryFromData({})).toEqual({ count: 0, sum: 0, avg: 0, min: 0, max: 0 });
  });

  it("uses the existing summary-key contract", () => {
    expect(buildStatDataSummaryKey("stat-1", "root", "Tulsa", "ZIP")).toBe(
      "stat-1::root::Tulsa::ZIP",
    );
  });

  it("computes two-stat formula values", () => {
    expect(computeDerivedValues({ a: 10, b: 20 }, { a: 2, b: 0 }, "percent")).toEqual({ a: 5 });
    expect(computeDerivedValues({ a: 10 }, { a: 2, b: 4 }, "sum")).toEqual({ a: 12, b: 4 });
    expect(computeDerivedValues({ a: 10 }, { a: 2 }, "index")).toEqual({ a: 500 });
  });

  it("creates standard derived rows using denominator coverage", () => {
    const rowsByStat = buildRowsByStatId([
      {
        statId: "num",
        parentArea: "Oklahoma",
        boundaryType: "ZIP",
        date: "2023",
        data: { "74103": 10 },
      },
      {
        statId: "den",
        parentArea: "Oklahoma",
        boundaryType: "ZIP",
        date: "2023",
        data: { "74103": 2, "74104": 0 },
      },
    ]);

    expect(
      createDerivedStatRows("percent", { numeratorId: "num", denominatorId: "den" }, rowsByStat),
    ).toEqual([
      {
        parentArea: "Oklahoma",
        boundaryType: "ZIP",
        date: "2023",
        data: { "74103": 5 },
      },
    ]);
  });

  it("creates multi-stat sum rows across operand coverage", () => {
    const rowsByStat = buildRowsByStatId([
      {
        statId: "a",
        parentArea: "Oklahoma",
        boundaryType: "COUNTY",
        date: "2023",
        data: { Tulsa: 4, Rogers: 2 },
      },
      {
        statId: "b",
        parentArea: "Oklahoma",
        boundaryType: "COUNTY",
        date: "2023",
        data: { Tulsa: 6, Wagoner: 3 },
      },
    ]);

    expect(createDerivedStatRows("sum", { sumOperandIds: ["a", "b"] }, rowsByStat)).toEqual([
      {
        parentArea: "Oklahoma",
        boundaryType: "COUNTY",
        date: "2023",
        data: { Tulsa: 10, Rogers: 2, Wagoner: 3 },
      },
    ]);
  });

  it("creates change-over-time rows by context", () => {
    const rowsByStat = buildRowsByStatId([
      {
        statId: "population",
        parentArea: "Oklahoma",
        boundaryType: "ZIP",
        date: "2021",
        data: { "74103": 100, "74104": 0 },
      },
      {
        statId: "population",
        parentArea: "Oklahoma",
        boundaryType: "ZIP",
        date: "2023",
        data: { "74103": 125, "74104": 10 },
      },
    ]);

    expect(
      createDerivedStatRows(
        "change_over_time",
        { numeratorId: "population", startYear: "2021", endYear: "2023" },
        rowsByStat,
      ),
    ).toEqual([
      {
        parentArea: "Oklahoma",
        boundaryType: "ZIP",
        date: "2021-2023",
        data: { "74103": 0.25 },
      },
    ]);
  });
});
