import type { IncomingMessage } from "node:http";

import {
  fetchGroupMetadata,
  resolveVariables,
  deriveStatName,
  deriveStatLabel,
  inferStatType,
  fetchVariableSummaries,
} from "./_shared/censusPreview.js";

const DEFAULT_DATASET = "acs/acs5";

// Infer dataset when the user keeps the default but the group prefix requires a different Census endpoint.
const inferDatasetForGroup = (dataset: string, group: string): { dataset: string; changed: boolean } => {
  const trimmedGroup = (group || "").trim().toUpperCase();
  const normalizedDataset = dataset?.trim() || DEFAULT_DATASET;
  if (!trimmedGroup) return { dataset: normalizedDataset, changed: false };
  // Respect explicit dataset selection
  if (normalizedDataset !== DEFAULT_DATASET) return { dataset: normalizedDataset, changed: false };

  if (trimmedGroup.startsWith("DP")) return { dataset: "acs/acs5/profile", changed: true };
  if (trimmedGroup.startsWith("CP")) return { dataset: "acs/acs5/cprofile", changed: true };
  if (trimmedGroup.startsWith("S")) return { dataset: "acs/acs5/subject", changed: true };
  return { dataset: normalizedDataset, changed: false };
};

type CensusPreviewRequest = IncomingMessage & {
  method?: string;
  query?: Record<string, string | string[]>;
};

type CensusPreviewResponse = {
  status: (code: number) => CensusPreviewResponse;
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

  let datasetUsed = DEFAULT_DATASET;
  let groupUsed = "";

  try {
    const query = req.query ?? {};

    const rawDataset = normalizeQueryString(query.dataset) ?? DEFAULT_DATASET;
    const group = normalizeQueryString(query.group);
    groupUsed = group ?? "";
    const { dataset } = inferDatasetForGroup(rawDataset, group ?? "");
    datasetUsed = dataset;
    const year = parseYear(normalizeQueryString(query.year));
    const limit = parseLimit(normalizeQueryString(query.limit));

    if (!group) {
      respond(res, 400, { error: "Missing required 'group' parameter." });
      return;
    }

    const survey = dataset.split("/").pop() || "acs5";

    const options: CensusOptions = {
      dataset,
      survey,
      group,
      variables: [],
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
        universe: groupMeta.universe ?? null,
        concept: groupMeta.concept ?? groupMeta.label ?? null,
        totalVariables: 0,
        variables: [],
      });
      return;
    }

    const previewVars = estimates.slice(0, limit);

    const summaries = await fetchVariableSummaries(options, previewVars);

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
      const statLabel = deriveStatLabel(statName, variableMeta, groupMeta);
      const statType = inferStatType(variableMeta);
      const summary = summaries[variable] || { zipCount: 0, countyCount: 0 };

      variables.push({
        name: variable,
        label: variableMeta.label,
        concept: variableMeta.concept,
        predicateType: variableMeta.predicateType,
        inferredType: statType,
        statName,
        statLabel,
        zipCount: summary.zipCount,
        countyCount: summary.countyCount,
      });
    }

    respond(res, 200, {
      dataset,
      group,
      year,
      universe: groupMeta.universe ?? null,
      concept: groupMeta.concept ?? groupMeta.label ?? null,
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
    const status =
      typeof message === "string" && message.startsWith("Census HTTP 404") ? 404 : 500;
    respond(res, status, {
      error: "Failed to load Census preview.",
      details: message,
      dataset: datasetUsed,
      group: groupUsed,
    });
  }
}
