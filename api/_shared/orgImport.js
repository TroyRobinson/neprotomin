import { init as initAdmin, id, tx } from "@instantdb/admin";

// Light-weight Instant admin client for org import endpoints
const getInstantAppId = () => {
  const appId =
    process.env.VITE_INSTANT_APP_ID ||
    process.env.NEXT_PUBLIC_INSTANT_APP_ID ||
    process.env.INSTANT_APP_ID;
  if (!appId) throw new Error("Missing Instant app id (VITE_INSTANT_APP_ID | NEXT_PUBLIC_INSTANT_APP_ID | INSTANT_APP_ID)");
  return appId;
};

const getInstantAdminToken = () => {
  const token = process.env.INSTANT_APP_ADMIN_TOKEN;
  if (!token) throw new Error("Missing INSTANT_APP_ADMIN_TOKEN");
  return token;
};

export const createInstantClient = () =>
  initAdmin({
    appId: getInstantAppId(),
    adminToken: getInstantAdminToken(),
  });

// Heuristic: map NTEE code prefix to our category slugs
export const mapNteeToCategory = (nteeCode, fallbackCategory = "health") => {
  if (typeof nteeCode !== "string" || !nteeCode) return fallbackCategory;
  const code = nteeCode.toUpperCase();
  const prefix = code[0];
  switch (prefix) {
    case "E":
    case "F":
      return "health";
    case "B":
    case "C":
      return "education";
    case "I":
      return "justice";
    case "J":
    case "P":
      return "economy";
    case "K":
      return "food";
    case "L":
      return "housing";
    default:
      return fallbackCategory;
  }
};

export const normalizeString = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

// Basic keyword filters (case-insensitive)
export const filterOrgsByKeywords = (items, includeWords, excludeWords, enforceIncludes = true) => {
  const includes = (includeWords || "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  const excludes = (excludeWords || "")
    .split(",")
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);

  return items.filter((org) => {
    const haystack = `${org.name ?? ""} ${org.nteeCode ?? ""} ${org.city ?? ""} ${org.state ?? ""}`.toLowerCase();
    if (enforceIncludes && includes.length > 0 && !includes.some((word) => haystack.includes(word))) {
      return false;
    }
    if (excludes.some((word) => haystack.includes(word))) {
      return false;
    }
    return true;
  });
};

