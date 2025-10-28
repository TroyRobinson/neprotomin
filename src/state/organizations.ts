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
        const normalized: Organization[] = rows
          .filter((org): org is Organization =>
            Boolean(
              org?.id &&
                org?.name &&
                org?.url &&
                typeof org?.latitude === "number" &&
                typeof org?.longitude === "number" &&
                typeof (org as any)?.category === "string",
            ),
          )
          .map((org) => ({
            id: org.id,
            name: org.name,
            url: org.url,
            latitude: org.latitude,
            longitude: org.longitude,
            category: (org as any).category,
          }));

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
