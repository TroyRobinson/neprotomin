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
  tags = [],
  effort = null,
}: {
  title: string;
  description?: string | null;
  status?: RoadmapStatus;
  createdBy: string;
  targetCompletionAt?: number | null;
  imageUrl?: string | null;
  tags?: string[] | null;
  effort?: string | null;
}): Promise<string> => {
  if (!createdBy) {
    throw new Error("Roadmap item requires creator id.");
  }
  
  // Query existing items to get their orders
  const { data } = await db.queryOnce({
    roadmapItems: {
      $: {
        fields: ["id", "order"],
      },
    },
  });
  
  const existingItems = Array.isArray(data?.roadmapItems) ? (data!.roadmapItems as any[]) : [];
  
  // Prepare transactions: create new item with order 1, and increment all existing orders
  const newId = createId();
  const trimmedTitle = title.trim() || "Untitled roadmap item";
  const now = Date.now();
  
  const normalizedEffort =
    typeof effort === "string" ? effort.trim() || null : effort ?? null;
  const txs: any[] = [
    // Create new item with order 1 (top priority)
    db.tx.roadmapItems[newId].update({
      title: trimmedTitle,
      description: description?.trim() ? description.trim() : null,
      status,
      createdAt: now,
      statusChangedAt: now,
      targetCompletionAt: targetCompletionAt ?? null,
      imageUrl: imageUrl ?? null,
      createdBy,
      order: 1,
      tags: Array.isArray(tags) ? tags : [],
      effort: normalizedEffort,
    }),
  ];
  
  // Increment order for all existing items that have an order
  for (const item of existingItems) {
    if (item?.id && typeof item.order === "number" && Number.isFinite(item.order)) {
      txs.push(
        db.tx.roadmapItems[item.id].update({
          order: item.order + 1,
        }),
      );
    }
  }
  
  await db.transact(txs);
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
    tags: string[] | null;
    effort: string | null;
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
  if (patch.tags !== undefined) {
    payload.tags = Array.isArray(patch.tags) ? patch.tags : patch.tags ?? null;
  }
  if (patch.effort !== undefined) {
    const normalized =
      typeof patch.effort === "string"
        ? patch.effort.trim() || null
        : patch.effort ?? null;
    payload.effort = normalized;
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

export const createRoadmapTag = async ({
  label,
  colorKey = null,
  shape = null,
  createdBy = null,
}: {
  label: string;
  colorKey?: string | null;
  shape?: string | null;
  createdBy?: string | null;
}): Promise<string> => {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) {
    throw new Error("Tag label is required.");
  }
  const { data } = await db.queryOnce({
    roadmapTags: {
      $: {
        fields: ["id", "order"],
      },
    },
  });
  const existingTags = Array.isArray(data?.roadmapTags) ? (data!.roadmapTags as any[]) : [];
  let maxOrder = 0;
  for (const tag of existingTags) {
    const value = typeof tag?.order === "number" && Number.isFinite(tag.order) ? tag.order : null;
    if (value && value > maxOrder) {
      maxOrder = value;
    }
  }
  const nextOrder = maxOrder + 1;
  const newId = createId();
  const now = Date.now();
  await db.transact(
    db.tx.roadmapTags[newId].update({
      label: trimmedLabel,
      colorKey: colorKey ?? null,
      shape: shape ?? null,
      order: nextOrder,
      createdAt: now,
      updatedAt: now,
      createdBy: createdBy ?? null,
    }),
  );
  return newId;
};

export const updateRoadmapTag = async (
  tagId: string,
  patch: Partial<{ label: string; colorKey: string | null; shape: string | null }>,
): Promise<void> => {
  if (!tagId) {
    throw new Error("Missing roadmap tag id.");
  }
  if (!patch || Object.keys(patch).length === 0) return;
  const payload: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    const trimmed = patch.label?.trim() ?? "";
    if (!trimmed) {
      throw new Error("Tag label cannot be empty.");
    }
    payload.label = trimmed;
  }
  if (patch.colorKey !== undefined) {
    payload.colorKey = patch.colorKey ?? null;
  }
  if (patch.shape !== undefined) {
    payload.shape = patch.shape ?? null;
  }
  if (Object.keys(payload).length === 0) return;
  payload.updatedAt = Date.now();
  await db.transact(db.tx.roadmapTags[tagId].update(payload));
};

export const renameRoadmapTag = async (
  tagId: string,
  oldLabel: string,
  newLabel: string,
): Promise<void> => {
  if (!tagId) throw new Error("Missing roadmap tag id.");
  const trimmed = newLabel.trim();
  if (!trimmed) throw new Error("Tag label cannot be empty.");
  const previous = oldLabel.trim();
  if (!previous) throw new Error("Original label is required.");

  const { data } = await db.queryOnce({
    roadmapItems: {
      $: {
        fields: ["id", "tags"],
      },
    },
  });

  const txs: any[] = [
    db.tx.roadmapTags[tagId].update({ label: trimmed, updatedAt: Date.now() }),
  ];

  const items = Array.isArray(data?.roadmapItems) ? (data!.roadmapItems as any[]) : [];
  for (const item of items) {
    if (!item?.id || !Array.isArray(item.tags)) continue;
    const tags = item.tags.filter((value: unknown): value is string => typeof value === "string");
    if (tags.length === 0) continue;
    let changed = false;
    const next = tags.map((value: string) => {
      if (typeof value === "string" && value.trim() === previous) {
        changed = true;
        return trimmed;
      }
      return value;
    });
    if (changed) {
      txs.push(
        db.tx.roadmapItems[item.id as string].update({
          tags: next,
        }),
      );
    }
  }

  await db.transact(txs);
};

export const deleteRoadmapTag = async (tagId: string): Promise<void> => {
  if (!tagId) {
    throw new Error("Missing roadmap tag id.");
  }

  const { data } = await db.queryOnce({
    roadmapTags: {
      $: {
        where: { id: tagId },
        fields: ["id", "label"],
      },
    },
    roadmapItems: {
      $: {
        fields: ["id", "tags"],
      },
    },
  });

  const tagRow = Array.isArray(data?.roadmapTags) ? data!.roadmapTags[0] : null;
  if (!tagRow) {
    return;
  }
  const label = typeof tagRow.label === "string" ? tagRow.label.trim() : "";
  const txs: any[] = [db.tx.roadmapTags[tagId].delete()];

  if (label) {
    const itemRows = Array.isArray(data?.roadmapItems) ? (data!.roadmapItems as any[]) : [];
    for (const item of itemRows) {
      if (!item?.id) continue;
      const tags = Array.isArray(item.tags)
        ? (item.tags as unknown[]).filter((value): value is string => typeof value === "string")
        : [];
      if (tags.length === 0) continue;
      const nextTags = tags.filter((value) => value !== label);
      if (nextTags.length === tags.length) continue;
      txs.push(
        db.tx.roadmapItems[item.id as string].update({
          tags: nextTags.length > 0 ? nextTags : [],
        }),
      );
    }
  }

  await db.transact(txs);
};

export const updateRoadmapTagsOrder = async (
  updates: Array<{ tagId: string; order: number }>,
): Promise<void> => {
  if (!updates || updates.length === 0) {
    return;
  }
  const txs = updates.map(({ tagId, order }) =>
    db.tx.roadmapTags[tagId].update({ order }),
  );
  await db.transact(txs);
};
