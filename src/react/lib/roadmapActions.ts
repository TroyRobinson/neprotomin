import { id as createId } from "@instantdb/react";
import { db } from "../../lib/reactDb";

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

