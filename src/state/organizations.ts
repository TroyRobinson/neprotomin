import type { Organization } from "../types/organization";
import { db } from "../lib/db";
import { ensureOrganizationsSeeded } from "../lib/seed";

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

    try {
      this.unsubscribe = db.subscribeQuery(ORGANIZATIONS_QUERY, (resp) => {
        const rows = resp?.data?.organizations ?? [];
        const normalized: Organization[] = [];
        const allowedCategories = new Set<Organization["category"]>([
          "health",
          "education",
          "justice",
          "economy",
          "food",
        ]);
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
            if (!allowedCategories.has(categoryValue as Organization["category"])) {
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
              raw: rawValue,
            });
          }
        }

        this.data = normalized;
        this.emit();
      });
    } catch (error) {
      console.error("Failed to subscribe to organizations", error);
    }

    void ensureOrganizationsSeeded();
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

export const organizationStore = new OrganizationStore();
