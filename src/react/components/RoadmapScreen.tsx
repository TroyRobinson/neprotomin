import { useMemo, useState } from "react";
import { useRoadmapItems } from "../hooks/useRoadmapItems";
import type { RoadmapItemWithRelations, RoadmapStatus } from "../../types/roadmap";
import { addRoadmapVote, removeRoadmapVote, addRoadmapComment } from "../lib/roadmapActions";
import { db } from "../../lib/reactDb";

const STATUS_META: Record<
  RoadmapStatus,
  { label: string; badgeClass: string; dotClass: string; description: string }
> = {
  suggested: {
    label: "Suggested",
    badgeClass: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    dotClass: "bg-slate-400 dark:bg-slate-500",
    description: "Ideas surfaced by residents, partners, and the team.",
  },
  considering: {
    label: "Evaluating",
    badgeClass: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200",
    dotClass: "bg-indigo-500 dark:bg-indigo-300",
    description: "We’re sizing effort, exploring dependencies, and collecting feedback.",
  },
  inProcess: {
    label: "In Progress",
    badgeClass: "bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-200",
    dotClass: "bg-green-500 dark:bg-green-300",
    description: "Actively being designed, prototyped, or built.",
  },
  postponed: {
    label: "Postponed",
    badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200",
    dotClass: "bg-amber-500 dark:bg-amber-300",
    description: "Paused for now—waiting on partners, funding, or deeper learnings.",
  },
};

const formatShortDate = (value?: number | null): string | null => {
  if (!value || !Number.isFinite(value)) return null;
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return formatter.format(new Date(value));
};

const buildTimelineLabel = (item: RoadmapItemWithRelations): string => {
  const added = formatShortDate(item.createdAt);
  const changed = formatShortDate(item.statusChangedAt);
  const target = formatShortDate(item.targetCompletionAt);
  const parts: string[] = [];
  if (added) parts.push(`Added ${added}`);
  if (changed) parts.push(`Updated ${changed}`);
  if (target) parts.push(`Targeting ${target}`);
  return parts.join(" • ");
};

