import { useState, useEffect, useRef } from "react";
import type { BoundaryMode } from "../../types/boundaries";
import type { AreaId, AreaKind } from "../../types/areas";
import { getCountyName } from "../../lib/countyBoundaries";
import { themeController } from "../imperative/theme";
import { CustomSelect } from "./CustomSelect";

interface AreaSelectionSnapshot {
  kind: AreaKind;
  selected: string[];
  pinned: string[];
}

interface BoundaryToolbarProps {
  boundaryMode?: BoundaryMode;
  selections: Record<AreaKind, AreaSelectionSnapshot | undefined>;
  hoveredArea?: AreaId | null;
  // Controls the sticky top offset class (e.g., "top-16" for below topbar, "top-0" inside overlays)
  stickyTopClass?: string;
  onBoundaryModeChange?: (mode: BoundaryMode) => void;
  onPinAreas?: (kind: AreaKind, ids: string[], pinned: boolean) => void;
  onHoverArea?: (area: AreaId | null) => void;
  onClearSelection?: (kind: AreaKind) => void;
  onExport?: () => void;
  onAddAreas?: (kind: AreaKind, ids: string[]) => void;
  onUpdateSelection?: (kind: AreaKind, selection: { selected: string[]; pinned: string[] }) => void;
}

const LINE_COLORS = ["#375bff", "#8f20f8", "#a76d44", "#b4a360"];

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
  selections,
  hoveredArea = null,
  stickyTopClass = "top-16",
  onBoundaryModeChange,
  onPinAreas,
  onHoverArea,
  onClearSelection,
  onExport,
  onAddAreas,
  onUpdateSelection,
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
  const hoveredZip = hoveredArea?.kind === "ZIP" ? hoveredArea.id : null;
  const hoveredCounty = hoveredArea?.kind === "COUNTY" ? hoveredArea.id : null;
  const pinnedZipSet = new Set(pinnedZips);
  const pinnedCountySet = new Set(pinnedCounties);
  const hasZipSelections = selectedZips.length > 0;
  const hasCountySelections = selectedCounties.length > 0;
  const hasSelections = hasZipSelections || hasCountySelections;
  const areaLabel = boundaryMode === "zips" ? "ZIP" : boundaryMode === "counties" ? "County" : "area";
  const areaPluralLabel = areaLabel === "County" ? "Counties" : `${areaLabel}s`;
  const inLineMode = selectedZips.length > 0 && selectedZips.length < 4;

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

  const submitZips = () => {
    const zips = parseZips(inputValue);
    if (zips.length > 0) {
      if (onAddAreas) onAddAreas("ZIP", zips);
      else onPinAreas?.("ZIP", zips, true);
    }
    setInputOpen(false);
    setInputValue("");
  };

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submitZips();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setInputOpen(false);
      setInputValue("");
    }
  };

  const removeZip = (zip: string) => {
    const remainingSelected = selectedZips.filter((z) => z !== zip);
    const remainingPinned = pinnedZips.filter((z) => z !== zip);
    if (onUpdateSelection) {
      onUpdateSelection("ZIP", { selected: remainingSelected, pinned: remainingPinned });
    } else {
      if (pinnedZipSet.has(zip)) onPinAreas?.("ZIP", [zip], false);
      onClearSelection?.("ZIP");
      if (remainingSelected.length > 0) {
        onAddAreas?.("ZIP", remainingSelected);
        if (remainingPinned.length > 0) onPinAreas?.("ZIP", remainingPinned, true);
      }
    }
  };

  const handleChipHover = (zip: string | null) => {
    if (zip) onHoverArea?.({ kind: "ZIP", id: zip });
    else if (hoveredZip) onHoverArea?.(null);
  };

  const pinnedCount = selectedZips.filter((z) => pinnedZipSet.has(z)).length;
  const allZipsPinned = selectedZips.length > 0 && pinnedCount === selectedZips.length;
  const showZipPinToggle = selectedZips.length >= 2;

  const removeCounty = (county: string) => {
    const remainingSelected = selectedCounties.filter((c) => c !== county);
    const remainingPinned = pinnedCounties.filter((c) => c !== county);
    if (onUpdateSelection) {
      onUpdateSelection("COUNTY", { selected: remainingSelected, pinned: remainingPinned });
    } else {
      if (pinnedCountySet.has(county)) onPinAreas?.("COUNTY", [county], false);
      onClearSelection?.("COUNTY");
      if (remainingSelected.length > 0) {
        onAddAreas?.("COUNTY", remainingSelected);
        if (remainingPinned.length > 0) onPinAreas?.("COUNTY", remainingPinned, true);
      }
    }
  };

  const handleCountyChipHover = (county: string | null) => {
    if (county) onHoverArea?.({ kind: "COUNTY", id: county });
    else if (hoveredCounty) onHoverArea?.(null);
  };

  const countyPinnedCount = selectedCounties.filter((c) => pinnedCountySet.has(c)).length;
  const allCountiesPinned = selectedCounties.length > 0 && countyPinnedCount === selectedCounties.length;
  const showCountyPinToggle = selectedCounties.length >= 2;

  const handleCountyPinAllClick = () => {
    if (selectedCounties.length === 0) return;
    const allPinned = selectedCounties.every((id) => pinnedCountySet.has(id));
    onPinAreas?.("COUNTY", selectedCounties, !allPinned);
  };

  const handlePinAllClick = () => {
    if (selectedZips.length === 0) return;
    onPinAreas?.("ZIP", selectedZips, !allZipsPinned);
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
    <div className={`sticky ${stickyTopClass} z-10 flex h-10 w-full items-center gap-3 border-b border-slate-200 bg-slate-100/70 px-4 text-sm text-slate-600 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300`}>
      {/* Chips and Add Button */}
      <div className="flex flex-1 items-center gap-2 overflow-x-auto self-center py-1 pl-0 pr-1">
        {/* Chips Container */}
        <div className="flex items-center gap-2">
          {sortedZips.map((zip) => {
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
                onMouseEnter={() => handleChipHover(zip)}
                onMouseLeave={() => handleChipHover(null)}
                onClick={() => removeZip(zip)}
              >
                <span>{zip}</span>
                <span className="ml-0.5 hidden text-brand-600 group-hover:inline">×</span>
              </button>
            );
          })}
          {sortedCounties.map((county) => {
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

            const label = getCountyName(county) ?? county;

            return (
              <button
                key={`county-${county}`}
                type="button"
                className={chipClasses}
                onMouseEnter={() => handleCountyChipHover(county)}
                onMouseLeave={() => handleCountyChipHover(null)}
                onClick={() => removeCounty(county)}
              >
                <span>{label}</span>
                <span className="ml-0.5 hidden text-brand-600 group-hover:inline">×</span>
              </button>
            );
          })}
        </div>

        {/* Add Button and Input */}
        <div className={`flex items-center gap-1 ${!hasSelections && !inputOpen ? "-ml-2" : ""}`}>
          <button
            ref={addBtnRef}
            type="button"
            onClick={() => setInputOpen(!inputOpen)}
            className={
              !hasSelections && !inputOpen
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
            {!hasSelections && !inputOpen && <span className="ml-1 whitespace-nowrap">add {areaPluralLabel}</span>}
          </button>

          <div ref={inputWrapperRef} className={inputOpen ? "" : "hidden"}>
            <textarea
              ref={inputRef}
              rows={1}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={`Add ${areaPluralLabel} (comma or space separated)`}
              className="ml-1 mt-1.5 h-7 min-h-[1.75rem] w-56 resize-none rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 shadow-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-300 dark:focus:ring-brand-800/50 md:w-64"
            />
          </div>

          {!hasSelections && !inputOpen && (
            <span className="whitespace-nowrap pl-2 text-xs font-medium text-slate-400 dark:text-slate-500">
              hold shift to select multiple map areas
            </span>
          )}

          {/* Pin All / Clear Pins Button */}
          {showZipPinToggle && (
            <button
              type="button"
              onClick={handlePinAllClick}
              className="ml-2 cursor-pointer whitespace-nowrap text-xs font-medium text-brand-400 hover:text-brand-600/90"
            >
              {allZipsPinned ? "clear pins" : "pin all"}
            </button>
          )}

          {showCountyPinToggle && (
            <button
              type="button"
              onClick={handleCountyPinAllClick}
              className="ml-2 cursor-pointer whitespace-nowrap text-xs font-medium text-brand-400 hover:text-brand-600/90"
            >
              {allCountiesPinned ? "clear county pins" : "pin all counties"}
            </button>
          )}

          {/* Clear Selection Button */}
          {hasSelections && (
            <button
              type="button"
              onClick={() => {
                onClearSelection?.("ZIP");
                onClearSelection?.("COUNTY");
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
              <span>clear selection (esc)</span>
            </button>
          )}
        </div>
      </div>

      {/* Right Side: Export and Boundary Selector */}
      <div className="ml-auto flex items-center gap-2">
        {/* Export Button */}
        {hasSelections && onExport && (
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
        <label className="flex items-center gap-2 font-medium" htmlFor="boundary-select">
          Areas
          <CustomSelect
            id="boundary-select"
            value={boundaryMode}
            options={[
              { value: "zips", label: "ZIPs" },
              { value: "counties", label: "Counties" },
              { value: "none", label: "None" }
            ]}
            onChange={(value) => onBoundaryModeChange?.(value as BoundaryMode)}
          />
        </label>
      </div>
    </div>
  );
};
