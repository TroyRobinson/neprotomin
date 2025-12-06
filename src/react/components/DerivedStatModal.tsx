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
  // For sum formula with multiple operands
  sumOperandIds?: string[];
}

interface DerivedStatModalProps {
  isOpen: boolean;
  stats: DerivedStatOption[];
  categories: string[];
  availableYears?: string[]; // Legacy: years for a single selected stat
  availableYearsByStat?: Record<string, string[]>; // Years per stat id for change_over_time
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
  sum: "A + B + C + … (any number of stats)",
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

// Threshold for showing fuzzy-search vs simple dropdown
const FUZZY_SEARCH_THRESHOLD = 5;

// Simple fuzzy match for stat filtering
const fuzzyMatch = (text: string, query: string): boolean => {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase().trim();
  if (!lowerQuery) return true;
  // Check if all query words appear somewhere in the text
  const words = lowerQuery.split(/\s+/);
  return words.every((word) => lowerText.includes(word));
};

// Searchable stat selector component
interface StatSearchSelectProps {
  stats: DerivedStatOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  disabledId?: string; // ID to disable (e.g. the other operand)
  placeholder?: string;
}

const StatSearchSelect = ({
  stats,
  value,
  onChange,
  disabled = false,
  disabledId,
  placeholder = "Search stats...",
}: StatSearchSelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedStat = useMemo(() => stats.find((s) => s.id === value), [stats, value]);

  const filteredStats = useMemo(() => {
    if (!query.trim()) return stats;
    return stats.filter((stat) => {
      const searchText = `${stat.label || ""} ${stat.name} ${stat.category}`;
      return fuzzyMatch(searchText, query);
    });
  }, [stats, query]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  const handleSelect = (id: string) => {
    onChange(id);
    setIsOpen(false);
    setQuery("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      setQuery("");
    } else if (e.key === "Enter" && filteredStats.length === 1) {
      e.preventDefault();
      handleSelect(filteredStats[0].id);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!disabled) {
            setIsOpen(!isOpen);
            setTimeout(() => inputRef.current?.focus(), 0);
          }
        }}
        disabled={disabled}
        className="flex h-7 w-full items-center justify-between rounded-lg border border-slate-300 bg-white pl-3 pr-2 text-left text-xs text-slate-700 shadow-sm transition hover:border-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
      >
        <span className="truncate">
          {selectedStat ? selectedStat.label || selectedStat.name : "Select stat..."}
        </span>
        <svg className="h-3 w-3 shrink-0 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[220px] rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900">
          <div className="border-b border-slate-100 p-2 dark:border-slate-800">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="h-7 w-full rounded border border-slate-200 bg-slate-50 px-2 text-xs text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {filteredStats.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-400">No matching stats</div>
            ) : (
              filteredStats.map((stat) => {
                const isDisabled = stat.id === disabledId;
                return (
                  <button
                    key={stat.id}
                    type="button"
                    onClick={() => !isDisabled && handleSelect(stat.id)}
                    disabled={isDisabled}
                    className={`flex w-full flex-col items-start px-3 py-1.5 text-left text-xs transition ${
                      stat.id === value
                        ? "bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"
                        : isDisabled
                        ? "cursor-not-allowed text-slate-300 dark:text-slate-600"
                        : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                    }`}
                  >
                    <span className="font-medium">{stat.label || stat.name}</span>
                    {stat.label && stat.label !== stat.name && (
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">{stat.name}</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const DerivedStatModal = ({
  isOpen,
  stats,
  categories,
  availableYears = [],
  availableYearsByStat,
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
  // For sum formula: list of operand stat IDs (minimum 2)
  const [sumOperandIds, setSumOperandIds] = useState<string[]>([]);
  const isSingleStatMode = stats.length === 1;

  // Years for the currently selected base stat (numerator) in change_over_time mode
  const yearsForBaseStat = useMemo(() => {
    const baseYearsFromMap = availableYearsByStat?.[numeratorId];
    if (baseYearsFromMap && baseYearsFromMap.length) {
      return [...baseYearsFromMap].sort();
    }
    if (availableYears && availableYears.length) {
      return [...availableYears].sort();
    }
    return [] as string[];
  }, [availableYearsByStat, availableYears, numeratorId]);

  // Use fuzzy-search mode when many stats (passed all stats, not pre-selected)
  const useFuzzySearch = stats.length > FUZZY_SEARCH_THRESHOLD;

  useEffect(() => {
    if (!isOpen) return;
    setLabel("");
    setCategory(stats[0]?.category ?? "");
    // Default to change_over_time in single-stat mode, otherwise percent
    setFormula(isSingleStatMode ? "change_over_time" : defaultFormula);

    // In fuzzy-search mode, don't pre-select numerator/denominator - user must search
    if (useFuzzySearch) {
      setNumeratorId("");
      setDenominatorId("");
    } else {
      const [first, second] = stats;
      const firstId = first?.id ?? "";
      setNumeratorId(firstId);
      const defaultDen =
        second && second.id !== firstId ? second.id : stats.find((s) => s.id !== firstId)?.id ?? "";
      setDenominatorId(defaultDen);
    }
    // For sum formula: always initialize with ALL selected stats (regardless of fuzzy mode)
    setSumOperandIds(stats.map((s) => s.id));
  }, [isOpen, stats, isSingleStatMode, useFuzzySearch]);

  // Initialize / reset year range whenever the base stat or formula changes
  useEffect(() => {
    if (!isOpen || formula !== "change_over_time") return;
    if (yearsForBaseStat.length >= 2) {
      setStartYear(yearsForBaseStat[0]);
      setEndYear(yearsForBaseStat[yearsForBaseStat.length - 1]);
    } else {
      setStartYear("");
      setEndYear("");
    }
  }, [isOpen, formula, yearsForBaseStat]);

  const numerator = useMemo(() => stats.find((s) => s.id === numeratorId), [stats, numeratorId]);
  const denominator = useMemo(() => stats.find((s) => s.id === denominatorId), [stats, denominatorId]);

  // Resolved sum operand stats
  const sumOperands = useMemo(
    () => sumOperandIds.map((id) => stats.find((s) => s.id === id)).filter(Boolean) as DerivedStatOption[],
    [sumOperandIds, stats],
  );

  // Auto-generated name based on formula
  const generatedName = useMemo(() => {
    if (formula === "change_over_time") {
      if (!numerator || !startYear || !endYear) return "";
      const statLabel = numerator.label || numerator.name;
      return `Derived: ${statLabel} Change (${startYear}–${endYear})`;
    }
    // Sum formula with multiple operands
    if (formula === "sum") {
      if (sumOperands.length < 2) return "";
      const labels = sumOperands.map((s) => s.label || s.name);
      return `Derived: (${labels.join(" + ")})`;
    }
    if (!numerator || !denominator) return "";
    const numLabel = numerator.label || numerator.name;
    const denLabel = denominator.label || denominator.name;
    const sym = formulaSymbol[formula];
    const suffix = formula === "rate_per_1000" ? " ×1000" : formula === "index" ? " ×100" : "";
    return `Derived: (${numLabel} ${sym} ${denLabel}${suffix})`;
  }, [numerator, denominator, formula, startYear, endYear, sumOperands]);

  // Labels for A/B based on formula type
  const operandLabels = useMemo((): { a: string; b: string } => {
    switch (formula) {
      case "percent":
      case "rate_per_1000":
        return { a: "Numerator", b: "Denominator" };
      case "sum":
        return { a: "Stats to sum", b: "" };
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
      if (!numeratorId || !numerator) return "Select a stat for change over time calculation.";
      if (!startYear || !endYear) return "Select both start and end years.";
      if (startYear >= endYear) return "End year must be after start year.";
      return null;
    }
    // Sum formula validation
    if (formula === "sum") {
      if (sumOperandIds.length < 2) return "Select at least two stats to sum.";
      const uniqueIds = new Set(sumOperandIds);
      if (uniqueIds.size !== sumOperandIds.length) return "Each stat can only be added once.";
      return null;
    }
    if (!numeratorId || !denominatorId) return "Select both numerator and denominator.";
    if (numeratorId === denominatorId) return "Numerator and denominator must be different stats.";
    return null;
  }, [formula, numeratorId, numerator, startYear, endYear, denominatorId, sumOperandIds]);

  const isValid = !nameRequired && validationMessage === null;

  const handleSubmit = () => {
    if (!isValid || isSubmitting) return;
    onSubmit({
      name: generatedName,
      label: label.trim(),
      category: category || "",
      numeratorId: formula === "sum" ? sumOperandIds[0] ?? "" : numeratorId,
      denominatorId: formula === "change_over_time" ? numeratorId : formula === "sum" ? sumOperandIds[1] ?? "" : denominatorId,
      formula,
      description: generatedSource,
      startYear: formula === "change_over_time" ? startYear : undefined,
      endYear: formula === "change_over_time" ? endYear : undefined,
      sumOperandIds: formula === "sum" ? sumOperandIds : undefined,
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
            
            {/* Year + base stat selection for change_over_time */}
            {formula === "change_over_time" ? (
              <div className="mt-4 space-y-3">
                {stats.length > 1 ? (
                  <div>
                    <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Base stat
                    </label>
                    <div className="mt-1">
                      {useFuzzySearch ? (
                        <StatSearchSelect
                          stats={stats}
                          value={numeratorId}
                          onChange={setNumeratorId}
                          disabled={isSubmitting}
                          placeholder="Search base stat..."
                        />
                      ) : (
                        <div className="relative">
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
                      )}
                    </div>
                  </div>
                ) : (
                  numerator && (
                    <div className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700 dark:bg-brand-900/30 dark:text-brand-300">
                      <p className="font-medium">{numerator.label || numerator.name}</p>
                    </div>
                  )
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
                      {yearsForBaseStat.map((year) => (
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
                      {yearsForBaseStat.map((year) => (
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
            ) : formula === "sum" ? (
              /* Sum formula: dynamic list of operands */
              <div className="mt-4 space-y-2">
                <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Stats to sum
                </label>
                {sumOperandIds.map((opId, index) => {
                  const selectedIdsExceptThis = sumOperandIds.filter((_, i) => i !== index);
                  return (
                    <div key={index} className="flex items-center gap-2">
                      <span className="w-5 text-center text-xs text-slate-400">{index + 1}.</span>
                      <div className="flex-1">
                        {stats.length > FUZZY_SEARCH_THRESHOLD ? (
                          <StatSearchSelect
                            stats={stats}
                            value={opId}
                            onChange={(newId) => {
                              setSumOperandIds((prev) => prev.map((id, i) => (i === index ? newId : id)));
                            }}
                            disabled={isSubmitting}
                            disabledId={undefined}
                            placeholder={`Search stat ${index + 1}...`}
                          />
                        ) : (
                          <div className="relative">
                            <select
                              value={opId}
                              onChange={(e) => {
                                const newId = e.target.value;
                                setSumOperandIds((prev) => prev.map((id, i) => (i === index ? newId : id)));
                              }}
                              disabled={isSubmitting}
                              className="h-7 w-full appearance-none rounded-lg border border-slate-300 bg-white pl-3 pr-8 text-xs text-slate-700 shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:focus:border-brand-300 dark:focus:ring-brand-800/50"
                            >
                              <option value="">Select stat...</option>
                              {stats.map((stat) => (
                                <option
                                  key={stat.id}
                                  value={stat.id}
                                  disabled={selectedIdsExceptThis.includes(stat.id)}
                                >
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
                        )}
                      </div>
                      {/* Remove button - only show if more than 2 operands */}
                      {sumOperandIds.length > 2 && (
                        <button
                          type="button"
                          onClick={() => setSumOperandIds((prev) => prev.filter((_, i) => i !== index))}
                          disabled={isSubmitting}
                          className="flex h-6 w-6 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                          title="Remove"
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4 10a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H4.75A.75.75 0 014 10z" clipRule="evenodd" />
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
                {/* Add another stat button */}
                <button
                  type="button"
                  onClick={() => setSumOperandIds((prev) => [...prev, ""])}
                  disabled={isSubmitting || sumOperandIds.length >= stats.length}
                  className="mt-1 inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:border-slate-400 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:text-slate-400 dark:hover:border-slate-500 dark:hover:text-slate-300"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                  </svg>
                  Add another stat
                </button>
              </div>
            ) : (
              /* Standard two-stat operand selection - use fuzzy search when many stats */
              <div className="mt-4 space-y-3">
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    {operandLabels.a}
                  </label>
                  <div className="mt-1">
                    {stats.length > FUZZY_SEARCH_THRESHOLD ? (
                      <StatSearchSelect
                        stats={stats}
                        value={numeratorId}
                        onChange={setNumeratorId}
                        disabled={isSubmitting}
                        disabledId={denominatorId}
                        placeholder="Search numerator..."
                      />
                    ) : (
                      <div className="relative">
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
                    )}
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
                  <div className="mt-1">
                    {stats.length > FUZZY_SEARCH_THRESHOLD ? (
                      <StatSearchSelect
                        stats={stats}
                        value={denominatorId}
                        onChange={setDenominatorId}
                        disabled={isSubmitting}
                        disabledId={numeratorId}
                        placeholder="Search denominator..."
                      />
                    ) : (
                      <div className="relative">
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
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Preview of formula */}
            <div className="mt-4 rounded-lg bg-white px-3 py-2 text-xs text-slate-600 shadow-sm dark:bg-slate-900 dark:text-slate-300">
              {formula === "change_over_time" ? (
                numerator && startYear && endYear ? (
                  <p>
                    Percent change in <strong>{numerator.label || numerator.name}</strong> from {startYear} to {endYear}
                  </p>
                ) : (
                  <p>Select a stat and year range.</p>
                )
              ) : formula === "sum" ? (
                sumOperands.length >= 2 ? (
                  <p>{sumOperands.map((s) => s.label || s.name).join(" + ")}</p>
                ) : (
                  <p>Select at least two stats to sum.</p>
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
