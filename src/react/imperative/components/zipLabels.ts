import type maplibregl from "maplibre-gl";
import { formatStatValueCompact } from "../../../lib/format";
import { getZipCentroidsMap } from "../../../lib/zipCentroids";
import { CHOROPLETH_COLORS, TEAL_COLORS, getClassIndex } from "../../../lib/choropleth";
import { DEFAULT_POPULATION_STAT_ID } from "../../lib/domains";

interface ZipLabelsOptions {
  map: maplibregl.Map;
  getCentroidsMap?: () => Map<string, [number, number]>;
  labelForId?: (id: string) => string;
  stackedStatsMinZoom?: number;
  onHoverPillChange?: (payload: { areaId: string | null; pill: HoverStackPill | null }) => void;
  onPillClick?: (payload: { areaId: string; pill: HoverStackPill }) => void;
}

export type HoverPillTone = "good" | "bad" | "neutral";
export type HoverPillDirection = "up" | "down";

export interface HoverStackPill {
  key: string;
  label: string;
  tone: HoverPillTone;
  direction: HoverPillDirection;
  statId?: string;
  pairKey?: string;
}

export interface ZipLabelsController {
  setSelectedZips: (zips: string[], pinnedZips: string[]) => void;
  setHoveredZip: (zip: string | null) => void;
  setLinkedHoverPillsByArea: (rowsByArea: Map<string, HoverStackPill[]>) => void;
  setHoverPillsByArea: (rowsByArea: Map<string, HoverStackPill[]>) => void;
  setStatOverlay: (statId: string | null, statData: Record<string, number> | null, statType?: string) => void;
  setSecondaryStatOverlay: (statId: string | null, statData: Record<string, number> | null, statType?: string) => void;
  setTheme: (theme: "light" | "dark") => void;
  setVisible?: (visible: boolean) => void;
  destroy: () => void;
}

const defaultCentroids = (): Map<string, [number, number]> => getZipCentroidsMap();
// Keep hovered labels below top map controls (chips/menus use z-10) while
// still floating above nearby label stacks in the map layer.
const HOVERED_LABEL_Z_INDEX = 9;

const formatStatValue = (value: number, type: string = "count"): string => {
  return formatStatValueCompact(value, type);
};

