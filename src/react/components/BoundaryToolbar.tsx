import { useState, useEffect, useRef } from "react";
import type { BoundaryMode } from "../../types/boundaries";
import type { AreaId, AreaKind } from "../../types/areas";
import { themeController } from "../imperative/theme";
import { getAreaRegistryEntry } from "../imperative/areas/registry";
import { CustomSelect } from "./CustomSelect";
import { getCountyIdByName } from "../../lib/countyCentroids";

interface AreaSelectionSnapshot {
  kind: AreaKind;
  selected: string[];
  pinned: string[];
}

type BoundaryControlMode = "auto" | "manual";

interface BoundaryToolbarProps {
  boundaryMode?: BoundaryMode;
  boundaryControlMode?: BoundaryControlMode;
  selections: Record<AreaKind, AreaSelectionSnapshot | undefined>;
  hoveredArea?: AreaId | null;
  // Controls the sticky top offset class (e.g., "top-16" for below topbar, "top-0" inside overlays)
  stickyTopClass?: string;
  onBoundaryModeChange?: (mode: BoundaryMode) => void;
  onBoundaryControlModeChange?: (mode: BoundaryControlMode) => void;
  onHoverArea?: (area: AreaId | null) => void;
  onExport?: () => void;
  onUpdateSelection: (kind: AreaKind, selection: { selected: string[]; pinned: string[] }) => void;
  hideAreaSelect?: boolean;
  isMobile?: boolean;
}

const LINE_COLORS = ["#375bff", "#8f20f8", "#a76d44", "#b4a360"];
const areaEntryByKind = {
  ZIP: getAreaRegistryEntry("ZIP"),
  COUNTY: getAreaRegistryEntry("COUNTY"),
} as const;
const areaDisplayByKind: Record<AreaKind, { singular: string; plural: string }> = {
  ZIP: { singular: "ZIP", plural: "ZIPs" },
  COUNTY: { singular: "County", plural: "Counties" },
  TRACT: { singular: "Tract", plural: "Tracts" },
};
const boundaryModeToAreaKind: Record<BoundaryMode, AreaKind | null> = {
  zips: "ZIP",
  counties: "COUNTY",
  none: null,
};

function shade(hex: string, amount: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (!m) return hex;
  const r = parseInt(m[1], 16),
    g = parseInt(m[2], 16),
    b = parseInt(m[3], 16);
  const adj = (c: number) => (amount >= 0 ? c + (255 - c) * amount : c + c * amount);
  return (
    "#" +
    clamp(adj(r)).toString(16).padStart(2, "0") +
    clamp(adj(g)).toString(16).padStart(2, "0") +
    clamp(adj(b)).toString(16).padStart(2, "0")
  );
}

