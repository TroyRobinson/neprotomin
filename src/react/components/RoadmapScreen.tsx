import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useRoadmapItems } from "../hooks/useRoadmapItems";
import type { RoadmapItemWithRelations, RoadmapStatus, RoadmapComment } from "../../types/roadmap";
import {
  addRoadmapVote,
  removeRoadmapVote,
  addRoadmapComment,
  removeRoadmapComment,
  createRoadmapItem,
  updateRoadmapItem,
  deleteRoadmapItem,
  updateRoadmapItemsOrder,
} from "../lib/roadmapActions";
import { db } from "../../lib/reactDb";
import { isAdminEmail } from "../../lib/admin";

const STATUS_META: Record<
  RoadmapStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  suggested: {
    label: "Suggested",
    badgeClass: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
    dotClass: "bg-slate-400 dark:bg-slate-500",
  },
  considering: {
    label: "Evaluating",
    badgeClass: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200",
    dotClass: "bg-indigo-500 dark:bg-indigo-300",
  },
  inProcess: {
    label: "In Progress",
    badgeClass: "bg-green-100 text-green-700 dark:bg-green-900/60 dark:text-green-200",
    dotClass: "bg-green-500 dark:bg-green-300",
  },
  postponed: {
    label: "Postponed",
    badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200",
    dotClass: "bg-amber-500 dark:bg-amber-300",
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
  const hasBeenUpdated = changed && item.statusChangedAt && item.statusChangedAt !== item.createdAt;
  
  if (hasBeenUpdated) {
    return `Updated ${changed}`;
  }
  
  if (added) {
    return `Added ${added}`;
  }
  
  return "";
};

type EditableField = "title" | "description";
const buildEditKey = (itemId: string, field: EditableField) => `${itemId}:${field}`;

type SortOption = "custom" | "updated" | "created" | "votes" | "comments" | "oldest";

const SORT_OPTIONS: Array<{ value: SortOption; label: string }> = [
  { value: "custom", label: "Priority  order" },
  { value: "updated", label: "Most recently updated" },
  { value: "created", label: "Most recently created" },
  { value: "votes", label: "Most votes" },
  { value: "comments", label: "Most comments" },
  { value: "oldest", label: "Oldest first" },
];

const sortItems = (items: RoadmapItemWithRelations[], sortBy: SortOption): RoadmapItemWithRelations[] => {
  const sorted = items.slice();
  
  switch (sortBy) {
    case "custom": {
      sorted.sort((a, b) => {
        const aOrder = a.order ?? Infinity;
        const bOrder = b.order ?? Infinity;
        if (aOrder !== bOrder) {
          return aOrder - bOrder;
        }
        return b.createdAt - a.createdAt;
      });
      break;
    }
    case "updated": {
      sorted.sort((a, b) => {
        const aTime = a.statusChangedAt ?? a.createdAt;
        const bTime = b.statusChangedAt ?? b.createdAt;
        return bTime - aTime;
      });
      break;
    }
    case "created": {
      sorted.sort((a, b) => b.createdAt - a.createdAt);
      break;
    }
    case "votes": {
      sorted.sort((a, b) => {
        if (b.voteCount !== a.voteCount) {
          return b.voteCount - a.voteCount;
        }
        return b.createdAt - a.createdAt;
      });
      break;
    }
    case "comments": {
      sorted.sort((a, b) => {
        if (b.comments.length !== a.comments.length) {
          return b.comments.length - a.comments.length;
        }
        return b.createdAt - a.createdAt;
      });
      break;
    }
    case "oldest": {
      sorted.sort((a, b) => a.createdAt - b.createdAt);
      break;
    }
  }
  
  return sorted;
};

