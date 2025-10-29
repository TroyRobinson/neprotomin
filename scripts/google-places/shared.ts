import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import "dotenv/config";
import type { OrganizationHours, OrganizationHoursPeriod, OrganizationStatus } from "../../src/types/organization";
import { parseArgs } from "../_shared/etlUtils.js";
import {
  CACHE_DIR_NAME,
  CACHE_VERSION,
  DEFAULT_GRID_STEP_DEGREES,
  OKLAHOMA_BOUNDS,
  TMP_DIR,
  SNAP_EXCLUDED_TYPES,
  SNAP_NAME_PATTERNS,
} from "./constants.ts";

export interface SearchCenter {
  latitude: number;
  longitude: number;
}

export interface SearchTask {
  keyword: string;
  center: SearchCenter;
}

export interface SearchPlace {
  id: string;
  displayName?: { text?: string; languageCode?: string };
  text?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
  businessStatus?: string;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  rating?: number;
  userRatingCount?: number;
}

export interface PlaceDetails {
  id: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  types?: string[];
  addressComponents?: Array<{
    componentType?: string;
    longText?: string;
    shortText?: string;
  }>;
  formattedAddress?: string;
  shortFormattedAddress?: string;
  websiteUri?: string;
  internationalPhoneNumber?: string;
  nationalPhoneNumber?: string;
  regularOpeningHours?: {
    periods?: Array<{
      open?: { day?: number; hour?: number; minute?: number; date?: string; truncated?: boolean; status?: string };
      close?: { day?: number; hour?: number; minute?: number; date?: string; truncated?: boolean; status?: string };
    }>;
    weekdayDescriptions?: string[];
    nextCloseTime?: string;
    nextOpenTime?: string;
    openNow?: boolean;
    openNowStatus?: string;
  };
  businessStatus?: string;
  placeTypes?: string[];
  googleMapsUri?: string;
  googleMapsLinks?: { placeUri?: string };
  takeout?: boolean;
  delivery?: boolean;
  dineIn?: boolean;
  curbsidePickup?: boolean;
  servesBreakfast?: boolean;
  servesLunch?: boolean;
  servesDinner?: boolean;
  servesBeer?: boolean;
  servesWine?: boolean;
  wheelchairAccessibleEntrance?: boolean;
  wheelchairAccessibleSeating?: boolean;
  wheelchairAccessibleRestroom?: boolean;
  regularSecondaryOpeningHours?: unknown;
  primaryTypeDisplayName?: string;
  rating?: number;
  userRatingCount?: number;
  photos?: unknown;
  iconMaskBaseUri?: string;
  iconBackgroundColor?: string;
  adrFormatAddress?: string;
  businessStatusDescription?: string;
  editorialSummary?: unknown;
  reviews?: unknown;
  areaSummary?: unknown;
  accessibilityOptions?: unknown;
  priceLevel?: string;
  currentSecondaryOpeningHours?: unknown;
  curbsidePickupHours?: unknown;
  deliveryHours?: unknown;
  dineInHours?: unknown;
  takeoutHours?: unknown;
  primaryTypeLocalized?: string;
  primaryTypeStructured?: string;
  nationalPhoneNumberDescription?: string;
  internationalPhoneNumberDescription?: string;
  secondaryOpeningHours?: unknown;
  adrFormattedAddress?: string;
  shortFormattedAddressLocal?: string;
  latLng?: { latitude?: number; longitude?: number };
  utcOffsetMinutes?: number;
  viewport?: unknown;
  iconBackgroundColorAlt?: string;
  accessibilityLabel?: string;
  accessibilityDetails?: unknown;
  menuForChildren?: boolean;
  movedPlaceId?: string;
}

export interface NormalizedPlace {
  placeId: string;
  name: string;
  latitude: number;
  longitude: number;
  formattedAddress: string | null;
  shortAddress: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  website: string | null;
  phone: string | null;
  googleCategory: string | null;
  keywordFound: string | null;
  status: OrganizationStatus;
  hours: OrganizationHours | null;
  types: string[];
  businessStatus?: string | null;
  movedPlaceId?: string | null;
  raw: Record<string, unknown>;
}

export interface CollectionPayload {
  generatedAt: number;
  cacheVersion: string;
  keywords: string[];
  radiusMeters: number;
  stepDegrees: number;
  tasks: Array<{ keyword: string; latitude: number; longitude: number }>;
  places: NormalizedPlace[];
  excludedPlaceIds: string[];
}

export const args = parseArgs();

export const DEBUG = args.debug === "1" || args.debug === true || Boolean(process.env.DEBUG);

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export function resolveTmpPath(...segments: string[]): string {
  return path.resolve(process.cwd(), TMP_DIR, ...segments);
}

export function resolveCachePath(key: string): string {
  return resolveTmpPath(CACHE_DIR_NAME, `${CACHE_VERSION}-${key}.json`);
}

