import type { Organization } from "../types/organization";
import { db } from "../lib/db";
import { ensureOrganizationsSeeded } from "../lib/seed";
import { categoriesStore, type CategoryRow } from "./categories";

const ORGANIZATIONS_QUERY = {
  organizations: {
    $: {
      order: { name: "asc" as const },
    },
  },
};

type Listener = (organizations: Organization[]) => void;

class OrganizationStore {
  private listeners = new Set<Listener>();
  private data: Organization[] = [];
  private unsubscribe: (() => void) | null = null;
  private unsubscribeCategories: (() => void) | null = null;
  private orgCategories: CategoryRow[] = [];
  private rawOrganizations: any[] = [];

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.data);
    this.initialize();

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.teardown();
      }
    };
  }

  private initialize() {
    if (this.unsubscribe) {
      return;
    }

    // Subscribe to categories store for org categories
    this.unsubscribeCategories = categoriesStore.subscribe((rows) => {
      this.orgCategories = rows.filter((c) => c.forOrgs);
      this.processOrganizations();
    });

    try {
      this.unsubscribe = db.subscribeQuery(ORGANIZATIONS_QUERY, (resp) => {
        if (!resp.data) return;
        this.rawOrganizations = resp?.data?.organizations ?? [];
        this.processOrganizations();
      });
    } catch (error) {
      console.error("Failed to subscribe to organizations", error);
    }

    void ensureOrganizationsSeeded();
  }

  private processOrganizations() {
    const rows = this.rawOrganizations;
    const normalized: Organization[] = [];
    // Build allowed categories from categoriesStore (categories with forOrgs: true)
    // If categories haven't loaded yet, allow all categories through
    const allowedCategories = new Set<string>(this.orgCategories.map((c) => c.slug));
    const hasCategories = allowedCategories.size > 0;
    const allowedStatuses: Organization["status"][] = ["active", "moved", "closed"];

    for (const org of rows) {
      if (
        org?.id &&
        typeof org.name === "string" &&
        typeof org.latitude === "number" &&
        typeof org.longitude === "number" &&
        typeof (org as any).category === "string"
      ) {
        const categoryValue = (org as any).category as string;
        // Only filter by category if categories have loaded; otherwise allow all
        if (hasCategories && !allowedCategories.has(categoryValue)) {
          continue;
        }

        const rawModeration =
          typeof (org as any).moderationStatus === "string"
            ? ((org as any).moderationStatus as string).toLowerCase()
            : null;
        const moderationStatus =
          rawModeration && ["pending", "approved", "declined", "removed"].includes(rawModeration)
            ? (rawModeration as Organization["moderationStatus"])
            : null;
        if (moderationStatus === "pending" || moderationStatus === "declined" || moderationStatus === "removed") {
          continue;
        }

        const rawStatus =
          typeof (org as any).status === "string"
            ? ((org as any).status as string).toLowerCase()
            : null;
        const statusValue =
          rawStatus && allowedStatuses.includes(rawStatus as Organization["status"])
            ? (rawStatus as Organization["status"])
            : null;

        const rawValue =
          typeof (org as any).raw === "object" && (org as any).raw !== null
            ? ((org as any).raw as Record<string, unknown>)
            : null;

        normalized.push({
          id: org.id,
          name: org.name,
          latitude: org.latitude,
          longitude: org.longitude,
          category: categoryValue as Organization["category"],
          website:
            typeof (org as any).website === "string" ? ((org as any).website as string) : null,
          address:
            typeof (org as any).address === "string" ? ((org as any).address as string) : null,
          city: typeof (org as any).city === "string" ? ((org as any).city as string) : null,
          state: typeof (org as any).state === "string" ? ((org as any).state as string) : null,
          postalCode:
            typeof (org as any).postalCode === "string"
              ? ((org as any).postalCode as string)
              : null,
          phone: typeof (org as any).phone === "string" ? ((org as any).phone as string) : null,
          hours: (org as any).hours ?? null,
          placeId:
            typeof (org as any).placeId === "string" ? ((org as any).placeId as string) : null,
          source:
            typeof (org as any).source === "string" ? ((org as any).source as string) : null,
          googleCategory:
            typeof (org as any).googleCategory === "string"
              ? ((org as any).googleCategory as string)
              : null,
          keywordFound:
            typeof (org as any).keywordFound === "string"
              ? ((org as any).keywordFound as string)
              : null,
          status: statusValue,
          lastSyncedAt:
            typeof (org as any).lastSyncedAt === "number"
              ? ((org as any).lastSyncedAt as number)
              : null,
          moderationStatus,
          moderationChangedAt:
            typeof (org as any).moderationChangedAt === "number"
              ? ((org as any).moderationChangedAt as number)
              : null,
          submittedAt:
            typeof (org as any).submittedAt === "number"
              ? ((org as any).submittedAt as number)
              : null,
          queueSortKey:
            typeof (org as any).queueSortKey === "number"
              ? ((org as any).queueSortKey as number)
              : null,
          issueCount:
            typeof (org as any).issueCount === "number"
              ? ((org as any).issueCount as number)
              : null,
          annualRevenue:
            typeof (org as any).annualRevenue === "number"
              ? ((org as any).annualRevenue as number)
              : null,
          annualRevenueTaxPeriod:
            typeof (org as any).annualRevenueTaxPeriod === "number"
              ? ((org as any).annualRevenueTaxPeriod as number)
              : null,
          raw: rawValue,
        });
      }
    }

    this.data = normalized;
    this.emit();
  }

  private teardown() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.unsubscribeCategories) {
      this.unsubscribeCategories();
      this.unsubscribeCategories = null;
    }
  }

  private emit() {
    this.listeners.forEach((listener) => listener(this.data));
  }
}

export const organizationStore = new OrganizationStore();
