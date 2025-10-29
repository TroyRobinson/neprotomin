export const OKLAHOMA_BOUNDS = {
  minLatitude: 33.6,
  maxLatitude: 37.1,
  minLongitude: -103.1,
  maxLongitude: -94.3,
} as const;

export const DEFAULT_RADIUS_METERS = 40000; // 40 km bias circle

export const DEFAULT_GRID_STEP_DEGREES = 0.6; // coarse statewide coverage

export const DEFAULT_KEYWORDS = [
  "food bank",
  "food pantry",
  "community food bank",
  "community food pantry",
  "emergency food",
  "church food pantry",
  "free meal program",
  "hunger relief",
  "food distribution center",
  "community pantry",
  "mutual aid food",
  "soup kitchen",
] as const;

export const ALLOWED_PRIMARY_TYPES = new Set([
  "food_bank",
  "food_pantry",
  "non_profit_organization",
  "charitable_organization",
  "religious_center",
  "church",
  "community_center",
] as const);

export const ALLOWED_TYPES = new Set([
  ...ALLOWED_PRIMARY_TYPES,
  "place_of_worship",
  "social_service_organization",
  "volunteer_center",
  "welfare_office",
  "donation_center",
  "social_services",
  "charity",
  "food",
  "human_services",
] as const);

export const DENY_PRIMARY_TYPES = new Set([
  "restaurant",
  "fast_food_restaurant",
  "cafe",
  "meal_delivery",
  "meal_takeaway",
  "convenience_store",
  "grocery_store",
  "supermarket",
  "gas_station",
  "hospital",
  "doctor",
  "medical_lab",
] as const);

export const DENY_TYPES = new Set([
  ...DENY_PRIMARY_TYPES,
  "bar",
  "night_club",
  "bakery",
  "hotel",
  "motel",
  "car_dealer",
  "clothing_store",
  "shopping_mall",
  "movie_theater",
  "gym",
  "spa",
  "beauty_salon",
  "parking",
  "pharmacy",
  "bank",
  "meal_prep",
  "meal_delivery_service",
] as const);

export const POSITIVE_NAME_PATTERNS = [
  /\bfood\s*bank\b/i,
  /\bfood\s*pantry\b/i,
  /\bfood\s*distribution\b/i,
  /\bcommunity\s+(?:food|care|services)\b/i,
  /\bmission\b/i,
  /\bministr(?:y|ies)\b/i,
  /\bsoup\s*kitchen\b/i,
  /\bcompassion\b/i,
  /\boutreach\b/i,
  /\bmercy\b/i,
  /\bbeacon\b/i,
  /\bneighbor\b.*\bneighbor\b/i,
] as const;

export const COMMERCIAL_KEYWORD_PATTERNS = [
  /\brestaurant\b/i,
  /\bgrocery\b/i,
  /\bdeli\b/i,
  /\bdiner\b/i,
  /\bcoffee\b/i,
  /\bcafe\b/i,
  /\bhospital\b/i,
  /\bmedical\b/i,
  /\bsurgical\b/i,
  /\bmeal prep\b/i,
  /\bfast food\b/i,
  /\bsteak\b/i,
  /\bpizza\b/i,
  /\bbakery\b/i,
  /\bbar\b/i,
  /\bgrill\b/i,
  /\bpub\b/i,
  /\bbistro\b/i,
] as const;

export const MANUAL_INCLUDE_NAME_PATTERNS = [
  /\bbeaver street baptist\b/i,
  /\bvictory christian center\b/i,
] as const;

export const MANUAL_INCLUDE_PLACE_IDS = new Set<string>([
  "ChIJ__-vBVuRtocRp0fTUZStGus", // Beaver Street Baptist Church - Food Distribution Center (Jenks)
  "ChIJpZFFbyeNtocRJ1m2APZsWNM", // Iglesia Hispana Victory - Food Distribution Center (Victory Christian)
]);

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
