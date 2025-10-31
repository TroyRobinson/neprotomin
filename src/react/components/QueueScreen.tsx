import { useMemo, useState, useCallback } from "react";
import { db } from "../../lib/reactDb";
import { isAdminEmail } from "../../lib/admin";
import type {
  Organization,
  OrganizationModerationStatus,
  OrganizationStatus,
} from "../../types/organization";

const ALLOWED_CATEGORIES = new Set<Organization["category"]>([
  "health",
  "education",
  "justice",
  "economy",
  "food",
]);

const ALLOWED_STATUSES: OrganizationStatus[] = ["active", "moved", "closed"];

type ModerationBuckets = {
  pending: Organization[];
  approved: Organization[];
};

const parseOrganization = (row: any): Organization | null => {
  if (
    !row ||
    typeof row?.id !== "string" ||
    typeof row?.name !== "string" ||
    typeof row?.latitude !== "number" ||
    typeof row?.longitude !== "number" ||
    typeof row?.category !== "string"
  ) {
    return null;
  }

  const category =
    ALLOWED_CATEGORIES.has(row.category as Organization["category"])
      ? (row.category as Organization["category"])
      : "health";

  const rawStatus =
    typeof row?.status === "string" ? (row.status as string).toLowerCase() : null;
  const parsedStatus =
    rawStatus && ALLOWED_STATUSES.includes(rawStatus as OrganizationStatus)
      ? (rawStatus as OrganizationStatus)
      : null;

  const rawModeration =
    typeof row?.moderationStatus === "string"
      ? (row.moderationStatus as string).toLowerCase()
      : null;
  const moderationStatus: OrganizationModerationStatus | null =
    rawModeration && ["pending", "approved", "declined"].includes(rawModeration)
      ? (rawModeration as OrganizationModerationStatus)
      : null;

  return {
    id: row.id,
    name: row.name,
    ownerEmail: typeof row?.ownerEmail === "string" ? row.ownerEmail : null,
    latitude: row.latitude,
    longitude: row.longitude,
    category,
    website: typeof row?.website === "string" ? row.website : null,
    address: typeof row?.address === "string" ? row.address : null,
    city: typeof row?.city === "string" ? row.city : null,
    state: typeof row?.state === "string" ? row.state : null,
    postalCode: typeof row?.postalCode === "string" ? row.postalCode : null,
    phone: typeof row?.phone === "string" ? row.phone : null,
    hours: row?.hours ?? null,
    placeId: typeof row?.placeId === "string" ? row.placeId : null,
    source: typeof row?.source === "string" ? row.source : null,
    googleCategory: typeof row?.googleCategory === "string" ? row.googleCategory : null,
    keywordFound: typeof row?.keywordFound === "string" ? row.keywordFound : null,
    status: parsedStatus,
    lastSyncedAt: typeof row?.lastSyncedAt === "number" ? row.lastSyncedAt : null,
    raw: typeof row?.raw === "object" && row.raw !== null ? row.raw : null,
    moderationStatus,
    moderationChangedAt:
      typeof row?.moderationChangedAt === "number" ? row.moderationChangedAt : null,
    submittedAt: typeof row?.submittedAt === "number" ? row.submittedAt : null,
    queueSortKey: typeof row?.queueSortKey === "number" ? row.queueSortKey : null,
  };
};

const getQueueSortKey = (org: Organization): number => {
  if (typeof org.queueSortKey === "number") return org.queueSortKey;
  if (typeof org.submittedAt === "number") return org.submittedAt;
  return 0;
};

const getApprovedSortKey = (org: Organization): number => {
  if (typeof org.moderationChangedAt === "number") return org.moderationChangedAt;
  if (typeof org.submittedAt === "number") return org.submittedAt;
  return 0;
};

const formatDateTime = (value: number | null | undefined): string | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  try {
    return new Date(value).toLocaleString();
  } catch {
    return null;
  }
};

const buildLocationLine = (org: Organization): string | null => {
  const segments = [org.address, org.city, org.state, org.postalCode].filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  if (segments.length === 0) return null;
  return segments.join(", ");
};

/**
 * Builds a Google Maps URL from organization address components.
 * Opens in default maps app on mobile devices, or Google Maps web on desktop.
 */
