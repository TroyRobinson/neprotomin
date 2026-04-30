import { describe, expect, it } from "vitest";
import { abbreviateCategoryFilterLabel, areaKey } from "./sidebarDisplay";

describe("sidebarDisplay", () => {
  it("abbreviates long category labels", () => {
    expect(abbreviateCategoryFilterLabel("Housing")).toBe("Hous..");
    expect(abbreviateCategoryFilterLabel("Food")).toBe("Food");
    expect(abbreviateCategoryFilterLabel("  Health  ")).toBe("Health");
  });

  it("builds stable area keys", () => {
    expect(areaKey("ZIP", "74104")).toBe("ZIP:74104");
    expect(areaKey("COUNTY", "143")).toBe("COUNTY:143");
  });
});
