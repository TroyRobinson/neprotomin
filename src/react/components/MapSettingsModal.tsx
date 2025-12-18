import React, { useEffect, useRef, useState } from "react";
import { clearPersistentStatsCache } from "../../lib/persistentStatsCache";

interface MapSettingsModalProps {
  open: boolean;
  onClose: () => void;
  rangeMode: "dynamic" | "scoped" | "global";
  onChangeRangeMode: (mode: "dynamic" | "scoped" | "global") => void;
}

export const MapSettingsModal: React.FC<MapSettingsModalProps> = ({
  open,
  onClose,
  rangeMode,
  onChangeRangeMode,
}) => {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [isClearingCache, setIsClearingCache] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) {
      window.addEventListener("keydown", onKey);
    }
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Map settings"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Map settings</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
            aria-label="Close"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="mt-4 space-y-3 text-sm text-slate-700 dark:text-slate-200">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
            <div className="font-medium text-slate-800 dark:text-slate-100">Choropleth range</div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Control how the legend range and colors are scaled.
            </p>
            <div className="mt-3 space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-transparent p-2 hover:border-slate-200 dark:hover:border-slate-700">
                <input
                  type="radio"
                  name="legend-range-mode"
                  className="mt-1 h-4 w-4"
                  checked={rangeMode === "dynamic"}
                  onChange={() => onChangeRangeMode("dynamic")}
                />
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-100">Dynamic (viewport ZIPs)</div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Use only ZIPs currently visible in the map window for min/max colors.
                  </p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-transparent p-2 hover:border-slate-200 dark:hover:border-slate-700">
                <input
                  type="radio"
                  name="legend-range-mode"
                  className="mt-1 h-4 w-4"
                  checked={rangeMode === "scoped"}
                  onChange={() => onChangeRangeMode("scoped")}
                />
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-100">Scoped (county + neighbors)</div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Use the dominant county plus neighboring counties regardless of viewport.
                  </p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-transparent p-2 hover:border-slate-200 dark:hover:border-slate-700">
                <input
                  type="radio"
                  name="legend-range-mode"
                  className="mt-1 h-4 w-4"
                  checked={rangeMode === "global"}
                  onChange={() => onChangeRangeMode("global")}
                />
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-100">No scoping (statewide)</div>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Use all available data statewide (ignore viewport or county focus) for the legend range.
                  </p>
                </div>
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
            <div className="font-medium text-slate-800 dark:text-slate-100">Data cache</div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Clears cached stat summaries/maps stored on this device.
            </p>
            <div className="mt-3">
              <button
                type="button"
                disabled={isClearingCache}
                onClick={async () => {
                  if (isClearingCache) return;
                  if (typeof window !== "undefined") {
                    const ok = window.confirm("Clear cached stat data on this device?");
                    if (!ok) return;
                  }
                  setIsClearingCache(true);
                  await clearPersistentStatsCache();
                  setIsClearingCache(false);
                }}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {isClearingCache ? "Clearing…" : "Clear cached data"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
