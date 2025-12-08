import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import type { KeyboardEvent, ChangeEvent, MouseEvent } from "react";
import { id as createId } from "@instantdb/react";
import { db } from "../../lib/reactDb";
import { isDevEnv } from "../../lib/env";
import { useAuthSession } from "../hooks/useAuthSession";
import { useCategories } from "../hooks/useCategories";
import type { Category } from "../../types/organization";
import { CustomSelect } from "./CustomSelect";
import {
  DerivedStatModal,
  type DerivedFormulaKind,
  type DerivedStatModalSubmit,
  type DerivedStatOption,
} from "./DerivedStatModal";

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
  homeFeatured?: boolean | null;
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

interface RootStatDataRow {
  parentArea: string | null;
  boundaryType: string | null;
  date: string | null;
  data: Record<string, number>;
}

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const normalizeDataMap = (value: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!value) return out;
  if (value instanceof Map) {
    value.forEach((v, k) => {
      const num = toFiniteNumber(v);
      if (num != null) out[String(k)] = num;
    });
    return out;
  }
  if (typeof value === "object") {
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const num = toFiniteNumber(raw);
      if (num != null) out[key] = num;
    }
  }
  return out;
};

const MAX_DERIVED_TX_BATCH = 10;

const buildRowKey = (row: RootStatDataRow) =>
  `${row.parentArea ?? ""}::${row.boundaryType ?? ""}::${row.date ?? ""}`;

// Compute derived values based on formula type
const computeDerivedValues = (
  aData: Record<string, number>,
  bData: Record<string, number>,
  formula: DerivedFormulaKind,
): Record<string, number> => {
  const out: Record<string, number> = {};
  const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

  // For sum/difference, iterate over union of keys; for division-based, iterate over A's keys
  const keys = formula === "sum" || formula === "difference"
    ? new Set([...Object.keys(aData), ...Object.keys(bData)])
    : Object.keys(aData);

  for (const area of keys) {
    const aVal = aData[area];
    const bVal = bData[area];

    switch (formula) {
      case "percent":
        if (isFiniteNum(aVal) && isFiniteNum(bVal) && bVal !== 0) {
          out[area] = aVal / bVal;
        }
        break;
      case "sum":
        if (isFiniteNum(aVal) && isFiniteNum(bVal)) {
          out[area] = aVal + bVal;
        } else if (isFiniteNum(aVal)) {
          out[area] = aVal;
        } else if (isFiniteNum(bVal)) {
          out[area] = bVal;
        }
        break;
      case "difference":
        if (isFiniteNum(aVal) && isFiniteNum(bVal)) {
          out[area] = aVal - bVal;
        }
        break;
      case "rate_per_1000":
        if (isFiniteNum(aVal) && isFiniteNum(bVal) && bVal !== 0) {
          out[area] = (aVal / bVal) * 1000;
        }
        break;
      case "ratio":
        if (isFiniteNum(aVal) && isFiniteNum(bVal) && bVal !== 0) {
          out[area] = aVal / bVal;
        }
        break;
      case "index":
        if (isFiniteNum(aVal) && isFiniteNum(bVal) && bVal !== 0) {
          out[area] = (aVal / bVal) * 100;
        }
        break;
    }
  }
  return out;
};

// Map formula to statData type
const formulaToStatType: Record<DerivedFormulaKind, string> = {
  percent: "percent",
  sum: "number",
  difference: "number",
  rate_per_1000: "number",
  ratio: "number",
  index: "number",
  change_over_time: "percent_change",
};

const IS_DEV = isDevEnv();

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
    homeFeatured: typeof r.homeFeatured === "boolean" ? r.homeFeatured : null,
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
  homeFeatured: boolean | null;
}

interface PendingDerivedJob {
  id: string; // statId
  label: string;
  createdAt: number;
}

