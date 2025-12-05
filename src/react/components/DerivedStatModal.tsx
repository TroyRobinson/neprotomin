import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Category } from "../../types/organization";
import { CustomSelect } from "./CustomSelect";

export interface DerivedStatOption {
  id: string;
  name: string;
  label?: string | null;
  category: string;
}

export type DerivedFormulaKind = "percent" | "sum" | "difference" | "rate_per_1000" | "ratio" | "index" | "change_over_time";

export interface DerivedStatModalSubmit {
  name: string;
  label: string;
  category: Category | string;
  numeratorId: string;
  denominatorId: string;
  formula: DerivedFormulaKind;
  description?: string;
  // For change_over_time formula
  startYear?: string;
  endYear?: string;
}

interface DerivedStatModalProps {
  isOpen: boolean;
  stats: DerivedStatOption[];
  categories: string[];
  availableYears?: string[]; // Years available for the selected stat (for change_over_time)
  onClose: () => void;
  onSubmit: (payload: DerivedStatModalSubmit) => void;
  isSubmitting?: boolean;
  errorMessage?: string | null;
}

const defaultFormula: DerivedFormulaKind = "percent";

const formulaSymbol: Record<DerivedFormulaKind, string> = {
  percent: "÷",
  sum: "+",
  difference: "−",
  rate_per_1000: "÷",
  ratio: ":",
  index: "÷",
  change_over_time: "Δ",
};

const formulaDescription: Record<DerivedFormulaKind, string> = {
  percent: "(A ÷ B) as percentage",
  sum: "A + B",
  difference: "A − B",
  rate_per_1000: "(A ÷ B) × 1000",
  ratio: "A : B (simple division)",
  index: "(A ÷ B) × 100",
  change_over_time: "(End − Start) ÷ Start as %",
};

const formulaOptions: Array<{ value: DerivedFormulaKind; label: string; requiresTwoStats?: boolean }> = [
  { value: "percent", label: "Percentage", requiresTwoStats: true },
  { value: "sum", label: "Sum", requiresTwoStats: true },
  { value: "difference", label: "Difference", requiresTwoStats: true },
  { value: "rate_per_1000", label: "Rate per 1,000", requiresTwoStats: true },
  { value: "ratio", label: "Ratio", requiresTwoStats: true },
  { value: "index", label: "Index", requiresTwoStats: true },
  { value: "change_over_time", label: "Change Over Time", requiresTwoStats: false },
];

