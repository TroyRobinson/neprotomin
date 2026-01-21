import { URL } from "node:url";

import { init as initAdmin, id, tx } from "@instantdb/admin";
const OK_STATE_FIPS = "40";
const DEFAULT_CATEGORY = "food";
const DEFAULT_PARENT_AREA = "Oklahoma";

const ZIP_PREFIXES_OK = [
  "730",
  "731",
  "732",
  "733",
  "734",
  "735",
  "736",
  "737",
  "738",
  "739",
  "740",
  "741",
  "743",
  "744",
  "745",
  "746",
  "747",
  "748",
  "749",
];

const NORMALIZED_DEFAULT_PARENT_AREA = DEFAULT_PARENT_AREA;

export const CENSUS_TABLE_DOC_URL = (year, dataset, group) =>
  `https://api.census.gov/data/${year}/${dataset}/groups/${group}.html`;

const CUSTOM_LABELS = {
  B22003_001E: "Total Households",
  B22003_002E: "Households Receiving SNAP",
  B22003_003E: "Households Receiving SNAP (Below Poverty)",
  B22003_004E: "Households Receiving SNAP (At or Above Poverty)",
  B22003_005E: "Households Not Receiving SNAP",
  B22003_006E: "Households Not Receiving SNAP (Below Poverty)",
  B22003_007E: "Households Not Receiving SNAP (At or Above Poverty)",
  B01002_001E: "Median Age",
  B01003_001E: "Population",
  B12001_001E: "Population 15+",
  B12001_004E: "Married Population (Male)",
  B12001_010E: "Married Population (Female)",
};

const censusApiKey = () => process.env.CENSUS_API_KEY ?? null;

const buildCensusUrl = (year, dataset, pathname, params) => {
  const trimmedPath = pathname.replace(/^\//, "");
  const basePath = `https://api.census.gov/data/${year}/${dataset}`;
  const url = trimmedPath ? `${basePath}/${trimmedPath}` : basePath;
  const base = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) base.searchParams.set(key, value);
  }
  const key = censusApiKey();
  if (key) base.searchParams.set("key", key);
  return base.toString();
};

export const fetchCensusJson = async (year, dataset, pathname, params, debug = false) => {
  const url = buildCensusUrl(year, dataset, pathname, params);
  if (debug) console.log(`GET ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Census HTTP ${res.status}: ${text || res.statusText}`);
  }
  return res.json();
};

const normalizeText = (value) => {
  if (!value) return "";
  return value
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
};

const inferUniverseFromConcept = (concept) => {
  if (!concept) return null;
  const normalized = String(concept).trim();
  if (!normalized) return null;
  const lower = normalized.toLowerCase();
  const markers = [" for the ", " for ", " among the ", " among "];
  let bestIndex = -1;
  let bestMarker = "";
  for (const marker of markers) {
    const idx = lower.lastIndexOf(marker);
    if (idx > bestIndex) {
      bestIndex = idx;
      bestMarker = marker;
    }
  }
  if (bestIndex === -1) return null;
  const candidate = normalized.slice(bestIndex + bestMarker.length).trim();
  return candidate || null;
};

export const fetchGroupMetadata = async (options) => {
  const json = await fetchCensusJson(
    options.year,
    options.dataset,
    `groups/${options.group}.json`,
    {},
    options.debug,
  );
  const variables = new Map();
  const rawVariables = (json && json.variables) || {};
  for (const [key, value] of Object.entries(rawVariables)) {
    const name = (value && value.name) || key;
    variables.set(name, {
      name,
      label: (value && value.label) || "",
      concept: value && value.concept,
      predicateType: value && value.predicateType,
    });
  }
  const universe =
    (json && (json.universe || json.Universe || json.UNIVERSE)) ||
    inferUniverseFromConcept(json && (json.concept || json.label)) ||
    null;
  return {
    group: options.group,
    label: (json && json.label) || (json && json.concept) || options.group,
    concept: (json && json.concept) || (json && json.label) || options.group,
    universe,
    variables,
  };
};

const cleanVariableLabel = (label) => {
  if (!label) return "";
  return label
    .replace(/^Estimate!!/i, "")
    .replace(/!!/g, " → ")
    .replace(/:+$/, "")
    .trim();
};

