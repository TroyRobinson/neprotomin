import type { Organization, OrganizationHours } from "../../types/organization";

export const DAY_LABELS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

const COMPACT_CURRENCY_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

const getMobilePlatform = (): { isMobile: boolean; isIOS: boolean; isAndroid: boolean } => {
  if (typeof navigator === "undefined") {
    return { isMobile: false, isIOS: false, isAndroid: false };
  }
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isMobile = isIOS || isAndroid ||
    /webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua) ||
    (typeof window !== "undefined" && window.matchMedia?.("(max-width: 768px)").matches);
  return { isMobile, isIOS, isAndroid };
};

export const buildMapsUrl = (org: Organization): string | null => {
  const segments = [
    org.address,
    org.city,
    org.state,
    org.postalCode,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  if (segments.length === 0) return null;

  const { isMobile, isIOS, isAndroid } = getMobilePlatform();
  const query = encodeURIComponent(segments.join(", "));

  if (isIOS) {
    if (typeof org.latitude === "number" && typeof org.longitude === "number" &&
        isFinite(org.latitude) && isFinite(org.longitude)) {
      return `http://maps.apple.com/?ll=${org.latitude},${org.longitude}`;
    }
    return `http://maps.apple.com/?q=${query}`;
  }
  if (isAndroid) {
    if (typeof org.latitude === "number" && typeof org.longitude === "number" &&
        isFinite(org.latitude) && isFinite(org.longitude)) {
      return `geo:${org.latitude},${org.longitude}`;
    }
    return `geo:0,0?q=${query}`;
  }
  if (isMobile) {
    if (typeof org.latitude === "number" && typeof org.longitude === "number" &&
        isFinite(org.latitude) && isFinite(org.longitude)) {
      return `geo:${org.latitude},${org.longitude}`;
    }
    return `geo:0,0?q=${query}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripAddressTail = (value: string): string =>
  value
    .replace(/,\s*(?:USA|United States(?: of America)?)\.?$/i, "")
    .replace(/,\s*[A-Z]{2}(?:\s*\d{5}(?:-\d{4})?)?$/i, "")
    .trim()
    .replace(/\s{2,}/g, " ");

export const formatShortAddress = (org: Organization): string | null => {
  const street = typeof org.address === "string" ? org.address.trim() : "";
  const city = typeof org.city === "string" ? org.city.trim() : "";

  if (!street && !city) return null;

  if (street && city) {
    const cityPattern = new RegExp(`,\\s*${escapeRegExp(city)}(?:,.*)?$`, "i");
    const streetWithoutCity = street.replace(cityPattern, "").trim();
    const baseStreet = streetWithoutCity.length > 0 ? streetWithoutCity : street;
    const cleanedStreet = stripAddressTail(baseStreet).replace(/,\s*$/, "").trim();

    if (cleanedStreet.length === 0) return city;
    return `${cleanedStreet}, ${city}`;
  }

  if (street) return stripAddressTail(street);
  return city;
};

export const formatAnnualRevenueLabel = (org: Organization): string | null => {
  const amount = typeof org.annualRevenue === "number" ? org.annualRevenue : null;
  if (amount === null || !Number.isFinite(amount) || amount <= 0) return null;
  const amountLabel = COMPACT_CURRENCY_FORMATTER.format(amount);
  const year =
    typeof org.annualRevenueTaxPeriod === "number" &&
    Number.isFinite(org.annualRevenueTaxPeriod) &&
    org.annualRevenueTaxPeriod >= 1900 &&
    org.annualRevenueTaxPeriod <= 2500
      ? org.annualRevenueTaxPeriod
      : null;
  return year ? `${amountLabel} (${year})` : amountLabel;
};

export const formatHoursLines = (hours: OrganizationHours | null | undefined): string[] => {
  if (!hours) return [];
  if (Array.isArray(hours.weekdayText) && hours.weekdayText.length > 0) {
    return hours.weekdayText;
  }
  if (!Array.isArray(hours.periods) || hours.periods.length === 0) return [];

  const map = new Map<number, string[]>();
  for (const period of hours.periods) {
    if (typeof period?.day !== "number") continue;
    const dayIndex = Math.min(Math.max(period.day, 0), DAY_LABELS.length - 1);
    const segments: string[] = [];
    const open = period.openTime ?? null;
    const close = period.closeTime ?? null;
    if (open && close) {
      segments.push(`${open} – ${close}${period.isOvernight ? " (+1)" : ""}`);
    } else if (open) {
      segments.push(`Opens ${open}`);
    } else if (close) {
      segments.push(`Closes ${close}`);
    } else {
      segments.push("Closed");
    }

    const existing = map.get(dayIndex) ?? [];
    existing.push(...segments);
    map.set(dayIndex, existing);
  }

  const lines: string[] = [];
  for (const [dayIndex, segments] of map.entries()) {
    const label = DAY_LABELS[dayIndex] ?? `Day ${dayIndex}`;
    lines.push(`${label}: ${segments.join(", ")}`);
  }
  return lines;
};
