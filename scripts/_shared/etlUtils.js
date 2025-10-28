// Shared utilities for NE → InstantDB ETL scripts
// Reduces duplication across preview, load, series, and bulk import scripts

// ============================================================================
// Tulsa Geography
// ============================================================================

/**
 * Loose Tulsa-area bounding box for ZIP centroids
 * lon: [-96.3, -95.3], lat: [35.8, 36.6]
 */
export const TULSA_BBOX = {
  minLon: -96.3,
  maxLon: -95.3,
  minLat: 35.8,
  maxLat: 36.6,
};

/**
 * Check if coordinates fall within the Tulsa bounding box
 * @param {[number, number]} coord - [lon, lat]
 * @returns {boolean}
 */
export function inTulsaBbox(coord) {
  if (!Array.isArray(coord) || coord.length < 2) return false;
  const [lon, lat] = coord;
  return (
    lon >= TULSA_BBOX.minLon &&
    lon <= TULSA_BBOX.maxLon &&
    lat >= TULSA_BBOX.minLat &&
    lat <= TULSA_BBOX.maxLat
  );
}

// ============================================================================
// NE API Configuration
// ============================================================================

/**
 * Get standardized NE base URL, preferring NE_BASE env, defaulting to staging
 * @returns {string}
 */
export function getNeBase() {
  return process.env.NE_BASE || 'https://neighborhood-explorer-staging.herokuapp.com';
}

/**
 * Get NE API token from environment (tries NE_TOKEN first, then VITE_NE_API_TOKEN)
 * @returns {string}
 */
export function getNeToken() {
  return process.env.NE_TOKEN || process.env.VITE_NE_API_TOKEN || '';
}

/**
 * Build auth headers for NE API requests
 * @returns {Record<string, string>}
 */
export function authHeaders() {
  const headers = { Accept: 'application/json' };
  const token = getNeToken();
  if (token) {
    headers['Authorization'] = token.startsWith('Token ') ? token : `Token ${token}`;
  }
  return headers;
}

/**
 * Build a URL with query parameters, defaulting to format=json for DRF
 * @param {string} path - API path
 * @param {Record<string, any>} params - Query parameters
 * @param {string} base - Base URL (defaults to getNeBase())
 * @returns {string}
 */
export function urlWithQuery(path, params = {}, base = null) {
  const effectiveBase = base || getNeBase();
  const u = new URL(path, effectiveBase.replace(/\/$/, ''));
  if (!('format' in params)) u.searchParams.set('format', 'json');
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/**
 * Fetch JSON from a URL with NE auth headers
 * @param {string} url
 * @param {boolean} debug - If true, log the request
 * @returns {Promise<any>}
 */
export async function getJson(url, debug = false) {
  if (debug) console.log(`GET ${url}`);
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${url}: ${text || res.statusText}`);
  }
  return res.json();
}

// ============================================================================
// NE Category Mapping
// ============================================================================

/**
 * Fetch NE categories and build a map: category_id → slug
 * @param {string} base - Base URL
 * @param {boolean} debug
 * @returns {Promise<Map<number, string>>}
 */
export async function fetchCategoriesMap(base = null, debug = false) {
  const effectiveBase = base || getNeBase();
  const url = `${effectiveBase.replace(/\/$/, '')}/api/categories.json`;
  try {
    const arr = await getJson(url, debug);
    const map = new Map();
    for (const c of arr || []) {
      if (c && typeof c.id === 'number') {
        map.set(c.id, c.slug || String(c.id));
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

// ============================================================================
// Data Type Transforms
// ============================================================================

/**
 * Map NE unit string to InstantDB type
 * @param {string} unit
 * @returns {string} - One of: count, percent, rate, currency, index, hours, years
 */
export function mapUnitToType(unit) {
  switch ((unit || '').toLowerCase()) {
    case 'percentage':
      return 'percent';
    case 'rate':
      return 'rate';
    case 'dollars':
    case 'dollars_per_capita':
      return 'currency';
    case 'index':
      return 'index';
    case 'total':
      return 'count';
    case 'hours':
      return 'hours';
    case 'years':
      return 'years';
    default:
      return 'count';
  }
}

/**
 * Map NE "desired" field to goodIfUp boolean
 * @param {any} desired - 'high' | 'low' | null
 * @returns {boolean | null}
 */
export function desiredToGoodIfUp(desired) {
  if (!desired) return null;
  const d = String(desired).toLowerCase();
  if (d === 'high') return true;
  if (d === 'low') return false;
  return null; // Neutral
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

/**
 * Parse command-line arguments into an object
 * Supports: --key=value and --flag
 * @param {string[]} argv - process.argv (will slice(2) internally)
 * @returns {Record<string, any>}
 */
export function parseArgs(argv = process.argv) {
  return Object.fromEntries(
    argv.slice(2).map((arg) => {
      const m = arg.match(/^--([^=]+)=(.*)$/);
      return m ? [m[1], m[2]] : [arg.replace(/^--/, ''), true];
    }),
  );
}

/**
 * Resolve DEBUG flag from environment and args
 * @param {Record<string, any>} args
 * @returns {boolean}
 */
export function isDebug(args = {}) {
  return !!process.env.DEBUG || args.debug === '1' || args.debug === true;
}

// ============================================================================
// InstantDB Admin Setup
// ============================================================================

/**
 * Get Instant app ID from environment
 * @returns {string}
 * @throws {Error} if missing
 */
export function getInstantAppId() {
  const appId = process.env.VITE_INSTANT_APP_ID || process.env.INSTANT_APP_ID;
  if (!appId) throw new Error('Missing VITE_INSTANT_APP_ID/INSTANT_APP_ID');
  return appId;
}

/**
 * Get Instant admin token from environment
 * @returns {string}
 * @throws {Error} if missing
 */
export function getInstantAdminToken() {
  const token = process.env.INSTANT_APP_ADMIN_TOKEN;
  if (!token) throw new Error('Missing INSTANT_APP_ADMIN_TOKEN');
  return token;
}

/**
 * Initialize InstantDB admin client
 * @param {Function} initAdmin - import from '@instantdb/admin'
 * @returns {any} - db instance
 */
export function initInstantAdmin(initAdmin) {
  return initAdmin({
    appId: getInstantAppId(),
    adminToken: getInstantAdminToken(),
  });
}
