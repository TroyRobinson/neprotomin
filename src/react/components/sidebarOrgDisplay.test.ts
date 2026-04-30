import { describe, expect, it } from "vitest";
import type { Organization } from "../../types/organization";
import { buildMapsUrl, formatAnnualRevenueLabel, formatHoursLines, formatShortAddress } from "./sidebarOrgDisplay";

const org = (overrides: Partial<Organization>): Organization =>
  ({
    id: "org-1",
    name: "Food Place",
    category: "food",
    ...overrides,
  }) as Organization;

describe("sidebarOrgDisplay", () => {
  it("builds a Google Maps URL in desktop environments", () => {
    expect(buildMapsUrl(org({ address: "123 Main", city: "Tulsa", state: "OK", postalCode: "74104" }))).toContain(
      "google.com/maps/search",
    );
  });

  it("formats short addresses without repeated city/state/zip tails", () => {
    expect(formatShortAddress(org({ address: "123 Main St, Tulsa, OK 74104", city: "Tulsa", state: "OK", postalCode: "74104" }))).toBe(
      "123 Main St, Tulsa",
    );
    expect(formatShortAddress(org({ address: "", city: "Tulsa" }))).toBe("Tulsa");
  });

  it("formats annual revenue labels", () => {
    expect(formatAnnualRevenueLabel(org({ annualRevenue: 1_250_000, annualRevenueTaxPeriod: 2023 }))).toBe(
      "$1.3M (2023)",
    );
    expect(formatAnnualRevenueLabel(org({ annualRevenue: 0, annualRevenueTaxPeriod: 2023 }))).toBeNull();
  });

  it("formats organization hours from lines and intervals", () => {
    expect(formatHoursLines({ weekdayText: ["Monday 9-5", "Tuesday 10-4"] })).toEqual([
      "Monday 9-5",
      "Tuesday 10-4",
    ]);
    expect(
      formatHoursLines({
        periods: [
          { day: 1, openTime: "09:00", closeTime: "12:00" },
          { day: 1, openTime: "13:00", closeTime: "17:00" },
        ],
      }),
    ).toEqual(["Monday: 09:00 – 12:00, 13:00 – 17:00"]);
  });
});
