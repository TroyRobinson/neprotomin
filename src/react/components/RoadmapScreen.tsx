import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FocusEvent, KeyboardEvent, MouseEvent } from "react";
import { useRoadmapItems } from "../hooks/useRoadmapItems";
import type {
  RoadmapItemWithRelations,
  RoadmapStatus,
  RoadmapComment,
  RoadmapTag,
} from "../../types/roadmap";
import {
  addRoadmapVote,
  removeRoadmapVote,
  addRoadmapComment,
  removeRoadmapComment,
  createRoadmapItem,
  updateRoadmapItem,
  deleteRoadmapItem,
  updateRoadmapItemsOrder,
  createRoadmapTag,
  updateRoadmapTag,
  updateRoadmapTagsOrder,
  deleteRoadmapTag,
} from "../lib/roadmapActions";
import { db } from "../../lib/reactDb";
import { isAdminEmail, isAdminEmailOnly } from "../../lib/admin";
import { Cog6ToothIcon } from "@heroicons/react/24/outline";

const STATUS_META: Record<
  RoadmapStatus,
  { label: string; badgeClass: string; dotClass: string }
> = {
  suggested: {
    label: "Suggested",
    badgeClass: "bg-slate-100 text-slate-600 dark:bg-slate-800/80 dark:text-slate-300",
    dotClass: "bg-slate-400 dark:bg-slate-500",
  },
  considering: {
    label: "Evaluating",
    badgeClass: "bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200",
    dotClass: "bg-amber-500 dark:bg-amber-300",
  },
  inProcess: {
    label: "In Progress",
    badgeClass: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/60 dark:text-indigo-200",
    dotClass: "bg-indigo-500 dark:bg-indigo-300",
  },
  postponed: {
    label: "Postponed",
    badgeClass: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
    dotClass: "bg-gray-400 dark:bg-gray-500",
  },
  completed: {
    label: "Completed",
    badgeClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/60 dark:text-emerald-200",
    dotClass: "bg-emerald-500 dark:bg-emerald-300",
  },
};

type TagShapeKind = "circle" | "triangle" | "diamond" | "square" | "hexagon";

const TAG_COLOR_STYLES = [
  {
    key: "rose",
    name: "Rose",
    chipClass: "bg-rose-50 text-rose-900 dark:bg-rose-900/40 dark:text-rose-100",
    shapeColorClass: "text-rose-500 dark:text-rose-300",
  },
  {
    key: "amber",
    name: "Amber",
    chipClass: "bg-amber-50 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
    shapeColorClass: "text-amber-500 dark:text-amber-300",
  },
  {
    key: "emerald",
    name: "Emerald",
    chipClass: "bg-emerald-50 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-100",
    shapeColorClass: "text-emerald-500 dark:text-emerald-300",
  },
  {
    key: "sky",
    name: "Sky",
    chipClass: "bg-sky-50 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
    shapeColorClass: "text-sky-500 dark:text-sky-300",
  },
  {
    key: "indigo",
    name: "Indigo",
    chipClass: "bg-indigo-50 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-100",
    shapeColorClass: "text-indigo-500 dark:text-indigo-300",
  },
  {
    key: "slate",
    name: "Slate",
    chipClass: "bg-slate-50 text-slate-800 dark:bg-slate-900/40 dark:text-slate-100",
    shapeColorClass: "text-slate-500 dark:text-slate-300",
  },
] as const;

type TagColorKey = (typeof TAG_COLOR_STYLES)[number]["key"];

const TAG_COLOR_STYLE_MAP: Record<TagColorKey, (typeof TAG_COLOR_STYLES)[number]> = TAG_COLOR_STYLES.reduce(
  (acc, style) => {
    acc[style.key] = style;
    return acc;
  },
  {} as Record<TagColorKey, (typeof TAG_COLOR_STYLES)[number]>,
);

const isTagColorKey = (value: string): value is TagColorKey => {
  return TAG_COLOR_STYLES.some((style) => style.key === value);
};

const TAG_SHAPES: TagShapeKind[] = ["circle", "triangle", "diamond", "square", "hexagon"];
const TAG_SHAPE_SET = new Set<TagShapeKind>(TAG_SHAPES);

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
};

const getHashedVisual = (tag: string) => {
  const normalized = tag.toLowerCase();
  const hash = hashString(normalized);
  const colorMeta = TAG_COLOR_STYLES[hash % TAG_COLOR_STYLES.length];
  const shape = TAG_SHAPES[(hash >> 3) % TAG_SHAPES.length];
  return { colorMeta, shape };
};

const getTagVisual = (tag: string, definition?: RoadmapTag | null) => {
  const fallback = getHashedVisual(tag);
  const colorMeta =
    definition?.colorKey && TAG_COLOR_STYLE_MAP[definition.colorKey as TagColorKey]
      ? TAG_COLOR_STYLE_MAP[definition.colorKey as TagColorKey]
      : fallback.colorMeta;
  const shape =
    definition?.shape && TAG_SHAPE_SET.has(definition.shape as TagShapeKind)
      ? (definition.shape as TagShapeKind)
      : fallback.shape;
  return { chipClass: colorMeta.chipClass, shapeColorClass: colorMeta.shapeColorClass, shape };
};

