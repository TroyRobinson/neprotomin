export type MobileSheetState = "peek" | "partial" | "expanded";

export const DEFAULT_TOP_BAR_HEIGHT = 64;
export const MOBILE_MAX_WIDTH_QUERY = "(max-width: 767px)";
export const MOBILE_SHEET_PEEK_HEIGHT = 136;
export const MOBILE_PARTIAL_MIN_MAP_RATIO = 0.05;
export const MOBILE_PARTIAL_TARGET_SHEET_HEIGHT = 560;
export const MOBILE_PARTIAL_MAP_HEIGHT_SCALE = 1;
export const MOBILE_PARTIAL_FOCUS_ANCHOR = 0.12;
export const MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MIN = 0.7;
export const MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MAX = 1;
export const MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MIN_HEIGHT = 640;
export const MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MAX_HEIGHT = 920;
export const MOBILE_SHEET_DRAG_THRESHOLD = 72;
export const MOBILE_TAP_THRESHOLD = 10;

export const calculateSheetPeekOffset = (
  viewportHeight: number,
  topBarHeight: number,
): number => Math.max(viewportHeight - topBarHeight - MOBILE_SHEET_PEEK_HEIGHT, 0);

export const calculateSheetPartialOffset = ({
  sheetAvailableHeight,
  sheetPeekOffset,
  viewportHeight,
}: {
  sheetAvailableHeight: number;
  sheetPeekOffset: number;
  viewportHeight: number;
}): number => {
  if (sheetPeekOffset <= 0) return 0;
  const minMapHeight = Math.round(Math.max(viewportHeight * MOBILE_PARTIAL_MIN_MAP_RATIO, 0));
  const desiredMapHeight = Math.max(
    minMapHeight,
    sheetAvailableHeight - MOBILE_PARTIAL_TARGET_SHEET_HEIGHT,
  );
  const baseMapHeight = Math.min(sheetPeekOffset, Math.max(desiredMapHeight, minMapHeight));
  const adjustedMapHeight = Math.min(
    sheetPeekOffset,
    Math.max(minMapHeight, Math.round(baseMapHeight * MOBILE_PARTIAL_MAP_HEIGHT_SCALE)),
  );
  return Math.max(0, adjustedMapHeight);
};

export const calculateMobilePartialFocusOffsetScale = (viewportHeight: number): number => {
  if (viewportHeight <= 0) return MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MAX;
  const minHeight = MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MIN_HEIGHT;
  const maxHeight = MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MAX_HEIGHT;
  if (maxHeight <= minHeight) return MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MAX;
  const clampedHeight = Math.min(Math.max(viewportHeight, minHeight), maxHeight);
  const progress = (clampedHeight - minHeight) / (maxHeight - minHeight);
  const range = MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MAX - MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MIN;
  return MOBILE_PARTIAL_FOCUS_OFFSET_SCALE_MAX - progress * range;
};

export const resolveSheetStateAfterDrag = (
  startState: MobileSheetState,
  delta: number,
  threshold = MOBILE_SHEET_DRAG_THRESHOLD,
): MobileSheetState => {
  if (startState === "expanded") return delta > threshold ? "peek" : "expanded";
  if (startState === "peek") return delta < -threshold ? "expanded" : "peek";
  if (delta < -threshold) return "expanded";
  if (delta > threshold) return "peek";
  return "partial";
};

export const calculateSheetTranslateY = ({
  isMobile,
  sheetState,
  sheetDragOffset,
  sheetPartialOffset,
  sheetPeekOffset,
}: {
  isMobile: boolean;
  sheetState: MobileSheetState;
  sheetDragOffset: number;
  sheetPartialOffset: number;
  sheetPeekOffset: number;
}): number => {
  if (!isMobile) return 0;
  if (sheetPeekOffset <= 0) return 0;
  if (sheetState === "expanded") {
    return Math.min(Math.max(sheetDragOffset, 0), sheetPeekOffset);
  }
  if (sheetState === "partial") {
    const maxDown = Math.max(0, sheetPeekOffset - sheetPartialOffset);
    const adjustment = Math.max(-sheetPartialOffset, Math.min(sheetDragOffset, maxDown));
    return sheetPartialOffset + adjustment;
  }
  const adjustment = Math.max(-sheetPeekOffset, Math.min(sheetDragOffset, 0));
  return sheetPeekOffset + adjustment;
};