export function hashKey(input: unknown): string {
  const json = typeof input === "string" ? input : JSON.stringify(input);
  return createHash("sha1").update(json).digest("hex");
}

export async function readCache<T>(key: string): Promise<T | null> {
  const file = resolveCachePath(key);
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeCache<T>(key: string, value: T): Promise<void> {
  const file = resolveCachePath(key);
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

export async function withCache<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const cached = await readCache<T>(key);
  if (cached) return cached;
  const value = await fetcher();
  await writeCache(key, value);
  return value;
}

export function generateSearchCenters(stepDegrees = DEFAULT_GRID_STEP_DEGREES): SearchCenter[] {
  const centers: SearchCenter[] = [];
  for (let lat = OKLAHOMA_BOUNDS.minLatitude; lat <= OKLAHOMA_BOUNDS.maxLatitude; lat += stepDegrees) {
    for (let lng = OKLAHOMA_BOUNDS.minLongitude; lng <= OKLAHOMA_BOUNDS.maxLongitude; lng += stepDegrees) {
      centers.push({ latitude: Number(lat.toFixed(4)), longitude: Number(lng.toFixed(4)) });
    }
  }
  return centers;
}

export function toTimeString(hour?: number | null, minute?: number | null): string | null {
  if (hour == null || minute == null) return null;
  const hh = String(hour).padStart(2, "0");
  const mm = String(minute).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function normalizeHours(openingHours: PlaceDetails["regularOpeningHours"] | undefined | null): OrganizationHours | null {
  if (!openingHours) return null;
  const periods: OrganizationHoursPeriod[] = [];
  for (const period of openingHours.periods ?? []) {
    const openDay = period?.open?.day ?? null;
    const closeDay = period?.close?.day ?? null;
    const openTime = toTimeString(period?.open?.hour ?? null, period?.open?.minute ?? null);
    const closeTime = toTimeString(period?.close?.hour ?? null, period?.close?.minute ?? null);
    if (openDay == null) continue;
    periods.push({
      day: openDay,
      openTime,
      closeTime,
      isOvernight: closeDay != null && closeDay !== openDay,
      status: period?.open?.status ?? null,
    });
  }
  const weekdayText =
    Array.isArray(openingHours.weekdayDescriptions) && openingHours.weekdayDescriptions.length > 0
      ? openingHours.weekdayDescriptions.slice()
      : undefined;
  const status =
    typeof openingHours.openNowStatus === "string" ? openingHours.openNowStatus : undefined;
  const isUnverified = status === "UNVERIFIED" || status === "OPEN_STATUS_UNSPECIFIED";
  return {
    periods: periods.length > 0 ? periods : undefined,
    weekdayText,
    status,
    isUnverified,
  };
}

export function extractAddressParts(details: PlaceDetails) {
  const components = Array.isArray(details.addressComponents) ? details.addressComponents : [];
  const lookup = (type: string): string | null => {
    for (const comp of components) {
      if (!comp) continue;
      const componentType = comp.componentType || "";
      if (componentType === type) {
        return comp.longText ?? comp.shortText ?? null;
      }
    }
    return null;
  };
  const city =
    lookup("locality") ??
    lookup("administrative_area_level_3") ??
    lookup("administrative_area_level_2") ??
    null;
  const state = lookup("administrative_area_level_1");
  const postalCode = lookup("postal_code");
  return { city, state, postalCode };
}

export function shouldExcludePlace(details: PlaceDetails, keyword: string): boolean {
  const name = (details.displayName?.text ?? "").trim();
  if (!name) return true;
  for (const pattern of SNAP_NAME_PATTERNS) {
    if (pattern.test(name)) return true;
  }
  const keywordNorm = keyword.toLowerCase();
  if (keywordNorm.includes("snap")) return true;
  const types = new Set<string>([
    ...(details.types ?? []),
    ...(details.placeTypes ?? []),
    details.primaryType ? [details.primaryType] : [],
  ].flat().filter(Boolean) as string[]);
  for (const t of types) {
    const normalized = t.toLowerCase();
    if (SNAP_EXCLUDED_TYPES.has(normalized)) return true;
  }
  return false;
}

export function determineStatus(details: PlaceDetails): OrganizationStatus {
  const businessStatus = (details.businessStatus || "").toUpperCase();
  if (details.movedPlaceId) return "moved";
  if (businessStatus === "CLOSED_PERMANENTLY" || businessStatus === "CLOSED_TEMPORARILY") {
    return "closed";
  }
  return "active";
}

export function normalizePlace(
  details: PlaceDetails,
  keyword: string,
  hours: OrganizationHours | null,
): NormalizedPlace | null {
  const loc = details.location ?? details.latLng;
  if (!loc || typeof loc.latitude !== "number" || typeof loc.longitude !== "number") {
    return null;
  }
  const name = details.displayName?.text;
  if (!name) return null;
  const status = determineStatus(details);
  const { city, state, postalCode } = extractAddressParts(details);
  const googleCategory = details.primaryType ?? details.primaryTypeStructured ?? null;
  const phone =
    details.nationalPhoneNumber ??
    details.internationalPhoneNumber ??
    details.nationalPhoneNumberDescription ??
    null;

  return {
    placeId: details.id,
    name,
    latitude: loc.latitude,
    longitude: loc.longitude,
    formattedAddress: details.formattedAddress ?? details.adrFormattedAddress ?? null,
    shortAddress: details.shortFormattedAddress ?? details.shortFormattedAddressLocal ?? null,
    city,
    state,
    postalCode,
    website: details.websiteUri ?? null,
    phone,
    googleCategory,
    keywordFound: keyword,
    status,
    hours,
    types: Array.from(
      new Set(
        [
          ...(details.types ?? []),
          ...(details.placeTypes ?? []),
          details.primaryType ? [details.primaryType] : [],
        ].flat().filter(Boolean) as string[],
      ),
    ),
    businessStatus: details.businessStatus ?? null,
    movedPlaceId: details.movedPlaceId ?? null,
    raw: details as unknown as Record<string, unknown>,
  };
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const PLACES_BASE_URL = "https://places.googleapis.com/v1";

export interface TextSearchRequestBody {
  textQuery: string;
  pageSize?: number;
  pageToken?: string;
  includedType?: string;
  includedTypes?: string[];
  excludedTypes?: string[];
  locationBias?: {
    circle: {
      center: { latitude: number; longitude: number };
      radius: number;
    };
  };
  locationRestriction?: {
    rectangle: {
      low: { latitude: number; longitude: number };
      high: { latitude: number; longitude: number };
    };
  };
  strictTypeFiltering?: boolean;
  openNow?: boolean;
  priceLevels?: string[];
  minRating?: number;
}

export interface TextSearchResponseBody {
  places?: SearchPlace[];
  nextPageToken?: string;
}

export interface PlaceDetailsResponseBody extends PlaceDetails {}

async function requestJson<T>(
  url: string,
  apiKey: string,
  fieldMask: string,
  body?: unknown,
  method: "GET" | "POST" = "POST",
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Goog-Api-Key": apiKey,
    "X-Goog-FieldMask": fieldMask,
  };
  const res = await fetch(url, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Places request failed (${res.status} ${res.statusText}): ${text}`);
  }
  return (await res.json()) as T;
}

export async function searchText(
  apiKey: string,
  body: TextSearchRequestBody,
  useCache = true,
): Promise<TextSearchResponseBody> {
  const cacheKey = hashKey({ kind: "searchText", body });
  const fieldMask = [
    "places.id",
    "places.displayName",
    "places.location",
    "places.primaryType",
    "places.types",
    "places.businessStatus",
    "places.formattedAddress",
    "places.shortFormattedAddress",
  ].join(",");

  const exec = () =>
    requestJson<TextSearchResponseBody>(`${PLACES_BASE_URL}/places:searchText`, apiKey, fieldMask, body, "POST");
  return useCache ? withCache<TextSearchResponseBody>(cacheKey, exec) : exec();
}

export async function lookupPlace(
  apiKey: string,
  placeId: string,
  useCache = true,
): Promise<PlaceDetailsResponseBody> {
  const cacheKey = hashKey({ kind: "placeDetails", placeId });
  const fieldMask = [
    "id",
    "displayName",
    "location",
    "primaryType",
    "types",
    "formattedAddress",
    "shortFormattedAddress",
    "addressComponents",
    "websiteUri",
    "internationalPhoneNumber",
    "nationalPhoneNumber",
    "regularOpeningHours",
    "businessStatus",
    "googleMapsUri",
    "googleMapsLinks",
    "movedPlaceId",
    "primaryTypeStructured",
    "primaryTypeDisplayName",
    "placeTypes",
    "editorialSummary",
    "rating",
    "userRatingCount",
    "utcOffsetMinutes",
    "takeout",
    "delivery",
    "dineIn",
    "curbsidePickup",
    "servesBreakfast",
    "servesLunch",
    "servesDinner",
    "servesBeer",
    "servesWine",
    "wheelchairAccessibleEntrance",
    "wheelchairAccessibleSeating",
    "wheelchairAccessibleRestroom",
    "regularSecondaryOpeningHours",
    "businessStatusDescription",
    "priceLevel",
  ].join(",");

  const exec = () =>
    requestJson<PlaceDetailsResponseBody>(
      `${PLACES_BASE_URL}/places/${encodeURIComponent(placeId)}`,
      apiKey,
      fieldMask,
      undefined,
      "GET",
    );

  return useCache ? withCache<PlaceDetailsResponseBody>(cacheKey, exec) : exec();
}
