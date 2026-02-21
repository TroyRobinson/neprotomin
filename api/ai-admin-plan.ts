import type { IncomingMessage } from "node:http";

import {
  AI_ADMIN_DEFAULT_CAPS,
  validateAiAdminPlanRequest,
  type AiAdminAction,
} from "./_shared/aiAdminPlan.ts";
import { createAiAdminDb, findExistingStatConflicts } from "./_shared/aiAdminActions.ts";
import {
  deriveStatName,
  fetchGroupMetadata,
  fetchVariableSummaries,
  inferStatType,
  resolveVariables,
} from "./_shared/censusPreview.js";
import { suggestCensusWithAI } from "./ai-census-suggest.ts";

type AiAdminPlanRequest = IncomingMessage & {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  on?: (event: "data" | "end" | "error", listener: (...args: unknown[]) => void) => void;
};

type AiAdminPlanResponse = {
  status: (code: number) => AiAdminPlanResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

type CensusGroupMatch = {
  name: string;
  description: string;
  score: number;
};

type ImportCandidate = {
  dataset: string;
  year: number;
  group: string;
  variables: string[];
  reason: string;
};

type VariableEvidence = {
  variable: string;
  label: string;
  statName: string;
  inferredType: string;
  available: boolean;
  zipCount: number;
  countyCount: number;
};

type ImportEvidence = {
  status: "ok" | "error";
  dataset: string;
  year: number;
  group: string;
  concept: string | null;
  universe: string | null;
  tableUrl: string;
  reason: string;
  variables: VariableEvidence[];
  missingVariables: string[];
  error?: string;
};

type DerivedFormula =
  | "percent"
  | "sum"
  | "difference"
  | "rate_per_1000"
  | "ratio"
  | "index"
  | "change_over_time";

type DerivedPlanCandidate = {
  name: string;
  formula: DerivedFormula;
  numeratorVariable: string | null;
  denominatorVariable: string | null;
  sumOperandVariables: string[];
  reason: string;
};

type FamilyPlanCandidate = {
  parentName: string;
  childNames: string[];
  statAttribute: string | null;
  reason: string;
};

type PlannedIntent = {
  confidence: number;
  notes: string;
  imports: ImportCandidate[];
  derived: DerivedPlanCandidate[];
  families: FamilyPlanCandidate[];
};

type PlanFromModelInput = {
  prompt: string;
  dataset: string;
  year: number;
};

type PlanHandlerDeps = {
  planFromModel?: (input: PlanFromModelInput) => Promise<PlannedIntent | null>;
  searchGroups?: (dataset: string, year: number, prompt: string, limit: number) => Promise<CensusGroupMatch[]>;
  inspectImportCandidate?: (candidate: ImportCandidate) => Promise<ImportEvidence>;
  detectPreflightConflicts?: (actions: AiAdminAction[]) => Promise<
    Array<{
      actionId: string;
      actionType: string;
      reason: string;
      statId?: string;
      statName?: string;
      neId?: string;
      detail: string;
    }>
  >;
  now?: () => number;
};

const DEFAULT_DATASET = "acs/acs5";
const DEFAULT_YEAR = 2023;
const MAX_GROUP_RESULTS = 8;
const MAX_IMPORT_CANDIDATES = 6;
const MAX_DERIVED_CANDIDATES = 4;
const MAX_FAMILY_CANDIDATES = 4;
const MAX_VARIABLES_PER_IMPORT = 3;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENROUTER_MODEL = "anthropic/claude-3.5-sonnet";
const RESEARCH_DATASETS = new Set(["cbp", "abscb"]);
const RESEARCH_NON_MEASURE_VARIABLES = new Set(["NAME", "GEO_ID", "GEO_ID_F", "YEAR"]);
const RESEARCH_LABEL_EXCLUDE_PATTERNS = [
  /^flag for\b/i,
  /\bmeaning of\b/i,
  /\bstandard error\b/i,
  /\brelative standard error\b/i,
  /\bnoise range\b/i,
  /\bindustry level\b/i,
];

const ALLOWED_FORMULAS = new Set<DerivedFormula>([
  "percent",
  "sum",
  "difference",
  "rate_per_1000",
  "ratio",
  "index",
  "change_over_time",
]);

const respond = (res: AiAdminPlanResponse, statusCode: number, payload: unknown): void => {
  res.setHeader("Content-Type", "application/json");
  res.status(statusCode).json(payload);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseYear = (value: unknown, fallback: number): number => {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(raw)) return fallback;
  const year = Math.trunc(raw);
  if (year < 2005) return 2005;
  if (year > 2100) return 2100;
  return year;
};

const parsePrompt = (value: unknown): string | null => normalizeString(value);

const stripHtmlTags = (value: string): string =>
  value
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const summarizeImportError = (value: string): string => {
  const text = value.trim();
  const httpMatch = text.match(/^Census HTTP\s+(\d+)\s*:\s*([\s\S]*)$/i);
  if (httpMatch) {
    const status = httpMatch[1];
    const detail = stripHtmlTags(httpMatch[2] ?? "");
    if (status === "404") {
      return "Census API returned HTTP 404 while validating this table/group. It is not available for the selected dataset/year.";
    }
    if (!detail) {
      return `Census API returned HTTP ${status} while validating this table/group.`;
    }
    const clipped = detail.length > 160 ? `${detail.slice(0, 157)}...` : detail;
    return `Census API returned HTTP ${status}: ${clipped}`;
  }

  const flattened = stripHtmlTags(text);
  if (!flattened) return "Census metadata validation failed for this import candidate.";
  return flattened.length > 180 ? `${flattened.slice(0, 177)}...` : flattened;
};

const parseBody = async (req: AiAdminPlanRequest): Promise<Record<string, unknown>> => {
  if (typeof req.body === "string") {
    return JSON.parse(req.body) as Record<string, unknown>;
  }
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    return req.body as Record<string, unknown>;
  }
  if (!req.on) return {};

  const text = await new Promise<string>((resolve, reject) => {
    let buffer = "";
    const decoder = new TextDecoder();
    req.on?.("data", (chunk: unknown) => {
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
    req.on?.("end", () => resolve(buffer));
    req.on?.("error", (error: unknown) => reject(error));
  });

  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
};

const splitEntries = (value?: string | null): string[] => {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
};

const resolveEnv = (key: string): string | undefined => {
  const value = process.env[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const readApiKeyFromRequest = (req: AiAdminPlanRequest): string | null => {
  const direct = req.headers["x-ai-admin-api-key"];
  if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();
  if (Array.isArray(direct) && direct[0] && direct[0].trim().length > 0) return direct[0].trim();

  const auth = req.headers.authorization;
  const header = typeof auth === "string" ? auth : Array.isArray(auth) && auth[0] ? auth[0] : "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
};

const isProduction = (): boolean => {
  const mode = normalizeString(process.env.NODE_ENV) ?? "development";
  return mode === "production";
};

const getConfiguredApiKey = (): string | null =>
  resolveEnv("AI_ADMIN_API_KEY") ?? resolveEnv("VITE_AI_ADMIN_API_KEY") ?? null;

const isAdminEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  const adminEmails = new Set<string>([
    ...splitEntries(resolveEnv("ADMIN_EMAIL") ?? null),
    ...splitEntries(resolveEnv("VITE_ADMIN_EMAIL") ?? null),
  ]);
  if (adminEmails.has(normalized)) return true;

  const atIndex = normalized.lastIndexOf("@");
  if (atIndex === -1) return false;
  const domain = normalized.slice(atIndex + 1);
  if (!domain) return false;

  const adminDomains = new Set<string>(
    [...splitEntries(resolveEnv("ADMIN_DOMAIN") ?? null), ...splitEntries(resolveEnv("VITE_ADMIN_DOMAIN") ?? null)].map(
      (candidate) => (candidate.startsWith("@") ? candidate.slice(1) : candidate),
    ),
  );

  return adminDomains.has(domain);
};

const authorizeRequest = (
  req: AiAdminPlanRequest,
  callerEmail: string | null,
): { ok: boolean; reason?: string } => {
  const configuredApiKey = getConfiguredApiKey();
  if (configuredApiKey) {
    const supplied = readApiKeyFromRequest(req);
    if (supplied && supplied === configuredApiKey) return { ok: true };
    return { ok: false, reason: "invalid_api_key" };
  }

  // Local fallback for dev/test if no API key is configured.
  if (!isProduction() && isAdminEmail(callerEmail)) return { ok: true };

  return {
    ok: false,
    reason: isProduction() ? "missing_api_key_configuration" : "admin_email_required",
  };
};

const extractFirstJsonObject = (text: string): string | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
};

const normalizeGroupId = (value: unknown): string | null => {
  const cleaned = normalizeString(value)?.toUpperCase();
  if (!cleaned) return null;
  if (!/^[A-Z0-9]+$/.test(cleaned)) return null;
  if (cleaned.length < 2 || cleaned.length > 12) return null;
  if (!/\d/.test(cleaned)) return null;
  return cleaned;
};

const normalizeVariableId = (value: unknown, dataset = DEFAULT_DATASET): string | null => {
  const cleaned = normalizeString(value)?.toUpperCase();
  if (!cleaned) return null;
  if (!/^[A-Z0-9_]+$/.test(cleaned)) return null;
  if (RESEARCH_DATASETS.has(dataset)) {
    if (RESEARCH_NON_MEASURE_VARIABLES.has(cleaned)) return null;
    if (cleaned.endsWith("_F") || cleaned.endsWith("_LABEL")) return null;
    return cleaned;
  }
  if (!/[EM]$/.test(cleaned)) return null;
  return cleaned;
};

const normalizeConfidence = (value: unknown, fallback: number): number => {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
};

const inferDatasetForGroup = (dataset: string, group: string): string => {
  const normalizedDataset = normalizeString(dataset) ?? DEFAULT_DATASET;
  const normalizedGroup = normalizeGroupId(group) ?? "";
  if (!normalizedGroup) return normalizedDataset;
  if (normalizedDataset !== DEFAULT_DATASET) return normalizedDataset;

  if (normalizedGroup.startsWith("DP")) return "acs/acs5/profile";
  if (normalizedGroup.startsWith("CP")) return "acs/acs5/cprofile";
  if (normalizedGroup.startsWith("S")) return "acs/acs5/subject";
  return normalizedDataset;
};

const isResearchDataset = (dataset: string): boolean => RESEARCH_DATASETS.has(dataset);

const isResearchMeasureVariable = (
  variableName: string,
  variable: { label?: string; predicateType?: string } | undefined,
): boolean => {
  const name = normalizeString(variableName)?.toUpperCase() ?? "";
  if (!name || RESEARCH_NON_MEASURE_VARIABLES.has(name)) return false;
  if (name.endsWith("_F") || name.endsWith("_LABEL")) return false;
  if (/_N($|_)/.test(name)) return false;
  const label = normalizeString(variable?.label) ?? "";
  if (RESEARCH_LABEL_EXCLUDE_PATTERNS.some((pattern) => pattern.test(label))) return false;

  const predicate = normalizeString(variable?.predicateType)?.toLowerCase();
  if (predicate === "int" || predicate === "integer" || predicate === "float" || predicate === "double") {
    return true;
  }
  if (
    predicate === "string" &&
    (/\bnaics\b/i.test(label) || /\bemployment size\b/i.test(label) || /\bindustry\b/i.test(label))
  ) {
    return true;
  }
  return false;
};

const prioritizeResearchVariables = (variables: string[]): string[] => {
  const priorityOrder = ["ESTAB", "EMP", "PAYANN", "FIRMPDEMP", "RCPPDEMP", "EMPSZES", "EMPSZFI", "SECTOR", "NAICS2017", "NAICS2022"];
  const priorityRank = new Map(priorityOrder.map((entry, index) => [entry, index]));
  return [...variables].sort((left, right) => {
    const leftRank = priorityRank.get(left);
    const rightRank = priorityRank.get(right);
    if (leftRank == null && rightRank == null) return left.localeCompare(right);
    if (leftRank == null) return 1;
    if (rightRank == null) return -1;
    return leftRank - rightRank;
  });
};

const deriveResearchFallbackVariables = (
  variables: Map<string, { label?: string; predicateType?: string }> | undefined,
): string[] => {
  if (!(variables instanceof Map)) return [];
  const candidates = Array.from(variables.entries())
    .filter(([name, variable]) => isResearchMeasureVariable(name, variable))
    .map(([name]) => name);
  return prioritizeResearchVariables(candidates);
};

const CENSUS_TABLE_DOC_URL = (year: number, dataset: string, group: string) =>
  `https://api.census.gov/data/${year}/${dataset}/groups/${group}.html`;

const defaultModelPlanning = async ({ prompt, dataset, year }: PlanFromModelInput): Promise<PlannedIntent | null> => {
  const apiKey = process.env.OPENROUTER ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const planningPrompt = `You are planning create-only admin actions for a US Census stats app.\n\nGiven the user request, produce a strict JSON object with this exact shape:\n{\n  "confidence": 0.0,\n  "notes": "short note",\n  "imports": [\n    {\n      "dataset": "acs/acs5",\n      "year": 2023,\n      "group": "B01001",\n      "variables": ["B01001_001E"],\n      "reason": "why this import"\n    }\n  ],\n  "derived": [\n    {\n      "name": "Example Derived",\n      "formula": "percent",\n      "numeratorVariable": "B01001_002E",\n      "denominatorVariable": "B01001_001E",\n      "sumOperandVariables": [],\n      "reason": "why this derived"\n    }\n  ],\n  "families": [\n    {\n      "parentName": "Demographics",\n      "childNames": ["Example Derived"],\n      "statAttribute": "Total",\n      "reason": "why this family"\n    }\n  ]\n}\n\nRules:\n- Allowed formulas: percent, sum, difference, rate_per_1000, ratio, index, change_over_time\n- Use only create intents.\n- Keep imports <= 6 and variables per import <= 3.\n- Use dataset ${dataset} and year ${year} unless a different group prefix requires another ACS endpoint.\n- For imports, \"group\" must be a real Census table group id (e.g., B01001, C24070, CB2300CBP), never a variable id.\n- If uncertain, leave imports empty instead of guessing.\n- Return JSON only, no markdown, no explanations.\n\nUser request: \"${prompt}\"`;

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://neprotomin.app",
    },
    body: JSON.stringify({
      model: DEFAULT_OPENROUTER_MODEL,
      messages: [{ role: "user", content: planningPrompt }],
      temperature: 0.2,
      max_tokens: 900,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenRouter planning failed (${response.status}): ${text || response.statusText}`);
  }

  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) return null;

  const jsonText = extractFirstJsonObject(content) ?? content;
  const parsed = JSON.parse(jsonText) as Record<string, unknown>;
  if (!isRecord(parsed)) return null;

  const importsRaw = Array.isArray(parsed.imports) ? parsed.imports : [];
  const derivedRaw = Array.isArray(parsed.derived) ? parsed.derived : [];
  const familiesRaw = Array.isArray(parsed.families) ? parsed.families : [];

  const imports: ImportCandidate[] = [];
  for (const raw of importsRaw.slice(0, MAX_IMPORT_CANDIDATES)) {
    if (!isRecord(raw)) continue;
    const group = normalizeGroupId(raw.group);
    if (!group) continue;
    const normalizedDataset = inferDatasetForGroup(normalizeString(raw.dataset) ?? dataset, group);
    const variables = Array.isArray(raw.variables)
      ? raw.variables
          .map((entry) => normalizeVariableId(entry, normalizedDataset))
          .filter((entry): entry is string => Boolean(entry))
          .slice(0, MAX_VARIABLES_PER_IMPORT)
      : [];
    imports.push({
      dataset: normalizedDataset,
      year: parseYear(raw.year, year),
      group,
      variables,
      reason: normalizeString(raw.reason) ?? "Model-recommended Census import.",
    });
  }

  const derived: DerivedPlanCandidate[] = [];
  for (const raw of derivedRaw.slice(0, MAX_DERIVED_CANDIDATES)) {
    if (!isRecord(raw)) continue;
    const formulaValue = normalizeString(raw.formula) as DerivedFormula | null;
    const formula = formulaValue && ALLOWED_FORMULAS.has(formulaValue) ? formulaValue : "percent";
    const sumOperandVariables = Array.isArray(raw.sumOperandVariables)
      ? raw.sumOperandVariables
          .map((entry) => normalizeVariableId(entry))
          .filter((entry): entry is string => Boolean(entry))
          .slice(0, MAX_IMPORT_CANDIDATES)
      : [];
    const name = normalizeString(raw.name);
    if (!name) continue;
    derived.push({
      name,
      formula,
      numeratorVariable: normalizeVariableId(raw.numeratorVariable),
      denominatorVariable: normalizeVariableId(raw.denominatorVariable),
      sumOperandVariables,
      reason: normalizeString(raw.reason) ?? "Model-recommended derived stat.",
    });
  }

  const families: FamilyPlanCandidate[] = [];
  for (const raw of familiesRaw.slice(0, MAX_FAMILY_CANDIDATES)) {
    if (!isRecord(raw)) continue;
    const parentName = normalizeString(raw.parentName);
    if (!parentName) continue;
    const childNames = Array.isArray(raw.childNames)
      ? raw.childNames
          .map((entry) => normalizeString(entry))
          .filter((entry): entry is string => Boolean(entry))
          .slice(0, MAX_IMPORT_CANDIDATES)
      : [];
    if (childNames.length === 0) continue;
    families.push({
      parentName,
      childNames,
      statAttribute: normalizeString(raw.statAttribute),
      reason: normalizeString(raw.reason) ?? "Model-recommended family grouping.",
    });
  }

  return {
    confidence: normalizeConfidence(parsed.confidence, 0.45),
    notes: normalizeString(parsed.notes) ?? "Model-generated planning intent.",
    imports,
    derived,
    families,
  };
};

const fetchGroups = async (dataset: string, year: number): Promise<Array<{ name: string; description: string }>> => {
  const apiKey = process.env.CENSUS_API_KEY ?? "";
  const url = `https://api.census.gov/data/${year}/${dataset}/groups.json${apiKey ? `?key=${apiKey}` : ""}`;
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Census HTTP ${response.status}: ${text || response.statusText}`);
  }
  const json = (await response.json()) as { groups?: Array<{ name?: string; description?: string }> };
  const rawGroups = json.groups ?? [];
  return rawGroups
    .filter((group): group is { name: string; description: string } => typeof group.name === "string")
    .map((group) => ({
      name: group.name,
      description: typeof group.description === "string" ? group.description : group.name,
    }));
};

const scoreGroupMatch = (group: { name: string; description: string }, searchTerms: string[]): number => {
  let score = 0;
  const nameLower = group.name.toLowerCase();
  const descLower = group.description.toLowerCase();

  for (const term of searchTerms) {
    if (nameLower === term) score += 100;
    else if (nameLower.startsWith(term)) score += 50;
    else if (nameLower.includes(term)) score += 25;

    if (descLower.includes(` ${term}`) || descLower.startsWith(term)) score += 10;
    else if (descLower.includes(term)) score += 5;
  }

  return score;
};

const defaultSearchGroups = async (
  dataset: string,
  year: number,
  prompt: string,
  limit: number,
): Promise<CensusGroupMatch[]> => {
  const groups = await fetchGroups(dataset, year);
  const searchTerms = prompt
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  return groups
    .map((group) => ({ ...group, score: scoreGroupMatch(group, searchTerms) }))
    .filter((group) => group.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(MAX_GROUP_RESULTS, limit)));
};

const defaultInspectImportCandidate = async (candidate: ImportCandidate): Promise<ImportEvidence> => {
  const dataset = inferDatasetForGroup(candidate.dataset, candidate.group);
  const year = parseYear(candidate.year, DEFAULT_YEAR);
  const options = {
    dataset,
    survey: dataset.split("/").pop() || "acs5",
    group: candidate.group,
    variables: candidate.variables,
    year,
    years: 1,
    includeMoe: false,
    dryRun: false,
    debug: false,
    limit: 10,
  };

  try {
    const groupMeta = await fetchGroupMetadata(options);
    const resolved = resolveVariables(options, groupMeta);
    let estimates = Array.isArray(resolved.estimates)
      ? resolved.estimates.filter((entry: unknown): entry is string => typeof entry === "string")
      : [];
    if (estimates.length === 0 && isResearchDataset(dataset)) {
      estimates = deriveResearchFallbackVariables(
        groupMeta.variables as Map<string, { label?: string; predicateType?: string }>,
      );
    }
    const requested: string[] = candidate.variables.length > 0 ? candidate.variables : estimates.slice(0, 1);
    const availableSet = new Set<string>(estimates);
    const availableVariables = requested
      .filter((variable: string) => availableSet.has(variable))
      .slice(0, MAX_VARIABLES_PER_IMPORT);
    const missingVariables = requested.filter((variable: string) => !availableSet.has(variable));
    const summaries = await fetchVariableSummaries(options, availableVariables);

    const variables: VariableEvidence[] = [];
    for (const variable of requested) {
      const variableMeta = groupMeta.variables.get(variable);
      const available = Boolean(variableMeta) && availableSet.has(variable);
      variables.push({
        variable,
        label: variableMeta?.label ?? "",
        statName: variableMeta ? deriveStatName(variable, variableMeta, groupMeta) : variable,
        inferredType: variableMeta ? inferStatType(variableMeta) : "count",
        available,
        zipCount: available ? summaries[variable]?.zipCount ?? 0 : 0,
        countyCount: available ? summaries[variable]?.countyCount ?? 0 : 0,
      });
    }

    return {
      status: "ok",
      dataset,
      year,
      group: candidate.group,
      concept: groupMeta.concept ?? null,
      universe: groupMeta.universe ?? null,
      tableUrl: CENSUS_TABLE_DOC_URL(year, dataset, candidate.group),
      reason: candidate.reason,
      variables,
      missingVariables,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to inspect Census group.";
    const summary = summarizeImportError(message);
    return {
      status: "error",
      dataset,
      year,
      group: candidate.group,
      concept: null,
      universe: null,
      tableUrl: CENSUS_TABLE_DOC_URL(year, dataset, candidate.group),
      reason: candidate.reason,
      variables: [],
      missingVariables: [...candidate.variables],
      error: summary,
    };
  }
};

const defaultDetectPreflightConflicts = async (actions: AiAdminAction[]) => {
  const db = createAiAdminDb();
  return findExistingStatConflicts(db, actions);
};

const sanitizeImportCandidate = (
  candidate: ImportCandidate,
  defaults: { dataset: string; year: number },
): ImportCandidate | null => {
  const group = normalizeGroupId(candidate.group);
  if (!group) return null;
  const normalizedDataset = inferDatasetForGroup(normalizeString(candidate.dataset) ?? defaults.dataset, group);
  const normalizedVariables = (candidate.variables ?? [])
    .map((entry) => normalizeVariableId(entry, normalizedDataset))
    .filter((entry): entry is string => Boolean(entry))
    .slice(0, MAX_VARIABLES_PER_IMPORT);
  return {
    dataset: normalizedDataset,
    year: parseYear(candidate.year, defaults.year),
    group,
    variables: normalizedVariables,
    reason: normalizeString(candidate.reason) ?? "Model-recommended Census import.",
  };
};

const dedupeImportCandidates = (input: ImportCandidate[]): ImportCandidate[] => {
  const seen = new Set<string>();
  const out: ImportCandidate[] = [];
  for (const candidate of input) {
    const key = `${candidate.dataset}::${candidate.year}::${candidate.group}::${candidate.variables.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
};

const deriveOverallConfidence = (intentConfidence: number, evidence: ImportEvidence[]): number => {
  const evidenceVariables = evidence.flatMap((entry) => entry.variables);
  if (evidenceVariables.length === 0) {
    return Math.max(0.2, Math.min(0.6, intentConfidence));
  }
  const availableCount = evidenceVariables.filter((entry) => entry.available).length;
  const evidenceScore = availableCount / evidenceVariables.length;
  const blended = intentConfidence * 0.6 + evidenceScore * 0.4;
  return Math.max(0, Math.min(1, blended));
};

export const createAiAdminPlanHandler = (deps: PlanHandlerDeps = {}) => {
  const planFromModel = deps.planFromModel ?? defaultModelPlanning;
  const searchGroups = deps.searchGroups ?? defaultSearchGroups;
  const inspectImportCandidate = deps.inspectImportCandidate ?? defaultInspectImportCandidate;
  const detectPreflightConflicts = deps.detectPreflightConflicts ?? defaultDetectPreflightConflicts;
  const now = deps.now ?? (() => Date.now());

  return async function handler(req: AiAdminPlanRequest, res: AiAdminPlanResponse) {
    if (req.method !== "POST") {
      respond(res, 405, { error: "Method not allowed" });
      return;
    }

    let rawBody: Record<string, unknown>;
    try {
      rawBody = await parseBody(req);
    } catch {
      respond(res, 400, { error: "Invalid JSON body." });
      return;
    }

    const callerEmail = normalizeString(rawBody.callerEmail);
    const auth = authorizeRequest(req, callerEmail);
    if (!auth.ok) {
      respond(res, 403, { error: "Forbidden", reason: auth.reason });
      return;
    }

    const prompt = parsePrompt(rawBody.prompt);
    if (!prompt) {
      respond(res, 400, { error: "Missing required 'prompt'." });
      return;
    }
    const searchPrompt = parsePrompt(rawBody.searchPrompt) ?? prompt;

    const dataset = normalizeString(rawBody.dataset) ?? DEFAULT_DATASET;
    const year = parseYear(rawBody.year, DEFAULT_YEAR);

    let intent: PlannedIntent | null = null;
    let groupMatches: CensusGroupMatch[] = [];
    let aiSuggestFallback: { groupNumber: string; statIds: string[]; reason: string } | null = null;
    const researchWarnings: string[] = [];

    const [intentResult, groupMatchesResult] = await Promise.allSettled([
      planFromModel({ prompt, dataset, year }),
      searchGroups(dataset, year, searchPrompt, MAX_GROUP_RESULTS),
    ]);

    if (intentResult.status === "fulfilled") {
      intent = intentResult.value;
    } else {
      const message =
        intentResult.reason instanceof Error
          ? intentResult.reason.message
          : "Model planning research was unavailable.";
      researchWarnings.push(`Model planning fallback: ${message}`);
    }

    if (groupMatchesResult.status === "fulfilled") {
      groupMatches = groupMatchesResult.value;
    } else {
      const message =
        groupMatchesResult.reason instanceof Error
          ? groupMatchesResult.reason.message
          : "Census group search unavailable.";
      respond(res, 502, { error: "Failed to run Census group search.", details: message });
      return;
    }

    if (!intent || intent.imports.length === 0) {
      try {
        aiSuggestFallback = await suggestCensusWithAI({ query: searchPrompt, dataset, year });
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI suggestion fallback unavailable.";
        researchWarnings.push(`AI suggestion fallback: ${message}`);
      }
    }

    const importCandidatesFromModel = (intent?.imports ?? [])
      .map((candidate) =>
        sanitizeImportCandidate(candidate, {
          dataset,
          year,
        }),
      )
      .filter((candidate): candidate is ImportCandidate => candidate != null);
    const importCandidates: ImportCandidate[] = [...importCandidatesFromModel];

    if (aiSuggestFallback?.groupNumber) {
      const fallbackGroup = normalizeGroupId(aiSuggestFallback.groupNumber);
      const fallbackVariables = (aiSuggestFallback.statIds ?? [])
        .map((entry) => normalizeVariableId(entry, dataset))
        .filter((entry): entry is string => Boolean(entry))
        .slice(0, MAX_VARIABLES_PER_IMPORT);
      if (fallbackGroup) {
        importCandidates.push({
          dataset: inferDatasetForGroup(dataset, fallbackGroup),
          year,
          group: fallbackGroup,
          variables: fallbackVariables,
          reason: aiSuggestFallback.reason || "AI fallback import recommendation.",
        });
      }
    }

    if (groupMatches[0]) {
      importCandidates.push({
        dataset: inferDatasetForGroup(dataset, groupMatches[0].name),
        year,
        group: groupMatches[0].name,
        variables: [],
        reason:
          importCandidates.length === 0
            ? "Top Census group search match from prompt."
            : "Grounded Census group backup candidate from prompt context.",
      });
    }

    const dedupedImportCandidates = dedupeImportCandidates(importCandidates).slice(0, MAX_IMPORT_CANDIDATES);

    let importEvidence: ImportEvidence[] = [];
    try {
      importEvidence = await Promise.all(
        dedupedImportCandidates.map(async (candidate) => inspectImportCandidate(candidate)),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to inspect Census imports.";
      respond(res, 502, { error: "Failed to inspect Census imports.", details: message });
      return;
    }

    const steps: Array<{
      id: string;
      type: AiAdminAction["type"];
      title: string;
      description: string;
      confidence: number;
      executableNow: boolean;
      payload: Record<string, unknown>;
      evidence?: unknown;
      blockers?: string[];
    }> = [];

    const allPlannedActions: AiAdminAction[] = [];
    const executableActions: AiAdminAction[] = [];
    const expectedStats: Array<{
      key: string;
      name: string;
      source: "census_import" | "derived";
      fromStepId: string;
      neId?: string;
    }> = [];

    const researchAction: AiAdminAction = {
      id: "step-research-1",
      type: "research_census",
      payload: {
        prompt,
        dataset,
        year,
        generatedAt: now(),
      },
    };
    allPlannedActions.push(researchAction);
    executableActions.push(researchAction);
    steps.push({
      id: researchAction.id,
      type: researchAction.type,
      title: "Research Census options",
      description: "Collect candidate groups and verify variable availability before writes.",
      confidence: deriveOverallConfidence(intent?.confidence ?? 0.45, importEvidence),
      executableNow: true,
      payload: researchAction.payload,
      evidence: {
        topGroups: groupMatches,
        aiFallback: aiSuggestFallback,
      },
    });

    const variableToImportStepId = new Map<string, string>();
    let importStepIndex = 0;
    for (const evidence of importEvidence) {
      if (evidence.status !== "ok") {
        steps.push({
          id: `step-import-error-${importStepIndex + 1}`,
          type: "import_census_stat",
          title: `Import Census group ${evidence.group}`,
          description: "Import candidate failed validation against Census metadata.",
          confidence: 0.2,
          executableNow: false,
          payload: {
            dataset: evidence.dataset,
            group: evidence.group,
            year: evidence.year,
          },
          blockers: [summarizeImportError(evidence.error ?? "Unknown Census error.")],
          evidence,
        });
        importStepIndex += 1;
        continue;
      }

      const availableVariables = evidence.variables.filter((variable) => variable.available);
      for (const variable of availableVariables) {
        const stepId = `step-import-${importStepIndex + 1}`;
        const action: AiAdminAction = {
          id: stepId,
          type: "import_census_stat",
          payload: {
            dataset: evidence.dataset,
            group: evidence.group,
            variable: variable.variable,
            year: evidence.year,
            years: 1,
            expectedStatsCreated: 1,
            expectedRowsWritten: 12000,
            reason: evidence.reason,
          },
        };
        allPlannedActions.push(action);
        executableActions.push(action);
        variableToImportStepId.set(variable.variable, stepId);
        expectedStats.push({
          key: `census:${variable.variable}`,
          name: variable.statName,
          source: "census_import",
          fromStepId: stepId,
          neId: `census:${variable.variable}`,
        });
        steps.push({
          id: stepId,
          type: action.type,
          title: `Import ${variable.variable}`,
          description: `Import ${variable.statName} from Census group ${evidence.group}.`,
          confidence: 0.85,
          executableNow: true,
          payload: action.payload,
          evidence: {
            dataset: evidence.dataset,
            year: evidence.year,
            group: evidence.group,
            concept: evidence.concept,
            universe: evidence.universe,
            tableUrl: evidence.tableUrl,
            variable,
          },
        });
        importStepIndex += 1;
      }
    }

    const hasExecutableImportActions = executableActions.some((action) => action.type === "import_census_stat");
    if (!hasExecutableImportActions) {
      steps.push({
        id: "step-feasibility-blocked-1",
        type: "research_census",
        title: "Plan is not yet feasible",
        description: "No validated import candidates were found. Refine dataset scope, group, or variable selection and regenerate the plan.",
        confidence: 0.3,
        executableNow: false,
        payload: {
          reason: "no_validated_import_candidates",
        },
        blockers: [
          "At least one import step must validate against Census metadata before derived or family actions can be approved.",
        ],
      });
    }

    const derivedCandidates = hasExecutableImportActions ? intent?.derived ?? [] : [];
    let derivedStepIndex = 0;
    for (const derived of derivedCandidates.slice(0, MAX_DERIVED_CANDIDATES)) {
      const stepId = `step-derived-${derivedStepIndex + 1}`;
      const blockers: string[] = [];
      const payload: Record<string, unknown> = {
        name: derived.name,
        formula: derived.formula,
        reason: derived.reason,
        expectedStatsCreated: 1,
        expectedRowsWritten: 12000,
      };

      if (derived.formula === "sum") {
        payload.sumOperandVariables = derived.sumOperandVariables;
        payload.sumOperandImportStepIds = derived.sumOperandVariables.map(
          (variable) => variableToImportStepId.get(variable) ?? null,
        );
        const unresolved = derived.sumOperandVariables.filter((variable) => !variableToImportStepId.has(variable));
        if (unresolved.length > 0) blockers.push(`Missing import steps for sum operands: ${unresolved.join(", ")}.`);
      } else {
        payload.numeratorVariable = derived.numeratorVariable;
        payload.denominatorVariable = derived.denominatorVariable;
        payload.numeratorImportStepId = derived.numeratorVariable
          ? (variableToImportStepId.get(derived.numeratorVariable) ?? null)
          : null;
        payload.denominatorImportStepId = derived.denominatorVariable
          ? (variableToImportStepId.get(derived.denominatorVariable) ?? null)
          : null;
        if (derived.numeratorVariable && !variableToImportStepId.has(derived.numeratorVariable)) {
          blockers.push(`Missing import step for numerator variable ${derived.numeratorVariable}.`);
        }
        if (derived.denominatorVariable && !variableToImportStepId.has(derived.denominatorVariable)) {
          blockers.push(`Missing import step for denominator variable ${derived.denominatorVariable}.`);
        }
      }

      const action: AiAdminAction = {
        id: stepId,
        type: "create_derived_stat",
        payload,
      };
      allPlannedActions.push(action);
      expectedStats.push({
        key: `derived:${derived.name}`,
        name: derived.name,
        source: "derived",
        fromStepId: stepId,
      });

      steps.push({
        id: stepId,
        type: action.type,
        title: `Create derived stat ${derived.name}`,
        description: derived.reason,
        confidence: blockers.length === 0 ? 0.72 : 0.4,
        executableNow: false,
        payload: action.payload,
        blockers:
          blockers.length > 0
            ? blockers
            : [
                "Planned in Slice 3 only. Derived execution remains a separate approval/execution step in later slices.",
              ],
      });
      derivedStepIndex += 1;
    }

    const familyCandidates = hasExecutableImportActions ? intent?.families ?? [] : [];
    let familyStepIndex = 0;
    for (const family of familyCandidates.slice(0, MAX_FAMILY_CANDIDATES)) {
      const stepId = `step-family-${familyStepIndex + 1}`;
      const action: AiAdminAction = {
        id: stepId,
        type: "create_stat_family_links",
        payload: {
          parentName: family.parentName,
          childNames: family.childNames,
          statAttribute: family.statAttribute,
          reason: family.reason,
        },
      };
      allPlannedActions.push(action);
      steps.push({
        id: stepId,
        type: action.type,
        title: `Create family links under ${family.parentName}`,
        description: family.reason,
        confidence: 0.6,
        executableNow: false,
        payload: action.payload,
        blockers: [
          "Planned in Slice 3 only. Family-link execution requires stat id resolution in later slices.",
        ],
      });
      familyStepIndex += 1;
    }

    const rawCaps = isRecord(rawBody.caps) ? rawBody.caps : AI_ADMIN_DEFAULT_CAPS;
    const draftValidation = validateAiAdminPlanRequest({
      callerEmail,
      dryRun: false,
      validateOnly: false,
      caps: rawCaps,
      actions: executableActions,
    });

    if (!draftValidation.ok) {
      respond(res, 400, {
        error: "Failed to build executable draft plan.",
        details: draftValidation.errors,
      });
      return;
    }

    let preflightConflicts: Awaited<ReturnType<typeof detectPreflightConflicts>> = [];
    let preflightCheck: "ok" | "unavailable" = "ok";
    try {
      preflightConflicts = await detectPreflightConflicts(draftValidation.plan.actions);
    } catch (error) {
      preflightCheck = "unavailable";
      const message =
        error instanceof Error ? error.message : "Preflight duplicate check unavailable.";
      researchWarnings.push(`Preflight duplicate check fallback: ${message}`);
    }

    const unresolvedSteps = steps.filter((step) => !step.executableNow);
    const overallConfidence = deriveOverallConfidence(intent?.confidence ?? 0.45, importEvidence);

    const hasAnyWriteAction = draftValidation.plan.actions.some((action) => action.type !== "research_census");
    const feasibilityBlockReason = hasAnyWriteAction
      ? null
      : "Approval blocked: no validated import candidates. Regenerate with a tighter dataset/group/variable scope.";

    respond(res, 200, {
      ok: true,
      mode: "plan",
      plan: {
        prompt,
        notes: intent?.notes ?? "Generated from Census research evidence.",
        confidence: overallConfidence,
        requiresUserApproval: true,
        readOnlyResearch: true,
        steps,
        actions: allPlannedActions,
        executeRequestDraft: draftValidation.plan,
        preflightCheck,
        preflightConflicts,
        approvalBlocked:
          Boolean(feasibilityBlockReason) || (preflightCheck === "ok" && preflightConflicts.length > 0),
        approvalBlockReason: feasibilityBlockReason,
        unresolvedSteps: unresolvedSteps.map((step) => ({
          stepId: step.id,
          type: step.type,
          blockers: step.blockers ?? [],
        })),
        expectedCreates: {
          stats: expectedStats,
          relationLinks: familyCandidates.reduce((sum, family) => sum + family.childNames.length, 0),
        },
      },
      research: {
        dataset,
        year,
        topGroups: groupMatches,
        aiFallback: aiSuggestFallback,
        importEvidence,
        warnings: researchWarnings,
      },
      guardrails: {
        createOnly: true,
        writesExecuted: false,
      },
    });
  };
};

const handler = createAiAdminPlanHandler();

export default handler;
