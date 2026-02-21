/// <reference types="node" />
import type { IncomingMessage } from "node:http";
import {
  buildOrgTx,
  createImportBatch,
  createInstantClient,
  finalizeImportBatch,
  fetchProPublicaOrgs,
  filterOrgsByKeywords,
  enrichProPublicaOrgsWithDetails,
  geocodeAddress,
  id as createId,
  mapNteeToCategory,
  tx,
} from "./_shared/orgImport.js";

type OrgImportRequest = IncomingMessage & {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
};

type OrgImportResponse = {
  status: (code: number) => OrgImportResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

type OrgImportBody = {
  category?: unknown;
  nteePrefix?: unknown;
  state?: unknown;
  city?: unknown;
  includeKeywords?: unknown;
  excludeKeywords?: unknown;
  limit?: unknown;
  importAll?: unknown;
  label?: unknown;
  createdBy?: unknown;
};

const respond = (res: OrgImportResponse, statusCode: number, payload: unknown): void => {
  try {
    res.setHeader("Content-Type", "application/json");
  } catch {
    // noop: some runtimes disallow setHeader after error
  }
  res.status(statusCode).json(payload);
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  return null;
};

const parseBool = (value: unknown): boolean => value === true || value === "true";

const parseLimit = (raw: unknown, defaultLimit: number, max: number): number => {
  if (typeof raw === "number" && Number.isFinite(raw)) return Math.min(max, Math.max(1, raw));
  if (typeof raw === "string") {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return Math.min(max, Math.max(1, parsed));
  }
  return defaultLimit;
};

const parseBody = async (req: OrgImportRequest): Promise<OrgImportBody> => {
  if (typeof req.body === "string") {
    return JSON.parse(req.body);
  }
  if (req.body && typeof req.body === "object") {
    return req.body as OrgImportBody;
  }
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    (req as any).on("data", (chunk: any) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    (req as any).on("end", () => resolve());
    (req as any).on("error", (err: Error) => reject(err));
  });
  const data = Buffer.concat(chunks).toString("utf8");
  return data ? (JSON.parse(data) as OrgImportBody) : {};
};

const normalizeEin = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") {
    const digits = value.replace(/\D/g, "");
    return digits.length > 0 ? digits : null;
  }
  return null;
};

const dedupeOrgsByEin = <T extends { ein?: unknown }>(orgs: T[]): { items: T[]; droppedCount: number } => {
  const seen = new Set<string>();
  const items: T[] = [];
  let droppedCount = 0;
  for (const org of orgs) {
    const ein = normalizeEin(org.ein);
    if (ein) {
      if (seen.has(ein)) {
        droppedCount += 1;
        continue;
      }
      seen.add(ein);
    }
    items.push(org);
  }
  return { items, droppedCount };
};

