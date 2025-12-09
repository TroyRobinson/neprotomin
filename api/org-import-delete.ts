import type { IncomingMessage } from "node:http";
import { createInstantClient, tx } from "./_shared/orgImport.js";

type OrgImportDeleteRequest = IncomingMessage & {
  method?: string;
  body?: unknown;
};

type OrgImportDeleteResponse = {
  status: (code: number) => OrgImportDeleteResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

const respond = (res: OrgImportDeleteResponse, statusCode: number, payload: unknown): void => {
  res.setHeader("Content-Type", "application/json");
  res.status(statusCode).json(payload);
};

const parseBody = async (req: OrgImportDeleteRequest): Promise<any> => {
  if (typeof req.body === "string") return JSON.parse(req.body);
  if (req.body && typeof req.body === "object") return req.body;
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    (req as any).on("data", (chunk: any) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    (req as any).on("end", () => resolve());
    (req as any).on("error", (err: Error) => reject(err));
  });
  const data = Buffer.concat(chunks).toString("utf8");
  return data ? JSON.parse(data) : {};
};

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export default async function handler(req: OrgImportDeleteRequest, res: OrgImportDeleteResponse) {
  if (req.method !== "POST") {
    respond(res, 405, { error: "Method not allowed" });
    return;
  }

  let batchId: string | null = null;
  try {
    const body = await parseBody(req);
    batchId = normalizeString(body?.batchId);
  } catch {
    respond(res, 400, { error: "Invalid JSON body" });
    return;
  }

  if (!batchId) {
    respond(res, 400, { error: "batchId is required" });
    return;
  }

  try {
    const db = createInstantClient();
    let totalDeleted = 0;
    while (true) {
      const resp = await db.query({
        organizations: {
          $: { where: { importBatchId: batchId }, fields: ["id"], limit: 50 },
        },
      });
      const orgs = (resp as any)?.data?.organizations ?? (resp as any)?.organizations ?? [];
      if (!orgs.length) break;
      const txs = orgs.map((org: any) => tx.organizations[org.id].delete());
      await db.transact(txs);
      totalDeleted += orgs.length;
      if (orgs.length < 50) break;
    }

    await db.transact(tx.orgImports[batchId].delete());

    respond(res, 200, { ok: true, deleted: totalDeleted });
  } catch (error: any) {
    console.error("org-import-delete failed", error);
    respond(res, 500, { ok: false, error: error?.message ?? "Failed to delete import batch" });
  }
}
