import { id as createId } from "@instantdb/react";
import { db } from "../../lib/reactDb";
import type { RoadmapStatus } from "../../types/roadmap";

export const addRoadmapVote = async (roadmapItemId: string, voterId: string): Promise<void> => {
  if (!roadmapItemId || !voterId) {
    throw new Error("Roadmap vote requires roadmapItemId and voterId.");
  }

  await db.transact(
    db.tx.roadmapItemVotes[createId()].update({
      roadmapItemId,
      voterId,
      createdAt: Date.now(),
    }),
  );
};

export const removeRoadmapVote = async (voteId: string): Promise<void> => {
  if (!voteId) {
    throw new Error("Missing voteId for removal.");
  }
  await db.transact(db.tx.roadmapItemVotes[voteId].delete());
};

export const addRoadmapComment = async (
  roadmapItemId: string,
  authorId: string,
  body: string,
  authorName?: string | null,
): Promise<void> => {
  if (!roadmapItemId || !authorId || !body.trim()) {
    throw new Error("Comment requires roadmapItemId, authorId, and non-empty body.");
  }

  await db.transact(
    db.tx.roadmapItemComments[createId()].update({
      roadmapItemId,
      authorId,
      authorName: authorName ?? null,
      body: body.trim(),
      createdAt: Date.now(),
    }),
  );
};

export const removeRoadmapComment = async (commentId: string): Promise<void> => {
  if (!commentId) {
    throw new Error("Missing commentId for removal.");
  }
  await db.transact(db.tx.roadmapItemComments[commentId].delete());
};

export const createRoadmapItem = async ({
  title,
  description,
  status = "suggested",
  createdBy,
  targetCompletionAt = null,
  imageUrl = null,
}: {
  title: string;
  description?: string | null;
  status?: RoadmapStatus;
  createdBy: string;
  targetCompletionAt?: number | null;
  imageUrl?: string | null;
}): Promise<string> => {
  if (!createdBy) {
    throw new Error("Roadmap item requires creator id.");
  }
  const newId = createId();
  const trimmedTitle = title.trim() || "Untitled roadmap item";
  const now = Date.now();
  await db.transact(
    db.tx.roadmapItems[newId].update({
      title: trimmedTitle,
      description: description?.trim() ? description.trim() : null,
      status,
      createdAt: now,
      statusChangedAt: now,
      targetCompletionAt: targetCompletionAt ?? null,
      imageUrl: imageUrl ?? null,
      createdBy,
    }),
  );
  return newId;
};

export const updateRoadmapItem = async (
  itemId: string,
  patch: Partial<{
    title: string;
    description: string | null;
    status: RoadmapStatus;
    targetCompletionAt: number | null;
    imageUrl: string | null;
    order: number | null;
  }>,
): Promise<void> => {
  if (!itemId) {
    throw new Error("Missing roadmap item id.");
  }
  if (!patch || Object.keys(patch).length === 0) {
    return;
  }
  const payload: Record<string, unknown> = {};
  if (patch.title !== undefined) {
    payload.title = patch.title;
  }
  if (patch.description !== undefined) {
    payload.description = patch.description;
  }
  if (patch.status !== undefined) {
    payload.status = patch.status;
    payload.statusChangedAt = Date.now();
  }
  if (patch.targetCompletionAt !== undefined) {
    payload.targetCompletionAt = patch.targetCompletionAt;
  }
  if (patch.imageUrl !== undefined) {
    payload.imageUrl = patch.imageUrl;
  }
  if (patch.order !== undefined) {
    payload.order = patch.order;
  }
  if (Object.keys(payload).length === 0) return;
  await db.transact(db.tx.roadmapItems[itemId].update(payload));
};

export const updateRoadmapItemOrder = async (
  itemId: string,
  order: number | null,
): Promise<void> => {
  if (!itemId) {
    throw new Error("Missing roadmap item id.");
  }
  await db.transact(
    db.tx.roadmapItems[itemId].update({
      order: order ?? null,
    }),
  );
};

export const updateRoadmapItemsOrder = async (
  updates: Array<{ itemId: string; order: number | null }>,
): Promise<void> => {
  if (!updates || updates.length === 0) {
    return;
  }
  const txs = updates.map(({ itemId, order }) =>
    db.tx.roadmapItems[itemId].update({ order: order ?? null }),
  );
  await db.transact(txs);
};

export const deleteRoadmapItem = async (itemId: string): Promise<void> => {
  if (!itemId) {
    throw new Error("Missing roadmap item id.");
  }

  const { data } = await db.queryOnce({
    roadmapItemVotes: {
      $: {
        where: { roadmapItemId: itemId },
        fields: ["id"],
      },
    },
    roadmapItemComments: {
      $: {
        where: { roadmapItemId: itemId },
        fields: ["id"],
      },
    },
  });

  const txs: any[] = [];
  const voteRows = Array.isArray(data?.roadmapItemVotes) ? (data!.roadmapItemVotes as any[]) : [];
  for (const vote of voteRows) {
    if (vote?.id) {
      txs.push(db.tx.roadmapItemVotes[vote.id as string].delete());
    }
  }

  const commentRows = Array.isArray(data?.roadmapItemComments)
    ? (data!.roadmapItemComments as any[])
    : [];
  for (const comment of commentRows) {
    if (comment?.id) {
      txs.push(db.tx.roadmapItemComments[comment.id as string].delete());
    }
  }

  txs.push(db.tx.roadmapItems[itemId].delete());
  await db.transact(txs);
};

