import { useMemo, useState, useCallback, useRef, useEffect } from "react";
import type { KeyboardEvent, ChangeEvent } from "react";
import { db } from "../../lib/reactDb";

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
  onStartEdit: () => void;
  onSave: (form: EditFormState) => void;
  onCancel: () => void;
}

// Stat list item component with bar shape and curved corners
const StatListItem = ({ stat, isEditing, onStartEdit, onSave, onCancel }: StatListItemProps) => {
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
      {/* Label field */}
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
      </div>

      {/* Name field (original) */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Name <span className="text-slate-400 dark:text-slate-500">(original)</span>
        </label>
        <input
          type="text"
          value={form.name}
          onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange("name", e.target.value)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-900/50"
        />
      </div>

      {/* Category and Source row */}
      <div className="flex gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Category</label>
          <input
            type="text"
            value={form.category}
            onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange("category", e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:focus:border-brand-500 dark:focus:ring-brand-900/50"
          />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Source</label>
          <input
            type="text"
            value={form.source}
            onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange("source", e.target.value)}
            placeholder="e.g., Census, NE"
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-brand-500 dark:focus:ring-brand-900/50"
          />
        </div>
      </div>

      {/* Boolean toggles row */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={form.goodIfUp === true}
            onChange={(e) => handleChange("goodIfUp", e.target.checked ? true : false)}
            className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400 dark:border-slate-600 dark:bg-slate-700"
          />
          Good if up
        </label>
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

      {/* Action buttons */}
      <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-3 dark:border-slate-700">
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
  );
};

export const AdminScreen = () => {
  // Query stats from InstantDB
  const { data, isLoading, error } = db.useQuery({
    stats: {
      $: {
        order: { name: "asc" as const },
      },
    },
  });

  // State for which stat is being edited (null = none)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Parse and filter stats
  const stats = useMemo(() => {
    if (!data?.stats) return [];
    return data.stats.map(parseStat).filter((s): s is StatItem => s !== null);
  }, [data?.stats]);

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
      {/* Header */}
      <div className="shrink-0 border-b border-slate-200 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Stats</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          {stats.length} stat{stats.length !== 1 ? "s" : ""} in the database
          {editingId && <span className="ml-2 text-brand-500">(editing)</span>}
          {isSaving && <span className="ml-2 text-amber-500">Saving…</span>}
        </p>
      </div>

      {/* Stats list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {stats.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">No stats found</p>
          </div>
        ) : (
          <div className="mx-auto flex max-w-4xl flex-col gap-3">
            {stats.map((stat) => (
              <StatListItem
                key={stat.id}
                stat={stat}
                isEditing={editingId === stat.id}
                onStartEdit={() => handleStartEdit(stat.id)}
                onSave={(form) => handleSave(stat.id, form)}
                onCancel={handleCancel}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
