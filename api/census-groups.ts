import type { IncomingMessage } from "node:http";

type CensusGroupsRequest = IncomingMessage & {
  method?: string;
  query?: Record<string, string | string[]>;
};

type CensusGroupsResponse = {
  status: (code: number) => CensusGroupsResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

type CensusGroup = {
  name: string;        // e.g., "B22003"
  description: string; // Full group description
};

const respond = (res: CensusGroupsResponse, statusCode: number, payload: unknown): void => {
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
  return 2023;
};

const parseLimit = (raw: string | null): number => {
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.max(1, Math.min(50, parsed));
    }
  }
  return 15;
};

// Simple scoring for search relevance
const scoreMatch = (group: CensusGroup, searchTerms: string[]): number => {
  let score = 0;
  const nameLower = group.name.toLowerCase();
  const descLower = group.description.toLowerCase();

  for (const term of searchTerms) {
    // Exact name match (highest priority)
    if (nameLower === term) score += 100;
    // Name starts with term
    else if (nameLower.startsWith(term)) score += 50;
    // Name contains term
    else if (nameLower.includes(term)) score += 25;
    // Description contains term (word boundary preferred)
    if (descLower.includes(` ${term}`) || descLower.startsWith(term)) score += 10;
    else if (descLower.includes(term)) score += 5;
  }

  return score;
};

// Cache for groups.json results (keyed by dataset+year)
const groupsCache = new Map<string, { groups: CensusGroup[]; fetchedAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

const fetchGroups = async (dataset: string, year: number): Promise<CensusGroup[]> => {
  const cacheKey = `${dataset}:${year}`;
  const cached = groupsCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.groups;
  }

  const apiKey = process.env.CENSUS_API_KEY ?? "";
  const url = `https://api.census.gov/data/${year}/${dataset}/groups.json${apiKey ? `?key=${apiKey}` : ""}`;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Census HTTP ${res.status}: ${text || res.statusText}`);
  }

  const json = await res.json() as { groups?: Array<{ name?: string; description?: string }> };
  const rawGroups = json.groups ?? [];

  const groups: CensusGroup[] = rawGroups
    .filter((g): g is { name: string; description: string } =>
      typeof g.name === "string" && g.name.length > 0
    )
    .map((g) => ({
      name: g.name,
      description: typeof g.description === "string" ? g.description : g.name,
    }));

  groupsCache.set(cacheKey, { groups, fetchedAt: Date.now() });
  return groups;
};

export default async function handler(req: CensusGroupsRequest, res: CensusGroupsResponse) {
  if (req.method !== "GET") {
    respond(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const query = req.query ?? {};
    const dataset = normalizeQueryString(query.dataset) ?? "acs/acs5";
    const search = normalizeQueryString(query.search) ?? "";
    const year = parseYear(normalizeQueryString(query.year));
    const limit = parseLimit(normalizeQueryString(query.limit));

    if (!search) {
      respond(res, 400, { error: "Missing required 'search' parameter." });
      return;
    }

    const allGroups = await fetchGroups(dataset, year);

    // Tokenize search string for matching
    const searchTerms = search
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    // Score and filter groups
    const scored = allGroups
      .map((g) => ({ group: g, score: scoreMatch(g, searchTerms) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    respond(res, 200, {
      dataset,
      year,
      search,
      total: scored.length,
      groups: scored.map((item) => item.group),
    });
  } catch (error) {
    console.error("census-groups failed", error);
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unknown error";
    respond(res, 500, {
      error: "Failed to search Census groups.",
      details: message,
    });
  }
}
