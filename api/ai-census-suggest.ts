import type { IncomingMessage } from "node:http";

type AISuggestRequest = IncomingMessage & {
  method?: string;
  body?: {
    query: string;
    dataset: string;
    year: number;
  };
};

type AISuggestResponse = {
  status: (code: number) => AISuggestResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

export type CensusAISuggestion = {
  groupNumber: string;
  statIds: string[];
  reason: string;
};

type SuggestCensusInput = {
  query: string;
  dataset: string;
  year: number;
  fetchImpl?: typeof fetch;
};

const respond = (res: AISuggestResponse, statusCode: number, payload: unknown): void => {
  res.setHeader("Content-Type", "application/json");
  res.status(statusCode).json(payload);
};

// Helper to read request body from IncomingMessage
const readBody = (req: IncomingMessage): Promise<string> => {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      resolve(body);
    });
    req.on("error", reject);
  });
};

const extractFirstJsonObject = (text: string): string | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
};

const normalizeSuggestion = (parsed: Record<string, unknown>): CensusAISuggestion | null => {
  const groupNumberRaw = typeof parsed.groupNumber === "string" ? parsed.groupNumber.trim() : "";
  const groupNumber = groupNumberRaw.toUpperCase();
  const reason = typeof parsed.reason === "string" ? parsed.reason.trim() : "";

  const statIdRaw =
    typeof parsed.statId === "string"
      ? parsed.statId
      : typeof parsed.statID === "string"
        ? parsed.statID
        : typeof parsed.variableId === "string"
          ? parsed.variableId
          : typeof parsed.variable === "string"
            ? parsed.variable
            : "";
  const statIdsRaw =
    Array.isArray(parsed.statIds)
      ? parsed.statIds
      : Array.isArray(parsed.statIDs)
        ? parsed.statIDs
        : Array.isArray(parsed.variableIds)
          ? parsed.variableIds
          : Array.isArray(parsed.variables)
            ? parsed.variables
            : null;

  const statIds = (statIdsRaw ?? [])
    .filter((value: unknown) => typeof value === "string")
    .map((value: string) => value.trim().toUpperCase())
    .filter(Boolean);

  const singleStatId = statIdRaw ? String(statIdRaw).trim().toUpperCase() : "";
  const normalizedStatIds = statIds.length > 0 ? statIds : singleStatId ? [singleStatId] : [];

  if (!groupNumber || !reason) return null;
  return {
    groupNumber,
    statIds: normalizedStatIds,
    reason,
  };
};

export const suggestCensusWithAI = async ({
  query,
  dataset,
  year,
  fetchImpl = fetch,
}: SuggestCensusInput): Promise<CensusAISuggestion | null> => {
  if (!query.trim()) return null;

  const apiKey = process.env.OPENROUTER || process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const prompt = `You are an expert on U.S. Census Bureau data and the American Community Survey (ACS).

Given a user's search query for Census data, identify the single most relevant Census group ID and specific variable that best matches what they're looking for.

Dataset: ${dataset}
Year: ${year}
User query: "${query}"

Common Census groups and variables include:
- B01001: Sex by Age (e.g., B01001_002E = Male total)
- B01002: Median Age (B01002_001E = Median age)
- B01003: Total Population (B01003_001E = Total population)
- B12001: Marital Status (e.g., B12001_004E = Male, now married, B12001_010E = Female, now married)
- B19001: Household Income
- B22003: Receipt of Food Stamps/SNAP (e.g., B22003_002E = Households receiving SNAP)
- B25001: Housing Units
- B25003: Tenure (Owner/Renter Occupied)
- S1701: Poverty Status

Variable naming convention:
- Estimate variables end in E (e.g., B12001_004E)
- Margin of error variables end in M (e.g., B12001_004M)
- _001E is typically the total/aggregate

Respond with ONLY a JSON object in this exact format (no markdown, no explanation):
{"groupNumber": "B12001", "statIds": ["B12001_004E"], "reason": "Male population currently married"}

If you cannot confidently suggest a group, respond with:
{"groupNumber": "", "statIds": [], "reason": ""}`;

  const openRouterResponse = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://neprotomin.app",
    },
    body: JSON.stringify({
      model: "anthropic/claude-3.5-haiku",
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 200,
    }),
  });

  if (!openRouterResponse.ok) {
    return null;
  }

  const aiResult = (await openRouterResponse.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = aiResult.choices?.[0]?.message?.content?.trim() || "";
  if (!content) return null;

  try {
    const jsonText = extractFirstJsonObject(content) ?? content;
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    return normalizeSuggestion(parsed);
  } catch {
    return null;
  }
};

export default async function handler(req: AISuggestRequest, res: AISuggestResponse) {
  if (req.method !== "POST") {
    respond(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const bodyText = await readBody(req);
    const body = JSON.parse(bodyText) as { query: string; dataset: string; year: number };

    const { query, dataset, year } = body;

    if (!query?.trim()) {
      respond(res, 400, { error: "Missing 'query' parameter." });
      return;
    }

    const suggestion = await suggestCensusWithAI({ query, dataset, year });
    if (!suggestion) {
      respond(res, 200, {});
      return;
    }

    respond(res, 200, {
      groupNumber: suggestion.groupNumber,
      statIds: suggestion.statIds,
      // Backward compatibility for callers that still read a single statId field.
      statId: suggestion.statIds[0] ?? null,
      reason: suggestion.reason,
    });
  } catch (error) {
    console.error("ai-census-suggest failed", error);
    // Fail gracefully for AI suggestions - don't block the main search
    respond(res, 200, {});
  }
}
