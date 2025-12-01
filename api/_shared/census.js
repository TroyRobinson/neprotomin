import { URL } from "node:url";

import { init as initAdmin, id, tx } from "@instantdb/admin";

import {
  ensureAllZipDataLoaded,
  getAllZipCodes,
  getZipCountyId,
  getZipCountyName,
} from "../../src/lib/zipBoundaries";
import { getAllCountyIds, getCountyName } from "../../src/lib/countyBoundaries";
import { normalizeScopeLabel, formatCountyScopeLabel } from "../../src/lib/scopeLabels";

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

const NORMALIZED_DEFAULT_PARENT_AREA =
  normalizeScopeLabel(DEFAULT_PARENT_AREA) ?? DEFAULT_PARENT_AREA;

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
  return {
    group: options.group,
    label: (json && json.label) || (json && json.concept) || options.group,
    concept: (json && json.concept) || (json && json.label) || options.group,
    universe: json && json.universe,
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

const loadZipMetadata = async () => {
  await ensureAllZipDataLoaded();
  const okZips = new Set();
  const zipToCountyId = new Map();
  const zipToCountyName = new Map();
  for (const zip of getAllZipCodes()) {
    if (!isOklahomaZip(zip)) continue;
    okZips.add(zip);
    const countyId = normalizeCountyFips(getZipCountyId(zip));
    const countyName = getZipCountyName(zip);
    if (countyId) zipToCountyId.set(zip, countyId);
    if (countyName) {
      const formatted = formatCountyScopeLabel(countyName);
      const normalized = normalizeScopeLabel(formatted) ?? formatted;
      zipToCountyName.set(zip, normalized);
    }
  }
  return { okZips, zipToCountyId, zipToCountyName };
};

const loadCountyMetadata = () => {
  const ids = getAllCountyIds().map((id) => normalizeCountyFips(id) ?? id);
  const idToName = new Map();
  for (const rawId of ids) {
    const normalizedId = normalizeCountyFips(rawId);
    if (!normalizedId) continue;
    const name = getCountyName(normalizedId);
    if (name) {
      const formatted = formatCountyScopeLabel(name);
      const normalized = normalizeScopeLabel(formatted) ?? formatted;
      idToName.set(normalizedId, normalized);
    }
  }
  return { ids: ids.filter((id) => typeof id === "string"), idToName };
};

export const fetchZipData = async (options, estimates, moeVariables) => {
  if (!estimates.length) return { records: [], okMetadata: await loadZipMetadata() };
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
  if (!headers) return { records: [], okMetadata: await loadZipMetadata() };
  const records = rows.map((row) => {
    const entry = {};
    headers.forEach((key, index) => {
      entry[key] = row[index];
    });
    return entry;
  });
  return { records, okMetadata: await loadZipMetadata() };
};

export const fetchCountyData = async (options, estimates, moeVariables) => {
  if (!estimates.length) return { records: [], countyNames: loadCountyMetadata().idToName };
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
  if (!headers) return { records: [], countyNames: loadCountyMetadata().idToName };
  const records = rows.map((row) => {
    const entry = {};
    headers.forEach((key, index) => {
      entry[key] = row[index];
    });
    return entry;
  });
  return { records, countyNames: loadCountyMetadata().idToName };
};

export const buildDataMaps = (variable, moeVariable, zipPayload, countyPayload) => {
  const estimateKey = variable;
  const moeKey = moeVariable;

  const zipMap = new Map();
  const zipMoeMap = new Map();
  const countyZipMap = new Map();
  const countyZipMoeMap = moeKey ? new Map() : undefined;

  const { okMetadata } = zipPayload;
  const { okZips, zipToCountyId, zipToCountyName } = okMetadata;

  for (const record of zipPayload.records) {
    const zip = record["zip code tabulation area"];
    if (!okZips.has(zip)) continue;
    const estimate = toNumberOrNull(record[estimateKey]);
    if (estimate != null) {
      zipMap.set(zip, estimate);
      const countyId = zipToCountyId.get(zip) ?? null;
      const countyName = zipToCountyName.get(zip) ?? null;
      if (countyName && countyId) {
        const key = `${countyId}::${countyName}`;
        const bucket = countyZipMap.get(key) ?? new Map();
        bucket.set(zip, estimate);
        countyZipMap.set(key, bucket);
      }
    }
    if (moeKey) {
      const moeVal = toNumberOrNull(record[moeKey]);
      if (moeVal != null) {
        zipMoeMap.set(zip, moeVal);
        const countyId = zipToCountyId.get(zip) ?? null;
        const countyName = zipToCountyName.get(zip) ?? null;
        if (countyName && countyId) {
          const key = `${countyId}::${countyName}`;
          const bucket = countyZipMoeMap?.get(key) ?? new Map();
          bucket.set(zip, moeVal);
          countyZipMoeMap?.set(key, bucket);
        }
      }
    }
  }

  const countyMap = new Map();
  const countyMoeMap = new Map();
  for (const record of countyPayload.records) {
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
) => {
  const now = Date.now();
  const externalId = `census:${variableMeta.name}`;
  const statType = inferStatType(variableMeta);
  const targetCategory = categoryOverride ?? DEFAULT_CATEGORY;

  const byExternal = { stats: { $: { where: { neId: externalId }, limit: 1 } } };
  const ex = await db.query(byExternal);
  const existing = unwrapQuery(ex, "stats")[0];
  if (existing) {
    const updates = { lastUpdated: now };
    if (existing.category !== targetCategory) updates.category = targetCategory;
    if (existing.source !== "Census") updates.source = "Census";
    if (existing.name !== statName) updates.name = statName;
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
    await db.transact(tx.stats[sameName.id].update(updates));
    return { statId: sameName.id, statType };
  }

  const statId = id();
  await db.transact(
    tx.stats[statId].update({
      name: statName,
      category: targetCategory,
      neId: externalId,
      source: "Census",
      goodIfUp: null,
      createdOn: now,
      lastUpdated: now,
    }),
  );
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

const fetchExistingStatDataMap = async (db, statId) => {
  const resp = await db.query({
    statData: {
      $: {
        where: { statId },
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

const MAX_TX_BATCH = 20;

export const applyStatDataPayloads = async (db, payloads) => {
  if (!payloads.length) return;
  const now = Date.now();
  const statId = payloads[0].statId;
  const existing = await fetchExistingStatDataMap(db, statId);
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

    if (existingRow) {
      const mergedData = mergeNumberMaps(existingRow.data, payload.data);
      const updates = {
        ...baseFields,
        data: mergedData,
        lastUpdated: now,
      };
      if (payload.margin) {
        updates.marginOfError = mergeNumberMaps(existingRow.marginOfError, payload.margin);
      }
      operations.push(tx.statData[existingRow.id].update(updates));
      existing.set(key, {
        ...existingRow,
        data: mergedData,
        marginOfError: updates.marginOfError ?? existingRow.marginOfError,
      });
    } else {
      const newId = id();
      const record = {
        ...baseFields,
        data: mapToObject(payload.data),
        createdOn: now,
        lastUpdated: now,
      };
      if (payload.margin) {
        record.marginOfError = mapToObject(payload.margin);
      }
      operations.push(tx.statData[newId].update(record));
      existing.set(key, record);
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
  for (const [key, bucket] of maps.countyZipBuckets.entries()) {
    const [countyId, countyName] = key.split("::");
    if (!countyId || !countyName) continue;
    const normalizedCounty = normalizeScopeLabel(countyName) ?? countyName;
    payloads.push({
      statId,
      statName,
      statType,
      parentArea: normalizedCounty,
      boundaryType: "ZIP",
      data: bucket,
      margin: maps.countyZipMoe?.get(key),
      censusVariable: meta.censusVariable,
      censusSurvey: meta.censusSurvey,
      censusUniverse: meta.censusUniverse,
      censusTableUrl: meta.censusTableUrl,
      year: meta.year,
      name: payloadName,
    });
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
