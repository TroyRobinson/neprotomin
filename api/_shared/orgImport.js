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

export const geocodeAddress = async (org) => {
  const address = buildAddressString(org);
  if (!address) return null;
  for (const service of GEOCODER_SERVICES) {
    try {
      const response = await fetchWithTimeout(service.buildUrl(address), {}, 10_000);
      if (!response.ok) continue;
      const data = await response.json();
      const parsed = service.parse(data);
      if (parsed) return { ...parsed, provider: service.name };
    } catch (error) {
      // Swallow and try next provider
      console.warn(`[org-import] geocoder ${service.name} failed`, error);
    }
  }
  return null;
};

const PROPUBLICA_BASE = "https://projects.propublica.org/nonprofits/api/v2/search.json";

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
  const headers = {
    Accept: "application/json",
    "User-Agent": "NEProtoMinimal/OrgImport (+https://neighborhoodexplorer.org)",
  };
  const apiKey = process.env.PROPUBLICA_API_KEY || process.env.PROPUBLICA_NONPROFIT_API_KEY;
  if (apiKey) headers["X-API-Key"] = apiKey;

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
    .map((org) => ({
      id: normalizeString(org.id) ?? normalizeString(org.ein) ?? normalizeString(org.ein_tax_id) ?? id(),
      name: normalizeString(org.organization_name) ?? normalizeString(org.name),
      city: normalizeString(org.city),
      state: normalizeString(org.state),
      address: normalizeString(org.street) ?? normalizeString(org.address),
      postalCode: normalizeString(org.zip) ?? normalizeString(org.zip_code),
      nteeCode: normalizeString(org.ntee_code) ?? normalizeString(org.ntee) ?? normalizeString(org.ntee_classification),
      nteeClassification: normalizeString(org.ntee_classification),
      ein: normalizeString(org.ein) ?? normalizeString(org.ein_tax_id),
      raw: org,
    }))
    .filter((org) => org.name);

  return { items: normalized, total };
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

export const buildOrgTx = (org, coords, category, importBatchId) => {
  const now = Date.now();
  return tx.organizations[id()].update({
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
    importBatchId: importBatchId ?? null,
  });
};

export { tx, id };
