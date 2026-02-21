import { afterEach, describe, expect, it } from "vitest";

import { getDomainDefaults, isFoodMapDomain } from "./domains";

describe("domain defaults", () => {
  const originalWindow = (globalThis as any).window;

  afterEach(() => {
    (globalThis as any).window = originalWindow;
  });

  it("detects okfoodmap domains", () => {
    (globalThis as any).window = { location: { hostname: "okfoodmap.com" } };
    expect(isFoodMapDomain()).toBe(true);

    (globalThis as any).window = { location: { hostname: "app.okfoodmap.com" } };
    expect(isFoodMapDomain()).toBe(true);

    (globalThis as any).window = { location: { hostname: "example.test" } };
    expect(isFoodMapDomain()).toBe(false);
  });

  it("defaults extremas off on okfoodmap domains", () => {
    (globalThis as any).window = { location: { hostname: "okfoodmap.com" } };
    expect(getDomainDefaults().defaultExtremasVisible).toBe(false);
  });

  it("defaults extremas on for non-food-map domains", () => {
    (globalThis as any).window = { location: { hostname: "map.neighborhoodexplorer.org" } };
    expect(getDomainDefaults().defaultExtremasVisible).toBe(true);
  });
});
