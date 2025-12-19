// Domain helpers and defaults shared across the React app.
export const DEFAULT_PRIMARY_STAT_ID = "8383685c-2741-40a2-96ff-759c42ddd586";
export const DEFAULT_POPULATION_STAT_ID = "0a7081d7-1374-41a8-bd48-41bb3933957e";

export const isFoodMapDomain = (): boolean => {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase();
  return hostname === "okfoodmap.com" || hostname.endsWith(".okfoodmap.com");
};

export type DomainDefaults = {
  /** Which sidebar tab should be active when no URL override exists */
  defaultSidebarTab: "orgs" | "stats";
  /** Preferred stat IDs to preselect for this domain (in priority order) */
  defaultStatIds: string[];
  /** Preferred stat names/labels to match if IDs are missing */
  defaultStatNames: string[];
};

export const getDomainDefaults = (): DomainDefaults => {
  if (isFoodMapDomain()) {
    return {
      defaultSidebarTab: "orgs",
      defaultStatIds: [DEFAULT_PRIMARY_STAT_ID],
      defaultStatNames: [],
    };
  }

  return {
    defaultSidebarTab: "stats",
    defaultStatIds: [DEFAULT_POPULATION_STAT_ID],
    defaultStatNames: ["Population (Change)"],
  };
};
