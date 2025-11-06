export type RoadmapStatus = "suggested" | "considering" | "inProcess" | "postponed" | "completed";

export interface RoadmapItem {
  id: string;
  title: string;
  description?: string | null;
  status: RoadmapStatus;
  createdAt: number;
  statusChangedAt?: number | null;
  targetCompletionAt?: number | null;
  imageUrl?: string | null;
  createdBy?: string | null;
  order?: number | null;
}

export interface RoadmapVote {
  id: string;
  roadmapItemId: string;
  voterId: string;
  createdAt: number;
}

export interface RoadmapComment {
  id: string;
  roadmapItemId: string;
  authorId: string;
  authorName?: string | null;
  body: string;
  createdAt: number;
  updatedAt?: number | null;
}

export interface RoadmapItemWithRelations extends RoadmapItem {
  votes: RoadmapVote[];
  comments: RoadmapComment[];
  viewerHasVoted: boolean;
  voteCount: number;
  viewerVoteId?: string | null;
}
