import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { db } from "../../lib/reactDb";
import { useAuthSession } from "../hooks/useAuthSession";
import { useCategories } from "../hooks/useCategories";
import type { Category, Organization, OrgImportBatch } from "../../types/organization";
import { CustomSelect } from "./CustomSelect";
import { ChevronDownIcon, FunnelIcon } from "@heroicons/react/24/outline";

type AdminOrgsPanelProps = {
  onSwitchTab: (tab: "stats" | "orgs" | "batches") => void;
  initialViewMode?: ViewMode;
};

type OrgRow = Organization & {
  source?: string | null;
};

type ViewMode = "orgs" | "batches";

const parseOrgRow = (row: any, allowedCategories: Set<string>): OrgRow | null => {
  if (!row || typeof row?.id !== "string" || typeof row?.name !== "string") return null;
  const category = typeof row?.category === "string" ? row.category : "health";
  if (allowedCategories.size > 0 && !allowedCategories.has(category)) return null;

  const normalizeString = (value: any): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  const normalizeNumber = (value: any): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;

  return {
    id: row.id,
    name: row.name,
    ownerEmail: normalizeString(row.ownerEmail),
    latitude: typeof row.latitude === "number" ? row.latitude : 0,
    longitude: typeof row.longitude === "number" ? row.longitude : 0,
    category: category as Category,
    website: normalizeString(row.website),
    address: normalizeString(row.address),
    city: normalizeString(row.city),
    state: normalizeString(row.state),
    postalCode: normalizeString(row.postalCode),
    phone: normalizeString(row.phone),
    hours: row?.hours ?? null,
    placeId: normalizeString(row.placeId),
    source: normalizeString(row.source) ?? null,
    googleCategory: normalizeString(row.googleCategory),
    keywordFound: normalizeString(row.keywordFound),
    status: normalizeString(row.status) as Organization["status"],
    lastSyncedAt: normalizeNumber(row.lastSyncedAt),
    raw: (row.raw as Record<string, unknown>) ?? null,
    moderationStatus: normalizeString(row.moderationStatus) as Organization["moderationStatus"],
    moderationChangedAt: normalizeNumber(row.moderationChangedAt),
    submittedAt: normalizeNumber(row.submittedAt),
    queueSortKey: normalizeNumber(row.queueSortKey),
    issueCount: normalizeNumber(row.issueCount),
    ein: normalizeString(row.ein),
    importBatchId: normalizeString(row.importBatchId),
    createdAt: normalizeNumber(row.createdAt),
    updatedAt: normalizeNumber(row.updatedAt),
  };
};

const parseBatch = (row: any): OrgImportBatch | null => {
  if (!row || typeof row?.id !== "string" || typeof row?.label !== "string") return null;
  return {
    id: row.id,
    label: row.label,
    source: typeof row.source === "string" ? row.source : null,
    filters: (row.filters as Record<string, unknown>) ?? null,
    status: (row.status as OrgImportBatch["status"]) ?? "running",
    requestedCount: typeof row.requestedCount === "number" ? row.requestedCount : null,
    importedCount: typeof row.importedCount === "number" ? row.importedCount : null,
    sampleOrgIds: Array.isArray(row.sampleOrgIds) ? (row.sampleOrgIds as string[]) : null,
    orgIds: Array.isArray(row.orgIds) ? (row.orgIds as string[]) : null,
    error: typeof row.error === "string" ? row.error : null,
    createdAt: typeof row.createdAt === "number" ? row.createdAt : Date.now(),
    createdBy: typeof row.createdBy === "string" ? row.createdBy : null,
    updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : null,
  };
};

const formatDateTime = (value: number | null | undefined): string => {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return "—";
  }
};

const statusBadge = (status: string | null | undefined) => {
  if (!status) return null;
  const value = status.toLowerCase();
  const styles =
    value === "active"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>{value}</span>
  );
};

