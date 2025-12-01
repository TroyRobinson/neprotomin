import type { IncomingMessage } from "node:http";

import {
  fetchGroupMetadata,
  resolveVariables,
  fetchZipData,
  fetchCountyData,
  buildDataMaps,
  summarizeDataMaps,
  deriveStatName,
  inferStatType,
} from "../scripts/census/censusUtils";

type CensusPreviewRequest = IncomingMessage & {
  method?: string;
  query?: Record<string, string | string[]>;
};

type CensusPreviewResponse = {
  status: (code: number) => CensusPreviewResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

const respond = (res: CensusPreviewResponse, statusCode: number, payload: unknown): void => {
  res.setHeader("Content-Type", "application/json");
  res.status(statusCode).json(payload);
};

const normalizeQueryString = (value: string | string[] | undefined | null): string | null => {
  if (Array.isArray(value)) {
    return value.length > 0 ? normalizeQueryString(value[0]) : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseYear = (raw: string | null): number => {
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  const now = new Date();
  return now.getUTCFullYear() - 2;
};

const parseLimit = (raw: string | null): number => {
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.min(25, parsed));
    }
  }
  return 10;
};

export default async function handler(req: CensusPreviewRequest, res: CensusPreviewResponse) {
  if (req.method !== "GET") {
    respond(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const query = req.query ?? {};

    const dataset = normalizeQueryString(query.dataset) ?? "acs/acs5";
    const group = normalizeQueryString(query.group);
    const year = parseYear(normalizeQueryString(query.year));
    const limit = parseLimit(normalizeQueryString(query.limit));

    if (!group) {
      respond(res, 400, { error: "Missing required 'group' parameter." });
      return;
    }

    const survey = dataset.split("/").pop() || "acs5";

    const options = {
      dataset,
      survey,
      group,
      variables: [] as string[],
      year,
      years: 1,
      includeMoe: false,
      dryRun: false,
      debug: false,
      limit,
    };

    const groupMeta = await fetchGroupMetadata(options);
    const { estimates } = resolveVariables(options, groupMeta);

    if (!estimates.length) {
      respond(res, 200, {
        dataset,
        group,
        year,
        totalVariables: 0,
        variables: [],
      });
      return;
    }

    const previewVars = estimates.slice(0, limit);

    const zipPayload = await fetchZipData(options, previewVars, []);
    const countyPayload = await fetchCountyData(options, previewVars, []);

    const variables = [] as Array<{
      name: string;
      label: string;
      concept?: string;
      predicateType?: string;
      inferredType: string;
      statName: string;
      zipCount: number;
      countyCount: number;
    }>;

    for (const variable of previewVars) {
      const variableMeta = groupMeta.variables.get(variable);
      if (!variableMeta) continue;

      const statName = deriveStatName(variable, variableMeta, groupMeta);
      const statType = inferStatType(variableMeta);
      const maps = buildDataMaps(variable, null, zipPayload, countyPayload);
      const summary = summarizeDataMaps(maps);

      variables.push({
        name: variable,
        label: variableMeta.label,
        concept: variableMeta.concept,
        predicateType: variableMeta.predicateType,
        inferredType: statType,
        statName,
        zipCount: summary.zipCount,
        countyCount: summary.countyCount,
      });
    }

    respond(res, 200, {
      dataset,
      group,
      year,
      totalVariables: estimates.length,
      variables,
    });
  } catch (error) {
    console.error("census-preview failed", error);
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
        ? error
        : "Unknown error";
    respond(res, 500, {
      error: "Failed to load Census preview.",
      details: message,
    });
  }
}
