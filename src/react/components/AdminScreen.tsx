import { useMemo } from "react";
import { db } from "../../lib/reactDb";

// Stat item from InstantDB stats table
interface StatItem {
  id: string;
  name: string;
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

// Stat list item component with bar shape and curved corners
const StatListItem = ({ stat }: { stat: StatItem }) => {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-brand-200 hover:shadow-md dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600">
      {/* Top row: Name and category */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100">{stat.name}</h3>
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

  // Parse and filter stats
  const stats = useMemo(() => {
    if (!data?.stats) return [];
    return data.stats.map(parseStat).filter((s): s is StatItem => s !== null);
  }, [data?.stats]);

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
        </p>
      </div>

      {/* Stats list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {stats.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-slate-500 dark:text-slate-400">No stats found</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {stats.map((stat) => (
              <StatListItem key={stat.id} stat={stat} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