export const createZipLabels = ({
  map,
  getCentroidsMap,
  labelForId,
  stackedStatsMinZoom = 0,
  onHoverPillChange,
  onPillClick,
}: ZipLabelsOptions): ZipLabelsController => {
  const resolveCentroids = getCentroidsMap ?? defaultCentroids;
  const idToLabel = labelForId || ((id: string) => id);
  const labelElements = new Map<string, HTMLElement>();
  let currentSelectedZips = new Set<string>();
  let currentPinnedZips = new Set<string>();
  let currentHoveredZip: string | null = null;
  let currentStatId: string | null = null;
  let currentStatData: Record<string, number> | null = null;
  let currentStatType: string = "count";
  let currentSecondaryStatId: string | null = null;
  let currentSecondaryData: Record<string, number> | null = null;
  let currentSecondaryStatType: string = "count";
  let currentHoverPillsByArea = new Map<string, HoverStackPill[]>();
  let currentLinkedHoverPillsByArea = new Map<string, HoverStackPill[]>();
  let currentTheme: "light" | "dark" = "light";
  let updatePositionHandler: (() => void) | null = null;
  let clearHoveredPillTimer: ReturnType<typeof setTimeout> | null = null;
  let hasActiveHoveredPill = false;
  let hoveredPillAreaId: string | null = null;
  let hoveredPillKey: string | null = null;
  let visible = true;
  let shouldShowStackedStats = map.getZoom() >= stackedStatsMinZoom;
  const labelFadeMs = 85;
  const labelFadeTransition = `opacity ${labelFadeMs}ms ease`;
  const rowPillTransition = `opacity ${labelFadeMs}ms ease, transform ${labelFadeMs}ms ease, background-color 120ms ease, border-color 120ms ease`;
  const rowPillExitMs = labelFadeMs;
  const hoveredTooltipBridgeMinWidthPx = 260;
  const hoveredTooltipBridgeCompactMinWidthPx = 220;
  const hoveredTooltipBridgeHeightPx = 24;

  const pillsEqual = (a: HoverStackPill[], b: HoverStackPill[]): boolean => {
    if (a.length !== b.length) return false;
    for (let index = 0; index < a.length; index += 1) {
      const left = a[index];
      const right = b[index];
      if (
        left.key !== right.key
        || left.label !== right.label
        || left.tone !== right.tone
        || left.direction !== right.direction
        || left.statId !== right.statId
        || left.pairKey !== right.pairKey
      ) {
        return false;
      }
    }
    return true;
  };
  const pillMapsEqual = (
    left: Map<string, HoverStackPill[]>,
    right: Map<string, HoverStackPill[]>,
  ): boolean => {
    if (left.size !== right.size) return false;
    for (const [area, leftRows] of left.entries()) {
      const rightRows = right.get(area);
      if (!rightRows || !pillsEqual(leftRows, rightRows)) return false;
    }
    return true;
  };

  const computeShouldShowStackedStats = (): boolean => map.getZoom() >= stackedStatsMinZoom;
  const removeLabelWithRowTransition = (
    element: HTMLElement,
    options?: { animateContainerFade?: boolean },
  ) => {
    const animateContainerFade = options?.animateContainerFade !== false;
    const shouldAnimateRows = element.dataset.extremaAnimateRows === "1";
    if (element.dataset.extremaExit === "1") return;
    if (!animateContainerFade && !shouldAnimateRows) {
      element.remove();
      return;
    }
    const rowPills = Array.from(element.querySelectorAll<HTMLElement>("[data-extrema-pill='1']"));
    element.dataset.extremaExit = "1";
    element.style.pointerEvents = "none";
    if (animateContainerFade) {
      element.style.transition = labelFadeTransition;
      element.style.opacity = "0";
    }
    if (shouldAnimateRows && rowPills.length > 0) {
      for (const rowPill of rowPills) {
        rowPill.style.pointerEvents = "none";
        rowPill.style.transition = rowPillTransition;
        rowPill.style.opacity = "0";
        rowPill.style.transform = "translateY(-2px)";
      }
    }
    const removeDelayMs = shouldAnimateRows && rowPills.length > 0
      ? Math.max(animateContainerFade ? labelFadeMs : 0, rowPillExitMs)
      : (animateContainerFade ? labelFadeMs : 0);
    if (removeDelayMs === 0) {
      element.remove();
      return;
    }
    window.setTimeout(() => {
      element.remove();
    }, removeDelayMs);
  };
  const emitHoveredPill = (areaId: string | null, pill: HoverStackPill | null) => {
    if (clearHoveredPillTimer !== null) {
      clearTimeout(clearHoveredPillTimer);
      clearHoveredPillTimer = null;
    }
    const nextPillKey = pill?.key ?? null;
    if (hoveredPillAreaId === areaId && hoveredPillKey === nextPillKey) return;
    hoveredPillAreaId = areaId;
    hoveredPillKey = nextPillKey;
    hasActiveHoveredPill = Boolean(areaId);
    onHoverPillChange?.({ areaId, pill });
  };
  const scheduleClearHoveredPill = () => {
    if (clearHoveredPillTimer !== null) clearTimeout(clearHoveredPillTimer);
    // Prevent flicker when moving between nearby pills in the same stack.
    clearHoveredPillTimer = setTimeout(() => {
      clearHoveredPillTimer = null;
      emitHoveredPill(null, null);
    }, 35);
  };
  const resolvePillFromElement = (
    target: Element | null,
  ): { areaId: string; pill: HoverStackPill } | null => {
    const rowPill = target?.closest<HTMLElement>("[data-extrema-pill='1']");
    if (!rowPill) return null;
    const areaId = rowPill.dataset.extremaAreaId ?? null;
    const pillKey = rowPill.dataset.extremaPillKey ?? null;
    if (!areaId || !pillKey) return null;
    const rows = currentHoverPillsByArea.get(areaId) ?? currentLinkedHoverPillsByArea.get(areaId) ?? [];
    const pill = rows.find((row) => row.key === pillKey) ?? null;
    if (!pill) return null;
    return { areaId, pill };
  };
  const resolveTooltipAreaFromElement = (target: Element | null): string | null => {
    const tooltip = target?.closest<HTMLElement>("[data-extrema-tooltip='1']");
    const areaId = tooltip?.dataset.extremaAreaId ?? null;
    return areaId;
  };
  const onContainerPointerOver = (event: PointerEvent) => {
    const nextHovered = resolvePillFromElement(event.target as Element | null);
    if (!nextHovered) {
      const tooltipArea = resolveTooltipAreaFromElement(event.target as Element | null);
      if (!tooltipArea) return;
      if (clearHoveredPillTimer !== null) {
        clearTimeout(clearHoveredPillTimer);
        clearHoveredPillTimer = null;
      }
      emitHoveredPill(tooltipArea, null);
      return;
    }
    if (clearHoveredPillTimer !== null) {
      clearTimeout(clearHoveredPillTimer);
      clearHoveredPillTimer = null;
    }
    emitHoveredPill(nextHovered.areaId, nextHovered.pill);
  };
  const onContainerPointerOut = (event: PointerEvent) => {
    const target = event.target as Element | null;
    const relatedTarget = (event.relatedTarget as Element | null) ?? null;
    const fromHovered = resolvePillFromElement(target);
    const fromTooltipArea = resolveTooltipAreaFromElement(target);
    const activeAreaId = fromHovered?.areaId ?? fromTooltipArea;
    if (!activeAreaId) return;
    const toHovered = resolvePillFromElement(relatedTarget);
    if (toHovered) {
      if (fromHovered && toHovered.areaId === fromHovered.areaId && toHovered.pill.key === fromHovered.pill.key) return;
      if (clearHoveredPillTimer !== null) {
        clearTimeout(clearHoveredPillTimer);
        clearHoveredPillTimer = null;
      }
      emitHoveredPill(toHovered.areaId, toHovered.pill);
      return;
    }
    const toTooltipArea = resolveTooltipAreaFromElement(relatedTarget);
    if (toTooltipArea && toTooltipArea === activeAreaId) {
      if (clearHoveredPillTimer !== null) {
        clearTimeout(clearHoveredPillTimer);
        clearHoveredPillTimer = null;
      }
      return;
    }
    // If the row under the pointer was recreated, relatedTarget can be null briefly.
    // Resolve from the live element under the cursor before clearing hover.
    const fromPointTarget = document.elementFromPoint(event.clientX, event.clientY);
    const fromPointHovered = resolvePillFromElement(fromPointTarget);
    if (fromPointHovered) {
      if (clearHoveredPillTimer !== null) {
        clearTimeout(clearHoveredPillTimer);
        clearHoveredPillTimer = null;
      }
      emitHoveredPill(fromPointHovered.areaId, fromPointHovered.pill);
      return;
    }
    const fromPointTooltipArea = resolveTooltipAreaFromElement(fromPointTarget);
    if (fromPointTooltipArea && fromPointTooltipArea === activeAreaId) return;
    if (!hasActiveHoveredPill) return;
    scheduleClearHoveredPill();
  };
  const onContainerPointerLeave = () => {
    if (!hasActiveHoveredPill) return;
    emitHoveredPill(null, null);
  };
  const onContainerClick = (event: MouseEvent) => {
    const hit = resolvePillFromElement(event.target as Element | null);
    if (!hit?.pill.statId) return;
    if (hit.pill.statId === currentStatId && currentStatId === DEFAULT_POPULATION_STAT_ID) return;
    event.preventDefault();
    event.stopPropagation();
    onPillClick?.({ areaId: hit.areaId, pill: hit.pill });
  };
  map.getContainer().addEventListener("pointerover", onContainerPointerOver, { passive: true });
  map.getContainer().addEventListener("pointerout", onContainerPointerOut, { passive: true });
  map.getContainer().addEventListener("pointerleave", onContainerPointerLeave, { passive: true });
  map.getContainer().addEventListener("click", onContainerClick);

  const createLabelElement = (
    zip: string,
    isSelected: boolean,
    isPinned: boolean,
    opts: {
      isDirectHovered: boolean;
      showBaseStack: boolean;
      hoverRows: HoverStackPill[];
      animateContainerFade?: boolean;
    },
  ): HTMLElement | null => {
    const centroid = resolveCentroids().get(zip);
    if (!centroid) return null;

    const [lng, lat] = centroid;
    const element = document.createElement("div");
    element.className = "absolute z-0 flex flex-col items-center";
    const animateContainerFade = opts.animateContainerFade !== false;
    if (animateContainerFade) {
      element.style.transition = labelFadeTransition;
      element.style.opacity = "0";
    } else {
      element.style.opacity = "1";
    }
    const shouldAnimateRowTransitions = !opts.isDirectHovered && !opts.showBaseStack;
    element.dataset.extremaAnimateRows = shouldAnimateRowTransitions ? "1" : "0";
    const baseTransform = "translate(-50%, -50%)";
    const isSelectedOrPinned = isSelected || isPinned;
    const hasPrimaryData = Boolean(currentStatId && currentStatData && zip in currentStatData);
    const hasSecondaryData = Boolean(currentSecondaryStatId && currentSecondaryData && (zip in currentSecondaryData));
    // Directly hovered area gets the full stat stack; selected/pinned areas stay zoom-gated.
    const shouldShowPrimaryStat =
      opts.showBaseStack && hasPrimaryData && (opts.isDirectHovered || (shouldShowStackedStats && isSelectedOrPinned));
    const shouldShowSecondary =
      opts.showBaseStack && hasSecondaryData && (opts.isDirectHovered || (shouldShowStackedStats && isSelectedOrPinned));

    const pillLabel = document.createElement("div");
    const hasStatOverlay = Boolean(currentStatId);
    const baseHeight = hasStatOverlay ? "h-6" : "h-5";
    const selectedHeight = hasStatOverlay && (isSelected || isPinned) ? "h-7" : baseHeight;
    const primaryPalette = (() => {
      if (!hasStatOverlay || !currentStatData || !(zip in currentStatData)) return null;
      const value = currentStatData[zip];
      const allValues = Object.values(currentStatData || {});
      const numericValues = allValues.filter(v => typeof v === "number" && Number.isFinite(v)) as number[];
      const min = numericValues.length > 0 ? Math.min(...numericValues) : 0;
      const max = numericValues.length > 0 ? Math.max(...numericValues) : 1;
      const colorIndex = getClassIndex(value, min, max, CHOROPLETH_COLORS.length);
      return {
        value,
        bg: CHOROPLETH_COLORS[colorIndex],
        text: colorIndex <= 2 ? "#000000" : "#ffffff",
      };
    })();

    const borderClass = currentTheme === "light" ? "border border-slate-900/80" : "border border-slate-300/90";
    const pillClassName = `
      ${selectedHeight} px-2 rounded-full font-medium text-xs flex items-center justify-center
      shadow-lg backdrop-blur-sm ${borderClass}
    `;
    const backgroundColor = currentTheme === "light" ? "#111827" : "#ffffff";
    const textColor = currentTheme === "light" ? "#ffffff" : "#111827";
    pillLabel.className = pillClassName;
    if (backgroundColor) pillLabel.style.backgroundColor = backgroundColor as any;
    if (textColor) pillLabel.style.color = textColor as any;

    const displayLabel = idToLabel(zip);

    pillLabel.textContent = displayLabel;
    element.className = "absolute z-0 flex flex-col items-center pointer-events-none";
    if (opts.isDirectHovered) {
      // Keep the active area's tooltip above neighboring extrema labels.
      element.style.zIndex = `${HOVERED_LABEL_Z_INDEX}`;
    }

    let primaryPill: HTMLDivElement | null = null;
    if (shouldShowPrimaryStat && primaryPalette) {
      primaryPill = document.createElement("div");
      primaryPill.className = "h-5 px-2 rounded-full font-medium text-xs flex items-center justify-center shadow-md";
      primaryPill.style.backgroundColor = primaryPalette.bg;
      primaryPill.style.color = primaryPalette.text;
      primaryPill.style.marginBottom = "-4px";
      primaryPill.style.zIndex = "0";
      primaryPill.textContent = formatStatValue(primaryPalette.value, currentStatType);
    }

    let secondaryPill: HTMLDivElement | null = null;
    if (shouldShowSecondary) {
      const secondaryVal = currentSecondaryData![zip];
      secondaryPill = document.createElement("div");
      const allValues = Object.values(currentSecondaryData || {});
      const numericValues = allValues.filter(v => typeof v === 'number' && Number.isFinite(v)) as number[];
      const min = numericValues.length > 0 ? Math.min(...numericValues) : 0;
      const max = numericValues.length > 0 ? Math.max(...numericValues) : 1;
      const classes = TEAL_COLORS.length;
      const colorIndex = getClassIndex(secondaryVal, min, max, classes);
      const backgroundColor = TEAL_COLORS[colorIndex];
      const isLightColor = colorIndex <= 2;
      const textColor = isLightColor ? '#64748b' : 'white';
      secondaryPill.className = "h-5 px-2 rounded-full font-medium text-xs flex items-center justify-center shadow-md";
      secondaryPill.style.backgroundColor = backgroundColor;
      secondaryPill.style.color = textColor as any;
      secondaryPill.style.marginBottom = "-4px";
      secondaryPill.style.zIndex = "0";
      secondaryPill.textContent = formatStatValue(secondaryVal, currentSecondaryStatType);
    }
    if (opts.showBaseStack) {
      // Keep stacked stat chips behind the area label for quick visual comparison.
      if (secondaryPill) element.appendChild(secondaryPill);
      if (primaryPill) element.appendChild(primaryPill);
      element.appendChild(pillLabel);
    }
    // Direct-hovered areas render extrema in a tooltip list so pointer travel doesn't leak to map areas below.
    const shouldUseHoveredDropdown = opts.isDirectHovered && opts.showBaseStack && opts.hoverRows.length > 0;
    const shouldUseLinkedCircle = !opts.showBaseStack && !opts.isDirectHovered;
    let hoverRowsContainer: HTMLElement = element;
    if (shouldUseHoveredDropdown) {
      const hasSelectableRows = opts.hoverRows.some(
        (row) => Boolean(row.statId && row.statId !== currentStatId),
      );
      const hoveredTooltipMinWidthPx = hasSelectableRows
        ? hoveredTooltipBridgeMinWidthPx
        : hoveredTooltipBridgeCompactMinWidthPx;
      const bridge = document.createElement("div");
      bridge.className = "absolute left-1/2 top-full -translate-x-1/2 pointer-events-auto";
      bridge.style.marginTop = "-2px";
      bridge.style.width = `max(100%, ${hoveredTooltipMinWidthPx}px)`;
      bridge.style.height = `${hoveredTooltipBridgeHeightPx}px`;
      bridge.style.background = "transparent";
      bridge.style.zIndex = "1";
      bridge.dataset.extremaTooltip = "1";
      bridge.dataset.extremaAreaId = zip;
      element.appendChild(bridge);

      const dropdown = document.createElement("div");
      dropdown.className = [
        "absolute left-1/2 top-full -translate-x-1/2 pointer-events-auto",
        "overflow-hidden rounded-md border border-slate-300/85 bg-white/95 shadow-md backdrop-blur-sm",
        "dark:border-slate-600/85 dark:bg-slate-900/95",
      ].join(" ");
      dropdown.style.marginTop = "8px";
      dropdown.style.zIndex = "2";
      dropdown.dataset.extremaTooltip = "1";
      dropdown.dataset.extremaAreaId = zip;
      // Summarize whether this hover stack contains highs, lows, or both.
      const hasHighestRows = opts.hoverRows.some((row) => row.direction === "up");
      const hasLowestRows = opts.hoverRows.some((row) => row.direction === "down");
      const dropdownTitleText = hasHighestRows && hasLowestRows
        ? "Highest/lowest"
        : hasHighestRows
          ? "Highest"
          : "Lowest";
      const dropdownTitle = document.createElement("div");
      dropdownTitle.className = [
        "px-2 py-1",
        "text-[9px] font-medium uppercase tracking-[0.1em]",
        "text-slate-300 dark:text-slate-600",
      ].join(" ");
      dropdownTitle.style.lineHeight = "1";
      dropdownTitle.textContent = dropdownTitleText;
      dropdown.appendChild(dropdownTitle);
      const dropdownList = document.createElement("div");
      dropdownList.className = "flex flex-col items-stretch";
      dropdown.appendChild(dropdownList);
      element.appendChild(dropdown);
      hoverRowsContainer = dropdownList;
    }

    for (const [index, row] of opts.hoverRows.entries()) {
      const rowPill = document.createElement("div");
      const canCloseToPopulation = Boolean(
        row.statId
        && currentStatId
        && row.statId === currentStatId
        && currentStatId !== DEFAULT_POPULATION_STAT_ID,
      );
      const canSelectDifferentStat = Boolean(row.statId && row.statId !== currentStatId);
      const isInteractive = canSelectDifferentStat || canCloseToPopulation;
      const isActiveHover = hoveredPillAreaId === zip && hoveredPillKey === row.key;
      let dropdownActionMeta: HTMLSpanElement | null = null;
      let dropdownActionLabel: HTMLSpanElement | null = null;
      if (shouldUseHoveredDropdown) {
        const interactiveClass = isInteractive
          ? "transition-colors duration-150 hover:bg-slate-100/95 dark:hover:bg-slate-800/95"
          : "";
        const activeClass = isInteractive && isActiveHover
          ? "bg-slate-100/95 dark:bg-slate-800/95"
          : "";
        rowPill.className = [
          "h-6 px-2 whitespace-nowrap",
          "font-medium text-[11px] leading-none flex items-center gap-1 justify-start",
          "text-slate-700 dark:text-slate-200",
          interactiveClass,
          activeClass,
        ].join(" ");
      } else if (shouldUseLinkedCircle) {
        const interactiveClass = isInteractive
          ? "transition-colors duration-150 hover:bg-slate-100 hover:border-slate-400 dark:hover:bg-slate-800 dark:hover:border-slate-400"
          : "";
        const activeClass = isInteractive && isActiveHover
          ? "bg-slate-100 border-slate-400 dark:bg-slate-800 dark:border-slate-400"
          : "";
        rowPill.className = [
          "h-6 w-6 rounded-full border border-slate-300/85 bg-white dark:border-slate-600/85 dark:bg-slate-900",
          "font-medium text-xs leading-none flex items-center justify-center shadow-md",
          interactiveClass,
          activeClass,
        ].join(" ");
      } else {
        const interactiveClass = isInteractive
          ? "transition-colors duration-150 hover:bg-slate-100 hover:border-slate-400 dark:hover:bg-slate-800 dark:hover:border-slate-400"
          : "";
        const activeClass = isInteractive && isActiveHover
          ? "bg-slate-100 border-slate-400 dark:bg-slate-800 dark:border-slate-400"
          : "";
        rowPill.className = [
          "h-5 px-2 rounded-full border border-slate-300/80 bg-white/70 whitespace-nowrap",
          "font-medium text-xs flex items-center gap-1.5 justify-center shadow-md",
          "text-slate-700 dark:border-slate-600/80 dark:bg-slate-900/70 dark:text-slate-200",
          interactiveClass,
          activeClass,
        ].join(" ");
      }
      // Keep rows stacked cleanly below one another (no overlap flicker/jitter).
      if (shouldUseHoveredDropdown) {
        rowPill.style.marginTop = "0";
        if (index > 0) {
          rowPill.style.borderTop =
            currentTheme === "light"
              ? "1px solid rgba(148, 163, 184, 0.45)"
              : "1px solid rgba(100, 116, 139, 0.55)";
        }
      } else if (shouldUseLinkedCircle) {
        rowPill.style.marginTop = index === 0 ? "0" : "2px";
      } else if (!opts.showBaseStack) {
        rowPill.style.marginTop = index === 0 ? "0" : "2px";
      } else {
        rowPill.style.marginTop = index === 0 ? "4px" : "2px";
      }
      // Allow direct hover on extrema rows while keeping the rest of the stack passthrough.
      rowPill.style.pointerEvents = "auto";
      rowPill.style.cursor = isInteractive ? "pointer" : "default";
      rowPill.style.width = "max-content";
      rowPill.style.maxWidth = "none";
      rowPill.style.overflowWrap = "normal";
      rowPill.style.wordBreak = "keep-all";
      rowPill.style.flexShrink = "0";
      if (shouldUseHoveredDropdown) {
        rowPill.style.width = "100%";
      } else if (shouldUseLinkedCircle) {
        rowPill.style.width = "24px";
        rowPill.style.maxWidth = "24px";
      }
      if (shouldAnimateRowTransitions) {
        rowPill.style.transition = rowPillTransition;
        rowPill.style.opacity = "0";
        rowPill.style.transform = "translateY(-2px)";
      }
      rowPill.dataset.extremaPill = "1";
      rowPill.dataset.extremaAreaId = zip;
      rowPill.dataset.extremaPillKey = row.key;

      const arrow = document.createElement("span");
      arrow.textContent = row.direction === "up" ? "▲" : "▼";
      arrow.style.fontWeight = "700";
      arrow.style.flexShrink = "0";
      arrow.style.fontSize = shouldUseLinkedCircle ? "11px" : "";
      arrow.style.color =
        row.tone === "good" ? "#6fc284" : row.tone === "bad" ? "#f15b41" : "#f8d837";

      rowPill.appendChild(arrow);
      if (!shouldUseLinkedCircle) {
        const text = document.createElement("span");
        text.textContent = row.label;
        text.style.whiteSpace = "nowrap";
        text.style.wordBreak = "keep-all";
        text.style.overflowWrap = "normal";
        text.style.flexShrink = "0";
        rowPill.appendChild(text);
        if (shouldUseHoveredDropdown && canSelectDifferentStat) {
          dropdownActionMeta = document.createElement("span");
          dropdownActionMeta.className = "ml-auto flex items-center gap-1.5 pl-2";
          dropdownActionLabel = document.createElement("span");
          dropdownActionLabel.textContent = "SELECT";
          dropdownActionLabel.className = "text-[9px] font-normal tracking-[0.02em] text-slate-400 dark:text-slate-500";
          dropdownActionLabel.style.whiteSpace = "nowrap";
          dropdownActionLabel.style.pointerEvents = "none";
          dropdownActionLabel.style.opacity = "0";
          dropdownActionLabel.style.transition = "opacity 100ms ease";
          dropdownActionMeta.appendChild(dropdownActionLabel);
          rowPill.appendChild(dropdownActionMeta);
        }
        if (canCloseToPopulation) {
          const closeIcon = document.createElement("span");
          closeIcon.textContent = "×";
          closeIcon.style.fontWeight = "700";
          closeIcon.style.opacity = "0.7";
          closeIcon.style.flexShrink = "0";
          if (shouldUseHoveredDropdown) {
            if (dropdownActionMeta) {
              dropdownActionMeta.prepend(closeIcon);
            } else {
              closeIcon.style.marginLeft = "auto";
              rowPill.appendChild(closeIcon);
            }
          } else {
            rowPill.appendChild(closeIcon);
          }
        }
      }
      if (shouldUseHoveredDropdown && canSelectDifferentStat && dropdownActionLabel) {
        const actionLabel = dropdownActionLabel;
        rowPill.addEventListener("pointerenter", () => {
          actionLabel.style.opacity = "1";
        }, { passive: true });
        rowPill.addEventListener("pointerleave", () => {
          actionLabel.style.opacity = "0";
        }, { passive: true });
        rowPill.addEventListener("pointerdown", () => {
          actionLabel.style.opacity = "1";
        }, { passive: true });
      }
      hoverRowsContainer.appendChild(rowPill);
      if (shouldAnimateRowTransitions) {
        requestAnimationFrame(() => {
          rowPill.style.opacity = "1";
          rowPill.style.transform = "translateY(0)";
        });
      }
    }

    const point = map.project([lng, lat]);
    element.style.left = `${point.x}px`;
    element.style.top = `${point.y}px`;
    // Keep the entire pill stack centered on the centroid.
    // `translate(-50%, -50%)` already centers the rendered stack box.
    element.style.transform = baseTransform;
    map.getContainer().appendChild(element);
    if (animateContainerFade) {
      requestAnimationFrame(() => {
        if (element.dataset.extremaExit !== "1") {
          element.style.opacity = "1";
        }
      });
    }
    return element;
  };

  const updateAllPositions = () => {
    const nextShouldShowStackedStats = computeShouldShowStackedStats();
    if (nextShouldShowStackedStats !== shouldShowStackedStats) {
      shouldShowStackedStats = nextShouldShowStackedStats;
      updateLabels();
      return;
    }
    for (const [zipCode, element] of labelElements) {
      const centroid = resolveCentroids().get(zipCode);
      if (!centroid) continue;
      const [lng, lat] = centroid;
      const point = map.project([lng, lat]);
      element.style.left = `${point.x}px`;
      element.style.top = `${point.y}px`;
    }
  };

  const updateLabels = (options?: { animateContainerFade?: boolean }) => {
    if (!visible) return;
    const animateContainerFade = options?.animateContainerFade !== false;
    shouldShowStackedStats = computeShouldShowStackedStats();
    for (const [_zip, element] of labelElements) {
      removeLabelWithRowTransition(element, { animateContainerFade });
    }
    labelElements.clear();
    const zipsToLabel = new Set([...currentSelectedZips, ...currentPinnedZips]);
    if (currentHoveredZip && !zipsToLabel.has(currentHoveredZip)) {
      zipsToLabel.add(currentHoveredZip);
    }
    for (const area of currentLinkedHoverPillsByArea.keys()) {
      if (!zipsToLabel.has(area)) zipsToLabel.add(area);
    }
    for (const zip of zipsToLabel) {
      const isSelected = currentSelectedZips.has(zip);
      const isPinned = currentPinnedZips.has(zip);
      const isDirectHovered = currentHoveredZip === zip;
      const linkedRows = currentLinkedHoverPillsByArea.get(zip) ?? [];
      const hasLinkedOnlyRows = linkedRows.length > 0 && !isDirectHovered;
      const hoverRows = isDirectHovered ? (currentHoverPillsByArea.get(zip) ?? []) : linkedRows;
      const element = createLabelElement(zip, isSelected, isPinned, {
        isDirectHovered,
        showBaseStack: !hasLinkedOnlyRows,
        hoverRows,
        animateContainerFade,
      });
      if (element) {
        labelElements.set(zip, element);
      }
    }
    if (updatePositionHandler) {
      map.off("move", updatePositionHandler);
      map.off("zoom", updatePositionHandler);
    }
    if (labelElements.size > 0) {
      updatePositionHandler = updateAllPositions;
      map.on("move", updatePositionHandler);
      map.on("zoom", updatePositionHandler);
    } else {
      updatePositionHandler = null;
    }
  };

  const setSelectedZips = (zips: string[], pinnedZips: string[]) => {
    const selectedSet = new Set(zips);
    const pinnedSet = new Set(pinnedZips);
    if (
      selectedSet.size === currentSelectedZips.size &&
      pinnedSet.size === currentPinnedZips.size &&
      [...selectedSet].every(z => currentSelectedZips.has(z)) &&
      [...pinnedSet].every(z => currentPinnedZips.has(z))
    ) {
      return;
    }
    currentSelectedZips = selectedSet;
    currentPinnedZips = pinnedSet;
    if (visible) updateLabels();
  };

  const setHoveredZip = (zip: string | null) => {
    if (currentHoveredZip === zip) return;
    currentHoveredZip = zip;
    if (visible) updateLabels();
  };

  const setLinkedHoverPillsByArea = (rowsByArea: Map<string, HoverStackPill[]>) => {
    if (pillMapsEqual(currentLinkedHoverPillsByArea, rowsByArea)) return;
    currentLinkedHoverPillsByArea = rowsByArea;
    // Linked extrema hover updates can fire rapidly while pointering rows;
    // skip container fade here to avoid tooltip flicker.
    if (visible) updateLabels({ animateContainerFade: false });
  };

  const setHoverPillsByArea = (rowsByArea: Map<string, HoverStackPill[]>) => {
    if (pillMapsEqual(currentHoverPillsByArea, rowsByArea)) return;
    currentHoverPillsByArea = rowsByArea;
    if (visible) updateLabels();
  };

  const setStatOverlay = (statId: string | null, statData: Record<string, number> | null, statType?: string) => {
    currentStatId = statId;
    currentStatData = statData;
    if (statType) currentStatType = statType;
    if (visible) updateLabels();
  };

  const setSecondaryStatOverlay = (statId: string | null, statData: Record<string, number> | null, statType?: string) => {
    currentSecondaryStatId = statId;
    currentSecondaryData = statData;
    if (statType) currentSecondaryStatType = statType;
    if (visible) updateLabels();
  };

  const setTheme = (theme: "light" | "dark") => {
    if (currentTheme === theme) return;
    currentTheme = theme;
    if (visible) updateLabels();
  };

  const setVisible = (v: boolean) => {
    if (visible === v) return;
    visible = v;
    if (!visible) {
      // Remove all elements and stop tracking
      if (updatePositionHandler) {
        map.off("move", updatePositionHandler);
        map.off("zoom", updatePositionHandler);
        updatePositionHandler = null;
      }
      for (const [, el] of labelElements) el.remove();
      labelElements.clear();
    } else {
      updateLabels();
    }
  };

  const destroy = () => {
    if (clearHoveredPillTimer !== null) {
      clearTimeout(clearHoveredPillTimer);
      clearHoveredPillTimer = null;
    }
    map.getContainer().removeEventListener("pointerover", onContainerPointerOver);
    map.getContainer().removeEventListener("pointerout", onContainerPointerOut);
    map.getContainer().removeEventListener("pointerleave", onContainerPointerLeave);
    map.getContainer().removeEventListener("click", onContainerClick);
    if (updatePositionHandler) {
      map.off("move", updatePositionHandler);
      map.off("zoom", updatePositionHandler);
    }
    for (const [_zip, element] of labelElements) {
      element.remove();
    }
    labelElements.clear();
  };

  return {
    setSelectedZips,
    setHoveredZip,
    setLinkedHoverPillsByArea,
    setHoverPillsByArea,
    setStatOverlay,
    setSecondaryStatOverlay,
    setTheme,
    setVisible,
    destroy,
  };
};