const moderationBadge = (status: string | null | undefined) => {
  if (!status) return null;
  const value = status.toLowerCase();
  const palette: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200",
    approved: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    declined: "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200",
    removed: "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  };
  const styles = palette[value] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${styles}`}>
      {value}
    </span>
  );
};

type OrgImportModalProps = {
  isOpen: boolean;
  onClose: () => void;
  categoryOptions: Array<{ value: string; label: string }>;
  defaultCategory: string;
  onImported?: () => void;
  onImportStarted?: (batchId: string) => void;
  activeBatch?: OrgImportBatch | null;
};

const OrgImportModal = ({
  isOpen,
  onClose,
  categoryOptions,
  defaultCategory,
  onImported,
  onImportStarted,
  activeBatch,
}: OrgImportModalProps) => {
  const { user } = db.useAuth();
  const [category, setCategory] = useState<string>(defaultCategory);
  const [state, setState] = useState<string>("OK");
  const [city, setCity] = useState<string>("");
  const [includeKeywords, setIncludeKeywords] = useState<string>("food, pantry");
  const [excludeKeywords, setExcludeKeywords] = useState<string>("");
  const [limit, setLimit] = useState<number>(10);
  const [importAll, setImportAll] = useState<boolean>(false);
  const [label, setLabel] = useState<string>("ProPublica import");
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewItems, setPreviewItems] = useState<any[]>([]);
  const modalRef = useRef<HTMLDivElement>(null);

  // Auto-map our category to ProPublica NTEE major group (1-10)
  const derivedNtee = useMemo(() => {
    switch (category) {
      case "health":
        return "4";
      case "education":
        return "2";
      case "food":
      case "housing":
      case "economy":
        return "5";
      case "justice":
      case "demographics":
      default:
        return "7";
    }
  }, [category]);

  const handlePreview = useCallback(async () => {
    setIsPreviewing(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        category,
        state,
        city,
        includeKeywords,
        excludeKeywords,
        limit: String(limit),
      });
      if (derivedNtee) params.set("nteePrefix", derivedNtee);
      const response = await fetch(`/api/org-import-preview?${params.toString()}`);
      const rawText = await response.text();
      let payload: any = null;
      try {
        payload = rawText ? JSON.parse(rawText) : null;
      } catch {
        payload = null;
      }
      if (!response.ok || !payload) {
        const isSourceEcho =
          rawText && rawText.includes("import { fetchProPublicaOrgs") && rawText.includes("export default async function handler");
        const message = isSourceEcho
          ? "Preview API route is not running in dev. Start your serverless functions (e.g., `vercel dev`) so /api/org-import-preview executes."
          : (payload?.error || payload?.details || rawText || "Preview failed") + ` (status ${response.status})`;
        throw new Error(message);
      }
      setPreviewItems(Array.isArray(payload.items) ? payload.items : []);
      if (payload.warning) {
        setError(payload.warning);
      }
    } catch (err: any) {
      console.error("Org preview failed", err);
      setError(err?.message ?? "Preview failed");
      setPreviewItems([]);
    } finally {
      setIsPreviewing(false);
    }
  }, [category, state, city, includeKeywords, excludeKeywords, limit, derivedNtee]);

  const handleImport = useCallback(async () => {
    setIsImporting(true);
    setError(null);
    try {
      const response = await fetch("/api/org-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          nteePrefix: derivedNtee,
          state,
          city,
          includeKeywords,
          excludeKeywords,
          limit,
          importAll,
          label: label || "ProPublica import",
          createdBy: user?.email ?? null,
        }),
      });
      const rawText = await response.text();
      let payload: any = null;
      try {
        payload = rawText ? JSON.parse(rawText) : null;
      } catch {
        payload = null;
      }
      if (!response.ok || !payload?.ok) {
        const isSourceEcho =
          rawText && rawText.includes("import { fetchProPublicaOrgs") && rawText.includes("export default async function handler");
        const message = isSourceEcho
          ? "Import API route is not running in dev. Start your serverless functions (e.g., `vercel dev`) so /api/org-import executes."
          : (payload?.error || payload?.details || rawText || "Import failed") + ` (status ${response.status})`;
        throw new Error(message);
      }
      if (payload?.batchId && onImportStarted) {
        onImportStarted(payload.batchId);
      }
      setIsImporting(false);
      if (onImported) onImported();
      onClose();
    } catch (err: any) {
      setIsImporting(false);
      setError(err?.message ?? "Import failed");
    }
  }, [
    category,
    state,
    city,
    includeKeywords,
    excludeKeywords,
    limit,
    importAll,
    label,
    user?.email,
    onImported,
    onClose,
    onImportStarted,
  ]);

  // Close on ESC key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isImporting && !isPreviewing) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isImporting, isPreviewing, onClose]);

  // Close on click outside
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node) && !isImporting && !isPreviewing) {
        onClose();
      }
    },
    [isImporting, isPreviewing, onClose],
  );

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/40 px-4 py-6"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className="flex max-h-[calc(100vh-3rem)] w-full max-w-3xl flex-col rounded-2xl bg-white shadow-2xl dark:bg-slate-900"
      >
        <div className="shrink-0 flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-5 dark:border-slate-800">
          <div>
            <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Import orgs</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Choose filters, preview a few matches, then import from the ProPublica Nonprofit API.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" stroke="currentColor" fill="none">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto px-5 pb-6">
          <div className="mt-6 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40 sm:grid-cols-2">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Category</label>
            <CustomSelect value={category} onChange={setCategory} options={categoryOptions} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">NTEE major</label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200">
              Auto-mapped from category → {derivedNtee}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">State</label>
            <input
              value={state}
              onChange={(e) => setState(e.target.value)}
              placeholder="OK"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">City / area contains</label>
            <input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Tulsa"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Sent as part of the search query (ProPublica doesn&apos;t support a dedicated city filter).
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Include keywords</label>
            <input
              value={includeKeywords}
              onChange={(e) => setIncludeKeywords(e.target.value)}
              placeholder="food, pantry, meals"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Exclude keywords</label>
            <input
              value={excludeKeywords}
              onChange={(e) => setExcludeKeywords(e.target.value)}
              placeholder="foundation, alumni"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Import batch label</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="ProPublica import"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">Limit</label>
              <input
                type="number"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                min={1}
                max={200}
                className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              />
            </div>
            <label className="mt-5 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={importAll}
                onChange={(e) => setImportAll(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-500 focus:ring-brand-400 dark:border-slate-700 dark:bg-slate-800"
              />
              Import all matches
            </label>
          </div>
        </div>

        {error && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-200">
            {error}
          </div>
        )}
        {activeBatch && activeBatch.status === "running" && (
          <div className="mt-3 rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-sm text-brand-800 dark:border-brand-900/50 dark:bg-brand-900/30 dark:text-brand-100">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
              <div>
                <div className="text-xs font-semibold">
                  {typeof activeBatch.requestedCount === "number"
                    ? `Processing org ${(activeBatch.importedCount ?? 0) + 1} of ${activeBatch.requestedCount}`
                    : "Processing organizations…"}
                </div>
                <div className="text-xs">
                  Saved {activeBatch.importedCount ?? 0}
                  {typeof activeBatch.requestedCount === "number" ? ` / ${activeBatch.requestedCount}` : ""} · Fetching details -&gt; geocoding -&gt; saving to InstantDB
                </div>
              </div>
            </div>
          </div>
        )}

          <div className="mt-4 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <button
              type="button"
              onClick={handlePreview}
              disabled={isPreviewing}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {isPreviewing && <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />}
              Preview 10
            </button>
            <span>Preview shows the first 10 matches with current filters (requires serverless /api running).</span>
          </div>

          <div className="mt-4 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
            {previewItems.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {isPreviewing ? "Loading preview…" : "No preview yet. Run Preview to see matches."}
              </p>
            ) : (
              <div className="space-y-2">
                {previewItems.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg bg-white px-3 py-2 shadow-sm ring-1 ring-slate-200 dark:bg-slate-800 dark:ring-slate-700"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-medium text-slate-900 dark:text-slate-100">{item.name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {[item.city, item.state, item.postalCode].filter(Boolean).join(", ") || "—"}
                        </div>
                      </div>
                      {item.nteeCode && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                          {item.nteeCode}
                        </span>
                      )}
                    </div>
                    {item.nteeClassification && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">{item.nteeClassification}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-200 px-5 pb-5 pt-4 dark:border-slate-800">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleImport}
              disabled={isImporting}
              className="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-600 disabled:opacity-60"
            >
              {isImporting && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />}
              Import
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};

export const AdminOrgsPanel = ({ onSwitchTab, initialViewMode = "orgs" }: AdminOrgsPanelProps) => {
  const { authReady } = useAuthSession();
  const { orgCategories } = useCategories();
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [moderationFilter, setModerationFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"recent" | "name" | "city">("recent");
  const [search, setSearch] = useState<string>("");
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>(initialViewMode);
  const [batchStatusFilter, setBatchStatusFilter] = useState<"all" | "success" | "running" | "error">("all");
  const [batchSearch, setBatchSearch] = useState<string>("");
  const [deletedBatchIds, setDeletedBatchIds] = useState<Set<string>>(new Set());
  const [hiddenBatchIds, setHiddenBatchIds] = useState<Set<string>>(new Set());
  const [activeImportBatchId, setActiveImportBatchId] = useState<string | null>(null);
  const [recentlyFinishedBatchId, setRecentlyFinishedBatchId] = useState<string | null>(null);
  const [isTabDropdownOpen, setIsTabDropdownOpen] = useState(false);
  const tabDropdownRef = useRef<HTMLDivElement>(null);
  const [isFiltersDropdownOpen, setIsFiltersDropdownOpen] = useState(false);
  const filtersDropdownRef = useRef<HTMLDivElement>(null);

  const queryEnabled = authReady;
  const allowedCategories = useMemo(() => new Set(orgCategories.map((c) => c.slug)), [orgCategories]);

  const { data, isLoading, error } = db.useQuery(
    queryEnabled
      ? {
          organizations: {
            $: {
              order: { name: "asc" as const },
              fields: [
                "id",
                "name",
                "category",
                "city",
                "state",
                "status",
                "moderationStatus",
                "lastSyncedAt",
                "source",
                "keywordFound",
                "importBatchId",
                "createdAt",
                "updatedAt",
                "postalCode",
                "address",
                "googleCategory",
                "ein",
              ],
            },
          },
          orgImports: {
            $: {
              limit: 20,
            },
          },
        }
      : null,
  );

  const organizations = useMemo(() => {
    if (!data?.organizations) return [];
    return data.organizations
      .map((row) => parseOrgRow(row, allowedCategories))
      .filter((o): o is OrgRow => !!o);
  }, [data?.organizations, allowedCategories]);

  const importBatches = useMemo(() => {
    if (!data?.orgImports) return [];
    return data.orgImports
      .map(parseBatch)
      .filter((b): b is OrgImportBatch => !!b)
      .sort(
        (a, b) =>
          (b.createdAt ?? 0) - (a.createdAt ?? 0) ||
          (b.updatedAt ?? 0) - (a.updatedAt ?? 0),
      );
  }, [data?.orgImports]);

  const runningBatch = useMemo(
    () => importBatches.find((b) => b.status === "running") ?? null,
    [importBatches],
  );

  const activeBatchFromList = useMemo(
    () => (activeImportBatchId ? importBatches.find((b) => b.id === activeImportBatchId) ?? null : null),
    [activeImportBatchId, importBatches],
  );

  useEffect(() => {
    if (!runningBatch) return;
    setActiveImportBatchId((prev) => prev ?? runningBatch.id);
  }, [runningBatch]);

  useEffect(() => {
    if (!activeImportBatchId) return;
    const match = activeBatchFromList;
    if (match && match.status === "success") {
      setRecentlyFinishedBatchId(match.id);
      setActiveImportBatchId(null);
    }
  }, [activeBatchFromList, activeImportBatchId]);

  useEffect(() => {
    if (!recentlyFinishedBatchId) return;
    const timer = setTimeout(() => setRecentlyFinishedBatchId(null), 6000);
    return () => clearTimeout(timer);
  }, [recentlyFinishedBatchId]);

  useEffect(() => {
    if (!activeImportBatchId) return;
    if (runningBatch || activeBatchFromList) return;
    const timer = setTimeout(() => setActiveImportBatchId(null), 20000);
    return () => clearTimeout(timer);
  }, [activeBatchFromList, activeImportBatchId, runningBatch]);

  // Close tab and filters dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tabDropdownRef.current && !tabDropdownRef.current.contains(event.target as Node)) {
        setIsTabDropdownOpen(false);
      }
      if (filtersDropdownRef.current && !filtersDropdownRef.current.contains(event.target as Node)) {
        setIsFiltersDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const bannerBatch = useMemo(() => {
    if (runningBatch) return runningBatch;
    if (recentlyFinishedBatchId) {
      return importBatches.find((b) => b.id === recentlyFinishedBatchId) ?? null;
    }
    if (activeImportBatchId) {
      return {
        id: activeImportBatchId,
        status: "starting",
        importedCount: 0,
        requestedCount: null,
        label: "Import starting…",
        source: null,
        filters: null,
        sampleOrgIds: null,
        orgIds: null,
        error: null,
        createdAt: Date.now(),
        createdBy: null,
        updatedAt: null,
      } as OrgImportBatch & { status: "starting" };
    }
    return null;
  }, [activeImportBatchId, importBatches, recentlyFinishedBatchId, runningBatch]);

  const bannerCounts = useMemo(() => {
    if (!bannerBatch) return null;
    const imported = bannerBatch.importedCount ?? 0;
    const requested =
      typeof bannerBatch.requestedCount === "number" ? bannerBatch.requestedCount : null;
    const percent =
      requested && requested > 0 ? Math.min(100, Math.round((imported / requested) * 100)) : null;
    return { imported, requested, percent };
  }, [bannerBatch]);

  const bannerStatus = useMemo(() => {
    if (!bannerBatch) return null;
    const imported = bannerBatch.importedCount ?? 0;
    const requested = typeof bannerBatch.requestedCount === "number" ? bannerBatch.requestedCount : null;
    const inFlight = requested ? Math.min(requested, imported + 1) : imported + 1;

    if (bannerBatch.status === "starting") {
      return {
        title: "Import queued…",
        detail: "Waiting for serverless function to start (fetching candidates)…",
      };
    }
    if (bannerBatch.status === "running") {
      const progressText = requested ? `Saved ${imported} / ${requested}` : `Saved ${imported}`;
      return {
        title: requested ? `Processing org ${inFlight} of ${requested}` : "Processing next organization",
        detail: `${progressText} · Fetching details -> geocoding -> saving to InstantDB`,
      };
    }
    return {
      title: "Import complete",
      detail: `Saved ${imported}${requested ? ` / ${requested}` : ""} orgs`,
    };
  }, [bannerBatch]);

  const syntheticBatches = useMemo<OrgImportBatch[]>(() => {
    if (importBatches.length > 0) return [];
    const map = new Map<string, OrgImportBatch>();
    for (const org of organizations) {
      if (!org.importBatchId) continue;
      const key = org.importBatchId;
      if (!map.has(key)) {
        map.set(key, {
          id: key,
          label: `Batch ${key.slice(0, 6)}`,
          source: "derived",
          filters: null,
          status: "success",
          requestedCount: null,
          importedCount: null,
          sampleOrgIds: null,
          orgIds: [],
          error: null,
          createdAt: org.createdAt ?? org.updatedAt ?? org.lastSyncedAt ?? Date.now(),
          createdBy: null,
          updatedAt: org.updatedAt ?? org.lastSyncedAt ?? org.createdAt ?? null,
        });
      }
      const batch = map.get(key)!;
      batch.orgIds = [...(batch.orgIds ?? []), org.id];
    }
    return Array.from(map.values()).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }, [importBatches, organizations]);

  const batchesForView = importBatches.length > 0 ? importBatches : syntheticBatches;

  const filteredBatches = useMemo(() => {
    const q = batchSearch.trim().toLowerCase();
    return batchesForView
      .filter((b) => !hiddenBatchIds.has(b.id))
      .filter((b) => (batchStatusFilter === "all" ? true : b.status === batchStatusFilter))
      .filter((b) => {
        if (!q) return true;
        const haystack = `${b.label} ${b.source ?? ""}`.toLowerCase();
        return haystack.includes(q);
      });
  }, [batchesForView, batchStatusFilter, batchSearch, hiddenBatchIds]);

  const filteredOrgs = useMemo(() => {
    const query = search.trim().toLowerCase();
    return organizations
      .filter((org) => (categoryFilter === "all" ? true : org.category === categoryFilter))
      .filter((org) => {
        if (statusFilter === "all") return true;
        return (org.status ?? "").toLowerCase() === statusFilter;
      })
      .filter((org) => {
        if (moderationFilter === "all") return true;
        return (org.moderationStatus ?? "").toLowerCase() === moderationFilter;
      })
      .filter((org) => {
        if (!query) return true;
        const haystack = `${org.name} ${org.city ?? ""} ${org.state ?? ""} ${org.keywordFound ?? ""} ${org.googleCategory ?? ""}`.toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => {
        if (sortBy === "name") return a.name.localeCompare(b.name);
        if (sortBy === "city") {
          return (a.city ?? "").localeCompare(b.city ?? "") || a.name.localeCompare(b.name);
        }
        const timeA = a.updatedAt ?? a.lastSyncedAt ?? a.createdAt ?? 0;
        const timeB = b.updatedAt ?? b.lastSyncedAt ?? b.createdAt ?? 0;
        return timeB - timeA;
      });
  }, [organizations, categoryFilter, statusFilter, moderationFilter, search, sortBy]);

  const handleDeleteBatch = useCallback(
    async (batchId: string) => {
      setDeletingBatchId(batchId);
      setDeleteError(null);
      try {
        const response = await fetch("/api/org-import-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.ok) {
          throw new Error(payload?.error || "Delete failed");
        }
        setDeletedBatchIds((prev) => {
          const next = new Set(prev);
          next.add(batchId);
          return next;
        });
        setTimeout(() => {
          setHiddenBatchIds((prev) => {
            const next = new Set(prev);
            next.add(batchId);
            return next;
          });
        }, 1500);
      } catch (err: any) {
        setDeleteError(err?.message ?? "Failed to delete batch");
      } finally {
        setDeletingBatchId(null);
      }
    },
    [],
  );

  const categoryOptions = useMemo(
    () =>
      orgCategories.map((c) => ({
        value: c.slug,
        label: c.label,
      })),
    [orgCategories],
  );

  // Count active filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (categoryFilter !== "all") count++;
    if (statusFilter !== "all") count++;
    if (moderationFilter !== "all") count++;
    return count;
  }, [categoryFilter, statusFilter, moderationFilter]);

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-slate-50 dark:bg-slate-900">
      <div className="shrink-0 border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          {/* Tab selector with chevron */}
          <div ref={tabDropdownRef} className="relative shrink-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100 sm:text-xl">
                {viewMode === "orgs" ? "Orgs" : "Batches"}
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
                    const currentTab = viewMode === "orgs" ? "orgs" : viewMode === "batches" ? "batches" : "stats";
                    const isActive = currentTab === tab.value;
                    return (
                      <li key={tab.value}>
                        <button
                          type="button"
                          onClick={() => {
                            if (tab.value === "stats") {
                              onSwitchTab("stats");
                            } else {
                              setViewMode(tab.value as ViewMode);
                            }
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
            {viewMode === "orgs" ? (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">
                {filteredOrgs.length} org{filteredOrgs.length === 1 ? "" : "s"} shown
                {search || categoryFilter !== "all" ? ` of ${organizations.length}` : ""}
              </p>
            ) : (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">
                {filteredBatches.length} batch{filteredBatches.length === 1 ? "" : "es"} shown
                {batchSearch || batchStatusFilter !== "all" ? ` of ${importBatches.length}` : ""}
              </p>
            )}
          </div>
          {viewMode === "orgs" ? (
            <>
              <div className="flex min-w-0 flex-1 items-center justify-center gap-2">
                {/* Multi-select Filters dropdown */}
                <div ref={filtersDropdownRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setIsFiltersDropdownOpen(!isFiltersDropdownOpen)}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 shadow-sm transition hover:bg-slate-50 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    <FunnelIcon className="h-3.5 w-3.5" />
                    <span>Filters</span>
                    {activeFilterCount > 0 && (
                      <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand-500 px-1 text-[10px] font-semibold text-white">
                        {activeFilterCount}
                      </span>
                    )}
                    <ChevronDownIcon
                      className={`h-3 w-3 transition-transform ${isFiltersDropdownOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  {/* Filters dropdown menu */}
                  {isFiltersDropdownOpen && (
                    <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-slate-300 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-950">
                      <div className="max-h-96 overflow-y-auto py-2">
                        {/* Categories Section */}
                        <div className="px-3 py-2">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Categories
                          </div>
                          <button
                            type="button"
                            onClick={() => setCategoryFilter("all")}
                            className={`w-full rounded px-2 py-1.5 text-left text-xs ${
                              categoryFilter === "all"
                                ? "bg-brand-50 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300"
                                : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                            }`}
                          >
                            All Catgrs.
                          </button>
                          {categoryOptions.map((cat) => (
                            <button
                              key={cat.value}
                              type="button"
                              onClick={() => setCategoryFilter(cat.value)}
                              className={`w-full rounded px-2 py-1.5 text-left text-xs ${
                                categoryFilter === cat.value
                                  ? "bg-brand-50 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300"
                                  : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                              }`}
                            >
                              {cat.label}
                            </button>
                          ))}
                        </div>

                        {/* Divider */}
                        <div className="mx-3 border-t border-slate-200 dark:border-slate-700" />

                        {/* Status Section */}
                        <div className="px-3 py-2">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Status
                          </div>
                          {[
                            { value: "all", label: "All statuses" },
                            { value: "active", label: "Active" },
                            { value: "moved", label: "Moved" },
                            { value: "closed", label: "Closed" },
                          ].map((status) => (
                            <button
                              key={status.value}
                              type="button"
                              onClick={() => setStatusFilter(status.value)}
                              className={`w-full rounded px-2 py-1.5 text-left text-xs ${
                                statusFilter === status.value
                                  ? "bg-brand-50 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300"
                                  : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                              }`}
                            >
                              {status.label}
                            </button>
                          ))}
                        </div>

                        {/* Divider */}
                        <div className="mx-3 border-t border-slate-200 dark:border-slate-700" />

                        {/* Moderation Section */}
                        <div className="px-3 py-2">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            Moderation
                          </div>
                          {[
                            { value: "all", label: "All moderation" },
                            { value: "approved", label: "Approved" },
                            { value: "pending", label: "Pending" },
                            { value: "declined", label: "Declined" },
                            { value: "removed", label: "Removed" },
                          ].map((mod) => (
                            <button
                              key={mod.value}
                              type="button"
                              onClick={() => setModerationFilter(mod.value)}
                              className={`w-full rounded px-2 py-1.5 text-left text-xs ${
                                moderationFilter === mod.value
                                  ? "bg-brand-50 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300"
                                  : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800"
                              }`}
                            >
                              {mod.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, city, keyword"
                    className="h-7 w-52 rounded-lg border border-slate-300 bg-white pl-7 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                  <svg
                    className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    fill="none"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                <CustomSelect
                  value={sortBy}
                  onChange={(val) => setSortBy(val as "recent" | "name" | "city")}
                  options={[
                    { value: "recent", label: "Recently updated" },
                    { value: "name", label: "Name" },
                    { value: "city", label: "City" },
                  ]}
                />
                <button
                  type="button"
                  onClick={() => setIsImportModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-2 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900 sm:px-3 sm:py-1.5"
                >
                  <span className="text-sm leading-none">+</span> Import Orgs
                </button>
              </div>
            </>
          ) : (
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
              <CustomSelect
                value={batchStatusFilter}
                onChange={(val) => setBatchStatusFilter(val as typeof batchStatusFilter)}
                options={[
                  { value: "all", label: "All statuses" },
                  { value: "running", label: "Running" },
                  { value: "success", label: "Success" },
                  { value: "error", label: "Error" },
                ]}
              />
              <div className="relative">
                <input
                  value={batchSearch}
                  onChange={(e) => setBatchSearch(e.target.value)}
                  placeholder="Search batches"
                  className="h-7 w-48 rounded-lg border border-slate-300 bg-white pl-7 pr-3 text-xs text-slate-800 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                />
                <svg
                  className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  fill="none"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <button
                type="button"
                onClick={() => setIsImportModalOpen(true)}
                className="inline-flex items-center gap-1 rounded-lg bg-brand-500 px-2 py-1 text-xs font-medium text-white shadow-sm transition hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900 sm:px-3 sm:py-1.5"
              >
                <span className="text-sm leading-none">+</span> Import Orgs
              </button>
            </div>
          )}
        </div>
      </div>

      {bannerBatch && (
        <div className="px-4 pt-3 sm:px-6">
          <div
            className={`flex items-center gap-3 rounded-xl border px-3 py-2 shadow-sm ${
              bannerBatch.status === "running" || bannerBatch.status === "starting"
                ? "border-brand-200 bg-brand-50 text-brand-800 dark:border-brand-900/50 dark:bg-brand-900/30 dark:text-brand-100"
                : "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-900/25 dark:text-emerald-50"
            }`}
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/80 shadow-sm dark:bg-black/30">
              {bannerBatch.status === "running" || bannerBatch.status === "starting" ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
              ) : (
                <svg className="h-5 w-5 text-emerald-600 dark:text-emerald-200" viewBox="0 0 24 24" stroke="currentColor" fill="none">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <div className="flex-1">
              <div className="text-sm font-semibold">
                {bannerStatus?.title ??
                  (bannerBatch.status === "starting"
                    ? "Import starting…"
                    : bannerBatch.status === "running"
                    ? "Importing orgs (geocoding + saving)…"
                    : "Import complete")}
              </div>
              <div className="text-xs">
                {bannerStatus?.detail ??
                  (bannerBatch.status === "starting"
                    ? "Waiting for serverless function…"
                    : (
                      <>
                        Saved {bannerCounts?.imported ?? 0}
                        {bannerCounts?.requested ? ` / ${bannerCounts.requested}` : ""} orgs
                      </>
                    ))}
              </div>
              {bannerBatch.status === "running" && bannerCounts?.percent !== null && (
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/70 dark:bg-white/10">
                  <div
                    className="h-full rounded-full bg-brand-500"
                    style={{ width: `${bannerCounts.percent}%` }}
                  />
                </div>
              )}
            </div>
            {bannerBatch.status === "running" && bannerCounts?.percent !== null && (
              <div className="text-xs font-semibold text-brand-700 dark:text-brand-100">
                {bannerCounts.percent}%
              </div>
            )}
            {bannerBatch.status === "success" && bannerBatch.label && (
              <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-200 dark:ring-emerald-800/60">
                {bannerBatch.label}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 sm:px-6 sm:py-4">
        {viewMode === "orgs" ? (
          isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              Loading orgs…
            </div>
          ) : error ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/50 dark:bg-rose-900/20 dark:text-rose-200">
              Failed to load organizations.
            </div>
          ) : filteredOrgs.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              No organizations match your filters.
            </div>
          ) : (
            <div className="mx-auto flex max-w-4xl flex-col gap-3">
              {filteredOrgs.map((org) => (
                <div
                  key={org.id}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:border-brand-200 hover:shadow-md dark:border-slate-700 dark:bg-slate-800"
                >
                  <div className="flex flex-wrap items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{org.name}</h3>
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                          {org.category}
                        </span>
                        {org.ein && (
                          <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                            EIN {org.ein}
                          </code>
                        )}
                      </div>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {[org.address, org.city, org.state, org.postalCode].filter(Boolean).join(", ") || "Address missing"}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                        {statusBadge(org.status ?? null)}
                        {moderationBadge(org.moderationStatus ?? null)}
                        {org.source && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-200">
                            {org.source}
                          </span>
                        )}
                        {org.keywordFound && <span className="text-slate-500 dark:text-slate-300">Keyword: {org.keywordFound}</span>}
                        {org.googleCategory && <span className="text-slate-500 dark:text-slate-300">NTEE: {org.googleCategory}</span>}
                        <span className="ml-auto text-slate-400 dark:text-slate-500">
                          Updated {formatDateTime(org.updatedAt ?? org.lastSyncedAt ?? org.createdAt)}
                        </span>
                      </div>
                    </div>
                    {org.importBatchId && (
                      <span className="rounded-lg bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 ring-1 ring-brand-100 dark:bg-brand-900/30 dark:text-brand-200 dark:ring-brand-800/50">
                        Batch {org.importBatchId.slice(0, 6)}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )
        ) : isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            Loading batches…
          </div>
        ) : filteredBatches.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
            No imports yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {filteredBatches.map((batch) => (
              <div
                key={batch.id}
                className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
              >
                {deleteError && deletingBatchId === batch.id && (
                  <div className="mb-2 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-200">
                    {deleteError}
                  </div>
                )}
                {(() => {
                  const isDeleted = deletedBatchIds.has(batch.id);
                  const isDeleting = deletingBatchId === batch.id;
                  return (
                    <>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{batch.label}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {batch.status === "running" && "Running…"}
                            {batch.status === "success" &&
                              `${batch.importedCount ?? 0} / ${batch.requestedCount ?? batch.orgIds?.length ?? 0} imported`}
                            {batch.status === "error" && `Error: ${batch.error ?? "Unknown"}`}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                            batch.status === "success"
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200"
                              : batch.status === "error"
                              ? "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200"
                              : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200"
                          }`}
                        >
                          {batch.status}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
                        <span>Created {formatDateTime(batch.createdAt)}</span>
                        {batch.filters?.state && <span>State: {batch.filters.state as string}</span>}
                        {batch.filters?.city && <span>City: {batch.filters.city as string}</span>}
                        {batch.filters?.includeKeywords && (
                          <span>Includes: {(batch.filters.includeKeywords as string) || ""}</span>
                        )}
                      </div>
                      {batch.sampleOrgIds && batch.sampleOrgIds.length > 0 && (
                        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                          Sample org IDs: {batch.sampleOrgIds.slice(0, 3).join(", ")}
                        </p>
                      )}
                      <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="text-slate-500 dark:text-slate-400">
                          Batch ID {batch.id.slice(0, 8)}
                        </span>
                        {isDeleted ? (
                          <span className="rounded-lg border border-slate-200 px-3 py-1 font-semibold text-slate-500 dark:border-slate-700 dark:text-slate-300">
                            Deleted
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleDeleteBatch(batch.id)}
                            disabled={isDeleting}
                            className="rounded-lg border border-rose-200 px-3 py-1 font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-60 dark:border-rose-900/60 dark:text-rose-200 dark:hover:bg-rose-900/20"
                          >
                            {isDeleting ? "Deleting…" : "Delete orgs"}
                          </button>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            ))}
          </div>
        )}
      </div>

      <OrgImportModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        categoryOptions={categoryOptions}
        defaultCategory={categoryOptions[0]?.value ?? "health"}
        activeBatch={runningBatch}
        onImportStarted={(batchId) => setActiveImportBatchId(batchId)}
        onImported={() => {
          setSearch("");
          setCategoryFilter("all");
        }}
      />
    </div>
  );
};
