export type Category = "health" | "education" | "justice" | "economy" | "food";

export type OrganizationStatus = "active" | "moved" | "closed";

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
}

export const TULSA_CENTER = {
  latitude: 36.1539,
  longitude: -95.9928,
};
