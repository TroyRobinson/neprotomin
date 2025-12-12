import type { Category } from "./organization";

export interface Stat {
  id: string;
  name: string;
  label?: string; // Human-friendly display label (use instead of name when available)
  category: Category;
  goodIfUp?: boolean;
  featured?: boolean;
  homeFeatured?: boolean;
  active?: boolean;
}

export interface StatRelation {
  id: string;
  relationKey: string;
  parentStatId: string;
  childStatId: string;
  statAttribute: string;
  sortOrder?: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}

/**
 * Sentinel attribute for child stats that should be hidden from the sidebar UI.
 * Admin UI renders this as "Undefined".
 */
export const UNDEFINED_STAT_ATTRIBUTE = "__undefined__";

export type StatRelationsByParent = Map<
  string,
  Map<string, Array<StatRelation & { child: Stat | null }>>
>;

export type StatRelationsByChild = Map<string, Array<StatRelation>>;

/** Get display name for a stat (label if available, otherwise name) */
export const getStatDisplayName = (stat: Stat): string => stat.label || stat.name;
