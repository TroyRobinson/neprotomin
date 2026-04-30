import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import type { KeyboardEvent, ChangeEvent, MouseEvent } from "react";
import { id as createId, lookup } from "@instantdb/react";
import { db } from "../../lib/reactDb";
import { getEnvString, isDevEnv } from "../../lib/env";
import {
  FORMULA_TO_STAT_TYPE,
  buildRowsByStatId,
  buildStatDataSummaryKey,
  computeSummaryFromData,
  createDerivedStatRows,
  getDerivedSourceStatIds,
} from "../../lib/derivedStats";
import { useAuthSession } from "../hooks/useAuthSession";
import { useCategories } from "../hooks/useCategories";
import type { Stat, StatRelation, StatVisibility } from "../../types/stat";
import { UNDEFINED_STAT_ATTRIBUTE, buildEffectiveStatMetaById, normalizeStatVisibility } from "../../types/stat";
import { CustomSelect } from "./CustomSelect";
import {
  DerivedStatModal,
  type DerivedStatModalSubmit,
  type DerivedStatOption,
} from "./DerivedStatModal";
import { NewStatModal } from "./AdminNewStatModal";
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

const MAX_DERIVED_TX_BATCH = 10;

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
        const sourceStatIds = getDerivedSourceStatIds(payload.formula, payload);
        if (sourceStatIds.length === 0) {
          throw new Error("Unable to locate selected stats.");
        }
        for (const statId of sourceStatIds) {
          if (!statsById.has(statId)) {
            throw new Error("Unable to locate selected stats.");
          }
        }

        const { data: statDataResponse } = await db.queryOnce({
          statData: {
            $: {
              where: {
                name: "root",
                statId: { $in: sourceStatIds },
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
        const rowsByStat = buildRowsByStatId(rawRows);
        const derivedRows = createDerivedStatRows(payload.formula, payload, rowsByStat);

        const now = Date.now();
        const newStatId = createId();
        const autoName = payload.name.trim();
        const displayName = payload.label.trim();
        const trimmedCategory = payload.category.trim();
        const derivedSource = payload.description?.trim() || "Census Derived";
        const dataType = FORMULA_TO_STAT_TYPE[payload.formula];

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

        const sortedDerivedRows = [...derivedRows].sort((a, b) =>
          String(a.date ?? "").localeCompare(String(b.date ?? "")),
        );
        for (const row of sortedDerivedRows) {
          const parentArea = row.parentArea ?? undefined;
          const boundaryType = row.boundaryType ?? undefined;
          const date = row.date ?? undefined;
          const summaryKey =
            parentArea && boundaryType
              ? buildStatDataSummaryKey(newStatId, "root", parentArea, boundaryType)
              : null;
          const summary = computeSummaryFromData(row.data);

          txs.push(
            db.tx.statData[createId()].update({
              statId: newStatId,
              name: "root",
              parentArea,
              boundaryType,
              date,
              type: dataType,
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
                type: dataType,
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
          attemptedWrite = true;
          await db.transact(txs.slice(i, i + MAX_DERIVED_TX_BATCH));
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
    [statsById, user?.id],
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