const guessStatLabelFromText = (text) => {
  if (!text) return "";
  const trimmed = text.trim();
  if (!trimmed) return "";
  const delimiters = ["→", "–", "—", "·", ":"];
  let bestIndex = -1;
  let bestDelim = "";
  for (const delim of delimiters) {
    const idx = trimmed.lastIndexOf(delim);
    if (idx === -1) continue;
    const next = trimmed.slice(idx + delim.length).trim();
    if (!next) continue;
    if (idx > bestIndex) {
      bestIndex = idx;
      bestDelim = delim;
    }
  }
  if (bestIndex === -1) return trimmed;
  return trimmed.slice(bestIndex + bestDelim.length).trim();
};

export const deriveStatName = (variableName, variable, group) => {
  const custom = CUSTOM_LABELS[variableName];
  if (custom) return custom;
  const cleaned = cleanVariableLabel(variable.label);
  if (!cleaned) {
    return normalizeText(group.concept || variable.name);
  }
  const concept = normalizeText(group.concept || "");
  if (!concept) return cleaned;
  if (cleaned.toLowerCase().includes(concept.toLowerCase())) return cleaned;
  return `${concept} – ${cleaned}`;
};

const deriveStatLabel = (statName, variable, group) => {
  const custom = CUSTOM_LABELS[variable.name];
  const cleaned = cleanVariableLabel(variable.label);
  const fallback = statName || normalizeText(group.concept || variable.name);
  const base = custom || cleaned || fallback;
  return guessStatLabelFromText(base);
};

export const inferStatType = (variable) => {
  const label = (variable.label && variable.label.toLowerCase()) || "";
  if (label.includes("percent") || label.includes("%")) return "percent";
  const predicate = (variable.predicateType && variable.predicateType.toLowerCase()) || "";
  if (predicate === "float" || predicate === "double") return "rate";
  return "count";
};

export const resolveVariables = (options, groupMeta) => {
  const baseVars = options.variables.length
    ? options.variables
    : Array.from(groupMeta.variables.keys()).filter(
        (name) => name.endsWith("E") && name !== "NAME",
      );
  const estimates = baseVars.filter((name) => groupMeta.variables.has(name));
  const moeMap = new Map();
  if (options.includeMoe) {
    for (const estimate of estimates) {
      const candidate = `${estimate.slice(0, -1)}M`;
      if (groupMeta.variables.has(candidate)) {
        moeMap.set(estimate, candidate);
      }
    }
  }
  return { estimates, moeMap };
};

const normalizeCountyFips = (countyId) => {
  if (!countyId) return null;
  const trimmed = countyId.trim();
  if (!trimmed) return null;
  if (trimmed.length === 5) return trimmed;
  if (trimmed.length === 3) return `${OK_STATE_FIPS}${trimmed}`;
  if (trimmed.length < 5) return `${OK_STATE_FIPS}${trimmed.padStart(3, "0")}`;
  return trimmed;
};

const toNumberOrNull = (value) => {
  if (value == null) return null;
  if (value === "" || value === "null") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num <= -99999999) return null;
  return num;
};

const isOklahomaZip = (zip) => {
  if (!zip) return false;
  return ZIP_PREFIXES_OK.includes(zip.slice(0, 3));
};

export const fetchZipData = async (options, estimates, moeVariables) => {
  if (!estimates.length) return { records: [] };
  const getParams = ["NAME", ...estimates, ...moeVariables];
  const data = await fetchCensusJson(
    options.year,
    options.dataset,
    "",
    {
      get: getParams.join(","),
      for: "zip code tabulation area:*",
    },
    options.debug,
  );
  const [headers, ...rows] = data;
  if (!headers) return { records: [] };
  const records = rows.map((row) => {
    const entry = {};
    headers.forEach((key, index) => {
      entry[key] = row[index];
    });
    return entry;
  });
  return { records };
};

