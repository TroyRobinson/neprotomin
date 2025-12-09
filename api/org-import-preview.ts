import type { IncomingMessage } from "node:http";
import { fetchProPublicaOrgs, filterOrgsByKeywords } from "./_shared/orgImport.js";

type OrgPreviewRequest = IncomingMessage & {
  method?: string;
  query?: Record<string, string | string[]>;
};

type OrgPreviewResponse = {
  status: (code: number) => OrgPreviewResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

const normalizeString = (value: string | string[] | undefined): string | null => {
  if (Array.isArray(value)) return normalizeString(value[0]);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseLimit = (raw: string | string[] | undefined): number => {
  const str = normalizeString(raw);
  if (str) {
    const parsed = Number(str);
    if (Number.isFinite(parsed)) {
      return Math.min(50, Math.max(1, parsed));
    }
  }
  return 10;
};

const respond = (res: OrgPreviewResponse, statusCode: number, payload: unknown): void => {
  res.setHeader("Content-Type", "application/json");
  res.status(statusCode).json(payload);
};

export default async function handler(req: OrgPreviewRequest, res: OrgPreviewResponse) {
  if (req.method !== "GET") {
    respond(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const query = req.query ?? {};
    const category = normalizeString(query.category);
    const nteePrefix = normalizeString(query.nteePrefix);
    const state = normalizeString(query.state);
    const city = normalizeString(query.city);
    const includeKeywords = normalizeString(query.includeKeywords) ?? "";
    const excludeKeywords = normalizeString(query.excludeKeywords) ?? "";
    const limit = parseLimit(query.limit);

    const primaryQuery = includeKeywords || category || "";

    const page = 0;
    let items = [];
    let total = 0;
    let warning: string | undefined;
    try {
      const result = await fetchProPublicaOrgs({
        query: primaryQuery,
        state: state ?? undefined,
        city: city ?? undefined,
        nteePrefix: nteePrefix ?? undefined,
        page,
      });
      items = result.items;
      total = result.total;
    } catch (apiError: any) {
      // Retry once without ntee filter if provided, since ProPublica occasionally 502s on that param
      if (nteePrefix) {
        warning = `ProPublica rejected ntee[id]=${nteePrefix}. Retrying without NTEE filter. (${apiError?.message || "unknown error"})`;
        const fallbackResult = await fetchProPublicaOrgs({
          query: primaryQuery,
          state: state ?? undefined,
          city: city ?? undefined,
          nteePrefix: undefined,
          page,
        });
        items = fallbackResult.items;
        total = fallbackResult.total;
      } else {
        const message = apiError?.message || "ProPublica API error";
        respond(res, 502, {
          error: "ProPublica API error",
          details: message,
          url: `${PROPUBLICA_BASE}?${new URLSearchParams({
            q: primaryQuery || "",
            ...(state ? { "state[id]": state } : {}),
            ...(city ? { city } : {}),
            page: String(page),
          }).toString()}`,
        });
        return;
      }
    }

    const filtered = filterOrgsByKeywords(items, includeKeywords, excludeKeywords, false).slice(0, limit);

    respond(res, 200, {
      total,
      count: filtered.length,
      items: filtered,
      warning,
    });
  } catch (error: any) {
    console.error("org-import-preview failed", error);
    respond(res, 500, {
      error: "Failed to load ProPublica org preview.",
      details: error?.message ?? String(error),
    });
  }
}
