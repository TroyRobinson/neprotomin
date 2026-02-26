// Domain helpers and defaults shared across the React app.
export const DEFAULT_PRIMARY_STAT_ID = "8383685c-2741-40a2-96ff-759c42ddd586";
export const DEFAULT_POPULATION_STAT_ID = "8807bf0b-5a85-4a73-82f2-cd18c8140072";

const FOOD_DOMAIN_METADATA = {
  title: "Oklahoma Food Map",
  description:
    "Oklahoma Food Map helps Oklahomans to 1. Find food resources, 2. Understand neighborhood needs, and 3. Share new locations & contributions -- a passion project by Neighborhood Explorer.",
} as const;

const DEFAULT_DOMAIN_METADATA = {
  title: "Neighborhood Explorer Oklahoma",
  description: "Mapping out a better tomorrow for our neighborhoods.",
} as const;

export const isFoodMapDomain = (): boolean => {
  if (typeof window === "undefined") return false;
  const hostname = window.location.hostname.toLowerCase();
  return hostname === "okfoodmap.com" || hostname.endsWith(".okfoodmap.com");
};

export type DomainMetadata = {
  title: string;
  description: string;
};

export const getDomainMetadata = (): DomainMetadata => {
  return isFoodMapDomain() ? FOOD_DOMAIN_METADATA : DEFAULT_DOMAIN_METADATA;
};

export type DomainDefaults = {
  /** Which sidebar tab should be active when no URL override exists */
  defaultSidebarTab: "orgs" | "stats";
  /** Whether organization pins should be visible by default for this domain */
  defaultOrgPinsVisible: boolean;
  /** Whether extrema indicators should be visible by default for this domain */
  defaultExtremasVisible: boolean;
  /** Preferred stat IDs to preselect for this domain (in priority order) */
  defaultStatIds: string[];
  /** Preferred stat names/labels to match if IDs are missing */
  defaultStatNames: string[];
};

export const getDomainDefaults = (): DomainDefaults => {
  if (isFoodMapDomain()) {
    return {
      defaultSidebarTab: "orgs",
      defaultOrgPinsVisible: true,
      defaultExtremasVisible: false,
      defaultStatIds: [DEFAULT_PRIMARY_STAT_ID],
      defaultStatNames: [],
    };
  }

  return {
    defaultSidebarTab: "stats",
    defaultOrgPinsVisible: false,
    defaultExtremasVisible: true,
    defaultStatIds: [DEFAULT_POPULATION_STAT_ID],
    defaultStatNames: ["Population"],
  };
};
