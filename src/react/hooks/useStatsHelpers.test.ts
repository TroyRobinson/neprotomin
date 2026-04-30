import { describe, expect, it } from "vitest";
import type { Stat } from "../../types/stat";
import {
  addIdsToContext,
  addLoadedIdsToContext,
  computeSelectedAreaResolution,
  getContextSet,
  getEffectiveStatType,
  makeLoadedContextKey,
  parseBooleanFlag,
  previewIds,
  removeIdsFromAllContexts,
  removeIdsFromContext,
  removeLoadedIdsFromAllContexts,
  resolveBooleanFlag,
} from "./useStatsHelpers";

const makeStat = (overrides: Partial<Stat>): Stat => ({
  id: "stat-a",
  name: "Population",
  category: "demographics",
  ...overrides,
});

describe("useStatsHelpers", () => {
  it("parses debug flag values", () => {
    expect(parseBooleanFlag("1")).toBe(true);
    expect(parseBooleanFlag(" TRUE ")).toBe(true);
    expect(parseBooleanFlag("verbose")).toBe(true);
    expect(parseBooleanFlag("0")).toBe(false);
    expect(parseBooleanFlag("off")).toBe(false);
    expect(parseBooleanFlag("maybe")).toBeNull();
    expect(parseBooleanFlag(null)).toBeNull();
  });

  it("resolves boolean flags by URL, storage, then fallback", () => {
    expect(resolveBooleanFlag({ urlValue: false, storageValue: true, fallback: true })).toBe(false);
    expect(resolveBooleanFlag({ urlValue: null, storageValue: true, fallback: false })).toBe(true);
    expect(resolveBooleanFlag({ urlValue: null, storageValue: null, fallback: true })).toBe(true);
  });

  it("previews ids without mutating the original list", () => {
    const ids = ["a", "b", "c", "d"];
    expect(previewIds(ids, 2)).toEqual(["a", "b"]);
    expect(ids).toEqual(["a", "b", "c", "d"]);
  });

  it("computes selected area resolution for ZIP and county rows", () => {
    expect(
      computeSelectedAreaResolution({
        selectedStatId: "income",
        selectedZipIds: ["74104", "74105", ""],
        selectedCountyIds: ["40143", "40145"],
        rows: [
          {
            statId: "income",
            boundaryType: "zip",
            data: { "74104": 10, "74105": null },
          },
          {
            statId: "income",
            boundaryType: "COUNTY",
            data: { "40143": 12, "40145": Number.NaN },
          },
          {
            statId: "other",
            boundaryType: "ZIP",
            data: { "74105": 20 },
          },
        ],
      }),
    ).toEqual({
      selectedStatId: "income",
      total: 4,
      resolved: 2,
      unresolved: 2,
      selectedZipCount: 2,
      selectedCountyCount: 2,
    });

    expect(
      computeSelectedAreaResolution({
        selectedStatId: null,
        selectedZipIds: ["74104"],
        selectedCountyIds: [],
        rows: [],
      }),
    ).toBeNull();
  });

  it("adds and removes context ids without cloning on no-op updates", () => {
    const empty = new Map<string, Set<string>>();
    const noChange = addIdsToContext(empty, "ctx", ["", ""]);
    expect(noChange).toBe(empty);

    const withIds = addIdsToContext(empty, "ctx", ["a", "b", "a"]);
    expect([...getContextSet(withIds, "ctx")]).toEqual(["a", "b"]);
    expect(addIdsToContext(withIds, "ctx", ["a"])).toBe(withIds);

    const removedOne = removeIdsFromContext(withIds, "ctx", ["a"]);
    expect([...getContextSet(removedOne, "ctx")]).toEqual(["b"]);

    const removedAll = removeIdsFromAllContexts(
      new Map([
        ["ctx", new Set(["a", "b"])],
        ["other", new Set(["b", "c"])],
      ]),
      ["b"],
    );
    expect([...getContextSet(removedAll, "ctx")]).toEqual(["a"]);
    expect([...getContextSet(removedAll, "other")]).toEqual(["c"]);
  });

  it("tracks loaded ids by compound context keys", () => {
    const contextKey = "ZIP::Tulsa";
    expect(makeLoadedContextKey(contextKey, "income")).toBe("ZIP::Tulsa::income");

    const loaded = addLoadedIdsToContext(new Set<string>(), contextKey, ["income", "population"]);
    expect([...loaded]).toEqual(["ZIP::Tulsa::income", "ZIP::Tulsa::population"]);
    expect(addLoadedIdsToContext(loaded, contextKey, ["income"])).toBe(loaded);

    const removed = removeLoadedIdsFromAllContexts(loaded, ["income"]);
    expect([...removed]).toEqual(["ZIP::Tulsa::population"]);
  });

  it("resolves the effective stat type", () => {
    const statsById = new Map<string, Stat>([
      ["explicit", makeStat({ id: "explicit", type: "percent" })],
      ["currency", makeStat({ id: "currency", label: "Median income (dollars)" })],
      ["count", makeStat({ id: "count" })],
    ]);

    expect(getEffectiveStatType("explicit", "count", statsById)).toBe("percent");
    expect(getEffectiveStatType("count", "rate", statsById)).toBe("rate");
    expect(getEffectiveStatType("currency", "count", statsById)).toBe("currency");
    expect(getEffectiveStatType("missing", "", statsById)).toBe("count");
  });
});
