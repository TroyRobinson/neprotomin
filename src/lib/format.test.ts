import { describe, expect, it } from "vitest";

import { formatStatValue, formatStatValueCompact } from "./format";

describe("format stat values", () => {
  it("keeps small rate differences visible", () => {
    expect(formatStatValueCompact(0.07180020811654526, "rate")).toBe("0.072");
    expect(formatStatValueCompact(0.13561502830674216, "rate")).toBe("0.136");
    expect(formatStatValue(0.07180020811654526, "rate")).toBe("0.0718");
  });
});
