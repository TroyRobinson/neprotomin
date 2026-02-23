import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent, ChangeEvent, MouseEvent } from "react";
import { id as createId, lookup } from "@instantdb/react";
import { db } from "../../lib/reactDb";
import { getEnvString, isDevEnv } from "../../lib/env";
import { useAuthSession } from "../hooks/useAuthSession";
import { useCategories } from "../hooks/useCategories";
import { useCensusImportQueue } from "../hooks/useCensusImportQueue";
import type { Category } from "../../types/organization";
import type { Stat, StatRelation, StatVisibility } from "../../types/stat";
import { UNDEFINED_STAT_ATTRIBUTE, buildEffectiveStatMetaById, normalizeStatVisibility } from "../../types/stat";
import type { ImportQueueItem, ImportRelationship } from "../types/censusImport";
import { CustomSelect } from "./CustomSelect";
import {
  DerivedStatModal,
  type DerivedFormulaKind,
  type DerivedStatModalSubmit,
  type DerivedStatOption,
} from "./DerivedStatModal";
import { AdminOrgsPanel } from "./AdminOrgsPanel";
import { ChevronDownIcon } from "@heroicons/react/24/outline";

// Stat item from InstantDB stats table
interface StatItem {
  id: string;
  name: string;
  label?: string | null; // Human-friendly display label
  description?: string | null;
  category: string;
  neId?: string | null;
  source?: string | null;
  goodIfUp?: boolean | null;
  pointsOfInterestEnabled?: boolean | null;
  featured?: boolean | null;
  homeFeatured?: boolean | null;
  visibility?: StatVisibility | null;
  visibilityEffective?: StatVisibility | null;
  createdBy?: string | null;
  active?: boolean | null;
  createdOn?: number | null;
  lastUpdated?: number | null;
}

interface StatDataSummary {
  boundaryTypes: string[];
  boundaryLabel: string;
  latestDate: string | null;
  yearsLabel: string;
  updatedAt: number | null;
  contextsCount: number;
  sample:
    | {
        parentArea: string;
        boundaryType: string;
        date: string;
        minDate?: string;
        maxDate?: string;
        type: string;
        count: number;
        sum: number;
        avg: number;
        min: number;
        max: number;
        updatedAt: number;
      }
    | null;
}

interface RootStatDataRow {
  parentArea: string | null;
  boundaryType: string | null;
  date: string | null;
  data: Record<string, number>;
}

const buildStatDataSummaryKey = (
  statId: string,
  name: string,
  parentArea: string | null | undefined,
  boundaryType: string | null | undefined,
) => `${statId}::${name}::${parentArea ?? ""}::${boundaryType ?? ""}`;

const computeSummaryFromData = (data: Record<string, number>) => {
  let count = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of Object.values(data ?? {})) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    count += 1;
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (count === 0) {
    return { count: 0, sum: 0, avg: 0, min: 0, max: 0 };
  }
  return { count, sum, avg: sum / count, min, max };
};

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

const formatMetricValue = (value: number): string =>
  value.toLocaleString(undefined, { maximumFractionDigits: 2 });

const formatYearRangeLabel = (minDate: string | null, maxDate: string | null): string => {
  if (!minDate && !maxDate) return "";
  const min = minDate ?? maxDate ?? "";
  const max = maxDate ?? minDate ?? "";
  if (!min || !max) return min || max;
  if (min === max) return min;
  return `${min}–${max}`;
};

const shouldPreferAvgMetric = (type: string): boolean => {
  const normalized = type.toLowerCase();
  return (
    normalized.includes("percent") ||
    normalized.includes("rate") ||
    normalized.includes("ratio") ||
    normalized.includes("index")
  );
};

const normalizeStatTypeLabel = (rawType: string | null | undefined): string | null => {
  if (!rawType) return null;
  const normalized = rawType.toLowerCase();
  if (normalized.includes("percent")) return "percent";
  if (normalized.includes("rate")) return "rate";
  if (normalized.includes("ratio")) return "ratio";
  if (normalized.includes("currency")) return "currency";
  if (normalized.includes("years")) return "years";
  if (normalized.includes("count") || normalized.includes("number")) return "count";
  return normalized.trim() || null;
};

const inferStatTypeLabelFromText = (text: string): string | null => {
  const normalized = text.toLowerCase();
  if (normalized.includes("percent") || normalized.includes("%")) return "percent";
  if (normalized.includes("rate")) return "rate";
  if (normalized.includes("ratio")) return "ratio";
  if (normalized.includes("currency") || normalized.includes("dollar")) return "currency";
  if (normalized.includes("years") || normalized.includes("year")) return "years";
  return null;
};

const buildOriginalStatName = (stat: StatItem, summary?: StatDataSummary): string => {
  const baseName = stat.name || "";
  const neId = typeof stat.neId === "string" ? stat.neId.trim() : "";
  if (!neId.startsWith("census:")) return baseName;
  const variable = neId.slice("census:".length).trim();
  const typeLabel =
    normalizeStatTypeLabel(summary?.sample?.type) ??
    inferStatTypeLabelFromText(`${stat.name} ${stat.label ?? ""}`);
  const prefixParts = [variable, typeLabel].filter(Boolean);
  const prefix = prefixParts.join(" ");
  if (!prefix) return baseName;
  if (!baseName) return prefix;
  return `${prefix} · ${baseName}`;
};

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
    description: typeof r.description === "string" && r.description.trim() ? r.description : null,
    category: r.category,
    neId: typeof r.neId === "string" ? r.neId : null,
    source: typeof r.source === "string" ? r.source : null,
    goodIfUp: typeof r.goodIfUp === "boolean" ? r.goodIfUp : null,
    pointsOfInterestEnabled:
      typeof r.pointsOfInterestEnabled === "boolean" ? r.pointsOfInterestEnabled : null,
    featured: typeof r.featured === "boolean" ? r.featured : null,
    homeFeatured: typeof r.homeFeatured === "boolean" ? r.homeFeatured : null,
    visibility: normalizeStatVisibility(r.visibility) ?? null,
    visibilityEffective: normalizeStatVisibility(r.visibilityEffective) ?? null,
    createdBy: typeof r.createdBy === "string" ? r.createdBy : null,
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
type VisibilityInput = StatVisibility | "inherit";

interface EditFormState {
  label: string;
  name: string;
  description: string;
  category: string;
  source: string;
  goodIfUp: boolean | null;
  pointsOfInterestEnabled: boolean;
  visibility: VisibilityInput;
  featured: boolean | null;
  homeFeatured: boolean | null;
}

type PoiActionState = "idle" | "running" | "success" | "error";

interface PoiStatus {
  state: PoiActionState;
  message?: string | null;
  updatedAt?: number | null;
}

interface PendingDerivedJob {
  id: string; // statId
  label: string;
  createdAt: number;
}

const createEditForm = (stat: StatItem, hasParent: boolean): EditFormState => {
  const declaredVisibility = normalizeStatVisibility(stat.visibility);
  const legacyInactive = declaredVisibility ? null : stat.active === false ? "inactive" : null;
  const visibility = declaredVisibility ?? legacyInactive ?? (hasParent ? "inherit" : "public");
  return {
    label: stat.label ?? "",
    name: stat.name,
    description: stat.description ?? "",
    category: stat.category,
    source: stat.source ?? "",
    goodIfUp: stat.goodIfUp ?? null,
    pointsOfInterestEnabled: stat.pointsOfInterestEnabled === true,
    visibility,
    featured: stat.featured ?? null,
    homeFeatured: stat.homeFeatured ?? null,
  };
};

// Stat list item props
interface StatListItemProps {
  stat: StatItem;
  isEditing: boolean;
  summary?: StatDataSummary;
  summaryLoading?: boolean;
  summaryRequested?: boolean;
  onShowSummaryHelp?: () => void;
  isDeleting?: boolean;
  onStartEdit: () => void;
  onSave: (form: EditFormState) => void;
  onCancel: () => void;
  onDelete?: () => void;
  isSelected?: boolean;
  onToggleSelect?: (event: MouseEvent<HTMLDivElement>) => void;
  selectionMode?: boolean;
  categoryOptions: Array<{ value: string; label: string }>;
  hasParent?: boolean;
  effectiveVisibility?: StatVisibility;
  hasChildren?: boolean;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  childrenCount?: number;
  onUnlink?: () => void;
  poiInfo?: { activeCount: number; lastComputedAt: number | null };
  poiStatus?: PoiStatus | null;
  onRecalculatePoi?: () => void;
  poiBusy?: boolean;
}

