import { describe, expect, it } from "vitest";
import {
  formatAreasModeLabel,
  formatStatChipLabel,
  getExportCsvAreasUnavailableHelpText,
  getShowingSummaryState,
} from "./categoryChipText";

describe("categoryChipText", () => {
  it("formats areas mode labels", () => {
    expect(formatAreasModeLabel("auto")).toBe("Zoom");
    expect(formatAreasModeLabel("zips")).toBe("ZIPs");
    expect(formatAreasModeLabel("counties")).toBe("Counties");
    expect(formatAreasModeLabel("none")).toBe("None");
  });

  it("derives showing summary state", () => {
    expect(
      getShowingSummaryState({
        areasMode: "auto",
        orgsVisible: false,
        extremasVisible: false,
      }),
    ).toEqual({
      hasSpecificSelection: false,
      hasOrgs: false,
      hasExtremas: false,
      trailingSegments: [],
    });

    expect(
      getShowingSummaryState({
        areasMode: "zips",
        orgsVisible: true,
        extremasVisible: true,
      }),
    ).toEqual({
      hasSpecificSelection: true,
      hasOrgs: true,
      hasExtremas: true,
      trailingSegments: ["Zips"],
    });
  });

  it("keeps CSV unavailable help text stable", () => {
    expect(getExportCsvAreasUnavailableHelpText()).toContain("Advanced Stats mode");
  });

  it("formats stat chip labels for compact desktop chips", () => {
    expect(formatStatChipLabel("Population")).toBe("Population");
    expect(formatStatChipLabel("LongSingleWordStatistic")).toBe("LongSingleWordStatistic");
    expect(formatStatChipLabel("Median household income")).toBe("Median house ...");
    expect(formatStatChipLabel("Food insecurity")).toBe("Food insec ...");
    expect(formatStatChipLabel("   ")).toBe("   ");
  });
});
