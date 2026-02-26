import { afterEach, describe, expect, it } from "vitest";

import { getDomainDefaults, getDomainMetadata, isFoodMapDomain } from "./domains";

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

  it("uses food metadata on food-map domains", () => {
    (globalThis as any).window = { location: { hostname: "okfoodmap.com" } };
    expect(getDomainMetadata()).toEqual({
      title: "Oklahoma Food Map",
      description:
        "Oklahoma Food Map helps Oklahomans to 1. Find food resources, 2. Understand neighborhood needs, and 3. Share new locations & contributions -- a passion project by Neighborhood Explorer.",
    });
  });

  it("uses neighborhood explorer metadata on non-food domains", () => {
    (globalThis as any).window = { location: { hostname: "map.neighborhoodexplorer.org" } };
    expect(getDomainMetadata()).toEqual({
      title: "Neighborhood Explorer Oklahoma",
      description: "Mapping out a better tomorrow for our neighborhoods.",
    });
  });
});
