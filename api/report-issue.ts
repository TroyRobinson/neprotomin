import { createHash } from "node:crypto";
import { init as initAdmin, id as createId } from "@instantdb/admin";

type ReportRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string | string[]>;
  on?: (event: "data" | "end" | "error", listener: (...args: any[]) => void) => void;
};

type ReportResponse = {
  status: (code: number) => ReportResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

type ReportIssueBody = {
  orgId?: unknown;
  orgName?: unknown;
  text?: unknown;
  source?: unknown;
  reporterId?: unknown;
  reporterEmail?: unknown;
  pageUrl?: unknown;
  locale?: unknown;
};

type CommentRow = {
  id: string;
  orgId?: string;
  reporterKey?: string | null;
  ipHash?: string | null;
};

type OrganizationRow = {
  id: string;
  issueCount?: number | null;
  moderationStatus?: string | null;
};

const splitEntries = (value?: string | null): string[] => {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
};

const resolveAdminEmails = (): Set<string> => {
  const entries = [
    ...splitEntries(process.env.VITE_ADMIN_EMAIL),
    ...splitEntries(process.env.ADMIN_EMAIL),
  ];
  return new Set(entries);
};

const resolveAdminDomains = (): Set<string> => {
  const entries = [
    ...splitEntries(process.env.VITE_ADMIN_DOMAIN),
    ...splitEntries(process.env.ADMIN_DOMAIN),
  ].map((domain) => (domain.startsWith("@") ? domain.slice(1) : domain));
  return new Set(entries);
};

const ADMIN_EMAILS = resolveAdminEmails();
const ADMIN_DOMAINS = resolveAdminDomains();

const isAdminEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (ADMIN_EMAILS.has(normalized)) return true;

  const atIndex = normalized.lastIndexOf("@");
  if (atIndex === -1) return false;
  const domain = normalized.slice(atIndex + 1);
  if (!domain) return false;
  if (ADMIN_DOMAINS.has(domain)) return true;

  return false;
};