const createEditForm = (stat: StatItem): EditFormState => ({
  label: stat.label ?? "",
  name: stat.name,
  category: stat.category,
  source: stat.source ?? "",
  goodIfUp: stat.goodIfUp ?? null,
  active: stat.active ?? null,
  featured: stat.featured ?? null,
   homeFeatured: stat.homeFeatured ?? null,
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
  isSelected?: boolean;
  onToggleSelect?: (event: MouseEvent<HTMLDivElement>) => void;
  selectionMode?: boolean;
  categoryOptions: Array<{ value: string; label: string }>;
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
  isSelected,
  onToggleSelect,
  selectionMode,
  categoryOptions,
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
    const handleClickOutside = (e: globalThis.MouseEvent) => {
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
        onClick={(e) => {
          const wantsSelection =
            !!onToggleSelect && (selectionMode || e.metaKey || e.ctrlKey || e.shiftKey);
          if (wantsSelection && onToggleSelect) {
            e.preventDefault();
            e.stopPropagation();
            onToggleSelect(e);
            return;
          }
          onStartEdit();
        }}
        className={`flex cursor-pointer flex-col gap-2 rounded-xl border bg-white px-4 py-3 shadow-sm transition hover:border-brand-200 hover:shadow-md dark:bg-slate-800 dark:hover:border-slate-600 ${
          isSelected
            ? "border-brand-400 ring-2 ring-brand-100 dark:border-brand-500 dark:ring-brand-900/50"
            : "border-slate-200 dark:border-slate-700"
        }`}
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
          {stat.homeFeatured !== null && stat.homeFeatured && (
            <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-700 dark:bg-sky-900/40 dark:text-sky-300">
              Home default
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
            options={categoryOptions}
            className="min-w-[120px]"
          />
        </div>

        {/* Active, Featured, and Home default checkboxes */}
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
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.homeFeatured === true}
              onChange={(e) => handleChange("homeFeatured", e.target.checked ? true : false)}
              className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400 dark:border-slate-600 dark:bg-slate-700"
            />
            Home default
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

// Category options are now fetched from InstantDB via useCategories hook

// Heuristic: group IDs are typically like B22003, S1701, DP02, etc.
const looksLikeGroupId = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Common patterns: B, C, S, DP, CP prefixes followed by digits
  return /^[A-Z]{1,2}\d{3,5}[A-Z]?$/i.test(trimmed);
};

const DEFAULT_CENSUS_DATASET = "acs/acs5";

// Auto-pick the correct Census dataset for common group prefixes when the user keeps the default.
const inferDatasetForGroup = (group: string, dataset: string): { dataset: string; changed: boolean } => {
  const trimmedGroup = group.trim().toUpperCase();
  const normalizedDataset = dataset.trim() || DEFAULT_CENSUS_DATASET;
  if (!trimmedGroup) return { dataset: normalizedDataset, changed: false };
  // Respect explicit dataset overrides
  if (normalizedDataset !== DEFAULT_CENSUS_DATASET) return { dataset: normalizedDataset, changed: false };

  if (trimmedGroup.startsWith("DP")) return { dataset: "acs/acs5/profile", changed: normalizedDataset !== "acs/acs5/profile" };
  if (trimmedGroup.startsWith("CP")) return { dataset: "acs/acs5/cprofile", changed: normalizedDataset !== "acs/acs5/cprofile" };
  if (trimmedGroup.startsWith("S")) return { dataset: "acs/acs5/subject", changed: normalizedDataset !== "acs/acs5/subject" };
  return { dataset: normalizedDataset, changed: false };
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
  onRegisterSearchRunner?: (runner: () => void) => void; // Expose internal search for external button
}

// Input with inline search capability for Census groups
const GroupSearchInput = ({
  value,
  onChange,
  dataset,
  year,
  onPreview,
  inputRef,
  onRegisterSearchRunner,
}: GroupSearchInputProps) => {
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

  // Allow parent to trigger the same search logic as pressing Enter on a term
  useEffect(() => {
    if (onRegisterSearchRunner) {
      onRegisterSearchRunner(handleSearch);
    }
  }, [handleSearch, onRegisterSearchRunner]);

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
  categoryOptions: Array<{ value: string; label: string }>;
}

const NewStatModal = ({ isOpen, onClose, onImported, categoryOptions }: NewStatModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const groupInputRef = useRef<HTMLInputElement>(null);
  const [runGroupSearch, setRunGroupSearch] = useState<(() => void) | null>(null);
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
    setRunGroupSearch(null);
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
    const { dataset: resolvedDataset, changed } = inferDatasetForGroup(trimmedGroup, dataset);
    if (changed) {
      setDataset(resolvedDataset);
    }
    setIsPreviewLoading(true);
    setPreviewError(null);
    try {
      const params = new URLSearchParams({
        dataset: resolvedDataset,
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
          <div className="order-1 h-fit space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:order-2 dark:border-slate-700 dark:bg-slate-900/40">
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
                    onRegisterSearchRunner={(runner) => setRunGroupSearch(() => runner)}
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
                  onClick={() => {
                    const trimmed = group.trim();
                    if (looksLikeGroupId(trimmed)) {
                      handlePreview();
                      return;
                    }
                    if (runGroupSearch) {
                      runGroupSearch();
                      return;
                    }
                    setPreviewError("Enter a Census group ID (e.g., S1701) or a search term and press Search again.");
                  }}
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

          <div className="order-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 md:order-3 dark:border-slate-700 dark:bg-slate-900/40">
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
                    ...categoryOptions,
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

          {/* Preview section - order-2 on mobile, order-1 on desktop (above other sections) */}
          {step === 2 && variables.length > 0 && (
            <div className="order-2 md:order-1 md:col-span-2">
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
  const { authReady } = useAuthSession();
  const queryEnabled = authReady;

  // Fetch categories from InstantDB
  const { statCategories } = useCategories();

  // Build category options for dropdowns (memoized to avoid re-renders)
  const statCategoryOptions = useMemo(
    () => statCategories.map((c) => ({ value: c.slug, label: c.label })),
    [statCategories]
  );

  // Primary query: just stats (small, fast, reliable)
  const {
    data: statsData,
    isLoading: statsLoading,
    error: statsError,
  } = db.useQuery(
    queryEnabled
      ? {
          stats: {
            $: {
              order: { name: "asc" as const },
            },
          },
        }
      : null,
  );

  // State to control statData query (for retry logic)
  const [statDataQueryEnabled, setStatDataQueryEnabled] = useState(true);

  // Secondary query: statData for summaries (separate, may be slow/timeout)
  const {
    data: statDataResponse,
    isLoading: statDataLoading,
    error: statDataError,
  } = db.useQuery(
    queryEnabled && statDataQueryEnabled
      ? {
          statData: {
            $: {
              where: { name: "root" },
              fields: ["id", "statId", "boundaryType", "date", "name", "parentArea"],
              order: { statId: "asc" as const },
            },
          },
        }
      : null,
  );

  // Retry callback: briefly disable then re-enable the query
  const retryStatData = useCallback(() => {
    setStatDataQueryEnabled(false);
    setTimeout(() => setStatDataQueryEnabled(true), 50);
  }, []);

  // Log statData errors but don't block the screen
  useEffect(() => {
    if (!statDataError) return;
    if (!IS_DEV) return;
    const anyError = statDataError as any;
    console.warn("[AdminScreen] statData query failed (summaries unavailable)", {
      message: anyError.message,
      hint: anyError.hint,
    });
  }, [statDataError]);

  useEffect(() => {
    if (!statsError) return;
    if (!IS_DEV) return;
    const anyError = statsError as any;
    const debugPayload: Record<string, unknown> = {
      name: anyError.name,
      message: anyError.message,
    };
    if (anyError.code) debugPayload.code = anyError.code;
    if (anyError.operation) debugPayload.operation = anyError.operation;
    console.error("[AdminScreen] Failed to load stats", debugPayload, anyError);
  }, [statsError]);

  // State for which stat is being edited (null = none)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isNewStatOpen, setIsNewStatOpen] = useState(false);
  const [recentStatIds, setRecentStatIds] = useState<string[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedStatIds, setSelectedStatIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isDerivedModalOpen, setIsDerivedModalOpen] = useState(false);
  const [derivedSelection, setDerivedSelection] = useState<DerivedStatOption[]>([]);
  const [isDerivedSubmitting, setIsDerivedSubmitting] = useState(false);
  const [derivedError, setDerivedError] = useState<string | null>(null);
  const [derivedAvailableYears, setDerivedAvailableYears] = useState<string[]>([]);
  const [pendingDerivedJobs, setPendingDerivedJobs] = useState<PendingDerivedJob[]>([]);

  // Filter, sort, and search state
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("created");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Parse and filter stats
  const stats = useMemo(() => {
    if (!statsData?.stats) return [];
    return statsData.stats.map(parseStat).filter((s): s is StatItem => s !== null);
  }, [statsData?.stats]);

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
    let filtered =
      categoryFilter === "all"
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
        sorted.sort(
          (a, b) =>
            a.category.localeCompare(b.category) || (a.label || a.name).localeCompare(b.label || b.name),
        );
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

  const statIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    sortedStats.forEach((stat, index) => {
      map.set(stat.id, index);
    });
    return map;
  }, [sortedStats]);

  const selectedIdSet = useMemo(() => new Set(selectedStatIds), [selectedStatIds]);

  const sortSelection = useCallback(
    (ids: string[]) =>
      ids
        .slice()
        .sort((a, b) => (statIndexMap.get(a) ?? 0) - (statIndexMap.get(b) ?? 0)),
    [statIndexMap],
  );

  const selectedCount = selectedStatIds.length;

  const handleToggleSelect = useCallback(
    (statId: string, event: MouseEvent<HTMLDivElement>) => {
      setSelectedStatIds((prev) => {
        const isShift = event.shiftKey;
        const isMeta = event.metaKey || event.ctrlKey;
        let next = prev;

        if (isShift) {
          // Shift+click on already-selected item = unselect it
          if (prev.includes(statId)) {
            return prev.filter((id) => id !== statId);
          }
          // Otherwise, range select from anchor to current
          const anchor = selectionAnchorId ?? prev[prev.length - 1] ?? statId;
          const anchorIndex = statIndexMap.get(anchor);
          const currentIndex = statIndexMap.get(statId);
          if (anchorIndex != null && currentIndex != null) {
            const [start, end] = anchorIndex <= currentIndex ? [anchorIndex, currentIndex] : [currentIndex, anchorIndex];
            const rangeIds = sortedStats.slice(start, end + 1).map((stat) => stat.id);
            const union = new Set(prev);
            rangeIds.forEach((id) => union.add(id));
            next = sortSelection(Array.from(union));
            return next;
          }
        }

        // In selection mode or with Meta/Ctrl, toggle the individual stat
        if (isMeta || isSelectionMode) {
          if (prev.includes(statId)) {
            next = prev.filter((id) => id !== statId);
          } else {
            next = sortSelection([...prev, statId]);
          }
          return next;
        }

        if (prev.length === 1 && prev[0] === statId) {
          return [];
        }
        return [statId];
      });

      if (!event.shiftKey) {
        setSelectionAnchorId(statId);
      }
    },
    [selectionAnchorId, sortSelection, sortedStats, statIndexMap, isSelectionMode],
  );

  useEffect(() => {
    if (selectedStatIds.length === 0 && selectionAnchorId) {
      setSelectionAnchorId(null);
    }
  }, [selectedStatIds.length, selectionAnchorId]);

  useEffect(() => {
    setSelectedStatIds((prev) => {
      const filtered = prev.filter((id) => statIndexMap.has(id));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [statIndexMap]);

  // Clear all selections and exit selection mode
  const handleClearSelection = useCallback(() => {
    setSelectedStatIds([]);
    setSelectionAnchorId(null);
    setIsSelectionMode(false);
  }, []);

  // ESC key clears selection and exits selection mode
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape" && (selectedStatIds.length > 0 || isSelectionMode)) {
        handleClearSelection();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedStatIds.length, isSelectionMode, handleClearSelection]);

  const handleRequestDerivedStat = useCallback(async () => {
    // If user has selected stats, use those; otherwise pass ALL stats for fuzzy-search mode
    const hasSelection = selectedIdSet.size > 0;
    const selection = hasSelection
      ? sortedStats
          .filter((stat) => selectedIdSet.has(stat.id))
          .map<DerivedStatOption>((stat) => ({
            id: stat.id,
            name: stat.name,
            label: stat.label,
            category: stat.category,
          }))
      : stats.map<DerivedStatOption>((stat) => ({
          id: stat.id,
          name: stat.name,
          label: stat.label,
          category: stat.category,
        }));

    setDerivedError(null);
    setDerivedSelection(selection);
    setDerivedAvailableYears([]);

    // For single stat selection, fetch available years for change_over_time
    if (selection.length === 1) {
      try {
        const { data } = await db.queryOnce({
          statData: {
            $: {
              where: { statId: selection[0].id, name: "root" },
              fields: ["date"],
            },
          },
        });
        const rows = (data as any)?.statData ?? [];
        const years = new Set<string>();
        for (const row of rows) {
          if (typeof row?.date === "string" && row.date.trim()) {
            years.add(row.date.trim());
          }
        }
        setDerivedAvailableYears(Array.from(years).sort());
      } catch (err) {
        console.warn("Failed to fetch years for stat", err);
      }
    }

    setIsDerivedModalOpen(true);
  }, [selectedIdSet, sortedStats, stats]);

  const handleDerivedModalClose = useCallback(() => {
    setIsDerivedModalOpen(false);
    setDerivedSelection([]);
    setDerivedError(null);
    setDerivedAvailableYears([]);
  }, []);

  const handleDerivedSubmit = useCallback(
    async (payload: DerivedStatModalSubmit) => {
      setDerivedError(null);
      setIsDerivedSubmitting(true);
      let attemptedWrite = false;
      let newStatMeta: { id: string; label: string } | null = null;
      try {
        // --- CHANGE OVER TIME formula: special handling ---
        if (payload.formula === "change_over_time") {
          const statId = payload.numeratorId; // same as denominatorId for this formula
          const startYear = payload.startYear;
          const endYear = payload.endYear;
          if (!statId || !startYear || !endYear) {
            throw new Error("Missing stat or year range for change over time calculation.");
          }

          const statMeta = stats.find((s) => s.id === statId);
          if (!statMeta) {
            throw new Error("Unable to locate selected stat.");
          }

          // Fetch all data rows for this stat
          const { data: statDataResponse } = await db.queryOnce({
            statData: {
              $: {
                where: { statId, name: "root" },
                fields: ["parentArea", "boundaryType", "date", "data"],
              },
            },
          });

          const rawRows = Array.isArray((statDataResponse as any)?.statData)
            ? ((statDataResponse as any).statData as any[])
            : [];

          // Group by parentArea + boundaryType, keyed by date
          type RowsByDate = Map<string, Record<string, number>>;
          const byContext = new Map<string, { parentArea: string | null; boundaryType: string | null; rowsByDate: RowsByDate }>();

          for (const row of rawRows) {
            if (!row || typeof row !== "object") continue;
            const parentArea = typeof row.parentArea === "string" ? row.parentArea : null;
            const boundaryType = typeof row.boundaryType === "string" ? row.boundaryType : null;
            const date = typeof row.date === "string" ? row.date : typeof row.date === "number" ? String(row.date) : null;
            if (!date) continue;
            const dataMap = normalizeDataMap(row.data);
            const ctxKey = `${parentArea ?? ""}|${boundaryType ?? ""}`;
            if (!byContext.has(ctxKey)) {
              byContext.set(ctxKey, { parentArea, boundaryType, rowsByDate: new Map() });
            }
            byContext.get(ctxKey)!.rowsByDate.set(date, dataMap);
          }

          const derivedRows: RootStatDataRow[] = [];
          let nonEmptyCount = 0;

          // For each context, compute percent change between startYear and endYear
          for (const [, ctx] of byContext) {
            const startData = ctx.rowsByDate.get(startYear);
            const endData = ctx.rowsByDate.get(endYear);
            if (!startData || !endData) continue;

            const changeData: Record<string, number> = {};
            for (const areaKey of Object.keys(endData)) {
              const startVal = startData[areaKey];
              const endVal = endData[areaKey];
              if (typeof startVal === "number" && typeof endVal === "number" && startVal !== 0) {
                // Percent change: (end - start) / |start|
                changeData[areaKey] = (endVal - startVal) / Math.abs(startVal);
              }
            }

            if (Object.keys(changeData).length > 0) {
              nonEmptyCount += 1;
              derivedRows.push({
                parentArea: ctx.parentArea,
                boundaryType: ctx.boundaryType,
                date: `${startYear}-${endYear}`,
                data: changeData,
              });
            }
          }

          if (nonEmptyCount === 0) {
            throw new Error(`No overlapping areas with data for both ${startYear} and ${endYear}.`);
          }

          const now = Date.now();
          const newStatId = createId();
          const autoName = payload.name.trim();
          const displayName = payload.label.trim();
          const trimmedCategory = payload.category.trim();
          const derivedSource = payload.description?.trim() || "Census Derived";

          newStatMeta = { id: newStatId, label: displayName || autoName };

          const txs: any[] = [
            db.tx.stats[newStatId].update({
              name: autoName,
              label: displayName,
              category: trimmedCategory,
              source: derivedSource,
              goodIfUp: null,
              featured: false,
              homeFeatured: false,
              active: true,
              createdOn: now,
              lastUpdated: now,
            }),
          ];

          for (const row of derivedRows) {
            txs.push(
              db.tx.statData[createId()].update({
                statId: newStatId,
                name: "root",
                parentArea: row.parentArea ?? undefined,
                boundaryType: row.boundaryType ?? undefined,
                date: row.date ?? undefined,
                type: "percent_change",
                data: row.data,
                source: derivedSource,
                statTitle: displayName,
                createdOn: now,
                lastUpdated: now,
              }),
            );
          }

          const batches: any[][] = [];
          for (let i = 0; i < txs.length; i += MAX_DERIVED_TX_BATCH) {
            batches.push(txs.slice(i, i + MAX_DERIVED_TX_BATCH));
          }

          for (const batch of batches) {
            attemptedWrite = true;
            await db.transact(batch);
          }

          setRecentStatIds((prev) => {
            const next = [newStatId, ...prev.filter((id) => id !== newStatId)];
            if (next.length > 50) next.length = 50;
            return next;
          });

          setIsDerivedModalOpen(false);
          setDerivedSelection([]);
          setDerivedAvailableYears([]);
          setSelectedStatIds([]);
          setSelectionAnchorId(null);
          setIsDerivedSubmitting(false);
          return;
        }

        // --- Multi-stat SUM formula: special handling ---
        if (payload.formula === "sum" && payload.sumOperandIds && payload.sumOperandIds.length >= 2) {
          const operandIds = payload.sumOperandIds.filter((id) => id && id.trim());
          if (operandIds.length < 2) {
            throw new Error("Select at least two stats to sum.");
          }

          // Fetch all data rows for the operand stats
          const { data: statDataResponse } = await db.queryOnce({
            statData: {
              $: {
                where: { name: "root", statId: { $in: operandIds } },
                fields: ["statId", "parentArea", "boundaryType", "date", "data"],
              },
            },
          });

          const rawRows = Array.isArray((statDataResponse as any)?.statData)
            ? ((statDataResponse as any).statData as any[])
            : [];

          // Group rows by statId, then by row key
          const perStat = new Map<string, Map<string, RootStatDataRow>>();
          const yearsByStat = new Map<string, Set<string>>();
          const boundaryTypesByStat = new Map<string, Set<string>>();

          for (const row of rawRows) {
            if (!row || typeof row !== "object") continue;
            const statId = typeof row.statId === "string" ? row.statId : null;
            if (!statId) continue;
            const parentArea = typeof row.parentArea === "string" ? row.parentArea : null;
            const boundaryType = typeof row.boundaryType === "string" ? row.boundaryType : null;
            const rawDate = row.date;
            const date =
              typeof rawDate === "string"
                ? rawDate
                : typeof rawDate === "number"
                ? String(rawDate)
                : null;
            const dataMap = normalizeDataMap((row as any).data);
            const normalized: RootStatDataRow = { parentArea, boundaryType, date, data: dataMap };
            const key = buildRowKey(normalized);
            if (!perStat.has(statId)) perStat.set(statId, new Map());
            perStat.get(statId)!.set(key, normalized);

            if (!yearsByStat.has(statId)) yearsByStat.set(statId, new Set<string>());
            if (!boundaryTypesByStat.has(statId)) boundaryTypesByStat.set(statId, new Set<string>());
            if (date) yearsByStat.get(statId)!.add(date);
            if (boundaryType) boundaryTypesByStat.get(statId)!.add(boundaryType);
          }

          // Collect all unique row keys across all operands
          const allRowKeys = new Set<string>();
          for (const [, rowMap] of perStat) {
            for (const key of rowMap.keys()) {
              allRowKeys.add(key);
            }
          }

          if (allRowKeys.size === 0) {
            throw new Error("No data found for the selected stats.");
          }

          // Compute sum for each row key
          const derivedRows: RootStatDataRow[] = [];
          let nonEmptyCount = 0;
          const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

          for (const key of allRowKeys) {
            // Get template row from first stat that has this key
            let templateRow: RootStatDataRow | null = null;
            for (const statId of operandIds) {
              const rowMap = perStat.get(statId);
              if (rowMap?.has(key)) {
                templateRow = rowMap.get(key)!;
                break;
              }
            }
            if (!templateRow) continue;

            // Collect all area keys across all operands for this row
            const allAreaKeys = new Set<string>();
            for (const statId of operandIds) {
              const rowMap = perStat.get(statId);
              const row = rowMap?.get(key);
              if (row?.data) {
                for (const areaKey of Object.keys(row.data)) {
                  allAreaKeys.add(areaKey);
                }
              }
            }

            // Sum values for each area
            const sumData: Record<string, number> = {};
            for (const areaKey of allAreaKeys) {
              let sum = 0;
              let hasAnyValue = false;
              for (const statId of operandIds) {
                const rowMap = perStat.get(statId);
                const row = rowMap?.get(key);
                const val = row?.data?.[areaKey];
                if (isFiniteNum(val)) {
                  sum += val;
                  hasAnyValue = true;
                }
              }
              if (hasAnyValue) {
                sumData[areaKey] = sum;
              }
            }

            if (Object.keys(sumData).length > 0) {
              nonEmptyCount += 1;
            }
            derivedRows.push({
              parentArea: templateRow.parentArea,
              boundaryType: templateRow.boundaryType,
              date: templateRow.date,
              data: sumData,
            });
          }

          if (nonEmptyCount === 0) {
            throw new Error("Selected stats have no overlapping area data to compute a sum.");
          }

          const now = Date.now();
          const newStatId = createId();
          const autoName = payload.name.trim();
          const displayName = payload.label.trim();
          const trimmedCategory = payload.category.trim();
          const derivedSource = payload.description?.trim() || "Census Derived";

          newStatMeta = { id: newStatId, label: displayName || autoName };

          const txs: any[] = [
            db.tx.stats[newStatId].update({
              name: autoName,
              label: displayName,
              category: trimmedCategory,
              source: derivedSource,
              goodIfUp: null,
              featured: false,
              active: true,
              createdOn: now,
              lastUpdated: now,
            }),
          ];

          for (const row of derivedRows) {
            txs.push(
              db.tx.statData[createId()].update({
                statId: newStatId,
                name: "root",
                parentArea: row.parentArea ?? undefined,
                boundaryType: row.boundaryType ?? undefined,
                date: row.date ?? undefined,
                type: "number",
                data: row.data,
                source: derivedSource,
                statTitle: displayName,
                createdOn: now,
                lastUpdated: now,
              }),
            );
          }

          const batches: any[][] = [];
          for (let i = 0; i < txs.length; i += MAX_DERIVED_TX_BATCH) {
            batches.push(txs.slice(i, i + MAX_DERIVED_TX_BATCH));
          }

          for (const batch of batches) {
            attemptedWrite = true;
            await db.transact(batch);
          }

          setRecentStatIds((prev) => {
            const next = [newStatId, ...prev.filter((id) => id !== newStatId)];
            if (next.length > 50) next.length = 50;
            return next;
          });

          setIsDerivedModalOpen(false);
          setDerivedSelection([]);
          setSelectedStatIds([]);
          setSelectionAnchorId(null);
          setIsDerivedSubmitting(false);
          return;
        }

        // --- Standard two-stat derived formula ---
        const numeratorMeta = stats.find((stat) => stat.id === payload.numeratorId);
        const denominatorMeta = stats.find((stat) => stat.id === payload.denominatorId);
        if (!numeratorMeta || !denominatorMeta) {
          throw new Error("Unable to locate selected stats.");
        }

        const statIds = [payload.numeratorId, payload.denominatorId];
        const { data: statDataResponse } = await db.queryOnce({
          statData: {
            $: {
              where: {
                name: "root",
                statId: { $in: statIds },
              },
              fields: ["statId", "parentArea", "boundaryType", "date", "data"],
            },
          },
        });

        const rawRows = Array.isArray((statDataResponse as any)?.statData)
          ? ((statDataResponse as any).statData as any[])
          : Array.isArray((statDataResponse as any)?.data?.statData)
          ? ((statDataResponse as any).data.statData as any[])
          : [];

        const perStat = new Map<string, Map<string, RootStatDataRow>>();
        const yearsByStat = new Map<string, Set<string>>();
        const boundaryTypesByStat = new Map<string, Set<string>>();

        for (const row of rawRows) {
          if (!row || typeof row !== "object") continue;
          const statId = typeof row.statId === "string" ? row.statId : null;
          if (!statId) continue;
          const parentArea = typeof row.parentArea === "string" ? row.parentArea : null;
          const boundaryType = typeof row.boundaryType === "string" ? row.boundaryType : null;
          const rawDate = row.date;
          const date =
            typeof rawDate === "string"
              ? rawDate
              : typeof rawDate === "number"
              ? String(rawDate)
              : null;
          const dataMap = normalizeDataMap((row as any).data);
          const normalized: RootStatDataRow = { parentArea, boundaryType, date, data: dataMap };
          const key = buildRowKey(normalized);
          if (!perStat.has(statId)) {
            perStat.set(statId, new Map());
          }
          perStat.get(statId)!.set(key, normalized);

          if (!yearsByStat.has(statId)) yearsByStat.set(statId, new Set<string>());
          if (!boundaryTypesByStat.has(statId)) boundaryTypesByStat.set(statId, new Set<string>());
          if (date) yearsByStat.get(statId)!.add(date);
          if (boundaryType) boundaryTypesByStat.get(statId)!.add(boundaryType);
        }

        const setEquals = (a?: Set<string>, b?: Set<string>): boolean => {
          if (!a && !b) return true;
          if (!a || !b) return false;
          if (a.size !== b.size) return false;
          for (const value of a) {
            if (!b.has(value)) return false;
          }
          return true;
        };

        const numYears = yearsByStat.get(payload.numeratorId);
        const denYears = yearsByStat.get(payload.denominatorId);
        const numBounds = boundaryTypesByStat.get(payload.numeratorId);
        const denBounds = boundaryTypesByStat.get(payload.denominatorId);

        if (!setEquals(numYears, denYears) || !setEquals(numBounds, denBounds)) {
          const parts: string[] = [];
          if (!setEquals(numYears, denYears)) {
            const numList = Array.from(numYears ?? []).sort().join(", ") || "none";
            const denList = Array.from(denYears ?? []).sort().join(", ") || "none";
            parts.push(`years (numerator: ${numList}, denominator: ${denList})`);
          }
          if (!setEquals(numBounds, denBounds)) {
            const numList = Array.from(numBounds ?? []).sort().join(", ") || "none";
            const denList = Array.from(denBounds ?? []).sort().join(", ") || "none";
            parts.push(`boundary types (numerator: ${numList}, denominator: ${denList})`);
          }
          throw new Error(
            `These stats can't be combined: they have different ${parts.join(" and ")}.`,
          );
        }

        const numeratorRows = perStat.get(payload.numeratorId);
        const denominatorRows = perStat.get(payload.denominatorId);
        if (!numeratorRows?.size || !denominatorRows?.size) {
          throw new Error("Missing data for one of the selected stats.");
        }

        const derivedRows: RootStatDataRow[] = [];
        let nonEmptyCount = 0;

        // Use B stat (denominator/second) as canonical coverage: iterate its row keys
        // and compute derived values where A stat data exists.
        for (const [key, bRow] of denominatorRows.entries()) {
          const aRow = numeratorRows.get(key);
          const derivedData = computeDerivedValues(aRow?.data ?? {}, bRow.data, payload.formula);
          if (Object.keys(derivedData).length > 0) {
            nonEmptyCount += 1;
          }
          derivedRows.push({
            parentArea: bRow.parentArea,
            boundaryType: bRow.boundaryType,
            date: bRow.date,
            data: derivedData,
          });
        }

        if (nonEmptyCount === 0) {
          throw new Error(
            "Selected stats have no overlapping area data to compute a derived value.",
          );
        }

        const now = Date.now();
        const newStatId = createId();
        // payload.name is auto-generated like "(Numerator ÷ Denominator)"
        // payload.label is the user-entered display name (required)
        const autoName = payload.name.trim();
        const displayName = payload.label.trim();
        const trimmedCategory = payload.category.trim();
        // payload.description is always "Census Derived" now
        const derivedSource = payload.description?.trim() || "Census Derived";

        newStatMeta = { id: newStatId, label: displayName || autoName };

        const txs: any[] = [
          db.tx.stats[newStatId].update({
            name: autoName,
            label: displayName,
            category: trimmedCategory,
            source: derivedSource,
            goodIfUp: null,
            featured: false,
            homeFeatured: false,
            active: true,
            createdOn: now,
            lastUpdated: now,
          }),
        ];

        for (const row of derivedRows) {
          txs.push(
            db.tx.statData[createId()].update({
              statId: newStatId,
              name: "root",
              parentArea: row.parentArea ?? undefined,
              boundaryType: row.boundaryType ?? undefined,
              date: row.date ?? undefined,
              type: formulaToStatType[payload.formula],
              data: row.data,
              source: derivedSource,
              statTitle: displayName,
              createdOn: now,
              lastUpdated: now,
            }),
          );
        }

        const batches: any[][] = [];
        for (let i = 0; i < txs.length; i += MAX_DERIVED_TX_BATCH) {
          batches.push(txs.slice(i, i + MAX_DERIVED_TX_BATCH));
        }

        for (const batch of batches) {
          attemptedWrite = true;
          await db.transact(batch);
        }

        setRecentStatIds((prev) => {
          const next = [newStatId, ...prev.filter((id) => id !== newStatId)];
          if (next.length > 50) next.length = 50;
          return next;
        });

        setIsDerivedModalOpen(false);
        setDerivedSelection([]);
        setSelectedStatIds([]);
        setSelectionAnchorId(null);
      } catch (err) {
        console.error("Failed to create derived stat", err);
        const timeout = err instanceof Error && err.message.includes("Operation timed out");
        if (timeout && attemptedWrite && newStatMeta) {
          const meta = newStatMeta;
          setPendingDerivedJobs((prev) => {
            if (prev.some((job) => job.id === meta.id)) return prev;
            return [
              ...prev,
              {
                id: meta.id,
                label: meta.label,
                createdAt: Date.now(),
              },
            ];
          });

          // Close modal and clear selection; job crumb will track completion
          setIsDerivedModalOpen(false);
          setDerivedSelection([]);
          setDerivedAvailableYears([]);
          setSelectedStatIds([]);
          setSelectionAnchorId(null);
          setDerivedError(null);
        } else {
          const partialMessage = attemptedWrite
            ? " Some data may have been written before this error. If this derived stat now appears in the list, it may have incomplete area coverage."
            : "";
          const baseMessage = timeout
            ? "Saving the derived stat to the database took too long (operation timed out)."
            : "Failed to create derived stat.";

          if (err instanceof Error && err.message) {
            setDerivedError(`${baseMessage} ${err.message}${partialMessage}`);
          } else {
            setDerivedError(`${baseMessage}${partialMessage}`);
          }
        }
      } finally {
        setIsDerivedSubmitting(false);
      }
    },
    [stats],
  );

  // (definition moved above)

  const [statDataSummaryByStatId, setStatDataSummaryByStatId] = useState<
    Map<string, StatDataSummary>
  >(new Map());

  useEffect(() => {
    const rows = (statDataResponse?.statData ?? []) as any[];
    // If there are no rows (e.g. transient error), keep the last successful summaries
    if (!rows.length) return;

    const map = new Map<string, StatDataSummary>();

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

    setStatDataSummaryByStatId(map);
  }, [statDataResponse?.statData]);

  // Available years per stat id for derived modal (from summaries + single-stat fallback)
  const derivedAvailableYearsByStat = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const opt of derivedSelection) {
      const summary = statDataSummaryByStatId.get(opt.id);
      if (summary && summary.years.length) {
        result[opt.id] = summary.years;
      }
    }
    if (derivedSelection.length === 1) {
      const only = derivedSelection[0];
      if (!result[only.id] && derivedAvailableYears.length) {
        result[only.id] = [...derivedAvailableYears];
      }
    }
    return result;
  }, [derivedSelection, statDataSummaryByStatId, derivedAvailableYears]);

  // Clear pending derived jobs when their stats appear in the stats list
  useEffect(() => {
    if (!pendingDerivedJobs.length || !stats.length) return;
    setPendingDerivedJobs((prev) => {
      const remaining = prev.filter((job) => !stats.some((s) => s.id === job.id));
      return remaining.length === prev.length ? prev : remaining;
    });
  }, [stats, pendingDerivedJobs.length]);

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
            homeFeatured: form.homeFeatured,
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
        const rows = (statDataResponse?.statData ?? []).filter(
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
    [statDataResponse?.statData, deletingId],
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

  const dismissPendingJob = useCallback((jobId: string) => {
    setPendingDerivedJobs((prev) => prev.filter((job) => job.id !== jobId));
  }, []);

  // Loading state - only block on stats (primary query)
  if (statsLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white dark:bg-slate-900">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-brand-500 dark:border-slate-700 dark:border-t-brand-400" />
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading stats…</p>
        </div>
      </div>
    );
  }

  // Error state - only block on stats error (statData errors are non-fatal)
  if (statsError) {
    const anyError = statsError as any;
    const debugParts: string[] = [];
    if (anyError.code) debugParts.push(`code=${String(anyError.code)}`);
    if (anyError.operation) debugParts.push(`operation=${String(anyError.operation)}`);
    const debugLine = debugParts.length ? debugParts.join(" · ") : null;

    return (
      <div className="flex h-full w-full items-center justify-center bg-white dark:bg-slate-900">
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-sm font-medium text-rose-600 dark:text-rose-400">Failed to load stats</p>
          <p className="text-xs text-slate-500 dark:text-slate-400">{statsError.message}</p>
          {IS_DEV && debugLine && (
            <p className="text-[10px] text-slate-400 dark:text-slate-500">{debugLine}</p>
          )}
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
              {statDataLoading && <span className="ml-1 text-slate-400">· loading summaries…</span>}
              {statDataError && !statDataLoading && statDataSummaryByStatId.size === 0 && (
                <span className="ml-1 text-amber-500">
                  · summaries unavailable{" "}
                  <button
                    type="button"
                    onClick={retryStatData}
                    className="text-brand-500 underline hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
                  >
                    retry
                  </button>
                </span>
              )}
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

          {/* Right: actions */}
          <div className="flex shrink-0 items-center gap-2">
            {/* Selection mode toggle / X selected chip */}
            {isSelectionMode || selectedCount > 0 ? (
              <button
                type="button"
                onClick={handleClearSelection}
                className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 text-[11px] font-medium text-brand-600 transition hover:bg-brand-100 dark:border-brand-500/40 dark:bg-brand-900/30 dark:text-brand-300 dark:hover:bg-brand-900/50"
              >
                <span>{selectedCount} selected</span>
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsSelectionMode(true)}
                className="rounded-full border border-slate-200 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                Select Stats
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsNewStatOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-2 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900 sm:px-3 sm:py-1.5"
            >
              <span className="text-sm leading-none">+</span>
              <span>Import Stat</span>
            </button>
            <button
              type="button"
              onClick={handleRequestDerivedStat}
              className="inline-flex items-center gap-1 rounded-lg border border-brand-400 px-2 py-1 text-xs font-medium text-brand-600 shadow-sm transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 dark:border-brand-300 dark:text-brand-200 dark:hover:bg-brand-900/20 dark:focus:ring-brand-800/70 sm:px-3 sm:py-1.5"
            >
              <svg
                className="h-3 w-3"
                viewBox="0 0 20 20"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M10 4v12m6-6H4"
                  stroke="currentColor"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>Create Stat</span>
            </button>
          </div>
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
          <div className="mx-auto flex max-w-4xl select-none flex-col gap-3">
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
                isSelected={selectedIdSet.has(stat.id)}
                onToggleSelect={(event) => handleToggleSelect(stat.id, event)}
                selectionMode={isSelectionMode}
                categoryOptions={statCategoryOptions}
              />
            ))}
          </div>
        )}
      </div>
      <NewStatModal
        isOpen={isNewStatOpen}
        onClose={() => setIsNewStatOpen(false)}
        onImported={handleImportedFromModal}
        categoryOptions={statCategoryOptions}
      />
      <DerivedStatModal
        isOpen={isDerivedModalOpen}
        stats={derivedSelection}
        categories={statCategoryOptions.map((c) => c.value)}
        availableYears={derivedAvailableYears}
        availableYearsByStat={derivedAvailableYearsByStat}
        onClose={handleDerivedModalClose}
        onSubmit={handleDerivedSubmit}
        isSubmitting={isDerivedSubmitting}
        errorMessage={derivedError}
      />
      {pendingDerivedJobs.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center">
          <div className="pointer-events-auto flex max-w-md flex-col gap-1 rounded-lg bg-slate-900/90 px-3 py-2 text-xs text-slate-100 shadow-lg ring-1 ring-slate-700">
            {pendingDerivedJobs.map((job) => (
              <div key={job.id} className="flex items-center gap-2">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-slate-500 border-t-brand-400" />
                <div className="flex-1 truncate">
                  Finishing derived stat <span className="font-semibold">{job.label || "Derived stat"}</span>…
                </div>
                <button
                  type="button"
                  onClick={() => dismissPendingJob(job.id)}
                  className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  aria-label="Dismiss job"
                >
                  <svg className="h-3 w-3" viewBox="0 0 24 24" stroke="currentColor" fill="none">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
