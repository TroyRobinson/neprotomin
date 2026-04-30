import { describe, expect, it } from "vitest";
import {
  calculateMobilePartialFocusOffsetScale,
  calculateSheetPartialOffset,
  calculateSheetPeekOffset,
  calculateSheetTranslateY,
  resolveSheetStateAfterDrag,
} from "./mobileSheet";

describe("mobileSheet", () => {
  it("calculates peek offset from viewport and top bar height", () => {
    expect(calculateSheetPeekOffset(800, 64)).toBe(600);
    expect(calculateSheetPeekOffset(100, 64)).toBe(0);
  });

  it("calculates a clamped partial offset", () => {
    expect(
      calculateSheetPartialOffset({
        sheetAvailableHeight: 736,
        sheetPeekOffset: 600,
        viewportHeight: 800,
      }),
    ).toBe(176);
    expect(
      calculateSheetPartialOffset({
        sheetAvailableHeight: 100,
        sheetPeekOffset: 0,
        viewportHeight: 800,
      }),
    ).toBe(0);
  });

  it("scales partial focus offset by viewport height", () => {
    expect(calculateMobilePartialFocusOffsetScale(0)).toBe(1);
    expect(calculateMobilePartialFocusOffsetScale(640)).toBe(1);
    expect(calculateMobilePartialFocusOffsetScale(920)).toBeCloseTo(0.7);
    expect(calculateMobilePartialFocusOffsetScale(780)).toBeCloseTo(0.85);
  });

  it("resolves sheet state after drag threshold crossings", () => {
    expect(resolveSheetStateAfterDrag("expanded", 80)).toBe("peek");
    expect(resolveSheetStateAfterDrag("expanded", 20)).toBe("expanded");
    expect(resolveSheetStateAfterDrag("peek", -80)).toBe("expanded");
    expect(resolveSheetStateAfterDrag("peek", -20)).toBe("peek");
    expect(resolveSheetStateAfterDrag("partial", -80)).toBe("expanded");
    expect(resolveSheetStateAfterDrag("partial", 80)).toBe("peek");
    expect(resolveSheetStateAfterDrag("partial", 20)).toBe("partial");
  });

  it("calculates sheet translate positions for each state", () => {
    expect(
      calculateSheetTranslateY({
        isMobile: false,
        sheetState: "peek",
        sheetDragOffset: 0,
        sheetPartialOffset: 176,
        sheetPeekOffset: 600,
      }),
    ).toBe(0);
    expect(
      calculateSheetTranslateY({
        isMobile: true,
        sheetState: "expanded",
        sheetDragOffset: 700,
        sheetPartialOffset: 176,
        sheetPeekOffset: 600,
      }),
    ).toBe(600);
    expect(
      calculateSheetTranslateY({
        isMobile: true,
        sheetState: "partial",
        sheetDragOffset: 500,
        sheetPartialOffset: 176,
        sheetPeekOffset: 600,
      }),
    ).toBe(600);
    expect(
      calculateSheetTranslateY({
        isMobile: true,
        sheetState: "peek",
        sheetDragOffset: -700,
        sheetPartialOffset: 176,
        sheetPeekOffset: 600,
      }),
    ).toBe(0);
  });
});
