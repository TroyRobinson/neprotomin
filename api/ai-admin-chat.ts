import type { IncomingMessage } from "node:http";

import { createAiAdminPlanHandler } from "./ai-admin-plan.ts";
import {
  deriveStatName,
  fetchGroupMetadata,
  fetchVariableSummaries,
  inferStatType,
  resolveVariables,
} from "./_shared/censusPreview.js";
import {
  getDatasetCapability,
  listDatasetCapabilities,
  type CensusDatasetCapability,
} from "./_shared/censusDatasetCapabilities.ts";

type AiAdminChatRequest = IncomingMessage & {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  on?: (event: "data" | "end" | "error", listener: (...args: unknown[]) => void) => void;
};

type AiAdminChatResponse = {
  status: (code: number) => AiAdminChatResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatModelResult = {
  text: string;
  warning?: string;
};

type ChatPlanResult = {
  statusCode: number;
  payload: unknown;
};

type GroundedSearchResult = {
  query: string;
  queryUsed?: string;
  dataset: string;
  year: number;
  searchedDatasets?: string[];
  intent?: {
    business: boolean;
  };
  datasetCapability?: CensusDatasetCapability | null;
  knownDatasetCapabilities?: CensusDatasetCapability[];
  researchAlternatives?: Array<{
    dataset: string;
    group: string;
    title: string;
    variable: string;
    statName: string;
    supportTier?: CensusDatasetCapability["supportTier"];
  }>;
  groups: Array<{
    group: string;
    dataset: string;
    supportTier?: CensusDatasetCapability["supportTier"];
    year: number;
    description: string;
    relevanceScore: number;
    relevanceReason: string;
    concept: string | null;
    universe: string | null;
    tableUrl: string;
    variables: Array<{
      variable: string;
      label: string;
      statName: string;
      inferredType: string;
      concept: string | null;
      zipCount: number;
      countyCount: number;
      relevanceScore: number;
      relevanceReason: string;
    }>;
    error?: string;
  }>;
  warnings: string[];
};

type RankedVariableCandidate = {
  variable: string;
  label: string;
  statName: string;
  concept: string | null;
  inferredType: string;
  relevanceScore: number;
  relevanceReason: string;
};

type SearchIntentProfile = {
  business: boolean;
};

type ChatHandlerDeps = {
  respondWithModel?: (messages: ChatMessage[], dataset: string, year: number) => Promise<ChatModelResult>;
  draftPlan?: (input: {
    req: AiAdminChatRequest;
    callerEmail: string | null;
    prompt: string;
    dataset: string;
    year: number;
    caps: unknown;
  }) => Promise<ChatPlanResult>;
  searchCensus?: (input: {
    query: string;
    dataset: string;
    year: number;
  }) => Promise<GroundedSearchResult>;
  now?: () => number;
};

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_DATASET = "acs/acs5";
const DEFAULT_YEAR = 2023;
const MAX_GROUP_RESULTS = 4;
const MAX_VARIABLE_RESULTS = 4;
const MAX_REVIEW_GROUPS = 2;
const MAX_REVIEW_VARIABLES = 2;
const PLAN_READY_PATTERNS = [
  /\bgo ahead\b/i,
  /\bready\b.*\bplan\b/i,
  /\bdraft\b.*\bplan\b/i,
  /\bpropose\b.*\bplan\b/i,
  /\bshow\b.*\bplan\b/i,
  /\bapprove\b.*\bplan\b/i,
  /\b(create|build|make|generate)\b.*\b(plan|draft)\b/i,
  /\b(plan|draft)\b.*\b(create|build|make|generate)\b/i,
];
const SEARCH_STOP_WORDS = new Set<string>([
  "a",
  "an",
  "and",
  "by",
  "count",
  "counts",
  "data",
  "for",
  "include",
  "including",
  "of",
  "stat",
  "stats",
  "the",
  "to",
  "total",
  "with",
  "ill",
  "help",
  "you",
  "your",
  "draft",
  "plan",
  "statistical",
  "potential",
  "recommended",
  "source",
  "sources",
  "metadata",
  "suggestion",
  "suggestions",
  "framework",
  "approach",
]);
const AUTO_SEARCH_INTENT_PATTERNS = [
  /\bstat(s|istic|istics)?\b/i,
  /\bcount(s)?\b/i,
  /\bbreakdown\b/i,
  /\bdisaggregate|disaggregation\b/i,
  /\bimport\b/i,
  /\bvariable(s)?\b/i,
  /\bdataset(s)?\b/i,
  /\bderive(d)?\b/i,
  /\bformula(s)?\b/i,
  /\bfamily|families|child(ren)?\b/i,
  /\bby\s+(size|age|race|ethnicity|income|sector|industry)\b/i,
  /\bbusiness|population|household|employment|poverty|income|housing\b/i,
];
const BUSINESS_INTENT_TERMS = ["business", "businesses", "firm", "firms", "establishment", "establishments", "employer", "enterprise", "naics"];
const BUSINESS_RELEVANCE_TERMS = ["business", "firm", "establishment", "enterprise", "employer", "naics", "industry", "sector", "employment size", "employees"];
const NON_BUSINESS_PENALTY_TERMS = ["family", "household", "housing", "race", "ethnicity", "age", "children", "poverty", "snap", "grandparent"];
const BRAINSTORM_TERM_ALLOWLIST = new Set<string>([
  "business",
  "firm",
  "establishment",
  "enterprise",
  "employer",
  "naics",
  "industry",
  "sector",
  "employment",
  "size",
  "disaggregate",
  "breakdown",
  "county",
  "state",
  "national",
  "population",
  "household",
  "income",
  "poverty",
]);
const BUSINESS_RESEARCH_FALLBACK_DATASETS = ["cbp", "abscb"];

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseBoolean = (value: unknown, fallback = false): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y"].includes(normalized)) return true;
    if (["0", "false", "no", "n"].includes(normalized)) return false;
  }
  return fallback;
};

