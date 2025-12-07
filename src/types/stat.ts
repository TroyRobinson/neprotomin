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

/** Get display name for a stat (label if available, otherwise name) */
export const getStatDisplayName = (stat: Stat): string => stat.label || stat.name;