const buildMapsUrl = (org: Organization): string | null => {
  const segments = [
    org.address,
    org.city,
    org.state,
    org.postalCode,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  
  if (segments.length === 0) return null;
  
  const query = encodeURIComponent(segments.join(", "));
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
};

export const QueueScreen = () => {
  const { isLoading: isAuthLoading, user } = db.useAuth();
  const [expandedApproved, setExpandedApproved] = useState(false);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isAdmin =
    !!user && !user.isGuest && !!user.email && isAdminEmail(user.email ?? null);
  const queryEnabled = !isAuthLoading && isAdmin;

  const { data, isLoading, error } = db.useQuery(
    queryEnabled
      ? {
          organizations: {
            $: {
              where: { moderationStatus: { $in: ["pending", "approved"] } },
            },
          },
        }
      : null,
  );

  const buckets = useMemo<ModerationBuckets>(() => {
    if (!queryEnabled) {
      return { pending: [], approved: [] };
    }
    const rows = data?.organizations ?? [];
    const pending: Organization[] = [];
    const approved: Organization[] = [];
    for (const row of rows) {
      const parsed = parseOrganization(row);
      if (!parsed || !parsed.moderationStatus) continue;
      if (parsed.moderationStatus === "pending") {
        pending.push(parsed);
      } else if (parsed.moderationStatus === "approved") {
        approved.push(parsed);
      }
    }
    pending.sort((a, b) => {
      const keyA = getQueueSortKey(a);
      const keyB = getQueueSortKey(b);
      if (keyA !== keyB) return keyB - keyA;
      return a.name.localeCompare(b.name);
    });
    approved.sort((a, b) => {
      const keyA = getApprovedSortKey(a);
      const keyB = getApprovedSortKey(b);
      if (keyA !== keyB) return keyB - keyA;
      return a.name.localeCompare(b.name);
    });
    return { pending, approved };
  }, [data?.organizations, queryEnabled]);

  const toggleApproved = useCallback(() => {
    setExpandedApproved((prev) => !prev);
  }, []);

  const handleAccept = useCallback(
    async (org: Organization) => {
      setProcessingId(org.id);
      setActionError(null);
      try {
        const now = Date.now();
        const payload: Record<string, unknown> = {
          moderationStatus: "approved",
          moderationChangedAt: now,
          queueSortKey: now,
        };
        if (org.hours && typeof org.hours === "object") {
          payload.hours = { ...org.hours, isUnverified: false };
        }
        await db.transact(
          db.tx.organizations[org.id].update(payload),
        );
      } catch (error) {
        console.error("Failed to approve organization", error);
        setActionError(
          error instanceof Error
            ? `Failed to approve ${org.name}: ${error.message}`
            : `Failed to approve ${org.name}.`,
        );
      } finally {
        setProcessingId(null);
      }
    },
    [],
  );

  const handleDecline = useCallback(
    async (org: Organization) => {
      setProcessingId(org.id);
      setActionError(null);
      try {
        await db.transact(db.tx.organizations[org.id].delete());
      } catch (error) {
        console.error("Failed to decline organization", error);
        setActionError(
          error instanceof Error
            ? `Failed to decline ${org.name}: ${error.message}`
            : `Failed to decline ${org.name}.`,
        );
      } finally {
        setProcessingId(null);
      }
    },
    [],
  );

  const handlePostpone = useCallback(
    async (org: Organization) => {
      setProcessingId(org.id);
      setActionError(null);
      try {
        const currentKey = getQueueSortKey(org);
        const nextKey = Math.min(currentKey - 1, 0);
        await db.transact(
          db.tx.organizations[org.id].update({
            queueSortKey: nextKey,
          }),
        );
      } catch (error) {
        console.error("Failed to postpone organization", error);
        setActionError(
          error instanceof Error
            ? `Failed to postpone ${org.name}: ${error.message}`
            : `Failed to postpone ${org.name}.`,
        );
      } finally {
        setProcessingId(null);
      }
    },
    [],
  );

  if (isAuthLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-slate-50 text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        Loading queue…
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-slate-50 px-6 text-center text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
        <div className="max-w-md space-y-3">
          <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Admin access required</h2>
          <p>
            You need an administrator account to review organization submissions. Please sign in
            with an approved email address.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-auto bg-slate-50 pb-safe dark:bg-slate-950">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 pb-16 pt-10 sm:px-8 lg:px-12">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-500">Review</p>
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Organization queue</h1>
          <p className="max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            Approve community submissions so they appear on the map, or decline entries that do not
            belong. Postponing a card moves it to the end of the pending list.
          </p>
        </header>

        {error ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
            Failed to load moderation queue. {error.message}
          </div>
        ) : null}
        {actionError ? (
          <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-500/10 dark:text-amber-200">
            {actionError}
          </div>
        ) : null}

        <section className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Pending approvals
            </h2>
            <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {buckets.pending.length} {buckets.pending.length === 1 ? "submission" : "submissions"}
            </span>
          </div>

          {isLoading ? (
            <div className="grid gap-4 md:grid-cols-2">
              {[0, 1, 2].map((idx) => (
                <div
                  key={idx}
                  className="h-40 animate-pulse rounded-3xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
                />
              ))}
            </div>
          ) : buckets.pending.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
              <p>Nothing waiting right now. New submissions will appear here automatically.</p>
            </div>
          ) : (
            <div className="grid gap-5 md:grid-cols-2">
              {buckets.pending.map((org) => {
                const submitted = formatDateTime(org.submittedAt);
                const location = buildLocationLine(org);
                return (
                  <article
                    key={org.id}
                    className="flex h-full flex-col justify-between rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-brand-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500/40"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                            {org.name}
                          </h3>
                          <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            {org.category}
                          </p>
                        </div>
                        {submitted ? (
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            Submitted {submitted}
                          </span>
                        ) : null}
                      </div>
                      {location ? (
                        <p className="text-sm text-slate-600 dark:text-slate-300">
                          {(() => {
                            const mapsUrl = buildMapsUrl(org);
                            if (mapsUrl) {
                              return (
                                <a
                                  href={mapsUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="hover:underline"
                                >
                                  {location}
                                </a>
                              );
                            }
                            return location;
                          })()}
                        </p>
                      ) : null}
                      {org.ownerEmail ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          Contact:{" "}
                          <a
                            href={`mailto:${org.ownerEmail}`}
                            className="font-medium text-brand-600 hover:underline dark:text-brand-300"
                          >
                            {org.ownerEmail}
                          </a>
                        </p>
                      ) : null}
                      {org.source ? (
                        <p className="text-xs text-slate-400 dark:text-slate-500">
                          Source: {org.source}
                        </p>
                      ) : null}
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleAccept(org)}
                        disabled={processingId === org.id}
                        className="inline-flex flex-1 items-center justify-center rounded-full bg-emerald-500 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDecline(org)}
                        disabled={processingId === org.id}
                        className="inline-flex flex-1 items-center justify-center rounded-full border border-rose-300 px-4 py-2 text-sm font-medium text-rose-600 transition hover:border-rose-400 hover:text-rose-700 dark:border-rose-400/60 dark:text-rose-300 dark:hover:border-rose-300 dark:hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePostpone(org)}
                        disabled={processingId === org.id}
                        className="inline-flex flex-1 items-center justify-center rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500 dark:hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Postpone
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <button
            type="button"
            onClick={toggleApproved}
            className="flex w-full items-center justify-between rounded-3xl border border-slate-200 bg-white px-6 py-4 text-left transition hover:border-brand-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500/40"
          >
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Approved</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {expandedApproved
                  ? "Hide recently approved submissions."
                  : "Review recently approved organizations and decline if necessary."}
              </p>
            </div>
            <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              {buckets.approved.length}
            </span>
          </button>
          {expandedApproved && (
            <div className="grid gap-4 md:grid-cols-2">
              {buckets.approved.length === 0 ? (
                <div className="col-span-full flex flex-col items-center justify-center rounded-3xl border border-slate-200 bg-white px-6 py-12 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
                  No approved submissions yet.
                </div>
              ) : (
                buckets.approved.map((org) => {
                  const approvedAt = formatDateTime(org.moderationChangedAt);
                  const location = buildLocationLine(org);
                  return (
                    <article
                      key={org.id}
                      className="flex h-full flex-col justify-between rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-brand-200 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-brand-500/40"
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                              {org.name}
                            </h3>
                            <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                              {org.category}
                            </p>
                          </div>
                          {approvedAt ? (
                            <span className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-medium text-emerald-700 dark:bg-emerald-400/20 dark:text-emerald-200">
                              Approved {approvedAt}
                            </span>
                          ) : null}
                        </div>
                        {location ? (
                          <p className="text-sm text-slate-600 dark:text-slate-300">
                            {(() => {
                              const mapsUrl = buildMapsUrl(org);
                              if (mapsUrl) {
                                return (
                                  <a
                                    href={mapsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:underline"
                                  >
                                    {location}
                                  </a>
                                );
                              }
                              return location;
                            })()}
                          </p>
                        ) : null}
                        {org.ownerEmail ? (
                          <p className="text-sm text-slate-500 dark:text-slate-400">
                            Contact:{" "}
                            <a
                              href={`mailto:${org.ownerEmail}`}
                              className="font-medium text-brand-600 hover:underline dark:text-brand-300"
                            >
                              {org.ownerEmail}
                            </a>
                          </p>
                        ) : null}
                      </div>
                      <div className="mt-5 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => handleDecline(org)}
                          disabled={processingId === org.id}
                          className="inline-flex w-full items-center justify-center rounded-full border border-rose-300 px-4 py-2 text-sm font-medium text-rose-600 transition hover:border-rose-400 hover:text-rose-700 dark:border-rose-400/60 dark:text-rose-300 dark:hover:border-rose-300 dark:hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          Decline
                        </button>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