const parseYear = (value: unknown, fallback: number): number => {
  const raw = typeof value === "number" ? value : typeof value === "string" ? Number(value.trim()) : Number.NaN;
  if (!Number.isFinite(raw)) return fallback;
  const year = Math.trunc(raw);
  if (year < 2005) return 2005;
  if (year > 2100) return 2100;
  return year;
};

const parseBody = async (req: AiAdminChatRequest): Promise<Record<string, unknown>> => {
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

const respond = (res: AiAdminChatResponse, statusCode: number, payload: unknown): void => {
  res.setHeader("Content-Type", "application/json");
  res.status(statusCode).json(payload);
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

const readApiKeyFromRequest = (req: AiAdminChatRequest): string | null => {
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
  req: AiAdminChatRequest,
  callerEmail: string | null,
): { ok: boolean; reason?: string } => {
  const configuredApiKey = getConfiguredApiKey();
  if (configuredApiKey) {
    const supplied = readApiKeyFromRequest(req);
    if (supplied && supplied === configuredApiKey) return { ok: true };
    return { ok: false, reason: "invalid_api_key" };
  }

  if (!isProduction() && isAdminEmail(callerEmail)) return { ok: true };

  return {
    ok: false,
    reason: isProduction() ? "missing_api_key_configuration" : "admin_email_required",
  };
};

const normalizeMessages = (input: unknown): ChatMessage[] => {
  if (!Array.isArray(input)) return [];
  const out: ChatMessage[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const role = normalizeString((raw as Record<string, unknown>).role);
    const content = normalizeString((raw as Record<string, unknown>).content);
    if (!role || !content) continue;
    if (role !== "user" && role !== "assistant") continue;
    out.push({ role, content });
  }
  return out.slice(-20);
};

const shouldDraftPlan = (latestUserMessage: string, requestPlan: boolean): boolean => {
  if (requestPlan) return true;
  return PLAN_READY_PATTERNS.some((pattern) => pattern.test(latestUserMessage));
};

const hasAutoSearchIntent = (text: string): boolean =>
  AUTO_SEARCH_INTENT_PATTERNS.some((pattern) => pattern.test(text));

const hasPriorSearchEvidence = (messages: ChatMessage[]): boolean =>
  messages.some((message) => message.role === "assistant" && /\[grounded search evidence\]/i.test(message.content));

const shouldAutoSearch = (input: {
  latestUserMessage: string;
  requestSearch: boolean;
  planRequested: boolean;
  messages: ChatMessage[];
}): boolean => {
  if (input.requestSearch || input.planRequested) return false;
  const text = input.latestUserMessage.trim();
  if (!text || text.length < 4) return false;
  if (!hasAutoSearchIntent(text)) return false;
  if (/^do these (results|matches?)\b/i.test(text) && hasPriorSearchEvidence(input.messages)) {
    return false;
  }
  return true;
};

const summarizeSupportTier = (tier: CensusDatasetCapability["supportTier"]): string => {
  if (tier === "importable_now") return "Importable now";
  if (tier === "research_only") return "Research-only";
  return "Out of range";
};

const detectSearchIntent = (query: string): SearchIntentProfile => {
  const normalized = query.toLowerCase();
  const business = BUSINESS_INTENT_TERMS.some((term) => normalized.includes(term));
  return { business };
};

const scoreBusinessAlignment = (text: string): number => {
  const positive = scoreTextMatch(text, BUSINESS_RELEVANCE_TERMS);
  const negative = scoreTextMatch(text, NON_BUSINESS_PENALTY_TERMS);
  return positive - negative * 0.9;
};

const isCodeLikeLabel = (value: string): boolean => /^[A-Z0-9_]+$/.test(value.trim());

const shortenText = (value: string, maxLength = 84): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

const chooseGroupDisplayTitle = (group: GroundedSearchResult["groups"][number]): string => {
  const concept = (group.concept ?? "").trim();
  if (concept && !isCodeLikeLabel(concept)) return shortenText(concept);
  const description = (group.description ?? "").trim();
  if (description) return shortenText(description);
  return group.group;
};

const chooseVariableDisplayTitle = (
  group: GroundedSearchResult["groups"][number],
  variable: GroundedSearchResult["groups"][number]["variables"][number],
): string => {
  const fromStatName = (variable.statName ?? "").trim();
  if (fromStatName) {
    const parts = fromStatName.split("→").map((part) => part.trim()).filter(Boolean);
    const leaf = parts.length > 0 ? parts[parts.length - 1] : fromStatName;
    if (leaf && !isCodeLikeLabel(leaf)) return shortenText(leaf, 72);
  }

  const label = (variable.label ?? "").trim();
  if (label) {
    const normalized = label.replace(/^Estimate!!/i, "").replace(/!!/g, " → ");
    const parts = normalized.split("→").map((part) => part.trim()).filter(Boolean);
    const leaf = parts.length > 0 ? parts[parts.length - 1] : normalized;
    if (leaf && !isCodeLikeLabel(leaf)) return shortenText(leaf, 72);
  }

  const groupTitle = chooseGroupDisplayTitle(group);
  return `Candidate from ${groupTitle}`;
};

const buildSearchReviewMessage = (search: GroundedSearchResult, mode: "manual" | "auto"): string => {
  const preface =
    mode === "auto"
      ? "I ran a grounded Census search based on your request."
      : "Grounded Census search results are ready.";

  const capability = search.datasetCapability;
  const capabilityLine = capability
    ? `Dataset scope: ${capability.label} (${capability.dataset}) - ${summarizeSupportTier(capability.supportTier)}.`
    : `Dataset scope: ${search.dataset} is not in the current capability registry.`;

  const searchedDatasetsLine =
    Array.isArray(search.searchedDatasets) && search.searchedDatasets.length > 0
      ? `Searched datasets: ${search.searchedDatasets.join(", ")}.`
      : null;

  if (search.groups.length === 0) {
    if (search.intent?.business) {
      return [
        preface,
        capabilityLine,
        searchedDatasetsLine,
        "I did not find a high-confidence business-variable match in the currently searched sources.",
        "I can keep this in research mode, or you can refine the business scope (industry, employer-only, county/state level).",
      ]
        .filter((line): line is string => Boolean(line))
        .join("\n");
    }
    const fallback = capability?.supportTier === "research_only"
      ? "This dataset is currently research-only in our pipeline, so I can explain findings but cannot import directly yet."
      : "I did not find a strong variable match from this dataset for your wording.";
    return [preface, capabilityLine, searchedDatasetsLine, fallback, "Refine the intent or switch dataset scope before drafting a plan."]
      .filter((line): line is string => Boolean(line))
      .join("\n");
  }

  const topGroups = search.groups.slice(0, MAX_REVIEW_GROUPS);
  const interpretedMatchLines = topGroups.flatMap((group) =>
    group.variables.slice(0, MAX_REVIEW_VARIABLES).map((variable) => {
      const groupTitle = chooseGroupDisplayTitle(group);
      const variableTitle = chooseVariableDisplayTitle(group, variable);
      return `- ${variableTitle} (${variable.variable}) [${group.group} · ${groupTitle}]`;
    }),
  );

  const topMatchTier = topGroups[0]?.supportTier ?? capability?.supportTier ?? "importable_now";
  const fitWarning =
    topMatchTier === "research_only"
      ? "Top matches are research-only with current import adapters."
      : "Review the top matches below before approving any plan.";

  const alternativesLine =
    Array.isArray(search.researchAlternatives) && search.researchAlternatives.length > 0
      ? `Research-only alternatives: ${search.researchAlternatives
          .slice(0, 2)
          .map((entry) => `${entry.title} [${entry.group}] ${entry.statName} (${entry.variable})`)
          .join("; ")}.`
      : null;

  return [
    preface,
    capabilityLine,
    searchedDatasetsLine,
    "Top matches (interpreted):",
    ...interpretedMatchLines,
    alternativesLine,
    fitWarning,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
};

const normalizeTerm = (token: string): string => {
  const lowered = token.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (lowered.endsWith("sses") && lowered.length > 5) {
    return lowered.slice(0, -2);
  }
  if ((lowered.endsWith("xes") || lowered.endsWith("ches") || lowered.endsWith("shes") || lowered.endsWith("zes")) && lowered.length > 4) {
    return lowered.slice(0, -2);
  }
  if (lowered.endsWith("ies") && lowered.length > 3) {
    return `${lowered.slice(0, -3)}y`;
  }
  if (lowered.endsWith("s") && lowered.length > 3) {
    return lowered.slice(0, -1);
  }
  return lowered;
};

const toSearchTerms = (query: string): string[] => {
  const terms = query
    .split(/\s+/)
    .map((token) => normalizeTerm(token))
    .filter((token) => token.length >= 2 && !SEARCH_STOP_WORDS.has(token));

  if (terms.length > 0) return terms;
  return query
    .split(/\s+/)
    .map((token) => normalizeTerm(token))
    .filter((token) => token.length >= 2);
};

const scoreTextMatch = (text: string, terms: string[]): number => {
  if (!text || terms.length === 0) return 0;
  const normalized = text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (normalized === term) {
      score += 100;
      continue;
    }
    if (normalized.includes(` ${term} `) || normalized.startsWith(`${term} `) || normalized.endsWith(` ${term}`)) {
      score += 35;
      continue;
    }
    if (normalized.startsWith(term)) {
      score += 20;
      continue;
    }
    if (normalized.includes(term)) {
      score += 10;
    }
  }
  return score;
};

const describeMatchedTerms = (text: string, terms: string[]): string => {
  const normalized = text.toLowerCase();
  const matched = terms.filter((term) => normalized.includes(term)).slice(0, 3);
  if (matched.length === 0) return "Grounded from Census metadata.";
  return `Matched terms: ${matched.join(", ")}.`;
};

const inferDatasetForGroup = (dataset: string, group: string): string => {
  const normalizedDataset = normalizeString(dataset) ?? DEFAULT_DATASET;
  const normalizedGroup = normalizeString(group)?.toUpperCase() ?? "";
  if (!normalizedGroup) return normalizedDataset;
  if (normalizedDataset !== DEFAULT_DATASET) return normalizedDataset;
  if (normalizedGroup.startsWith("DP")) return "acs/acs5/profile";
  if (normalizedGroup.startsWith("CP")) return "acs/acs5/cprofile";
  if (normalizedGroup.startsWith("S")) return "acs/acs5/subject";
  return normalizedDataset;
};

const CENSUS_TABLE_DOC_URL = (year: number, dataset: string, group: string) =>
  `https://api.census.gov/data/${year}/${dataset}/groups/${group}.html`;

const fetchGroups = async (dataset: string, year: number): Promise<Array<{ name: string; description: string }>> => {
  const apiKey = process.env.CENSUS_API_KEY ?? "";
  const url = `https://api.census.gov/data/${year}/${dataset}/groups.json${apiKey ? `?key=${apiKey}` : ""}`;
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Census HTTP ${response.status}: ${text || response.statusText}`);
  }

  const json = (await response.json()) as { groups?: Array<{ name?: string; description?: string }> };
  return (json.groups ?? [])
    .filter((group): group is { name: string; description?: string } => typeof group.name === "string")
    .map((group) => ({
      name: group.name,
      description: typeof group.description === "string" ? group.description : group.name,
    }));
};

const scoreGroupCandidate = (group: { name: string; description: string }, terms: string[]): number =>
  scoreTextMatch(group.name, terms) * 1.2 + scoreTextMatch(group.description, terms);

const buildSearchQueryFromMessages = (messages: ChatMessage[], latestUserMessage: string): string => {
  const userMessages = messages.filter((message) => message.role === "user").map((message) => message.content.trim());
  const latest = latestUserMessage.trim();
  if (latest.length > 0 && !shouldDraftPlan(latest, false)) return latest;
  for (let index = userMessages.length - 2; index >= 0; index -= 1) {
    const candidate = userMessages[index]?.trim() ?? "";
    if (!candidate) continue;
    if (shouldDraftPlan(candidate, false)) continue;
    return candidate;
  }
  return latest;
};

const composeSearchQueryFromBrainstorm = (baseQuery: string, brainstormText: string | null): string => {
  const baseTerms = toSearchTerms(baseQuery);
  const intent = detectSearchIntent(baseQuery);
  const intentTerms = intent.business
    ? ["business", "establishment", "firm", "employer", "employment", "size", "industry", "sector"]
    : [];
  const brainstormTerms = brainstormText
    ? toSearchTerms(brainstormText).filter((term) => BRAINSTORM_TERM_ALLOWLIST.has(term)).slice(0, 6)
    : [];
  const merged = Array.from(new Set([...baseTerms, ...intentTerms, ...brainstormTerms])).slice(0, 14);
  return merged.length > 0 ? merged.join(" ") : baseQuery;
};

const emptySummariesForVariables = (variables: string[]): Record<string, { zipCount: number; countyCount: number }> =>
  Object.fromEntries(variables.map((variable) => [variable, { zipCount: 0, countyCount: 0 }]));

const searchDatasetGroups = async (input: {
  dataset: string;
  year: number;
  terms: string[];
  intent: SearchIntentProfile;
  maxGroups: number;
  warnings: string[];
}): Promise<
  Array<{
    group: string;
    dataset: string;
    supportTier?: CensusDatasetCapability["supportTier"];
    year: number;
    description: string;
    relevanceScore: number;
    relevanceReason: string;
    concept: string | null;
    universe: string | null;
    tableUrl: string;
    variables: Array<{
      variable: string;
      label: string;
      statName: string;
      inferredType: string;
      concept: string | null;
      zipCount: number;
      countyCount: number;
      relevanceScore: number;
      relevanceReason: string;
    }>;
    error?: string;
  }>
> => {
  const datasetCapability = getDatasetCapability(input.dataset);
  if (!datasetCapability?.searchable) return [];

  let groups: Array<{ name: string; description: string }> = [];
  try {
    groups = await fetchGroups(input.dataset, input.year);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Failed to fetch dataset groups.";
    input.warnings.push(`Unable to search ${input.dataset}: ${detail}`);
    return [];
  }

  const rankedGroups = groups
    .map((group) => {
      const groupText = `${group.name} ${group.description}`;
      let relevanceScore = scoreGroupCandidate(group, input.terms);
      if (input.intent.business) {
        const businessAlignment = scoreBusinessAlignment(groupText);
        relevanceScore += businessAlignment * 1.5;
        if (businessAlignment <= 0) relevanceScore = 0;
      }
      return {
        ...group,
        relevanceScore,
        relevanceReason: describeMatchedTerms(groupText, input.terms),
      };
    })
    .filter((group) => group.relevanceScore > 0)
    .sort((left, right) => right.relevanceScore - left.relevanceScore)
    .slice(0, Math.max(1, input.maxGroups));

  if (rankedGroups.length === 0) return [];

  const groupsWithVariables = await Promise.all(
    rankedGroups.map(async (group) => {
      const resolvedDataset = inferDatasetForGroup(input.dataset, group.name);
      const resolvedCapability = getDatasetCapability(resolvedDataset) ?? datasetCapability;
      const options = {
        dataset: resolvedDataset,
        survey: resolvedDataset.split("/").pop() || "acs5",
        group: group.name,
        variables: [],
        year: input.year,
        years: 1,
        includeMoe: false,
        dryRun: false,
        debug: false,
        limit: 25,
      };

      try {
        const groupMeta = await fetchGroupMetadata(options);
        const resolved = resolveVariables(options, groupMeta);
        const estimates = Array.isArray(resolved.estimates)
          ? resolved.estimates.filter((entry: unknown): entry is string => typeof entry === "string")
          : [];

        const rankedVariables = estimates
          .map((variable: string): RankedVariableCandidate => {
            const variableMeta = groupMeta.variables.get(variable);
            const statName = variableMeta ? deriveStatName(variable, variableMeta, groupMeta) : variable;
            const label = variableMeta?.label ?? "";
            const concept = normalizeString(variableMeta?.concept) ?? normalizeString(groupMeta.concept) ?? null;
            const variableText = `${variable} ${statName} ${label} ${concept ?? ""}`;
            let relevanceScore =
              scoreTextMatch(variable, input.terms) * 1.3 +
              scoreTextMatch(statName, input.terms) +
              scoreTextMatch(label, input.terms) +
              scoreTextMatch(concept ?? "", input.terms) * 0.8;
            if (input.intent.business) {
              const businessAlignment = scoreBusinessAlignment(variableText);
              relevanceScore += businessAlignment * 1.3;
              if (businessAlignment <= 0) relevanceScore = 0;
            }
            return {
              variable,
              label,
              statName,
              concept,
              inferredType: variableMeta ? inferStatType(variableMeta) : "count",
              relevanceScore,
              relevanceReason: describeMatchedTerms(variableText, input.terms),
            };
          })
          .sort((left: RankedVariableCandidate, right: RankedVariableCandidate) => right.relevanceScore - left.relevanceScore);

        const positiveRankedVariables = rankedVariables.filter(
          (entry: RankedVariableCandidate) => entry.relevanceScore > 0,
        );
        const selectedVariables = (
          positiveRankedVariables.length > 0
            ? positiveRankedVariables.slice(0, MAX_VARIABLE_RESULTS)
            : input.intent.business
              ? []
              : rankedVariables.slice(0, MAX_VARIABLE_RESULTS)
        ).filter((entry: RankedVariableCandidate) => entry.variable.length > 0);

        if (selectedVariables.length === 0) {
          return null;
        }

        const summaries = resolvedCapability?.importable
          ? await fetchVariableSummaries(
              options,
              selectedVariables.map((entry: RankedVariableCandidate) => entry.variable),
            )
          : emptySummariesForVariables(selectedVariables.map((entry: RankedVariableCandidate) => entry.variable));

        return {
          group: group.name,
          dataset: resolvedDataset,
          supportTier: resolvedCapability?.supportTier,
          year: input.year,
          description: group.description,
          relevanceScore: group.relevanceScore,
          relevanceReason: group.relevanceReason,
          concept: normalizeString(groupMeta.concept) ?? null,
          universe: normalizeString(groupMeta.universe) ?? null,
          tableUrl: CENSUS_TABLE_DOC_URL(input.year, resolvedDataset, group.name),
          variables: selectedVariables.map((variable: RankedVariableCandidate) => ({
            variable: variable.variable,
            label: variable.label,
            statName: variable.statName,
            inferredType: variable.inferredType,
            concept: variable.concept,
            zipCount: summaries?.[variable.variable]?.zipCount ?? 0,
            countyCount: summaries?.[variable.variable]?.countyCount ?? 0,
            relevanceScore: variable.relevanceScore,
            relevanceReason: variable.relevanceReason,
          })),
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Failed to inspect group.";
        input.warnings.push(`Unable to inspect ${group.name} (${resolvedDataset}): ${detail}`);
        return {
          group: group.name,
          dataset: resolvedDataset,
          supportTier: resolvedCapability?.supportTier,
          year: input.year,
          description: group.description,
          relevanceScore: group.relevanceScore,
          relevanceReason: group.relevanceReason,
          concept: null,
          universe: null,
          tableUrl: CENSUS_TABLE_DOC_URL(input.year, resolvedDataset, group.name),
          variables: [],
          error: detail,
        };
      }
    }),
  );

  return groupsWithVariables
    .filter(
      (
        group,
      ): group is NonNullable<typeof group> => group != null && Array.isArray(group.variables) && group.variables.length > 0,
    )
    .sort((left, right) => right.relevanceScore - left.relevanceScore);
};

const defaultSearchCensus = async (input: {
  query: string;
  dataset: string;
  year: number;
}): Promise<GroundedSearchResult> => {
  const query = input.query.trim();
  const dataset = normalizeString(input.dataset) ?? DEFAULT_DATASET;
  const year = parseYear(input.year, DEFAULT_YEAR);
  const warnings: string[] = [];
  const intent = detectSearchIntent(query);
  const datasetCapability = getDatasetCapability(dataset);
  const knownDatasetCapabilities = listDatasetCapabilities();

  if (!datasetCapability) {
    warnings.push(
      `Dataset "${dataset}" is not listed in the current capability registry. Results may be incomplete.`,
    );
  } else if (!datasetCapability.searchable) {
    warnings.push(
      `Dataset "${dataset}" is currently out of search scope (${datasetCapability.supportTier}).`,
    );
    return {
      query,
      dataset,
      year,
      intent,
      searchedDatasets: [dataset],
      datasetCapability,
      knownDatasetCapabilities,
      groups: [],
      warnings,
    };
  }

  const terms = toSearchTerms(query);
  const datasetSearchOrder = [dataset];
  if (intent.business) {
    for (const fallbackDataset of BUSINESS_RESEARCH_FALLBACK_DATASETS) {
      if (datasetSearchOrder.includes(fallbackDataset)) continue;
      const capability = getDatasetCapability(fallbackDataset);
      if (capability?.searchable) datasetSearchOrder.push(fallbackDataset);
    }
  }

  const perDatasetGroups = await Promise.all(
    datasetSearchOrder.map(async (datasetName, index) =>
      searchDatasetGroups({
        dataset: datasetName,
        year,
        terms,
        intent,
        maxGroups: index === 0 ? MAX_GROUP_RESULTS : Math.max(2, Math.floor(MAX_GROUP_RESULTS / 2)),
        warnings,
      }),
    ),
  );

  const allGroups = perDatasetGroups
    .flat()
    .sort((left, right) => right.relevanceScore - left.relevanceScore);

  let selectedGroups = allGroups.slice(0, MAX_GROUP_RESULTS);
  let researchAlternatives: GroundedSearchResult["researchAlternatives"] = [];
  if (intent.business) {
    const importableBusinessGroups = allGroups.filter((group) => group.supportTier === "importable_now");
    const researchBusinessGroups = allGroups.filter((group) => group.supportTier === "research_only");
    if (importableBusinessGroups.length > 0) {
      selectedGroups = importableBusinessGroups.slice(0, MAX_GROUP_RESULTS);
      researchAlternatives = researchBusinessGroups
        .filter(
          (group) =>
            !selectedGroups.some(
              (selected) => selected.group === group.group && selected.dataset === group.dataset,
            ),
        )
        .slice(0, 2)
        .map((group) => {
          const variable = group.variables[0];
          return {
            dataset: group.dataset,
            group: group.group,
            title: group.concept ?? group.description ?? group.group,
            variable: variable?.variable ?? "",
            statName: variable?.statName ?? "Variable candidate",
            supportTier: group.supportTier,
          };
        })
        .filter((entry) => entry.variable.length > 0);
    } else if (researchBusinessGroups.length > 0) {
      selectedGroups = researchBusinessGroups.slice(0, MAX_GROUP_RESULTS);
      warnings.push(
        "No importable business match found in current ACS scope. Showing research-only matches from business datasets.",
      );
    } else {
      selectedGroups = [];
      warnings.push(
        "No high-confidence business match found across searchable datasets for this request.",
      );
    }
  }

  if (selectedGroups.length === 0 && warnings.length === 0) {
    warnings.push("No strong group match found yet. Refine the request and run search again.");
  }

  return {
    query,
    dataset,
    year,
    searchedDatasets: datasetSearchOrder,
    intent,
    datasetCapability,
    knownDatasetCapabilities,
    researchAlternatives,
    groups: selectedGroups,
    warnings,
  };
};

const buildPlanningPromptFromMessages = (messages: ChatMessage[], latestUserMessage: string): string => {
  const userMessages = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter((content) => content.length > 0);
  if (userMessages.length <= 1) return latestUserMessage;

  const recent = userMessages.slice(-6);
  const contextBlock = recent.map((content, index) => `${index + 1}. ${content}`).join("\n");
  return [
    "Conversation context (most recent user requests):",
    contextBlock,
    "",
    `Latest user message: "${latestUserMessage}"`,
    "If the latest message is only a plan go-ahead, use prior user lines to determine topic scope.",
  ].join("\n");
};

const extractAssistantText = (response: unknown): string | null => {
  if (!response || typeof response !== "object") return null;
  const choices = (response as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const asText = content
      .map((chunk) => {
        if (typeof chunk === "string") return chunk;
        if (!chunk || typeof chunk !== "object") return "";
        const text = (chunk as Record<string, unknown>).text;
        return typeof text === "string" ? text : "";
      })
      .join("")
      .trim();
    return asText || null;
  }
  return null;
};

const buildSystemPrompt = (dataset: string, year: number): string => `You are a careful AI admin copilot for US Census stat planning.

Primary behavior:
- Keep responses concise and clear.
- Explain Census variables in plain language.
- Explain derived-stat formulas in plain language, including why the formula is appropriate.
- In this app, "disaggregate/disaggregation", "breakdown", and "child stats" all mean child statistics grouped under a parent stat family.
- Do not produce a final execution plan unless the user explicitly says to proceed with a plan.
- If the user has not asked for a plan yet, do not output a full plan block in plain text.
- If the conversation appears to pause, ask a short check-in question about whether the user wants a plan draft.

Plan format expectations once requested:
- Suggest plain-English stat titles.
- Include source metadata references (ID, universe, concept, dataset, vintage, and type).
- Include derived formula details using plain names.
- Mention family hierarchy at a title level (grandparent -> children -> grandchildren).

Current planning defaults:
- Dataset: ${dataset}
- Vintage year: ${year}

Never suggest delete or edit operations. Create-only actions are allowed.`;

const callOpenRouter = async (
  messages: ChatMessage[],
  dataset: string,
  year: number,
): Promise<ChatModelResult> => {
  const apiKey = process.env.OPENROUTER ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return {
      text: "I can help with Census variables and derived formulas. When you're ready, ask me to draft a plan to review.",
      warning: "OpenRouter API key is not configured.",
    };
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://neprotomin.app",
    },
    body: JSON.stringify({
      model: "anthropic/claude-3.5-haiku",
      messages: [{ role: "system", content: buildSystemPrompt(dataset, year) }, ...messages],
      temperature: 0.3,
      max_tokens: 700,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenRouter chat failed (${response.status}): ${text || response.statusText}`);
  }

  const json = await response.json();
  const assistantText = extractAssistantText(json);
  if (!assistantText) {
    return {
      text: "I can keep researching options with you. Tell me what outcome you want, and when ready I can draft a plan.",
      warning: "Model response was empty.",
    };
  }
  return { text: assistantText };
};