const GEOCODE_CONCURRENCY = 4;
const WRITE_BATCH_SIZE = 10;
const TX_TIMEOUT_MS = 15_000;
const TX_RETRIES = 2;
const DEFAULT_IMPORT_LIMIT = 300;
const MAX_IMPORT_LIMIT = 300;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const transactWithRetry = async (
  db: { transact: (ops: any) => Promise<any> },
  ops: any,
  label: string,
  retries = TX_RETRIES,
): Promise<void> => {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await withTimeout(Promise.resolve(db.transact(ops)), TX_TIMEOUT_MS, `${label} (attempt ${attempt + 1})`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(250 * (attempt + 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

const fetchAllOrgs = async (options: {
  query: string;
  state?: string | null;
  city?: string | null;
  nteePrefix?: string | null;
  max: number;
}) => {
  const items: any[] = [];
  let page = 0;
  while (items.length < options.max) {
    let pageItems;
    let total;
    try {
      const res = await fetchProPublicaOrgs({
        query: options.query,
        state: options.state ?? undefined,
        city: options.city ?? undefined,
        nteePrefix: options.nteePrefix ?? undefined,
        page,
      });
      pageItems = res.items;
      total = res.total;
    } catch (err) {
      if (options.nteePrefix) {
        // Retry once without NTEE if upstream rejects that param
        const res = await fetchProPublicaOrgs({
          query: options.query,
          state: options.state ?? undefined,
          city: options.city ?? undefined,
          nteePrefix: undefined,
          page,
        });
        pageItems = res.items;
        total = res.total;
      } else {
        throw err;
      }
    }
    if (!pageItems.length) break;
    items.push(...pageItems);
    if (items.length >= total) break;
    if (pageItems.length < 20) break; // heuristic: API page size
    page += 1;
  }
  return items.slice(0, options.max);
};

const fetchExistingOrgIdsByEin = async (
  db: { query: (query: unknown) => Promise<any> },
  orgs: Array<{ ein?: unknown }>,
): Promise<Map<string, string>> => {
  const uniqueEins = Array.from(
    new Set(
      orgs
        .map((org) => normalizeEin(org.ein))
        .filter((ein): ein is string => !!ein),
    ),
  );
  if (uniqueEins.length === 0) return new Map<string, string>();

  const response = await db.query({
    organizations: {
      $: {
        where: {
          ein: { $in: uniqueEins },
        },
        fields: ["id", "ein", "updatedAt", "createdAt"],
        limit: Math.max(200, uniqueEins.length),
      },
    },
  });

  const rows = Array.isArray(response?.organizations) ? response.organizations : [];
  const latestByEin = new Map<string, { id: string; rank: number }>();
  for (const row of rows) {
    const id = normalizeString(row?.id);
    const ein = normalizeEin(row?.ein);
    if (!id || !ein) continue;
    const rank =
      typeof row?.updatedAt === "number"
        ? row.updatedAt
        : typeof row?.createdAt === "number"
        ? row.createdAt
        : 0;
    const current = latestByEin.get(ein);
    if (!current || rank >= current.rank) {
      latestByEin.set(ein, { id, rank });
    }
  }

  const map = new Map<string, string>();
  for (const [ein, value] of latestByEin.entries()) {
    map.set(ein, value.id);
  }
  return map;
};

export default async function handler(req: OrgImportRequest, res: OrgImportResponse) {
  const trace = { step: "start", ts: Date.now() };
  let db: ReturnType<typeof createInstantClient> | null = null;
  let batchId: string | null = null;
  let requestedCount = 0;
  let importedCount = 0;
  let skippedNoGeocode = 0;
  let skippedDuplicateEin = 0;
  try {
    if (req.method !== "POST") {
      respond(res, 405, { ok: false, error: "Method not allowed", trace });
      return;
    }

    let body: OrgImportBody;
    try {
      trace.step = "parseBody";
      body = await parseBody(req);
    } catch (error) {
      respond(res, 400, { ok: false, error: "Invalid JSON body", details: String(error), trace });
      return;
    }

    const category = normalizeString(body.category) ?? "health";
    const nteePrefix = normalizeString(body.nteePrefix);
    const state = normalizeString(body.state);
    const city = normalizeString(body.city);
    const includeKeywords = normalizeString(body.includeKeywords) ?? "";
    const excludeKeywords = normalizeString(body.excludeKeywords) ?? "";
    const importAll = parseBool(body.importAll);
    const limit = parseLimit(body.limit, DEFAULT_IMPORT_LIMIT, MAX_IMPORT_LIMIT);
    const label = normalizeString(body.label) ?? "ProPublica import";
    const createdBy = normalizeString(body.createdBy);

    const missingAdminToken = !process.env.INSTANT_APP_ADMIN_TOKEN;
    if (missingAdminToken) {
      respond(res, 500, {
        ok: false,
        error: "Missing INSTANT_APP_ADMIN_TOKEN",
        hint: "Set INSTANT_APP_ADMIN_TOKEN and app id env (VITE_INSTANT_APP_ID or NEXT_PUBLIC_INSTANT_APP_ID) for imports.",
        trace,
      });
      return;
    }

    trace.step = "fetchAllOrgs";
    const requested = await fetchAllOrgs({
      query: includeKeywords || category || "",
      state,
      city,
      nteePrefix,
      max: limit,
    });
    const filtered = filterOrgsByKeywords(requested, includeKeywords, excludeKeywords, false);

    trace.step = "enrichDetails";
    const enriched = await enrichProPublicaOrgsWithDetails(filtered);
    const einDeduped = dedupeOrgsByEin(enriched);
    const dedupedEnriched = einDeduped.items;
    skippedDuplicateEin = einDeduped.droppedCount;

    trace.step = "createInstantClient";
    try {
      db = createInstantClient();
    } catch (clientError: any) {
      respond(res, 500, {
        ok: false,
        error: clientError?.message ?? "Failed to init Instant admin client",
        details: clientError?.stack ?? String(clientError),
      });
      return;
    }

    trace.step = "createBatch";
    const createdBatch = await createImportBatch(db, {
      label,
      filters: { category, nteePrefix, state, city, includeKeywords, excludeKeywords, limit, importAll },
      createdBy,
    });
    batchId = createdBatch.batchId;
    const activeBatchId = createdBatch.batchId;
    requestedCount = enriched.length;
    const getSkippedCount = () => skippedNoGeocode + skippedDuplicateEin;
    const setBatchProgress = async (importedCount: number, skippedCount: number) => {
      try {
        await transactWithRetry(
          db,
          tx.orgImports[activeBatchId].update({
            requestedCount,
            importedCount,
            skippedCount,
            updatedAt: Date.now(),
          }),
          "org-import progress update",
        );
      } catch (progressError) {
        console.warn("org-import progress update failed", progressError);
      }
    };
    await setBatchProgress(0, getSkippedCount());

    trace.step = "lookupExistingByEin";
    let existingOrgIdsByEin = new Map<string, string>();
    try {
      // Reuse existing records when EIN matches to prevent duplicates on re-import.
      existingOrgIdsByEin = await fetchExistingOrgIdsByEin(db, dedupedEnriched);
    } catch (lookupError) {
      console.warn("org-import existing EIN lookup failed; continuing without dedupe", lookupError);
    }

    trace.step = "writeOrgs";
    const importedIds: string[] = [];
    const importedIdSet = new Set<string>();
    const sampleOrgIds: string[] = [];
    const txBuffer: any[] = [];
    const txBufferOrgIds: string[] = [];

    const flushTxBuffer = async () => {
      if (txBuffer.length === 0) return;
      // Admin transact returns only tx metadata, so we track IDs before the write.
      await transactWithRetry(db, txBuffer, "org-import write organizations");
      for (const id of txBufferOrgIds) {
        if (importedIdSet.has(id)) continue;
        importedIdSet.add(id);
        importedIds.push(id);
      }
      importedCount = importedIds.length;
      txBuffer.length = 0;
      txBufferOrgIds.length = 0;
      await setBatchProgress(importedIds.length, getSkippedCount());
    };

    // Geocode in bounded parallel chunks to avoid long sequential stalls on big imports.
    for (let i = 0; i < dedupedEnriched.length; i += GEOCODE_CONCURRENCY) {
      const chunk = dedupedEnriched.slice(i, i + GEOCODE_CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (org: any) => {
          const coords = await geocodeAddress(org);
          return { org, coords };
        }),
      );

      for (const { org, coords } of chunkResults) {
        if (!coords) {
          skippedNoGeocode += 1;
          importedCount = importedIds.length;
          continue;
        }
        const categorySlug = mapNteeToCategory(org.nteeCode, category);
        const normalizedEin = normalizeEin(org.ein);
        const existingOrgId = normalizedEin ? (existingOrgIdsByEin.get(normalizedEin) ?? null) : null;
        const orgId = existingOrgId ?? createId();
        if (normalizedEin && !existingOrgId) {
          existingOrgIdsByEin.set(normalizedEin, orgId);
        }
        const txItem = buildOrgTx(
          {
            ...org,
            ein: normalizedEin ?? org.ein ?? null,
          },
          coords,
          categorySlug,
          batchId,
          orgId,
        );
        txBuffer.push(txItem);
        txBufferOrgIds.push(orgId);
        sampleOrgIds.push(org.id);
        if (txBuffer.length >= WRITE_BATCH_SIZE) {
          await flushTxBuffer();
        }
      }

      // Keep heartbeat fresh so UI can show the import is still active.
      await setBatchProgress(importedIds.length, getSkippedCount());
    }

    await flushTxBuffer();
    const skippedCount = Math.max(0, requestedCount - importedIds.length);
    const status = skippedCount > 0 ? "partial" : "success";
    const knownSkipped = skippedNoGeocode + skippedDuplicateEin;
    const skippedOther = Math.max(0, skippedCount - knownSkipped);
    const skipReasons: Record<string, number> = {};
    if (skippedNoGeocode > 0) skipReasons.geocodeNoMatch = skippedNoGeocode;
    if (skippedDuplicateEin > 0) skipReasons.duplicateEin = skippedDuplicateEin;
    if (skippedOther > 0) skipReasons.other = skippedOther;
    const warningParts: string[] = [];
    if (skippedNoGeocode > 0) warningParts.push(`${skippedNoGeocode} no geocode match`);
    if (skippedDuplicateEin > 0) warningParts.push(`${skippedDuplicateEin} duplicate EIN`);
    if (skippedOther > 0) warningParts.push(`${skippedOther} other`);
    const warning =
      skippedCount > 0
        ? warningParts.length > 0
          ? `Skipped ${skippedCount} orgs (${warningParts.join(", ")}).`
          : `Skipped ${skippedCount} orgs.`
        : null;

    trace.step = "finalizeBatch";
    await finalizeImportBatch(db, batchId, {
      status,
      requestedCount: enriched.length,
      importedCount: importedIds.length,
      skippedCount,
      skipReasons: skippedCount > 0 ? skipReasons : null,
      sampleOrgIds: sampleOrgIds.slice(0, 10),
      orgIds: importedIds,
      error: warning,
      updatedAt: Date.now(),
    });

    respond(res, 200, {
      ok: true,
      batchId,
      status,
      requested: filtered.length,
      imported: importedIds.length,
      skipped: skippedCount,
      sampleOrgIds: sampleOrgIds.slice(0, 10),
      warning,
    });
  } catch (error: any) {
    console.error("org-import failed", { error, trace });
    if (db && batchId) {
      const estimatedSkipped = Math.max(0, requestedCount - importedCount);
      const finalSkipped = Math.max(skippedNoGeocode + skippedDuplicateEin, estimatedSkipped);
      const status = importedCount > 0 || finalSkipped > 0 ? "partial" : "error";
      const knownSkipped = skippedNoGeocode + skippedDuplicateEin;
      const skippedOther = Math.max(0, finalSkipped - knownSkipped);
      const skipReasons: Record<string, number> = {};
      if (skippedNoGeocode > 0) skipReasons.geocodeNoMatch = skippedNoGeocode;
      if (skippedDuplicateEin > 0) skipReasons.duplicateEin = skippedDuplicateEin;
      if (skippedOther > 0) skipReasons.other = skippedOther;
      try {
        await finalizeImportBatch(db, batchId, {
          status,
          requestedCount: requestedCount || null,
          importedCount,
          skippedCount: finalSkipped,
          skipReasons: finalSkipped > 0 ? skipReasons : null,
          error: `Import interrupted: ${error?.message ?? "Unknown failure"}`,
          updatedAt: Date.now(),
        });
      } catch (finalizeError) {
        console.error("org-import finalize after failure failed", finalizeError);
      }
    }
    respond(res, 500, {
      ok: false,
      error: error?.message ?? "Import failed",
      details: error?.stack ?? String(error),
      trace,
    });
  }
}
