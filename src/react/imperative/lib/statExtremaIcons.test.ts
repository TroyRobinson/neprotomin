import { describe, expect, it } from "vitest";
import {
  createStatExtremeArrowImage,
  createStatExtremeCombinedImage,
  statExtremeCombinedIconId,
} from "./statExtremaIcons";

describe("statExtremaIcons", () => {
  it("builds stable combined icon ids", () => {
    expect(statExtremeCombinedIconId("good", "bad")).toBe("stat-extreme-combined-good-bad");
  });

  it("returns null outside browser canvas environments", () => {
    expect(createStatExtremeArrowImage("#000")).toBeNull();
    expect(createStatExtremeCombinedImage("#000", "#fff")).toBeNull();
  });
});
