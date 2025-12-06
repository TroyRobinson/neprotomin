/**
 * React hook for fetching and filtering categories from InstantDB.
 * Single source of truth for category options across React components.
 */
import { useMemo } from "react";
import { db } from "../../lib/reactDb";
import type { Category } from "../../types/organization";

export interface CategoryRow {
  id: string;
  slug: Category;
  label: string;
  sortOrder: number;
  active: boolean;
  forStats: boolean;
  forOrgs: boolean;
  showOnMap: boolean;
  showInSidebar: boolean;
}

export interface UseCategoriesResult {
  /** All active categories, sorted by sortOrder */
  allCategories: CategoryRow[];
  /** Categories allowed for stats (forStats: true) */
  statCategories: CategoryRow[];
  /** Categories allowed for organizations (forOrgs: true) */
  orgCategories: CategoryRow[];
  /** Categories to show as map chips (showOnMap: true) */
  mapCategories: CategoryRow[];
  /** Categories to show in sidebar filter (showInSidebar: true) */
  sidebarCategories: CategoryRow[];
  /** Helper: get label for a category slug */
  getCategoryLabel: (slug: Category | string) => string;
  /** Loading state */
  isLoading: boolean;
  /** Error state */
  error: { message: string } | null;
}

export function useCategories(): UseCategoriesResult {
  const { data, isLoading, error } = db.useQuery({
    categories: {
      $: {
        where: { active: true },
        order: { sortOrder: "asc" as const },
      },
    },
  });

  const allCategories = useMemo(() => {
    if (!data?.categories) return [];

    const rows: CategoryRow[] = [];
    for (const row of data.categories) {
      if (!row?.id || typeof row.slug !== "string") continue;
      rows.push({
        id: row.id,
        slug: row.slug as Category,
        label: typeof row.label === "string" ? row.label : row.slug,
        sortOrder: typeof row.sortOrder === "number" ? row.sortOrder : 999,
        active: row.active !== false,
        forStats: row.forStats === true,
        forOrgs: row.forOrgs === true,
        showOnMap: row.showOnMap === true,
        showInSidebar: row.showInSidebar === true,
      });
    }
    return rows;
  }, [data?.categories]);

  const statCategories = useMemo(
    () => allCategories.filter((c) => c.forStats),
    [allCategories]
  );

  const orgCategories = useMemo(
    () => allCategories.filter((c) => c.forOrgs),
    [allCategories]
  );

  const mapCategories = useMemo(
    () => allCategories.filter((c) => c.showOnMap),
    [allCategories]
  );

  const sidebarCategories = useMemo(
    () => allCategories.filter((c) => c.showInSidebar),
    [allCategories]
  );

  const getCategoryLabel = useMemo(() => {
    const labelMap = new Map<string, string>();
    for (const cat of allCategories) {
      labelMap.set(cat.slug, cat.label);
    }
    return (slug: Category | string): string => labelMap.get(slug) ?? slug;
  }, [allCategories]);

  return {
    allCategories,
    statCategories,
    orgCategories,
    mapCategories,
    sidebarCategories,
    getCategoryLabel,
    isLoading,
    error: error ?? null,
  };
}