const TagShapeIcon = ({ shape, colorClass }: { shape: TagShapeKind; colorClass: string }) => {
  switch (shape) {
    case "circle":
      return (
        <svg className={`h-2.5 w-2.5 ${colorClass}`} viewBox="0 0 12 12" aria-hidden="true">
          <circle cx="6" cy="6" r="5" fill="currentColor" />
        </svg>
      );
    case "triangle":
      return (
        <svg className={`h-2.5 w-2.5 ${colorClass}`} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 1.5 10.5 10.5H1.5z" fill="currentColor" />
        </svg>
      );
    case "diamond":
      return (
        <svg className={`h-2.5 w-2.5 ${colorClass}`} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 0.75 10.5 5.25 6 9.75 1.5 5.25z" fill="currentColor" />
        </svg>
      );
    case "square":
      return (
        <svg className={`h-2.5 w-2.5 ${colorClass}`} viewBox="0 0 12 12" aria-hidden="true">
          <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
        </svg>
      );
    case "hexagon":
      return (
        <svg className={`h-2.5 w-2.5 ${colorClass}`} viewBox="0 0 12 12" aria-hidden="true">
          <path d="M6 0.75 10.5 3v6L6 11.25 1.5 9V3z" fill="currentColor" />
        </svg>
      );
    default:
      return null;
  }
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
  const { items, tags, isLoading, error, viewerId } = useRoadmapItems();
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
  const descriptionRefs = useRef<Record<string, HTMLParagraphElement | null>>({});
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [descriptionHeights, setDescriptionHeights] = useState<Record<string, number>>({});
  const [statusDropdownOpen, setStatusDropdownOpen] = useState<string | null>(null);
  const [statusUpdateBusy, setStatusUpdateBusy] = useState<Record<string, boolean>>({});
  const [statusUpdateError, setStatusUpdateError] = useState<Record<string, string | null>>({});
  const [statusDropdownPosition, setStatusDropdownPosition] = useState<Record<string, "above" | "below">>({});
  const statusDropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [tagSelectorOpen, setTagSelectorOpen] = useState<string | null>(null);
  const [tagUpdateBusy, setTagUpdateBusy] = useState<Record<string, boolean>>({});
  const [tagUpdateError, setTagUpdateError] = useState<Record<string, string | null>>({});
  const tagSelectorRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [activeEffortEdit, setActiveEffortEdit] = useState<{ itemId: string; value: string } | null>(null);
  const [effortBusy, setEffortBusy] = useState<Record<string, boolean>>({});
  const [effortError, setEffortError] = useState<Record<string, string | null>>({});
  const [tagStyleBusy, setTagStyleBusy] = useState<Record<string, boolean>>({});
  const [tagStyleError, setTagStyleError] = useState<Record<string, string | null>>({});
  const [tagCreateBusy, setTagCreateBusy] = useState(false);
  const [newTagDraft, setNewTagDraft] = useState<{ label: string; colorKey: TagColorKey; shape: TagShapeKind }>({
    label: "",
    colorKey: TAG_COLOR_STYLES[0].key,
    shape: TAG_SHAPES[0],
  });
  const [newTagError, setNewTagError] = useState<string | null>(null);
  const [tagDeleteBusy, setTagDeleteBusy] = useState<Record<string, boolean>>({});
  const [tagDeleteError, setTagDeleteError] = useState<Record<string, string | null>>({});
  const [tagSettingsOpen, setTagSettingsOpen] = useState<string | null>(null);
  const [isAddTagFormVisible, setIsAddTagFormVisible] = useState(false);
  const [tagDragSourceId, setTagDragSourceId] = useState<string | null>(null);
  const [tagDragOverId, setTagDragOverId] = useState<string | null>(null);
  const [tagOrderSaving, setTagOrderSaving] = useState(false);

  const sortedItems = useMemo(() => sortItems(items, sortBy), [items, sortBy]);
  const isAdmin = useMemo(() => {
    if (!user || user.isGuest) return false;
    return isAdminEmail(user.email ?? null);
  }, [user]);
  const isEmailAdmin = useMemo(() => {
    if (!user || user.isGuest) return false;
    return isAdminEmailOnly(user.email ?? null);
  }, [user]);
  const canManageTags = isEmailAdmin;
  const canEditEffort = isEmailAdmin;
  const tagRecordByLabel = useMemo(() => {
    const map = new Map<string, RoadmapTag>();
    for (const tag of tags) {
      map.set(tag.label.toLowerCase(), tag);
    }
    return map;
  }, [tags]);

  const tagOrderLookup = useMemo(() => {
    const map = new Map<string, number>();
    tags.forEach((tag, index) => {
      const value = tag.order ?? index + 1;
      map.set(tag.label.toLowerCase(), value);
    });
    return map;
  }, [tags]);

  const tagOptions = useMemo(() => {
    type TagOption = { label: string; record: RoadmapTag | null; isDefined: boolean };
    const options: TagOption[] = tags.map((tag) => ({
      label: tag.label,
      record: tag,
      isDefined: true,
    }));
    const seen = new Set(options.map((option) => option.label.toLowerCase()));
    const orphanOptions: TagOption[] = [];
    items.forEach((item) => {
      (item.tags ?? []).forEach((label) => {
        const normalized = label?.trim();
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        orphanOptions.push({ label: normalized, record: null, isDefined: false });
      });
    });
    orphanOptions.sort((a, b) => a.label.localeCompare(b.label));
    return [...options, ...orphanOptions];
  }, [items, tags]);

  const sortTagLabels = useCallback(
    (labels?: string[] | null): string[] => {
      if (!labels) return [];
      return [...labels].sort((a, b) => {
        const keyA = a.toLowerCase();
        const keyB = b.toLowerCase();
        const orderA = tagOrderLookup.get(keyA);
        const orderB = tagOrderLookup.get(keyB);
        if (orderA != null && orderB != null && orderA !== orderB) {
          return orderA - orderB;
        }
        if (orderA != null) return -1;
        if (orderB != null) return 1;
        return a.localeCompare(b);
      });
    },
    [tagOrderLookup],
  );

  useEffect(() => {
    return () => {
      if (toggleTimerRef.current !== null) {
        window.clearTimeout(toggleTimerRef.current);
        toggleTimerRef.current = null;
      }
    };
  }, []);

  // Close status dropdown when clicking outside
  useEffect(() => {
    if (!statusDropdownOpen) return;

    const handleClickOutside = (event: globalThis.MouseEvent) => {
      const dropdownElement = statusDropdownRefs.current[statusDropdownOpen];
      if (dropdownElement && !dropdownElement.contains(event.target as Node)) {
        setStatusDropdownOpen(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [statusDropdownOpen]);

  const resetTagDropdownState = useCallback(() => {
    setTagSelectorOpen(null);
    setTagSettingsOpen(null);
    setIsAddTagFormVisible(false);
    setTagDragSourceId(null);
    setTagDragOverId(null);
    setNewTagDraft({ label: "", colorKey: TAG_COLOR_STYLES[0].key, shape: TAG_SHAPES[0] });
    setNewTagError(null);
  }, []);

  useEffect(() => {
    if (!tagSelectorOpen) {
      resetTagDropdownState();
      return;
    }

    const handleClickOutside = (event: globalThis.MouseEvent) => {
      const dropdownElement = tagSelectorRefs.current[tagSelectorOpen];
      if (dropdownElement && !dropdownElement.contains(event.target as Node)) {
        resetTagDropdownState();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [tagSelectorOpen, resetTagDropdownState]);

  // Resize textarea when description editing starts
  useEffect(() => {
    if (activeEdit?.field === "description" && activeEdit.itemId) {
      const textarea = textareaRefs.current[activeEdit.itemId];
      if (textarea) {
        // Use requestAnimationFrame to ensure DOM has updated
        requestAnimationFrame(() => {
          handleTextareaResize(textarea, activeEdit.itemId);
        });
      }
    }
  }, [activeEdit, descriptionHeights]);

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
    setActiveEffortEdit((prev) => (prev?.itemId === itemId ? null : prev));
    resetTagDropdownState();
  };

  const scheduleToggle = (itemId: string) => {
    clearPendingToggle();
    toggleTimerRef.current = window.setTimeout(() => {
      toggleTimerRef.current = null;
      setExpandedId((prev) => (prev === itemId ? null : itemId));
      setCommentError((prev) => ({ ...prev, [itemId]: null }));
      setActiveEdit((prev) => (prev?.itemId === itemId ? null : prev));
      setActiveEffortEdit((prev) => (prev?.itemId === itemId ? null : prev));
      resetTagDropdownState();
    }, 160);
  };

  const handleTagMenuToggle = (itemId: string) => {
    if (!canManageTags) return;
    setTagSettingsOpen(null);
    setIsAddTagFormVisible(false);
    setTagSelectorOpen((prev) => (prev === itemId ? null : itemId));
    setTagUpdateError((prev) => ({ ...prev, [itemId]: null }));
  };

  const handleTagToggle = async (item: RoadmapItemWithRelations, label: string) => {
    if (!canManageTags) return;
    if (tagUpdateBusy[item.id]) return;
    const existing = Array.isArray(item.tags) && item.tags ? [...item.tags] : [];
    const hasLabel = existing.includes(label);
    const next = hasLabel ? existing.filter((value) => value !== label) : [...existing, label];
    setTagUpdateBusy((prev) => ({ ...prev, [item.id]: true }));
    setTagUpdateError((prev) => ({ ...prev, [item.id]: null }));
    try {
      await updateRoadmapItem(item.id, { tags: next.length > 0 ? next : [] });
    } catch (error) {
      console.error("[roadmap] Failed to update tags", error);
      setTagUpdateError((prev) => ({
        ...prev,
        [item.id]: "Unable to update tags right now.",
      }));
    } finally {
      setTagUpdateBusy((prev) => {
        const nextBusy = { ...prev };
        delete nextBusy[item.id];
        return nextBusy;
      });
    }
  };

  const handleClearTags = async (item: RoadmapItemWithRelations) => {
    if (!canManageTags) return;
    if (tagUpdateBusy[item.id]) return;
    if (!item.tags || item.tags.length === 0) {
      resetTagDropdownState();
      return;
    }
    setTagUpdateBusy((prev) => ({ ...prev, [item.id]: true }));
    setTagUpdateError((prev) => ({ ...prev, [item.id]: null }));
    try {
      await updateRoadmapItem(item.id, { tags: [] });
    } catch (error) {
      console.error("[roadmap] Failed to clear tags", error);
      setTagUpdateError((prev) => ({
        ...prev,
        [item.id]: "Unable to clear tags right now.",
      }));
    } finally {
      setTagUpdateBusy((prev) => {
        const nextBusy = { ...prev };
        delete nextBusy[item.id];
        return nextBusy;
      });
    }
  };

  const handleTagStyleChange = async (
    tag: RoadmapTag,
    patch: Partial<{ colorKey: string | null; shape: string | null }>,
  ) => {
    if (!canManageTags) return;
    const payload: Record<string, string | null> = {};
    if (patch.colorKey !== undefined) {
      let normalized: string | null = null;
      if (patch.colorKey && isTagColorKey(patch.colorKey)) {
        normalized = patch.colorKey;
      }
      if ((tag.colorKey ?? null) !== normalized) {
        payload.colorKey = normalized;
      }
    }
    if (patch.shape !== undefined) {
      let normalized: string | null = null;
      if (patch.shape && TAG_SHAPE_SET.has(patch.shape as TagShapeKind)) {
        normalized = patch.shape as TagShapeKind;
      }
      if ((tag.shape ?? null) !== normalized) {
        payload.shape = normalized;
      }
    }
    if (Object.keys(payload).length === 0) return;
    setTagStyleBusy((prev) => ({ ...prev, [tag.id]: true }));
    setTagStyleError((prev) => ({ ...prev, [tag.id]: null }));
    try {
      await updateRoadmapTag(tag.id, payload);
    } catch (error) {
      console.error("[roadmap] Failed to update tag style", error);
      setTagStyleError((prev) => ({
        ...prev,
        [tag.id]: "Unable to update style right now.",
      }));
    } finally {
      setTagStyleBusy((prev) => {
        const next = { ...prev };
        delete next[tag.id];
        return next;
      });
    }
  };

  const handleTagColorSelect = (tag: RoadmapTag, value: string) => {
    if (!canManageTags) return;
    if (value === "") {
      void handleTagStyleChange(tag, { colorKey: null });
      return;
    }
    if (!isTagColorKey(value)) return;
    void handleTagStyleChange(tag, { colorKey: value });
  };

  const handleTagShapeSelect = (tag: RoadmapTag, value: string) => {
    if (!canManageTags) return;
    if (value === "") {
      void handleTagStyleChange(tag, { shape: null });
      return;
    }
    if (!TAG_SHAPE_SET.has(value as TagShapeKind)) return;
    void handleTagStyleChange(tag, { shape: value });
  };

  const handleNewTagDraftChange = (
    field: "label" | "colorKey" | "shape",
    value: string,
  ) => {
    if (!canManageTags) return;
    setNewTagDraft((prev) => {
      if (field === "label") {
        return { ...prev, label: value };
      }
      if (field === "colorKey" && isTagColorKey(value)) {
        return { ...prev, colorKey: value };
      }
      if (field === "shape" && TAG_SHAPE_SET.has(value as TagShapeKind)) {
        return { ...prev, shape: value as TagShapeKind };
      }
      return prev;
    });
  };

  const handleCreateTagDefinition = async () => {
    if (!canManageTags) return;
    const label = newTagDraft.label.trim();
    if (!label) {
      setNewTagError("Enter a tag name.");
      return;
    }
    if (tagRecordByLabel.has(label.toLowerCase())) {
      setNewTagError("That tag already exists.");
      return;
    }
    if (tagCreateBusy) return;
    setTagCreateBusy(true);
    setNewTagError(null);
    try {
      await createRoadmapTag({
        label,
        colorKey: newTagDraft.colorKey,
        shape: newTagDraft.shape,
        createdBy: viewerId ?? null,
      });
      setNewTagDraft((prev) => ({ ...prev, label: "" }));
    } catch (error) {
      console.error("[roadmap] Failed to create roadmap tag", error);
      setNewTagError(error instanceof Error ? error.message : "Unable to add tag right now.");
    } finally {
      setTagCreateBusy(false);
    }
  };

  const handleCancelNewTag = () => {
    if (!canManageTags) return;
    setIsAddTagFormVisible(false);
    setNewTagDraft({ label: "", colorKey: TAG_COLOR_STYLES[0].key, shape: TAG_SHAPES[0] });
    setNewTagError(null);
  };

  const handleDeleteTagDefinition = async (tag: RoadmapTag) => {
    if (!canManageTags) return;
    if (tagDeleteBusy[tag.id]) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        `Delete the "${tag.label}" tag? It will be removed from all roadmap items.`,
      );
      if (!confirmed) return;
    }
    setTagDeleteBusy((prev) => ({ ...prev, [tag.id]: true }));
    setTagDeleteError((prev) => ({ ...prev, [tag.id]: null }));
    try {
      await deleteRoadmapTag(tag.id);
      setTagSettingsOpen((prev) => (prev === tag.id ? null : prev));
      setTagDeleteError((prev) => {
        const next = { ...prev };
        delete next[tag.id];
        return next;
      });
    } catch (error) {
      console.error("[roadmap] Failed to delete roadmap tag", error);
      setTagDeleteError((prev) => ({
        ...prev,
        [tag.id]: "Unable to delete tag right now.",
      }));
    } finally {
      setTagDeleteBusy((prev) => {
        const next = { ...prev };
        delete next[tag.id];
        return next;
      });
    }
  };

  const handleTagSettingsToggle = (tagId: string) => {
    setTagSettingsOpen((prev) => (prev === tagId ? null : tagId));
  };

  const handleShowAddTagForm = () => {
    if (!canManageTags) return;
    setIsAddTagFormVisible(true);
    setNewTagError(null);
  };

  const handleTagDragStart = (event: DragEvent<HTMLDivElement>, tagId: string) => {
    if (!canManageTags || tagOrderSaving) return;
    setTagDragSourceId(tagId);
    setTagDragOverId(tagId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tagId);
  };

  const handleTagDragOver = (event: DragEvent<HTMLDivElement>, tagId: string) => {
    if (!canManageTags || tagOrderSaving || !tagDragSourceId || tagId === tagDragSourceId) {
      return;
    }
    event.preventDefault();
    setTagDragOverId(tagId);
  };

  const handleTagDragLeave = () => {
    setTagDragOverId(null);
  };

  const handleTagDragEnd = () => {
    setTagDragSourceId(null);
    setTagDragOverId(null);
  };

  const handleTagDrop = async (event: DragEvent<HTMLDivElement>, tagId: string) => {
    if (!canManageTags || tagOrderSaving || !tagDragSourceId || tagDragSourceId === tagId) {
      return;
    }
    event.preventDefault();
    setTagDragOverId(null);

    const sourceIndex = tags.findIndex((tag) => tag.id === tagDragSourceId);
    const targetIndex = tags.findIndex((tag) => tag.id === tagId);

    if (sourceIndex === -1 || targetIndex === -1) {
      setTagDragSourceId(null);
      return;
    }

    const nextOrder = [...tags];
    const [moved] = nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, moved);

    const updates = nextOrder.map((tag, index) => ({
      tagId: tag.id,
      order: index + 1,
    }));

    setTagOrderSaving(true);
    try {
      await updateRoadmapTagsOrder(updates);
    } catch (error) {
      console.error("[roadmap] Failed to reorder tags", error);
      alert("Unable to reorder tags right now. Please try again.");
    } finally {
      setTagOrderSaving(false);
      setTagDragSourceId(null);
      setTagDragOverId(null);
    }
  };

  const handleStartEffortEdit = (item: RoadmapItemWithRelations) => {
    if (!canEditEffort) return;
    setActiveEffortEdit({ itemId: item.id, value: typeof item.effort === "number" ? `${item.effort}` : "" });
    setEffortError((prev) => ({ ...prev, [item.id]: null }));
    resetTagDropdownState();
  };

  const handleEffortInputChange = (value: string) => {
    setActiveEffortEdit((prev) => (prev ? { ...prev, value } : prev));
  };

  const handleEffortCommit = async (item: RoadmapItemWithRelations, rawValue: string) => {
    if (!canEditEffort) return;
    const trimmed = rawValue.trim();
    let nextValue: number | null = null;
    if (trimmed.length > 0) {
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setEffortError((prev) => ({
          ...prev,
          [item.id]: "Enter a non-negative number.",
        }));
        return;
      }
      nextValue = parsed;
    }
    const currentValue = typeof item.effort === "number" ? item.effort : null;
    if (currentValue === nextValue) {
      setActiveEffortEdit(null);
      return;
    }
    if (effortBusy[item.id]) return;
    setEffortBusy((prev) => ({ ...prev, [item.id]: true }));
    setEffortError((prev) => ({ ...prev, [item.id]: null }));
    try {
      await updateRoadmapItem(item.id, { effort: nextValue });
      setActiveEffortEdit(null);
    } catch (error) {
      console.error("[roadmap] Failed to update effort", error);
      setEffortError((prev) => ({
        ...prev,
        [item.id]: "Unable to update effort right now.",
      }));
    } finally {
      setEffortBusy((prev) => {
        const nextBusy = { ...prev };
        delete nextBusy[item.id];
        return nextBusy;
      });
    }
  };

  const handleEffortKeyDown = (
    event: KeyboardEvent<HTMLInputElement>,
    item: RoadmapItemWithRelations,
  ) => {
    if (!canEditEffort) return;
    if (event.key === "Enter") {
      event.preventDefault();
      handleEffortCommit(item, activeEffortEdit?.value ?? "");
    } else if (event.key === "Escape") {
      event.preventDefault();
      setActiveEffortEdit(null);
      setEffortError((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }
  };

  const handleEffortBlur = (
    event: FocusEvent<HTMLInputElement>,
    item: RoadmapItemWithRelations,
  ) => {
    if (!canEditEffort) return;
    handleEffortCommit(item, event.target.value);
  };

  const handleCardClick = (event: MouseEvent<HTMLDivElement>, item: RoadmapItemWithRelations) => {
    if (isReordering) return;
    if ((event.target as HTMLElement).closest("[data-roadmap-edit-control='true']")) return;
    if ((event.target as HTMLElement).closest("[data-roadmap-editable='true']")) return;
    if ((event.target as HTMLElement).closest("[data-status-dropdown='true']")) return;
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
    const canEdit = isEmailAdmin || (!!viewerId && item.createdBy && item.createdBy === viewerId);
    if (!canEdit) return;
    clearPendingToggle();
    const currentValue = field === "title" ? item.title ?? "" : item.description ?? "";
    setActiveEdit({ itemId: item.id, field, value: currentValue });
    setEditError((prev) => ({ ...prev, [buildEditKey(item.id, field)]: null }));
    
    // Measure description height when starting to edit
    if (field === "description") {
      const descElement = descriptionRefs.current[item.id];
      if (descElement) {
        const height = descElement.offsetHeight;
        setDescriptionHeights((prev) => ({ ...prev, [item.id]: height }));
      }
    }
  };

  const handleEditValueChange = (value: string) => {
    setActiveEdit((prev) => (prev ? { ...prev, value } : prev));
  };

  const handleTextareaResize = (textarea: HTMLTextAreaElement, itemId: string) => {
    textarea.style.height = "auto";
    const measuredHeight = descriptionHeights[itemId] ?? 0;
    
    // Calculate minimum height for 4 lines
    const computedStyle = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(computedStyle.lineHeight) || parseFloat(computedStyle.fontSize) * 1.5;
    const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;
    const minFourLines = lineHeight * 4 + paddingTop + paddingBottom;
    
    const minHeight = Math.max(measuredHeight, minFourLines);
    const newHeight = Math.max(textarea.scrollHeight, minHeight);
    textarea.style.height = `${newHeight}px`;
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
    const canDelete = isEmailAdmin || (!!viewerId && item.createdBy && item.createdBy === viewerId);
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
    if (!isEmailAdmin || sortBy !== "custom") return;
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
    if (!isEmailAdmin || sortBy !== "custom" || !draggedItemId || draggedItemId === item.id) {
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
    if (!isEmailAdmin || sortBy !== "custom" || !draggedItemId || draggedItemId === targetItem.id) {
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

  const handleStatusClick = (event: MouseEvent<HTMLSpanElement>, itemId: string) => {
    if (!isEmailAdmin) return;
    event.stopPropagation();
    const wasOpen = statusDropdownOpen === itemId;
    setStatusDropdownOpen((prev) => (prev === itemId ? null : itemId));
    setStatusUpdateError((prev) => ({ ...prev, [itemId]: null }));
    
    // Calculate position after opening
    if (!wasOpen) {
      requestAnimationFrame(() => {
        const dropdownContainer = statusDropdownRefs.current[itemId];
        if (!dropdownContainer) return;
        
        const rect = dropdownContainer.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const spaceBelow = viewportHeight - rect.bottom;
        const spaceAbove = rect.top;
        const estimatedDropdownHeight = 220; // Approximate height for 5 options + padding
        
        // Position above if not enough space below, but enough space above
        // Default to below if there's reasonable space, or if above doesn't have enough space
        if (spaceBelow < estimatedDropdownHeight && spaceAbove >= estimatedDropdownHeight) {
          setStatusDropdownPosition((prev) => ({ ...prev, [itemId]: "above" }));
        } else {
          setStatusDropdownPosition((prev) => ({ ...prev, [itemId]: "below" }));
        }
      });
    }
  };

  const handleStatusSelect = async (item: RoadmapItemWithRelations, newStatus: RoadmapStatus) => {
    if (!isEmailAdmin) return;
    if (item.status === newStatus) {
      setStatusDropdownOpen(null);
      return;
    }
    if (statusUpdateBusy[item.id]) return;

    setStatusUpdateBusy((prev) => ({ ...prev, [item.id]: true }));
    setStatusUpdateError((prev) => ({ ...prev, [item.id]: null }));
    try {
      await updateRoadmapItem(item.id, { status: newStatus });
      setStatusDropdownOpen(null);
    } catch (error) {
      console.error("[roadmap] Failed to update status", error);
      setStatusUpdateError((prev) => ({
        ...prev,
        [item.id]: "Unable to update status. Please try again.",
      }));
    } finally {
      setStatusUpdateBusy((prev) => {
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
      <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6 lg:px-8">
        <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold text-slate-900 dark:text-white">Roadmap</h1>
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
            {isEmailAdmin ? (
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
          <ol className="grid grid-cols-1 gap-4 md:grid-cols-2 md:items-stretch">
            {sortedItems.map((item, index) => {
              const statusMeta = STATUS_META[item.status] ?? STATUS_META.suggested;
              const timeline = buildTimelineLabel(item);
              const isExpanded = expandedId === item.id;
              const voteLabel = `${item.voteCount} vote${item.voteCount === 1 ? "" : "s"}`;
              const commentLabel = `${item.comments.length} Comment${item.comments.length === 1 ? "" : "s"}`;
              const orderedTagLabels = sortTagLabels(item.tags);
              const hasTagValues = orderedTagLabels.length > 0;
              const hasEffortValue = typeof item.effort === "number" && Number.isFinite(item.effort);
              const showTagSection = canManageTags || hasTagValues;
              const showEffortSection = canEditEffort || hasEffortValue;

              // Check if another card in the same row is expanded
              const otherIndexInRow = index % 2 === 0 ? index + 1 : index - 1;
              const otherItemInRow = otherIndexInRow >= 0 && otherIndexInRow < sortedItems.length ? sortedItems[otherIndexInRow] : null;
              const otherInRowIsExpanded = otherItemInRow && expandedId === otherItemInRow.id;
              // Don't stretch if another card in the same row is expanded (but this card isn't)
              const shouldStretch = !otherInRowIsExpanded;

              const canEditItem =
                isEmailAdmin || (!!viewerId && item.createdBy && item.createdBy === viewerId);
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
              const canDrag = isEmailAdmin && sortBy === "custom";
              const isItemBeingEdited = activeEdit?.itemId === item.id;

              return (
                <li key={item.id} className={`flex transition-all duration-500 ease-out ${shouldStretch ? "" : "md:self-start"}`}>
                  <article
                    draggable={canDrag && !isDragging && !isItemBeingEdited}
                    onDragStart={(e) => handleDragStart(e, item)}
                    onDragOver={(e) => handleDragOver(e, item)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, item)}
                    onDragEnd={handleDragEnd}
                    className={`relative flex h-full w-full flex-col overflow-visible rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-500 ease-out hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700 ${
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
                      className="flex flex-1 flex-col w-full rounded-2xl p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-brand-300"
                      aria-expanded={isExpanded}
                    >
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex flex-1 flex-col gap-2">
                          <div className="flex flex-wrap items-center gap-1">
                            <div
                              className="relative"
                              data-status-dropdown="true"
                              ref={(el) => {
                                statusDropdownRefs.current[item.id] = el;
                              }}
                            >
                              <span
                                onClick={(e) => handleStatusClick(e, item.id)}
                                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold transition ${
                                  isEmailAdmin ? "cursor-pointer hover:opacity-80" : ""
                                } ${statusMeta.badgeClass}`}
                              >
                                <span className={`h-2 w-2 rounded-full ${statusMeta.dotClass}`} />
                                {statusMeta.label}
                              </span>
                              {statusDropdownOpen === item.id && isEmailAdmin && (
                                <div
                                  className={`absolute left-0 min-w-[160px] rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-900 ${
                                    statusDropdownPosition[item.id] === "above"
                                      ? "bottom-full mb-1"
                                      : "top-full mt-1"
                                  }`}
                                  style={{ zIndex: 9999 }}
                                >
                                  <div className="py-1">
                                    {(Object.keys(STATUS_META) as RoadmapStatus[]).map((status) => {
                                      const optionMeta = STATUS_META[status];
                                      const isSelected = item.status === status;
                                      return (
                                        <button
                                          key={status}
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleStatusSelect(item, status);
                                          }}
                                          disabled={statusUpdateBusy[item.id]}
                                          className={`w-full px-3 py-2 text-left text-xs font-semibold transition hover:bg-slate-100 dark:hover:bg-slate-800 ${
                                            isSelected
                                              ? `${optionMeta.badgeClass}`
                                              : "text-slate-700 dark:text-slate-300"
                                          } ${statusUpdateBusy[item.id] ? "opacity-60 cursor-not-allowed" : ""}`}
                                        >
                                          <div className="flex items-center gap-2">
                                            <span className={`h-2 w-2 rounded-full ${optionMeta.dotClass}`} />
                                            <span>{optionMeta.label}</span>
                                            {statusUpdateBusy[item.id] && isSelected && (
                                              <span className="ml-auto text-xs">Updating…</span>
                                            )}
                                          </div>
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {statusUpdateError[item.id] && (
                                    <div className="border-t border-slate-200 px-3 py-2 dark:border-slate-700">
                                      <p className="text-xs text-rose-500">{statusUpdateError[item.id]}</p>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            {showTagSection && (
                              <div
                                className="relative"
                                data-roadmap-edit-control={canManageTags ? "true" : undefined}
                                ref={(el) => {
                                  tagSelectorRefs.current[item.id] = el;
                                }}
                              >
                              <div
                                role={canManageTags ? "button" : undefined}
                                tabIndex={canManageTags ? 0 : undefined}
                                onClick={() => {
                                  if (!canManageTags) return;
                                  handleTagMenuToggle(item.id);
                                }}
                                onKeyDown={(event) => {
                                  if (!canManageTags) return;
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    handleTagMenuToggle(item.id);
                                  }
                                }}
                                className={`inline-flex flex-wrap items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold transition ${
                                  canManageTags
                                    ? "border border-slate-200 cursor-pointer hover:border-slate-400 focus-visible:ring-2 focus-visible:ring-brand-300 text-slate-600 dark:border-slate-700 dark:text-slate-200"
                                    : "cursor-default text-slate-600 dark:text-slate-200"
                                }`}
                              >
                                {orderedTagLabels.length > 0 ? (
                                  orderedTagLabels.map((tagLabel, tagIndex) => {
                                    if (!tagLabel) return null;
                                    const definition = tagRecordByLabel.get(tagLabel.toLowerCase()) ?? null;
                                    const visuals = getTagVisual(tagLabel, definition);
                                    return (
                                      <span
                                        key={`${tagLabel}-${tagIndex}`}
                                        className={`inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold tracking-wide text-slate-700 dark:border-slate-700 dark:text-slate-100 ${visuals.chipClass}`}
                                      >
                                        <TagShapeIcon shape={visuals.shape} colorClass={visuals.shapeColorClass} />
                                        {tagLabel}
                                      </span>
                                    );
                                  })
                                ) : (
                                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                    Tags
                                  </span>
                                )}
                                {canManageTags && (
                                  <svg
                                    className="h-3 w-3 text-slate-400"
                                    viewBox="0 0 20 20"
                                    fill="none"
                                    aria-hidden="true"
                                  >
                                    <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                                  </svg>
                                )}
                              </div>
                              {tagSelectorOpen === item.id && canManageTags && (
                                <div className="absolute left-0 z-30 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                                  <p className="pb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                    Manage tags
                                  </p>
                                  <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                                    {tagOptions.length === 0 ? (
                                      <p className="px-2 py-4 text-sm text-slate-500 dark:text-slate-400">
                                        No tags yet. Add one below.
                                      </p>
                                    ) : (
                                      tagOptions.map((option) => {
                                        const definition = option.record;
                                        const selected = (item.tags ?? []).includes(option.label);
                                        const visuals = getTagVisual(option.label, definition);
                                        const key = definition ? definition.id : `orphan-${option.label}`;
                                        const canDragTag =
                                          !!definition && option.isDefined && canManageTags && !tagOrderSaving;
                                        const isDragOver =
                                          !!definition && tagDragOverId === definition.id && tagDragSourceId !== null;

                                        return (
                                          <div
                                            key={key}
                                            draggable={canDragTag}
                                            onDragStart={
                                              canDragTag ? (event) => handleTagDragStart(event, definition!.id) : undefined
                                            }
                                            onDragOver={
                                              canDragTag ? (event) => handleTagDragOver(event, definition!.id) : undefined
                                            }
                                            onDrop={
                                              canDragTag ? (event) => handleTagDrop(event, definition!.id) : undefined
                                            }
                                            onDragEnd={canDragTag ? handleTagDragEnd : undefined}
                                            onDragLeave={canDragTag ? handleTagDragLeave : undefined}
                                            className={`rounded-xl border border-slate-200 bg-white transition dark:border-slate-700 dark:bg-slate-900/70 ${
                                              isDragOver ? "border-brand-400 ring-2 ring-brand-300/40" : ""
                                            } ${canDragTag ? "cursor-grab" : ""}`}
                                          >
                                            <div className="flex items-center gap-2 px-2 py-1.5">
                                              <button
                                                type="button"
                                                onClick={(event) => {
                                                  event.stopPropagation();
                                                  handleTagToggle(item, option.label);
                                                }}
                                                disabled={!!tagUpdateBusy[item.id]}
                                                className={`flex flex-1 items-center gap-2 rounded-full px-2 py-0.5 text-sm font-semibold ${
                                                  tagUpdateBusy[item.id]
                                                    ? "opacity-60"
                                                    : "text-slate-700 dark:text-slate-200"
                                                }`}
                                              >
                                                <span
                                                  className={`inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold tracking-wide text-slate-700 dark:border-slate-700 dark:text-slate-100 ${visuals.chipClass}`}
                                                >
                                                  <TagShapeIcon
                                                    shape={visuals.shape}
                                                    colorClass={visuals.shapeColorClass}
                                                  />
                                                  {option.label}
                                                </span>
                                              </button>
                                              <span
                                                className={`h-3 w-3 rounded-full border ${
                                                  selected
                                                    ? "border-transparent bg-brand-500"
                                                    : "border-slate-300 dark:border-slate-600"
                                                }`}
                                              />
                                              {option.isDefined && definition && (
                                                <button
                                                  type="button"
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    handleTagSettingsToggle(definition.id);
                                                  }}
                                                  className={`rounded-full p-1 text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-200 ${
                                                    tagSettingsOpen === definition.id ? "text-slate-600 dark:text-slate-100" : ""
                                                  }`}
                                                >
                                                  <Cog6ToothIcon className="h-4 w-4" />
                                                </button>
                                              )}
                                            </div>
                                            {!option.isDefined || !definition ? (
                                              <div className="border-t border-dashed border-slate-200 px-2 py-2 text-[11px] text-slate-500 dark:border-slate-700">
                                                Define this tag to customize its visuals.
                                              </div>
                                            ) : tagSettingsOpen === definition.id ? (
                                              <div className="border-t border-slate-200 px-2 py-2 text-[11px] uppercase tracking-wide text-slate-500 dark:border-slate-700 dark:text-slate-400">
                                                <label className="flex flex-col gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                                                  Color
                                                  <select
                                                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-brand-400 dark:focus:ring-brand-500/40"
                                                    value={definition.colorKey ?? ""}
                                                    onChange={(event) => {
                                                      event.stopPropagation();
                                                      handleTagColorSelect(definition, event.target.value);
                                                    }}
                                                    disabled={!!tagStyleBusy[definition.id]}
                                                  >
                                                    <option value="">Auto</option>
                                                    {TAG_COLOR_STYLES.map((style) => (
                                                      <option key={style.key} value={style.key}>
                                                        {style.name}
                                                      </option>
                                                    ))}
                                                  </select>
                                                </label>
                                                <label className="mt-2 flex flex-col gap-1 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                                                  Shape
                                                  <select
                                                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:focus:border-brand-400 dark:focus:ring-brand-500/40"
                                                    value={definition.shape ?? ""}
                                                    onChange={(event) => {
                                                      event.stopPropagation();
                                                      handleTagShapeSelect(definition, event.target.value);
                                                    }}
                                                    disabled={!!tagStyleBusy[definition.id]}
                                                  >
                                                    <option value="">Auto</option>
                                                    {TAG_SHAPES.map((shape) => (
                                                      <option key={shape} value={shape}>
                                                        {shape.charAt(0).toUpperCase() + shape.slice(1)}
                                                      </option>
                                                    ))}
                                                  </select>
                                                </label>
                                                {tagStyleError[definition.id] && (
                                                  <p className="mt-2 text-[11px] normal-case text-rose-500">
                                                    {tagStyleError[definition.id]}
                                                  </p>
                                                )}
                                                <button
                                                  type="button"
                                                  className="mt-3 w-full rounded-full border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-500/60 dark:text-rose-300 dark:hover:bg-rose-500/20"
                                                  onClick={(event) => {
                                                    event.stopPropagation();
                                                    handleDeleteTagDefinition(definition);
                                                  }}
                                                  disabled={!!tagDeleteBusy[definition.id]}
                                                >
                                                  {tagDeleteBusy[definition.id] ? "Deleting…" : "Delete tag"}
                                                </button>
                                                {tagDeleteError[definition.id] && (
                                                  <p className="mt-1 text-[11px] normal-case text-rose-500">
                                                    {tagDeleteError[definition.id]}
                                                  </p>
                                                )}
                                              </div>
                                            ) : null}
                                          </div>
                                        );
                                      })
                                    )}
                                  </div>
                                  {canManageTags && (
                                    <div className="mt-3 space-y-2">
                                      {isAddTagFormVisible ? (
                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
                                          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                            New tag
                                          </p>
                                          <input
                                            type="text"
                                            value={newTagDraft.label}
                                            onChange={(event) => handleNewTagDraftChange("label", event.target.value)}
                                            placeholder="e.g. Outreach"
                                            className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-brand-400 dark:focus:ring-brand-500/40"
                                          />
                                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                                            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                              Color
                                              <select
                                                value={newTagDraft.colorKey}
                                                onChange={(event) => handleNewTagDraftChange("colorKey", event.target.value)}
                                                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-medium text-slate-700 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-brand-400 dark:focus:ring-brand-500/40"
                                              >
                                                {TAG_COLOR_STYLES.map((style) => (
                                                  <option key={style.key} value={style.key}>
                                                    {style.name}
                                                  </option>
                                                ))}
                                              </select>
                                            </label>
                                            <label className="flex flex-col gap-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                              Shape
                                              <select
                                                value={newTagDraft.shape}
                                                onChange={(event) => handleNewTagDraftChange("shape", event.target.value)}
                                                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-medium text-slate-700 outline-none focus:border-brand-300 focus:ring-2 focus:ring-brand-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-brand-400 dark:focus:ring-brand-500/40"
                                              >
                                                {TAG_SHAPES.map((shape) => (
                                                  <option key={shape} value={shape}>
                                                    {shape.charAt(0).toUpperCase() + shape.slice(1)}
                                                  </option>
                                                ))}
                                              </select>
                                            </label>
                                          </div>
                                          <div className="mt-3 flex flex-wrap gap-2">
                                            <button
                                              type="button"
                                              className="flex-1 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                handleCreateTagDefinition();
                                              }}
                                              disabled={tagCreateBusy}
                                            >
                                              {tagCreateBusy ? "Saving…" : "Save tag"}
                                            </button>
                                            <button
                                              type="button"
                                              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                                              onClick={(event) => {
                                                event.stopPropagation();
                                                handleCancelNewTag();
                                              }}
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                          {newTagError && (
                                            <p className="mt-2 text-xs text-rose-500">{newTagError}</p>
                                          )}
                                        </div>
                                      ) : (
                                        <button
                                          type="button"
                                          className="w-full rounded-full border border-dashed border-slate-300 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 transition hover:border-slate-400 hover:text-slate-700 dark:border-slate-600 dark:text-slate-300 dark:hover:border-slate-400 dark:hover:text-slate-100"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            handleShowAddTagForm();
                                          }}
                                        >
                                          + Add tag
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="w-full rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 disabled:opacity-60"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          handleClearTags(item);
                                        }}
                                        disabled={!!tagUpdateBusy[item.id]}
                                      >
                                        Clear all
                                      </button>
                                    </div>
                                  )}
                                  {tagUpdateError[item.id] && (
                                    <p className="mt-2 text-xs text-rose-500">{tagUpdateError[item.id]}</p>
                                  )}
                                </div>
                              )}
                              </div>
                            )}
                            {showEffortSection && (
                              <div className="relative" data-roadmap-edit-control="true">
                                {activeEffortEdit?.itemId === item.id ? (
                                  <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                                    <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
                                      Effort
                                    </span>
                                    <input
                                      autoFocus
                                      type="number"
                                      min="0"
                                      step="0.5"
                                      value={activeEffortEdit.value}
                                      onChange={(event) => handleEffortInputChange(event.target.value)}
                                      onKeyDown={(event) => handleEffortKeyDown(event, item)}
                                      onBlur={(event) => handleEffortBlur(event, item)}
                                      disabled={!!effortBusy[item.id]}
                                      className="w-16 bg-transparent text-right text-sm text-slate-700 outline-none dark:text-slate-100"
                                    />
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => handleStartEffortEdit(item)}
                                    disabled={!canEditEffort}
                                    className={`inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold uppercase tracking-wide transition dark:border-slate-700 ${
                                      canEditEffort
                                        ? "text-slate-600 hover:border-slate-400 hover:text-slate-800 dark:text-slate-200 dark:hover:border-slate-500"
                                        : "cursor-default text-slate-400 dark:text-slate-500"
                                    }`}
                                  >
                                    <span>Effort</span>
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-100">
                                      {hasEffortValue ? (
                                        <>
                                          {item.effort}
                                          <span className="ml-1 font-normal text-slate-400 dark:text-slate-500">HRS</span>
                                        </>
                                      ) : (
                                        "—"
                                      )}
                                    </span>
                                  </button>
                                )}
                                {effortError[item.id] && (
                                  <p className="mt-1 text-xs text-rose-500">{effortError[item.id]}</p>
                                )}
                              </div>
                            )}
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
                                ref={(textarea) => {
                                  textareaRefs.current[item.id] = textarea;
                                  if (textarea) {
                                    handleTextareaResize(textarea, item.id);
                                  }
                                }}
                                autoFocus
                                value={activeEdit?.value ?? ""}
                                onChange={(event) => {
                                  handleEditValueChange(event.target.value);
                                  handleTextareaResize(event.target, item.id);
                                }}
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
                              ref={(el) => {
                                descriptionRefs.current[item.id] = el;
                              }}
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
                              ref={(el) => {
                                descriptionRefs.current[item.id] = el;
                              }}
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
                      {!isExpanded && (
                        <div className="mt-auto flex items-center justify-between gap-4 pt-4">
                          {timeline ? (
                            <p className="text-xs text-slate-400 dark:text-slate-500">{timeline}</p>
                          ) : (
                            <span />
                          )}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleToggleExpand(item.id);
                            }}
                            className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500 transition hover:bg-slate-200 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-300 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-300"
                          >
                            {commentLabel}
                          </button>
                        </div>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="space-y-6 rounded-b-2xl border-t border-slate-200 bg-slate-50 px-4 pb-4 pt-4 dark:border-slate-800 dark:bg-slate-900/50">
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
                            placeholder="How would this help Oklahoma neighbors?"
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
                                {itemDeleteBusy[item.id] ? "Deleting…" : "Delete item"}
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
                                {commentBusy[item.id] ? "Sending…" : "Share"}
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