export const fetchCountyData = async (options, estimates, moeVariables) => {
  if (!estimates.length) return { records: [] };
  const getParams = ["NAME", ...estimates, ...moeVariables];
  const data = await fetchCensusJson(
    options.year,
    options.dataset,
    "",
    {
      get: getParams.join(","),
      for: "county:*",
      in: `state:${OK_STATE_FIPS}`,
    },
    options.debug,
  );
  const [headers, ...rows] = data;
  if (!headers) return { records: [] };
  const records = rows.map((row) => {
    const entry = {};
    headers.forEach((key, index) => {
      entry[key] = row[index];
    });
    return entry;
  });
  return { records };
};

export const buildDataMaps = (variable, moeVariable, zipPayload, countyPayload) => {
  const estimateKey = variable;
  const moeKey = moeVariable;

  const zipMap = new Map();
  const zipMoeMap = new Map();
  const countyZipMap = new Map();
  const countyZipMoeMap = moeKey ? new Map() : undefined;

  for (const record of zipPayload.records || []) {
    const zip = record["zip code tabulation area"];
    if (!isOklahomaZip(zip)) continue;
    const estimate = toNumberOrNull(record[estimateKey]);
    if (estimate != null) {
      zipMap.set(zip, estimate);
    }
    if (moeKey) {
      const moeVal = toNumberOrNull(record[moeKey]);
      if (moeVal != null) {
        zipMoeMap.set(zip, moeVal);
      }
    }
  }

  const countyMap = new Map();
  const countyMoeMap = new Map();
  for (const record of countyPayload.records || []) {
    const countyId = normalizeCountyFips(record.county);
    const state = record.state;
    if (state !== OK_STATE_FIPS) continue;
    if (!countyId) continue;
    const estimate = toNumberOrNull(record[estimateKey]);
    if (estimate != null) {
      countyMap.set(countyId, estimate);
    }
    if (moeKey) {
      const moeVal = toNumberOrNull(record[moeKey]);
      if (moeVal != null) countyMoeMap.set(countyId, moeVal);
    }
  }

  return {
    zip: zipMap,
    zipMoe: zipMoeMap,
    county: countyMap,
    countyMoe: countyMoeMap,
    countyZipBuckets: countyZipMap,
    countyZipMoe: countyZipMoeMap,
  };
};

export const summarizeDataMaps = (maps) => ({
  zipCount: maps.zip.size,
  countyCount: maps.county.size,
  countyZipGroups: maps.countyZipBuckets.size,
});

// Local helpers to normalize county names into the same "<Name> County"
// scope label format used by the React map + useStats layer. This mirrors
// src/lib/scopeLabels.ts but is duplicated here to keep the import helper
// self-contained and serverless-safe.

const normalizeWords = (value) =>
  String(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");

const normalizeScopeLabelLocal = (value) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return normalizeWords(trimmed);
};

const stripOklahomaSuffixLocal = (value) => value.replace(/,\s*Oklahoma$/i, "").trim();
const stripCountySuffixLocal = (value) => value.replace(/\s+County$/i, "").trim();

const formatCountyScopeLabelLocal = (value) => {
  const normalized = normalizeScopeLabelLocal(value);
  if (!normalized) return null;
  const withoutCounty = stripCountySuffixLocal(stripOklahomaSuffixLocal(normalized));
  const base = normalizeScopeLabelLocal(withoutCounty);
  if (!base) return null;
  return `${base} County`;
};

// Build per-county ZIP buckets using the existing InstantDB areas table so we
// don't have to pull in heavy geometry helpers in the serverless import
// functions. This groups each ZIP's value under its parent county scope label.

const getZipToCountyNameMap = async (db) => {
  const LIMIT = 2000; // Plenty for all OK ZIPs while keeping payload manageable
  const resp = await db.query({
    areas: {
      $: {
        where: { kind: "ZIP" },
        fields: ["code", "parentCode"],
        limit: LIMIT,
      },
    },
  });

  const rows = Array.isArray(resp?.areas)
    ? resp.areas
    : Array.isArray(resp?.data?.areas)
    ? resp.data.areas
    : [];

  const map = new Map();
  for (const row of rows) {
    const code = typeof row?.code === "string" ? row.code : null;
    const parentCode = typeof row?.parentCode === "string" ? row.parentCode : null;
    if (!code || !parentCode) continue;
    map.set(code, parentCode);
  }
  return map;
};

