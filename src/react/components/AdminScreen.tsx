import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import type { KeyboardEvent, ChangeEvent } from "react";
import { db } from "../../lib/reactDb";
import type { Category } from "../../types/organization";
import { CustomSelect } from "./CustomSelect";

// Stat item from InstantDB stats table
interface StatItem {
  id: string;
  name: string;
  label?: string | null; // Human-friendly display label
  category: string;
  neId?: string | null;
  source?: string | null;
  goodIfUp?: boolean | null;
  featured?: boolean | null;
  active?: boolean | null;
  createdOn?: number | null;
  lastUpdated?: number | null;
}

interface StatDataSummary {
  years: string[];
  boundaryTypes: string[];
  yearsLabel: string;
  boundaryLabel: string;
  rowCount: number;
}

// Parse a raw stat row from InstantDB
const parseStat = (row: unknown): StatItem | null => {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string" || typeof r.category !== "string") {
    return null;
  }
  return {
    id: r.id,
    name: r.name,
    label: typeof r.label === "string" && r.label.trim() ? r.label : null,
    category: r.category,
    neId: typeof r.neId === "string" ? r.neId : null,
    source: typeof r.source === "string" ? r.source : null,
    goodIfUp: typeof r.goodIfUp === "boolean" ? r.goodIfUp : null,
    featured: typeof r.featured === "boolean" ? r.featured : null,
    active: typeof r.active === "boolean" ? r.active : null,
    createdOn: typeof r.createdOn === "number" ? r.createdOn : null,
    lastUpdated: typeof r.lastUpdated === "number" ? r.lastUpdated : null,
  };
};

// Format a timestamp for display
const formatDate = (timestamp: number | null | undefined): string => {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};

// Edit form state
interface EditFormState {
  label: string;
  name: string;
  category: string;
  source: string;
  goodIfUp: boolean | null;
  active: boolean | null;
  featured: boolean | null;
}

const createEditForm = (stat: StatItem): EditFormState => ({
  label: stat.label ?? "",
  name: stat.name,
  category: stat.category,
  source: stat.source ?? "",
  goodIfUp: stat.goodIfUp ?? null,
  active: stat.active ?? null,
  featured: stat.featured ?? null,
});

