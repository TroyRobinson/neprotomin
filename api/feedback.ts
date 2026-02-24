import type { IncomingMessage } from "node:http";
import { Resend } from "resend";

type FeedbackRequest = IncomingMessage & {
  method?: string;
  body?: unknown;
  query?: Record<string, string | string[]>;
  headers: Record<string, string | string[] | undefined>;
};

type FeedbackResponse = {
  status: (code: number) => FeedbackResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

type FeedbackBody = {
  message?: unknown;
  username?: unknown;
  userId?: unknown;
  userEmail?: unknown;
  pageUrl?: unknown;
  urlParams?: unknown;
  source?: unknown;
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

const normalizeString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const parseBody = async (req: FeedbackRequest): Promise<FeedbackBody> => {
  if (typeof req.body === "string") {
    return JSON.parse(req.body) as FeedbackBody;
  }
  if (req.body && typeof req.body === "object") {
    return req.body as FeedbackBody;
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
  return JSON.parse(data) as FeedbackBody;
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const resolveRecipients = (): string[] => {
  const configured = [
    ...splitEntries(resolveEnv("FEEDBACK_TO_EMAILS") ?? null),
    ...splitEntries(resolveEnv("FEEDBACK_RECIPIENTS") ?? null),
    ...splitEntries(resolveEnv("RESEND_TO_EMAILS") ?? null),
    ...splitEntries(resolveEnv("ADMIN_EMAIL") ?? null),
    ...splitEntries(resolveEnv("VITE_ADMIN_EMAIL") ?? null),
  ];
  const normalized = new Set<string>();
  for (const entry of configured) {
    const lower = entry.toLowerCase();
    if (lower.includes("@")) {
      normalized.add(lower);
    }
  }
  // Always include the primary feedback inbox.
  normalized.add("troy.robinson@9bcorp.com");
  return Array.from(normalized);
};

const respond = (res: FeedbackResponse, statusCode: number, payload: unknown): void => {
  res.setHeader("Content-Type", "application/json");
  res.status(statusCode).json(payload);
};

const RESEND_API_KEY = resolveEnv("RESEND_API_KEY") ?? resolveEnv("RESEND_TOKEN");
const RESEND_FROM =
  resolveEnv("RESEND_FROM_EMAIL") ??
  resolveEnv("RESEND_FROM") ??
  resolveEnv("RESEND_SENDER") ??
  resolveEnv("ADMIN_EMAIL");
const resendClient = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export default async function handler(req: FeedbackRequest, res: FeedbackResponse) {
  if (req.method !== "POST") {
    respond(res, 405, { error: "Method not allowed" });
    return;
  }

  if (!resendClient || !RESEND_FROM) {
    respond(res, 500, {
      error: "Feedback delivery is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL.",
    });
    return;
  }

  try {
    const body = await parseBody(req);
    const message = normalizeString(body.message);
    const username = normalizeString(body.username) ?? "Not logged in";
    const userId = normalizeString(body.userId) ?? "(unknown)";
    const userEmail = normalizeString(body.userEmail) ?? "(none)";
    const pageUrl = normalizeString(body.pageUrl) ?? "(unknown)";
    const urlParams = normalizeString(body.urlParams) ?? "(none)";
    const source = normalizeString(body.source) ?? "Map help menu";

    if (!message) {
      respond(res, 400, { error: "Feedback message is required." });
      return;
    }

    const recipients = resolveRecipients();
    const submittedAt = new Date().toISOString();
    const textLines = [
      "New feedback submission",
      "",
      `Message:`,
      message,
      "",
      "--- Metadata ---",
      `Source: ${source}`,
      `Submitted at: ${submittedAt}`,
      `Username: ${username}`,
      `User ID: ${userId}`,
      `User email: ${userEmail}`,
      `Current URL: ${pageUrl}`,
      `URL parameters: ${urlParams}`,
    ];

    const sendResult = await resendClient.emails.send({
      from: RESEND_FROM,
      to: recipients,
      subject: `NE Feedback: ${username}`,
      text: textLines.join("\n"),
      html: `
        <div>
          <p><strong>New feedback submission</strong></p>
          <p>${escapeHtml(message).replaceAll("\n", "<br/>")}</p>
          <hr/>
          <ul>
            <li><strong>Source:</strong> ${escapeHtml(source)}</li>
            <li><strong>Submitted at:</strong> ${escapeHtml(submittedAt)}</li>
            <li><strong>Username:</strong> ${escapeHtml(username)}</li>
            <li><strong>User ID:</strong> ${escapeHtml(userId)}</li>
            <li><strong>User email:</strong> ${escapeHtml(userEmail)}</li>
            <li><strong>Current URL:</strong> ${escapeHtml(pageUrl)}</li>
            <li><strong>URL parameters:</strong> ${escapeHtml(urlParams)}</li>
          </ul>
        </div>
      `,
    });

    if (sendResult?.error) {
      console.error("feedback resend error", sendResult.error);
      respond(res, 502, { error: "Email provider rejected the feedback message." });
      return;
    }

    respond(res, 200, { delivered: true });
  } catch (error) {
    console.error("feedback send failed", error);
    respond(res, 500, { error: "Failed to send feedback." });
  }
}