export const hydrateCountyZipBucketsFromAreas = async (db, maps) => {
  try {
    const zipToCounty = await getZipToCountyNameMap(db);
    if (!zipToCounty || zipToCounty.size === 0) return;

    const countyZipBuckets = maps.countyZipBuckets || new Map();
    maps.countyZipBuckets = countyZipBuckets;

    const hasZipMoe = maps.zipMoe && maps.zipMoe.size > 0;
    const countyZipMoe = hasZipMoe
      ? maps.countyZipMoe || new Map()
      : undefined;
    if (hasZipMoe && !maps.countyZipMoe) {
      maps.countyZipMoe = countyZipMoe;
    }

    for (const [zip, value] of maps.zip.entries()) {
      const rawCounty = zipToCounty.get(zip);
      const countyKey = formatCountyScopeLabelLocal(rawCounty);
      if (!countyKey) continue;

      let bucket = countyZipBuckets.get(countyKey);
      if (!bucket) {
        bucket = new Map();
        countyZipBuckets.set(countyKey, bucket);
      }
      bucket.set(zip, value);

      if (countyZipMoe) {
        const moeVal = maps.zipMoe.get(zip);
        if (typeof moeVal === "number" && Number.isFinite(moeVal)) {
          let moeBucket = countyZipMoe.get(countyKey);
          if (!moeBucket) {
            moeBucket = new Map();
            countyZipMoe.set(countyKey, moeBucket);
          }
          moeBucket.set(zip, moeVal);
        }
      }
    }
  } catch (error) {
    console.warn(
      "hydrateCountyZipBucketsFromAreas failed; falling back to statewide ZIP bucket only",
      error,
    );
  }
};

// InstantDB admin helpers for serverless import API