const buildAddressString = (org) => {
  const parts = [
    normalizeString(org.street) || normalizeString(org.address),
    normalizeString(org.city),
    normalizeString(org.state),
    normalizeString(org.zip) || normalizeString(org.postalCode),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
};

// Simple geocoder (same providers as client-side helper) to ensure we can save lat/lng
const GEOCODER_SERVICES = [
  {
    name: "photon.komoot.io",
    buildUrl: (query) => {
      const params = new URLSearchParams({ q: query, limit: "1" });
      return `https://photon.komoot.io/api/?${params.toString()}`;
    },
    parse: (data) => {
      if (!data || typeof data !== "object" || data === null) return null;
      const features = data.features;
      if (!Array.isArray(features) || features.length === 0) return null;
      const first = features[0];
      const coords = first?.geometry?.coordinates;
      if (Array.isArray(coords) && coords.length >= 2) {
        const [longitude, latitude] = coords;
        if (typeof latitude === "number" && typeof longitude === "number") {
          return { latitude, longitude };
        }
      }
      return null;
    },
  },
  {
    name: "geocode.maps.co",
    buildUrl: (query) => {
      const params = new URLSearchParams({ q: query });
      return `https://geocode.maps.co/search?${params.toString()}`;
    },
    parse: (data) => {
      if (!Array.isArray(data) || data.length === 0) return null;
      const first = data[0];
      const lat = typeof first?.lat === "string" ? parseFloat(first.lat) : null;
      const lon = typeof first?.lon === "string" ? parseFloat(first.lon) : null;
      if (typeof lat === "number" && !Number.isNaN(lat) && typeof lon === "number" && !Number.isNaN(lon)) {
        return { latitude: lat, longitude: lon };
      }
      return null;
    },
  },
  {
    name: "nominatim.osm.org",
    buildUrl: (query) => {
      const params = new URLSearchParams({ q: query, format: "json", limit: "1", addressdetails: "0" });
      return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
    },
    parse: (data) => {
      if (!Array.isArray(data) || data.length === 0) return null;
      const first = data[0];
      const lat = typeof first?.lat === "string" ? parseFloat(first.lat) : null;
      const lon = typeof first?.lon === "string" ? parseFloat(first.lon) : null;
      if (typeof lat === "number" && !Number.isNaN(lat) && typeof lon === "number" && !Number.isNaN(lon)) {
        return { latitude: lat, longitude: lon };
      }
      return null;
    },
  },
];

const fetchWithTimeout = async (url, options = {}, timeoutMs = 10000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const GEOCODER_TIMEOUT_MS = 2_500;
const GEOCODER_ORG_BUDGET_MS = 8_000;
const GEOCODER_ABORT_THRESHOLD = 2;
const GEOCODER_ABORT_COOLDOWN_MS = 2 * 60_000;
const GEOCODER_MIN_REMAINING_BUDGET_MS = 400;

const geocoderAbortCountByService = new Map();
const geocoderDisabledUntilByService = new Map();

const isAbortError = (error) => {
  if (!error || typeof error !== "object") return false;
  const name = error.name;
  return name === "AbortError" || name === "TimeoutError";
};

const isServiceTemporarilyDisabled = (serviceName, now) => {
  const until = geocoderDisabledUntilByService.get(serviceName);
  return typeof until === "number" && now < until;
};

const noteServiceSuccess = (serviceName) => {
  geocoderAbortCountByService.set(serviceName, 0);
  geocoderDisabledUntilByService.delete(serviceName);
};

const noteServiceAbort = (serviceName, now) => {
  const nextAbortCount = (geocoderAbortCountByService.get(serviceName) ?? 0) + 1;
  if (nextAbortCount >= GEOCODER_ABORT_THRESHOLD) {
    geocoderAbortCountByService.set(serviceName, 0);
    geocoderDisabledUntilByService.set(serviceName, now + GEOCODER_ABORT_COOLDOWN_MS);
    return;
  }
  geocoderAbortCountByService.set(serviceName, nextAbortCount);
};

export const geocodeAddress = async (org) => {
  const attempts = [];
  const primary = buildAddressString(org);
  if (primary) attempts.push(primary);
  const withoutPostal = buildAddressString({ ...org, zip: null, postalCode: null });
  if (withoutPostal && withoutPostal !== primary) attempts.push(withoutPostal);
  const startedAt = Date.now();

  for (const query of attempts) {
    for (const service of GEOCODER_SERVICES) {
      const now = Date.now();
      if (isServiceTemporarilyDisabled(service.name, now)) continue;
      const remainingBudgetMs = GEOCODER_ORG_BUDGET_MS - (now - startedAt);
      if (remainingBudgetMs <= GEOCODER_MIN_REMAINING_BUDGET_MS) return null;
      const timeoutMs = Math.min(GEOCODER_TIMEOUT_MS, remainingBudgetMs);
      try {
        const response = await fetchWithTimeout(service.buildUrl(query), {}, timeoutMs);
        if (!response.ok) continue;
        const data = await response.json();
        const parsed = service.parse(data);
        if (parsed) {
          noteServiceSuccess(service.name);
          return { ...parsed, provider: service.name, query };
        }
      } catch (error) {
        if (isAbortError(error)) {
          noteServiceAbort(service.name, Date.now());
          continue;
        }
        // Swallow and try next provider.
        console.warn(`[org-import] geocoder ${service.name} failed`, error);
      }
    }
  }
  return null;
};

export const PROPUBLICA_BASE = "https://projects.propublica.org/nonprofits/api/v2/search.json";
const PROPUBLICA_DETAIL_BASE = "https://projects.propublica.org/nonprofits/api/v2/organizations";

const buildProPublicaHeaders = () => {
  const headers = {
    Accept: "application/json",
    "User-Agent": "NEProtoMinimal/OrgImport (+https://neighborhoodexplorer.org)",
  };
  const apiKey = process.env.PROPUBLICA_API_KEY || process.env.PROPUBLICA_NONPROFIT_API_KEY;
  if (apiKey) headers["X-API-Key"] = apiKey;
  return headers;
};

// Fetch one page of ProPublica orgs
export const fetchProPublicaOrgs = async ({
  query,
  state,
  city,
  nteePrefix,
  page = 0,
}) => {
  const params = new URLSearchParams();
  const queryParts = [query];
  if (city) queryParts.push(city);
  const qValue = queryParts.filter(Boolean).join(" ").trim();
  if (qValue) params.set("q", qValue);
  if (state) params.set("state[id]", state);
  // ProPublica expects ntee[id] as integers 1-10 (major groups). Ignore non-numeric inputs.
  const nteeMajor = typeof nteePrefix === "string" && /^\d+$/.test(nteePrefix.trim()) ? nteePrefix.trim() : null;
  if (nteeMajor) params.set("ntee[id]", nteeMajor);
  // API is zero-indexed; default page 0
  params.set("page", String(Math.max(0, Number(page) || 0)));

  const url = `${PROPUBLICA_BASE}?${params.toString()}`;
  const apiKey = process.env.PROPUBLICA_API_KEY || process.env.PROPUBLICA_NONPROFIT_API_KEY;
  const headers = buildProPublicaHeaders();

  let response;
  try {
    response = await fetch(url, { headers });
  } catch (networkError) {
    throw new Error(`ProPublica API network error: ${networkError instanceof Error ? networkError.message : String(networkError)}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const keyHint = apiKey ? "with API key" : "without API key (set PROPUBLICA_API_KEY or PROPUBLICA_NONPROFIT_API_KEY)";
    throw new Error(`ProPublica API ${response.status} ${response.statusText} ${keyHint} body="${body.substring(0, 400)}"`);
  }

  const payload = await response.json();
  const organizations = Array.isArray(payload?.organizations) ? payload.organizations : [];
  const total = typeof payload?.total_results === "number" ? payload.total_results : organizations.length;

  const normalized = organizations
    .map((org) => {
      const ein =
        normalizeEin(org.ein) ??
        normalizeEin(org.ein_tax_id) ??
        normalizeEin(org.strein);
      return {
        id: normalizeString(org.id) ?? ein ?? id(),
        name: normalizeString(org.organization_name) ?? normalizeString(org.name),
        city: normalizeString(org.city),
        state: normalizeString(org.state),
        address: normalizeString(org.street) ?? normalizeString(org.address),
        postalCode: normalizeString(org.zip) ?? normalizeString(org.zip_code),
        nteeCode: normalizeString(org.ntee_code) ?? normalizeString(org.ntee) ?? normalizeString(org.ntee_classification),
        nteeClassification: normalizeString(org.ntee_classification),
        ein,
        raw: org,
      };
    })
    .filter((org) => org.name);

  return { items: normalized, total };
};

const normalizeEin = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const digits = value.replace(/\D/g, "");
    return digits.length ? digits : null;
  }
  return null;
};

const parseNumericAmount = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const normalized = value.replace(/[$,\s]/g, "");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const parseTaxPeriodYear = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 10000000) {
      return Math.floor(value / 10000);
    }
    return value >= 1900 && value <= 2500 ? value : null;
  }
  if (typeof value === "string") {
    const match = value.match(/\b(19|20)\d{2}\b/);
    if (match) return Number(match[0]);
  }
  return null;
};

const extractFinancialSnapshot = (detail) => {
  const filings = Array.isArray(detail?.filings_with_data) ? detail.filings_with_data : [];
  for (const filing of filings) {
    const totalRevenue = parseNumericAmount(filing?.totrevenue);
    if (typeof totalRevenue === "number" && totalRevenue > 0) {
      return {
        annualRevenue: totalRevenue,
        annualRevenueTaxPeriod: parseTaxPeriodYear(filing?.tax_prd),
      };
    }
  }

  const topLevelRevenueCandidates = [detail?.revenue_amount, detail?.income_amount];
  for (const candidate of topLevelRevenueCandidates) {
    const parsed = parseNumericAmount(candidate);
    if (typeof parsed === "number" && parsed > 0) {
      return {
        annualRevenue: parsed,
        annualRevenueTaxPeriod: parseTaxPeriodYear(detail?.tax_period),
      };
    }
  }

  return { annualRevenue: null, annualRevenueTaxPeriod: null };
};

export const fetchProPublicaOrgDetail = async (ein) => {
  const normalizedEin = normalizeEin(ein);
  if (!normalizedEin) return null;
  const url = `${PROPUBLICA_DETAIL_BASE}/${normalizedEin}.json`;
  let response;
  try {
    response = await fetchWithTimeout(url, { headers: buildProPublicaHeaders() }, 10_000);
  } catch (networkError) {
    console.warn(`[org-import] detail fetch failed for EIN ${normalizedEin}`, networkError);
    return null;
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.warn(`[org-import] detail fetch ${response.status} ${response.statusText} for EIN ${normalizedEin} body="${body.substring(0, 200)}"`);
    return null;
  }
  let payload;
  try {
    payload = await response.json();
  } catch (parseError) {
    console.warn(`[org-import] detail fetch parse error for EIN ${normalizedEin}`, parseError);
    return null;
  }

  const detail = payload?.organization;
  if (!detail || typeof detail !== "object") return null;

  return {
    address: normalizeString(detail.street) ?? normalizeString(detail.address),
    city: normalizeString(detail.city),
    state: normalizeString(detail.state),
    postalCode: normalizeString(detail.zipcode) ?? normalizeString(detail.zip) ?? normalizeString(detail.zip_code),
    careOfName: normalizeString(detail.careofname),
    ...extractFinancialSnapshot(detail),
    raw: detail,
  };
};

const mergeRaw = (searchRaw, detailRaw) => {
  if (!searchRaw && !detailRaw) return null;
  return {
    ...(searchRaw ? { search: searchRaw } : {}),
    ...(detailRaw ? { detail: detailRaw } : {}),
  };
};

export const enrichProPublicaOrgsWithDetails = async (orgs, { concurrency = 4 } = {}) => {
  if (!Array.isArray(orgs) || orgs.length === 0) return [];
  const results = [...orgs];
  const targets = orgs
    .map((org, index) => ({ org, index, ein: normalizeEin(org.ein) }))
    // Pull detail for all EIN-backed orgs so financial fields are available for cards.
    .filter((item) => item.ein);

  const batchSize = Math.max(1, Math.min(concurrency, targets.length || 1));
  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);
    const details = await Promise.all(
      batch.map(async ({ ein, org, index }) => {
        const detail = await fetchProPublicaOrgDetail(ein);
        return { detail, index, org };
      }),
    );
    for (const { detail, index, org } of details) {
      if (!detail) continue;
      results[index] = {
        ...org,
        address: detail.address ?? org.address,
        city: detail.city ?? org.city,
        state: detail.state ?? org.state,
        postalCode: detail.postalCode ?? org.postalCode,
        careOfName: detail.careOfName ?? org.careOfName,
        annualRevenue: detail.annualRevenue ?? org.annualRevenue ?? null,
        annualRevenueTaxPeriod: detail.annualRevenueTaxPeriod ?? org.annualRevenueTaxPeriod ?? null,
        raw: mergeRaw(org.raw, detail.raw),
      };
    }
  }
  return results;
};

// Persist a batch row with initial status
export const createImportBatch = async (db, { label, filters, createdBy }) => {
  const now = Date.now();
  const batchId = id();
  await db.transact(
    tx.orgImports[batchId].update({
      label,
      status: "running",
      filters: filters ?? {},
      createdAt: now,
      createdBy: createdBy ?? null,
      source: "propublica",
    }),
  );
  return { batchId, createdAt: now };
};

export const finalizeImportBatch = async (db, batchId, payload) => {
  await db.transact(tx.orgImports[batchId].update(payload));
};

export const buildOrgTx = (org, coords, category, importBatchId, orgId = id()) => {
  const now = Date.now();
  return tx.organizations[orgId].update({
    name: org.name,
    latitude: coords.latitude,
    longitude: coords.longitude,
    category,
    address: org.address ?? null,
    city: org.city ?? null,
    state: org.state ?? null,
    postalCode: org.postalCode ?? null,
    source: "propublica",
    googleCategory: org.nteeClassification ?? null,
    keywordFound: null,
    status: "active",
    lastSyncedAt: now,
    createdAt: now,
    updatedAt: now,
    raw: org.raw ?? null,
    moderationStatus: "approved",
    ein: org.ein ?? null,
    annualRevenue: typeof org.annualRevenue === "number" && Number.isFinite(org.annualRevenue) ? org.annualRevenue : null,
    annualRevenueTaxPeriod:
      typeof org.annualRevenueTaxPeriod === "number" && Number.isFinite(org.annualRevenueTaxPeriod)
        ? org.annualRevenueTaxPeriod
        : null,
    importBatchId: importBatchId ?? null,
  });
};

export { tx, id };