export const RoadmapScreen = () => {
  const { items, isLoading, error, viewerId } = useRoadmapItems();
  const { user } = db.useAuth();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [voteBusy, setVoteBusy] = useState<Record<string, boolean>>({});
  const [commentBusy, setCommentBusy] = useState<Record<string, boolean>>({});
  const [commentError, setCommentError] = useState<Record<string, string | null>>({});

  const sortedItems = useMemo(() => items.slice().sort((a, b) => b.createdAt - a.createdAt), [items]);

  const handleToggleExpand = (itemId: string) => {
    setExpandedId((prev) => (prev === itemId ? null : itemId));
    setCommentError((prev) => ({ ...prev, [itemId]: null }));
  };

  const handleToggleVote = async (item: RoadmapItemWithRelations) => {
    if (!viewerId) {
      alert("Please sign in or continue as guest to vote.");
      return;
    }
    if (voteBusy[item.id]) return;

    setVoteBusy((prev) => ({ ...prev, [item.id]: true }));
    try {
      if (item.viewerHasVoted && item.viewerVoteId) {
        await removeRoadmapVote(item.viewerVoteId);
      } else {
        await addRoadmapVote(item.id, viewerId);
      }
    } catch (err) {
      console.error("[roadmap] Failed to toggle vote", err);
      alert("Sorry, we couldn't update your vote. Please try again in a moment.");
    } finally {
      setVoteBusy((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const handleSubmitComment = async (item: RoadmapItemWithRelations) => {
    if (!viewerId) {
      alert("Please sign in or continue as guest to comment.");
      return;
    }
    const body = drafts[item.id]?.trim() ?? "";
    if (body.length === 0) {
      setCommentError((prev) => ({ ...prev, [item.id]: "Add a quick note before sending." }));
      return;
    }
    if (commentBusy[item.id]) return;

    setCommentBusy((prev) => ({ ...prev, [item.id]: true }));
    setCommentError((prev) => ({ ...prev, [item.id]: null }));
    try {
      const authorName =
        user?.isGuest
          ? null
          : typeof user?.email === "string"
            ? user.email
            : null;
      await addRoadmapComment(item.id, viewerId, body, authorName);
      setDrafts((prev) => ({ ...prev, [item.id]: "" }));
    } catch (err) {
      console.error("[roadmap] Failed to add comment", err);
      setCommentError((prev) => ({
        ...prev,
        [item.id]: "We couldn't save your comment. Please try again.",
      }));
    } finally {
      setCommentBusy((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-white px-6 pb-safe text-sm text-slate-500 dark:bg-slate-900 dark:text-slate-400">
        Loading roadmap…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-white px-6 pb-safe text-center text-sm text-red-500 dark:bg-slate-900">
        Failed to load roadmap: {error.message}
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col overflow-auto bg-slate-50 pb-safe dark:bg-slate-950">
      <div className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Product Roadmap</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
            Track what we’re exploring, actively building, and learning from. Click a card to see
            community feedback and share your own.
          </p>
        </header>

        {sortedItems.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            No roadmap items yet. Check back soon!
          </div>
        ) : (
          <ol className="space-y-4">
            {sortedItems.map((item) => {
              const statusMeta = STATUS_META[item.status] ?? STATUS_META.suggested;
              const timeline = buildTimelineLabel(item);
              const isExpanded = expandedId === item.id;
              const voteLabel = `${item.voteCount} vote${item.voteCount === 1 ? "" : "s"}`;

              return (
                <li key={item.id}>
                  <article className="rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700">
                    <button
                      type="button"
                      onClick={() => handleToggleExpand(item.id)}
                      className="w-full rounded-2xl p-6 text-left"
                      aria-expanded={isExpanded}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex flex-1 flex-col gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold ${statusMeta.badgeClass}`}
                            >
                              <span className={`h-2 w-2 rounded-full ${statusMeta.dotClass}`} />
                              {statusMeta.label}
                            </span>
                            <span className="text-xs text-slate-400 dark:text-slate-500">
                              {statusMeta.description}
                            </span>
                          </div>
                          <h2 className="text-lg font-semibold text-slate-900 dark:text-white sm:text-xl">
                            {item.title}
                          </h2>
                          {item.description ? (
                            <p className="text-sm text-slate-600 dark:text-slate-300">
                              {item.description}
                            </p>
                          ) : null}
                          {timeline && (
                            <p className="text-xs text-slate-400 dark:text-slate-500">{timeline}</p>
                          )}
                        </div>
                        <div className="flex items-end justify-between gap-3 sm:flex-col sm:items-end">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleToggleVote(item);
                            }}
                            disabled={voteBusy[item.id]}
                            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-brand-300 ${
                              item.viewerHasVoted
                                ? "border-brand-500 bg-brand-500 text-white hover:bg-brand-600"
                                : "border-slate-300 text-slate-600 hover:border-brand-300 hover:text-brand-600 dark:border-slate-700 dark:text-slate-300 dark:hover:border-brand-400"
                            } ${voteBusy[item.id] ? "opacity-60" : ""}`}
                            aria-pressed={item.viewerHasVoted}
                          >
                            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-current" />
                            {voteLabel}
                          </button>
                          <span className="text-[11px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            {isExpanded ? "Hide details" : "View details"}
                          </span>
                        </div>
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="space-y-6 border-t border-slate-200 px-6 pb-6 pt-5 dark:border-slate-800">
                        {item.imageUrl ? (
                          <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                            <img
                              src={item.imageUrl}
                              alt={item.title}
                              className="h-48 w-full object-cover"
                            />
                          </div>
                        ) : null}

                        <section aria-label="Community feedback" className="space-y-4">
                          <header className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                              Comments
                            </h3>
                            <span className="text-xs text-slate-400 dark:text-slate-500">
                              {item.comments.length} shared insight
                              {item.comments.length === 1 ? "" : "s"}
                            </span>
                          </header>

                          {item.comments.length === 0 ? (
                            <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                              Be the first to share why this matters to you or your neighbors.
                            </p>
                          ) : (
                            <ul className="space-y-3">
                              {item.comments.map((comment) => (
                                <li
                                  key={comment.id}
                                  className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                                >
                                  <div className="flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
                                    <span>{comment.authorName ?? "Community member"}</span>
                                    <time dateTime={new Date(comment.createdAt).toISOString()}>
                                      {formatShortDate(comment.createdAt) ?? "Just now"}
                                    </time>
                                  </div>
                                  <p className="mt-2 whitespace-pre-line">{comment.body}</p>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>

                        <section aria-label="Add comment" className="space-y-2">
                          <label className="block text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            Share feedback
                          </label>
                          <textarea
                            rows={3}
                            value={drafts[item.id] ?? ""}
                            onChange={(event) =>
                              setDrafts((prev) => ({
                                ...prev,
                                [item.id]: event.target.value,
                              }))
                            }
                            placeholder="How would this help Tulsa neighbors?"
                            className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-brand-400 dark:focus:ring-brand-500/40"
                          />
                          {commentError[item.id] ? (
                            <p className="text-xs text-rose-500">{commentError[item.id]}</p>
                          ) : null}
                          <div className="flex items-center justify-end gap-3">
                            <button
                              type="button"
                              onClick={() =>
                                setDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: "",
                                }))
                              }
                              className="text-xs font-semibold text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
                              disabled={commentBusy[item.id]}
                            >
                              Clear
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSubmitComment(item)}
                              disabled={commentBusy[item.id]}
                              className="inline-flex items-center justify-center rounded-full bg-brand-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
                            >
                              {commentBusy[item.id] ? "Sending…" : "Share comment"}
                            </button>
                          </div>
                        </section>
                      </div>
                    )}
                  </article>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
};

export default RoadmapScreen;
