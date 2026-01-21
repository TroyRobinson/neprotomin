import type { Category } from "./organization";

export interface Stat {
  id: string;
  name: string;
  label?: string; // Human-friendly display label (use instead of name when available)
  category: Category;
  goodIfUp?: boolean;
  featured?: boolean;
  homeFeatured?: boolean;
  /** Visibility state; null/undefined means "inherit from parent" (or default public for root stats). */
  visibility?: StatVisibility | null;
  /** Effective visibility after inheritance resolution. */
  visibilityEffective?: StatVisibility | null;
  /** Owner auth.id for private/inactive stats. */
  createdBy?: string | null;
  /** Legacy active flag (deprecated; treated as inactive when false and visibility is unset). */
  active?: boolean;
  type?: string; // Optional type override (e.g., "currency", "percent")
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

export type StatVisibility = "inactive" | "private" | "public";

const VISIBILITY_VALUES = new Set<StatVisibility>(["inactive", "private", "public"]);

export const normalizeStatVisibility = (value: unknown): StatVisibility | null => {
  if (typeof value !== "string") return null;
  return VISIBILITY_VALUES.has(value as StatVisibility) ? (value as StatVisibility) : null;
};

export type EffectiveStatMeta = {
  visibility: StatVisibility;
  ownerId: string | null;
};

const resolveOwner = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const buildEffectiveStatMetaById = (
  statsById: Map<string, Stat>,
  parentsByChild: Map<string, string[]>,
): Map<string, EffectiveStatMeta> => {
  const cache = new Map<string, EffectiveStatMeta>();
  const visiting = new Set<string>();

  const resolveMeta = (statId: string): EffectiveStatMeta => {
    const cached = cache.get(statId);
    if (cached) return cached;
    if (visiting.has(statId)) {
      return { visibility: "public", ownerId: null };
    }
    visiting.add(statId);

    const stat = statsById.get(statId);
    const declaredVisibility = normalizeStatVisibility(stat?.visibility);
    const declaredOwner = resolveOwner(stat?.createdBy);

    let visibility = declaredVisibility;
    let ownerId = declaredOwner;

    if (!visibility && stat?.active === false) {
      visibility = "inactive";
    }

    if (!visibility || !ownerId) {
      const parents = parentsByChild.get(statId) ?? [];
      for (const parentId of parents) {
        const parentMeta = resolveMeta(parentId);
        if (!visibility) visibility = parentMeta.visibility;
        if (!ownerId) ownerId = parentMeta.ownerId;
        if (visibility && ownerId) break;
      }
    }

    if (!visibility) visibility = "public";

    const meta = { visibility, ownerId };
    cache.set(statId, meta);
    visiting.delete(statId);
    return meta;
  };

  for (const statId of statsById.keys()) {
    resolveMeta(statId);
  }

  return cache;
};

export const isStatVisibleOnMap = (
  meta: EffectiveStatMeta,
  viewer: { isAdmin: boolean; viewerId?: string | null },
): boolean => {
  if (meta.visibility === "inactive") return false;
  if (meta.visibility === "public") return true;
  if (viewer.isAdmin) return true;
  if (!viewer.viewerId) return false;
  return meta.ownerId === viewer.viewerId;
};

export const canViewStatInSettings = (
  meta: EffectiveStatMeta,
  viewer: { isAdmin: boolean; viewerId?: string | null },
): boolean => {
  if (viewer.isAdmin) return true;
  if (meta.visibility === "public") return true;
  if (!viewer.viewerId) return false;
  return meta.ownerId === viewer.viewerId;
};
