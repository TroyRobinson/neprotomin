import { useMemo } from "react";
import { db } from "../../lib/reactDb";
import { useAuthSession } from "./useAuthSession";
import type {
  RoadmapComment,
  RoadmapItemWithRelations,
  RoadmapVote,
  RoadmapStatus,
  RoadmapTag,
} from "../../types/roadmap";

const isRoadmapStatus = (value: unknown): value is RoadmapStatus => {
  return (
    value === "suggested" ||
    value === "considering" ||
    value === "inProcess" ||
    value === "postponed" ||
    value === "completed"
  );
};

const normalizeTimestamp = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const BLOCKED_TAG_LABELS = new Set(["food map"]);
const isBlockedTagLabel = (label: string): boolean => {
  return BLOCKED_TAG_LABELS.has(label.trim().toLowerCase());
};

const normalizeNumberValue = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const normalizeEffortValue = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `${value}`;
  }
  return null;
};

const normalizeTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const tags: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed && !isBlockedTagLabel(trimmed)) {
      tags.push(trimmed);
    }
  }
  return tags;
};

const normalizeRoadmapTags = (rows: unknown): RoadmapTag[] => {
  if (!Array.isArray(rows)) return [];
  const output: RoadmapTag[] = [];
  for (const raw of rows) {
    if (!raw || typeof (raw as any).id !== "string" || typeof (raw as any).label !== "string") {
      continue;
    }
    const label = (raw as any).label.trim();
    if (!label || isBlockedTagLabel(label)) continue;
    const createdAt = normalizeTimestamp((raw as any).createdAt) ?? Date.now();
    output.push({
      id: (raw as any).id,
      label,
      colorKey: normalizeString((raw as any).colorKey),
      shape: normalizeString((raw as any).shape),
      order: normalizeNumberValue((raw as any).order),
      createdAt,
      updatedAt: normalizeTimestamp((raw as any).updatedAt),
      createdBy: normalizeString((raw as any).createdBy),
    });
  }
  output.sort((a, b) => {
    const orderA = a.order ?? Infinity;
    const orderB = b.order ?? Infinity;
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.label.localeCompare(b.label);
  });
  return output;
};

export const useRoadmapItems = () => {
  const { authReady } = useAuthSession();
  const authState = db.useAuth();
  const viewerId = authState.user?.id ?? null;

  const query = authReady
    ? {
        roadmapItems: {
          $: {
            order: { createdAt: "desc" as const },
          },
        },
        roadmapItemVotes: {
          $: {
          },
        },
        roadmapItemComments: {
          $: {
            order: { createdAt: "asc" as const },
          },
        },
        roadmapTags: {
          $: {
            order: { order: "asc" as const },
          },
        },
      }
    : null;

  const { data, isLoading, error } = db.useQuery(query);

  const items = useMemo<RoadmapItemWithRelations[]>(() => {
    const rows = data?.roadmapItems ?? [];
    const votesRows = Array.isArray(data?.roadmapItemVotes) ? (data!.roadmapItemVotes as any[]) : [];
    const commentsRows = Array.isArray(data?.roadmapItemComments)
      ? (data!.roadmapItemComments as any[])
      : [];

    const votesByItem = new Map<string, RoadmapVote[]>();
    for (const raw of votesRows) {
      if (!raw || typeof raw.id !== "string") continue;
      const roadmapItemId = normalizeString(raw.roadmapItemId) ?? "";
      const voterId = normalizeString(raw.voterId) ?? "";
      if (!roadmapItemId || !voterId) continue;
      const vote: RoadmapVote = {
        id: raw.id,
        roadmapItemId,
        voterId,
        createdAt: normalizeTimestamp(raw.createdAt) ?? 0,
      };
      const bucket = votesByItem.get(roadmapItemId);
      if (bucket) {
        bucket.push(vote);
      } else {
        votesByItem.set(roadmapItemId, [vote]);
      }
    }

    const commentsByItem = new Map<string, RoadmapComment[]>();
    for (const raw of commentsRows) {
      if (!raw || typeof raw.id !== "string" || typeof raw.body !== "string") continue;
      const roadmapItemId = normalizeString(raw.roadmapItemId) ?? "";
      const authorId = normalizeString(raw.authorId) ?? "";
      if (!roadmapItemId || !authorId) continue;
      const comment: RoadmapComment = {
        id: raw.id,
        roadmapItemId,
        authorId,
        authorName: normalizeString(raw.authorName),
        body: raw.body,
        createdAt: normalizeTimestamp(raw.createdAt) ?? 0,
        updatedAt: normalizeTimestamp(raw.updatedAt),
      };
      const bucket = commentsByItem.get(roadmapItemId);
      if (bucket) {
        bucket.push(comment);
      } else {
        commentsByItem.set(roadmapItemId, [comment]);
      }
    }

    const output: RoadmapItemWithRelations[] = [];
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || typeof row.title !== "string") {
        continue;
      }

      const status = isRoadmapStatus((row as any).status) ? ((row as any).status as RoadmapStatus) : "suggested";
      const createdBy = normalizeString((row as any).createdBy);
      const votes = votesByItem.get(row.id) ?? [];
      const comments = commentsByItem.get(row.id) ?? [];

      const createdAt = normalizeTimestamp((row as any).createdAt) ?? 0;
      const statusChangedAt = normalizeTimestamp((row as any).statusChangedAt);
      const targetCompletionAt = normalizeTimestamp((row as any).targetCompletionAt);
      const order = normalizeTimestamp((row as any).order);
      const imageUrl =
        typeof (row as any).imageUrl === "string" ? ((row as any).imageUrl as string) : null;
      const description =
        typeof (row as any).description === "string" ? ((row as any).description as string) : null;
      const tags = normalizeTags((row as any).tags);
      const effort = normalizeEffortValue((row as any).effort);

      const viewerHasVoted =
        !!viewerId && votes.some((vote) => vote.voterId === viewerId);
      const viewerVoteId =
        !!viewerId ? votes.find((vote) => vote.voterId === viewerId)?.id ?? null : null;

      output.push({
        id: row.id,
        title: row.title,
        description,
        status,
        createdAt,
        statusChangedAt,
        targetCompletionAt,
        imageUrl,
        createdBy,
        order,
        tags: tags.length > 0 ? tags : null,
        effort,
        votes,
        comments,
        viewerHasVoted,
        voteCount: votes.length,
        viewerVoteId,
      });
    }
    return output;
  }, [data?.roadmapItems, data?.roadmapItemVotes, data?.roadmapItemComments, viewerId]);

  const tags = useMemo<RoadmapTag[]>(() => normalizeRoadmapTags(data?.roadmapTags ?? []), [data?.roadmapTags]);

  return { items, tags, isLoading, error, viewerId };
};
