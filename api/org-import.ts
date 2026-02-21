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

const GEOCODE_CONCURRENCY = 4;
const WRITE_BATCH_SIZE = 10;

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

export default async function handler(req: OrgImportRequest, res: OrgImportResponse) {
  const trace = { step: "start", ts: Date.now() };
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
    const limit = parseLimit(body.limit, 25, importAll ? 200 : 100);
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

    trace.step = "createInstantClient";
    let db;
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
    const { batchId } = await createImportBatch(db, {
      label,
      filters: { category, nteePrefix, state, city, includeKeywords, excludeKeywords, limit, importAll },
      createdBy,
    });
    const requestedCount = enriched.length;
    const setBatchProgress = async (importedCount: number, skippedCount: number) => {
      try {
        await db.transact(
          tx.orgImports[batchId].update({
            requestedCount,
            importedCount,
            skippedCount,
            updatedAt: Date.now(),
          }),
        );
      } catch (progressError) {
        console.warn("org-import progress update failed", progressError);
      }
    };
    await setBatchProgress(0, 0);

    trace.step = "writeOrgs";
    const importedIds: string[] = [];
    const sampleOrgIds: string[] = [];
    let skippedNoGeocode = 0;
    const txBuffer: any[] = [];
    const txBufferOrgIds: string[] = [];

    const flushTxBuffer = async () => {
      if (txBuffer.length === 0) return;
      // Admin transact returns only tx metadata, so we track IDs before the write.
      await db.transact(txBuffer);
      importedIds.push(...txBufferOrgIds);
      txBuffer.length = 0;
      txBufferOrgIds.length = 0;
      await setBatchProgress(importedIds.length, skippedNoGeocode);
    };

    // Geocode in bounded parallel chunks to avoid long sequential stalls on big imports.
    for (let i = 0; i < enriched.length; i += GEOCODE_CONCURRENCY) {
      const chunk = enriched.slice(i, i + GEOCODE_CONCURRENCY);
      const chunkResults = await Promise.all(
        chunk.map(async (org: any) => {
          const coords = await geocodeAddress(org);
          return { org, coords };
        }),
      );

      for (const { org, coords } of chunkResults) {
        if (!coords) {
          skippedNoGeocode += 1;
          continue;
        }
        const categorySlug = mapNteeToCategory(org.nteeCode, category);
        const orgId = createId();
        const txItem = buildOrgTx(org, coords, categorySlug, batchId, orgId);
        txBuffer.push(txItem);
        txBufferOrgIds.push(orgId);
        sampleOrgIds.push(org.id);
        if (txBuffer.length >= WRITE_BATCH_SIZE) {
          await flushTxBuffer();
        }
      }

      // Keep heartbeat fresh so UI can show the import is still active.
      await setBatchProgress(importedIds.length, skippedNoGeocode);
    }

    await flushTxBuffer();
    const skippedCount = Math.max(0, requestedCount - importedIds.length);
    const status = skippedCount > 0 ? "partial" : "success";
    const warning =
      skippedCount > 0
        ? `Skipped ${skippedCount} orgs because geocoding did not return coordinates.`
        : null;

    trace.step = "finalizeBatch";
    await finalizeImportBatch(db, batchId, {
      status,
      requestedCount: enriched.length,
      importedCount: importedIds.length,
      skippedCount,
      skipReasons: skippedCount > 0 ? { geocodeNoMatch: skippedNoGeocode } : null,
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
    respond(res, 500, {
      ok: false,
      error: error?.message ?? "Import failed",
      details: error?.stack ?? String(error),
      trace,
    });
  }
}