// Stat list item component with bar shape and curved corners
const StatListItem = ({
  stat,
  isEditing,
  summary,
  summaryLoading,
  summaryRequested,
  onShowSummaryHelp,
  isDeleting,
  onStartEdit,
  onSave,
  onCancel,
  onDelete,
  isSelected,
  onToggleSelect,
  selectionMode,
  categoryOptions,
  hasParent = false,
  effectiveVisibility,
  hasChildren = false,
  isExpanded = false,
  onToggleExpand,
  childrenCount = 0,
  onUnlink,
  poiInfo,
  poiStatus,
  onRecalculatePoi,
  poiBusy = false,
}: StatListItemProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<EditFormState>(() => createEditForm(stat, hasParent));
  const sampleMetric =
    summary?.sample
      ? (() => {
          const preferAvg = shouldPreferAvgMetric(summary.sample.type);
          const value = preferAvg ? summary.sample.avg : summary.sample.sum;
          return { label: preferAvg ? "Average" : "Total", value };
        })()
      : null;
  const summaryYearsDisplay =
    summary?.yearsLabel && summary.yearsLabel.trim() ? summary.yearsLabel : summary?.latestDate ?? null;
  const declaredVisibility = normalizeStatVisibility(stat.visibility);
  const effectiveVisibilityValue =
    effectiveVisibility ?? declaredVisibility ?? (stat.active === false ? "inactive" : "public");
  const visibilityLabel = (() => {
    const pretty =
      effectiveVisibilityValue === "public"
        ? "Public"
        : effectiveVisibilityValue === "private"
        ? "Private"
        : "Inactive";
    if (hasParent && !declaredVisibility) return `Inherited: ${pretty}`;
    return pretty;
  })();
  const visibilityBadgeClass =
    effectiveVisibilityValue === "public"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : effectiveVisibilityValue === "private"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400";
  const visibilityOptions = hasParent
    ? [
        { value: "inherit", label: "Inherit (parent)" },
        { value: "private", label: "Private" },
        { value: "public", label: "Public" },
        { value: "inactive", label: "Inactive" },
      ]
    : [
        { value: "private", label: "Private" },
        { value: "public", label: "Public" },
        { value: "inactive", label: "Inactive" },
      ];

  // Reset form when entering edit mode or when stat changes
  useEffect(() => {
    if (isEditing) {
      setForm(createEditForm(stat, hasParent));
    }
  }, [isEditing, stat, hasParent]);

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
    const handleClick = (e: MouseEvent<HTMLDivElement>) => {
      const wantsSelection =
        !!onToggleSelect && (selectionMode || e.metaKey || e.ctrlKey || e.shiftKey);
      if (wantsSelection && onToggleSelect) {
        e.preventDefault();
        e.stopPropagation();
        onToggleSelect(e);
        return;
      }
      if (hasChildren && onToggleExpand) {
        e.preventDefault();
        onToggleExpand();
        return;
      }
      onStartEdit();
    };

    return (
      <div
        ref={containerRef}
        onClick={handleClick}
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
          <div className="flex items-center gap-2">
            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
              {stat.category}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onStartEdit();
              }}
              className="rounded-full border border-slate-200 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Edit
            </button>
            {hasChildren && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleExpand?.();
                }}
                className="whitespace-nowrap rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-700"
              >
                {isExpanded ? "Hide children" : `Show ${childrenCount} child${childrenCount === 1 ? "" : "ren"}`}
              </button>
            )}
            {onUnlink && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onUnlink();
                }}
                className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 shadow-sm transition hover:bg-rose-50 hover:text-rose-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
              >
                Unlink
              </button>
            )}
          </div>
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
          {stat.pointsOfInterestEnabled && (
            <span className="flex items-center gap-1">
              <span className="font-medium">POI:</span>
              <span>
                {poiInfo?.activeCount ?? 0} active
                {typeof poiInfo?.lastComputedAt === "number" && Number.isFinite(poiInfo.lastComputedAt)
                  ? ` · ${formatDate(poiInfo.lastComputedAt)}`
                  : ""}
              </span>
            </span>
          )}
          {summary && summaryYearsDisplay && (
            <span className="flex items-center gap-1">
              <span className="font-medium">Data:</span>
              <span>{summaryYearsDisplay}</span>
              {summary.boundaryLabel && (
                <span className="text-slate-400 dark:text-slate-500">· {summary.boundaryLabel}</span>
              )}
            </span>
          )}
          {!summary?.latestDate && summaryRequested && summaryLoading && (
            <span className="flex items-center gap-1 text-sm text-slate-400 dark:text-slate-500">
              <span className="font-medium">Data:</span>
              <span>loading…</span>
            </span>
          )}
          {!summary?.latestDate && summaryRequested && !summaryLoading && (
            <span className="flex items-center gap-1 text-sm text-slate-400 dark:text-slate-500">
              <span className="font-medium">Data:</span>
              <span>none</span>
              {onShowSummaryHelp && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onShowSummaryHelp();
                  }}
                  className="ml-1 text-brand-500 underline hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
                >
                  backfill summaries
                </button>
              )}
            </span>
          )}
        </div>

        {/* Status badges and dates row */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 font-medium ${visibilityBadgeClass}`}>
            {visibilityLabel}
          </span>
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
          {stat.pointsOfInterestEnabled && (
            <span className="rounded-full bg-indigo-100 px-2 py-0.5 font-medium text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300">
              Points of interest
            </span>
          )}
          {poiStatus?.state === "running" && (
            <span className="text-amber-600 dark:text-amber-400">POI recalculating…</span>
          )}
          {poiStatus?.state === "success" && poiStatus.message && (
            <span className="text-emerald-600 dark:text-emerald-400">{poiStatus.message}</span>
          )}
          {poiStatus?.state === "error" && poiStatus.message && (
            <span className="text-rose-600 dark:text-rose-400">{poiStatus.message}</span>
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
      className="select-text flex flex-col gap-3 rounded-xl border-2 border-brand-400 bg-white px-4 py-3 shadow-lg ring-2 ring-brand-100 dark:border-brand-500 dark:bg-slate-800 dark:ring-brand-900/50"
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
        <div className="select-text flex gap-4 text-[10px] text-slate-400 dark:text-slate-500">
          {form.name && <span>Original: {buildOriginalStatName(stat, summary)}</span>}
          {form.source && <span>Source: {form.source}</span>}
        </div>
      </div>

      {!hasParent ? (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Description <span className="text-slate-400 dark:text-slate-500">(sidebar stat text)</span>
          </label>
          <textarea
            value={form.description}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleChange("description", e.target.value)}
            placeholder="Short explanation shown in the selected stat panel..."
            rows={3}
            className="min-h-[76px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-brand-500 dark:focus:ring-brand-900/50"
          />
        </div>
      ) : (
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Description is shown from the top-level parent stat. Edit it on the parent card.
        </p>
      )}

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

        {/* Visibility, Featured, and Home default */}
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Visibility</label>
            <CustomSelect
              value={form.visibility}
              onChange={(val) => handleChange("visibility", val as VisibilityInput)}
              options={visibilityOptions}
              className="min-w-[140px]"
            />
          </div>
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

        <div className="flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.pointsOfInterestEnabled === true}
              onChange={(e) => handleChange("pointsOfInterestEnabled", e.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400 dark:border-slate-600 dark:bg-slate-700"
            />
            Points of Interest
          </label>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Stores high/low map points for Oklahoma, Tulsa Area, and OKC Area.
          </p>
          {onRecalculatePoi && (
            <button
              type="button"
              onClick={onRecalculatePoi}
              disabled={!form.pointsOfInterestEnabled || poiBusy}
              className="mt-1 self-start rounded-md border border-indigo-200 px-2 py-1 text-[11px] font-medium text-indigo-700 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-300 dark:hover:bg-indigo-950/40"
            >
              {poiBusy ? "Recalculating…" : "Recalculate now"}
            </button>
          )}
          {poiStatus?.state === "success" && poiStatus.message && (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400">{poiStatus.message}</p>
          )}
          {poiStatus?.state === "error" && poiStatus.message && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400">{poiStatus.message}</p>
          )}
        </div>
      </div>

      {/* Info section: Years, Areas, IDs - compact inline */}
      <div className="mt-2 select-text rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {summary && summary.latestDate && (
            <span>
              <span className="font-medium">Latest:</span> {summary.latestDate}
            </span>
          )}
          {summary && summary.yearsLabel && (
            <span>
              <span className="font-medium">Years:</span> {summary.yearsLabel}
            </span>
          )}
          {summary && summary.boundaryLabel && (
            <span>
              <span className="font-medium">Areas:</span> {summary.boundaryLabel}
            </span>
          )}
          {summary && summary.sample && sampleMetric && (
            <span>
              <span className="font-medium">Sample:</span>{" "}
              {summary.sample.boundaryType} · {summary.sample.count.toLocaleString()} areas with data · {sampleMetric.label} {formatMetricValue(sampleMetric.value)}
            </span>
          )}
          {typeof summary?.updatedAt === "number" && Number.isFinite(summary.updatedAt) && (
            <span>
              <span className="font-medium">Summary updated:</span> {formatDate(summary.updatedAt)}
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
              <span className="font-medium">Summary contexts:</span> {summary.contextsCount.toLocaleString()}
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
  statLabel?: string;
  zipCount: number;
  countyCount: number;
};

type CensusPreviewMeta = {
  dataset: string;
  group: string;
  year: number;
  universe: string | null;
  concept: string | null;
};

const formatPredicateTypeLabel = (predicateType?: string | null): string | null => {
  if (!predicateType) return null;
  const normalized = predicateType.trim().toLowerCase();
  if (!normalized) return null;
  if (["int", "integer", "long", "short"].includes(normalized)) return "Whole number";
  if (["float", "double", "decimal"].includes(normalized)) return "Decimal number";
  if (["string", "str"].includes(normalized)) return "Text";
  if (["boolean", "bool"].includes(normalized)) return "Yes/No";
  if (normalized === "number") return "Number";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
};

const inferUniverseFromConcept = (concept?: string | null): string | null => {
  if (!concept) return null;
  const normalized = concept.trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  const markers = [" for the ", " for ", " among the ", " among "];
  let bestIndex = -1;
  let bestMarker = "";
  for (const marker of markers) {
    const idx = lower.lastIndexOf(marker);
    if (idx > bestIndex) {
      bestIndex = idx;
      bestMarker = marker;
    }
  }
  if (bestIndex === -1) return null;
  const candidate = normalized.slice(bestIndex + bestMarker.length).trim();
  return candidate || null;
};

// Category options are now fetched from InstantDB via useCategories hook

// Heuristic: group IDs are typically like B22003, S1701, DP02, etc.
const looksLikeGroupId = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Common patterns: B, C, S, DP, CP prefixes followed by digits
  return /^[A-Z]{1,2}\d{3,5}[A-Z]?$/i.test(trimmed);
};

const DEFAULT_CENSUS_DATASET: string = "acs/acs5";

// Auto-pick the correct Census dataset for common group prefixes when the user keeps the default.
const inferDatasetForGroup = (group: string, dataset: string): { dataset: string; changed: boolean } => {
  const trimmedGroup = group.trim().toUpperCase();
  const normalizedDataset: string = dataset.trim() || DEFAULT_CENSUS_DATASET;
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

interface AISuggestion {
  groupNumber: string;
  statIds?: string[] | null;
  // Back-compat: older API response shape
  statId?: string | null;
  reason: string;
}

interface GroupSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  dataset: string;
  year: number;
  onPreview?: (groupOverride?: string, suggestedStatIds?: string[] | null) => void; // Called when Enter pressed with a group ID
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
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
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

  const handleSearch = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || looksLikeGroupId(trimmed)) return;

    setIsSearching(true);
    setSearchError(null);
    setAiSuggestion(null);

    try {
      // Call both Census groups API and OpenRouter AI in parallel
      const [groupsResponse, aiResponse] = await Promise.allSettled([
        fetch(`/api/census-groups?${new URLSearchParams({
          dataset,
          year: String(year),
          search: trimmed,
          limit: "15",
        }).toString()}`).then(res => res.json()),
        fetch('/api/ai-census-suggest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: trimmed, dataset, year }),
        }).then(res => res.json()),
      ]);

      // Handle Census groups results
      if (groupsResponse.status === 'fulfilled' && groupsResponse.value) {
        const groups = Array.isArray(groupsResponse.value.groups) ? groupsResponse.value.groups : [];
        setResults(
          groups.map((g: any) => ({
            name: typeof g.name === "string" ? g.name : "",
            description: typeof g.description === "string" ? g.description : "",
          }))
        );
      } else {
        setResults([]);
      }

      // Handle AI suggestion
      if (aiResponse.status === 'fulfilled' && aiResponse.value?.groupNumber) {
        const statIds = Array.isArray(aiResponse.value.statIds)
          ? aiResponse.value.statIds.filter((v: unknown) => typeof v === "string")
          : null;
        const fallbackStatId = typeof aiResponse.value.statId === "string" ? aiResponse.value.statId : null;
        const normalizedStatIds =
          statIds && statIds.length ? statIds : fallbackStatId ? [fallbackStatId] : null;

        setAiSuggestion({
          groupNumber: aiResponse.value.groupNumber,
          statIds: normalizedStatIds,
          statId: fallbackStatId,
          reason: aiResponse.value.reason || "AI suggested group",
        });
      }

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
  }, [value, dataset, year]);

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

  const handleSelectGroup = (groupName: string, suggestedStatIds?: string[] | null) => {
    onChange(groupName);
    setIsDropdownOpen(false);
    setResults([]);
    setHighlightedIndex(-1);
    setAiSuggestion(null);
    // Auto-trigger search after selecting a group (pass groupName directly since state update is async)
    if (onPreview) {
      onPreview(groupName, suggestedStatIds ?? null);
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

          {/* AI Suggestion - highlighted at top */}
          {aiSuggestion && (
            <button
              type="button"
              onClick={() =>
                handleSelectGroup(
                  aiSuggestion.groupNumber,
                  aiSuggestion.statIds && aiSuggestion.statIds.length
                    ? aiSuggestion.statIds
                    : aiSuggestion.statId
                      ? [aiSuggestion.statId]
                      : null
                )
              }
              className="flex w-full flex-col gap-1 border-b-2 border-brand-200 bg-gradient-to-r from-brand-50 to-purple-50 px-3 py-2.5 text-left transition hover:from-brand-100 hover:to-purple-100 dark:border-brand-700 dark:from-brand-900/40 dark:to-purple-900/40 dark:hover:from-brand-900/60 dark:hover:to-purple-900/60"
            >
              <div className="flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5 shrink-0 text-brand-500 dark:text-brand-400" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 5.757a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464A1 1 0 106.464 5.05l-.707-.707a1 1 0 00-1.414 1.414l.707.707zM5 10a1 1 0 01-1 1H3a1 1 0 110-2h1a1 1 0 011 1zM8 16v-1h4v1a2 2 0 11-4 0zM12 14c.015-.34.208-.646.477-.859a4 4 0 10-4.954 0c.27.213.462.519.476.859h4.002z" />
                </svg>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-600 dark:text-brand-400">
                  AI Suggestion
                </span>
              </div>
              <span className="text-xs font-medium text-slate-800 dark:text-slate-100">
                {aiSuggestion.groupNumber}
              </span>
              <span className="line-clamp-2 text-[10px] text-slate-600 dark:text-slate-300">
                {aiSuggestion.reason}
              </span>
            </button>
          )}

          {!searchError && !aiSuggestion && results.length === 0 && (
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

const HighlightMatch = ({ text, filter }: { text: string; filter: string }) => {
  if (!filter.trim()) return <>{text}</>;
  const terms = filter.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return <>{text}</>;

  // Escape special regex characters and join terms
  const escapedTerms = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`(${escapedTerms.join("|")})`, "gi");
  const testRegex = new RegExp(`^(${escapedTerms.join("|")})$`, "i");
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        testRegex.test(part) ? (
          <strong key={i} className="font-bold text-slate-900 dark:text-white">
            {part}
          </strong>
        ) : (
          part
        ),
      )}
    </>
  );
};

interface NewStatModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImported: (statIds: string[]) => void;
  categoryOptions: Array<{ value: string; label: string }>;
  user?: { id?: string | null } | null;
  existingCensusStats: Map<
    string,
    { id: string; name: string; label: string | null | undefined }
  >;
  availableStats: StatItem[];
}

const NewStatModal = ({
  isOpen,
  onClose,
  onImported,
  categoryOptions,
  user,
  existingCensusStats,
  availableStats,
}: NewStatModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const groupInputRef = useRef<HTMLInputElement>(null);
  const [runGroupSearch, setRunGroupSearch] = useState<(() => void) | null>(null);
  const [dataset, setDataset] = useState("acs/acs5");
  const [group, setGroup] = useState("");
  const [year, setYear] = useState(2023);
  const [limit, setLimit] = useState(50);
  const [category, setCategory] = useState<Category | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [resultsFilter, setResultsFilter] = useState("");

  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [variables, setVariables] = useState<CensusVariablePreview[]>([]);
  const [previewMeta, setPreviewMeta] = useState<CensusPreviewMeta | null>(null);

  const filteredVariables = useMemo(() => {
    if (!resultsFilter.trim()) return variables;
    const terms = resultsFilter.toLowerCase().split(/\s+/).filter(Boolean);
    return variables.filter((v) => {
      const name = v.statName.toLowerCase();
      return terms.every((term) => name.includes(term));
    });
  }, [variables, resultsFilter]);
  type VariableSelection = {
    selected: boolean;
    yearEnd: number | null;
    yearStart: number | null;
    relationship: ImportRelationship;
    statAttribute: string;
    lockedImported: boolean;
    importedStatId: string | null;
    importedStatLabel: string | null;
    importedStatName: string | null;
  };
  const [selection, setSelection] = useState<Record<string, VariableSelection>>({});
  const {
    queueItems,
    setQueueItems,
    isRunning,
    setIsRunning,
    setCurrentItemId,
    setCurrentYearProcessing,
    setDerivedStatusLabel,
    openDropdown,
  } = useCensusImportQueue();
  const queueItemsRef = useRef<ImportQueueItem[]>(queueItems);
  const isProcessingRef = useRef(false);
  const [lastSubmittedGroup, setLastSubmittedGroup] = useState<string>(""); // Track last previewed group
  const [isParentSearchOpen, setIsParentSearchOpen] = useState(false);
  const [parentSearch, setParentSearch] = useState("");
  const [manualParent, setManualParent] = useState<{ id: string; name: string; label: string | null; category?: string } | null>(null);
  const [addPercent, setAddPercent] = useState(false);
  const [addChange, setAddChange] = useState(true);
  const [_hasManuallyToggledChange, setHasManuallyToggledChange] = useState(false);
  const [percentDenominatorId, setPercentDenominatorId] = useState<string>("");
  const [isDenominatorSearchOpen, setIsDenominatorSearchOpen] = useState(false);
  const [denominatorSearch, setDenominatorSearch] = useState("");

  const predicateTypeSummary = useMemo(() => {
    const labels = new Map<string, string>();
    variables.forEach((v) => {
      const label = formatPredicateTypeLabel(v.predicateType);
      if (!label) return;
      const key = label.toLowerCase();
      if (!labels.has(key)) labels.set(key, label);
    });
    if (labels.size === 0) return null;
    const types = Array.from(labels.values());
    if (types.length === 1) return types[0];
    return `Mixed (${types.join(", ")})`;
  }, [variables]);

  const conceptDisplay = useMemo(() => {
    const entries = variables
      .map((v) => (typeof v.concept === "string" ? v.concept.trim() : ""))
      .filter(Boolean);
    if (entries.length === 0) {
      const fallback = previewMeta?.concept?.trim();
      return { shared: fallback || null, showPerVariable: false };
    }
    const unique = new Map<string, string>();
    variables.forEach((v) => {
      const concept = typeof v.concept === "string" ? v.concept.trim() : "";
      if (!concept) return;
      const key = concept.toLowerCase();
      if (!unique.has(key)) unique.set(key, concept);
    });
    const allHaveConcept = variables.every(
      (v) => typeof v.concept === "string" && v.concept.trim().length > 0,
    );
    if (unique.size === 1 && allHaveConcept) {
      return { shared: Array.from(unique.values())[0], showPerVariable: false };
    }
    return { shared: null, showPerVariable: true };
  }, [previewMeta?.concept, variables]);

  useEffect(() => {
    queueItemsRef.current = queueItems;
  }, [queueItems]);

  const resetModalState = useCallback(
    (shouldFocus: boolean) => {
      setDataset("acs/acs5");
      setGroup("");
      setYear(2023);
      setLimit(50);
      setCategory(null);
      setStep(1);
      setIsPreviewLoading(false);
      setPreviewError(null);
      setPreviewTotal(0);
      setVariables([]);
      setPreviewMeta(null);
      setSelection({});
      setLastSubmittedGroup("");
      setRunGroupSearch(null);
      setIsParentSearchOpen(false);
      setParentSearch("");
      setManualParent(null);
      setResultsFilter("");
      setAddPercent(false);
      setAddChange(true);
      setHasManuallyToggledChange(false);
      setPercentDenominatorId("");
      setIsDenominatorSearchOpen(false);
      setDenominatorSearch("");
      if (shouldFocus) {
        setTimeout(() => groupInputRef.current?.focus(), 50);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isOpen) return;
    resetModalState(true);
  }, [isOpen, resetModalState]);

  const getDefaultSelection = useCallback(
    (overrides?: Partial<VariableSelection>): VariableSelection => ({
      selected: false,
      yearEnd: year,
      yearStart: null,
      relationship: "none",
      statAttribute: "",
      lockedImported: false,
      importedStatId: null,
      importedStatLabel: null,
      importedStatName: null,
      ...(overrides ?? {}),
    }),
    [year],
  );

  const mergeQueueItems = useCallback(
    (prevQueue: ImportQueueItem[], items: ImportQueueItem[]) => {
      if (items.length === 0) return prevQueue;
      const existing = new Set(prevQueue.map((item) => item.id));
      const nextItems = items.filter((item) => !existing.has(item.id));
      if (nextItems.length === 0) return prevQueue;
      return isRunning ? [...nextItems, ...prevQueue] : [...prevQueue, ...nextItems];
    },
    [isRunning],
  );

  const clearParentSelections = useCallback(() => {
    setQueueItems((prevQueue) =>
      prevQueue.map((item) =>
        item.relationship === "parent" ? { ...item, relationship: "none" as const } : item,
      ),
    );
    setSelection((prev) => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(prev)) {
        if (value?.relationship === "parent") {
          next[key] = { ...value, relationship: "none" };
        }
      }
      return next;
    });
  }, []);

  const parentSearchResults = useMemo(() => {
    const term = parentSearch.trim().toLowerCase();
    const limitResults = 30;
    if (!term) return availableStats.slice(0, limitResults);
    const matches = availableStats.filter((stat) => {
      const label = (stat.label ?? "").toLowerCase();
      const name = stat.name.toLowerCase();
      const neId = (stat.neId ?? "").toLowerCase();
      return (
        label.includes(term) ||
        name.includes(term) ||
        neId.includes(term)
      );
    });
    return matches.slice(0, limitResults);
  }, [availableStats, parentSearch]);

  const handleSelectManualParent = useCallback(
    (stat: StatItem) => {
      setManualParent({ id: stat.id, name: stat.name, label: stat.label ?? null, category: stat.category });
      clearParentSelections();
      // If the user chooses a manual parent after selecting variables,
      // default existing queued imports to Child so they get linked.
      setQueueItems((prevQueue) =>
        prevQueue.map((item) =>
          item.relationship === "none" || item.relationship == null
            ? { ...item, relationship: "child" as const }
            : item,
        ),
      );
      setSelection((prev) => {
        const next = { ...prev };
        for (const [key, value] of Object.entries(prev)) {
          if (!value?.selected || value.lockedImported) continue;
          if (value.relationship === "none") {
            next[key] = { ...value, relationship: "child" };
          }
        }
        return next;
      });
      setIsParentSearchOpen(false);
    },
    [clearParentSelections],
  );

  const handleClearManualParent = useCallback(() => {
    setManualParent(null);
  }, []);

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

  const pendingSelections = useMemo(() => {
    return variables
      .map((variable) => {
        const sel = selection[variable.name];
        if (!sel || !sel.selected || sel.lockedImported) return null;
        return { variable: variable.name, ...getYearRange(sel, year) };
      })
      .filter((item): item is { variable: string; year: number; years: number } => item !== null);
  }, [getYearRange, selection, variables, year]);

  const pendingSelectionCount = pendingSelections.length;

  const variableMetaByName = useMemo(() => {
    return new Map(variables.map((variable) => [variable.name, variable]));
  }, [variables]);

  const pendingGroupLabel = useMemo(() => {
    const trimmedLast = lastSubmittedGroup.trim();
    const trimmedGroup = group.trim();
    return trimmedLast || trimmedGroup || "";
  }, [group, lastSubmittedGroup]);

  const previewDataset = previewMeta?.dataset ?? dataset;
  const previewYear = previewMeta?.year ?? year;
  const previewUniverse =
    previewMeta?.universe?.trim() || inferUniverseFromConcept(conceptDisplay.shared) || "";

  const changeOptionDisabled = useMemo(() => {
    if (pendingSelections.length === 0) return true;
    return pendingSelections.some((item) => item.years <= 1);
  }, [pendingSelections]);

  useEffect(() => {
    if (!isOpen) return;
    // We keep addChange as requested by user, it will be disabled by UI
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!addPercent) {
      setPercentDenominatorId("");
      setIsDenominatorSearchOpen(false);
      setDenominatorSearch("");
    }
  }, [addPercent, isOpen]);

  const denominatorStats = useMemo(() => {
    return availableStats.filter((stat) => typeof stat.neId === "string" && stat.neId.startsWith("census:"));
  }, [availableStats]);

  const selectedDenominator = useMemo(() => {
    if (!percentDenominatorId) return null;
    return availableStats.find((s) => s.id === percentDenominatorId) ?? null;
  }, [availableStats, percentDenominatorId]);

  const denominatorSearchResults = useMemo(() => {
    const term = denominatorSearch.trim().toLowerCase();
    const limitResults = 30;
    const candidates = denominatorStats;
    if (!term) return candidates.slice(0, limitResults);
    const matches = candidates.filter((stat) => {
      const label = (stat.label ?? "").toLowerCase();
      const name = stat.name.toLowerCase();
      const neId = (stat.neId ?? "").toLowerCase();
      return label.includes(term) || name.includes(term) || neId.includes(term);
    });
    return matches.slice(0, limitResults);
  }, [denominatorSearch, denominatorStats]);

  const handleSelectDenominator = useCallback(
    (stat: StatItem) => {
      setPercentDenominatorId(stat.id);
      setIsDenominatorSearchOpen(false);
    },
    [],
  );

  // Handle click outside to close modal
  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen, onClose]);

  // Handle ESC key to close modal
  useEffect(() => {
    if (!isOpen) return;
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
  }, [isOpen, onClose]);

  const handlePreview = useCallback(async (groupOverride?: string, suggestedStatIds?: string[] | null) => {
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
        statLabel:
          typeof entry.statLabel === "string" ? entry.statLabel : undefined,
        zipCount: typeof entry.zipCount === "number" ? entry.zipCount : 0,
        countyCount: typeof entry.countyCount === "number" ? entry.countyCount : 0,
      }));
      setVariables(parsed);
      setPreviewTotal(total);
      setLastSubmittedGroup(trimmedGroup); // Track what was previewed
      setPreviewMeta({
        dataset: typeof payload.dataset === "string" ? payload.dataset : resolvedDataset,
        group: typeof payload.group === "string" ? payload.group : trimmedGroup,
        year: typeof payload.year === "number" ? payload.year : year,
        universe: typeof payload.universe === "string" ? payload.universe : null,
        concept: typeof payload.concept === "string" ? payload.concept : null,
      });

      const defaults: Record<string, VariableSelection> = {};
      const suggestedSet = new Set((suggestedStatIds ?? []).filter(Boolean));
      const autoSelected: Array<{ name: string; yearEnd: number; yearStart: number | null }> = [];
      for (const v of parsed) {
        const importedStat = existingCensusStats.get(v.name);
        const isImported = Boolean(importedStat);
        // Auto-select any AI-suggested variables that exist in this group preview.
        const shouldSelect = isImported || (suggestedSet.size > 0 && suggestedSet.has(v.name));
        const entry = getDefaultSelection({
          selected: shouldSelect,
          yearEnd: year,
          yearStart: isImported ? null : year - 2,
          lockedImported: isImported,
          importedStatId: importedStat?.id ?? null,
          importedStatLabel: importedStat?.label ?? null,
          importedStatName: importedStat?.name ?? null,
        });
        defaults[v.name] = entry;
        if (shouldSelect && !isImported && typeof entry.yearEnd === "number") {
          autoSelected.push({ name: v.name, yearEnd: entry.yearEnd, yearStart: entry.yearStart });
        }
      }

      const variableByName = new Map(parsed.map((entry) => [entry.name, entry]));

      // Mirror the manual checkbox behavior: if we auto-select variables, add them to the queue too.
      if (autoSelected.length) {
        const nextItems = autoSelected.map((sel) => {
          const qYear = sel.yearEnd;
          const qYears =
            sel.yearStart !== null ? Math.max(1, sel.yearEnd - sel.yearStart + 1) : 1;
          const key = `${resolvedDataset}::${trimmedGroup}::${sel.name}`;
          const variableMeta = variableByName.get(sel.name);
          return {
            id: key,
            dataset: resolvedDataset,
            group: trimmedGroup,
            variable: sel.name,
            statLabel: variableMeta?.statLabel || variableMeta?.statName || variableMeta?.label || sel.name,
            year: qYear,
            years: qYears,
            includeMoe: true,
            relationship: "none" as const,
            statAttribute: "",
            status: "pending" as const,
          };
        });
        setQueueItems((prevQueue) => mergeQueueItems(prevQueue, nextItems));
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
  }, [dataset, existingCensusStats, getDefaultSelection, group, limit, mergeQueueItems, year]);

  const toggleVariableSelected = useCallback((name: string) => {
    const trimmedGroup = group.trim();
    setSelection((prev) => {
      const current = prev[name] ?? getDefaultSelection();
      if (current.lockedImported) return prev;
      const newSelected = !current.selected;
      const effectiveRelationship: ImportRelationship =
        newSelected && manualParent && current.relationship === "none"
          ? "child"
          : current.relationship;
      
      // If selecting, add to queue
      if (newSelected && trimmedGroup) {
        const { year: qYear, years: qYears } = getYearRange(current, year);
        const key = `${dataset}::${trimmedGroup}::${name}`;
        const variableMeta = variableMetaByName.get(name);
        const nextItem: ImportQueueItem = {
          id: key,
          dataset,
          group: trimmedGroup,
          variable: name,
          statLabel: variableMeta?.statLabel || variableMeta?.statName || variableMeta?.label || name,
          year: qYear,
          years: qYears,
          includeMoe: true,
          relationship: effectiveRelationship ?? "none",
          statAttribute: current.statAttribute ?? "",
          status: "pending",
        };
        setQueueItems((prevQueue) => mergeQueueItems(prevQueue, [nextItem]));
      }
      // If deselecting, remove from queue
      if (!newSelected && trimmedGroup) {
        setQueueItems((prevQueue) =>
          prevQueue.filter((item) => item.variable !== name || item.group !== trimmedGroup),
        );
      }
      
      return {
        ...prev,
        [name]: {
          ...current,
          selected: newSelected,
          relationship: newSelected ? effectiveRelationship : "none",
          statAttribute: newSelected ? current.statAttribute : "",
        },
      };
    });
  }, [dataset, getDefaultSelection, getYearRange, group, manualParent, mergeQueueItems, variableMetaByName, year, setQueueItems]);

  const handleSelectAllFiltered = useCallback(() => {
    const trimmedGroup = group.trim();
    if (!trimmedGroup) return;

    const toSelect = filteredVariables.filter((v) => {
      const sel = selection[v.name] ?? getDefaultSelection();
      return !sel.lockedImported && !sel.selected;
    });

    if (toSelect.length === 0) return;

    const newQueueItems: ImportQueueItem[] = [];
    const updates: Record<string, VariableSelection> = {};

    toSelect.forEach((v) => {
      const current = selection[v.name] ?? getDefaultSelection();
      const effectiveRelationship: ImportRelationship =
        manualParent && current.relationship === "none" ? "child" : current.relationship;

      const { year: qYear, years: qYears } = getYearRange(current, year);
      const key = `${dataset}::${trimmedGroup}::${v.name}`;
      const variableMeta = variableMetaByName.get(v.name);

      newQueueItems.push({
        id: key,
        dataset,
        group: trimmedGroup,
        variable: v.name,
        statLabel: variableMeta?.statLabel || variableMeta?.statName || variableMeta?.label || v.name,
        year: qYear,
        years: qYears,
        includeMoe: true,
        relationship: effectiveRelationship ?? "none",
        statAttribute: current.statAttribute ?? "",
        status: "pending",
      });

      updates[v.name] = {
        ...current,
        selected: true,
        relationship: effectiveRelationship,
      };
    });

    setSelection((prev) => ({ ...prev, ...updates }));
    setQueueItems((prevQueue) => mergeQueueItems(prevQueue, newQueueItems));
  }, [
    dataset,
    filteredVariables,
    getDefaultSelection,
    getYearRange,
    group,
    manualParent,
    mergeQueueItems,
    selection,
    variableMetaByName,
    year,
    setQueueItems,
  ]);

  const handleClearSelection = useCallback(() => {
    const trimmedGroup = group.trim();
    if (!trimmedGroup) return;

    setSelection((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((name) => {
        const item = next[name];
        if (item && !item.lockedImported && item.selected) {
          next[name] = {
            ...item,
            selected: false,
            relationship: "none",
            statAttribute: "",
          };
        }
      });
      return next;
    });

    setQueueItems((prevQueue) =>
      prevQueue.filter((item) => item.group !== trimmedGroup),
    );
  }, [group, setQueueItems]);

  const updateSelectionField = useCallback(
    (name: string, field: "yearEnd" | "yearStart", value: number | null) => {
      const trimmedGroup = group.trim();
      setSelection((prev) => {
        const current = prev[name] ?? getDefaultSelection({ selected: true });
        if (current.lockedImported) return prev;
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
    [year, group, getDefaultSelection],
  );

  const setVariableRelationship = useCallback(
    (name: string, relationship: ImportRelationship) => {
      const trimmedGroup = group.trim();

      setSelection((prev) => {
        const current = prev[name] ?? getDefaultSelection();
        const normalizedRelationship =
          current.lockedImported && relationship === "child" ? "none" : relationship;
        const nextSelected = current.lockedImported ? true : current.selected ? current.selected : true;

        const nextForName: VariableSelection = {
          ...current,
          selected: nextSelected,
          relationship: normalizedRelationship,
          statAttribute: normalizedRelationship === "child" ? current.statAttribute : "",
        };

        const next: Record<string, VariableSelection> = { ...prev, [name]: nextForName };

        // Enforce: only one "parent" per import.
        if (normalizedRelationship === "parent") {
          if (manualParent) {
            setManualParent(null);
          }
          for (const [key, value] of Object.entries(next)) {
            if (key === name) continue;
            if (value?.relationship === "parent") {
              next[key] = { ...value, relationship: "none" };
            }
          }
        }

        // Already-imported stats should not be added to the queue, but can be chosen as Parent.
        if (current.lockedImported) {
          if (normalizedRelationship === "parent" && trimmedGroup) {
            // Clear any queued parent selections.
            setQueueItems((prevQueue) =>
              prevQueue.map((item) =>
                item.relationship === "parent" ? { ...item, relationship: "none" as const } : item,
              ),
            );
          }
          return next;
        }

        // Keep queue in sync (add if needed, update relationship, clear other parents).
        if (trimmedGroup) {
          const { year: qYear, years: qYears } = getYearRange(nextForName, year);
          const id = `${dataset}::${trimmedGroup}::${name}`;
          const variableMeta = variableMetaByName.get(name);
          setQueueItems((prevQueue) => {
            const hasItem = prevQueue.some((item) => item.id === id);
            let nextQueue = hasItem
              ? prevQueue.map((item) =>
                  item.id === id
                    ? {
                        ...item,
                        year: qYear,
                        years: qYears,
                        relationship: normalizedRelationship,
                        statAttribute: nextForName.statAttribute,
                      }
                    : item,
                )
              : mergeQueueItems(prevQueue, [
                  {
                    id,
                    dataset,
                    group: trimmedGroup,
                    variable: name,
                    statLabel: variableMeta?.statLabel || variableMeta?.statName || variableMeta?.label || name,
                    year: qYear,
                    years: qYears,
                    includeMoe: true,
                    relationship: normalizedRelationship,
                    statAttribute: nextForName.statAttribute,
                    status: "pending",
                  },
                ]);

            if (normalizedRelationship === "parent") {
              nextQueue = nextQueue.map((item) =>
                item.id !== id && item.relationship === "parent"
                  ? { ...item, relationship: "none" as const }
                  : item,
              );
            }
            return nextQueue;
          });
        }

        return next;
      });
    },
    [dataset, getDefaultSelection, getYearRange, group, manualParent, mergeQueueItems, variableMetaByName, year],
  );

  const updateVariableStatAttribute = useCallback(
    (name: string, statAttribute: string) => {
      const trimmedGroup = group.trim();
      setSelection((prev) => {
        const current = prev[name] ?? getDefaultSelection();
        if (current.lockedImported) return prev;
        const nextSelected = current.selected ? current.selected : true;
        const nextForName: VariableSelection = {
          ...current,
          selected: nextSelected,
          relationship: "child",
          statAttribute,
        };
        const next = { ...prev, [name]: nextForName };

        if (trimmedGroup) {
          setQueueItems((prevQueue) =>
            prevQueue.map((item) =>
              item.variable === name && item.group === trimmedGroup
                ? { ...item, relationship: "child", statAttribute }
                : item,
            ),
          );
        }

        return next;
      });
    },
    [getDefaultSelection, group],
  );

  const relationshipConfigError = useMemo(() => {
    const selectedValues = Object.values(selection).filter((s) => s.selected);
    const parents = selectedValues.filter((s) => s.relationship === "parent" && !s.lockedImported);
    const children = selectedValues.filter((s) => s.relationship === "child" && !s.lockedImported);
    const importedParents = selectedValues.filter(
      (s) => s.relationship === "parent" && s.lockedImported && Boolean(s.importedStatId),
    );
    const parentCount = parents.length + importedParents.length + (manualParent ? 1 : 0);
    if (parentCount > 1) return "Only one Parent is allowed per import.";
    if (manualParent && pendingSelectionCount > 0 && children.length === 0) {
      return "Parent selected but no Child stats selected. Mark at least one variable as Child.";
    }
    if (children.length > 0 && parentCount !== 1) return "Select exactly one Parent when using Child relationships.";
    return null;
  }, [manualParent, pendingSelectionCount, selection]);

  const createChangeDerivedChild = useCallback(
    async (parentStatId: string, startYear: string, endYear: string): Promise<string | null> => {
      if (!parentStatId || !startYear || !endYear || startYear >= endYear) return null;

      try {
        const { data: existingRelData } = await db.queryOnce({
          statRelations: {
            $: {
              where: { parentStatId, statAttribute: "Change" },
              fields: ["childStatId"],
            },
          },
        });
        const existingRel = Array.isArray((existingRelData as any)?.statRelations)
          ? (existingRelData as any).statRelations.find((r: any) => typeof r?.childStatId === "string")
          : null;
        if (existingRel?.childStatId) return existingRel.childStatId as string;

        const { data: parentStatsData } = await db.queryOnce({
          stats: { $: { where: { id: parentStatId }, fields: ["id", "name", "label", "category"] } },
        });
        const parentMeta = Array.isArray((parentStatsData as any)?.stats)
          ? (parentStatsData as any).stats[0]
          : null;
        if (!parentMeta || typeof parentMeta?.name !== "string") return null;

        const baseName = String(parentMeta.name);
        const baseLabel = typeof parentMeta.label === "string" && parentMeta.label.trim() ? parentMeta.label : baseName;
        const derivedName = `${baseName} (change)`;
        const derivedLabel = `${baseLabel} [Change]`;
        const derivedCategory = typeof parentMeta.category === "string" ? parentMeta.category : "";
        const derivedSource = "Derived, Census";

        const { data: statDataResponse } = await db.queryOnce({
          statData: {
            $: {
              where: { statId: parentStatId, name: "root" },
              fields: ["parentArea", "boundaryType", "date", "data"],
            },
          },
        });
        const rawRows = Array.isArray((statDataResponse as any)?.statData)
          ? ((statDataResponse as any).statData as any[])
          : [];

        type RowsByDate = Map<string, Record<string, number>>;
        const byContext = new Map<
          string,
          { parentArea: string | null; boundaryType: string | null; rowsByDate: RowsByDate }
        >();

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
        const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

        for (const ctx of byContext.values()) {
          const startData = ctx.rowsByDate.get(startYear);
          const endData = ctx.rowsByDate.get(endYear);
          if (!startData || !endData) continue;
          const changeData: Record<string, number> = {};
          for (const [area, startVal] of Object.entries(startData)) {
            const endVal = endData[area];
            if (!isFiniteNum(startVal) || !isFiniteNum(endVal) || startVal === 0) continue;
            changeData[area] = (endVal - startVal) / startVal;
          }
          if (Object.keys(changeData).length > 0) {
            nonEmptyCount += 1;
          }
          derivedRows.push({
            parentArea: ctx.parentArea,
            boundaryType: ctx.boundaryType,
            date: `${startYear}-${endYear}`,
            data: changeData,
          });
        }

        if (nonEmptyCount === 0) return null;

        const now = Date.now();
        const newStatId = createId();
        const relationKey = `${parentStatId}::${newStatId}::Change`;
        const txs: any[] = [
          db.tx.stats[newStatId].update({
            name: derivedName,
            label: derivedLabel,
            category: derivedCategory,
            source: derivedSource,
            goodIfUp: null,
            featured: false,
            homeFeatured: false,
            visibility: null,
            createdOn: now,
            lastUpdated: now,
          }),
          db.tx.statRelations[createId()].update({
            relationKey,
            parentStatId,
            childStatId: newStatId,
            statAttribute: "Change",
            createdAt: now,
            updatedAt: now,
          }),
        ];

        const sortedDerivedRows = [...derivedRows].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
        for (const row of sortedDerivedRows) {
          const parentArea = row.parentArea ?? undefined;
          const boundaryType = row.boundaryType ?? undefined;
          const date = row.date ?? undefined;
          const summaryKey =
            parentArea && boundaryType ? buildStatDataSummaryKey(newStatId, "root", parentArea, boundaryType) : null;
          const summary = computeSummaryFromData(row.data);
          txs.push(
            db.tx.statData[createId()].update({
              statId: newStatId,
              name: "root",
              parentArea,
              boundaryType,
              date,
              type: "percent_change",
              data: row.data,
              source: derivedSource,
              statTitle: derivedLabel,
              createdOn: now,
              lastUpdated: now,
            }),
          );
          if (summaryKey && date) {
            txs.push(
              db.tx.statDataSummaries[lookup("summaryKey", summaryKey)].update({
                statId: newStatId,
                name: "root",
                parentArea,
                boundaryType,
                date,
                minDate: date,
                maxDate: date,
                type: "percent_change",
                count: summary.count,
                sum: summary.sum,
                avg: summary.avg,
                min: summary.min,
                max: summary.max,
                updatedAt: now,
              }),
            );
          }
        }

        for (let i = 0; i < txs.length; i += MAX_DERIVED_TX_BATCH) {
          await db.transact(txs.slice(i, i + MAX_DERIVED_TX_BATCH));
        }

        return newStatId;
      } catch (err) {
        console.error("Failed to create change-over-time derived stat during import", err);
        return null;
      }
    },
    [],
  );

  const createPercentDerivedChild = useCallback(
    async (parentStatId: string, denominatorStatId: string): Promise<string | null> => {
      if (!parentStatId || !denominatorStatId) return null;

      try {
        const { data: existingRelData } = await db.queryOnce({
          statRelations: {
            $: {
              where: { parentStatId, statAttribute: "Percent" },
              fields: ["childStatId"],
            },
          },
        });
        const existingRel = Array.isArray((existingRelData as any)?.statRelations)
          ? (existingRelData as any).statRelations.find((r: any) => typeof r?.childStatId === "string")
          : null;
        if (existingRel?.childStatId) return existingRel.childStatId as string;

        const { data: statsData } = await db.queryOnce({
          stats: {
            $: {
              where: { id: { $in: [parentStatId, denominatorStatId] } },
              fields: ["id", "name", "label", "category"],
            },
          },
        });
        const rows = Array.isArray((statsData as any)?.stats) ? ((statsData as any).stats as any[]) : [];
        const parentMeta = rows.find((r) => r?.id === parentStatId);
        const denominatorMeta = rows.find((r) => r?.id === denominatorStatId);
        if (!parentMeta || !denominatorMeta) return null;

        const baseName = String(parentMeta.name);
        const baseLabel =
          typeof parentMeta.label === "string" && parentMeta.label.trim() ? parentMeta.label : baseName;
        const derivedName = `${baseName} (percent)`;
        const derivedLabel = `${baseLabel} [Percent]`;
        const derivedCategory = typeof parentMeta.category === "string" ? parentMeta.category : "";
        const derivedSource = "Derived, Census";

        const { data: statDataResponse } = await db.queryOnce({
          statData: {
            $: {
              where: { name: "root", statId: { $in: [parentStatId, denominatorStatId] } },
              fields: ["statId", "parentArea", "boundaryType", "date", "data"],
            },
          },
        });
        const rawRows = Array.isArray((statDataResponse as any)?.statData)
          ? ((statDataResponse as any).statData as any[])
          : [];

        const perStat = new Map<string, Map<string, RootStatDataRow>>();
        for (const row of rawRows) {
          if (!row || typeof row !== "object") continue;
          const statId = typeof row.statId === "string" ? row.statId : null;
          if (!statId) continue;
          const parentArea = typeof row.parentArea === "string" ? row.parentArea : null;
          const boundaryType = typeof row.boundaryType === "string" ? row.boundaryType : null;
          const rawDate = row.date;
          const date = typeof rawDate === "string" ? rawDate : typeof rawDate === "number" ? String(rawDate) : null;
          const dataMap = normalizeDataMap((row as any).data);
          const normalized: RootStatDataRow = { parentArea, boundaryType, date, data: dataMap };
          const key = buildRowKey(normalized);
          if (!perStat.has(statId)) perStat.set(statId, new Map());
          perStat.get(statId)!.set(key, normalized);
        }

        const numeratorRows = perStat.get(parentStatId);
        const denominatorRows = perStat.get(denominatorStatId);
        if (!numeratorRows?.size || !denominatorRows?.size) return null;

        const derivedRows: RootStatDataRow[] = [];
        let nonEmptyCount = 0;
        for (const [key, bRow] of denominatorRows.entries()) {
          const aRow = numeratorRows.get(key);
          if (!aRow) continue;
          const derivedData = computeDerivedValues(aRow.data ?? {}, bRow.data ?? {}, "percent");
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

        if (nonEmptyCount === 0) return null;

        const now = Date.now();
        const newStatId = createId();
        const relationKey = `${parentStatId}::${newStatId}::Percent`;
        const txs: any[] = [
          db.tx.stats[newStatId].update({
            name: derivedName,
            label: derivedLabel,
            category: derivedCategory,
            source: derivedSource,
            goodIfUp: null,
            featured: false,
            homeFeatured: false,
            visibility: null,
            createdOn: now,
            lastUpdated: now,
          }),
          db.tx.statRelations[createId()].update({
            relationKey,
            parentStatId,
            childStatId: newStatId,
            statAttribute: "Percent",
            createdAt: now,
            updatedAt: now,
          }),
        ];

        const sortedDerivedRows = [...derivedRows].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
        for (const row of sortedDerivedRows) {
          const parentArea = row.parentArea ?? undefined;
          const boundaryType = row.boundaryType ?? undefined;
          const date = row.date ?? undefined;
          const summaryKey =
            parentArea && boundaryType ? buildStatDataSummaryKey(newStatId, "root", parentArea, boundaryType) : null;
          const summary = computeSummaryFromData(row.data);
          txs.push(
            db.tx.statData[createId()].update({
              statId: newStatId,
              name: "root",
              parentArea,
              boundaryType,
              date,
              type: "percent",
              data: row.data,
              source: derivedSource,
              statTitle: derivedLabel,
              createdOn: now,
              lastUpdated: now,
            }),
          );
          if (summaryKey && date) {
            txs.push(
              db.tx.statDataSummaries[lookup("summaryKey", summaryKey)].update({
                statId: newStatId,
                name: "root",
                parentArea,
                boundaryType,
                date,
                minDate: date,
                maxDate: date,
                type: "percent",
                count: summary.count,
                sum: summary.sum,
                avg: summary.avg,
                min: summary.min,
                max: summary.max,
                updatedAt: now,
              }),
            );
          }
        }

        for (let i = 0; i < txs.length; i += MAX_DERIVED_TX_BATCH) {
          await db.transact(txs.slice(i, i + MAX_DERIVED_TX_BATCH));
        }

        return newStatId;
      } catch (err) {
        console.error("Failed to create percent derived stat during import", err);
        return null;
      }
    },
    [],
  );

  const handleRunQueue = useCallback(async () => {
    if (pendingSelectionCount === 0) return;
    if (relationshipConfigError) {
      setPreviewError(relationshipConfigError);
      return;
    }
    if (addPercent && !percentDenominatorId) {
      setPreviewError("Select a denominator before starting imports.");
      return;
    }
    resetModalState(true);
    if (isRunning || isProcessingRef.current) return;

    setIsRunning(true);
    setCurrentItemId(null);
    setCurrentYearProcessing(null);
    isProcessingRef.current = true;
    onClose();
    openDropdown();

    const importedStatIds: string[] = [];
    const importedByItemId = new Map<string, string>();
    const erroredItemIds = new Set<string>();

    try {
      while (true) {
        const nextItem = queueItemsRef.current.find((item) => item.status === "pending");
        if (!nextItem) break;

        setCurrentItemId(nextItem.id);
        setQueueItems((prev) =>
          prev.map((q) =>
            q.id === nextItem.id ? { ...q, status: "running", errorMessage: undefined } : q,
          ),
        );

        // When importing multiple years, split into per-year requests to keep each server call small.
        let itemErrored = false;
        let itemStatId: string | null = null;
        const yearsToProcess =
          nextItem.years > 1
            ? Array.from({ length: nextItem.years }, (_, idx) => nextItem.year - idx)
            : [nextItem.year];

        for (const year of yearsToProcess) {
          try {
            setCurrentYearProcessing(year);
            const response = await fetch("/api/census-import", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                dataset: nextItem.dataset,
                group: nextItem.group,
                variable: nextItem.variable,
                year,
                years: 1,
                includeMoe: nextItem.includeMoe,
                category: category,
                visibility: "private",
                createdBy: user?.id ?? null,
              }),
            });
            const payload = (await response.json().catch(() => null)) as any;
            if (!response.ok || !payload || payload.ok === false || payload.error) {
              const message =
                (payload && typeof payload.error === "string" && payload.error) ||
                `Import failed with status ${response.status}.`;
              setQueueItems((prev) =>
                prev.map((q) =>
                  q.id === nextItem.id ? { ...q, status: "error", errorMessage: message } : q,
                ),
              );
              // Stop processing remaining years for this item on error
              itemErrored = true;
              erroredItemIds.add(nextItem.id);
              throw new Error(message);
            }
            const statId = typeof payload.statId === "string" ? payload.statId : null;
            if (statId && !importedStatIds.includes(statId)) {
              importedStatIds.push(statId);
            }
            if (statId) {
              itemStatId = statId;
              importedByItemId.set(nextItem.id, statId);
              setQueueItems((prev) =>
                prev.map((q) =>
                  q.id === nextItem.id ? { ...q, importedStatId: statId } : q,
                ),
              );
            }
            setCurrentYearProcessing(null);
          } catch (err) {
            console.error("Census import request failed", err);
            setQueueItems((prev) =>
              prev.map((q) =>
                q.id === nextItem.id
                  ? { ...q, status: "error", errorMessage: "Network error during import." }
                  : q,
              ),
            );
            itemErrored = true;
            erroredItemIds.add(nextItem.id);
            setCurrentYearProcessing(null);
            break;
          }
        }

        if (!itemErrored && itemStatId) {
          if (addPercent && percentDenominatorId) {
            const percentYearLabel =
              nextItem.years > 1
                ? `${nextItem.year - nextItem.years + 1}-${nextItem.year}`
                : String(nextItem.year);
            setDerivedStatusLabel(`Percentage ${percentYearLabel}`);
            const derivedId = await createPercentDerivedChild(itemStatId, percentDenominatorId);
            setDerivedStatusLabel(null);
            if (derivedId && !importedStatIds.includes(derivedId)) {
              importedStatIds.push(derivedId);
            }
          }
          if (addChange && nextItem.years > 1) {
            setDerivedStatusLabel("Change");
            const endYear = String(nextItem.year);
            const startYear = String(nextItem.year - nextItem.years + 1);
            const derivedId = await createChangeDerivedChild(itemStatId, startYear, endYear);
            setDerivedStatusLabel(null);
            if (derivedId && !importedStatIds.includes(derivedId)) {
              importedStatIds.push(derivedId);
            }
          }
        }

        // If we never marked this item as error, treat it as success (after derived work).
        setQueueItems((prev) =>
          prev.map((q) =>
            q.id === nextItem.id && !itemErrored
              ? {
                  ...q,
                  status: "success",
                  errorMessage: undefined,
                  importedStatId: itemStatId ?? q.importedStatId,
                }
              : q,
          ),
        );
      }

      const itemsSnapshot = queueItemsRef.current.slice();
      // Create parent/child stat relationships if configured.
      const parentItem = itemsSnapshot.find(
        (q) => q.relationship === "parent" && !erroredItemIds.has(q.id) && importedByItemId.has(q.id),
      );
      const importedParentSelection = Object.values(selection).find(
        (s) => s.relationship === "parent" && s.lockedImported && s.importedStatId,
      );
      const childItems = itemsSnapshot.filter(
        (q) => q.relationship === "child" && !erroredItemIds.has(q.id) && importedByItemId.has(q.id),
      );
      const parentStatId = manualParent?.id
        ? manualParent.id
        : parentItem
          ? importedByItemId.get(parentItem.id)
          : importedParentSelection?.importedStatId ?? null;
      if (childItems.length > 0 && parentStatId) {
        setDerivedStatusLabel("Grouping relationships");
        try {
          const parentId = parentStatId;
          const now = Date.now();
          const candidates = childItems
            .map((child) => {
              const childStatId = importedByItemId.get(child.id)!;
              if (!childStatId || childStatId === parentId) return null;
              const rawAttr = typeof child.statAttribute === "string" ? child.statAttribute.trim() : "";
              const statAttribute = rawAttr ? rawAttr : UNDEFINED_STAT_ATTRIBUTE;
              const relationKey = `${parentId}::${childStatId}::${statAttribute}`;
              return { relationKey, parentStatId: parentId, childStatId, statAttribute };
            })
            .filter(
              (v): v is { relationKey: string; parentStatId: string; childStatId: string; statAttribute: string } =>
                v !== null,
            );

          const uniqueByKey = new Map<string, (typeof candidates)[number]>();
          for (const c of candidates) uniqueByKey.set(c.relationKey, c);
          const unique = Array.from(uniqueByKey.values());

          if (unique.length > 0) {
            try {
              const { data } = await db.queryOnce({
                statRelations: {
                  $: {
                    where: { relationKey: { $in: unique.map((u) => u.relationKey) } },
                    fields: ["relationKey"],
                  },
                },
              });
              const existing = new Set(
                Array.isArray((data as any)?.statRelations)
                  ? (data as any).statRelations
                      .map((r: any) => (typeof r?.relationKey === "string" ? r.relationKey : null))
                      .filter(Boolean)
                  : [],
              );
              const txs = unique
                .filter((u) => !existing.has(u.relationKey))
                .map((u) =>
                  db.tx.statRelations[createId()].update({
                    relationKey: u.relationKey,
                    parentStatId: u.parentStatId,
                    childStatId: u.childStatId,
                    statAttribute: u.statAttribute,
                    createdAt: now,
                    updatedAt: now,
                  }),
                );
              const childVisibilityUpdates = Array.from(
                new Set(unique.map((u) => u.childStatId)),
              ).map((childStatId) => db.tx.stats[childStatId].update({ visibility: null }));
              if (txs.length > 0) {
                await db.transact([...txs, ...childVisibilityUpdates]);
              }
            } catch (err) {
              console.error("Failed to create stat relationships after import", err);
            }
          }
        } finally {
          setDerivedStatusLabel(null);
        }
      }
    } finally {
      setIsRunning(false);
      setCurrentItemId(null);
      setCurrentYearProcessing(null);
      setDerivedStatusLabel(null);
      isProcessingRef.current = false;
      if (importedStatIds.length > 0) {
        onImported(importedStatIds);
      }
    }
  }, [
    addChange,
    addPercent,
    category,
    createChangeDerivedChild,
    createPercentDerivedChild,
    isRunning,
    manualParent,
    onImported,
    pendingSelectionCount,
    percentDenominatorId,
    resetModalState,
    relationshipConfigError,
    setDerivedStatusLabel,
    selection,
    user?.id,
  ]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4">
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
            className="rounded-full p-1 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
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
                    Search
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
              Pending Import
            </h3>

            <div className="mt-2 flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              {pendingSelectionCount === 0 ? (
                <p>No variables pending import yet. Select variables from the preview below.</p>
              ) : (
                <>
                  <p>
                    {pendingSelectionCount} variable{pendingSelectionCount === 1 ? "" : "s"}
                    {pendingGroupLabel ? ` from ${pendingGroupLabel}` : ""} pending import.
                  </p>
                  <button
                    type="button"
                    onClick={handleClearSelection}
                    className="ml-2 font-medium text-slate-400 transition hover:text-rose-600 dark:hover:text-rose-400"
                  >
                    Clear all
                  </button>
                </>
              )}
            </div>

            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-300">Add:</span>
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={addPercent}
                      onChange={(e) => setAddPercent(e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-brand-500 focus:ring-brand-400 dark:border-slate-600 dark:bg-slate-900"
                    />
                    Percentage
                  </label>
                  {addPercent && (
                    <button
                      type="button"
                      onClick={() => setIsDenominatorSearchOpen((open) => !open)}
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-medium shadow-sm transition ${
                        percentDenominatorId
                          ? "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                          : "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300 dark:hover:bg-rose-900/30"
                      }`}
                    >
                      {percentDenominatorId
                        ? `Denom: ${selectedDenominator?.label || selectedDenominator?.name || "Selected"}`
                        : "Denominator needed"}
                    </button>
                  )}
                  <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={addChange}
                      onChange={(e) => {
                        setAddChange(e.target.checked);
                        setHasManuallyToggledChange(true);
                      }}
                      disabled={changeOptionDisabled}
                      className="h-3.5 w-3.5 rounded border-slate-300 text-brand-500 focus:ring-brand-400 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900"
                    />
                    Change
                  </label>
                  {pendingSelectionCount > 0 && changeOptionDisabled && (
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">(all need 2+ years)</span>
                  )}
                </div>
              </div>

              {addPercent && isDenominatorSearchOpen && (
                <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={denominatorSearch}
                      onChange={(e) => setDenominatorSearch(e.target.value)}
                      placeholder="Search imported stats for denominator..."
                      className="w-full flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => setDenominatorSearch("")}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                    {denominatorSearchResults.length === 0 ? (
                      <p className="px-3 py-2 text-[10px] text-slate-500 dark:text-slate-400">
                        No matching imported stats found.
                      </p>
                    ) : (
                      denominatorSearchResults.map((stat) => (
                        <button
                          key={stat.id}
                          type="button"
                          onClick={() => handleSelectDenominator(stat)}
                          className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-800 dark:hover:bg-slate-800/70"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[11px] font-medium text-slate-800 dark:text-slate-100">
                              {stat.label || stat.name}
                            </div>
                            <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                              {stat.label ? stat.name : ""}
                            </div>
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">
                            {stat.category}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    This denominator is used to create “...[Percent]” child stats for each imported stat.
                  </p>
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
                disabled={
                  pendingSelectionCount === 0 ||
                  Boolean(relationshipConfigError) ||
                  (addPercent && !percentDenominatorId)
                }
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm transition hover:bg-emerald-600 disabled:opacity-60"
              >
                Start import
              </button>
            </div>
            {relationshipConfigError && (
              <p className="mt-2 text-[11px] text-rose-600 dark:text-rose-400">{relationshipConfigError}</p>
            )}
          </div>

          {/* Preview section - order-2 on mobile, order-1 on desktop (above other sections) */}
          {step === 2 && variables.length > 0 && (
            <div className="order-2 md:order-1 md:col-span-2">
              {/* Meta info above preview */}
              {previewTotal > 0 && lastSubmittedGroup && (
                <div className="mb-2 space-y-1 px-1 text-[10px] text-slate-400 dark:text-slate-500">
                  <p>
                    {filteredVariables.length} of {previewTotal} in {lastSubmittedGroup} (+ MOE)
                  </p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {previewUniverse && <span>Universe: {previewUniverse}</span>}
                    <span>Dataset: {previewDataset}</span>
                    <span>Vintage: {previewYear}</span>
                    {predicateTypeSummary && <span>Type: {predicateTypeSummary}</span>}
                  </div>
                  {conceptDisplay.shared && (
                  <div className="text-[10px] text-slate-400/90 dark:text-slate-500">
                    Concept: {conceptDisplay.shared}
                  </div>
                )}
              </div>
              )}
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Statistics (Variables)
                  </span>
                  {manualParent && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                      Parent: {manualParent.label || manualParent.name}
                      <button
                        type="button"
                        onClick={handleClearManualParent}
                        className="text-emerald-700 transition hover:text-emerald-900 disabled:opacity-50 dark:text-emerald-300 dark:hover:text-emerald-100"
                        title="Clear parent selection"
                      >
                        ×
                      </button>
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setIsParentSearchOpen((open) => !open)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  + Parent
                </button>
              </div>

              {/* Results Filter */}
              <div className="mb-3 px-1">
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2.5">
                    <svg
                      className="h-3.5 w-3.5 text-slate-400"
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
                  </div>
                  <input
                    type="text"
                    value={resultsFilter}
                    onChange={(e) => setResultsFilter(e.target.value)}
                    placeholder="Filter results by stat name..."
                    className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-24 text-[11px] text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center pr-1.5">
                    {filteredVariables.some((v) => {
                      const sel = selection[v.name] ?? getDefaultSelection();
                      return !sel.lockedImported && !sel.selected;
                    }) && (
                      <button
                        type="button"
                        onClick={handleSelectAllFiltered}
                        className="rounded px-2 py-1 text-[10px] font-semibold text-brand-600 transition hover:bg-brand-50 hover:text-brand-700 dark:text-brand-400 dark:hover:bg-brand-900/30 dark:hover:text-brand-300"
                      >
                        Select All
                      </button>
                    )}
                    {resultsFilter && (
                      <button
                        type="button"
                        onClick={() => setResultsFilter("")}
                        className="ml-0.5 flex h-6 w-6 items-center justify-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
              {isParentSearchOpen && (
                <div className="mb-3 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={parentSearch}
                      onChange={(e) => setParentSearch(e.target.value)}
                      placeholder="Search existing stats by name/label"
                      className="w-full flex-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-[11px] text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                    <button
                      type="button"
                      onClick={() => setParentSearch("")}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                    {parentSearchResults.length === 0 ? (
                      <p className="px-3 py-2 text-[10px] text-slate-500 dark:text-slate-400">
                        No matching stats found.
                      </p>
                    ) : (
                      parentSearchResults.map((stat) => (
                        <button
                          key={stat.id}
                          type="button"
                          onClick={() => handleSelectManualParent(stat)}
                          className="flex w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-800 dark:hover:bg-slate-800/70"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[11px] font-medium text-slate-800 dark:text-slate-100">
                              {stat.label || stat.name}
                            </div>
                            <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                              {stat.label ? stat.name : ""}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                              {stat.category}
                            </span>
                            {stat.source && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                                {stat.source}
                              </span>
                            )}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                    Picking a parent here will not add it to the queue; it only links imported children to that stat.
                  </p>
                  {manualParent && (
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      Tip: selecting a variable now defaults its relationship to Child.
                    </p>
                  )}
                </div>
              )}
              <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 text-[11px] dark:border-slate-700 dark:bg-slate-900">
                {/* Desktop header - hidden on mobile */}
                <div className="mb-2 hidden grid-cols-4 gap-4 px-1 text-[10px] font-medium uppercase tracking-wide text-slate-500 sm:grid dark:text-slate-400">
                  <span className="pl-6">Variable</span>
                  <span>Year Range</span>
                  <span>Coverage</span>
                  <span className="text-center">Relationship</span>
                </div>
            <div className="space-y-1">
              {filteredVariables.map((v) => {
                const sel = selection[v.name] ?? getDefaultSelection({ yearEnd: year, yearStart: year - 2 });
                const rel = sel.relationship ?? "none";
                const relationshipLabel = rel === "none" ? "None" : rel === "child" ? "Child" : "Parent";
                const nextRelationship = (current: ImportRelationship) =>
                  sel.lockedImported
                    ? (current === "parent" ? "none" : "parent")
                    : current === "none"
                      ? "child"
                      : current === "child"
                        ? "parent"
                        : "none";
                return (
                  <label
                    key={v.name}
                    className="grid cursor-pointer grid-cols-[1fr_auto] items-center gap-4 rounded-lg border-t border-slate-100 px-1.5 py-1.5 first:border-t-0 hover:bg-slate-50 sm:grid-cols-4 dark:border-slate-800/70 dark:hover:bg-slate-800/60"
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={sel.selected}
                        onChange={() => toggleVariableSelected(v.name)}
                        disabled={sel.lockedImported}
                        className="h-3.5 w-3.5 shrink-0 rounded border-slate-300 text-brand-500 focus:ring-brand-400 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 dark:border-slate-500 dark:bg-slate-900 disabled:dark:border-slate-800 disabled:dark:bg-slate-800"
                      />
                      <div className="flex min-w-0 flex-col">
                        <span className="font-medium text-slate-800 dark:text-slate-100">
                          {v.name}
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {v.inferredType} · <HighlightMatch text={v.statName} filter={resultsFilter} />
                        </span>
                        {conceptDisplay.showPerVariable && v.concept?.trim() && (
                          <span className="text-[10px] text-slate-400 dark:text-slate-500">
                            {v.concept}
                          </span>
                        )}
                        {sel.lockedImported && (
                          <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                            Imported as "{sel.importedStatLabel ?? sel.importedStatName ?? v.statName}"
                          </span>
                        )}
                        {/* Mobile: relationship controls */}
                        <div className="mt-1 flex items-center gap-2 sm:hidden">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setVariableRelationship(v.name, nextRelationship(rel));
                            }}
                            className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                            title="Click to cycle relationship"
                          >
                            {relationshipLabel}
                          </button>
                          {rel === "child" && (
                            <div className="flex min-w-0 flex-col">
                              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                statAttribute
                              </span>
                              <input
                                type="text"
                                value={sel.statAttribute ?? ""}
                                onChange={(e) => updateVariableStatAttribute(v.name, e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                disabled={sel.lockedImported}
                                className="w-32 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                                placeholder="optional"
                              />
                            </div>
                          )}
                        </div>
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
                        disabled={sel.lockedImported}
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
                        disabled={sel.lockedImported}
                        className="w-14 appearance-none rounded border border-slate-300 bg-white px-1.5 py-0.5 text-center text-[10px] text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 sm:text-left dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                      />
                    </div>
                    <div className="hidden text-[10px] text-slate-500 sm:block dark:text-slate-400">
                      {v.zipCount} ZIPs · {v.countyCount} counties
                    </div>
                    {/* Desktop: relationship controls (button centered, statAttribute grows right) */}
                    <div className="hidden sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-2">
                      <div />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setVariableRelationship(v.name, nextRelationship(rel));
                        }}
                        className="justify-self-center rounded border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                        title="Click to cycle relationship"
                      >
                        {relationshipLabel}
                      </button>
                      {rel === "child" ? (
                        <div className="min-w-0 justify-self-stretch">
                          <div className="flex flex-col">
                            <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                              statAttribute
                            </span>
                            <input
                              type="text"
                              value={sel.statAttribute ?? ""}
                              onChange={(e) => updateVariableStatAttribute(v.name, e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              disabled={sel.lockedImported}
                              className="w-full rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] text-slate-900 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                              placeholder="optional"
                            />
                          </div>
                        </div>
                      ) : (
                        <div />
                      )}
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
    </div>,
    document.body
  );
};

// Sort options for stats list
type SortOption = "updated" | "created" | "name" | "category";
const sortOptionLabels: Record<SortOption, string> = {
  updated: "↓ Updated",
  created: "↓ Created",
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
  const { authReady, user } = useAuthSession();
  const queryEnabled = authReady;
  const [activeTab, setActiveTab] = useState<"stats" | "orgs" | "batches">("stats");
  const [isTabDropdownOpen, setIsTabDropdownOpen] = useState(false);
  const tabDropdownRef = useRef<HTMLDivElement>(null);
  const appId = getEnvString("VITE_INSTANT_APP_ID") ?? "";

  // Fetch categories from InstantDB
  const { statCategories } = useCategories();

  // Build category options for dropdowns (memoized to avoid re-renders)
  const statCategoryOptions = useMemo(
    () => statCategories.map((c) => ({ value: c.slug, label: c.label })),
    [statCategories]
  );

  const statsQueryEnabled = queryEnabled && activeTab === "stats";

  // Primary query: just stats (small, fast, reliable)
  const {
    data: statsData,
    isLoading: statsLoading,
    error: statsError,
  } = db.useQuery(
    statsQueryEnabled
      ? {
          stats: {
            $: {
              order: { name: "asc" as const },
            },
          },
          statRelations: {
            $: {
              fields: [
                "id",
                "relationKey",
                "parentStatId",
                "childStatId",
                "statAttribute",
                "sortOrder",
                "createdAt",
                "updatedAt",
              ],
              order: { sortOrder: "asc" as const },
            },
          },
        }
      : null,
  );

  const { data: poiRowsData } = db.useQuery(
    statsQueryEnabled
      ? {
          pointsOfInterest: {
            $: {
              fields: ["statId", "computedAt", "isActive"],
              order: { computedAt: "desc" as const },
              limit: 4000,
            },
          },
        }
      : null,
  );

  // State to control statDataSummaries query (for retry logic)
  const [statSummariesQueryEnabled, setStatSummariesQueryEnabled] = useState(true);

  // Retry callback: briefly disable then re-enable the query
  const retryStatSummaries = useCallback(() => {
    setStatSummariesQueryEnabled(false);
    setTimeout(() => setStatSummariesQueryEnabled(true), 50);
  }, []);

  const showBackfillSummariesHelp = useCallback(() => {
    const cmd = "npm run admin:backfill:stat-summaries";
    window.alert(
      `Stat summaries are missing/unavailable.\n\nApp ID: ${appId || "(missing)"}\n\nTo rebuild them, run:\n\n${cmd}\n\nRequires INSTANT_APP_ADMIN_TOKEN in your environment.`,
    );
  }, [appId]);

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

  // Close tab dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tabDropdownRef.current && !tabDropdownRef.current.contains(event.target as Node)) {
        setIsTabDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside as any);
    return () => document.removeEventListener("mousedown", handleClickOutside as any);
  }, []);

  // State for which stat is being edited (null = none)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [poiStatusByStatId, setPoiStatusByStatId] = useState<Record<string, PoiStatus>>({});
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
  const [derivedYearsByStatId, setDerivedYearsByStatId] = useState<Map<string, string[]>>(new Map());
  const [derivedYearsLoading, setDerivedYearsLoading] = useState<Set<string>>(new Set());
  const [pendingDerivedJobs, setPendingDerivedJobs] = useState<PendingDerivedJob[]>([]);

  // Filter, sort, and search state
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<SortOption>("created");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const poiApiKey = getEnvString("VITE_POINTS_OF_INTEREST_API_KEY") ?? "";

  // Parse and filter stats
  const stats = useMemo(() => {
    if (!statsData?.stats) return [];
    return statsData.stats.map(parseStat).filter((s): s is StatItem => s !== null);
  }, [statsData?.stats]);

  const censusStatsByVariable = useMemo(() => {
    const map = new Map<string, { id: string; name: string; label: string | null | undefined }>();
    for (const stat of stats) {
      if (typeof stat.neId === "string" && stat.neId.startsWith("census:")) {
        const variable = stat.neId.slice("census:".length);
        map.set(variable, { id: stat.id, name: stat.name, label: stat.label });
      }
    }
    return map;
  }, [stats]);

  const statsById = useMemo(() => {
    const map = new Map<string, StatItem>();
    for (const stat of stats) {
      map.set(stat.id, stat);
    }
    return map;
  }, [stats]);

  const poiInfoByStatId = useMemo(() => {
    const map = new Map<string, { activeCount: number; lastComputedAt: number | null }>();
    const rows = (poiRowsData?.pointsOfInterest ?? []) as Array<{
      statId?: unknown;
      isActive?: unknown;
      computedAt?: unknown;
    }>;

    for (const row of rows) {
      const statId = typeof row?.statId === "string" ? row.statId : null;
      if (!statId) continue;
      const existing = map.get(statId) ?? { activeCount: 0, lastComputedAt: null };
      const computedAt =
        typeof row?.computedAt === "number" && Number.isFinite(row.computedAt)
          ? row.computedAt
          : null;
      if (
        computedAt !== null &&
        (existing.lastComputedAt === null || computedAt > existing.lastComputedAt)
      ) {
        existing.lastComputedAt = computedAt;
      }
      if (row?.isActive === true) {
        existing.activeCount += 1;
      }
      map.set(statId, existing);
    }

    return map;
  }, [poiRowsData?.pointsOfInterest]);

  const { statRelationsByParent, statRelationsByChild } = useMemo(() => {
    const byParent = new Map<string, Map<string, Array<StatRelation & { child: StatItem | null }>>>();
    const byChild = new Map<string, Array<StatRelation>>();

    const rows = (statsData?.statRelations ?? []) as StatRelation[];
    const seen = new Set<string>();

    const buildKey = (parent: string, child: string, attribute: string, rawKey?: string) => {
      const normalized = attribute.trim();
      if (rawKey && rawKey.trim()) return rawKey;
      return `${parent}::${child}::${normalized}`;
    };

    for (const row of rows) {
      if (
        !row ||
        typeof row.id !== "string" ||
        typeof row.parentStatId !== "string" ||
        typeof row.childStatId !== "string" ||
        typeof row.statAttribute !== "string"
      ) {
        continue;
      }
      const parentStatId = row.parentStatId;
      const childStatId = row.childStatId;
      const statAttribute = row.statAttribute.trim();
      if (!statAttribute) continue;
      if (!statsById.has(parentStatId)) continue;

      const relationKey = buildKey(parentStatId, childStatId, statAttribute, row.relationKey);
      if (seen.has(relationKey)) continue;
      seen.add(relationKey);

      const child = statsById.get(childStatId) ?? null;
      const relation: StatRelation & { child: StatItem | null } = {
        id: row.id,
        relationKey,
        parentStatId,
        childStatId,
        statAttribute,
        sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : null,
        createdAt: typeof row.createdAt === "number" ? row.createdAt : null,
        updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : null,
        child,
      };

      const byAttr = byParent.get(parentStatId) ?? new Map<string, Array<StatRelation & { child: StatItem | null }>>();
      const list = byAttr.get(statAttribute) ?? [];
      list.push(relation);
      byAttr.set(statAttribute, list);
      byParent.set(parentStatId, byAttr);

      const childList = byChild.get(childStatId) ?? [];
      childList.push({
        id: relation.id,
        relationKey: relation.relationKey,
        parentStatId: relation.parentStatId,
        childStatId: relation.childStatId,
        statAttribute: relation.statAttribute,
        sortOrder: relation.sortOrder,
        createdAt: relation.createdAt,
        updatedAt: relation.updatedAt,
      });
      byChild.set(childStatId, childList);
    }

    const sortRelations = (relations: Array<StatRelation & { child: StatItem | null }>) => {
      const safeLabel = (stat: StatItem | null): string => {
        if (!stat) return "";
        return (stat.label || stat.name || "").toLowerCase();
      };
      relations.sort((a, b) => {
        const aOrder = a.sortOrder ?? null;
        const bOrder = b.sortOrder ?? null;
        if (aOrder !== null && bOrder !== null && aOrder !== bOrder) return aOrder - bOrder;
        if (aOrder !== null && bOrder === null) return -1;
        if (aOrder === null && bOrder !== null) return 1;
        const attrCompare = a.statAttribute.localeCompare(b.statAttribute);
        if (attrCompare !== 0) return attrCompare;
        const labelCompare = safeLabel(a.child).localeCompare(safeLabel(b.child));
        if (labelCompare !== 0) return labelCompare;
        return a.relationKey.localeCompare(b.relationKey);
      });
    };

    for (const [, byAttr] of byParent) {
      for (const [, relations] of byAttr) {
        sortRelations(relations);
      }
    }

    for (const [, relations] of byChild) {
      relations.sort((a, b) => {
        const aOrder = a.sortOrder ?? null;
        const bOrder = b.sortOrder ?? null;
        if (aOrder !== null && bOrder !== null && aOrder !== bOrder) return aOrder - bOrder;
        if (aOrder !== null && bOrder === null) return -1;
        if (aOrder === null && bOrder !== null) return 1;
        return a.statAttribute.localeCompare(b.statAttribute);
      });
    }

    if (isDevEnv() && byParent.size > 0) {
      console.debug("[AdminScreen] statRelations ready", {
        parents: byParent.size,
        children: byChild.size,
      });
    }

    return { statRelationsByParent: byParent, statRelationsByChild: byChild };
  }, [statsData?.statRelations, statsById]);

  const childIdSet = useMemo(() => new Set(Array.from(statRelationsByChild.keys())), [statRelationsByChild]);

  const parentsByChild = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const [childId, relations] of statRelationsByChild.entries()) {
      map.set(
        childId,
        relations
          .map((rel) => rel.parentStatId)
          .filter((id): id is string => typeof id === "string" && id.length > 0),
      );
    }
    return map;
  }, [statRelationsByChild]);

  const effectiveMetaById = useMemo(
    () => buildEffectiveStatMetaById(statsById as unknown as Map<string, Stat>, parentsByChild),
    [statsById, parentsByChild],
  );

  const visibilitySyncInFlightRef = useRef(false);
  const syncVisibilityEffective = useCallback(async () => {
    if (visibilitySyncInFlightRef.current) return;
    if (stats.length === 0) return;

    const pending = new Map<string, Record<string, unknown>>();
    const queueUpdate = (statId: string, updates: Record<string, unknown>) => {
      const existing = pending.get(statId) ?? {};
      pending.set(statId, { ...existing, ...updates });
    };

    for (const stat of stats) {
      const meta = effectiveMetaById.get(stat.id);
      if (!meta) continue;
      if (stat.visibilityEffective !== meta.visibility) {
        queueUpdate(stat.id, { visibilityEffective: meta.visibility });
      }
      const declaredVisibility = normalizeStatVisibility(stat.visibility);
      if (
        !stat.createdBy &&
        !declaredVisibility &&
        meta.visibility !== "public" &&
        meta.ownerId
      ) {
        queueUpdate(stat.id, { createdBy: meta.ownerId });
      }
    }

    if (pending.size === 0) return;
    visibilitySyncInFlightRef.current = true;
    try {
      const txs = Array.from(pending.entries()).map(([statId, updates]) =>
        db.tx.stats[statId].update(updates),
      );
      const batchSize = 25;
      for (let i = 0; i < txs.length; i += batchSize) {
        await db.transact(txs.slice(i, i + batchSize));
      }
    } catch (error) {
      console.warn("[AdminScreen] Failed to sync visibilityEffective", error);
    } finally {
      visibilitySyncInFlightRef.current = false;
    }
  }, [effectiveMetaById, stats]);

  useEffect(() => {
    void syncVisibilityEffective();
  }, [syncVisibilityEffective]);

  const hasDescendant = useCallback(
    (ancestorId: string, targetId: string, visited = new Set<string>()) => {
      if (visited.has(ancestorId)) return false;
      visited.add(ancestorId);
      const byAttr = statRelationsByParent.get(ancestorId);
      if (!byAttr) return false;
      for (const relations of byAttr.values()) {
        for (const rel of relations) {
          if (rel.childStatId === targetId) return true;
          if (hasDescendant(rel.childStatId, targetId, visited)) return true;
        }
      }
      return false;
    },
    [statRelationsByParent],
  );

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

    // Hide child stats from top-level list
    filtered = filtered.filter((s) => !childIdSet.has(s.id));

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
  }, [stats, categoryFilter, searchQuery, sortBy, recentStatIds, childIdSet]);

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

  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [groupParentId, setGroupParentId] = useState<string | null>(null);
  const [groupAttribute, setGroupAttribute] = useState("");
  const [groupSortOrder, setGroupSortOrder] = useState("");
  const [groupError, setGroupError] = useState<string | null>(null);
  const [groupNotice, setGroupNotice] = useState<string | null>(null);
  const [isGrouping, setIsGrouping] = useState(false);
  const [expandedParentId, setExpandedParentId] = useState<string | null>(null);
  const [expandedChildIds, setExpandedChildIds] = useState<Record<string, boolean>>({});
  const [editingRelationAttribute, setEditingRelationAttribute] = useState<{
    parentStatId: string;
    attribute: string;
  } | null>(null);
  const [editingRelationAttributeDraft, setEditingRelationAttributeDraft] = useState("");
  const [isUpdatingRelationAttribute, setIsUpdatingRelationAttribute] = useState(false);
  const relationAttributeInputRef = useRef<HTMLInputElement | null>(null);

  const handleStartEditingRelationAttribute = useCallback((parentStatId: string, attribute: string) => {
    setEditingRelationAttribute({ parentStatId, attribute });
    setEditingRelationAttributeDraft(attribute === UNDEFINED_STAT_ATTRIBUTE ? "" : attribute);
  }, []);

  const handleCancelEditingRelationAttribute = useCallback(() => {
    setEditingRelationAttribute(null);
    setEditingRelationAttributeDraft("");
  }, []);

  const handleCommitRelationAttribute = useCallback(
    async (parentStatId: string, currentAttribute: string, draft: string) => {
      if (isUpdatingRelationAttribute) return;

      const normalized = draft.trim();
      const nextAttribute = normalized ? normalized : UNDEFINED_STAT_ATTRIBUTE;
      if (nextAttribute === currentAttribute) {
        handleCancelEditingRelationAttribute();
        return;
      }

      const byAttr = statRelationsByParent.get(parentStatId);
      const relations = byAttr?.get(currentAttribute) ?? [];
      if (relations.length === 0) {
        handleCancelEditingRelationAttribute();
        return;
      }

      const keysBeingReplaced = new Set(relations.map((rel) => rel.relationKey));
      const existingKeys = new Set<string>();
      if (byAttr) {
        for (const rels of byAttr.values()) {
          for (const rel of rels) existingKeys.add(rel.relationKey);
        }
      }
      for (const key of keysBeingReplaced) existingKeys.delete(key);

      const now = Date.now();
      const nextKeys: string[] = [];
      const conflicts: string[] = [];

      for (const rel of relations) {
        const nextKey = `${parentStatId}::${rel.childStatId}::${nextAttribute}`;
        nextKeys.push(nextKey);
        if (existingKeys.has(nextKey)) {
          const child = statsById.get(rel.childStatId);
          conflicts.push(child ? child.label || child.name : rel.childStatId);
        }
      }

      if (conflicts.length > 0) {
        if (typeof window !== "undefined") {
          window.alert(
            `Cannot rename attribute because these child stats already have a relation under "${nextAttribute}":\n\n${conflicts.join(
              "\n",
            )}`,
          );
        }
        return;
      }

      const txs = relations.map((rel, index) =>
        db.tx.statRelations[rel.id].update({
          relationKey: nextKeys[index],
          statAttribute: nextAttribute,
          updatedAt: now,
        }),
      );

      try {
        setIsUpdatingRelationAttribute(true);
        await db.transact(txs);
        setGroupNotice(
          `Updated attribute: ${
            currentAttribute === UNDEFINED_STAT_ATTRIBUTE ? "Undefined" : currentAttribute
          } → ${nextAttribute === UNDEFINED_STAT_ATTRIBUTE ? "Undefined" : nextAttribute}`,
        );
        handleCancelEditingRelationAttribute();
      } catch (err) {
        console.error("Failed to update stat relation attribute", err);
        if (typeof window !== "undefined") {
          window.alert(err instanceof Error ? err.message : "Failed to update stat relation attribute.");
        }
      } finally {
        setIsUpdatingRelationAttribute(false);
      }
    },
    [handleCancelEditingRelationAttribute, isUpdatingRelationAttribute, statRelationsByParent, statsById],
  );

  useEffect(() => {
    if (!editingRelationAttribute) return;
    const timeout = setTimeout(() => {
      relationAttributeInputRef.current?.focus();
      relationAttributeInputRef.current?.select();
    }, 0);
    return () => clearTimeout(timeout);
  }, [editingRelationAttribute]);

  const parentOptions = useMemo(
    () =>
      stats
        .slice()
        .sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name))
        .map((stat) => ({
          value: stat.id,
          label: stat.label || stat.name,
        })),
    [stats, user?.id],
  );

  const handleOpenGroupModal = useCallback(() => {
    if (selectedCount === 0) return;
    setGroupAttribute("");
    setGroupSortOrder("");
    setGroupError(null);
    setGroupNotice(null);
    // default parent to first selected if available
    const defaultParent = selectedStatIds[0] ?? null;
    setGroupParentId(defaultParent);
    setIsGroupModalOpen(true);
  }, [selectedCount, selectedStatIds]);

  const handleCloseGroupModal = useCallback(() => {
    setIsGroupModalOpen(false);
    setGroupError(null);
  }, []);

  const handleSubmitGroup = useCallback(async () => {
    if (!groupParentId) {
      setGroupError("Select a parent stat.");
      return;
    }
    const attribute = groupAttribute.trim();
    if (!attribute) {
      setGroupError("Stat attribute is required.");
      return;
    }

    const sortOrderValue = groupSortOrder.trim();
    let sortOrder: number | null = null;
    if (sortOrderValue) {
      const parsed = Number(sortOrderValue);
      if (!Number.isFinite(parsed)) {
        setGroupError("Sort order must be a number.");
        return;
      }
      sortOrder = parsed;
    }

    const now = Date.now();
    const childIds = selectedStatIds.filter((id) => id !== groupParentId);
    if (childIds.length === 0) {
      setGroupError("Select at least one child stat (parent cannot be its own child).");
      return;
    }

    // Prevent cycles: child cannot already be an ancestor of the parent
    for (const childId of childIds) {
      if (hasDescendant(childId, groupParentId)) {
        setGroupError("Cannot create a cycle between parent and child.");
        return;
      }
    }

    const existingByAttr = statRelationsByParent.get(groupParentId);
    const existingKeys = new Set<string>();
    if (existingByAttr) {
      const existing = existingByAttr.get(attribute);
      if (existing) {
        for (const rel of existing) {
          existingKeys.add(rel.relationKey);
        }
      }
    }

    const txs: any[] = [];
    for (const childId of childIds) {
      const key = `${groupParentId}::${childId}::${attribute}`;
      if (existingKeys.has(key)) continue;
      txs.push(
        db.tx.statRelations[createId()].update({
          relationKey: key,
          parentStatId: groupParentId,
          childStatId: childId,
          statAttribute: attribute,
          sortOrder: sortOrder ?? undefined,
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    if (txs.length === 0) {
      setGroupError("All selected stats are already grouped under this parent and attribute.");
      return;
    }

    try {
      setIsGrouping(true);
      await db.transact(txs);
      setGroupNotice(`Grouped ${txs.length} stat${txs.length === 1 ? "" : "s"} under the parent.`);
      setIsGroupModalOpen(false);
    } catch (err) {
      console.error("Failed to group stats", err);
      setGroupError(err instanceof Error ? err.message : "Failed to group stats.");
    } finally {
      setIsGrouping(false);
    }
  }, [groupParentId, groupAttribute, groupSortOrder, selectedStatIds, statRelationsByParent, statRelationsByChild, statsById]);

  const handleUnlinkRelation = useCallback(async (relationId: string) => {
    try {
      await db.transact(db.tx.statRelations[relationId].delete());
    } catch (err) {
      console.error("Failed to unlink stat relation", err);
    }
  }, []);

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
          // Range select from anchor to current (only works for parent-level stats)
          const anchor = selectionAnchorId ?? prev[prev.length - 1] ?? statId;
          const anchorIndex = statIndexMap.get(anchor);
          const currentIndex = statIndexMap.get(statId);
          if (anchorIndex != null && currentIndex != null) {
            // Both are parent-level stats: do range selection
            const [start, end] = anchorIndex <= currentIndex ? [anchorIndex, currentIndex] : [currentIndex, anchorIndex];
            const rangeIds = sortedStats.slice(start, end + 1).map((stat) => stat.id);
            const union = new Set(prev);
            rangeIds.forEach((id) => union.add(id));
            next = sortSelection(Array.from(union));
            return next;
          }
          // Child/grandchild or mixed levels: just toggle this individual stat
          // This allows selecting multiple stats across hierarchy levels
          next = sortSelection([...prev, statId]);
          return next;
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

      // Update anchor: always update on regular click, or on shift+click for children/grandchildren
      // (for parent-level shift+click range selection, we keep the original anchor)
      const currentIndex = statIndexMap.get(statId);
      if (!event.shiftKey || currentIndex == null) {
        // Regular click, or shift+click on child/grandchild: update anchor
        setSelectionAnchorId(statId);
      }
      // Shift+click on parent-level stat: keep existing anchor for range selection
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

  useEffect(() => {
    if (expandedParentId && !statRelationsByParent.has(expandedParentId)) {
      setExpandedParentId(null);
    }
  }, [expandedParentId, statRelationsByParent]);

  // Clear all selections and exit selection mode
  const handleClearSelection = useCallback(() => {
    setSelectedStatIds([]);
    setSelectionAnchorId(null);
    setIsSelectionMode(false);
  }, []);

  const requestDerivedYearsForStat = useCallback(
    async (statId: string) => {
      const trimmedId = statId.trim();
      if (!trimmedId) return;

      if (derivedYearsByStatId.has(trimmedId)) return;
      if (derivedYearsLoading.has(trimmedId)) return;

      setDerivedYearsLoading((prev) => {
        if (prev.has(trimmedId)) return prev;
        const next = new Set(prev);
        next.add(trimmedId);
        return next;
      });

      try {
        const { data } = await db.queryOnce({
          statData: {
            $: {
              where: { statId: trimmedId, name: "root" },
              fields: ["date"],
              limit: 10000,
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
        const sortedYears = Array.from(years).sort();
        setDerivedYearsByStatId((prev) => {
          const next = new Map(prev);
          next.set(trimmedId, sortedYears);
          return next;
        });
      } catch (err) {
        console.warn("Failed to fetch years for stat", err);
      } finally {
        setDerivedYearsLoading((prev) => {
          if (!prev.has(trimmedId)) return prev;
          const next = new Set(prev);
          next.delete(trimmedId);
          return next;
        });
      }
    },
    [derivedYearsByStatId, derivedYearsLoading],
  );

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
    setDerivedError(null);

    // Preserve user selection order (including children) using the full stats map
    const seenIds = new Set<string>();
    const selectedStats: StatItem[] = [];
    for (const id of selectedStatIds) {
      if (seenIds.has(id)) continue;
      const stat = statsById.get(id);
      if (stat) {
        seenIds.add(id);
        selectedStats.push(stat);
      }
    }

    const baseStats = selectedStats.length ? selectedStats : stats;
    const selection = baseStats.map<DerivedStatOption>((stat) => ({
      id: stat.id,
      name: stat.name,
      label: stat.label,
      category: stat.category,
    }));

    if (selection.length === 0) {
      // This should rarely happen, but if it does, show error and don't open modal
      setDerivedError("No stats are available to build a derived stat.");
      console.warn("handleRequestDerivedStat: No stats available for derived stat creation");
      return;
    }

    setDerivedSelection(selection);
    setIsDerivedModalOpen(true);
    if (selection.length === 1) {
      void requestDerivedYearsForStat(selection[0].id);
    }
  }, [selectedStatIds, statsById, stats, requestDerivedYearsForStat]);

  const handleDerivedModalClose = useCallback(() => {
    setIsDerivedModalOpen(false);
    setDerivedSelection([]);
    setDerivedError(null);
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
              visibility: "private",
              createdBy: user?.id ?? null,
              createdOn: now,
              lastUpdated: now,
            }),
          ];

          const sortedDerivedRows = [...derivedRows].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
          for (const row of sortedDerivedRows) {
            const parentArea = row.parentArea ?? undefined;
            const boundaryType = row.boundaryType ?? undefined;
            const date = row.date ?? undefined;
            const summaryKey =
              parentArea && boundaryType ? buildStatDataSummaryKey(newStatId, "root", parentArea, boundaryType) : null;
            const summary = computeSummaryFromData(row.data);
            txs.push(
              db.tx.statData[createId()].update({
                statId: newStatId,
                name: "root",
                parentArea,
                boundaryType,
                date,
                type: "percent_change",
                data: row.data,
                source: derivedSource,
                statTitle: displayName,
                createdOn: now,
                lastUpdated: now,
              }),
            );
            if (summaryKey && date) {
              txs.push(
                db.tx.statDataSummaries[lookup("summaryKey", summaryKey)].update({
                  statId: newStatId,
                  name: "root",
                  parentArea,
                  boundaryType,
                  date,
                  minDate: date,
                  maxDate: date,
                  type: "percent_change",
                  count: summary.count,
                  sum: summary.sum,
                  avg: summary.avg,
                  min: summary.min,
                  max: summary.max,
                  updatedAt: now,
                }),
              );
            }
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
              visibility: "private",
              createdBy: user?.id ?? null,
              createdOn: now,
              lastUpdated: now,
            }),
          ];

          const sortedDerivedRows = [...derivedRows].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
          for (const row of sortedDerivedRows) {
            const parentArea = row.parentArea ?? undefined;
            const boundaryType = row.boundaryType ?? undefined;
            const date = row.date ?? undefined;
            const summaryKey =
              parentArea && boundaryType ? buildStatDataSummaryKey(newStatId, "root", parentArea, boundaryType) : null;
            const summary = computeSummaryFromData(row.data);
            txs.push(
              db.tx.statData[createId()].update({
                statId: newStatId,
                name: "root",
                parentArea,
                boundaryType,
                date,
                type: "number",
                data: row.data,
                source: derivedSource,
                statTitle: displayName,
                createdOn: now,
                lastUpdated: now,
              }),
            );
            if (summaryKey && date) {
              txs.push(
                db.tx.statDataSummaries[lookup("summaryKey", summaryKey)].update({
                  statId: newStatId,
                  name: "root",
                  parentArea,
                  boundaryType,
                  date,
                  minDate: date,
                  maxDate: date,
                  type: "number",
                  count: summary.count,
                  sum: summary.sum,
                  avg: summary.avg,
                  min: summary.min,
                  max: summary.max,
                  updatedAt: now,
                }),
              );
            }
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
              visibility: "private",
              createdBy: user?.id ?? null,
              createdOn: now,
              lastUpdated: now,
            }),
        ];

        const sortedDerivedRows = [...derivedRows].sort((a, b) => String(a.date ?? "").localeCompare(String(b.date ?? "")));
        for (const row of sortedDerivedRows) {
          const parentArea = row.parentArea ?? undefined;
          const boundaryType = row.boundaryType ?? undefined;
          const date = row.date ?? undefined;
          const summaryKey =
            parentArea && boundaryType ? buildStatDataSummaryKey(newStatId, "root", parentArea, boundaryType) : null;
          const summary = computeSummaryFromData(row.data);
          txs.push(
            db.tx.statData[createId()].update({
              statId: newStatId,
              name: "root",
              parentArea,
              boundaryType,
              date,
              type: formulaToStatType[payload.formula],
              data: row.data,
              source: derivedSource,
              statTitle: displayName,
              createdOn: now,
              lastUpdated: now,
            }),
          );
          if (summaryKey && date) {
            txs.push(
              db.tx.statDataSummaries[lookup("summaryKey", summaryKey)].update({
                statId: newStatId,
                name: "root",
                parentArea,
                boundaryType,
                date,
                minDate: date,
                maxDate: date,
                type: formulaToStatType[payload.formula],
                count: summary.count,
                sum: summary.sum,
                avg: summary.avg,
                min: summary.min,
                max: summary.max,
                updatedAt: now,
              }),
            );
          }
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

  const SUMMARY_STAT_BATCH_SIZE = 60;

  const summaryTargetStatIds = useMemo(() => {
    // Keep Admin summary reads bounded: only fetch details for the top of the list + expanded children.
    // This avoids any accidental "load everything" behavior while still giving context for visible cards.
    const seen = new Set<string>();
    const ids: string[] = [];
    const add = (id: string) => {
      if (!id) return;
      if (seen.has(id)) return;
      seen.add(id);
      ids.push(id);
    };

    for (const stat of sortedStats.slice(0, SUMMARY_STAT_BATCH_SIZE)) {
      add(stat.id);
    }

    if (expandedParentId) {
      const groups = statRelationsByParent.get(expandedParentId);
      if (groups) {
        for (const relations of groups.values()) {
          for (const rel of relations) {
            add(rel.childStatId);
            if (expandedChildIds[rel.childStatId] === true) {
              const grandGroups = statRelationsByParent.get(rel.childStatId);
              if (!grandGroups) continue;
              for (const grandRels of grandGroups.values()) {
                for (const grandRel of grandRels) {
                  add(grandRel.childStatId);
                }
              }
            }
          }
        }
      }
    }

    return ids;
  }, [sortedStats, expandedParentId, expandedChildIds, statRelationsByParent]);

  const summaryTargetIdSet = useMemo(() => new Set(summaryTargetStatIds), [summaryTargetStatIds]);

  // Secondary query: statDataSummaries (small, avoids scanning statData)
  const {
    data: statSummariesResponse,
    isLoading: statSummariesLoading,
    error: statSummariesError,
  } = db.useQuery(
    statsQueryEnabled && statSummariesQueryEnabled && summaryTargetStatIds.length > 0
      ? {
          statDataSummaries: {
            $: {
              where: { name: "root", statId: { $in: summaryTargetStatIds } },
              fields: [
                "id",
                "statId",
                "parentArea",
                "boundaryType",
                "date",
                "minDate",
                "maxDate",
                "type",
                "count",
                "sum",
                "avg",
                "min",
                "max",
                "updatedAt",
              ],
              order: { statId: "asc" as const },
            },
          },
        }
      : null,
  );

  // Log statDataSummaries errors but don't block the screen
  useEffect(() => {
    if (!statSummariesError) return;
    if (!IS_DEV) return;
    const anyError = statSummariesError as any;
    console.warn("[AdminScreen] statDataSummaries query failed", {
      message: anyError.message,
      hint: anyError.hint,
    });
  }, [statSummariesError]);

  const [statDataSummaryByStatId, setStatDataSummaryByStatId] = useState<Map<string, StatDataSummary>>(new Map());
  const [lastStatSummariesRowCount, setLastStatSummariesRowCount] = useState<number | null>(null);
  useEffect(() => {
    const rows = (statSummariesResponse as any)?.statDataSummaries;
    if (!Array.isArray(rows)) return;
    setLastStatSummariesRowCount(rows.length);
    if (rows.length === 0) return;

    const map = new Map<string, StatDataSummary>();

    const formatBoundaryLabel = (types: string[]): string => {
      if (types.length === 0) return "";
      const uniq = Array.from(new Set(types));
      if (uniq.length === 1) {
        return uniq[0] === "ZIP" ? "ZIPs" : uniq[0] === "COUNTY" ? "Counties" : uniq[0];
      }
      const pretty = uniq.map((t) => (t === "ZIP" ? "ZIPs" : t === "COUNTY" ? "Counties" : t));
      return pretty.join(" + ");
    };

    const scoreSample = (row: any): number => {
      const boundaryType = typeof row?.boundaryType === "string" ? row.boundaryType : "";
      const parentArea = typeof row?.parentArea === "string" ? row.parentArea.toLowerCase() : "";
      let score = 0;
      if (boundaryType === "ZIP") score += 10;
      if (boundaryType === "COUNTY") score += 5;
      if (parentArea.includes("tulsa")) score += 3;
      return score;
    };

    for (const row of rows) {
      const statId = typeof row?.statId === "string" ? (row.statId as string) : null;
      if (!statId) continue;
      const boundaryType = typeof row?.boundaryType === "string" ? (row.boundaryType as string) : null;
      const rawDate = row?.date;
      const date =
        typeof rawDate === "string" ? rawDate : typeof rawDate === "number" ? String(rawDate) : null;
      const minDate = typeof row?.minDate === "string" && row.minDate.trim() ? row.minDate.trim() : null;
      const maxDate = typeof row?.maxDate === "string" && row.maxDate.trim() ? row.maxDate.trim() : null;
      const updatedAt =
        typeof row?.updatedAt === "number" && Number.isFinite(row.updatedAt) ? (row.updatedAt as number) : null;
      if (!date) continue;

      let entry = map.get(statId);
      if (!entry) {
        entry = {
          boundaryTypes: [],
          boundaryLabel: "",
          latestDate: null,
          yearsLabel: "",
          updatedAt: null,
          contextsCount: 0,
          sample: null,
        };
        map.set(statId, entry);
      }

      entry.contextsCount += 1;
      if (boundaryType && !entry.boundaryTypes.includes(boundaryType)) {
        entry.boundaryTypes.push(boundaryType);
      }
      if (!entry.latestDate || date.localeCompare(entry.latestDate) > 0) {
        entry.latestDate = date;
      }
      if (updatedAt !== null && (entry.updatedAt === null || updatedAt > entry.updatedAt)) {
        entry.updatedAt = updatedAt;
      }

      const type = typeof row?.type === "string" ? row.type : "count";
      const count = typeof row?.count === "number" && Number.isFinite(row.count) ? row.count : 0;
      const sum = typeof row?.sum === "number" && Number.isFinite(row.sum) ? row.sum : 0;
      const avg = typeof row?.avg === "number" && Number.isFinite(row.avg) ? row.avg : 0;
      const min = typeof row?.min === "number" && Number.isFinite(row.min) ? row.min : 0;
      const max = typeof row?.max === "number" && Number.isFinite(row.max) ? row.max : 0;
      const parentArea = typeof row?.parentArea === "string" ? row.parentArea : "";

      const candidate = {
        parentArea,
        boundaryType: boundaryType ?? "",
        date,
        minDate: minDate ?? undefined,
        maxDate: maxDate ?? undefined,
        type,
        count,
        sum,
        avg,
        min,
        max,
        updatedAt: updatedAt ?? 0,
      };

      const hasSample = Boolean(entry.sample);
      if (!hasSample) {
        entry.sample = candidate;
      } else if (candidate.date.localeCompare(entry.sample!.date) > 0) {
        entry.sample = candidate;
      } else if (candidate.date === entry.sample!.date && scoreSample(candidate) > scoreSample(entry.sample)) {
        entry.sample = candidate;
      }
    }

    for (const entry of map.values()) {
      entry.boundaryTypes.sort();
      entry.boundaryLabel = formatBoundaryLabel(entry.boundaryTypes);
    }

    // Compute year range per stat from per-context min/max (no statData scan required).
    for (const [statId, entry] of map.entries()) {
      let minSeen: string | null = null;
      let maxSeen: string | null = null;
      for (const row of rows) {
        if (row?.statId !== statId) continue;
        const minDate = typeof row?.minDate === "string" && row.minDate.trim() ? row.minDate.trim() : null;
        const maxDate = typeof row?.maxDate === "string" && row.maxDate.trim() ? row.maxDate.trim() : null;
        if (minDate && (!minSeen || minDate.localeCompare(minSeen) < 0)) minSeen = minDate;
        if (maxDate && (!maxSeen || maxDate.localeCompare(maxSeen) > 0)) maxSeen = maxDate;
      }
      entry.yearsLabel = formatYearRangeLabel(minSeen ?? entry.latestDate, maxSeen ?? entry.latestDate);
    }

    setStatDataSummaryByStatId((prev) => {
      const next = new Map(prev);
      for (const [statId, summary] of map.entries()) {
        next.set(statId, summary);
      }
      return next;
    });
  }, [statSummariesResponse]);

  // Available years per stat id for derived modal (from summaries + single-stat fallback)
  const derivedAvailableYearsByStat = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const [statId, years] of derivedYearsByStatId.entries()) {
      result[statId] = years;
    }
    return result;
  }, [derivedYearsByStatId]);

  const derivedYearsLoadingByStatId = useMemo(() => {
    const result: Record<string, boolean> = {};
    for (const statId of derivedYearsLoading) {
      result[statId] = true;
    }
    return result;
  }, [derivedYearsLoading]);

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

  const setPoiStatus = useCallback((statId: string, next: PoiStatus) => {
    setPoiStatusByStatId((prev) => ({
      ...prev,
      [statId]: next,
    }));
  }, []);

  const runPoiAction = useCallback(
    async (statId: string, action: "recompute" | "deactivate", force = false): Promise<boolean> => {
      setPoiStatus(statId, {
        state: "running",
        message: action === "deactivate" ? "Deactivating…" : "Recalculating…",
        updatedAt: Date.now(),
      });
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (poiApiKey) {
          headers["x-poi-api-key"] = poiApiKey;
        }
        const response = await fetch("/api/points-of-interest-recompute", {
          method: "POST",
          headers,
          body: JSON.stringify({
            statId,
            action,
            force,
            callerEmail: user?.email ?? null,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | {
              rowsUpserted?: number;
              rowsDeactivated?: number;
              computedAt?: number;
              skipped?: boolean;
            }
          | null;
        if (!response.ok) {
          const reason =
            payload && typeof (payload as any).reason === "string"
              ? String((payload as any).reason)
              : "Request failed";
          throw new Error(reason);
        }
        const rowsUpserted =
          typeof payload?.rowsUpserted === "number" ? payload.rowsUpserted : 0;
        const rowsDeactivated =
          typeof payload?.rowsDeactivated === "number" ? payload.rowsDeactivated : 0;
        const computedAt =
          typeof payload?.computedAt === "number" && Number.isFinite(payload.computedAt)
            ? payload.computedAt
            : Date.now();
        const message = payload?.skipped
          ? "POI skipped (stat is not public or disabled)."
          : action === "deactivate"
          ? `POI deactivated (${rowsDeactivated} rows).`
          : `POI recalculated (${rowsUpserted} upserted, ${rowsDeactivated} deactivated).`;
        setPoiStatus(statId, {
          state: "success",
          message,
          updatedAt: computedAt,
        });
        return true;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : typeof error === "string"
            ? error
            : "POI operation failed";
        setPoiStatus(statId, {
          state: "error",
          message: `POI error: ${message}`,
          updatedAt: Date.now(),
        });
        return false;
      }
    },
    [poiApiKey, setPoiStatus, user?.email],
  );

  const handleRecalculatePoi = useCallback(
    async (statId: string) => {
      await runPoiAction(statId, "recompute", true);
    },
    [runPoiAction],
  );

  // Save changes to a stat
  const handleSave = useCallback(
    async (statId: string, form: EditFormState) => {
      setIsSaving(true);
      try {
        const current = statsById.get(statId) ?? null;
        const poiWasEnabled = current?.pointsOfInterestEnabled === true;
        const poiIsEnabled = form.pointsOfInterestEnabled === true;
        const resolvedVisibility = form.visibility === "inherit" ? null : form.visibility;
        const nextLabel = form.label.trim() || null;
        const updates: Record<string, unknown> = {
          name: form.name,
          label: nextLabel, // Store null if empty
          description: form.description.trim() || null,
          category: form.category,
          source: form.source.trim() || null,
          goodIfUp: form.goodIfUp,
          pointsOfInterestEnabled: poiIsEnabled,
          visibility: resolvedVisibility,
          featured: form.featured,
          homeFeatured: form.homeFeatured,
          lastUpdated: Date.now(),
        };
        if (
          (resolvedVisibility === "private" || resolvedVisibility === "inactive") &&
          !current?.createdBy &&
          user?.id
        ) {
          updates.createdBy = user.id;
        }
        await db.transact(
          db.tx.stats[statId].update({
            ...updates,
          }),
        );
        setEditingId(null);

        const poiRelevantChange =
          (current?.category ?? null) !== form.category ||
          (current?.goodIfUp ?? null) !== form.goodIfUp ||
          (current?.name ?? null) !== form.name ||
          (current?.label ?? null) !== nextLabel ||
          (current?.visibility ?? null) !== resolvedVisibility;

        if (poiWasEnabled && !poiIsEnabled) {
          await runPoiAction(statId, "deactivate", false);
        } else if (poiIsEnabled && (!poiWasEnabled || poiRelevantChange)) {
          await runPoiAction(statId, "recompute", true);
        }
      } catch (err) {
        console.error("Failed to save stat:", err);
        // Could show a toast here
      } finally {
        setIsSaving(false);
      }
    },
    [runPoiAction, statsById, user?.id],
  );

  // Recursively collect orphaned descendants (children with no other parents outside the deletion set)
  // Returns: { toDelete: Set of stat IDs to delete, toUnlink: Set of relation IDs to just unlink }
  const collectOrphanedDescendants = useCallback(
    (
      rootId: string,
      toDelete = new Set<string>(),
      toUnlink = new Set<string>(),
    ): { toDelete: Set<string>; toUnlink: Set<string> } => {
      if (toDelete.has(rootId)) return { toDelete, toUnlink }; // Prevent infinite loops
      toDelete.add(rootId);

      const byAttr = statRelationsByParent.get(rootId);
      if (!byAttr) return { toDelete, toUnlink };

      // For each child relation under this parent
      for (const relations of byAttr.values()) {
        for (const rel of relations) {
          const childId = rel.childStatId;
          if (!childId || toDelete.has(childId)) continue;

          // Check if this child has OTHER parents (not in toDelete set)
          const childParentRels = statRelationsByChild.get(childId) ?? [];
          const otherParents = childParentRels.filter(
            (r) => !toDelete.has(r.parentStatId),
          );

          if (otherParents.length === 0) {
            // Child would be orphaned → cascade delete
            collectOrphanedDescendants(childId, toDelete, toUnlink);
          } else {
            // Child has other parents → just unlink from this parent
            toUnlink.add(rel.id);
          }
        }
      }

      return { toDelete, toUnlink };
    },
    [statRelationsByParent, statRelationsByChild],
  );

  // Count how many OTHER parents a stat has (for warning messages)
  const countOtherParents = useCallback(
    (statId: string): number => {
      const parentRels = statRelationsByChild.get(statId) ?? [];
      return parentRels.length;
    },
    [statRelationsByChild],
  );

  const handleDeleteStat = useCallback(
    async (statId: string) => {
      if (deletingId) return;

      // Check if this stat is a child with multiple parents
      const parentCount = countOtherParents(statId);

      // Collect orphaned descendants and relations to unlink
      const { toDelete, toUnlink } = collectOrphanedDescendants(statId);
      const descendantCount = toDelete.size - 1; // Exclude the root stat itself
      const unlinkCount = toUnlink.size;

      // Build confirmation message
      if (typeof window !== "undefined") {
        let message: string;

        if (parentCount > 1) {
          // This stat is connected to multiple parents - warn user
          message = `This stat is a child of ${parentCount} parent stat${parentCount === 1 ? '' : 's'}. ` +
            `Deleting will remove it from ALL parents.`;
          if (descendantCount > 0) {
            message += `\n\nThis will also delete ${descendantCount} orphaned descendant${descendantCount === 1 ? '' : 's'}.`;
          }
          if (unlinkCount > 0) {
            message += `\n\n${unlinkCount} child stat${unlinkCount === 1 ? '' : 's'} with other parents will be unlinked but NOT deleted.`;
          }
          message += `\n\nThis cannot be undone. Continue?`;
        } else if (descendantCount > 0 || unlinkCount > 0) {
          message = `Delete this stat and all associated data?`;
          if (descendantCount > 0) {
            message += `\n\n${descendantCount} orphaned descendant${descendantCount === 1 ? '' : 's'} will also be deleted.`;
          }
          if (unlinkCount > 0) {
            message += `\n\n${unlinkCount} child stat${unlinkCount === 1 ? '' : 's'} with other parents will be unlinked but NOT deleted.`;
          }
          message += `\n\nThis cannot be undone.`;
        } else {
          message = "Delete this stat and all associated data (statData rows)? This cannot be undone.";
        }

        const confirmed = window.confirm(message);
        if (!confirmed) return;
      }

      setDeletingId(statId);
      try {
        const txs: any[] = [];

        // Query for ALL statData rows for the stats being deleted (not just "root").
        // Admin only subscribes to statDataSummaries (no statData row ids), so we need a fresh query here.
        const statIdsToDelete = Array.from(toDelete);
        const { data: allStatDataResponse } = await db.queryOnce({
          statData: {
            $: {
              where: { statId: { $in: statIdsToDelete } },
              fields: ["id", "statId"],
            },
          },
        });

        // Delete ALL statData rows for stats being deleted
        const allStatDataRows = (allStatDataResponse as any)?.statData ?? [];
        for (const row of allStatDataRows) {
          if (row && typeof row.id === "string") {
            txs.push(db.tx.statData[row.id].delete());
          }
        }

        // Delete relations where BOTH parent and child are in toDelete set
        // OR just the relation ID is in toUnlink set
        const allRelations = statsData?.statRelations ?? [];
        for (const rel of allRelations) {
          if (!rel || typeof rel.id !== "string") continue;

          if (toUnlink.has(rel.id)) {
            // This is a relation to a child with other parents - just unlink
            txs.push(db.tx.statRelations[rel.id].delete());
          } else if (toDelete.has(rel.parentStatId) || toDelete.has(rel.childStatId)) {
            // Both sides are being deleted, or this stat is a child being removed from all parents
            txs.push(db.tx.statRelations[rel.id].delete());
          }
        }

        // Delete all stats in the toDelete set
        for (const id of toDelete) {
          txs.push(db.tx.stats[id].delete());
        }

        if (txs.length > 0) {
          await db.transact(txs);
        }

        // Clean up UI state for all deleted stats
        setEditingId((current) => (toDelete.has(current ?? "") ? null : current));
        setRecentStatIds((prev) => prev.filter((id) => !toDelete.has(id)));
      } catch (err) {
        console.error("Failed to delete stat:", err);
      } finally {
        setDeletingId((current) => (current === statId ? null : current));
      }
    },
    [statsData?.statRelations, deletingId, collectOrphanedDescendants, countOtherParents],
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

  // Switch to Orgs or Batches admin tab
  if (activeTab === "orgs" || activeTab === "batches") {
    return (
      <AdminOrgsPanel
        onSwitchTab={setActiveTab}
        initialViewMode={activeTab === "batches" ? "batches" : "orgs"}
      />
    );
  }

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
          {/* Tab selector with chevron */}
          <div ref={tabDropdownRef} className="relative shrink-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100 sm:text-xl">
                {activeTab === "stats" ? "Stats" : activeTab === "orgs" ? "Orgs" : "Batches"}
              </h1>
              <button
                type="button"
                onClick={() => setIsTabDropdownOpen(!isTabDropdownOpen)}
                className="rounded p-0.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-300"
                aria-label="Switch view"
              >
                <ChevronDownIcon
                  className={`h-4 w-4 transition-transform ${isTabDropdownOpen ? "rotate-180" : ""}`}
                />
              </button>
            </div>

            {/* Dropdown menu */}
            {isTabDropdownOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 w-32 rounded-lg border border-slate-300 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-950">
                <ul className="py-1">
                  {[
                    { value: "stats" as const, label: "Stats" },
                    { value: "orgs" as const, label: "Orgs" },
                    { value: "batches" as const, label: "Batches" },
                  ].map((tab) => {
                    const isActive = activeTab === tab.value;
                    return (
                      <li key={tab.value}>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTab(tab.value);
                            setIsTabDropdownOpen(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-xs ${
                            isActive
                              ? "bg-brand-50 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300"
                              : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                          }`}
                        >
                          {tab.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>

          {/* Count info */}
          <div className="shrink-0">
            <p className="text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">
              {sortedStats.length}{categoryFilter !== "all" || searchQuery ? ` of ${stats.length}` : ""} stat{sortedStats.length !== 1 ? "s" : ""}
              {editingId && <span className="ml-1 text-brand-500">(editing)</span>}
              {isSaving && <span className="ml-1 text-amber-500">Saving…</span>}
              {statSummariesLoading && <span className="ml-1 text-slate-400">· loading summaries…</span>}
              {statSummariesError && !statSummariesLoading && (
                <span className="ml-1 text-amber-500">
                  · {statDataSummaryByStatId.size === 0 ? "summaries unavailable" : "summaries stale (using cache)"}{" "}
                  <button
                    type="button"
                    onClick={retryStatSummaries}
                    className="text-brand-500 underline hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
                  >
                    retry
                  </button>
                  {statDataSummaryByStatId.size === 0 && (
                    <>
                      {" "}
                      ·{" "}
                      <button
                        type="button"
                        onClick={showBackfillSummariesHelp}
                        className="text-brand-500 underline hover:text-brand-600 dark:text-brand-400 dark:hover:text-brand-300"
                      >
                        backfill summaries
                      </button>
                    </>
                  )}
                </span>
              )}
            </p>
          </div>

          {/* Center: Filters - Category (desktop only), Search, Sort (desktop only) */}
          <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
            {/* Category filter - hidden on mobile */}
            <div className="hidden sm:block shrink-0">
              <CustomSelect
                value={categoryFilter}
                onChange={setCategoryFilter}
                compact
                options={[
                  { value: "all", label: "All Catgrs." },
                  ...availableCategories.map((cat) => ({
                    value: cat,
                    label: cat.charAt(0).toUpperCase() + cat.slice(1),
                  })),
                ]}
              />
            </div>

            {/* Search input */}
            <div className="relative flex-1 min-w-0 sm:max-w-none">
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
            <div className="hidden sm:block shrink-0">
              <CustomSelect
                value={sortBy}
                onChange={(val) => setSortBy(val as SortOption)}
                compact
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
                Select
              </button>
            )}
            <button
              type="button"
              onClick={handleOpenGroupModal}
              disabled={selectedCount === 0}
              className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900 ${
                selectedCount === 0
                  ? "cursor-not-allowed border-slate-200 text-slate-400 opacity-60 dark:border-slate-700 dark:text-slate-600"
                  : "border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              }`}
            >
              Group
            </button>
            <button
              type="button"
              onClick={() => setIsNewStatOpen(true)}
              className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-2 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900 sm:px-3 sm:py-1.5"
            >
              <span className="text-sm leading-none">+</span>
              <span>Import</span>
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
              <span>Create</span>
            </button>
          </div>
        </div>
      </div>

      {groupNotice && (
        <div className="mx-4 mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 shadow-sm dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200 sm:mx-6">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
            <div className="flex-1">{groupNotice}</div>
            <button
              type="button"
              onClick={() => setGroupNotice(null)}
              className="text-emerald-600 transition hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-100"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {!statSummariesLoading &&
        !statSummariesError &&
        stats.length > 0 &&
        summaryTargetStatIds.length > 0 &&
        lastStatSummariesRowCount === 0 && (
          <div className="mx-4 mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 shadow-sm dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200 sm:mx-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                No `statDataSummaries` found for the currently visible stats. Run a backfill to populate them.
                {appId && <span className="ml-2 text-xs text-amber-700/80 dark:text-amber-200/80">App: {appId}</span>}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={retryStatSummaries}
                  className="rounded-md bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={showBackfillSummariesHelp}
                  className="rounded-md bg-white px-2 py-1 text-xs font-medium text-brand-700 shadow-sm ring-1 ring-brand-200 hover:bg-brand-50 dark:bg-slate-900 dark:text-brand-200 dark:ring-brand-800 dark:hover:bg-brand-900/20"
                >
                  Backfill summaries
                </button>
              </div>
            </div>
          </div>
        )}

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
            {sortedStats.map((stat) => {
              const hasChildren = statRelationsByParent.has(stat.id);
              const isExpanded = expandedParentId === stat.id;
              const hasParent = (statRelationsByChild.get(stat.id)?.length ?? 0) > 0;
              const effectiveVisibility = effectiveMetaById.get(stat.id)?.visibility ?? "public";
              const childGroups = hasChildren
                ? Array.from(statRelationsByParent.get(stat.id)!.entries()).sort(([a], [b]) =>
                    a === UNDEFINED_STAT_ATTRIBUTE
                      ? 1
                      : b === UNDEFINED_STAT_ATTRIBUTE
                        ? -1
                        : a.localeCompare(b),
                  )
                : [];
              const childCount = hasChildren
                ? childGroups.reduce((sum, [, rels]) => sum + rels.length, 0)
                : 0;

              return (
                <div key={stat.id} className="flex flex-col gap-2">
                  <StatListItem
                    stat={stat}
                    isEditing={editingId === stat.id}
                    summary={statDataSummaryByStatId.get(stat.id)}
                    summaryLoading={statSummariesLoading}
                    summaryRequested={summaryTargetIdSet.has(stat.id)}
                    onShowSummaryHelp={showBackfillSummariesHelp}
                    isDeleting={deletingId === stat.id}
                    onStartEdit={() => handleStartEdit(stat.id)}
                    onSave={(form) => handleSave(stat.id, form)}
                    onCancel={handleCancel}
                    onDelete={() => handleDeleteStat(stat.id)}
                    isSelected={selectedIdSet.has(stat.id)}
                    onToggleSelect={(event) => handleToggleSelect(stat.id, event)}
                    selectionMode={isSelectionMode}
                    categoryOptions={statCategoryOptions}
                    hasParent={hasParent}
                    effectiveVisibility={effectiveVisibility}
                    hasChildren={hasChildren}
                    isExpanded={isExpanded}
                    childrenCount={childCount}
                    onToggleExpand={() =>
                      setExpandedParentId((prev) => (prev === stat.id ? null : stat.id))
                    }
                    poiInfo={poiInfoByStatId.get(stat.id)}
                    poiStatus={poiStatusByStatId[stat.id] ?? null}
                    onRecalculatePoi={() => handleRecalculatePoi(stat.id)}
                    poiBusy={poiStatusByStatId[stat.id]?.state === "running"}
                  />
                  {isExpanded && hasChildren && (
                    <div className="ml-4 mt-1 space-y-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 dark:border-slate-700 dark:bg-slate-800/60">
                      {childGroups.map(([attribute, relations]) => (
                        <div key={attribute} className="space-y-2">
                          {editingRelationAttribute?.parentStatId === stat.id &&
                          editingRelationAttribute.attribute === attribute ? (
                            <input
                              ref={relationAttributeInputRef}
                              value={editingRelationAttributeDraft}
                              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                setEditingRelationAttributeDraft(e.target.value)
                              }
                              onBlur={() => handleCancelEditingRelationAttribute()}
                              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  handleCommitRelationAttribute(stat.id, attribute, editingRelationAttributeDraft);
                                } else if (e.key === "Escape") {
                                  e.preventDefault();
                                  handleCancelEditingRelationAttribute();
                                }
                              }}
                              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-700 shadow-sm outline-none ring-brand-200 focus:border-brand-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:ring-brand-900/40 dark:focus:border-brand-500"
                              placeholder="Attribute (blank = undefined)"
                              disabled={isUpdatingRelationAttribute}
                            />
                          ) : (
                            <div
                              className="cursor-text select-text text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                              title="Double-click to edit attribute"
                              onDoubleClick={() => handleStartEditingRelationAttribute(stat.id, attribute)}
                            >
                              {attribute === UNDEFINED_STAT_ATTRIBUTE ? "Undefined" : attribute}
                            </div>
                          )}
                          <div className="space-y-2">
                            {relations.map((rel) => {
                              const child = statsById.get(rel.childStatId);
                              if (!child) return null;
                              const childHasChildren = statRelationsByParent.has(child.id);
                              const isChildExpanded = expandedChildIds[child.id] === true;
                              const childHasParent = (statRelationsByChild.get(child.id)?.length ?? 0) > 0;
                              const childEffectiveVisibility =
                                effectiveMetaById.get(child.id)?.visibility ?? "public";
                              const grandChildGroups = childHasChildren
                                ? Array.from(statRelationsByParent.get(child.id)!.entries()).sort(([a], [b]) =>
                                    a === UNDEFINED_STAT_ATTRIBUTE
                                      ? 1
                                      : b === UNDEFINED_STAT_ATTRIBUTE
                                        ? -1
                                        : a.localeCompare(b),
                                  )
                                : [];
                              const grandChildCount = childHasChildren
                                ? grandChildGroups.reduce((sum, [, rels]) => sum + rels.length, 0)
                                : 0;
                              return (
                                <div key={child.id} className="space-y-2">
                                  <StatListItem
                                    stat={child}
                                    isEditing={editingId === child.id}
                                    summary={statDataSummaryByStatId.get(child.id)}
                                    summaryLoading={statSummariesLoading}
                                    summaryRequested={summaryTargetIdSet.has(child.id)}
                                    onShowSummaryHelp={showBackfillSummariesHelp}
                                    isDeleting={deletingId === child.id}
                                    onStartEdit={() => handleStartEdit(child.id)}
                                    onSave={(form) => handleSave(child.id, form)}
                                    onCancel={handleCancel}
                                    onDelete={() => handleDeleteStat(child.id)}
                                    isSelected={selectedIdSet.has(child.id)}
                                    onToggleSelect={(event) => handleToggleSelect(child.id, event)}
                                    selectionMode={isSelectionMode}
                                    categoryOptions={statCategoryOptions}
                                    hasParent={childHasParent}
                                    effectiveVisibility={childEffectiveVisibility}
                                    hasChildren={childHasChildren}
                                    isExpanded={isChildExpanded}
                                    childrenCount={grandChildCount}
                                    onToggleExpand={
                                      childHasChildren
                                        ? () =>
                                            setExpandedChildIds((prev) => ({
                                              ...prev,
                                              [child.id]: !prev[child.id],
                                            }))
                                        : undefined
                                    }
                                    onUnlink={() => handleUnlinkRelation(rel.id)}
                                    poiInfo={poiInfoByStatId.get(child.id)}
                                    poiStatus={poiStatusByStatId[child.id] ?? null}
                                    onRecalculatePoi={() => handleRecalculatePoi(child.id)}
                                    poiBusy={poiStatusByStatId[child.id]?.state === "running"}
                                  />
                                  {childHasChildren && isChildExpanded && (
                                    <div className="ml-4 space-y-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
                                      {grandChildGroups.map(([gAttr, gRels]) => (
                                        <div key={gAttr} className="space-y-1">
                                          {editingRelationAttribute?.parentStatId === child.id &&
                                          editingRelationAttribute.attribute === gAttr ? (
                                            <input
                                              ref={relationAttributeInputRef}
                                              value={editingRelationAttributeDraft}
                                              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                                setEditingRelationAttributeDraft(e.target.value)
                                              }
                                              onBlur={() => handleCancelEditingRelationAttribute()}
                                              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                                                if (e.key === "Enter") {
                                                  e.preventDefault();
                                                  handleCommitRelationAttribute(child.id, gAttr, editingRelationAttributeDraft);
                                                } else if (e.key === "Escape") {
                                                  e.preventDefault();
                                                  handleCancelEditingRelationAttribute();
                                                }
                                              }}
                                              className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-700 shadow-sm outline-none ring-brand-200 focus:border-brand-400 focus:ring-2 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:ring-brand-900/40 dark:focus:border-brand-500"
                                              placeholder="Attribute (blank = undefined)"
                                              disabled={isUpdatingRelationAttribute}
                                            />
                                          ) : (
                                            <div
                                              className="cursor-text select-text text-[10px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                                              title="Double-click to edit attribute"
                                              onDoubleClick={() => handleStartEditingRelationAttribute(child.id, gAttr)}
                                            >
                                              {gAttr === UNDEFINED_STAT_ATTRIBUTE ? "Undefined" : gAttr}
                                            </div>
                                          )}
                                          <div className="space-y-1">
                                            {gRels.map((gRel) => {
                                              const grandChild = statsById.get(gRel.childStatId);
                                              if (!grandChild) return null;
                                              const grandChildHasParent =
                                                (statRelationsByChild.get(grandChild.id)?.length ?? 0) > 0;
                                              const grandChildEffectiveVisibility =
                                                effectiveMetaById.get(grandChild.id)?.visibility ?? "public";
                                              return (
                                                <StatListItem
                                                  key={grandChild.id}
                                                  stat={grandChild}
                                                  isEditing={editingId === grandChild.id}
                                                  summary={statDataSummaryByStatId.get(grandChild.id)}
                                                  summaryLoading={statSummariesLoading}
                                                  summaryRequested={summaryTargetIdSet.has(grandChild.id)}
                                                  onShowSummaryHelp={showBackfillSummariesHelp}
                                                  isDeleting={deletingId === grandChild.id}
                                                  onStartEdit={() => handleStartEdit(grandChild.id)}
                                                  onSave={(form) => handleSave(grandChild.id, form)}
                                                  onCancel={handleCancel}
                                                  onDelete={() => handleDeleteStat(grandChild.id)}
                                                  isSelected={selectedIdSet.has(grandChild.id)}
                                                  onToggleSelect={(event) => handleToggleSelect(grandChild.id, event)}
                                                  selectionMode={isSelectionMode}
                                                  categoryOptions={statCategoryOptions}
                                                  hasParent={grandChildHasParent}
                                                  effectiveVisibility={grandChildEffectiveVisibility}
                                                  hasChildren={false}
                                                  onUnlink={() => handleUnlinkRelation(gRel.id)}
                                                  poiInfo={poiInfoByStatId.get(grandChild.id)}
                                                  poiStatus={poiStatusByStatId[grandChild.id] ?? null}
                                                  onRecalculatePoi={() => handleRecalculatePoi(grandChild.id)}
                                                  poiBusy={poiStatusByStatId[grandChild.id]?.state === "running"}
                                                />
                                              );
                                            })}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <NewStatModal
        isOpen={isNewStatOpen}
        onClose={() => setIsNewStatOpen(false)}
        onImported={handleImportedFromModal}
        categoryOptions={statCategoryOptions}
        user={user}
        existingCensusStats={censusStatsByVariable}
        availableStats={stats}
      />
      {isGroupModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4 py-6">
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-4 shadow-2xl dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Group stats</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {selectedCount} child stat{selectedCount === 1 ? "" : "s"} selected
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseGroupModal}
                className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Parent stat
                </label>
                <CustomSelect
                  value={groupParentId ?? ""}
                  onChange={(val) => setGroupParentId(val || null)}
                  options={parentOptions}
                  placeholder="Select a parent stat"
                  className="w-full"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Stat attribute
                </label>
                <input
                  type="text"
                  value={groupAttribute}
                  onChange={(e) => setGroupAttribute(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-brand-900/50"
                  placeholder="e.g., Age, Income, Education"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Sort order (optional)
                </label>
                <input
                  type="number"
                  value={groupSortOrder}
                  onChange={(e) => setGroupSortOrder(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-brand-900/50"
                  placeholder="Lower numbers show first"
                />
              </div>

              {groupError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-800 dark:bg-rose-950/50 dark:text-rose-200">
                  {groupError}
                </div>
              )}
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleCloseGroupModal}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmitGroup}
                disabled={isGrouping}
                className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:opacity-60 dark:bg-brand-600 dark:hover:bg-brand-500"
              >
                {isGrouping ? "Grouping…" : "Group"}
              </button>
            </div>
          </div>
        </div>
      )}
      <DerivedStatModal
        isOpen={isDerivedModalOpen}
        stats={derivedSelection}
        categories={statCategoryOptions.map((c) => c.value)}
        availableYearsByStat={derivedAvailableYearsByStat}
        yearsLoadingByStatId={derivedYearsLoadingByStatId}
        onRequestYears={requestDerivedYearsForStat}
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
