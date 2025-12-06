import { useMemo } from "react";
import { db } from "../../lib/reactDb";
import { useAuthSession } from "./useAuthSession";
import { useCategories } from "./useCategories";
import type {
  Organization,
  OrganizationStatus,
  OrganizationModerationStatus,
} from "../../types/organization";

const RECENT_DAYS = 30;
const RECENT_LIMIT = 20;

export const useRecentOrganizations = () => {
  const { authReady } = useAuthSession();
  const { orgCategories } = useCategories();
  const queryEnabled = authReady;

  // Calculate cutoff timestamp (30 days ago)
  const cutoffTimestamp = useMemo(() => Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000, []);

  // Query for organizations that were recently approved or added by admin
  // We need to fetch all approved orgs and filter client-side since InstantDB doesn't support
  // complex date comparisons in queries
  const { data, isLoading, error } = db.useQuery(
    queryEnabled
      ? {
          organizations: {
            $: {
              where: {
                or: [
                  { moderationStatus: "approved" },
                  { moderationStatus: { $isNull: true } },
                ],
              },
              order: { moderationChangedAt: "desc" as const },
              limit: 100, // Fetch more than needed to account for filtering
            },
          },
        }
      : null,
  );

  const recentOrganizations = useMemo<Organization[]>(() => {
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
        
        // Skip non-approved or declined/removed orgs
        if (moderationStatus === "pending" || moderationStatus === "declined" || moderationStatus === "removed") {
          continue;
        }

        // Check if organization is recent
        const moderationChangedAt =
          typeof (row as any).moderationChangedAt === "number"
            ? ((row as any).moderationChangedAt as number)
            : null;
        const submittedAt =
          typeof (row as any).submittedAt === "number"
            ? ((row as any).submittedAt as number)
            : null;
        
        // Use moderationChangedAt if available, otherwise submittedAt
        // For admin-created orgs, moderationChangedAt === submittedAt (set when created)
        // For moderator-approved orgs, moderationChangedAt is set when approved
        const timestamp = moderationChangedAt ?? submittedAt;
        if (!timestamp || timestamp < cutoffTimestamp) {
          continue;
        }

        const rawValue =
          typeof (row as any).raw === "object" && (row as any).raw !== null
            ? ((row as any).raw as Record<string, unknown>)
            : null;

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
            typeof (row as any).postalCode === "string"
              ? ((row as any).postalCode as string)
              : null,
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
          moderationChangedAt,
          submittedAt,
          queueSortKey:
            typeof (row as any).queueSortKey === "number"
              ? ((row as any).queueSortKey as number)
              : null,
          issueCount:
            typeof (row as any).issueCount === "number"
              ? ((row as any).issueCount as number)
              : null,
          raw: rawValue,
        });
      }
    }

    // Sort by timestamp (most recent first), then limit
    list.sort((a, b) => {
      const aTime = a.moderationChangedAt ?? a.submittedAt ?? 0;
      const bTime = b.moderationChangedAt ?? b.submittedAt ?? 0;
      return bTime - aTime;
    });

    return list.slice(0, RECENT_LIMIT);
  }, [data?.organizations, cutoffTimestamp, orgCategories]);

  return { recentOrganizations, isLoading, error };
};

