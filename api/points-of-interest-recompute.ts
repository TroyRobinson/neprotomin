import type { IncomingMessage } from "node:http";
import { init as initAdmin } from "@instantdb/admin";

import {
  runPointsOfInterestRecompute,
  type PoiRecomputeAction,
} from "./_shared/pointsOfInterest.ts";

type PoiRequest = IncomingMessage & {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, string | string[]>;
  on?: (event: "data" | "end" | "error", listener: (...args: any[]) => void) => void;
};

type PoiResponse = {
  status: (code: number) => PoiResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

type PoiBody = {
  statId?: unknown;
  action?: unknown;
  force?: unknown;
  callerEmail?: unknown;
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

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const normalizeBoolean = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    return lowered === "1" || lowered === "true" || lowered === "yes";
  }
  return false;
};

const parseBody = async (req: PoiRequest): Promise<PoiBody> => {
  if (typeof req.body === "string") return JSON.parse(req.body) as PoiBody;
  if (req.body && typeof req.body === "object") return req.body as PoiBody;
  if (!req.on) return {};

  const text = await new Promise<string>((resolve, reject) => {
    let buf = "";
    const decoder = new TextDecoder();
    req.on?.("data", (chunk: unknown) => {
      if (typeof chunk === "string") {
        buf += chunk;
        return;
      }
      if (chunk instanceof Uint8Array) {
        buf += decoder.decode(chunk);
        return;
      }
      if (Array.isArray(chunk)) {
        buf += decoder.decode(Uint8Array.from(chunk as number[]));
        return;
      }
      buf += String(chunk);
    });
    req.on?.("end", () => resolve(buf));
    req.on?.("error", (error: Error) => reject(error));
  });

  if (!text) return {};
  return JSON.parse(text) as PoiBody;
};

const respond = (res: PoiResponse, statusCode: number, payload: unknown): void => {
  res.setHeader("Content-Type", "application/json");
  res.status(statusCode).json(payload);
};

const isProduction = (): boolean => {
  const mode = normalizeString(process.env.NODE_ENV) ?? "development";
  return mode === "production";
};

const ADMIN_EMAILS = new Set<string>([
  ...splitEntries(resolveEnv("ADMIN_EMAIL") ?? null),
  ...splitEntries(resolveEnv("VITE_ADMIN_EMAIL") ?? null),
]);

const ADMIN_DOMAINS = new Set<string>(
  [
    ...splitEntries(resolveEnv("ADMIN_DOMAIN") ?? null),
    ...splitEntries(resolveEnv("VITE_ADMIN_DOMAIN") ?? null),
  ].map((domain) => (domain.startsWith("@") ? domain.slice(1) : domain)),
);

const isAdminEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (ADMIN_EMAILS.has(normalized)) return true;
  const atIndex = normalized.lastIndexOf("@");
  if (atIndex === -1) return false;
  const domain = normalized.slice(atIndex + 1);
  if (!domain) return false;
  return ADMIN_DOMAINS.has(domain);
};

const readApiKeyFromRequest = (req: PoiRequest): string | null => {
  const direct = req.headers["x-poi-api-key"];
  if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();
  if (Array.isArray(direct) && direct[0] && direct[0].trim().length > 0) return direct[0].trim();

  const auth = req.headers.authorization;
  const header =
    typeof auth === "string"
      ? auth
      : Array.isArray(auth) && auth[0]
      ? auth[0]
      : "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
};

const authorizeRequest = (
  req: PoiRequest,
  callerEmail: string | null,
): { ok: boolean; reason?: string } => {
  const configuredApiKey =
    resolveEnv("POINTS_OF_INTEREST_API_KEY") ??
    resolveEnv("POI_RECOMPUTE_API_KEY");

  if (configuredApiKey) {
    const supplied = readApiKeyFromRequest(req);
    if (supplied && supplied === configuredApiKey) return { ok: true };
    return { ok: false, reason: "invalid_api_key" };
  }

  // Fallback mode for local/internal environments only.
  if (!isProduction() && isAdminEmail(callerEmail)) return { ok: true };

  return {
    ok: false,
    reason: isProduction() ? "missing_api_key_configuration" : "admin_email_required",
  };
};

const createAdminDb = () => {
  const appId =
    resolveEnv("VITE_INSTANT_APP_ID") ??
    resolveEnv("NEXT_PUBLIC_INSTANT_APP_ID") ??
    resolveEnv("INSTANT_APP_ID");
  const adminToken =
    resolveEnv("INSTANT_APP_ADMIN_TOKEN") ??
    resolveEnv("INSTANT_ADMIN_TOKEN") ??
    resolveEnv("VITE_INSTANT_ADMIN_TOKEN");

  if (!appId || !adminToken) {
    throw new Error("Missing Instant admin credentials.");
  }

  return initAdmin({ appId, adminToken });
};

const normalizeAction = (value: unknown): PoiRecomputeAction => {
  if (value === "deactivate") return "deactivate";
  return "recompute";
};

export default async function handler(req: PoiRequest, res: PoiResponse) {
  if (req.method !== "POST") {
    respond(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = await parseBody(req);
    const statId = normalizeString(body.statId);
    if (!statId) {
      respond(res, 400, { error: "Missing statId" });
      return;
    }

    const callerEmail = normalizeString(body.callerEmail);
    const auth = authorizeRequest(req, callerEmail);
    if (!auth.ok) {
      respond(res, 403, { error: "Forbidden", reason: auth.reason });
      return;
    }

    const db = createAdminDb();
    const action = normalizeAction(body.action);
    const force = normalizeBoolean(body.force);

    const result = await runPointsOfInterestRecompute(db as any, {
      statId,
      action,
      force,
    });

    respond(res, 200, result);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
        ? error
        : "Unknown error";
    console.error("[points-of-interest-recompute] failed", error);
    respond(res, 500, { error: "Failed to recompute points of interest", message });
  }
}
