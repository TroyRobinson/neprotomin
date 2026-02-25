import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { CombinedDemographicsSnapshot, BreakdownGroup } from "../hooks/useDemographics";
import { getCountyIdByName } from "../../lib/countyCentroids";
import { MAP_TOUR_TARGETS } from "../imperative/constants/mapTourTargets";
import { MAP_TOUR_CLOSE_ADD_AREAS_EVENT } from "../imperative/constants/mapTourEvents";

type SupportedAreaKind = "ZIP" | "COUNTY";

interface SelectedAreaEntry {
  kind: SupportedAreaKind;
  id: string;
  label: string;
  color?: string;
}

interface DemographicsBarProps {
  snapshot: CombinedDemographicsSnapshot | null;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  onExport?: () => void;
  onClearAreas?: () => void;
  selectedAreas?: Partial<Record<SupportedAreaKind, string[]>>;
  activeAreaKind?: SupportedAreaKind | null;
  areaNameLookup?: (kind: SupportedAreaKind, code: string) => string;
  onRemoveArea?: (area: { kind: SupportedAreaKind; id: string }) => void;
  onAddAreas?: (kind: SupportedAreaKind, ids: string[]) => void;
  lineColorByAreaKey?: Map<string, string> | null;
}

interface BreakdownSegmentDisplay {
  key: string;
  label: string;
  colorToken: string;
  valuePercent: number;
}

const DEMOGRAPHICS_BAR_START_HEX = "#bae5f2";
const DEMOGRAPHICS_BAR_END_HEX = "#1e98ac";

const parseHexColor = (hex: string): { r: number; g: number; b: number } => {
  const normalized = hex.replace("#", "");
  if (!/^[\da-fA-F]{6}$/.test(normalized)) return { r: 0, g: 0, b: 0 };
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
};

const toHexChannel = (value: number): string =>
  Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");

const interpolateHexColor = (fromHex: string, toHex: string, ratio: number): string => {
  const from = parseHexColor(fromHex);
  const to = parseHexColor(toHex);
  const t = Math.max(0, Math.min(1, ratio));
  const r = from.r + (to.r - from.r) * t;
  const g = from.g + (to.g - from.g) * t;
  const b = from.b + (to.b - from.b) * t;
  return `#${toHexChannel(r)}${toHexChannel(g)}${toHexChannel(b)}`;
};

const getDemographicsSegmentColor = (index: number, total: number): string => {
  if (total <= 1) return DEMOGRAPHICS_BAR_END_HEX;
  const ratio = index / (total - 1);
  return interpolateHexColor(DEMOGRAPHICS_BAR_START_HEX, DEMOGRAPHICS_BAR_END_HEX, ratio);
};

const formatPopulation = (value: number | undefined): string => {
  if (!Number.isFinite(value || NaN)) return "—";
  const v = value as number;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(Math.abs(v) >= 10000 ? 0 : 1)}k`;
  return `${Math.round(v)}`;
};

const formatNumber = (value: number | undefined): string =>
  Number.isFinite(value || NaN) ? `${Math.round(value as number)}` : "—";

const formatPercent = (value: number | undefined): string =>
  Number.isFinite(value || NaN) ? `${Math.round(value as number)}%` : "—%";

const areaKey = (kind: SupportedAreaKind, id: string): string => `${kind}:${id}`;

interface SegmentBarProps {
  segments: BreakdownSegmentDisplay[];
  label?: string;
}

const SegmentBar = ({ segments, label }: SegmentBarProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null);

  let offset = 0;

  const updateTooltip = (text: string, event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) {
      setTooltip({ text, x: event.clientX, y: event.clientY });
      return;
    }
    setTooltip({ text, x: event.clientX - rect.left, y: event.clientY - rect.top });
  };

  return (
    <div ref={containerRef} className="relative h-5 w-full">
      <div className="relative h-full w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
        {label && (
          <div className="pointer-events-none absolute inset-y-0 left-1 z-10 flex items-center">
            <span className="px-2 py-[1px] text-[11px] font-medium uppercase leading-none text-slate-600 dark:text-slate-400 drop-shadow-[0_1px_1px_rgba(255,255,255,0.45)]">
              {label}
            </span>
          </div>
        )}
        {segments.map((seg, index) => {
          const width = Math.max(0, Math.min(100, Math.round(seg.valuePercent)));
          const left = offset;
          offset += width;
          if (width <= 0) return null;
          const fillColor = getDemographicsSegmentColor(index, segments.length);
          return (
            <div
              key={seg.key}
              className="absolute bottom-0 top-0"
              style={{ left: `${left}%`, width: `${width}%`, backgroundColor: fillColor }}
              onMouseEnter={(e) => updateTooltip(`${seg.label}: ${width}%`, e)}
              onMouseMove={(e) => updateTooltip(`${seg.label}: ${width}%`, e)}
              onMouseLeave={() => setTooltip(null)}
            />
          );
        })}
      </div>
      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-medium text-white shadow dark:bg-slate-200 dark:text-slate-900"
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y - 32}px`,
            transform: "translateX(-50%)",
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
};

