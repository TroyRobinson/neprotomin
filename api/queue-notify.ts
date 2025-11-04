import type { IncomingMessage } from "node:http";
import { Resend } from "resend";

type QueueRequest = IncomingMessage & {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[]>;
  headers: Record<string, string | string[] | undefined>;
};

type QueueResponse = {
  status: (code: number) => QueueResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

type QueueNotifyBody = {
  organizationId?: unknown;
  organizationName?: unknown;
  ownerEmail?: unknown;
  submitterEmail?: unknown;
  submittedAt?: unknown;
};

const splitEntries = (raw?: string | null): string[] => {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);
};

const resolveEnv = (key: string): string | undefined => {
  const raw = process.env[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
};

const resolveAdminEmails = (): string[] => {
  const combined = [
    ...splitEntries(resolveEnv("QUEUE_NOTIFY_RECIPIENTS") ?? null),
    ...splitEntries(resolveEnv("QUEUE_NOTIFY_EMAILS") ?? null),
    ...splitEntries(resolveEnv("RESEND_TO_EMAILS") ?? null),
    ...splitEntries(resolveEnv("ADMIN_EMAIL") ?? null),
    ...splitEntries(resolveEnv("VITE_ADMIN_EMAIL") ?? null),
  ];
  const normalized = new Set<string>();
  for (const entry of combined) {
    const lower = entry.toLowerCase();
    if (lower.includes("@")) {
      normalized.add(lower);
    }
  }
  return Array.from(normalized);
};

const parseBody = async (req: QueueRequest): Promise<QueueNotifyBody> => {
  if (typeof req.body === "string") {
    return JSON.parse(req.body) as QueueNotifyBody;
  }
  if (req.body && typeof req.body === "object") {
    return req.body as QueueNotifyBody;
  }
  if (typeof req.on !== "function") {
    return {};
  }
  const data = await new Promise<string>((resolve, reject) => {
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
    req.on?.("error", (error: Error) => reject(error));
  });
  if (!data) return {};
  return JSON.parse(data) as QueueNotifyBody;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const normalizeTimestamp = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const respond = (res: QueueResponse, statusCode: number, payload: unknown): void => {
  res.setHeader("Content-Type", "application/json");
  res.status(statusCode).json(payload);
};

const RESEND_API_KEY = resolveEnv("RESEND_API_KEY") ?? resolveEnv("RESEND_TOKEN");
const RESEND_FROM =
  resolveEnv("RESEND_FROM_EMAIL") ??
  resolveEnv("RESEND_FROM") ??
  resolveEnv("RESEND_SENDER") ??
  resolveEnv("ADMIN_EMAIL");
const QUEUE_REVIEW_URL =
  resolveEnv("QUEUE_REVIEW_URL") ?? "https://www.neighborhoodexplorer.org/#queue";

const resendClient = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export default async function handler(req: QueueRequest, res: QueueResponse) {
  if (req.method !== "POST") {
    respond(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!resendClient || !RESEND_FROM) {
    respond(res, 500, {
      error: "Email delivery is not configured. Set RESEND_API_KEY (or RESEND_EMAIL) and RESEND_FROM_EMAIL.",
    });
    return;
  }

  try {
    const body = await parseBody(req);
    const organizationId = normalizeString(body.organizationId);
    const organizationName = normalizeString(body.organizationName) ?? normalizeString(body.organizationId);
    const ownerEmail = normalizeString(body.ownerEmail);
    const submitterEmail =
      normalizeString(body.submitterEmail) ?? normalizeString((body as Record<string, unknown>).submittedBy);
    const submittedAt = normalizeTimestamp(body.submittedAt) ?? Date.now();

    if (!organizationId || !organizationName) {
      respond(res, 400, { error: "Missing organization information." });
      return;
    }

    const recipients = resolveAdminEmails();
    if (recipients.length === 0) {
      respond(res, 200, {
        delivered: false,
        reason: "No recipients configured. Add ADMIN_EMAIL or QUEUE_NOTIFY_RECIPIENTS.",
      });
      return;
    }

    const submittedAtIso = new Date(submittedAt).toLocaleString();
    const plainTextLines = [
      `A new organization is waiting for review: ${organizationName}`,
      "",
      `Organization ID: ${organizationId}`,
      ownerEmail ? `Owner Email: ${ownerEmail}` : null,
      submitterEmail ? `Submitted By: ${submitterEmail}` : null,
      `Submitted At: ${submittedAtIso}`,
      "",
      `Open the moderation queue: ${QUEUE_REVIEW_URL}`,
    ].filter((line): line is string => Boolean(line));

    await resendClient.emails.send({
      from: RESEND_FROM,
      to: recipients,
      subject: `Queue: ${organizationName} is awaiting approval`,
      text: plainTextLines.join("\n"),
      html: `
        <div>
          <p>A new organization is waiting for review:</p>
          <p><strong>${organizationName}</strong></p>
          <ul>
            <li><strong>ID:</strong> ${organizationId}</li>
            ${ownerEmail ? `<li><strong>Owner email:</strong> ${ownerEmail}</li>` : ""}
            ${submitterEmail ? `<li><strong>Submitted by:</strong> ${submitterEmail}</li>` : ""}
            <li><strong>Submitted at:</strong> ${submittedAtIso}</li>
          </ul>
          <p><a href="${QUEUE_REVIEW_URL}">Open the moderation queue</a></p>
        </div>
      `,
    });

    respond(res, 200, { delivered: true });
  } catch (error) {
    console.error("queue-notify failed", error);
    respond(res, 500, { error: "Failed to send notification." });
  }
}