export const DerivedStatModal = ({
  isOpen,
  stats,
  categories,
  availableYears = [],
  onClose,
  onSubmit,
  isSubmitting = false,
  errorMessage,
}: DerivedStatModalProps) => {
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<string>("");
  const [numeratorId, setNumeratorId] = useState<string>("");
  const [denominatorId, setDenominatorId] = useState<string>("");
  const [formula, setFormula] = useState<DerivedFormulaKind>(defaultFormula);
  const [startYear, setStartYear] = useState<string>("");
  const [endYear, setEndYear] = useState<string>("");

  // Single-stat mode (for change_over_time)
  const isSingleStatMode = stats.length === 1;
  const singleStat = isSingleStatMode ? stats[0] : null;

  // Sorted years for dropdown
  const sortedYears = useMemo(() => [...availableYears].sort(), [availableYears]);

  useEffect(() => {
    if (!isOpen) return;
    setLabel("");
    setCategory(stats[0]?.category ?? "");
    // Default to change_over_time in single-stat mode, otherwise percent
    setFormula(isSingleStatMode ? "change_over_time" : defaultFormula);
    const [first, second] = stats;
    setNumeratorId(first?.id ?? "");
    const defaultDen = second && second.id !== first?.id ? second.id : stats.find((s) => s.id !== first?.id)?.id ?? "";
    setDenominatorId(defaultDen);
    // Initialize year selection
    if (sortedYears.length >= 2) {
      setStartYear(sortedYears[0]);
      setEndYear(sortedYears[sortedYears.length - 1]);
    } else {
      setStartYear("");
      setEndYear("");
    }
  }, [isOpen, stats, isSingleStatMode, sortedYears]);

  const numerator = useMemo(() => stats.find((s) => s.id === numeratorId), [stats, numeratorId]);
  const denominator = useMemo(() => stats.find((s) => s.id === denominatorId), [stats, denominatorId]);

  // Auto-generated name based on formula
  const generatedName = useMemo(() => {
    if (formula === "change_over_time") {
      if (!singleStat) return "";
      const statLabel = singleStat.label || singleStat.name;
      return `Derived: ${statLabel} Change (${startYear}–${endYear})`;
    }
    if (!numerator || !denominator) return "";
    const numLabel = numerator.label || numerator.name;
    const denLabel = denominator.label || denominator.name;
    const sym = formulaSymbol[formula];
    const suffix = formula === "rate_per_1000" ? " ×1000" : formula === "index" ? " ×100" : "";
    return `Derived: (${numLabel} ${sym} ${denLabel}${suffix})`;
  }, [numerator, denominator, formula, singleStat, startYear, endYear]);

  // Labels for A/B based on formula type
  const operandLabels = useMemo((): { a: string; b: string } => {
    switch (formula) {
      case "percent":
      case "rate_per_1000":
        return { a: "Numerator", b: "Denominator" };
      case "sum":
        return { a: "First stat", b: "Second stat" };
      case "difference":
        return { a: "Minuend (A)", b: "Subtrahend (B)" };
      case "ratio":
        return { a: "First value", b: "Second value" };
      case "index":
        return { a: "Value", b: "Reference" };
      case "change_over_time":
        return { a: "Start year", b: "End year" };
    }
  }, [formula]);

  // Auto-generated source
  const generatedSource = "Derived, Census";

  const nameRequired = !label.trim();
  const validationMessage = useMemo(() => {
    if (formula === "change_over_time") {
      if (!singleStat) return "Select a stat for change over time calculation.";
      if (!startYear || !endYear) return "Select both start and end years.";
      if (startYear >= endYear) return "End year must be after start year.";
      return null;
    }
    if (!numeratorId || !denominatorId) return "Select both numerator and denominator.";
    if (numeratorId === denominatorId) return "Numerator and denominator must be different stats.";
    return null;
  }, [formula, singleStat, startYear, endYear, numeratorId, denominatorId]);

  const isValid = !nameRequired && validationMessage === null;

  const handleSubmit = () => {
    if (!isValid || isSubmitting) return;
    onSubmit({
      name: generatedName,
      label: label.trim(),
      category: category || "",
      numeratorId: formula === "change_over_time" ? (singleStat?.id ?? "") : numeratorId,
      denominatorId: formula === "change_over_time" ? (singleStat?.id ?? "") : denominatorId,
      formula,
      description: generatedSource,
      startYear: formula === "change_over_time" ? startYear : undefined,
      endYear: formula === "change_over_time" ? endYear : undefined,
    });
  };

  const handleSwap = () => {
    if (!numeratorId || !denominatorId) return;
    setNumeratorId(denominatorId);
    setDenominatorId(numeratorId);
  };

  const categoryOptions = useMemo(() => {
    const opts = [{ value: "", label: "No category" }];
    for (const cat of categories) {
      opts.push({ value: cat, label: cat.charAt(0).toUpperCase() + cat.slice(1) });
    }
    return opts;
  }, [categories]);

  // Close on ESC key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  // Close on click outside
  const modalRef = useRef<HTMLDivElement>(null);
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node) && !isSubmitting) {
        onClose();
      }
    },
    [isSubmitting, onClose],
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-4"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className="w-full max-w-3xl rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Create derived stat</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Build a percent stat by dividing one stat by another and applying a friendly label.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" stroke="currentColor" fill="none">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid gap-6 px-6 py-5 sm:grid-cols-5">
          <div className="space-y-4 sm:col-span-3">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Derived stat name
              </label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={isSubmitting}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-400 focus:ring-1 focus:ring-brand-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50"
                placeholder="e.g. SNAP households %"
              />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Category
              </label>
              <div className="mt-1">
                <CustomSelect
                  value={category}
                  onChange={setCategory}
                  options={categoryOptions}
                  disabled={isSubmitting}
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40 sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Formula
            </p>
            <div className="relative mt-1">
              <select
                value={formula}
                onChange={(e) => setFormula(e.target.value as DerivedFormulaKind)}
                disabled={isSubmitting}
                className="h-8 w-full appearance-none rounded-lg border border-slate-300 bg-white pl-3 pr-8 text-sm text-slate-700 shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
              >
                {formulaOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400">
                <svg viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                </svg>
              </div>
            </div>
            <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">{formulaDescription[formula]}</p>
            
            {/* Year selection for change_over_time */}
            {formula === "change_over_time" ? (
              <div className="mt-4 space-y-3">
                {singleStat && (
                  <div className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                    <p className="font-medium">{singleStat.label || singleStat.name}</p>
                  </div>
                )}
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {operandLabels.a}
                  </label>
                  <div className="relative mt-1">
                    <select
                      value={startYear}
                      onChange={(e) => setStartYear(e.target.value)}
                      disabled={isSubmitting}
                      className="h-7 w-full appearance-none rounded-lg border border-slate-300 bg-white pl-3 pr-8 text-xs text-slate-700 shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-300 dark:focus:ring-brand-800/50"
                    >
                      {sortedYears.map((year) => (
                        <option key={year} value={year} disabled={year >= endYear}>
                          {year}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                      <svg viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </div>
                </div>
                <div className="flex justify-center">
                  <span className="text-lg text-slate-400">→</span>
                </div>
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {operandLabels.b}
                  </label>
                  <div className="relative mt-1">
                    <select
                      value={endYear}
                      onChange={(e) => setEndYear(e.target.value)}
                      disabled={isSubmitting}
                      className="h-7 w-full appearance-none rounded-lg border border-slate-300 bg-white pl-3 pr-8 text-xs text-slate-700 shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-300 dark:focus:ring-brand-800/50"
                    >
                      {sortedYears.map((year) => (
                        <option key={year} value={year} disabled={year <= startYear}>
                          {year}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                      <svg viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Standard two-stat operand selection */
              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {operandLabels.a}
                  </label>
                  <div className="relative mt-1">
                    <select
                      value={numeratorId}
                      onChange={(e) => setNumeratorId(e.target.value)}
                      disabled={isSubmitting}
                      className="h-7 w-full appearance-none rounded-lg border border-slate-300 bg-white pl-3 pr-8 text-xs text-slate-700 shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-300 dark:focus:ring-brand-800/50"
                    >
                      {stats.map((stat) => (
                        <option key={stat.id} value={stat.id}>
                          {stat.label || stat.name}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                      <svg viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </div>
                </div>
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={handleSwap}
                    disabled={isSubmitting}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-500"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6}>
                      <path d="M7 7h9m0 0l-3-3m3 3l-3 3M13 13H4m0 0l3 3m-3-3l3-3" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Swap
                  </button>
                </div>
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {operandLabels.b}
                  </label>
                  <div className="relative mt-1">
                    <select
                      value={denominatorId}
                      onChange={(e) => setDenominatorId(e.target.value)}
                      disabled={isSubmitting}
                      className="h-7 w-full appearance-none rounded-lg border border-slate-300 bg-white pl-3 pr-8 text-xs text-slate-700 shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-300 dark:focus:ring-brand-800/50"
                    >
                      {stats.map((stat) => (
                        <option key={stat.id} value={stat.id} disabled={stat.id === numeratorId}>
                          {stat.label || stat.name}
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-400 dark:text-slate-500">
                      <svg viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Preview of formula */}
            <div className="mt-4 rounded-lg bg-white px-3 py-2 text-xs text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
              {formula === "change_over_time" ? (
                singleStat && startYear && endYear ? (
                  <p>
                    Percent change in <strong>{singleStat.label || singleStat.name}</strong> from {startYear} to {endYear}
                  </p>
                ) : (
                  <p>Select a stat and year range.</p>
                )
              ) : numerator && denominator ? (
                <p>
                  {numerator.label || numerator.name} ÷ {denominator.label || denominator.name}
                </p>
              ) : (
                <p>Select two stats to build a formula.</p>
              )}
            </div>

            <p className="mt-4 text-[10px] text-slate-400 dark:text-slate-500">
              <span className="font-medium">Source:</span> {generatedSource}
            </p>
          </div>
        </div>

        {(validationMessage || errorMessage) && (
          <div className="px-6 text-xs text-rose-600 dark:text-rose-400">
            {validationMessage ?? errorMessage}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-70 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <div className="relative flex items-center">
            {nameRequired && !isSubmitting && (
              <span className="absolute -top-5 right-0 text-[10px] text-rose-500 dark:text-rose-400">Name is required</span>
            )}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!isValid || isSubmitting}
              className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
                isValid && !isSubmitting
                  ? "bg-brand-600 hover:bg-brand-500"
                  : "cursor-not-allowed bg-slate-400 dark:bg-slate-600"
              }`}
            >
              {isSubmitting && (
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
              )}
              <span>{isSubmitting ? "Creating…" : "Create stat"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