const callPlanHandler = async (input: {
  req: AiAdminChatRequest;
  callerEmail: string | null;
  prompt: string;
  dataset: string;
  year: number;
  caps: unknown;
}): Promise<ChatPlanResult> => {
  const handler = createAiAdminPlanHandler();
  const mockReq = {
    method: "POST",
    headers: input.req.headers,
    body: {
      callerEmail: input.callerEmail,
      prompt: input.prompt,
      dataset: input.dataset,
      year: input.year,
      caps: input.caps,
    },
  };

  let statusCode = 200;
  let payload: unknown = null;
  const mockRes = {
    status: (code: number) => {
      statusCode = code;
      return mockRes;
    },
    json: (nextPayload: unknown) => {
      payload = nextPayload;
    },
    setHeader: (_name: string, _value: string) => {
      // not needed for in-process invocation
    },
  };

  await handler(mockReq as any, mockRes as any);
  return { statusCode, payload };
};

export const createAiAdminChatHandler = (deps: ChatHandlerDeps = {}) => {
  const respondWithModel = deps.respondWithModel ?? callOpenRouter;
  const draftPlan = deps.draftPlan ?? callPlanHandler;
  const searchCensus = deps.searchCensus ?? defaultSearchCensus;
  const now = deps.now ?? (() => Date.now());

  return async function handler(req: AiAdminChatRequest, res: AiAdminChatResponse) {
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

    const messages = normalizeMessages(rawBody.messages);
    const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
    if (!latestUserMessage) {
      respond(res, 400, { error: "At least one user message is required." });
      return;
    }

    const dataset = normalizeString(rawBody.dataset) ?? DEFAULT_DATASET;
    const year = parseYear(rawBody.year, DEFAULT_YEAR);
    const requestPlan = parseBoolean(rawBody.requestPlan, false);
    const requestSearch = parseBoolean(rawBody.requestSearch, false);
    const planRequested = shouldDraftPlan(latestUserMessage.content, requestPlan);
    const autoSearch = shouldAutoSearch({
      latestUserMessage: latestUserMessage.content,
      requestSearch,
      planRequested,
      messages,
    });
    const searchRequested = requestSearch || autoSearch;
    const warnings: string[] = [];
    let searchPayload: GroundedSearchResult | null = null;
    let searchReviewText: string | null = null;

    let assistantText =
      "I can help research Census variables and explain derived formulas. Tell me the outcome you want.";
    if (searchRequested) {
      const requestedQuery = normalizeString(rawBody.searchQuery);
      const queryBase = requestedQuery ?? buildSearchQueryFromMessages(messages, latestUserMessage.content);
      if (!queryBase) {
        warnings.push("Search requested but no user context was provided.");
      } else {
        let brainstormText: string | null = null;
        if (autoSearch) {
          try {
            const brainstorm = await respondWithModel(messages, dataset, year);
            brainstormText = brainstorm.text;
            assistantText = brainstorm.text;
            if (brainstorm.warning) warnings.push(brainstorm.warning);
          } catch (error) {
            warnings.push(error instanceof Error ? error.message : "Failed to generate brainstorming guidance.");
            assistantText = "I'll run a grounded search now and then suggest best next steps.";
          }
        } else {
          assistantText = "Running grounded Census search from current context.";
        }

        const queryUsed = composeSearchQueryFromBrainstorm(queryBase, brainstormText);
        try {
          const rawSearchPayload = await searchCensus({ query: queryUsed, dataset, year });
          searchPayload = {
            ...rawSearchPayload,
            query: queryBase,
            queryUsed,
          };
          warnings.push(...searchPayload.warnings);
          searchReviewText = buildSearchReviewMessage(searchPayload, requestSearch ? "manual" : "auto");
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : "Grounded Census search failed.");
          assistantText = "I couldn't complete a grounded Census search right now. Please try again.";
        }
      }
    } else if (planRequested) {
      assistantText = "Drafting plan from our conversation context.";
    } else {
      try {
        const chatResponse = await respondWithModel(messages, dataset, year);
        assistantText = chatResponse.text;
        if (chatResponse.warning) warnings.push(chatResponse.warning);
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : "Failed to generate chat response.");
      }
    }

    let planPayload: any = null;
    if (planRequested) {
      const planningPrompt = buildPlanningPromptFromMessages(messages, latestUserMessage.content);
      const planned = await draftPlan({
        req,
        callerEmail,
        prompt: planningPrompt,
        dataset,
        year,
        caps: rawBody.caps,
      });

      if (planned.statusCode >= 200 && planned.statusCode < 300) {
        planPayload = planned.payload;
      } else {
        const detail =
          planned.payload && typeof planned.payload === "object"
            ? normalizeString((planned.payload as Record<string, unknown>).error)
            : null;
        warnings.push(
          detail
            ? `Plan draft unavailable: ${detail}`
            : `Plan draft unavailable (status ${planned.statusCode}).`,
        );
      }
    }

    respond(res, 200, {
      ok: true,
      mode: "chat",
      assistantMessage: {
        role: "assistant",
        content: assistantText,
        createdAt: now(),
      },
      searchReviewMessage: searchReviewText
        ? {
            role: "assistant",
            content: searchReviewText,
            createdAt: now(),
          }
        : null,
      planRequested,
      plan: planPayload?.plan ?? null,
      research: planPayload?.research ?? null,
      guardrails: {
        createOnly: true,
        writesExecuted: false,
      },
      warnings,
      searchRequested,
      autoSearchTriggered: autoSearch,
      search: searchPayload,
    });
  };
};

const handler = createAiAdminChatHandler();

export default handler;