const renderBreakdowns = (groups: Map<string, BreakdownGroup>) => {
  if (groups.size === 0) return null;
  return Array.from(groups.entries()).map(([key, group]) => {
    const displaySegments = group.segments.map((seg) => ({
      key: seg.key,
      label: seg.label,
      colorToken: seg.colorToken,
      valuePercent: seg.valuePercent,
    }));
    return (
      <div key={key} className="mt-2">
        <SegmentBar
          label={key.charAt(0).toUpperCase() + key.slice(1)}
          segments={displaySegments}
        />
      </div>
    );
  });
};

export const DemographicsBar = ({
  snapshot,
  expanded,
  onExpandedChange,
  onExport,
  onClearAreas,
  selectedAreas = {},
  activeAreaKind = null,
  areaNameLookup,
  onRemoveArea,
  onAddAreas,
  lineColorByAreaKey = null,
}: DemographicsBarProps) => {
  const isControlled = typeof expanded === "boolean";
  const [uncontrolledExpanded, setUncontrolledExpanded] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [showSelectedAreasTooltip, setShowSelectedAreasTooltip] = useState(false);
  const [selectedAreasTooltipMounted, setSelectedAreasTooltipMounted] = useState(false);
  const [addInputOpen, setAddInputOpen] = useState(false);
  const [addInputValue, setAddInputValue] = useState("");
  const closeSelectedAreasTooltipTimeoutRef = useRef<number | null>(null);
  const unmountSelectedAreasTooltipTimeoutRef = useRef<number | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);
  const isExpanded = isControlled ? (expanded as boolean) : uncontrolledExpanded;

  const setIsExpanded = useCallback(
    (next: boolean) => {
      if (isControlled) {
        onExpandedChange?.(next);
        return;
      }
      setUncontrolledExpanded(next);
    },
    [isControlled, onExpandedChange],
  );
  const snapshotKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!snapshot) {
      snapshotKeyRef.current = null;
      setIsExpanded(false);
      return;
    }
    const key = `${snapshot.label}|${snapshot.areaCount}|${snapshot.stats?.selectedCount ?? 0}|${snapshot.isMissing}`;
    const prevKey = snapshotKeyRef.current;
    snapshotKeyRef.current = key;
    if (prevKey === key || isExpanded) return;
    setIsExpanded(false);
  }, [snapshot, isExpanded, setIsExpanded]);

  if (!snapshot) {
    return (
      <div className="border-t-[0.5px] border-b-[0.5px] border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-400">
        Loading demographics…
      </div>
    );
  }

  const stats = snapshot.stats;
  const populationLabel = formatPopulation(stats?.population);
  const avgAgeLabel = formatNumber(stats?.avgAge);
  const marriedLabel = formatPercent(stats?.marriedPercent);
  const hasBreakdowns = snapshot.breakdowns.size > 0;
  const selectedCount = stats?.selectedCount ?? 0;
  const toggleExpanded = () => setIsExpanded(!isExpanded);
  const showSelectedPill = selectedCount > 1;
  const headerLabel = stats?.label ?? snapshot.label;
  const fullLabel = stats?.fullLabel ?? headerLabel;
  const showFullLabelTooltip = fullLabel !== headerLabel && !showSelectedPill;
  const selectedZips = selectedAreas.ZIP ?? [];
  const selectedCounties = selectedAreas.COUNTY ?? [];
  const hasAnySelectedAreas = selectedZips.length > 0 || selectedCounties.length > 0;
  const mixedKinds = !activeAreaKind && selectedZips.length > 0 && selectedCounties.length > 0;
  const addKind: SupportedAreaKind | null = activeAreaKind
    ?? (selectedCounties.length > 0 ? "COUNTY" : selectedZips.length > 0 ? "ZIP" : null);
  const showAddAreaTrigger = Boolean(onAddAreas && (addKind === "COUNTY" || addKind === "ZIP") && !showSelectedPill);
  const addAreaTriggerLabel = !hasAnySelectedAreas
    ? addKind === "ZIP"
      ? "focus to ZIP"
      : "focus to county"
    : addKind === "ZIP"
    ? "add ZIPs"
    : "add counties";

  const clearSelectedAreasTooltipClose = useCallback(() => {
    if (typeof window === "undefined") return;
    if (closeSelectedAreasTooltipTimeoutRef.current === null) return;
    window.clearTimeout(closeSelectedAreasTooltipTimeoutRef.current);
    closeSelectedAreasTooltipTimeoutRef.current = null;
  }, []);

  const scheduleSelectedAreasTooltipClose = useCallback(() => {
    if (typeof window === "undefined") {
      setShowSelectedAreasTooltip(false);
      return;
    }
    clearSelectedAreasTooltipClose();
    closeSelectedAreasTooltipTimeoutRef.current = window.setTimeout(() => {
      setShowSelectedAreasTooltip(false);
      closeSelectedAreasTooltipTimeoutRef.current = null;
    }, 500);
  }, [clearSelectedAreasTooltipClose]);

  const openSelectedAreasAddInput = useCallback(() => {
    clearSelectedAreasTooltipClose();
    setShowSelectedAreasTooltip(true);
    setAddInputOpen(true);
  }, [clearSelectedAreasTooltipClose]);
  // Keep tooltip list anchored to the active area kind; otherwise show all selected kinds.
  const selectedAreaEntries: SelectedAreaEntry[] = activeAreaKind
    ? (selectedAreas[activeAreaKind] ?? []).map((id) => {
        const label = areaNameLookup?.(activeAreaKind, id) || id;
        const color = lineColorByAreaKey?.get(areaKey(activeAreaKind, id));
        return { kind: activeAreaKind, id, label, color };
      })
    : [
        ...selectedZips.map((id) => {
          const label = areaNameLookup?.("ZIP", id) || id;
          const color = lineColorByAreaKey?.get(areaKey("ZIP", id));
          return {
            kind: "ZIP" as const,
            id,
            label: mixedKinds ? `ZIP ${label}` : label,
            color,
          };
        }),
        ...selectedCounties.map((id) => {
          const label = areaNameLookup?.("COUNTY", id) || id;
          const color = lineColorByAreaKey?.get(areaKey("COUNTY", id));
          return {
            kind: "COUNTY" as const,
            id,
            label: mixedKinds ? `County ${label}` : label,
            color,
          };
        }),
      ];

  useEffect(() => {
    if (selectedAreaEntries.length === 0 && !showAddAreaTrigger) {
      setShowSelectedAreasTooltip(false);
    }
  }, [selectedAreaEntries.length, showAddAreaTrigger]);

  useEffect(() => {
    if (typeof window === "undefined") {
      if (showSelectedAreasTooltip) setSelectedAreasTooltipMounted(true);
      return;
    }
    if (showSelectedAreasTooltip) {
      if (unmountSelectedAreasTooltipTimeoutRef.current !== null) {
        window.clearTimeout(unmountSelectedAreasTooltipTimeoutRef.current);
        unmountSelectedAreasTooltipTimeoutRef.current = null;
      }
      setSelectedAreasTooltipMounted(true);
      return;
    }

    unmountSelectedAreasTooltipTimeoutRef.current = window.setTimeout(() => {
      setSelectedAreasTooltipMounted(false);
      setAddInputOpen(false);
      setAddInputValue("");
      unmountSelectedAreasTooltipTimeoutRef.current = null;
    }, 140);
  }, [showSelectedAreasTooltip]);

  useEffect(() => {
    return () => {
      clearSelectedAreasTooltipClose();
      if (typeof window === "undefined") return;
      if (unmountSelectedAreasTooltipTimeoutRef.current === null) return;
      window.clearTimeout(unmountSelectedAreasTooltipTimeoutRef.current);
      unmountSelectedAreasTooltipTimeoutRef.current = null;
    };
  }, [clearSelectedAreasTooltipClose]);

  useEffect(() => {
    const closeAddAreasFromTour = () => {
      clearSelectedAreasTooltipClose();
      setShowSelectedAreasTooltip(false);
      setAddInputOpen(false);
      setAddInputValue("");
    };
    window.addEventListener(MAP_TOUR_CLOSE_ADD_AREAS_EVENT, closeAddAreasFromTour as EventListener);
    return () => {
      window.removeEventListener(MAP_TOUR_CLOSE_ADD_AREAS_EVENT, closeAddAreasFromTour as EventListener);
    };
  }, [clearSelectedAreasTooltipClose]);

  useEffect(() => {
    if (!showSelectedAreasTooltip || !addInputOpen) return;
    const rafId = requestAnimationFrame(() => {
      addInputRef.current?.focus();
      addInputRef.current?.select();
    });
    return () => cancelAnimationFrame(rafId);
  }, [addInputOpen, showSelectedAreasTooltip]);

  const parseZips = useCallback((raw: string): string[] => {
    const matches = raw.match(/\b\d{5}\b/g) || [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const value of matches) {
      if (seen.has(value)) continue;
      seen.add(value);
      out.push(value);
    }
    return out;
  }, []);

  const parseCounties = useCallback((raw: string): string[] => {
    const parts = raw
      .split(/[,;\n]+/)
      .map((value) => value.trim())
      .filter(Boolean);
    const seen = new Set<string>();
    const out: string[] = [];

    for (const part of parts) {
      let countyId: string | undefined;
      if (/^\d{5}$/.test(part)) {
        countyId = part;
      } else {
        const cleanName = part.replace(/\s+county$/i, "").trim();
        countyId = getCountyIdByName(cleanName);
      }
      if (!countyId || seen.has(countyId)) continue;
      seen.add(countyId);
      out.push(countyId);
    }

    return out;
  }, []);

  const submitAddAreas = useCallback(() => {
    if (!onAddAreas || !addKind) return;
    const ids = addKind === "ZIP" ? parseZips(addInputValue) : parseCounties(addInputValue);
    if (ids.length < 1) return;
    onAddAreas(addKind, ids);
    setAddInputOpen(false);
    setAddInputValue("");
  }, [addInputValue, addKind, onAddAreas, parseCounties, parseZips]);

  const handleHeaderKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    const isTypingTarget =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      Boolean(target?.isContentEditable);
    const isInteractiveChild =
      !!target &&
      target !== event.currentTarget &&
      !!target.closest("button, a, input, textarea, select, [role='button']");
    if (isInteractiveChild) return;
    if (isTypingTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleExpanded();
  };

  return (
    <div className="border-t-[0.5px] border-b-[0.5px] border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-300">
      <div
        role="button"
        tabIndex={0}
        className="w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        onClick={toggleExpanded}
        onKeyDown={handleHeaderKeyDown}
        aria-expanded={isExpanded}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="relative flex min-w-0 items-center gap-2">
            <span
              className="text-sm font-semibold text-slate-700 dark:text-slate-200"
              onMouseEnter={() => showFullLabelTooltip && setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
              title={showFullLabelTooltip ? fullLabel : undefined}
            >
              {headerLabel}
            </span>
            {(showSelectedPill || showAddAreaTrigger) && (
              <div
                className="relative inline-flex"
                onMouseEnter={() => {
                  clearSelectedAreasTooltipClose();
                  if (selectedAreaEntries.length > 0 || showAddAreaTrigger) setShowSelectedAreasTooltip(true);
                }}
                onMouseLeave={scheduleSelectedAreasTooltipClose}
              >
                <div className="inline-flex items-center gap-1">
                  {showSelectedPill && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-brand-600 bg-brand-500 pl-2 pr-1 py-[2px] text-[10px] font-medium text-white shadow-sm dark:border-brand-400">
                      <span>{selectedCount} selected</span>
                      {onClearAreas && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onClearAreas();
                          }}
                          className="inline-flex items-center justify-center rounded-full p-0.5 transition-colors hover:bg-brand-600 dark:hover:bg-brand-400/30"
                          aria-label="Clear all selections"
                          title="Clear all selections"
                        >
                          <svg
                            viewBox="0 0 16 16"
                            fill="currentColor"
                            className="h-3 w-3"
                            aria-hidden="true"
                          >
                            <path d="M4.28 3.22a.75.75 0 00-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 101.06 1.06L8 9.06l3.72 3.72a.75.75 0 101.06-1.06L9.06 8l3.72-3.72a.75.75 0 00-1.06-1.06L8 6.94 4.28 3.22z" />
                          </svg>
                        </button>
                      )}
                    </span>
                  )}
                  {showAddAreaTrigger && (
                    <span
                      data-ne-tour-target={MAP_TOUR_TARGETS.sidebarAddAreas}
                      role="button"
                      tabIndex={0}
                      className="inline-flex cursor-pointer items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-[2px] text-[9px] font-normal uppercase tracking-wide text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                      onMouseEnter={openSelectedAreasAddInput}
                      onClick={(event) => {
                        event.stopPropagation();
                        openSelectedAreasAddInput();
                      }}
                      onFocus={openSelectedAreasAddInput}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        event.stopPropagation();
                        openSelectedAreasAddInput();
                      }}
                    >
                      {addAreaTriggerLabel}
                    </span>
                  )}
                </div>
                {(showSelectedAreasTooltip || selectedAreasTooltipMounted) && (selectedAreaEntries.length > 0 || showAddAreaTrigger) && (
                  <div
                    className={`absolute left-0 top-6 z-20 min-w-44 max-w-80 rounded-lg border border-slate-300 bg-white p-2 shadow-lg transition-opacity duration-[120ms] ease-out dark:border-slate-700 dark:bg-slate-900 ${
                      showSelectedAreasTooltip
                        ? "opacity-100"
                        : "opacity-0 pointer-events-none"
                    }`}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Selected Areas
                      </div>
                      {onAddAreas && addKind && (
                        <button
                          type="button"
                          onClick={() => openSelectedAreasAddInput()}
                          className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 bg-white/70 text-slate-500 transition-colors hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400"
                          title={`Add ${addKind === "ZIP" ? "ZIPs" : "Counties"}`}
                          aria-label={`Add ${addKind === "ZIP" ? "ZIPs" : "Counties"}`}
                        >
                          <svg
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            className="h-3.5 w-3.5"
                            aria-hidden="true"
                          >
                            <path
                              fillRule="evenodd"
                              d="M9 3.5a5.5 5.5 0 013.894 9.394l3.703 3.703a.75.75 0 11-1.06 1.06l-3.703-3.703A5.5 5.5 0 119 3.5zm0 1.5a4 4 0 100 8 4 4 0 000-8z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      )}
                    </div>
                    {onAddAreas && addKind && addInputOpen && (
                      <div className="mb-2">
                        <input
                          ref={addInputRef}
                          type="text"
                          value={addInputValue}
                          onChange={(event) => setAddInputValue(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              event.stopPropagation();
                              submitAddAreas();
                            } else if (event.key === "Escape") {
                              event.preventDefault();
                              event.stopPropagation();
                              setAddInputOpen(false);
                              setAddInputValue("");
                            }
                          }}
                          placeholder={
                            addKind === "ZIP"
                              ? "Add ZIPs (comma/space)"
                              : "Add counties (name or FIPS)"
                          }
                          className="h-7 w-full rounded border border-slate-300 bg-white px-2 text-[11px] text-slate-700 shadow-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-300 dark:focus:ring-brand-800/50"
                        />
                        {!hasAnySelectedAreas && (
                          <div className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                            or shift+click areas on map
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {selectedAreaEntries.map((area) => (
                        <button
                          key={`${area.kind}:${area.id}`}
                          type="button"
                          className={`group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            area.color
                              ? "hover:brightness-95 dark:hover:brightness-110"
                              : "border-slate-300 bg-white/80 text-slate-600 hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300"
                          }`}
                          style={
                            area.color
                              ? {
                                  borderColor: area.color,
                                  color: area.color,
                                  backgroundColor: `${area.color}1a`,
                                }
                              : undefined
                          }
                          onClick={(event) => {
                            event.stopPropagation();
                            onRemoveArea?.({ kind: area.kind, id: area.id });
                          }}
                          title={`Remove ${area.label}`}
                        >
                          <span>{area.label}</span>
                          <span className="ml-0.5 hidden text-brand-600 group-hover:inline">×</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {showTooltip && showFullLabelTooltip && (
              <div className="pointer-events-none absolute left-0 top-6 z-10 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] font-medium text-white shadow dark:bg-slate-200 dark:text-slate-900">
                {fullLabel}
              </div>
            )}
          </div>
          <div className="mt-[2px] flex flex-shrink-0 items-center gap-3">
            {onExport && hasAnySelectedAreas && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onExport();
                }}
                className="inline-flex items-center whitespace-nowrap rounded bg-slate-200/70 px-2 py-0.5 text-[10px] font-medium text-slate-500 transition-colors hover:bg-slate-300/70 dark:bg-slate-800/70 dark:text-slate-400 dark:hover:bg-slate-700/70"
              >
                export csv
              </button>
            )}
            <span
              data-ne-tour-target={MAP_TOUR_TARGETS.sidebarDemographicsExpand}
              className={`inline-flex h-5 w-5 items-center justify-center text-slate-400 transition-transform dark:text-slate-500 ${
                isExpanded ? "rotate-180" : ""
              }`}
              aria-hidden="true"
            >
              <svg
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden="true"
                className="h-5 w-5 stroke-current stroke-[1.75]"
              >
                <path d="M6 8.5l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 overflow-x-auto whitespace-nowrap text-slate-400 dark:text-slate-500">
          <span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-400">Population:</span> {populationLabel}
          </span>
          <span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-400">Avg Age:</span> {avgAgeLabel}
          </span>
          <span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-400">Married:</span> {marriedLabel}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-3">
          {snapshot.isMissing ? (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Data unavailable for this area. Try selecting different areas or check back later.
            </p>
          ) : hasBreakdowns ? (
            <div className="space-y-3 pb-2">{renderBreakdowns(snapshot.breakdowns)}</div>
          ) : (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Demographic breakdowns are missing right now. They will appear here once real data is loaded.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
