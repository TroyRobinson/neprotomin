export const OKLAHOMA_BOUNDS = {
  minLatitude: 33.6,
  maxLatitude: 37.1,
  minLongitude: -103.1,
  maxLongitude: -94.3,
} as const;

export const DEFAULT_RADIUS_METERS = 40000; // 40 km bias circle

export const DEFAULT_GRID_STEP_DEGREES = 0.6; // coarse statewide coverage

export const DEFAULT_KEYWORDS = [
  "community food bank",
  "food pantry",
  "emergency food",
  "church food pantry",
  "free meal program",
  "hunger relief",
  "community pantry",
  "mutual aid food",
  "soup kitchen",
] as const;

export const SNAP_EXCLUDED_TYPES = new Set([
  "government_office",
  "state_or_local_government_office",
  "social_service_organization",
  "city_hall",
  "county_government_office",
  "federal_government_office",
]);

export const SNAP_NAME_PATTERNS = [
  /\bsnap\b/i,
  /\bdepartment of human services\b/i,
  /\bdhs\b/i,
  /\bokdhs\b/i,
  /\bsooner\b/i,
  /\bnutrition assistance\b/i,
] as const;

export const CACHE_VERSION = "2025-10-places-food-v1";

export const TMP_DIR = "tmp";
export const CACHE_DIR_NAME = "google-places-cache";
