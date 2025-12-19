import { URL } from "node:url";

// Lightweight Census helpers for the preview API only.
// This module deliberately avoids importing any app-local geometry or data modules
// so it can run in a serverless environment without bundling src/.

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

const normalizeText = (value) => {
  if (!value) return "";
  return value
    .split(" ")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase())
    .join(" ");
};

const cleanVariableLabel = (label) => {
  if (!label) return "";
  return label
    .replace(/^Estimate!!/i, "")
    .replace(/!!/g, " → ")
    .replace(/:+$/, "")
    .trim();
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

const toNumberOrNull = (value) => {
  if (value == null) return null;
  if (value === "" || value === "null") return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  if (num <= -99999999) return null;
  return num;
};

// Fetch per-variable zip and county counts for the preview UI.
// We restrict counties to Oklahoma (state FIPS 40). For ZIPs we use all ZCTAs,
// since we don't have local geometry here; for preview we just need rough counts.

export const fetchVariableSummaries = async (options, variables) => {
  const result = Object.create(null);
  for (const v of variables) {
    result[v] = { zipCount: 0, countyCount: 0 };
  }
  if (!variables.length) return result;

  const getParams = ["NAME", ...variables];

  // ZIP-level data (all ZCTAs)
  const zipData = await fetchCensusJson(
    options.year,
    options.dataset,
    "",
    {
      get: getParams.join(","),
      for: "zip code tabulation area:*",
    },
    options.debug,
  );
  const [zipHeaders, ...zipRows] = zipData;
  const zipIndexByVar = {};
  for (const v of variables) {
    const idx = zipHeaders.indexOf(v);
    if (idx >= 0) zipIndexByVar[v] = idx;
  }
  for (const row of zipRows) {
    for (const v of variables) {
      const idx = zipIndexByVar[v];
      if (idx == null) continue;
      const raw = row[idx];
      const num = toNumberOrNull(raw);
      if (num != null) {
        result[v].zipCount += 1;
      }
    }
  }

  // County-level data (Oklahoma only, state FIPS 40)
  const countyData = await fetchCensusJson(
    options.year,
    options.dataset,
    "",
    {
      get: getParams.join(","),
      for: "county:*",
      in: "state:40",
    },
    options.debug,
  );
  const [countyHeaders, ...countyRows] = countyData;
  const countyIndexByVar = {};
  for (const v of variables) {
    const idx = countyHeaders.indexOf(v);
    if (idx >= 0) countyIndexByVar[v] = idx;
  }
  for (const row of countyRows) {
    for (const v of variables) {
      const idx = countyIndexByVar[v];
      if (idx == null) continue;
      const raw = row[idx];
      const num = toNumberOrNull(raw);
      if (num != null) {
        result[v].countyCount += 1;
      }
    }
  }

  return result;
};