const resolveEnv = (key: string): string | undefined => {
  const raw = process.env[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw : undefined;
};

const APP_ID =
  resolveEnv("VITE_INSTANT_APP_ID") ??
  resolveEnv("NEXT_PUBLIC_INSTANT_APP_ID") ??
  resolveEnv("INSTANT_APP_ID");
const ADMIN_TOKEN =
  resolveEnv("INSTANT_APP_ADMIN_TOKEN") ??
  resolveEnv("INSTANT_ADMIN_TOKEN") ??
  resolveEnv("VITE_INSTANT_ADMIN_TOKEN");
const IP_HASH_SALT =
  resolveEnv("ISSUE_IP_SALT") ??
  resolveEnv("REPORT_ISSUE_IP_SALT") ??
  resolveEnv("IP_HASH_SALT");

if (!APP_ID || !ADMIN_TOKEN) {
  throw new Error("Missing InstantDB admin credentials for issue reporting endpoint.");
}

const adminDb = initAdmin({ appId: APP_ID, adminToken: ADMIN_TOKEN });

const parseBody = async (req: ReportRequest): Promise<ReportIssueBody> => {
  if (typeof req.body === "string") {
    return JSON.parse(req.body) as ReportIssueBody;
  }
  if (req.body && typeof req.body === "object") {
    return req.body as ReportIssueBody;
  }
  if (!req.on) {
    return {};
  }
  const data = await new Promise<string>((resolve, reject) => {
    let acc = "";
    const decoder = new TextDecoder();
    req.on?.("data", (chunk: unknown) => {
      if (typeof chunk === "string") {
        acc += chunk;
        return;
      }
      if (chunk instanceof Uint8Array) {
        acc += decoder.decode(chunk);
        return;
      }
      if (Array.isArray(chunk)) {
        acc += decoder.decode(Uint8Array.from(chunk as number[]));
        return;
      }
      acc += String(chunk);
    });
    req.on?.("end", () => resolve(acc));
    req.on?.("error", (error: Error) => reject(error));
  });
  if (!data) return {};
  return JSON.parse(data) as ReportIssueBody;
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const extractIp = (req: ReportRequest): string | null => {
  const headerNames = [
    "x-forwarded-for",
    "x-vercel-forwarded-for",
    "x-real-ip",
    "cf-connecting-ip",
  ];
  for (const headerName of headerNames) {
    const raw = req.headers[headerName];
    if (!raw) continue;
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value) continue;
    const first = value.split(",")[0]?.trim();
    if (first) return first;
  }
  const socketIp = (req as unknown as { socket?: { remoteAddress?: string | null } }).socket
    ?.remoteAddress;
  return socketIp ?? null;
};

const hashIp = (ip: string | null): string | null => {
  if (!ip || !IP_HASH_SALT) return null;
  return createHash("sha256").update(`${IP_HASH_SALT}::${ip}`).digest("hex");
};

const reporterKeyFrom = (reporterId: string | null, ipHash: string | null, email: string | null, fallbackToken: string): string => {
  if (reporterId) return reporterId;
  if (ipHash) return `ip:${ipHash}`;
  if (email) return `email:${email}`;
  return fallbackToken;
};

const reporterLookupKey = (comment: CommentRow): string => {
  if (comment.reporterKey) return comment.reporterKey;
  if (comment.ipHash) return `ip:${comment.ipHash}`;
  if (typeof comment.orgId === "string") return `anon:${comment.id}`;
  return `comment:${comment.id}`;
};

const fetchOrg = async (orgId: string): Promise<OrganizationRow | null> => {
  const resp = (await adminDb.query({
    organizations: {
      $: {
        where: { id: orgId },
        limit: 1,
      },
    },
  })) as any;
  const rows: OrganizationRow[] =
    resp?.data?.organizations ?? resp?.organizations ?? [];
  if (!rows || rows.length === 0) return null;
  return rows[0] ?? null;
};

const fetchCommentsForOrg = async (orgId: string): Promise<CommentRow[]> => {
  const resp = (await adminDb.query({
    comments: {
      $: {
        where: { orgId },
        limit: 500,
      },
    },
  })) as any;
  const rows: CommentRow[] = resp?.data?.comments ?? resp?.comments ?? [];
  return Array.isArray(rows) ? rows : [];
};

const fetchCommentsForReporterToday = async (
  reporterKey: string,
  startOfDay: number,
): Promise<CommentRow[]> => {
  const resp = (await adminDb.query({
    comments: {
      $: {
        where: {
          reporterKey,
          createdAt: { $gte: startOfDay },
        },
        limit: 500,
      },
    },
  })) as any;
  const rows: CommentRow[] = resp?.data?.comments ?? resp?.comments ?? [];
  return Array.isArray(rows) ? rows : [];
};

const respond = (res: ReportResponse, statusCode: number, payload: unknown): void => {
  res.setHeader("Content-Type", "application/json");
  res.status(statusCode).json(payload);
};

export default async function handler(req: ReportRequest, res: ReportResponse) {
  if (req.method !== "POST") {
    respond(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = await parseBody(req);
    const orgId = normalizeString(body.orgId);
    const orgName = normalizeString(body.orgName);
    const rawText = normalizeString(body.text);
    const source = normalizeString(body.source) ?? "Issue Button";
    const reporterId = normalizeString(body.reporterId);
    const reporterEmailRaw = normalizeString(body.reporterEmail);
    const reporterEmail = reporterEmailRaw ? reporterEmailRaw.toLowerCase() : null;
    const pageUrl = normalizeString(body.pageUrl);
    const locale = normalizeString(body.locale);

    if (!orgId || !orgName) {
      respond(res, 400, { error: "Missing organization information." });
      return;
    }
    if (!rawText) {
      respond(res, 400, { error: "Issue description is required." });
      return;
    }
    const text = rawText.slice(0, 2000); // limit to 2k characters

    const org = await fetchOrg(orgId);
    if (!org) {
      respond(res, 404, { error: "Organization not found." });
      return;
    }

    const ipAddress = extractIp(req);
    const ipHash = hashIp(ipAddress);
    const userAgentHeader = normalizeString(req.headers["user-agent"]);
    const refererHeader = normalizeString(req.headers.referer ?? req.headers.referrer);

    const reporterIsAdmin = reporterEmail ? isAdminEmail(reporterEmail) : false;
    const commentId = createId();
    const reporterKey = reporterKeyFrom(
      reporterId,
      ipHash,
      reporterEmail,
      `anon:${commentId}`,
    );

    const now = Date.now();
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const startOfDayTimestamp = startOfDay.getTime();

    if (!reporterIsAdmin && reporterKey) {
      const todays = await fetchCommentsForReporterToday(reporterKey, startOfDayTimestamp);
      const distinctOrgIds = new Set<string>();
      for (const comment of todays) {
        if (typeof comment.orgId === "string") {
          distinctOrgIds.add(comment.orgId);
        }
      }
      const alreadyReportedToday = distinctOrgIds.has(orgId);
      if (!alreadyReportedToday && distinctOrgIds.size >= 3) {
        respond(res, 429, {
          error: "You have reached the daily limit for reporting different organizations.",
        });
        return;
      }
    }

    const existingComments = await fetchCommentsForOrg(orgId);
    const reporterKeys = new Set<string>();
    for (const comment of existingComments) {
      reporterKeys.add(reporterLookupKey(comment));
    }

    const normalizedReporterKey = reporterKey || reporterLookupKey({ id: commentId, orgId, reporterKey: null, ipHash });
    if (!reporterKeys.has(normalizedReporterKey)) {
      reporterKeys.add(normalizedReporterKey);
    }

    const shouldRemove = reporterIsAdmin;
    const shouldPending =
      !reporterIsAdmin && reporterKeys.size >= 2 && org.moderationStatus !== "removed";

    const orgUpdates: Record<string, unknown> = {
      issueCount: existingComments.length + 1,
    };

    if (shouldRemove && org.moderationStatus !== "removed") {
      orgUpdates.moderationStatus = "removed";
      orgUpdates.moderationChangedAt = now;
    } else if (shouldPending && org.moderationStatus !== "pending") {
      orgUpdates.moderationStatus = "pending";
      orgUpdates.moderationChangedAt = now;
    }

    const context: Record<string, string> = {};
    if (userAgentHeader) context.userAgent = userAgentHeader;
    if (refererHeader) context.referer = refererHeader;
    if (pageUrl) context.pageUrl = pageUrl;
    if (locale) context.locale = locale;

    const commentPayload: Record<string, unknown> = {
      orgId,
      orgName,
      text,
      source,
      reporterId: reporterId ?? null,
      reporterEmail: reporterEmail ?? null,
      reporterKey,
      reporterIsAdmin,
      ipHash,
      createdAt: now,
      context: Object.keys(context).length > 0 ? context : null,
    };

    await adminDb.transact([
      adminDb.tx.comments[commentId].update(commentPayload),
      adminDb.tx.organizations[orgId].update(orgUpdates),
    ]);

    respond(res, 200, {
      success: true,
      data: {
        issueCount: existingComments.length + 1,
        reporterIsAdmin,
        moderationStatus: (orgUpdates.moderationStatus as string | undefined) ?? org.moderationStatus ?? null,
        distinctReporterCount: reporterKeys.size,
      },
    });
  } catch (error) {
    console.error("[report-issue] Failed to process issue report:", error);
    respond(res, 500, { error: "Failed to submit issue report." });
  }
}