export const BoundaryToolbar = ({
  boundaryMode = "zips",
  boundaryControlMode = "auto",
  selections,
  hoveredArea = null,
  stickyTopClass = "top-16",
  onBoundaryModeChange,
  onBoundaryControlModeChange,
  onHoverArea,
  onExport,
  onUpdateSelection,
  hideAreaSelect = false,
  isMobile = false,
}: BoundaryToolbarProps) => {
  const [inputOpen, setInputOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [isDark, setIsDark] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const inputWrapperRef = useRef<HTMLDivElement>(null);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  const zipSelection = selections.ZIP ?? { kind: "ZIP" as AreaKind, selected: [], pinned: [] };
  const countySelection = selections.COUNTY ?? { kind: "COUNTY" as AreaKind, selected: [], pinned: [] };

  const selectedZips = zipSelection.selected;
  const pinnedZips = zipSelection.pinned;
  const selectedCounties = countySelection.selected;
  const pinnedCounties = countySelection.pinned;
  const hoveredZip = null;
  const hoveredCounty = null;
  const pinnedZipSet = new Set(pinnedZips);
  const pinnedCountySet = new Set(pinnedCounties);
  const activeAreaKind = boundaryModeToAreaKind[boundaryMode] ?? null;
  const areaDisplay = activeAreaKind ? areaDisplayByKind[activeAreaKind] : null;
  const areaLabel = areaDisplay?.singular ?? "area";
  const areaPluralLabel = areaDisplay?.plural ?? "areas";

  const isActiveZip = activeAreaKind === "ZIP";
  const isActiveCounty = activeAreaKind === "COUNTY";
  const activeSelections = isActiveZip ? selectedZips : isActiveCounty ? selectedCounties : [];
  const activePinnedSet = isActiveZip ? pinnedZipSet : isActiveCounty ? pinnedCountySet : new Set<string>();
  const activeSelectedCount = activeSelections.length;
  const activePinnedCount = activeSelections.filter((id) => activePinnedSet.has(id)).length;
  const activeHasSelections = activeSelectedCount > 0;
  const allPinned = activeHasSelections && activePinnedCount === activeSelectedCount;

  const inLineMode = isActiveZip && selectedZips.length > 0 && selectedZips.length < 4;

  useEffect(() => {
    const unsubscribe = themeController.subscribe((theme) => {
      setIsDark(theme === "dark");
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (inputOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [inputOpen]);

  useEffect(() => {
    const handlePointerDown = (e: PointerEvent) => {
      if (!inputOpen) return;
      const target = e.target as Node | null;
      if (!target) return;
      if (
        !inputWrapperRef.current?.contains(target) &&
        !addBtnRef.current?.contains(target)
      ) {
        setInputOpen(false);
        setInputValue("");
      }
    };
    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [inputOpen]);

  const parseZips = (raw: string): string[] => {
    const matches = raw.match(/\b\d{5}\b/g) || [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of matches) {
      if (!seen.has(m)) {
        seen.add(m);
        out.push(m);
      }
    }
    return out;
  };

  // Parse counties by name or FIPS code
  const parseCounties = (raw: string): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];

    // Split by common delimiters (comma, semicolon, newline)
    const parts = raw.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);

    for (const part of parts) {
      let countyId: string | undefined;

      // Try as FIPS code (5 digits)
      if (/^\d{5}$/.test(part)) {
        countyId = part;
      } else {
        // Try as county name (remove "County" suffix if present)
        const cleanName = part.replace(/\s+county$/i, '').trim();
        countyId = getCountyIdByName(cleanName);
      }

      if (countyId && !seen.has(countyId)) {
        seen.add(countyId);
        out.push(countyId);
      }
    }

    return out;
  };

  const submitZips = () => {
    const zips = parseZips(inputValue);
    if (zips.length > 0) {
      const merged = [...selectedZips];
      const seen = new Set(merged);
      for (const zip of zips) {
        if (!seen.has(zip)) {
          merged.push(zip);
          seen.add(zip);
        }
      }
      const nextPinned = pinnedZips.filter((zip) => seen.has(zip));
      onUpdateSelection("ZIP", { selected: merged, pinned: nextPinned });
    }
    setInputOpen(false);
    setInputValue("");
  };

  const submitCounties = () => {
    const counties = parseCounties(inputValue);
    if (counties.length > 0) {
      const merged = [...selectedCounties];
      const seen = new Set(merged);
      for (const county of counties) {
        if (!seen.has(county)) {
          merged.push(county);
          seen.add(county);
        }
      }
      const nextPinned = pinnedCounties.filter((county) => seen.has(county));
      onUpdateSelection("COUNTY", { selected: merged, pinned: nextPinned });
    }
    setInputOpen(false);
    setInputValue("");
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (isActiveZip) {
        submitZips();
      } else if (isActiveCounty) {
        submitCounties();
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setInputOpen(false);
      setInputValue("");
    }
  };

  // Remove a chip id while keeping selected/pinned arrays aligned.
  const updateSelectionWithout = (
    kind: AreaKind,
    id: string,
    selected: string[],
    pinned: string[],
  ) => {
    const remainingSelected = selected.filter((value) => value !== id);
    const remainingPinned = pinned.filter((value) => value !== id);
    onUpdateSelection(kind, { selected: remainingSelected, pinned: remainingPinned });
  };

  const handleAreaChipHover = (kind: AreaKind, id: string | null) => {
    if (id) {
      onHoverArea?.({ kind, id });
    } else if (hoveredArea?.kind === kind && hoveredArea.id) {
      onHoverArea?.(null);
    }
  };

  // Pin or unpin every id for a given kind in one shot.
  const togglePinAll = (kind: AreaKind, selected: string[], shouldPinAll: boolean) => {
    if (selected.length === 0) return;
    const nextPinned = shouldPinAll ? [...selected] : [];
    onUpdateSelection(kind, { selected: [...selected], pinned: nextPinned });
  };

  // Build color mapping by selection order
  const colorByZip = new Map<string, string>();
  if (inLineMode) {
    selectedZips.forEach((z, i) => colorByZip.set(z, LINE_COLORS[i % LINE_COLORS.length]));
  }

  // Sort: pinned first, then unpinned
  const pinned = selectedZips.filter((zip) => pinnedZipSet.has(zip)).sort();
  const unpinned = selectedZips.filter((zip) => !pinnedZipSet.has(zip)).sort();
  const sortedZips = [...pinned, ...unpinned];

  const countyPinned = selectedCounties.filter((id) => pinnedCountySet.has(id)).sort();
  const countyUnpinned = selectedCounties.filter((id) => !pinnedCountySet.has(id)).sort();
  const sortedCounties = [...countyPinned, ...countyUnpinned];

  return (
    <div
      className={`sticky ${stickyTopClass} z-10 flex h-10 w-full items-center gap-3 border-b border-slate-200 bg-slate-100/70 px-4 text-sm text-slate-600 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300`}
    >
      {/* Chips and Add Button */}
      <div
        className={`flex flex-1 items-center gap-2 overflow-x-auto self-center py-1 pl-0 pr-1 ${
          isMobile ? "no-scrollbar" : ""
        }`}
        style={isMobile ? { scrollbarWidth: "none" } : undefined}
      >
        {/* Chips Container */}
        <div className="flex items-center gap-2">
          {isActiveZip &&
            sortedZips.map((zip) => {
            const isPinned = pinnedZipSet.has(zip);
            const isHovered = hoveredZip === zip;
            let chipStyle: React.CSSProperties = {};
            let chipClasses =
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors group";

            if (inLineMode) {
              const col = colorByZip.get(zip);
              if (col) {
                const bg = isDark ? shade(col, -0.82) : shade(col, 0.85);
                const border = isDark ? shade(col, -0.35) : shade(col, 0.55);
                chipStyle = {
                  backgroundColor: bg,
                  borderColor: border,
                  color: col,
                };
              }
            } else {
              chipClasses += isPinned
                ? " border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-400/60 dark:bg-brand-400/10 dark:text-brand-200"
                : " border-slate-300 bg-white/70 text-slate-600 hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300";
            }

            if (isHovered) {
              chipClasses += " ring-1 ring-brand-300";
            }

            return (
              <button
                key={zip}
                type="button"
                className={chipClasses}
                style={chipStyle}
                onMouseEnter={() => handleAreaChipHover("ZIP", zip)}
                onMouseLeave={() => handleAreaChipHover("ZIP", null)}
                onClick={() => updateSelectionWithout("ZIP", zip, selectedZips, pinnedZips)}
              >
                <span>{zip}</span>
                <span className="ml-0.5 hidden text-brand-600 group-hover:inline">×</span>
              </button>
            );
          })}
          {isActiveCounty &&
            sortedCounties.map((county) => {
            const isPinned = pinnedCountySet.has(county);
            const isHovered = hoveredCounty === county;
            let chipClasses =
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors group";

            chipClasses += isPinned
              ? " border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-400/60 dark:bg-brand-400/10 dark:text-brand-200"
              : " border-slate-300 bg-white/70 text-slate-600 hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300";

            if (isHovered) {
              chipClasses += " ring-1 ring-brand-300";
            }

            const label = areaEntryByKind.COUNTY.getLabel(county);

            return (
              <button
                key={`county-${county}`}
                type="button"
                className={chipClasses}
                onMouseEnter={() => handleAreaChipHover("COUNTY", county)}
                onMouseLeave={() => handleAreaChipHover("COUNTY", null)}
                onClick={() => updateSelectionWithout("COUNTY", county, selectedCounties, pinnedCounties)}
              >
                <span>{label}</span>
                <span className="ml-0.5 hidden text-brand-600 group-hover:inline">×</span>
              </button>
            );
          })}
        </div>

          {/* Add Button and Input */}
        <div className={`flex items-center gap-1 ${!activeHasSelections && !inputOpen ? "-ml-2" : ""}`}>
          <button
            ref={addBtnRef}
            type="button"
            onClick={() => setInputOpen(!inputOpen)}
            className={
              !activeHasSelections && !inputOpen
                ? "inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white/70 px-2.5 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300"
                : "inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white/70 text-slate-500 transition-colors hover:border-brand-300 hover:text-brand-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-400"
            }
            title={`Add ${areaLabel}`}
            aria-label={`Add ${areaLabel}`}
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              className="h-3.5 w-3.5 translate-x-[0.2px] -translate-y-[0.2px]"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M9 3.5a5.5 5.5 0 013.894 9.394l3.703 3.703a.75.75 0 11-1.06 1.06l-3.703-3.703A5.5 5.5 0 119 3.5zm0 1.5a4 4 0 100 8 4 4 0 000-8z"
                clipRule="evenodd"
              />
            </svg>
            {!activeHasSelections && !inputOpen && <span className="ml-1 whitespace-nowrap">add {areaPluralLabel}</span>}
          </button>

          <div ref={inputWrapperRef} className={inputOpen && activeAreaKind ? "" : "hidden"}>
            <textarea
              ref={inputRef}
              rows={1}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={
                isActiveZip
                  ? `Add ${areaPluralLabel} (comma or space separated)`
                  : `Add ${areaPluralLabel} (by name or FIPS code)`
              }
              className="ml-1 mt-1.5 h-7 min-h-[1.75rem] w-56 resize-none rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-300 dark:focus:ring-brand-800/50 md:w-64"
            />
          </div>

          {!activeHasSelections && !inputOpen && (
            <span className="whitespace-nowrap pl-2 text-xs font-medium text-slate-400 dark:text-slate-500">
              hold shift to select multiple map areas
            </span>
          )}

          {activeSelectedCount >= 2 && activeHasSelections && (
            <button
              type="button"
              onClick={() => {
                const shouldPinAll = !allPinned;
                if (isActiveZip) {
                  togglePinAll("ZIP", selectedZips, shouldPinAll);
                } else if (isActiveCounty) {
                  togglePinAll("COUNTY", selectedCounties, shouldPinAll);
                }
              }}
              className="ml-2 cursor-pointer whitespace-nowrap text-xs font-medium text-brand-400 hover:text-brand-600/90"
            >
              {allPinned ? "clear pins" : "pin all"}
            </button>
          )}

          {activeHasSelections && (
            <button
              type="button"
              onClick={() => {
                if (isActiveZip) {
                  onUpdateSelection("ZIP", { selected: [], pinned: [] });
                } else if (isActiveCounty) {
                  onUpdateSelection("COUNTY", { selected: [], pinned: [] });
                }
              }}
              className="ml-3 inline-flex cursor-pointer items-center gap-1 whitespace-nowrap text-xs font-medium text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            >
              <svg
                viewBox="0 0 16 16"
                fill="currentColor"
                className="h-3 w-3"
                aria-hidden="true"
              >
                <path d="M4.28 3.22a.75.75 0 00-1.06 1.06L6.94 8l-3.72 3.72a.75.75 0 101.06 1.06L8 9.06l3.72 3.72a.75.75 0 101.06-1.06L9.06 8l3.72-3.72a.75.75 0 00-1.06-1.06L8 6.94 4.28 3.22z" />
              </svg>
              <span>clear all (esc)</span>
            </button>
          )}
        </div>
      </div>

      {/* Right Side: Export and Boundary Selector */}
      <div className="ml-auto flex items-center gap-2">
        {/* Export Button */}
        {activeHasSelections && onExport && !isMobile && (
          <button
            type="button"
            onClick={onExport}
            onMouseEnter={(e) => (e.currentTarget.textContent = "export (CSV report)")}
            onMouseLeave={(e) => (e.currentTarget.textContent = "export")}
            className="inline-flex cursor-pointer items-center whitespace-nowrap rounded bg-slate-200/60 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-300/60 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:bg-slate-700/60"
          >
            export
          </button>
        )}

        {/* Areas Selector */}
        {!hideAreaSelect && (
          <label className="flex items-center gap-2 font-medium" htmlFor="boundary-select">
            Areas
            <CustomSelect
              id="boundary-select"
              value={boundaryControlMode === "auto" ? "auto" : boundaryMode}
              options={[
                { value: "zips", label: "ZIPs" },
                { value: "counties", label: "Counties" },
                { value: "auto", label: "Control by zoom" },
                { value: "none", label: "None" }
              ]}
              onChange={(value) => {
                if (value === "auto") {
                  onBoundaryControlModeChange?.("auto");
                  return;
                }
                const cast = value as BoundaryMode;
                onBoundaryControlModeChange?.("manual");
                onBoundaryModeChange?.(cast);
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
};
