import type { IncomingMessage } from "node:http";

import {
  fetchGroupMetadata,
  resolveVariables,
  fetchZipData,
  fetchCountyData,
  buildDataMaps,
  buildStatDataPayloads,
  createInstantClient,
  ensureStatRecord,
  applyStatDataPayloads,
  deriveStatName,
  CENSUS_TABLE_DOC_URL,
} from "./_shared/census.js";

type CensusImportRequest = IncomingMessage & {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[]>;
  headers: Record<string, string | string[] | undefined>;
};

type CensusImportResponse = {
  status: (code: number) => CensusImportResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

type CensusOptions = {
  dataset: string;
  survey: string;
  group: string;
  variables: string[];
  year: number;
  years: number;
  includeMoe: boolean;
  dryRun: boolean;
  debug: boolean;
  limit: number;
};

type CensusImportBody = {
  dataset?: unknown;
  group?: unknown;
  variable?: unknown;
  year?: unknown;
  years?: unknown;
  includeMoe?: unknown;
  category?: unknown;
};

const respond = (res: CensusImportResponse, statusCode: number, payload: unknown): void => {
  res.setHeader("Content-Type", "application/json");
  res.status(statusCode).json(payload);
};

const parseBody = async (req: CensusImportRequest): Promise<CensusImportBody> => {
  if (typeof req.body === "string") {
    return JSON.parse(req.body) as CensusImportBody;
  }
  if (req.body && typeof req.body === "object") {
    return req.body as CensusImportBody;
  }
  if (typeof (req as any).on !== "function") {
    return {};
  }
  const data = await new Promise<string>((resolve, reject) => {
    let buffer = "";
    const decoder = new TextDecoder();
    (req as any).on("data", (chunk: unknown) => {
      if (typeof chunk === "string") {
        buffer += chunk;
        return;
      }
      if (chunk instanceof Uint8Array) {
        buffer += decoder.decode(chunk);
        return;
      }
      if (Array.isArray(chunk)) {
        buffer += decoder.decode(Uint8Array.from(chunk as number[]));
        return;
      }
      buffer += String(chunk);
    });
    (req as any).on("end", () => resolve(buffer));
    (req as any).on("error", (error: Error) => reject(error));
  });
  if (!data) return {};
  return JSON.parse(data) as CensusImportBody;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const parseYear = (raw: unknown): number => {
  const str = normalizeString(raw);
  if (str) {
    const parsed = Number(str);
    if (Number.isFinite(parsed)) return parsed;
  }
  const now = new Date();
  return now.getUTCFullYear() - 2;
};

const parseYears = (raw: unknown): number => {
  const str = normalizeString(raw);
  if (str) {
    const parsed = Number(str);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.min(5, parsed));
    }
  }
  return 1;
};

const parseBoolean = (raw: unknown, defaultValue: boolean): boolean => {
  if (typeof raw === "boolean") return raw;
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    if (v === "1" || v === "true" || v === "yes") return true;
    if (v === "0" || v === "false" || v === "no") return false;
  }
  return defaultValue;
};

const allowedCategories = new Set<string>([
  "food",
  "demographics",
  "health",
  "education",
  "economy",
  "housing",
  "justice",
]);

const coerceCategory = (raw: unknown): string => {
  const value = normalizeString(raw) ?? "demographics";
  return allowedCategories.has(value) ? value : "demographics";
};

const buildYearRange = (start: number, count: number): number[] => {
  const years: number[] = [];
  for (let i = 0; i < count; i += 1) {
    years.push(start - i);
  }
  return years;
};

export default async function handler(req: CensusImportRequest, res: CensusImportResponse) {
  if (req.method !== "POST") {
    respond(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = await parseBody(req);

    const dataset = normalizeString(body.dataset) ?? "acs/acs5";
    const group = normalizeString(body.group);
    const variable = normalizeString(body.variable);

    if (!group) {
      respond(res, 400, { error: "Missing required 'group' field." });
      return;
    }
    if (!variable) {
      respond(res, 400, { error: "Missing required 'variable' field." });
      return;
    }

    const year = parseYear(body.year);
    const years = parseYears(body.years);
    const includeMoe = parseBoolean(body.includeMoe, false);
    const category = coerceCategory(body.category);

    const survey = dataset.split("/").pop() || "acs5";

    const db = createInstantClient();

    const baseOptions: CensusOptions = {
      dataset,
      survey,
      group,
      variables: [variable],
      year,
      years: 1,
      includeMoe,
      dryRun: false,
      debug: false,
      limit: 1,
    };

    const allPayloads: any[] = [];
    const yearsProcessed: number[] = [];

    let statId: string | null = null;
    let statName: string | null = null;
    let statType: string | null = null;

    const yearRange = buildYearRange(year, years);

    for (const y of yearRange) {
      const options = { ...baseOptions, year: y };

      const groupMeta = await fetchGroupMetadata(options);
      const { estimates, moeMap } = resolveVariables(options, groupMeta);

      if (!estimates.includes(variable)) {
        throw new Error(`Variable ${variable} is not available in group ${group} for year ${y}.`);
      }

      const variableMeta = groupMeta.variables.get(variable);
      if (!variableMeta) {
        throw new Error(`Variable metadata not found for ${variable} in group ${group} for year ${y}.`);
      }

      const moeVariables = includeMoe ? Array.from(moeMap.values()) : [];
      const zipPayload = await fetchZipData(options, [variable], moeVariables);
      const countyPayload = await fetchCountyData(options, [variable], moeVariables);

      const maps = buildDataMaps(variable, includeMoe ? moeMap.get(variable) ?? null : null, zipPayload, countyPayload);

      const derivedStatName = deriveStatName(variable, variableMeta, groupMeta);

      if (!statId || !statType || !statName) {
        const ensured = await ensureStatRecord(db, derivedStatName, variableMeta, groupMeta, category);
        statId = ensured.statId;
        statType = ensured.statType;
        statName = derivedStatName;
      }

      const payloads = buildStatDataPayloads(statId, statName, statType, maps, {
        censusVariable: variable,
        censusSurvey: options.survey,
        censusUniverse: groupMeta.universe,
        censusTableUrl: CENSUS_TABLE_DOC_URL(y, options.dataset, options.group),
        year: y,
      });

      allPayloads.push(...payloads);
      yearsProcessed.push(y);
    }

    if (!statId || !statName || !statType) {
      throw new Error("Failed to create or locate stat record.");
    }

    await applyStatDataPayloads(db, allPayloads);

    respond(res, 201, {
      ok: true,
      statId,
      statName,
      statType,
      yearsProcessed: Array.from(new Set(yearsProcessed)).sort(),
      variable,
      dataset,
      group,
      includeMoe,
      category,
    });
  } catch (error) {
    console.error("census-import failed", error);
    respond(res, 500, { error: "Failed to import Census stat." });
  }
}
