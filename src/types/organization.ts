export type Category = "health" | "education" | "justice" | "economy" | "food";

export type OrganizationStatus = "active" | "moved" | "closed";

export type OrganizationModerationStatus = "pending" | "approved" | "declined" | "removed";

export interface OrganizationHoursPeriod {
  day: number;
  openTime?: string | null;
  closeTime?: string | null;
  isOvernight?: boolean;
  status?: string | null;
}

export interface OrganizationHours {
  periods?: OrganizationHoursPeriod[];
  weekdayText?: string[];
  status?: string;
  isUnverified?: boolean;
}

export interface Organization {
  id: string;
  name: string;
  ownerEmail?: string | null;
  latitude: number;
  longitude: number;
  category: Category;
  website?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  hours?: OrganizationHours | null;
  placeId?: string | null;
  source?: string | null;
  googleCategory?: string | null;
  keywordFound?: string | null;
  status?: OrganizationStatus | null;
  lastSyncedAt?: number | null;
  raw?: Record<string, unknown> | null;
  moderationStatus?: OrganizationModerationStatus | null;
  moderationChangedAt?: number | null;
  submittedAt?: number | null;
  queueSortKey?: number | null;
  issueCount?: number | null;
}

export const TULSA_CENTER = {
  latitude: 36.1539,
  longitude: -95.9928,
};

export const OKLAHOMA_CENTER = {
  latitude: 35.4676,
  longitude: -97.5164,
};

export const OKLAHOMA_DEFAULT_ZOOM = 6.2;