const getInstantAppId = () => {
  const appId = process.env.VITE_INSTANT_APP_ID || process.env.INSTANT_APP_ID;
  if (!appId) throw new Error("Missing VITE_INSTANT_APP_ID/INSTANT_APP_ID");
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

export const ensureStatRecord = async (
  db,
  statName,
  variableMeta,
  groupMeta,
  categoryOverride,
  options = {},
) => {
  const now = Date.now();
  const externalId = `census:${variableMeta.name}`;
  const statType = inferStatType(variableMeta);
  const targetCategory = categoryOverride ?? DEFAULT_CATEGORY;
  const derivedLabel = deriveStatLabel(statName, variableMeta, groupMeta);
  const statLabel = derivedLabel && derivedLabel.trim() ? derivedLabel.trim() : null;
  const visibility = typeof options.visibility === "string" ? options.visibility : null;
  const createdBy = typeof options.createdBy === "string" ? options.createdBy : null;

  const byExternal = { stats: { $: { where: { neId: externalId }, limit: 1 } } };
  const ex = await db.query(byExternal);
  const existing = unwrapQuery(ex, "stats")[0];
  if (existing) {
    const updates = { lastUpdated: now };
    if (existing.category !== targetCategory) updates.category = targetCategory;
    if (existing.source !== "Census") updates.source = "Census";
    if (existing.name !== statName) updates.name = statName;
    if ((!existing.label || !String(existing.label).trim()) && statLabel) updates.label = statLabel;
    if (existing.active == null) updates.active = true;
    if (Object.keys(updates).length > 1) await db.transact(tx.stats[existing.id].update(updates));
    return { statId: existing.id, statType };
  }

  const byName = { stats: { $: { where: { name: statName }, limit: 1 } } };
  const res = await db.query(byName);
  const sameName = unwrapQuery(res, "stats")[0];
  if (sameName) {
    const updates = { lastUpdated: now };
    if (!sameName.neId) updates.neId = externalId;
    if (sameName.category !== targetCategory) updates.category = targetCategory;
    if (sameName.source !== "Census") updates.source = "Census";
    if ((!sameName.label || !String(sameName.label).trim()) && statLabel) updates.label = statLabel;
    if (sameName.active == null) updates.active = true;
    await db.transact(tx.stats[sameName.id].update(updates));
    return { statId: sameName.id, statType };
  }

  const statId = id();
  const record = {
    name: statName,
    category: targetCategory,
    neId: externalId,
    source: "Census",
    goodIfUp: null,
    active: true,
    createdOn: now,
    lastUpdated: now,
  };
  if (visibility) {
    record.visibility = visibility;
    record.visibilityEffective = visibility;
  }
  if (createdBy) record.createdBy = createdBy;
  if (statLabel) record.label = statLabel;
  await db.transact(tx.stats[statId].update(record));
  return { statId, statType };
};

const mapToObject = (map) => {
  const obj = {};
  for (const [key, value] of map.entries()) {
    obj[key] = value;
  }
  return obj;
};

const mergeNumberMaps = (existing, incoming) => {
  const merged = { ...(existing || {}) };
  for (const [key, value] of incoming.entries()) {
    merged[key] = value;
  }
  return merged;
};

const buildPayloadKey = (payload) =>
  `${payload.boundaryType}::${payload.parentArea}::${payload.year}::${payload.name ?? "root"}`;

const buildExistingKey = (row) =>
  `${row.boundaryType}::${row.parentArea}::${row.date}::${row.name ?? "root"}`;

const buildSummaryKey = ({ statId, name, parentArea, boundaryType }) =>
  `${statId}::${name ?? "root"}::${parentArea}::${boundaryType}`;

const fetchExistingStatDataMap = async (db, statId, dates) => {
  const dateFilter = Array.from(new Set((dates || []).filter(Boolean).map(String)));
  const resp = await db.query({
    statData: {
      $: {
        where: dateFilter.length ? { statId, date: { $in: dateFilter } } : { statId },
        // Only fetch identifiers to keep the response small; we overwrite data instead of merging.
        fields: ["id", "boundaryType", "parentArea", "date", "name"],
      },
    },
  });
  const rows = unwrapQuery(resp, "statData");
  const map = new Map();
  for (const row of rows) {
    map.set(buildExistingKey(row), row);
  }
  return map;
};

const fetchExistingStatDataSummaryMap = async (db, summaryKeys) => {
  const keys = Array.from(new Set((summaryKeys || []).filter(Boolean)));
  if (keys.length === 0) return new Map();
  const resp = await db.query({
    statDataSummaries: {
      $: {
        where: { summaryKey: { $in: keys } },
        fields: ["id", "summaryKey", "date"],
      },
    },
  });
  const rows = unwrapQuery(resp, "statDataSummaries");
  const map = new Map();
  for (const row of rows) {
    const summaryKey = typeof row?.summaryKey === "string" ? row.summaryKey : null;
    const id = typeof row?.id === "string" ? row.id : null;
    const date = typeof row?.date === "string" ? row.date : null;
    if (!summaryKey || !id) continue;
    map.set(summaryKey, { id, date });
  }
  return map;
};

const computeNumericSummary = (dataMap) => {
  let count = 0;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of dataMap.values()) {
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    count += 1;
    sum += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (count === 0) {
    return { count: 0, sum: 0, avg: 0, min: 0, max: 0 };
  }
  return {
    count,
    sum,
    avg: sum / count,
    min,
    max,
  };
};

// Keep each transact extremely small to avoid 5s admin timeouts.
const MAX_TX_BATCH = 1;

export const applyStatDataPayloads = async (db, payloads) => {
  if (!payloads.length) return;
  const now = Date.now();
  const statId = payloads[0].statId;
  const dates = payloads.map((p) => p.year);
  const existing = await fetchExistingStatDataMap(db, statId, dates);
  const summaryKeys = payloads.map((p) =>
    buildSummaryKey({
      statId: p.statId,
      name: p.name ?? "root",
      parentArea: p.parentArea,
      boundaryType: p.boundaryType,
    }),
  );
  const existingSummaries = await fetchExistingStatDataSummaryMap(db, summaryKeys);
  const operations = [];

  const enqueue = async () => {
    if (operations.length === 0) return;
    const chunk = operations.splice(0, operations.length);
    await db.transact(chunk);
  };

  for (const payload of payloads) {
    const key = buildPayloadKey(payload);
    const existingRow = existing.get(key);
    const baseFields = {
      statId: payload.statId,
      name: payload.name ?? "root",
      statTitle: payload.statName,
      statNameHint: payload.statName,
      parentArea: payload.parentArea,
      boundaryType: payload.boundaryType,
      date: String(payload.year),
      type: payload.statType,
      source: "Census",
      censusVariable: payload.censusVariable,
      censusSurvey: payload.censusSurvey,
      censusUniverse: payload.censusUniverse,
      censusTableUrl: payload.censusTableUrl,
    };

    const targetId = existingRow?.id ?? id();
    const record = {
      ...baseFields,
      data: mapToObject(payload.data),
      lastUpdated: now,
    };
    if (!existingRow) {
      record.createdOn = now;
    }
    if (payload.margin && payload.margin.size) {
      record.marginOfError = mapToObject(payload.margin);
    }

    operations.push(tx.statData[targetId].update(record));
    existing.set(key, { ...record, id: targetId });

    const summaryKey = buildSummaryKey({
      statId: payload.statId,
      name: payload.name ?? "root",
      parentArea: payload.parentArea,
      boundaryType: payload.boundaryType,
    });
    const incomingDate = String(payload.year);
    const existingSummary = existingSummaries.get(summaryKey);
    const shouldUpdateSummary =
      !existingSummary ||
      (typeof existingSummary.date === "string" &&
        incomingDate.localeCompare(existingSummary.date) >= 0);

    if (shouldUpdateSummary) {
      const summary = computeNumericSummary(payload.data);
      const summaryId = existingSummary?.id ?? id();
      const summaryRecord = {
        summaryKey,
        statId: payload.statId,
        name: payload.name ?? "root",
        parentArea: payload.parentArea,
        boundaryType: payload.boundaryType,
        date: incomingDate,
        type: payload.statType,
        count: summary.count,
        sum: summary.sum,
        avg: summary.avg,
        min: summary.min,
        max: summary.max,
        updatedAt: now,
      };
      if (!existingSummary) {
        summaryRecord.createdAt = now;
      }
      operations.push(tx.statDataSummaries[summaryId].update(summaryRecord));
      existingSummaries.set(summaryKey, { id: summaryId, date: incomingDate });
    }

    if (operations.length >= MAX_TX_BATCH) {
      await enqueue();
    }
  }

  await enqueue();
};

export const buildStatDataPayloads = (statId, statName, statType, maps, meta, options) => {
  const payloads = [];
  const payloadName = options && options.name;
  payloads.push({
    statId,
    statName,
    statType,
    parentArea: NORMALIZED_DEFAULT_PARENT_AREA,
    boundaryType: "ZIP",
    data: maps.zip,
    margin: maps.zipMoe.size ? maps.zipMoe : undefined,
    censusVariable: meta.censusVariable,
    censusSurvey: meta.censusSurvey,
    censusUniverse: meta.censusUniverse,
    censusTableUrl: meta.censusTableUrl,
    year: meta.year,
    name: payloadName,
  });
  if (maps && maps.countyZipBuckets && typeof maps.countyZipBuckets.entries === "function") {
    for (const [countyName, bucket] of maps.countyZipBuckets.entries()) {
      if (!bucket || bucket.size === 0) continue;
      const moeBucket =
        maps.countyZipMoe && typeof maps.countyZipMoe.get === "function"
          ? maps.countyZipMoe.get(countyName)
          : undefined;
      payloads.push({
        statId,
        statName,
        statType,
        parentArea: countyName,
        boundaryType: "ZIP",
        data: bucket,
        margin: moeBucket,
        censusVariable: meta.censusVariable,
        censusSurvey: meta.censusSurvey,
        censusUniverse: meta.censusUniverse,
        censusTableUrl: meta.censusTableUrl,
        year: meta.year,
        name: payloadName,
      });
    }
  }
  payloads.push({
    statId,
    statName,
    statType,
    parentArea: NORMALIZED_DEFAULT_PARENT_AREA,
    boundaryType: "COUNTY",
    data: maps.county,
    margin: maps.countyMoe.size ? maps.countyMoe : undefined,
    censusVariable: meta.censusVariable,
    censusSurvey: meta.censusSurvey,
    censusUniverse: meta.censusUniverse,
    censusTableUrl: meta.censusTableUrl,
    year: meta.year,
    name: payloadName,
  });
  return payloads;
};

const unwrapQuery = (result, key) => {
  if (!result) return [];
  if (Array.isArray(result[key])) return result[key];
  if (result.data && Array.isArray(result.data[key])) return result.data[key];
  return [];
};
