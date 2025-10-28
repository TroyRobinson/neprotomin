import { useMemo } from "react";
import { db } from "../../lib/reactDb";
import type { Organization } from "../../types/organization";

export const useOrganizations = () => {
  const { isLoading: isAuthLoading } = db.useAuth();

  // Wait for auth to be ready to avoid race conditions (especially in Safari)
  const { data, isLoading, error } = db.useQuery(
    isAuthLoading
      ? null
      : {
          organizations: {
            $: {
              order: { name: "asc" as const },
            },
          },
        }
  );

  const organizations = useMemo<Organization[]>(() => {
    const rows = data?.organizations ?? [];
    const list: Organization[] = [];
    for (const row of rows) {
      if (
        row?.id &&
        typeof row.name === "string" &&
        typeof row.url === "string" &&
        typeof row.latitude === "number" &&
        typeof row.longitude === "number" &&
        typeof (row as any).category === "string"
      ) {
        list.push({
          id: row.id,
          name: row.name,
          url: row.url,
          latitude: row.latitude,
          longitude: row.longitude,
          category: (row as any).category,
        });
      }
    }
    return list;
  }, [data?.organizations]);

  return { organizations, isLoading, error };
};


