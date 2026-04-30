import { describe, expect, it } from "vitest";
import { formatOrgRevenueLine, preventTrailingWordOrphan } from "./orgTooltipText";

describe("orgTooltipText", () => {
  it("formats valid annual revenue with year", () => {
    expect(formatOrgRevenueLine(1_250_000, 2023)).toBe("Revenue $1.3M (2023)");
  });

  it("formats valid annual revenue without invalid year", () => {
    expect(formatOrgRevenueLine(50_000, 1800)).toBe("Revenue $50.0K");
  });

  it("omits empty or invalid revenue values", () => {
    expect(formatOrgRevenueLine(0, 2023)).toBeNull();
    expect(formatOrgRevenueLine(Number.NaN, 2023)).toBeNull();
    expect(formatOrgRevenueLine(null, 2023)).toBeNull();
  });

  it("prevents short trailing suffixes from orphaning", () => {
    expect(preventTrailingWordOrphan("Tulsa Food Bank LLC")).toBe("Tulsa Food Bank\u00A0LLC");
    expect(preventTrailingWordOrphan("Example Organization")).toBe("Example Organization");
  });

  it("normalizes whitespace before orphan prevention", () => {
    expect(preventTrailingWordOrphan("  Example   Inc. ")).toBe("Example\u00A0Inc.");
  });
});
