/**
 * Non-React store for categories, used by imperative/vanilla code (e.g., categoryChips.ts).
 * Mirrors the useCategories hook but for non-React contexts.
 */
import { db } from "../lib/db";
import type { Category } from "../types/organization";

const CATEGORIES_QUERY = {
  categories: {
    $: {
      where: { active: true },
      order: { sortOrder: "asc" as const },
    },
  },
};

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

type Listener = (categories: CategoryRow[]) => void;

class CategoriesStore {
  private listeners = new Set<Listener>();
  private data: CategoryRow[] = [];
  private unsubscribe: (() => void) | null = null;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.data);
    this.initialize();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.teardown();
    };
  }

  /** Get current categories (snapshot) */
  getAll(): CategoryRow[] {
    return this.data;
  }

  /** Get categories for map chips (showOnMap: true) */
  getMapCategories(): CategoryRow[] {
    return this.data.filter((c) => c.showOnMap);
  }

  /** Get categories for orgs (forOrgs: true) */
  getOrgCategories(): CategoryRow[] {
    return this.data.filter((c) => c.forOrgs);
  }

  /** Get categories for stats (forStats: true) */
  getStatCategories(): CategoryRow[] {
    return this.data.filter((c) => c.forStats);
  }

  /** Get categories for sidebar (showInSidebar: true) */
  getSidebarCategories(): CategoryRow[] {
    return this.data.filter((c) => c.showInSidebar);
  }

  /** Get label for a category slug */
  getLabel(slug: Category | string): string {
    const found = this.data.find((c) => c.slug === slug);
    return found ? found.label : slug;
  }

  private initialize() {
    if (this.unsubscribe) return;
    try {
      this.unsubscribe = db.subscribeQuery(CATEGORIES_QUERY, (resp) => {
        if (!resp.data) return;
        const rows = resp?.data?.categories ?? ([] as any[]);
        const normalized: CategoryRow[] = [];
        for (const row of rows) {
          if (!row?.id || typeof row.slug !== "string") continue;
          normalized.push({
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
        this.data = normalized;
        this.emit();
      });
    } catch (error) {
      console.error("Failed to subscribe to categories", error);
    }
  }

  private teardown() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private emit() {
    this.listeners.forEach((listener) => listener(this.data));
  }
}

export const categoriesStore = new CategoriesStore();