// Stat list item props
interface StatListItemProps {
  stat: StatItem;
  isEditing: boolean;
  summary?: StatDataSummary;
  isDeleting?: boolean;
  onStartEdit: () => void;
  onSave: (form: EditFormState) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

// Stat list item component with bar shape and curved corners
const StatListItem = ({
  stat,
  isEditing,
  summary,
  isDeleting,
  onStartEdit,
  onSave,
  onCancel,
  onDelete,
}: StatListItemProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<EditFormState>(() => createEditForm(stat));

  // Reset form when entering edit mode or when stat changes
  useEffect(() => {
    if (isEditing) {
      setForm(createEditForm(stat));
    }
  }, [isEditing, stat]);

  // Handle click outside to cancel
  useEffect(() => {
    if (!isEditing) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onCancel();
      }
    };
    // Delay to avoid immediate trigger from the click that started edit
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isEditing, onCancel]);

  // Handle keyboard events
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!isEditing) return;
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onSave(form);
      }
    },
    [isEditing, onCancel, onSave, form],
  );

  const handleChange = (field: keyof EditFormState, value: string | boolean | null) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = () => {
    onSave(form);
  };

  // View mode (non-editing)
  if (!isEditing) {
    return (
      <div
        ref={containerRef}
        onClick={onStartEdit}
        className="flex cursor-pointer flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-brand-200 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600"
      >
        {/* Top row: Title (label or name) and category */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">
              {stat.label || stat.name}
            </h3>
            {/* Show original name as subtitle if label exists and differs */}
            {stat.label && stat.label !== stat.name && (
              <p className="text-xs text-slate-400 dark:text-slate-500">{stat.name}</p>
            )}
          </div>
          <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
            {stat.category}
          </span>
        </div>

        {/* Details row */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
          {stat.source && (
            <span className="flex items-center gap-1">
              <span className="font-medium">Source:</span> {stat.source}
            </span>
          )}
          {stat.neId && (
            <span className="flex items-center gap-1">
              <span className="font-medium">NE ID:</span>
              <code className="rounded bg-slate-100 px-1 py-0.5 text-xs dark:bg-slate-700">{stat.neId}</code>
            </span>
          )}
          {stat.goodIfUp !== null && (
            <span className="flex items-center gap-1">
              <span className="font-medium">Good if up:</span>
              {stat.goodIfUp ? (
                <span className="text-emerald-600 dark:text-emerald-400">Yes</span>
              ) : (
                <span className="text-rose-600 dark:text-rose-400">No</span>
              )}
            </span>
          )}
          {summary && summary.years.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="font-medium">Data:</span>
              <span>{summary.yearsLabel}</span>
              {summary.boundaryLabel && (
                <span className="text-slate-400 dark:text-slate-500">· {summary.boundaryLabel}</span>
              )}
            </span>
          )}
        </div>

        {/* Status badges and dates row */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {stat.active !== null && (
            <span
              className={`rounded-full px-2 py-0.5 font-medium ${
                stat.active
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
              }`}
            >
              {stat.active ? "Active" : "Inactive"}
            </span>
          )}
          {stat.featured !== null && stat.featured && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
              Featured
            </span>
          )}
          {(stat.createdOn || stat.lastUpdated) && (
            <span className="ml-auto text-slate-400 dark:text-slate-500">
              {stat.lastUpdated ? `Updated ${formatDate(stat.lastUpdated)}` : `Created ${formatDate(stat.createdOn)}`}
            </span>
          )}
        </div>
      </div>
    );
  }

  // Edit mode
  return (
    <div
      ref={containerRef}
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-3 rounded-xl border-2 border-brand-400 bg-white px-4 py-3 shadow-lg ring-2 ring-brand-100 dark:border-brand-500 dark:bg-slate-800 dark:ring-brand-900/50"
    >
      {/* Label field with original name and source as subtitles */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Label <span className="text-slate-400 dark:text-slate-500">(display title)</span>
        </label>
        <input
          type="text"
          value={form.label}
          onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange("label", e.target.value)}
          placeholder="Human-friendly label..."
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-brand-500 dark:focus:ring-brand-900/50"
          autoFocus
        />
        <div className="flex gap-4 text-[10px] text-slate-400 dark:text-slate-500">
          {form.name && <span>Original: {form.name}</span>}
          {form.source && <span>Source: {form.source}</span>}
        </div>
      </div>

      {/* Options row - wraps on mobile */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Category dropdown */}
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Category</label>
          <CustomSelect
            value={form.category}
            onChange={(val) => handleChange("category", val)}
            options={statCategoryOptions}
            className="min-w-[120px]"
          />
        </div>

        {/* Active and Featured checkboxes */}
        <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.active === true}
              onChange={(e) => handleChange("active", e.target.checked ? true : false)}
              className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400 dark:border-slate-600 dark:bg-slate-700"
            />
            Active
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.featured === true}
              onChange={(e) => handleChange("featured", e.target.checked ? true : false)}
              className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400 dark:border-slate-600 dark:bg-slate-700"
            />
            Featured
          </label>
        </div>

        {/* Good if up - radio group */}
        <fieldset className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
          <legend className="text-sm font-medium text-slate-600 dark:text-slate-300">Good if up</legend>
          <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="radio"
              name="goodIfUp"
              checked={form.goodIfUp === null}
              onChange={() => handleChange("goodIfUp", null)}
              className="h-4 w-4 border-slate-300 text-brand-500 focus:ring-brand-400 dark:border-slate-600 dark:bg-slate-700"
            />
            <span className="text-slate-500 dark:text-slate-400">Unset</span>
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="radio"
              name="goodIfUp"
              checked={form.goodIfUp === true}
              onChange={() => handleChange("goodIfUp", true)}
              className="h-4 w-4 border-slate-300 text-brand-500 focus:ring-brand-400 dark:border-slate-600 dark:bg-slate-700"
            />
            Yes
          </label>
          <label className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="radio"
              name="goodIfUp"
              checked={form.goodIfUp === false}
              onChange={() => handleChange("goodIfUp", false)}
              className="h-4 w-4 border-slate-300 text-brand-500 focus:ring-brand-400 dark:border-slate-600 dark:bg-slate-700"
            />
            No
          </label>
        </fieldset>
      </div>

      {/* Info section: Years, Areas, IDs - compact inline */}
      <div className="mt-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {summary && summary.years.length > 0 && (
            <span>
              <span className="font-medium">Years:</span> {summary.yearsLabel}
            </span>
          )}
          {summary && summary.boundaryLabel && (
            <span>
              <span className="font-medium">Areas:</span> {summary.boundaryLabel}
            </span>
          )}
          {stat.neId && (
            <span>
              <span className="font-medium">ID:</span>{" "}
              <code className="rounded bg-slate-200 px-1 py-0.5 text-[10px] dark:bg-slate-700">{stat.neId}</code>
            </span>
          )}
          <span>
            <span className="font-medium">InstantDB ID:</span>{" "}
            <code className="rounded bg-slate-200 px-1 py-0.5 text-[10px] dark:bg-slate-700">{stat.id}</code>
          </span>
          {summary && (
            <span>
              <span className="font-medium">Area-Data Rows:</span> {summary.rowCount.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-3 text-xs dark:border-slate-700">
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            disabled={isDeleting}
            className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/40"
          >
            {isDeleting ? "Deleting…" : "Delete stat + data"}
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="rounded-lg bg-brand-500 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 dark:focus:ring-offset-slate-800"
          >
            Save
          </button>
          <span className="ml-1 text-xs text-slate-400 dark:text-slate-500">⌘+Enter</span>
        </div>
      </div>
    </div>
  );
};

type CensusVariablePreview = {
  name: string;
  label: string;
  concept?: string;
  predicateType?: string;
  inferredType: string;
  statName: string;
  zipCount: number;
  countyCount: number;
};

type ImportStatus = "pending" | "running" | "success" | "error";

interface ImportQueueItem {
  id: string;
  dataset: string;
  group: string;
  variable: string;
  year: number;
  years: number;
  includeMoe: boolean;
  status: ImportStatus;
  errorMessage?: string;
}

const statCategoryOptions: Array<{ value: Category; label: string }> = [
  { value: "food", label: "Food" },
  { value: "demographics", label: "Demographics" },
  { value: "health", label: "Health" },
  { value: "education", label: "Education" },
  { value: "economy", label: "Economy" },
  { value: "housing", label: "Housing" },
  { value: "justice", label: "Justice" },
];

// Heuristic: group IDs are typically like B22003, S1701, DP02, etc.
const looksLikeGroupId = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Common patterns: B, C, S, DP, CP prefixes followed by digits
  return /^[A-Z]{1,2}\d{3,5}[A-Z]?$/i.test(trimmed);
};

interface CensusGroupResult {
  name: string;
  description: string;
}

