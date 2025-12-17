export type ImportStatus = "pending" | "running" | "success" | "error";

export type ImportRelationship = "none" | "child" | "parent";

export interface ImportQueueItem {
  id: string;
  dataset: string;
  group: string;
  variable: string;
  year: number;
  years: number;
  includeMoe: boolean;
  relationship?: ImportRelationship;
  statAttribute?: string;
  importedStatId?: string;
  status: ImportStatus;
  errorMessage?: string;
}
