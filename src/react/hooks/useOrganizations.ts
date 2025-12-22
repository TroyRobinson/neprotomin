import { useMemo } from "react";
import { db } from "../../lib/reactDb";
import { useAuthSession } from "./useAuthSession";
import { useCategories } from "./useCategories";
import type {
  Organization,
  OrganizationStatus,
  OrganizationModerationStatus,
} from "../../types/organization";

export const useOrganizations = () => {
  const { authReady } = useAuthSession();
  const { orgCategories } = useCategories();
  const queryEnabled = authReady;

  // Wait for auth to be ready to avoid race conditions (especially in Safari)
  const { data, isLoading, error } = db.useQuery(
    queryEnabled
      ? {
          organizations: {
            $: {
              fields: [
                "id",
                "name",
                "ownerEmail",
                "latitude",
                "longitude",
                "category",
                "website",
                "address",
                "city",
                "state",
                "postalCode",
                "phone",
                "hours",
                "placeId",
                "source",
                "googleCategory",
                "keywordFound",
                "status",
                "lastSyncedAt",
                "moderationStatus",
                "moderationChangedAt",
                "submittedAt",
                "queueSortKey",
                "issueCount",
              ],
              order: { name: "asc" as const },
            },
          },
        }
      : null,
  );

  const organizations = useMemo<Organization[]>(() => {
    const rows = data?.organizations ?? [];
    const list: Organization[] = [];
    // Build allowed categories from DB (categories with forOrgs: true)
    // If categories haven't loaded yet, allow all categories through
    const allowedCategories = new Set<string>(orgCategories.map((c) => c.slug));
    const hasCategories = allowedCategories.size > 0;
    const allowedStatuses: OrganizationStatus[] = ["active", "moved", "closed"];

    for (const row of rows) {
      if (
        row?.id &&
        typeof row.name === "string" &&
        typeof row.latitude === "number" &&
        typeof row.longitude === "number" &&
        typeof (row as any).category === "string"
      ) {
        const categoryValue = (row as any).category as string;
        // Only filter by category if categories have loaded
        if (hasCategories && !allowedCategories.has(categoryValue)) {
          continue;
        }

        const rawStatus =
          typeof (row as any).status === "string"
            ? ((row as any).status as string).toLowerCase()
            : null;
        const statusValue =
          rawStatus && allowedStatuses.includes(rawStatus as OrganizationStatus)
            ? (rawStatus as OrganizationStatus)
            : null;

        const rawModeration =
          typeof (row as any).moderationStatus === "string"
            ? ((row as any).moderationStatus as string).toLowerCase()
            : null;
        const moderationStatus =
          rawModeration && ["pending", "approved", "declined", "removed"].includes(rawModeration)
            ? (rawModeration as OrganizationModerationStatus)
            : null;
        if (moderationStatus === "pending" || moderationStatus === "declined" || moderationStatus === "removed") {
          continue;
        }

        list.push({
          id: row.id,
          name: row.name,
          ownerEmail:
            typeof (row as any).ownerEmail === "string"
              ? ((row as any).ownerEmail as string)
              : null,
          latitude: row.latitude,
          longitude: row.longitude,
          category: categoryValue as Organization["category"],
          website:
            typeof (row as any).website === "string" ? ((row as any).website as string) : null,
          address: typeof (row as any).address === "string" ? ((row as any).address as string) : null,
          city: typeof (row as any).city === "string" ? ((row as any).city as string) : null,
          state: typeof (row as any).state === "string" ? ((row as any).state as string) : null,
          postalCode:
            typeof (row as any).postalCode === "string" ? ((row as any).postalCode as string) : null,
          phone: typeof (row as any).phone === "string" ? ((row as any).phone as string) : null,
          hours: (row as any).hours ?? null,
          placeId: typeof (row as any).placeId === "string" ? ((row as any).placeId as string) : null,
          source: typeof (row as any).source === "string" ? ((row as any).source as string) : null,
          googleCategory:
            typeof (row as any).googleCategory === "string"
              ? ((row as any).googleCategory as string)
              : null,
          keywordFound:
            typeof (row as any).keywordFound === "string"
              ? ((row as any).keywordFound as string)
              : null,
          status: statusValue,
          lastSyncedAt:
            typeof (row as any).lastSyncedAt === "number"
              ? ((row as any).lastSyncedAt as number)
              : null,
          moderationStatus,
          moderationChangedAt:
            typeof (row as any).moderationChangedAt === "number"
              ? ((row as any).moderationChangedAt as number)
              : null,
          submittedAt:
            typeof (row as any).submittedAt === "number"
              ? ((row as any).submittedAt as number)
              : null,
          queueSortKey:
            typeof (row as any).queueSortKey === "number"
              ? ((row as any).queueSortKey as number)
              : null,
          issueCount:
            typeof (row as any).issueCount === "number"
              ? ((row as any).issueCount as number)
              : null,
        });
      }
    }
    return list;
  }, [data?.organizations, orgCategories]);

  return { organizations, isLoading, error };
};