export const RoadmapScreen = () => {
  const { items, isLoading, error, viewerId } = useRoadmapItems();
  const { user } = db.useAuth();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [voteBusy, setVoteBusy] = useState<Record<string, boolean>>({});
  const [commentBusy, setCommentBusy] = useState<Record<string, boolean>>({});
  const [commentError, setCommentError] = useState<Record<string, string | null>>({});
  const [deleteBusy, setDeleteBusy] = useState<Record<string, boolean>>({});
  const [deleteError, setDeleteError] = useState<Record<string, string | null>>({});
  const [createBusy, setCreateBusy] = useState(false);
  const [activeEdit, setActiveEdit] = useState<{ itemId: string; field: EditableField; value: string } | null>(null);
  const [editBusy, setEditBusy] = useState<Record<string, boolean>>({});
  const [editError, setEditError] = useState<Record<string, string | null>>({});
  const toggleTimerRef = useRef<number | null>(null);
  const [itemDeleteBusy, setItemDeleteBusy] = useState<Record<string, boolean>>({});
  const [itemDeleteError, setItemDeleteError] = useState<Record<string, string | null>>({});
  const [sortBy, setSortBy] = useState<SortOption>("custom");
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);

  const sortedItems = useMemo(() => sortItems(items, sortBy), [items, sortBy]);
  const isAdmin = useMemo(() => {
    if (!user || user.isGuest) return false;
    return isAdminEmail(user.email ?? null);
  }, [user]);

  useEffect(() => {
    return () => {
      if (toggleTimerRef.current !== null) {
        window.clearTimeout(toggleTimerRef.current);
        toggleTimerRef.current = null;
      }
    };
  }, []);

  const clearPendingToggle = () => {
    if (toggleTimerRef.current !== null) {
      window.clearTimeout(toggleTimerRef.current);
      toggleTimerRef.current = null;
    }
  };

  const handleToggleExpand = (itemId: string) => {
    clearPendingToggle();
    setExpandedId((prev) => (prev === itemId ? null : itemId));
    setCommentError((prev) => ({ ...prev, [itemId]: null }));
    setActiveEdit((prev) => (prev?.itemId === itemId ? null : prev));
  };

  const scheduleToggle = (itemId: string) => {
    clearPendingToggle();
    toggleTimerRef.current = window.setTimeout(() => {
      toggleTimerRef.current = null;
      setExpandedId((prev) => (prev === itemId ? null : itemId));
      setCommentError((prev) => ({ ...prev, [itemId]: null }));
      setActiveEdit((prev) => (prev?.itemId === itemId ? null : prev));
    }, 160);
  };

  const handleCardClick = (event: MouseEvent<HTMLDivElement>, item: RoadmapItemWithRelations) => {
    if (isReordering) return;
    if ((event.target as HTMLElement).closest("[data-roadmap-edit-control='true']")) return;
    if ((event.target as HTMLElement).closest("[data-roadmap-editable='true']")) return;
    if (activeEdit && activeEdit.itemId === item.id) return;
    if (event.detail > 1) {
      clearPendingToggle();
      return;
    }
    scheduleToggle(item.id);
  };

  const handleCreateItem = async () => {
    if (!viewerId) {
      alert("Please sign in or continue as guest to create roadmap items.");
      return;
    }
    if (createBusy) return;
    setCreateBusy(true);
    try {
      const newId = await createRoadmapItem({
        title: "New roadmap item",
        createdBy: viewerId,
      });
      clearPendingToggle();
      setActiveEdit({ itemId: newId, field: "title", value: "New roadmap item" });
    } catch (err) {
      console.error("[roadmap] Failed to create item", err);
      alert("Sorry, we couldn't create that roadmap item. Please try again.");
    } finally {
      setCreateBusy(false);
    }
  };

  const handleStartEdit = (item: RoadmapItemWithRelations, field: EditableField) => {
    const canEdit = isAdmin || (!!viewerId && item.createdBy && item.createdBy === viewerId);
    if (!canEdit) return;
    clearPendingToggle();
    const currentValue = field === "title" ? item.title ?? "" : item.description ?? "";
    setActiveEdit({ itemId: item.id, field, value: currentValue });
    setEditError((prev) => ({ ...prev, [buildEditKey(item.id, field)]: null }));
  };

  const handleEditValueChange = (value: string) => {
    setActiveEdit((prev) => (prev ? { ...prev, value } : prev));
  };

  const handleCancelEdit = () => {
    setActiveEdit(null);
  };

  const handleCommitEdit = async (
    item: RoadmapItemWithRelations,
    field: EditableField,
    rawValue: string,
  ) => {
    const key = buildEditKey(item.id, field);
    if (editBusy[key]) return;
    const currentValue = field === "title" ? item.title : (item.description ?? "");
    if (currentValue === rawValue) {
      setActiveEdit(null);
      setEditError((prev) => ({ ...prev, [key]: null }));
      return;
    }
    const trimmed = rawValue.trim();
    if (field === "title" && trimmed.length === 0) {
      setEditError((prev) => ({ ...prev, [key]: "Title is required." }));
      return;
    }
    setEditBusy((prev) => ({ ...prev, [key]: true }));
    try {
      if (field === "title") {
        await updateRoadmapItem(item.id, { title: trimmed });
      } else {
        await updateRoadmapItem(item.id, { description: trimmed.length > 0 ? trimmed : null });
      }
      setActiveEdit(null);
      setEditError((prev) => ({ ...prev, [key]: null }));
    } catch (error) {
      console.error("[roadmap] Failed to update item", error);
      setEditError((prev) => ({
        ...prev,
        [key]: "Unable to save changes. Please try again.",
      }));
    } finally {
      setEditBusy((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const handleEditKeyDown = (
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    item: RoadmapItemWithRelations,
    field: EditableField,
  ) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleCommitEdit(item, field, event.currentTarget.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      handleCancelEdit();
    }
  };

  const handleEditBlur = (
    item: RoadmapItemWithRelations,
    field: EditableField,
    value: string,
  ) => {
    if (activeEdit && activeEdit.itemId === item.id && activeEdit.field === field) {
      handleCommitEdit(item, field, value);
    }
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

  const handleDeleteComment = async (comment: RoadmapComment) => {
    const canDelete = isAdmin || (!!viewerId && comment.authorId === viewerId);
    if (!canDelete) {
      alert("Only the comment author or an admin can delete this comment.");
      return;
    }
    if (deleteBusy[comment.id]) return;
    if (typeof window !== "undefined") {
      const confirmDelete = window.confirm("Remove this comment?");
      if (!confirmDelete) return;
    }
    setDeleteBusy((prev) => ({ ...prev, [comment.id]: true }));
    setDeleteError((prev) => ({ ...prev, [comment.id]: null }));
    try {
      await removeRoadmapComment(comment.id);
    } catch (err) {
      console.error("[roadmap] Failed to delete comment", err);
      setDeleteError((prev) => ({
        ...prev,
        [comment.id]: "Unable to delete right now. Please try again.",
      }));
    } finally {
      setDeleteBusy((prev) => {
        const next = { ...prev };
        delete next[comment.id];
        return next;
      });
    }
  };

  const handleDeleteItem = async (item: RoadmapItemWithRelations) => {
    const canDelete = isAdmin || (!!viewerId && item.createdBy && item.createdBy === viewerId);
    if (!canDelete) {
      alert("Only the creator or an admin can delete this roadmap item.");
      return;
    }
    if (itemDeleteBusy[item.id]) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Delete this roadmap item and all associated feedback?");
      if (!confirmed) return;
    }
    clearPendingToggle();
    setItemDeleteBusy((prev) => ({ ...prev, [item.id]: true }));
    setItemDeleteError((prev) => ({ ...prev, [item.id]: null }));
    try {
      await deleteRoadmapItem(item.id);
      setExpandedId((prev) => (prev === item.id ? null : prev));
    } catch (error) {
      console.error("[roadmap] Failed to delete roadmap item", error);
      setItemDeleteError((prev) => ({
        ...prev,
        [item.id]: "Unable to delete item right now. Please try again.",
      }));
    } finally {
      setItemDeleteBusy((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const handleDragStart = (event: React.DragEvent, item: RoadmapItemWithRelations) => {
    if (!isAdmin || sortBy !== "custom") return;
    if (activeEdit && activeEdit.itemId === item.id) {
      event.preventDefault();
      return;
    }
    setDraggedItemId(item.id);
    setIsReordering(true);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/html", item.id);
  };

  const handleDragOver = (event: React.DragEvent, item: RoadmapItemWithRelations) => {
    if (!isAdmin || sortBy !== "custom" || !draggedItemId || draggedItemId === item.id) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverItemId(item.id);
  };

  const handleDragLeave = () => {
    setDragOverItemId(null);
  };

  const handleDrop = async (event: React.DragEvent, targetItem: RoadmapItemWithRelations) => {
    if (!isAdmin || sortBy !== "custom" || !draggedItemId || draggedItemId === targetItem.id) {
      return;
    }
    event.preventDefault();
    setDragOverItemId(null);
    setIsReordering(false);

    const draggedIndex = sortedItems.findIndex((item) => item.id === draggedItemId);
    const targetIndex = sortedItems.findIndex((item) => item.id === targetItem.id);

    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedItemId(null);
      return;
    }

    const newOrder = [...sortedItems];
    const [draggedItem] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedItem);

    const updates = newOrder.map((item, index) => ({
      itemId: item.id,
      order: index + 1,
    }));

    try {
      await updateRoadmapItemsOrder(updates);
    } catch (error) {
      console.error("[roadmap] Failed to update item order", error);
      alert("Unable to save new order. Please try again.");
    } finally {
      setDraggedItemId(null);
    }
  };

  const handleDragEnd = () => {
    setDraggedItemId(null);
    setDragOverItemId(null);
    setIsReordering(false);
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
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Product Roadmap</h1>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Track what we're exploring and actively building.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="appearance-none rounded-lg border border-slate-300 bg-white px-3 py-2 pr-8 text-sm font-medium text-slate-700 outline-none transition focus:border-brand-300 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-brand-400 dark:focus:ring-brand-500/40"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                <svg
                  className="h-4 w-4 text-slate-400 dark:text-slate-500"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            </div>
            {viewerId ? (
              <button
                type="button"
                onClick={handleCreateItem}
                disabled={createBusy}
                className="inline-flex items-center justify-center rounded-full bg-brand-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {createBusy ? "Creating…" : "New"}
              </button>
            ) : null}
          </div>
        </header>

        {sortedItems.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
            No roadmap items yet. Check back soon!
          </div>
        ) : (
          <ol className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {sortedItems.map((item) => {
              const statusMeta = STATUS_META[item.status] ?? STATUS_META.suggested;
              const timeline = buildTimelineLabel(item);
              const isExpanded = expandedId === item.id;
              const voteLabel = `${item.voteCount} vote${item.voteCount === 1 ? "" : "s"}`;
              const commentLabel = `${item.comments.length} Comment${item.comments.length === 1 ? "" : "s"}`;

              const canEditItem =
                isAdmin || (!!viewerId && item.createdBy && item.createdBy === viewerId);
              const canDeleteItem = canEditItem;
              const titleKey = buildEditKey(item.id, "title");
              const descriptionKey = buildEditKey(item.id, "description");
              const titleEditing =
                activeEdit?.itemId === item.id && activeEdit.field === "title";
              const descriptionEditing =
                activeEdit?.itemId === item.id && activeEdit.field === "description";
              const isTitleSaving = !!editBusy[titleKey];
              const isDescriptionSaving = !!editBusy[descriptionKey];
              const titleError = editError[titleKey];
              const descriptionError = editError[descriptionKey];

              const isDragging = draggedItemId === item.id;
              const isDragOver = dragOverItemId === item.id;
              const canDrag = isAdmin && sortBy === "custom";
              const isItemBeingEdited = activeEdit?.itemId === item.id;

              return (
                <li key={item.id}>
                  <article
                    draggable={canDrag && !isDragging && !isItemBeingEdited}
                    onDragStart={(e) => handleDragStart(e, item)}
                    onDragOver={(e) => handleDragOver(e, item)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, item)}
                    onDragEnd={handleDragEnd}
                    className={`relative rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 ${
                      isDragging ? "opacity-50 cursor-grabbing" : ""
                    } ${isDragOver ? "border-brand-400 ring-2 ring-brand-200 dark:border-brand-400 dark:ring-brand-500/40" : ""} ${
                      canDrag && !isDragging && !isItemBeingEdited ? "cursor-grab" : ""
                    }`}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={(event) => handleCardClick(event, item)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          if (activeEdit && activeEdit.itemId === item.id) return;
                          event.preventDefault();
                          handleToggleExpand(item.id);
                        }
                      }}
                      className="w-full rounded-2xl p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
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
                          </div>
                          {titleEditing ? (
                            <div data-roadmap-edit-control="true" className="max-w-xl">
                              <input
                                autoFocus
                                value={activeEdit?.value ?? ""}
                                onChange={(event) => handleEditValueChange(event.target.value)}
                                onKeyDown={(event) => handleEditKeyDown(event, item, "title")}
                                onBlur={(event) => handleEditBlur(item, "title", event.target.value)}
                                disabled={isTitleSaving}
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-200 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-white dark:focus:border-brand-400 dark:focus:ring-brand-500/40"
                              />
                              {titleError ? (
                                <p className="mt-1 text-xs text-rose-500">{titleError}</p>
                              ) : null}
                            </div>
                          ) : (
                            <h2
                              data-roadmap-editable={canEditItem ? "true" : undefined}
                              className={`text-lg font-semibold text-slate-900 dark:text-white sm:text-xl ${
                                canEditItem ? "cursor-text" : ""
                              }`}
                              onDoubleClick={(event) => {
                                if (!canEditItem) return;
                                event.preventDefault();
                                event.stopPropagation();
                                handleStartEdit(item, "title");
                              }}
                            >
                              {item.title}
                            </h2>
                          )}
                          {descriptionEditing ? (
                            <div data-roadmap-edit-control="true">
                              <textarea
                                rows={3}
                                autoFocus
                                value={activeEdit?.value ?? ""}
                                onChange={(event) => handleEditValueChange(event.target.value)}
                                onKeyDown={(event) => handleEditKeyDown(event, item, "description")}
                                onBlur={(event) =>
                                  handleEditBlur(item, "description", event.target.value)
                                }
                                disabled={isDescriptionSaving}
                                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-200 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-brand-400 dark:focus:ring-brand-500/40"
                              />
                              {descriptionError ? (
                                <p className="mt-1 text-xs text-rose-500">{descriptionError}</p>
                              ) : null}
                            </div>
                          ) : item.description ? (
                            <p
                              data-roadmap-editable={canEditItem ? "true" : undefined}
                              className={`text-sm text-slate-600 dark:text-slate-300 ${
                                canEditItem ? "cursor-text" : ""
                              }`}
                              onDoubleClick={(event) => {
                                if (!canEditItem) return;
                                event.preventDefault();
                                event.stopPropagation();
                                handleStartEdit(item, "description");
                              }}
                            >
                              {item.description}
                            </p>
                          ) : canEditItem ? (
                            <p
                              data-roadmap-editable="true"
                              className="text-sm italic text-slate-400 dark:text-slate-500"
                              onDoubleClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                handleStartEdit(item, "description");
                              }}
                            >
                              Double-click to add more context.
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
                        </div>
                      </div>
                    </div>
                    {!isExpanded && (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleToggleExpand(item.id);
                        }}
                        className="absolute bottom-4 right-4 rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-200 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-300 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                      >
                        {commentLabel}
                      </button>
                    )}

                    {isExpanded && (
                      <div className="space-y-6 border-t border-slate-200 px-4 pb-4 pt-4 dark:border-slate-800">
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

                          {item.comments.length > 0 && (
                            <ul className="space-y-3">
                              {item.comments.map((comment) => (
                                <li
                                  key={comment.id}
                                  className="rounded-lg border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300"
                                >
                                  <div className="flex items-start justify-between gap-3 text-xs text-slate-400 dark:text-slate-500">
                                    <div className="flex flex-col">
                                      <span>{comment.authorName ?? "Community member"}</span>
                                      <time dateTime={new Date(comment.createdAt).toISOString()}>
                                        {formatShortDate(comment.createdAt) ?? "Just now"}
                                      </time>
                                    </div>
                                    {(isAdmin || (!!viewerId && comment.authorId === viewerId)) && (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteComment(comment)}
                                        disabled={deleteBusy[comment.id]}
                                        className="rounded-full border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-500 transition hover:border-rose-300 hover:text-rose-500 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:border-rose-400 dark:hover:text-rose-300"
                                        aria-label="Delete comment"
                                      >
                                        {deleteBusy[comment.id] ? "Removing…" : "Delete"}
                                      </button>
                                    )}
                                  </div>
                                  <p className="mt-2 whitespace-pre-line">{comment.body}</p>
                                  {deleteError[comment.id] ? (
                                    <p className="mt-2 text-xs text-rose-500">{deleteError[comment.id]}</p>
                                  ) : null}
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>

                        <section aria-label="Add comment" className="space-y-2">
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
                          {(commentError[item.id] || itemDeleteError[item.id]) && (
                            <p className="text-xs text-rose-500">
                              {commentError[item.id] || itemDeleteError[item.id]}
                            </p>
                          )}
                          <div className="flex items-center justify-between gap-3">
                            {canDeleteItem && (
                              <button
                                type="button"
                                onClick={() => handleDeleteItem(item)}
                                disabled={itemDeleteBusy[item.id]}
                                className="inline-flex items-center gap-2 rounded-full border border-rose-400 px-3 py-1.5 text-xs font-semibold text-rose-500 transition hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500 dark:text-rose-300 dark:hover:bg-rose-500/10 dark:hover:text-rose-200"
                              >
                                {itemDeleteBusy[item.id] ? "Deleting…" : "Delete roadmap item"}
                              </button>
                            )}
                            <div className="ml-auto flex items-center gap-3">
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