interface GroupSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  dataset: string;
  year: number;
  onPreview?: (groupOverride?: string) => void; // Called when Enter pressed with a group ID
  inputRef?: React.RefObject<HTMLInputElement | null>; // For external focus control
}

// Input with inline search capability for Census groups
const GroupSearchInput = ({ value, onChange, dataset, year, onPreview, inputRef }: GroupSearchInputProps) => {
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [results, setResults] = useState<CensusGroupResult[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  const hasValue = value.trim().length > 0;
  const isGroupId = looksLikeGroupId(value);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isDropdownOpen) return;
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isDropdownOpen]);

  const handleSearch = async () => {
    const trimmed = value.trim();
    if (!trimmed || looksLikeGroupId(trimmed)) return;

    setIsSearching(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({
        dataset,
        year: String(year),
        search: trimmed,
        limit: "15",
      });
      const response = await fetch(`/api/census-groups?${params.toString()}`);
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        setSearchError(payload?.error || "Search failed.");
        setResults([]);
        setIsDropdownOpen(true);
        return;
      }
      const groups = Array.isArray(payload.groups) ? payload.groups : [];
      setResults(
        groups.map((g: any) => ({
          name: typeof g.name === "string" ? g.name : "",
          description: typeof g.description === "string" ? g.description : "",
        }))
      );
      setIsDropdownOpen(true);
      setHighlightedIndex(-1);
    } catch (err) {
      setSearchError("Network error during search.");
      setResults([]);
      setIsDropdownOpen(true);
      setHighlightedIndex(-1);
    } finally {
      setIsSearching(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (isDropdownOpen && results.length > 0) {
        setHighlightedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (isDropdownOpen && results.length > 0) {
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      // If dropdown is open and an item is highlighted, select it
      if (isDropdownOpen && highlightedIndex >= 0 && results[highlightedIndex]) {
        handleSelectGroup(results[highlightedIndex].name);
      } else if (isGroupId && onPreview) {
        // Group ID entered, trigger preview
        onPreview();
      } else if (hasValue && !isGroupId) {
        // Search term entered, trigger search
        handleSearch();
      }
    } else if (e.key === "Escape") {
      setIsDropdownOpen(false);
      setHighlightedIndex(-1);
    }
  };

  const handleSelectGroup = (groupName: string) => {
    onChange(groupName);
    setIsDropdownOpen(false);
    setResults([]);
    setHighlightedIndex(-1);
    // Auto-trigger search after selecting a group (pass groupName directly since state update is async)
    if (onPreview) {
      onPreview(groupName);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="relative flex items-center">
        {/* Search icon on the left, always visible */}
        <button
          type="button"
          onClick={hasValue && !isGroupId ? handleSearch : undefined}
          disabled={isSearching || !hasValue || isGroupId}
          className={`absolute left-1.5 flex h-5 w-5 items-center justify-center rounded transition ${
            hasValue
              ? "text-brand-500 dark:text-brand-400"
              : "text-slate-400 dark:text-slate-500"
          } ${hasValue && !isGroupId ? "cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700" : "cursor-default"}`}
          title={hasValue && !isGroupId ? "Search Census groups" : "Enter a search term or group ID"}
        >
          {isSearching ? (
            <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
        </button>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="e.g., food, health, or B22003"
          className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        />
      </div>

      {/* Dropdown */}
      {isDropdownOpen && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
          {searchError && (
            <div className="px-3 py-2 text-xs text-rose-600 dark:text-rose-400">{searchError}</div>
          )}
          {!searchError && results.length === 0 && (
            <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
              No matching groups found.
            </div>
          )}
          {results.map((group, index) => (
            <button
              key={group.name}
              type="button"
              onClick={() => handleSelectGroup(group.name)}
              className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left transition ${
                index === highlightedIndex
                  ? "bg-brand-50 dark:bg-brand-900/30"
                  : "hover:bg-slate-50 dark:hover:bg-slate-700"
              }`}
            >
              <span className="text-xs font-medium text-slate-800 dark:text-slate-100">
                {group.name}
              </span>
              <span className="line-clamp-2 text-[10px] text-slate-500 dark:text-slate-400">
                {group.description}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

interface NewStatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: (statIds: string[]) => void;
}

const NewStatModal = ({ isOpen, onClose, onImported }: NewStatModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const groupInputRef = useRef<HTMLInputElement>(null);
  const [dataset, setDataset] = useState("acs/acs5");
  const [group, setGroup] = useState("");
  const [year, setYear] = useState(() => {
    const now = new Date();
    return now.getUTCFullYear() - 2;
  });
  const [limit, setLimit] = useState(20);
  const [category, setCategory] = useState<Category | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [variables, setVariables] = useState<CensusVariablePreview[]>([]);
  const [selection, setSelection] = useState<
    Record<string, { selected: boolean; yearEnd: number | null; yearStart: number | null }>
  >({});
  const [queueItems, setQueueItems] = useState<ImportQueueItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentIndex, setCurrentIndex] = useState<number | null>(null);
  const [lastSubmittedGroup, setLastSubmittedGroup] = useState<string>(""); // Track last previewed group

  useEffect(() => {
    if (!isOpen) return;
    const now = new Date();
    const defaultYear = now.getUTCFullYear() - 2;
    setDataset("acs/acs5");
    setGroup("");
    setYear(defaultYear);
    setLimit(20);
    setCategory(null);
    setStep(1);
    setIsPreviewLoading(false);
    setPreviewError(null);
    setPreviewTotal(0);
    setVariables([]);
    setSelection({});
    setQueueItems([]);
    setIsRunning(false);
    setCurrentIndex(null);
    setLastSubmittedGroup("");
    // Focus group search input when modal opens
    setTimeout(() => groupInputRef.current?.focus(), 50);
  }, [isOpen]);

  // Handle click outside to close modal
  useEffect(() => {
    if (!isOpen || isRunning) return;
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to avoid immediate trigger from the click that opened the modal
    const timeout = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen, isRunning, onClose]);

  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen || isRunning) return;
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, isRunning, onClose]);

  const handlePreview = useCallback(async (groupOverride?: string) => {
    const trimmedGroup = (groupOverride ?? group).trim();
    if (!trimmedGroup) {
      setPreviewError("Census group is required.");
      return;
    }
    setIsPreviewLoading(true);
    setPreviewError(null);
    try {
      const params = new URLSearchParams({
        dataset,
        group: trimmedGroup,
        year: String(year),
        limit: String(limit),
      });
      const response = await fetch(`/api/census-preview?${params.toString()}`);
      const payload = (await response.json().catch(() => null)) as any;
      if (!response.ok || !payload) {
        const baseMessage = "Failed to load Census preview.";
        const apiError = payload && typeof payload.error === "string" ? payload.error : null;
        const details = payload && typeof payload.details === "string" ? payload.details : null;
        const parts: string[] = [];
        parts.push(baseMessage);
        if (apiError && apiError !== baseMessage) parts.push(apiError);
        if (details) parts.push(details);
        setPreviewError(parts.join(" "));
        return;
      }
      const vars = Array.isArray(payload.variables) ? payload.variables : [];
      const total =
        typeof payload.totalVariables === "number" ? payload.totalVariables : vars.length;
      const parsed: CensusVariablePreview[] = vars.map((entry: any) => ({
        name: String(entry.name),
        label: typeof entry.label === "string" ? entry.label : "",
        concept: typeof entry.concept === "string" ? entry.concept : undefined,
        predicateType:
          typeof entry.predicateType === "string" ? entry.predicateType : undefined,
        inferredType:
          typeof entry.inferredType === "string" ? entry.inferredType : "",
        statName:
          typeof entry.statName === "string" ? entry.statName : String(entry.name),
        zipCount: typeof entry.zipCount === "number" ? entry.zipCount : 0,
        countyCount: typeof entry.countyCount === "number" ? entry.countyCount : 0,
      }));
      setVariables(parsed);
      setPreviewTotal(total);
      setLastSubmittedGroup(trimmedGroup); // Track what was previewed
      const defaults: Record<string, { selected: boolean; yearEnd: number; yearStart: number | null }> = {};
      for (const v of parsed) {
        defaults[v.name] = { selected: false, yearEnd: year, yearStart: year - 2 };
      }
      setSelection(defaults);
      setStep(2);
    } catch (err) {
      console.error("Failed to load Census preview", err);
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
          ? err
          : null;
      setPreviewError(message ? `Failed to load Census preview: ${message}` : "Failed to load Census preview.");
    } finally {
      setIsPreviewLoading(false);
    }
  }, [dataset, group, year, limit]);

  // Helper to calculate year and years from selection
  // If both are set: range from yearStart to yearEnd
  // If only yearEnd: single year (yearEnd)
  // If only yearStart: single year (yearStart)
  // If neither: use default year
  const getYearRange = (sel: { yearEnd: number | null; yearStart: number | null }, defaultYear: number) => {
    const hasStart = sel.yearStart !== null;
    const hasEnd = sel.yearEnd !== null;
    
    if (hasStart && hasEnd) {
      // Range: yearStart to yearEnd
      const start = sel.yearStart!;
      const end = sel.yearEnd!;
      const years = Math.max(1, end - start + 1);
      return { year: end, years };
    } else if (hasEnd) {
      // Single year: yearEnd only
      return { year: sel.yearEnd!, years: 1 };
    } else if (hasStart) {
      // Single year: yearStart only
      return { year: sel.yearStart!, years: 1 };
    } else {
      // Neither set, use default
      return { year: defaultYear, years: 1 };
    }
  };

  const toggleVariableSelected = useCallback((name: string) => {
    const trimmedGroup = group.trim();
    setSelection((prev) => {
      const current = prev[name] ?? { selected: false, yearEnd: year, yearStart: null };
      const newSelected = !current.selected;
      
      // If selecting, add to queue
      if (newSelected && trimmedGroup) {
        const { year: qYear, years: qYears } = getYearRange(current, year);
        const key = `${dataset}::${trimmedGroup}::${name}`;
        setQueueItems((prevQueue) => {
          const exists = prevQueue.some((item) => item.variable === name && item.group === trimmedGroup);
          if (exists) return prevQueue;
          return [
            ...prevQueue,
            {
              id: key,
              dataset,
              group: trimmedGroup,
              variable: name,
              year: qYear,
              years: qYears,
              includeMoe: true,
              status: "pending" as const,
            },
          ];
        });
      }
      // If deselecting, remove from queue
      if (!newSelected && trimmedGroup) {
        setQueueItems((prevQueue) =>
          prevQueue.filter((item) => item.variable !== name || item.group !== trimmedGroup),
        );
      }
      
      return {
        ...prev,
        [name]: { ...current, selected: newSelected },
      };
    });
  }, [group, dataset, year]);

  const removeFromQueue = useCallback((itemId: string, variableName: string) => {
    // Remove from queue
    setQueueItems((prev) => prev.filter((item) => item.id !== itemId));
    // Deselect the variable
    setSelection((prev) => {
      const current = prev[variableName];
      if (!current) return prev;
      return {
        ...prev,
        [variableName]: { ...current, selected: false },
      };
    });
  }, []);

  const updateSelectionField = useCallback(
    (name: string, field: "yearEnd" | "yearStart", value: number | null) => {
      const trimmedGroup = group.trim();
      setSelection((prev) => {
        const current = prev[name] ?? { selected: true, yearEnd: year, yearStart: null };
        const updated = { ...current, [field]: value };
        
        // Update corresponding queue item if selected
        if (current.selected && trimmedGroup) {
          const { year: qYear, years: qYears } = getYearRange(updated, year);
          setQueueItems((prevQueue) =>
            prevQueue.map((item) =>
              item.variable === name && item.group === trimmedGroup
                ? { ...item, year: qYear, years: qYears }
                : item,
            ),
          );
        }
        
        return {
          ...prev,
          [name]: updated,
        };
      });
    },
    [year, group],
  );

  const handleRunQueue = useCallback(async () => {
    if (isRunning || queueItems.length === 0) return;
    setIsRunning(true);
    const itemsSnapshot = queueItems.slice();
    const importedStatIds: string[] = [];
    try {
      for (let index = 0; index < itemsSnapshot.length; index += 1) {
        const item = itemsSnapshot[index];
        if (item.status === "success") continue;
        setCurrentIndex(index);
        setQueueItems((prev) =>
          prev.map((q, i) =>
            i === index ? { ...q, status: "running", errorMessage: undefined } : q,
          ),
        );
        try {
          const response = await fetch("/api/census-import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dataset: item.dataset,
              group: item.group,
              variable: item.variable,
              year: item.year,
              years: item.years,
              includeMoe: item.includeMoe,
              category: category,
            }),
          });
          const payload = (await response.json().catch(() => null)) as any;
          if (!response.ok || !payload || payload.ok === false || payload.error) {
            const message =
              (payload && typeof payload.error === "string" && payload.error) ||
              `Import failed with status ${response.status}.`;
            setQueueItems((prev) =>
              prev.map((q, i) =>
                i === index ? { ...q, status: "error", errorMessage: message } : q,
              ),
            );
            continue;
          }
          const statId = typeof payload.statId === "string" ? payload.statId : null;
          if (statId && !importedStatIds.includes(statId)) {
            importedStatIds.push(statId);
          }
          setQueueItems((prev) =>
            prev.map((q, i) =>
              i === index ? { ...q, status: "success", errorMessage: undefined } : q,
            ),
          );
        } catch (err) {
          console.error("Census import request failed", err);
          setQueueItems((prev) =>
            prev.map((q, i) =>
              i === index
                ? { ...q, status: "error", errorMessage: "Network error during import." }
                : q,
            ),
          );
        }
      }
    } finally {
      setIsRunning(false);
      setCurrentIndex(null);
      if (importedStatIds.length > 0) {
        onImported(importedStatIds);
      }
    }
  }, [queueItems, isRunning, onImported, category]);

  if (!isOpen) return null;

  const totalItems = queueItems.length;
  const completedCount = queueItems.filter((item) => item.status === "success").length;
  const progressPercent =
    totalItems === 0 ? 0 : Math.round((completedCount / totalItems) * 100);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4">
      <div ref={modalRef} className="relative my-auto w-full max-w-4xl rounded-2xl bg-white p-4 shadow-xl sm:p-6 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              Import Census stats
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Choose a Census group, preview available variables, add them to an import queue,
              and run them one by one.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isRunning}
            className="rounded-full p-1 text-slate-500 transition hover:bg-slate-100 disabled:opacity-50 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1.2fr)_minmax(0,1.2fr)]">
          <div className="order-1 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
            <div className="space-y-3">
              {/* Dataset and Group Search on same row */}
              <div className="flex items-end gap-3">
                <div className="w-1/4 shrink-0 space-y-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Dataset
                  </label>
                  <input
                    type="text"
                    value={dataset}
                    onChange={(e) => setDataset(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Group Search
                  </label>
                  <GroupSearchInput
                    value={group}
                    onChange={setGroup}
                    dataset={dataset}
                    year={year}
                    onPreview={handlePreview}
                    inputRef={groupInputRef}
                  />
                </div>
              </div>
              {/* Year, Limit, Search button row */}
              <div className="flex flex-wrap items-center gap-3 md:flex-nowrap">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Year
                  </label>
                  <input
                    type="number"
                    value={year}
                    onChange={(e) => setYear(Number(e.target.value) || year)}
                    className="w-16 appearance-none rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                    Limit
                  </label>
                  <input
                    type="number"
                    value={limit}
                    onChange={(e) => setLimit(Math.max(1, Math.min(50, Number(e.target.value) || 20)))}
                    className="w-14 appearance-none rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handlePreview()}
                  disabled={isPreviewLoading}
                  className="ml-auto inline-flex items-center gap-2 rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-brand-600 disabled:opacity-60"
                >
                  {isPreviewLoading ? "Searching…" : "Search"}
                </button>
              </div>
            </div>
            {previewError && (
              <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{previewError}</p>
            )}
          </div>

          <div className="order-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:order-2 dark:border-slate-700 dark:bg-slate-900/40">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Queue
            </h3>

            {isRunning && (
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div
                  className="h-full rounded-full bg-brand-500 transition-all dark:bg-brand-400"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}

            <div className="mt-2 grid grid-cols-1 gap-2">
              {queueItems.length === 0 ? (
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  No imports queued yet. Select variables from the preview below to add them.
                </p>
              ) : (
                <div className="max-h-56 space-y-1 overflow-y-auto text-[11px]">
                  {queueItems.map((item, index) => {
                    const isCurrent = currentIndex === index && isRunning;
                    return (
                      <div
                        key={item.id}
                        className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1.5 shadow-sm dark:bg-slate-900"
                      >
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium text-slate-800 dark:text-slate-100">
                              {item.variable}
                            </span>
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-300">
                              {item.group}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                            <span>
                              {item.years > 1
                                ? `${item.year - item.years + 1} to ${item.year}`
                                : item.year}
                            </span>
                            <span>dataset: {item.dataset}</span>
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-[10px]">
                          {item.status === "pending" && (
                            <button
                              type="button"
                              onClick={() => removeFromQueue(item.id, item.variable)}
                              className="rounded p-0.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                              title="Remove from queue"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                          {item.status === "running" && (
                            <span className="text-brand-600 dark:text-brand-400">
                              {isCurrent ? "Running…" : "Running"}
                            </span>
                          )}
                          {item.status === "success" && (
                            <span className="text-emerald-600 dark:text-emerald-400">Done</span>
                          )}
                          {item.status === "error" && (
                            <span className="text-rose-600 dark:text-rose-400">Error</span>
                          )}
                          {item.status === "error" && item.errorMessage && (
                            <div className="mt-0.5 max-w-xs truncate text-[9px] text-rose-500 dark:text-rose-400">
                              {item.errorMessage}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Apply Category + Start Import row */}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3 dark:border-slate-700">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-xs font-medium text-slate-600 dark:text-slate-300">
                  Apply Category
                </label>
                <CustomSelect
                  value={category ?? ""}
                  onChange={(val) => setCategory(val ? (val as Category) : null)}
                  options={[
                    { value: "", label: "None" },
                    ...statCategoryOptions,
                  ]}
                  className="min-w-36"
                />
              </div>
              <button
                type="button"
                onClick={handleRunQueue}
                disabled={isRunning || queueItems.length === 0}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm transition hover:bg-emerald-600 disabled:opacity-60"
              >
                {isRunning ? "Running imports…" : "Start import"}
              </button>
            </div>
          </div>

          {/* Preview section - order-2 on mobile (after Search), order-3 on desktop (below grid) */}
          {step === 2 && variables.length > 0 && (
            <div className="order-2 md:order-3 md:col-span-2">
              {/* Meta info above preview */}
              {previewTotal > 0 && lastSubmittedGroup && (
                <p className="mb-1.5 px-1 text-[10px] text-slate-400 dark:text-slate-500">
                  {variables.length} of {previewTotal} in {lastSubmittedGroup} (+ MOE)
                </p>
              )}
              <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                {/* Desktop header - hidden on mobile */}
                <div className="mb-2 hidden grid-cols-3 gap-4 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:grid dark:text-slate-400">
                  <span className="pl-6">Variable</span>
                  <span>Year Range</span>
                  <span>Coverage</span>
                </div>
            <div className="space-y-1">
              {variables.map((v) => {
                const sel = selection[v.name] ?? { selected: false, yearEnd: year, yearStart: year - 2 };
                return (
                  <label
                    key={v.name}
                    className="grid cursor-pointer grid-cols-[1fr_auto] items-center gap-4 rounded-lg border-t border-slate-100 px-1.5 py-1.5 first:border-t-0 hover:bg-slate-50 sm:grid-cols-3 dark:border-slate-800/70 dark:hover:bg-slate-800/60"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={sel.selected}
                        onChange={() => toggleVariableSelected(v.name)}
                        className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-brand-500 focus:ring-brand-400 dark:border-slate-500 dark:bg-slate-900"
                      />
                      <div className="flex min-w-0 flex-col">
                        <span className="font-medium text-slate-800 dark:text-slate-100">
                          {v.name}
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {v.inferredType} · {v.statName}
                        </span>
                      </div>
                    </div>
                    {/* Year range - stacks vertically on mobile */}
                    <div className="flex flex-col gap-0.5 text-[10px] text-slate-600 sm:flex-row sm:items-center sm:gap-1 dark:text-slate-300">
                      <input
                        type="number"
                        value={sel.yearStart ?? ""}
                        placeholder="Start"
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          updateSelectionField(v.name, "yearStart", val ? Number(val) : null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-14 appearance-none rounded border border-slate-300 bg-white px-1.5 py-0.5 text-center text-[10px] text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 sm:text-left dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                      <span className="hidden sm:inline">to</span>
                      <input
                        type="number"
                        value={sel.yearEnd ?? ""}
                        placeholder="End"
                        onChange={(e) => {
                          const val = e.target.value.trim();
                          updateSelectionField(v.name, "yearEnd", val ? Number(val) : null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-14 appearance-none rounded border border-slate-300 bg-white px-1.5 py-0.5 text-center text-[10px] text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 sm:text-left dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                    </div>
                    <div className="hidden text-[10px] text-slate-500 sm:block dark:text-slate-400">
                      {v.zipCount} ZIPs · {v.countyCount} counties
                    </div>
                  </label>
                );
              })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// Sort options for stats list
type SortOption = "updated" | "created" | "name" | "category";
const sortOptionLabels: Record<SortOption, string> = {
  updated: "Recently Updated",
  created: "Recently Created",
  name: "Name (A-Z)",
  category: "Category",
};

// Simple fuzzy search - matches if all characters appear in order
const fuzzyMatch = (text: string, query: string): boolean => {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let ti = 0;
  for (let qi = 0; qi < lowerQuery.length; qi++) {
    const char = lowerQuery[qi];
    const foundIndex = lowerText.indexOf(char, ti);
    if (foundIndex === -1) return false;
    ti = foundIndex + 1;
  }
  return true;
};

export const AdminScreen = () => {
  // Query stats and lightweight statData metadata from InstantDB
  const { data, isLoading, error } = db.useQuery({
    stats: {
      $: {
        order: { name: "asc" as const },
      },
    },
    statData: {
      $: {
        where: { name: "root" },
        fields: ["id", "statId", "boundaryType", "date", "name", "parentArea"],
        order: { statId: "asc" as const },
      },
    },
  });

  // State for which stat is being edited (null = none)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isNewStatOpen, setIsNewStatOpen] = useState(false);
  const [recentStatIds, setRecentStatIds] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Filter, sort, and search state
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("updated");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Parse and filter stats
  const stats = useMemo(() => {
    if (!data?.stats) return [];
    return data.stats.map(parseStat).filter((s): s is StatItem => s !== null);
  }, [data?.stats]);

  // Extract unique categories from stats
  const availableCategories = useMemo(() => {
    const cats = new Set<string>();
    for (const stat of stats) {
      if (stat.category) cats.add(stat.category);
    }
    return Array.from(cats).sort();
  }, [stats]);

  // Filtered and sorted stats
  const sortedStats = useMemo(() => {
    // First filter by category
    let filtered = categoryFilter === "all"
      ? stats
      : stats.filter((s) => s.category === categoryFilter);

    // Then filter by search query
    if (searchQuery.trim()) {
      const q = searchQuery.trim();
      filtered = filtered.filter((s) => {
        const searchText = `${s.label || ""} ${s.name} ${s.category} ${s.neId || ""} ${s.source || ""}`;
        return fuzzyMatch(searchText, q);
      });
    }

    // Sort based on sortBy option
    const sorted = [...filtered];
    switch (sortBy) {
      case "updated":
        sorted.sort((a, b) => (b.lastUpdated ?? 0) - (a.lastUpdated ?? 0));
        break;
      case "created":
        sorted.sort((a, b) => (b.createdOn ?? 0) - (a.createdOn ?? 0));
        break;
      case "name":
        sorted.sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name));
        break;
      case "category":
        sorted.sort((a, b) => a.category.localeCompare(b.category) || (a.label || a.name).localeCompare(b.label || b.name));
        break;
    }

    // Promote recently imported stats to top if no specific sort
    if (recentStatIds.length && sortBy === "updated") {
      const idSet = new Set(recentStatIds);
      const recent: StatItem[] = [];
      const rest: StatItem[] = [];
      for (const stat of sorted) {
        if (idSet.has(stat.id)) {
          recent.push(stat);
        } else {
          rest.push(stat);
        }
      }
      return [...recent, ...rest];
    }

    return sorted;
  }, [stats, categoryFilter, searchQuery, sortBy, recentStatIds]);

  const statDataSummaryByStatId = useMemo(() => {
    const map = new Map<string, StatDataSummary>();
    const rows = (data?.statData ?? []) as any[];
    const formatYearsLabel = (years: string[]): string => {
      if (years.length === 0) return "";
      const numericYears = years
        .map((y) => Number(y))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b)
        .map((n) => String(n));
      const uniqueYears = Array.from(new Set(numericYears.length ? numericYears : years.sort()));
      if (uniqueYears.length <= 2) return uniqueYears.join(", ");
      const first = uniqueYears[0];
      const last = uniqueYears[uniqueYears.length - 1];
      return `${first}–${last}`;
    };
    const formatBoundaryLabel = (types: string[]): string => {
      if (types.length === 0) return "";
      const uniq = Array.from(new Set(types));
      if (uniq.length === 1) {
        return uniq[0] === "ZIP" ? "ZIPs" : uniq[0] === "COUNTY" ? "Counties" : uniq[0];
      }
      const pretty = uniq.map((t) => (t === "ZIP" ? "ZIPs" : t === "COUNTY" ? "Counties" : t));
      return pretty.join(" + ");
    };

    for (const row of rows) {
      const statId = typeof row?.statId === "string" ? (row.statId as string) : null;
      if (!statId) continue;
      const boundaryType = typeof row.boundaryType === "string" ? (row.boundaryType as string) : null;
      const rawDate = row.date;
      const date =
        typeof rawDate === "string"
          ? rawDate
          : typeof rawDate === "number"
          ? String(rawDate)
          : null;

      let entry = map.get(statId);
      if (!entry) {
        entry = { years: [], boundaryTypes: [], yearsLabel: "", boundaryLabel: "", rowCount: 0 };
        map.set(statId, entry);
      }
      entry.rowCount += 1;
      if (date && !entry.years.includes(date)) {
        entry.years.push(date);
      }
      if (boundaryType && !entry.boundaryTypes.includes(boundaryType)) {
        entry.boundaryTypes.push(boundaryType);
      }
    }

    for (const entry of map.values()) {
      entry.years.sort();
      entry.boundaryTypes.sort();
      entry.yearsLabel = formatYearsLabel(entry.years);
      entry.boundaryLabel = formatBoundaryLabel(entry.boundaryTypes);
    }

    return map;
  }, [data?.statData]);

  // Start editing a stat
  const handleStartEdit = useCallback((id: string) => {
    setEditingId(id);
  }, []);

  // Cancel editing
  const handleCancel = useCallback(() => {
    setEditingId(null);
  }, []);

  // Save changes to a stat
  const handleSave = useCallback(
    async (statId: string, form: EditFormState) => {
      setIsSaving(true);
      try {
        await db.transact(
          db.tx.stats[statId].update({
            name: form.name,
            label: form.label.trim() || null, // Store null if empty
            category: form.category,
            source: form.source.trim() || null,
            goodIfUp: form.goodIfUp,
            active: form.active,
            featured: form.featured,
            lastUpdated: Date.now(),
          }),
        );
        setEditingId(null);
      } catch (err) {
        console.error("Failed to save stat:", err);
        // Could show a toast here
      } finally {
        setIsSaving(false);
      }
    },
    [],
  );

  const handleDeleteStat = useCallback(
    async (statId: string) => {
      if (deletingId) return;
      if (typeof window !== "undefined") {
        const confirmed = window.confirm(
          "Delete this stat and all associated data (statData rows)? This cannot be undone.",
        );
        if (!confirmed) return;
      }
      setDeletingId(statId);
      try {
        const rows = (data?.statData ?? []).filter(
          (row: any) => row && typeof row.id === "string" && row.statId === statId,
        );
        const txs: any[] = [];
        for (const row of rows) {
          txs.push(db.tx.statData[row.id as string].delete());
        }
        txs.push(db.tx.stats[statId].delete());
        if (txs.length > 0) {
          await db.transact(txs);
        }
        setEditingId((current) => (current === statId ? null : current));
        setRecentStatIds((prev) => prev.filter((id) => id !== statId));
      } catch (err) {
        console.error("Failed to delete stat:", err);
      } finally {
        setDeletingId((current) => (current === statId ? null : current));
      }
    },
    [data?.statData, deletingId],
  );

  const handleImportedFromModal = useCallback((statIds: string[]) => {
    if (!statIds.length) return;
    setRecentStatIds((prev) => {
      const next = [...prev];
      for (const id of statIds) {
        if (!next.includes(id)) {
          next.unshift(id);
        }
      }
      if (next.length > 50) next.length = 50;
      return next;
    });
  }, []);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white dark:bg-slate-900">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand-500 dark:border-slate-700 dark:border-t-brand-400" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading stats…</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white dark:bg-slate-900">
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-sm font-medium text-rose-600 dark:text-rose-400">Failed to load stats</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-50 dark:bg-slate-900">
      {/* Header - single row: Title | filters | New stat */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
        <div className="flex items-center gap-3">
          {/* Left: Title and count */}
          <div className="shrink-0">
            <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100 sm:text-xl">Stats</h1>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">
              {sortedStats.length}{categoryFilter !== "all" || searchQuery ? ` of ${stats.length}` : ""} stat{sortedStats.length !== 1 ? "s" : ""}
              {editingId && <span className="ml-1 text-brand-500">(editing)</span>}
              {isSaving && <span className="ml-1 text-amber-500">Saving…</span>}
            </p>
          </div>

          {/* Center: Filters - Category (desktop only), Search, Sort (desktop only) */}
          <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
            {/* Category filter - hidden on mobile */}
            <div className="hidden sm:block">
              <CustomSelect
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={[
                  { value: "all", label: "All categories" },
                  ...availableCategories.map((cat) => ({
                    value: cat,
                    label: cat.charAt(0).toUpperCase() + cat.slice(1),
                  })),
                ]}
              />
            </div>

            {/* Search input */}
            <div className="relative w-full sm:w-auto sm:max-w-[200px]">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search…"
                className="h-7 w-full rounded-lg border border-slate-300 bg-white pl-7 pr-6 text-xs text-slate-700 placeholder:text-slate-400 shadow-sm transition focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:placeholder:text-slate-500 dark:focus:border-brand-300 dark:focus:ring-brand-800/50"
              />
              <svg
                className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Sort dropdown - hidden on mobile */}
            <div className="hidden sm:block">
              <CustomSelect
                value={sortBy}
                onChange={(val) => setSortBy(val as SortOption)}
                options={(Object.keys(sortOptionLabels) as SortOption[]).map((key) => ({
                  value: key,
                  label: sortOptionLabels[key],
                }))}
              />
            </div>
          </div>

          {/* Right: New stat button */}
          <button
            type="button"
            onClick={() => setIsNewStatOpen(true)}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-500 px-2 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900 sm:px-3 sm:py-1.5"
          >
            <span className="text-sm leading-none">+</span>
            <span>New stat</span>
          </button>
        </div>
      </div>

      {/* Stats list */}
      <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
        {stats.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">No stats found</p>
          </div>
        ) : sortedStats.length === 0 ? (
          <div className="flex h-40 items-center justify-center">
            <div className="text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">No matching stats</p>
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter("all");
                  setSearchQuery("");
                }}
                className="mt-2 text-xs text-brand-500 hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
              >
                Clear filters
              </button>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-3">
            {sortedStats.map((stat) => (
              <StatListItem
                key={stat.id}
                stat={stat}
                isEditing={editingId === stat.id}
                summary={statDataSummaryByStatId.get(stat.id)}
                isDeleting={deletingId === stat.id}
                onStartEdit={() => handleStartEdit(stat.id)}
                onSave={(form) => handleSave(stat.id, form)}
                onCancel={handleCancel}
                onDelete={() => handleDeleteStat(stat.id)}
              />
            ))}
          </div>
        )}
      </div>
      <NewStatModal
        isOpen={isNewStatOpen}
        onClose={() => setIsNewStatOpen(false)}
        onImported={handleImportedFromModal}
      />
    </div>
  );
};
