export interface CommentContext {
  userAgent?: string | null;
  referer?: string | null;
  pageUrl?: string | null;
  locale?: string | null;
}

export interface Comment {
  id: string;
  orgId: string;
  orgName: string;
  text: string;
  source: string;
  reporterId?: string | null;
  reporterEmail?: string | null;
  reporterKey?: string | null;
  reporterIsAdmin?: boolean | null;
  ipHash?: string | null;
  createdAt: number;
  context?: CommentContext | null;
}
