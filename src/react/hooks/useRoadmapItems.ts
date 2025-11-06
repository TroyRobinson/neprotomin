import { useMemo } from "react";
import { db } from "../../lib/reactDb";
import { useAuthSession } from "./useAuthSession";
import type {
  RoadmapComment,
  RoadmapItemWithRelations,
  RoadmapVote,
  RoadmapStatus,
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
        votes,
        comments,
        viewerHasVoted,
        voteCount: votes.length,
        viewerVoteId,
      });
    }
    return output;
  }, [data?.roadmapItems, data?.roadmapItemVotes, data?.roadmapItemComments, viewerId]);

  return { items, isLoading, error, viewerId };
};
