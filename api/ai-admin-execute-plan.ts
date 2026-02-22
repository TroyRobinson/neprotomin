import type { IncomingMessage } from "node:http";

import {
  isWriteActionType,
  validateAiAdminPlanRequest,
  type AiAdminAction,
  type AiAdminRunCaps,
} from "./_shared/aiAdminPlan.ts";
import {
  createAiAdminDb,
  executeAiAdminWriteAction,
  findExistingStatConflicts,
} from "./_shared/aiAdminActions.ts";
import {
  approveAiAdminRun,
  completeAiAdminRunStep,
  createAiAdminRun,
  failAiAdminRunStep,
  getAiAdminRun,
  pauseAiAdminRun,
  restoreAiAdminRunFromSnapshot,
  resumeAiAdminRun,
  startNextAiAdminRunStep,
  stopAiAdminRun,
  type AiAdminRunSnapshot,
} from "./_shared/aiAdminRunStore.ts";

type AiAdminExecuteRequest = IncomingMessage & {
  method?: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
  on?: (event: "data" | "end" | "error", listener: (...args: unknown[]) => void) => void;
};

type AiAdminExecuteResponse = {
  status: (code: number) => AiAdminExecuteResponse;
  json: (payload: unknown) => void;
  setHeader: (name: string, value: string) => void;
};

type InstantAdminLike = {
  query: (query: unknown) => Promise<unknown>;
  transact: (ops: unknown | unknown[]) => Promise<unknown>;
};

type ExecuteWriteAction = (
  db: InstantAdminLike,
  action: AiAdminAction,
  context: { runId: string; caps: AiAdminRunCaps; callerEmail: string | null },
) => Promise<unknown>;

type DetectPreflightConflicts = (
  db: InstantAdminLike,
  actions: AiAdminAction[],
) => Promise<
  Array<{
    actionId: string;
    actionType: string;
    reason: string;
    statId?: string;
    statName?: string;
    neId?: string;
    detail: string;
  }>
>;

type HandlerDeps = {
  executeWriteAction?: ExecuteWriteAction;
  detectPreflightConflicts?: DetectPreflightConflicts;
  createDb?: () => InstantAdminLike;
  now?: () => number;
};

type ResolverState = {
  statIdByActionId: Map<string, string>;
  statIdByNeId: Map<string, string>;
  statIdByName: Map<string, string>;
};

type AiAdminRunCommand =
  | "create_run"
  | "get_run"
  | "approve_run"
  | "run_next_step"
  | "pause_run"
  | "resume_run"
  | "stop_run";

const AI_ADMIN_RUN_COMMANDS = new Set<AiAdminRunCommand>([
  "create_run",
  "get_run",
  "approve_run",
  "run_next_step",
  "pause_run",
  "resume_run",
  "stop_run",
]);

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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

const parseBody = async (req: AiAdminExecuteRequest): Promise<Record<string, unknown>> => {
  if (typeof req.body === "string") {
    return JSON.parse(req.body) as Record<string, unknown>;
  }
  if (req.body && typeof req.body === "object" && !Array.isArray(req.body)) {
    return req.body as Record<string, unknown>;
  }
  if (!req.on) return {};

  const text = await new Promise<string>((resolve, reject) => {
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
    req.on?.("error", (error: unknown) => reject(error));
  });

  if (!text) return {};
  return JSON.parse(text) as Record<string, unknown>;
};

const respond = (res: AiAdminExecuteResponse, statusCode: number, payload: unknown): void => {
  res.setHeader("Content-Type", "application/json");
  res.status(statusCode).json(payload);
};

const readApiKeyFromRequest = (req: AiAdminExecuteRequest): string | null => {
  const direct = req.headers["x-ai-admin-api-key"];
  if (typeof direct === "string" && direct.trim().length > 0) return direct.trim();
  if (Array.isArray(direct) && direct[0] && direct[0].trim().length > 0) return direct[0].trim();

  const auth = req.headers.authorization;
  const header = typeof auth === "string" ? auth : Array.isArray(auth) && auth[0] ? auth[0] : "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
};

const isProduction = (): boolean => {
  const mode = normalizeString(process.env.NODE_ENV) ?? "development";
  return mode === "production";
};

const getConfiguredApiKey = (): string | null =>
  resolveEnv("AI_ADMIN_API_KEY") ?? resolveEnv("VITE_AI_ADMIN_API_KEY") ?? null;

const isAdminEmail = (email: string | null | undefined): boolean => {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;

  const adminEmails = new Set<string>([
    ...splitEntries(resolveEnv("ADMIN_EMAIL") ?? null),
    ...splitEntries(resolveEnv("VITE_ADMIN_EMAIL") ?? null),
  ]);
  if (adminEmails.has(normalized)) return true;

  const atIndex = normalized.lastIndexOf("@");
  if (atIndex === -1) return false;
  const domain = normalized.slice(atIndex + 1);
  if (!domain) return false;

  const adminDomains = new Set<string>(
    [
      ...splitEntries(resolveEnv("ADMIN_DOMAIN") ?? null),
      ...splitEntries(resolveEnv("VITE_ADMIN_DOMAIN") ?? null),
    ].map((candidate) => (candidate.startsWith("@") ? candidate.slice(1) : candidate)),
  );

  return adminDomains.has(domain);
};

const authorizeRequest = (
  req: AiAdminExecuteRequest,
  callerEmail: string | null,
): { ok: boolean; reason?: string } => {
  const configuredApiKey = getConfiguredApiKey();
  if (configuredApiKey) {
    const supplied = readApiKeyFromRequest(req);
    if (supplied && supplied === configuredApiKey) return { ok: true };
    return { ok: false, reason: "invalid_api_key" };
  }

  // Local fallback for dev/test if no API key is configured.
  if (!isProduction() && isAdminEmail(callerEmail)) return { ok: true };

  return {
    ok: false,
    reason: isProduction() ? "missing_api_key_configuration" : "admin_email_required",
  };
};

const readCommand = (value: unknown): AiAdminRunCommand | null => {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  if (AI_ADMIN_RUN_COMMANDS.has(normalized as AiAdminRunCommand)) {
    return normalized as AiAdminRunCommand;
  }
  return null;
};

const createRunId = (now: number): string => `ai-run-${now}`;

const summarizeUnknown = (value: unknown): string => {
  if (value == null) return "null";
  if (typeof value === "string") return value.length > 120 ? `${value.slice(0, 117)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return "object";
    return keys
      .slice(0, 5)
      .map((key) => {
        const entry = (value as Record<string, unknown>)[key];
        if (entry == null || typeof entry === "number" || typeof entry === "boolean") {
          return `${key}=${String(entry)}`;
        }
        if (typeof entry === "string") {
          return `${key}=${entry.length > 30 ? `${entry.slice(0, 27)}...` : entry}`;
        }
        if (Array.isArray(entry)) return `${key}=array(${entry.length})`;
        return `${key}=object`;
      })
      .join("; ");
  }
  return String(value);
};

const collectResolverState = (run: AiAdminRunSnapshot): ResolverState => {
  const state: ResolverState = {
    statIdByActionId: new Map<string, string>(),
    statIdByNeId: new Map<string, string>(),
    statIdByName: new Map<string, string>(),
  };

  for (let index = 0; index < run.steps.length; index += 1) {
    const step = run.steps[index] as typeof run.steps[number] & { resultMeta?: Record<string, unknown> | null };
    if (step.status !== "completed" || !step.resultMeta || typeof step.resultMeta !== "object") continue;
    const action = run.actions[index];
    if (!action) continue;
    const createdStatId = normalizeString(step.resultMeta.createdStatId);
    if (!createdStatId) continue;

    state.statIdByActionId.set(action.id, createdStatId);

    const createdStatName = normalizeString(step.resultMeta.createdStatName);
    if (createdStatName) state.statIdByName.set(createdStatName, createdStatId);

    const importVariable = normalizeString(step.resultMeta.importVariable);
    if (importVariable) {
      state.statIdByNeId.set(`census:${importVariable}`, createdStatId);
    }

    if (action.type === "import_census_stat") {
      const variable = normalizeString(action.payload.variable);
      if (variable) state.statIdByNeId.set(`census:${variable}`, createdStatId);
    }
    if (action.type === "create_derived_stat") {
      const name = normalizeString(action.payload.name);
      if (name) state.statIdByName.set(name, createdStatId);
    }
  }

  return state;
};

const extractStatsRows = (resp: unknown): Array<Record<string, unknown>> => {
  if (!isRecord(resp)) return [];
  const statsNode = (resp as Record<string, unknown>).stats;
  if (Array.isArray(statsNode)) {
    return statsNode.filter((row): row is Record<string, unknown> => isRecord(row));
  }
  if (isRecord(statsNode) && Array.isArray(statsNode.data)) {
    return statsNode.data.filter((row): row is Record<string, unknown> => isRecord(row));
  }
  return [];
};

const lookupExistingStats = async (
  db: InstantAdminLike,
  input: { names?: string[]; neIds?: string[] },
): Promise<{ byName: Map<string, string>; byNeId: Map<string, string> }> => {
  const names = Array.from(new Set((input.names ?? []).map((v) => v.trim()).filter(Boolean)));
  const neIds = Array.from(new Set((input.neIds ?? []).map((v) => v.trim()).filter(Boolean)));
  if (names.length === 0 && neIds.length === 0) {
    return { byName: new Map(), byNeId: new Map() };
  }

  const where: Record<string, unknown>[] = [];
  if (names.length > 0) where.push({ name: { $in: names } });
  if (neIds.length > 0) where.push({ neId: { $in: neIds } });

  const resp = await db.query({
    stats: {
      $: {
        where: where.length > 1 ? { or: where } : where[0],
        fields: ["id", "name", "neId"],
      },
    },
  });
  const rows = extractStatsRows(resp);
  const byName = new Map<string, string>();
  const byNeId = new Map<string, string>();
  for (const row of rows) {
    const id = normalizeString(row.id);
    if (!id) continue;
    const name = normalizeString(row.name);
    const neId = normalizeString(row.neId);
    if (name && !byName.has(name)) byName.set(name, id);
    if (neId && !byNeId.has(neId)) byNeId.set(neId, id);
  }
  return { byName, byNeId };
};

const resolveDerivedActionDependencies = async (
  db: InstantAdminLike,
  action: AiAdminAction,
  state: ResolverState,
): Promise<{ ok: true; action: AiAdminAction } | { ok: false; message: string }> => {
  const payload = { ...action.payload };
  const unresolvedNeIds = new Set<string>();

  const resolveByImportStepOrVariable = (
    importStepIdKey: string,
    variableKey: string,
    outputIdKey: string,
  ) => {
    const existingId = normalizeString(payload[outputIdKey]);
    if (existingId) return;

    const importStepId = normalizeString(payload[importStepIdKey]);
    if (importStepId) {
      const mapped = state.statIdByActionId.get(importStepId);
      if (mapped) {
        payload[outputIdKey] = mapped;
        return;
      }
    }

    const variable = normalizeString(payload[variableKey]);
    if (variable) {
      const neId = `census:${variable}`;
      const mapped = state.statIdByNeId.get(neId);
      if (mapped) {
        payload[outputIdKey] = mapped;
        return;
      }
      unresolvedNeIds.add(neId);
    }
  };

  resolveByImportStepOrVariable("numeratorImportStepId", "numeratorVariable", "numeratorId");
  resolveByImportStepOrVariable("denominatorImportStepId", "denominatorVariable", "denominatorId");

  if (!Array.isArray(payload.sumOperandIds) || payload.sumOperandIds.length === 0) {
    const resolvedIds: string[] = [];
    const unresolvedOperands: string[] = [];
    const importStepIds = Array.isArray(payload.sumOperandImportStepIds)
      ? payload.sumOperandImportStepIds.map((entry) => normalizeString(entry))
      : [];
    const variables = Array.isArray(payload.sumOperandVariables)
      ? payload.sumOperandVariables.map((entry) => normalizeString(entry))
      : [];
    const maxLen = Math.max(importStepIds.length, variables.length);
    for (let i = 0; i < maxLen; i += 1) {
      const importStepId = importStepIds[i] ?? null;
      const variable = variables[i] ?? null;
      if (importStepId && state.statIdByActionId.has(importStepId)) {
        resolvedIds.push(state.statIdByActionId.get(importStepId)!);
        continue;
      }
      if (variable) {
        const neId = `census:${variable}`;
        const mapped = state.statIdByNeId.get(neId);
        if (mapped) {
          resolvedIds.push(mapped);
          continue;
        }
        unresolvedNeIds.add(neId);
        unresolvedOperands.push(variable);
        continue;
      }
      if (importStepId) unresolvedOperands.push(importStepId);
    }
    if (resolvedIds.length > 0) payload.sumOperandIds = resolvedIds;
    if (unresolvedOperands.length > 0) {
      // Preserve unresolved detail for error message.
      (payload as Record<string, unknown>).__resolverUnresolvedOperands = unresolvedOperands;
    }
  }

  if (unresolvedNeIds.size > 0) {
    const lookup = await lookupExistingStats(db, { neIds: Array.from(unresolvedNeIds) });
    for (const [neId, statId] of lookup.byNeId.entries()) {
      state.statIdByNeId.set(neId, statId);
    }

    resolveByImportStepOrVariable("numeratorImportStepId", "numeratorVariable", "numeratorId");
    resolveByImportStepOrVariable("denominatorImportStepId", "denominatorVariable", "denominatorId");

    if (!Array.isArray(payload.sumOperandIds) || payload.sumOperandIds.length === 0) {
      const variables = Array.isArray(payload.sumOperandVariables)
        ? payload.sumOperandVariables.map((entry) => normalizeString(entry)).filter((entry): entry is string => Boolean(entry))
        : [];
      const resolvedIds = variables
        .map((variable) => state.statIdByNeId.get(`census:${variable}`) ?? null)
        .filter((entry): entry is string => Boolean(entry));
      if (resolvedIds.length > 0) payload.sumOperandIds = resolvedIds;
    }
  }

  const missing: string[] = [];
  if (normalizeString(payload.numeratorVariable) && !normalizeString(payload.numeratorId)) {
    missing.push(`numerator ${String(payload.numeratorVariable)}`);
  }
  if (normalizeString(payload.denominatorVariable) && !normalizeString(payload.denominatorId)) {
    missing.push(`denominator ${String(payload.denominatorVariable)}`);
  }
  if (Array.isArray(payload.sumOperandVariables)) {
    const operandIds = Array.isArray(payload.sumOperandIds)
      ? payload.sumOperandIds.map((entry) => normalizeString(entry)).filter((entry): entry is string => Boolean(entry))
      : [];
    const operandVars = payload.sumOperandVariables
      .map((entry) => normalizeString(entry))
      .filter((entry): entry is string => Boolean(entry));
    if (operandVars.length > 0 && operandIds.length < operandVars.length) {
      const unresolved = operandVars.filter((variable) => !state.statIdByNeId.has(`census:${variable}`));
      if (unresolved.length > 0) {
        missing.push(`sum operands ${unresolved.join(", ")}`);
      }
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      message: `Derived stat dependencies are not resolved yet: ${missing.join("; ")}.`,
    };
  }

  delete (payload as Record<string, unknown>).__resolverUnresolvedOperands;
  return { ok: true, action: { ...action, payload } };
};

const resolveFamilyActionDependencies = async (
  db: InstantAdminLike,
  action: AiAdminAction,
  state: ResolverState,
): Promise<{ ok: true; action: AiAdminAction } | { ok: false; message: string }> => {
  const payload = { ...action.payload };
  const unresolvedNames = new Set<string>();

  const parentStatId = normalizeString(payload.parentStatId);
  if (!parentStatId) {
    const parentName = normalizeString(payload.parentName);
    if (parentName) {
      const mapped = state.statIdByName.get(parentName);
      if (mapped) payload.parentStatId = mapped;
      else unresolvedNames.add(parentName);
    }
  }

  const existingChildIds = Array.isArray(payload.childStatIds)
    ? payload.childStatIds.map((entry) => normalizeString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  if (existingChildIds.length === 0) {
    const childNames = Array.isArray(payload.childNames)
      ? payload.childNames.map((entry) => normalizeString(entry)).filter((entry): entry is string => Boolean(entry))
      : [];
    const resolvedChildIds: string[] = [];
    for (const childName of childNames) {
      const mapped = state.statIdByName.get(childName);
      if (mapped) resolvedChildIds.push(mapped);
      else unresolvedNames.add(childName);
    }
    if (resolvedChildIds.length > 0) payload.childStatIds = resolvedChildIds;
  }

  if (unresolvedNames.size > 0) {
    const lookup = await lookupExistingStats(db, { names: Array.from(unresolvedNames) });
    for (const [name, statId] of lookup.byName.entries()) {
      state.statIdByName.set(name, statId);
    }

    if (!normalizeString(payload.parentStatId)) {
      const parentName = normalizeString(payload.parentName);
      if (parentName) {
        const mapped = state.statIdByName.get(parentName);
        if (mapped) payload.parentStatId = mapped;
      }
    }
    if (!Array.isArray(payload.childStatIds) || payload.childStatIds.length === 0) {
      const childNames = Array.isArray(payload.childNames)
        ? payload.childNames.map((entry) => normalizeString(entry)).filter((entry): entry is string => Boolean(entry))
        : [];
      const resolvedChildIds = childNames
        .map((childName) => state.statIdByName.get(childName) ?? null)
        .filter((entry): entry is string => Boolean(entry));
      if (resolvedChildIds.length > 0) payload.childStatIds = resolvedChildIds;
    }
  }

  const missingNames: string[] = [];
  if (!normalizeString(payload.parentStatId) && normalizeString(payload.parentName)) {
    missingNames.push(`parent "${String(payload.parentName)}"`);
  }
  const childNames = Array.isArray(payload.childNames)
    ? payload.childNames.map((entry) => normalizeString(entry)).filter((entry): entry is string => Boolean(entry))
    : [];
  if (childNames.length > 0) {
    const missingChildren = childNames.filter((name) => !state.statIdByName.has(name));
    if (missingChildren.length > 0) {
      missingNames.push(`children ${missingChildren.map((name) => `"${name}"`).join(", ")}`);
    }
  }

  if (missingNames.length > 0) {
    return {
      ok: false,
      message: `Family-link dependencies are not resolved yet: ${missingNames.join("; ")}.`,
    };
  }

  return { ok: true, action: { ...action, payload } };
};

const resolveActionDependencies = async (
  db: InstantAdminLike | null,
  action: AiAdminAction,
  run: AiAdminRunSnapshot,
): Promise<{ ok: true; action: AiAdminAction } | { ok: false; message: string }> => {
  if (!isWriteActionType(action.type)) return { ok: true, action };
  if (!db) return { ok: true, action };
  if (action.type !== "create_derived_stat" && action.type !== "create_stat_family_links") {
    return { ok: true, action };
  }
  const resolverState = collectResolverState(run);
  if (action.type === "create_derived_stat") {
    return resolveDerivedActionDependencies(db, action, resolverState);
  }
  return resolveFamilyActionDependencies(db, action, resolverState);
};

const buildStepResultMeta = (action: AiAdminAction, result: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(result)) return undefined;
  const meta: Record<string, unknown> = {};
  const createdStatId = normalizeString(result.createdStatId);
  const createdStatName = normalizeString(result.createdStatName);
  if (createdStatId) meta.createdStatId = createdStatId;
  if (createdStatName) meta.createdStatName = createdStatName;
  if (action.type === "import_census_stat") {
    const variable = normalizeString(action.payload.variable);
    if (variable) meta.importVariable = variable;
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
};

const runGuardrailsSummary = {
  createOnly: true,
  allowlistedActionsOnly: true,
  payloadMutationIntentBlocked: true,
};

const restoreRunFromSnapshotIfPossible = (
  rawSnapshot: unknown,
  expectedRunId: string,
  callerEmail: string | null,
): AiAdminRunSnapshot | null => {
  if (!isRecord(rawSnapshot)) return null;
  const runId = normalizeString(rawSnapshot.runId);
  if (!runId || runId !== expectedRunId) return null;
  if (!Array.isArray(rawSnapshot.actions) || !Array.isArray(rawSnapshot.steps)) return null;
  if (!isRecord(rawSnapshot.caps)) return null;

  // Re-validate actions/caps to avoid restoring mutated unsupported commands.
  const validation = validateAiAdminPlanRequest({
    callerEmail: normalizeString(rawSnapshot.callerEmail) ?? callerEmail,
    dryRun: false,
    validateOnly: false,
    caps: rawSnapshot.caps,
    actions: rawSnapshot.actions,
  });
  if (!validation.ok) return null;

  return restoreAiAdminRunFromSnapshot(rawSnapshot as unknown as AiAdminRunSnapshot);
};

const handleTransitionError = (res: AiAdminExecuteResponse, error: { code: string; message: string; run?: unknown }) => {
  if (error.code === "run_not_found") {
    respond(res, 404, { ok: false, error: error.message });
    return;
  }
  respond(res, 409, { ok: false, error: error.message, run: error.run });
};

export const createAiAdminExecutePlanHandler = (deps: HandlerDeps = {}) => {
  const executeWriteAction = deps.executeWriteAction ?? executeAiAdminWriteAction;
  const detectPreflightConflicts = deps.detectPreflightConflicts ?? findExistingStatConflicts;
  const createDb = deps.createDb ?? createAiAdminDb;
  const now = deps.now ?? (() => Date.now());

  return async function handler(req: AiAdminExecuteRequest, res: AiAdminExecuteResponse) {
    if (req.method !== "POST") {
      respond(res, 405, { error: "Method not allowed" });
      return;
    }

    let rawBody: Record<string, unknown>;
    try {
      rawBody = await parseBody(req);
    } catch {
      respond(res, 400, { error: "Invalid JSON body." });
      return;
    }

    const callerEmail = normalizeString(rawBody.callerEmail);
    const auth = authorizeRequest(req, callerEmail);
    if (!auth.ok) {
      respond(res, 403, { error: "Forbidden", reason: auth.reason });
      return;
    }

    const command = readCommand(rawBody.command);

    if (command === "get_run") {
      const runId = normalizeString(rawBody.runId);
      if (!runId) {
        respond(res, 400, { error: "Missing required runId." });
        return;
      }
      const run =
        getAiAdminRun(runId) ??
        restoreRunFromSnapshotIfPossible(rawBody.runSnapshot, runId, callerEmail);
      if (!run) {
        respond(res, 404, { error: "Run not found." });
        return;
      }
      respond(res, 200, {
        ok: true,
        mode: "run_status",
        run,
        guardrails: runGuardrailsSummary,
      });
      return;
    }

    if (command === "approve_run") {
      const runId = normalizeString(rawBody.runId);
      if (!runId) {
        respond(res, 400, { error: "Missing required runId." });
        return;
      }
      if (!getAiAdminRun(runId)) {
        restoreRunFromSnapshotIfPossible(rawBody.runSnapshot, runId, callerEmail);
      }
      const transitioned = approveAiAdminRun(runId, callerEmail, now());
      if (!transitioned.ok) {
        handleTransitionError(res, transitioned);
        return;
      }
      respond(res, 200, {
        ok: true,
        mode: "approve_run",
        run: transitioned.run,
        guardrails: runGuardrailsSummary,
      });
      return;
    }

    if (command === "pause_run") {
      const runId = normalizeString(rawBody.runId);
      if (!runId) {
        respond(res, 400, { error: "Missing required runId." });
        return;
      }
      if (!getAiAdminRun(runId)) {
        restoreRunFromSnapshotIfPossible(rawBody.runSnapshot, runId, callerEmail);
      }
      const reason = normalizeString(rawBody.reason) ?? "Paused by user.";
      const transitioned = pauseAiAdminRun(runId, reason, now());
      if (!transitioned.ok) {
        handleTransitionError(res, transitioned);
        return;
      }
      respond(res, 200, {
        ok: true,
        mode: "pause_run",
        run: transitioned.run,
        guardrails: runGuardrailsSummary,
      });
      return;
    }

    if (command === "resume_run") {
      const runId = normalizeString(rawBody.runId);
      if (!runId) {
        respond(res, 400, { error: "Missing required runId." });
        return;
      }
      if (!getAiAdminRun(runId)) {
        restoreRunFromSnapshotIfPossible(rawBody.runSnapshot, runId, callerEmail);
      }
      const transitioned = resumeAiAdminRun(runId, now());
      if (!transitioned.ok) {
        handleTransitionError(res, transitioned);
        return;
      }
      respond(res, 200, {
        ok: true,
        mode: "resume_run",
        run: transitioned.run,
        guardrails: runGuardrailsSummary,
      });
      return;
    }

    if (command === "stop_run") {
      const runId = normalizeString(rawBody.runId);
      if (!runId) {
        respond(res, 400, { error: "Missing required runId." });
        return;
      }
      if (!getAiAdminRun(runId)) {
        restoreRunFromSnapshotIfPossible(rawBody.runSnapshot, runId, callerEmail);
      }
      const reason = normalizeString(rawBody.reason) ?? "Stopped by user.";
      const transitioned = stopAiAdminRun(runId, reason, now());
      if (!transitioned.ok) {
        handleTransitionError(res, transitioned);
        return;
      }
      respond(res, 200, {
        ok: true,
        mode: "stop_run",
        run: transitioned.run,
        guardrails: runGuardrailsSummary,
      });
      return;
    }

    if (command === "run_next_step") {
      const runId = normalizeString(rawBody.runId);
      if (!runId) {
        respond(res, 400, { error: "Missing required runId." });
        return;
      }
      if (!getAiAdminRun(runId)) {
        restoreRunFromSnapshotIfPossible(rawBody.runSnapshot, runId, callerEmail);
      }

      const startResult = startNextAiAdminRunStep(runId, now());
      if (!startResult.ok) {
        const statusCode =
          startResult.code === "run_not_found"
            ? 404
            : startResult.code === "no_pending_steps"
            ? 200
            : 409;
        respond(res, statusCode, {
          ok: startResult.code === "no_pending_steps",
          mode: "run_next_step",
          error: startResult.message,
          run: startResult.run,
          guardrails: runGuardrailsSummary,
        });
        return;
      }

      const action = startResult.action;
      const stepIndex = startResult.stepIndex;
      const runSnapshot = startResult.run;

      let db: InstantAdminLike | null = null;
      let actionForExecution = action;
      if (isWriteActionType(action.type)) {
        try {
          db = createDb();
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to initialize admin client.";
          const failed = failAiAdminRunStep(runId, stepIndex, message, now());
          respond(res, 500, {
            ok: false,
            mode: "run_next_step",
            error: "Server configuration error.",
            message,
            run: failed.ok ? failed.run : runSnapshot,
            guardrails: runGuardrailsSummary,
          });
          return;
        }

        const resolved = await resolveActionDependencies(db, action, runSnapshot);
        if (!resolved.ok) {
          const paused = pauseAiAdminRun(runId, `Execution paused: ${resolved.message}`, now());
          respond(res, 409, {
            ok: false,
            mode: "run_next_step",
            error: "Execution paused: unresolved step dependencies.",
            message: resolved.message,
            paused: true,
            requiresUserReview: true,
            run: paused.ok ? paused.run : runSnapshot,
            guardrails: runGuardrailsSummary,
          });
          return;
        }
        actionForExecution = resolved.action;

        const conflicts = await detectPreflightConflicts(db, [actionForExecution]);
        if (conflicts.length > 0) {
          const paused = pauseAiAdminRun(
            runId,
            "Execution paused: existing stat conflicts must be reviewed before writes.",
            now(),
          );
          respond(res, 409, {
            ok: false,
            mode: "run_next_step",
            error: "Execution paused: existing stat conflicts must be reviewed before writes.",
            paused: true,
            requiresUserReview: true,
            conflicts,
            run: paused.ok ? paused.run : runSnapshot,
            guardrails: runGuardrailsSummary,
          });
          return;
        }
      }

      let result: unknown;
      try {
        if (isWriteActionType(action.type)) {
          result = await executeWriteAction(db as InstantAdminLike, actionForExecution, {
            runId,
            caps: runSnapshot.caps,
            callerEmail: runSnapshot.callerEmail,
          });
        } else {
          result = {
            actionId: action.id,
            actionType: action.type,
            status: "accepted_not_executed",
            message: "Read-only action accepted. Research execution wiring is planned in a later slice.",
            runId,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Action execution failed.";
        const failed = failAiAdminRunStep(runId, stepIndex, message, now());
        respond(res, 500, {
          ok: false,
          mode: "run_next_step",
          error: "Step execution failed.",
          message,
          run: failed.ok ? failed.run : runSnapshot,
          guardrails: runGuardrailsSummary,
        });
        return;
      }

      const completed = completeAiAdminRunStep(
        runId,
        stepIndex,
        summarizeUnknown(result),
        now(),
        buildStepResultMeta(actionForExecution, result),
      );
      if (!completed.ok) {
        handleTransitionError(res, completed);
        return;
      }

      respond(res, 202, {
        ok: true,
        mode: "run_next_step",
        run: completed.run,
        stepResult: result,
        guardrails: runGuardrailsSummary,
      });
      return;
    }

    const validation = validateAiAdminPlanRequest(rawBody);
    if (!validation.ok) {
      respond(res, 400, { error: "Invalid plan.", details: validation.errors });
      return;
    }

    const plan = validation.plan;
    const actionSummary = plan.actions.map((action) => ({
      id: action.id,
      type: action.type,
      writeAction: isWriteActionType(action.type),
    }));

    if (plan.validateOnly) {
      respond(res, 200, {
        ok: true,
        mode: "validate_only",
        caps: plan.caps,
        estimate: plan.estimate,
        actions: actionSummary,
      });
      return;
    }

    if (plan.dryRun) {
      respond(res, 200, {
        ok: true,
        mode: "dry_run",
        caps: plan.caps,
        estimate: plan.estimate,
        actions: actionSummary,
      });
      return;
    }

    let db: InstantAdminLike;
    try {
      db = createDb();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to initialize admin client.";
      respond(res, 500, { error: "Server configuration error.", message });
      return;
    }

    const preflightConflicts = await detectPreflightConflicts(db, plan.actions);
    if (preflightConflicts.length > 0) {
      respond(res, 409, {
        ok: false,
        error: "Execution paused: existing stat conflicts must be reviewed before writes.",
        paused: true,
        requiresUserReview: true,
        conflicts: preflightConflicts,
      });
      return;
    }

    if (command === "create_run") {
      const runId = createRunId(now());
      const run = createAiAdminRun({
        runId,
        callerEmail: plan.callerEmail,
        caps: plan.caps,
        estimate: plan.estimate,
        actions: plan.actions,
        createdAt: now(),
      });
      respond(res, 202, {
        ok: true,
        mode: "create_run",
        run,
        actions: actionSummary,
        guardrails: runGuardrailsSummary,
      });
      return;
    }

    const runId = createRunId(now());
    const stepResults: unknown[] = [];
    const stepResultMetas: Array<Record<string, unknown> | undefined> = [];
    for (let i = 0; i < plan.actions.length; i += 1) {
      const action = plan.actions[i];
      if (!isWriteActionType(action.type)) {
        stepResults.push({
          actionId: action.id,
          actionType: action.type,
          status: "accepted_not_executed",
          message: "Read-only action accepted. Research execution wiring is planned in a later slice.",
        });
        continue;
      }
      const resolved = await resolveActionDependencies(db, action, {
        runId,
        status: "running",
        callerEmail: plan.callerEmail,
        caps: plan.caps,
        estimate: plan.estimate,
        actions: plan.actions,
        steps: plan.actions.map((plannedAction, index) => ({
          index,
          actionId: plannedAction.id,
          actionType: plannedAction.type,
          status:
            index < i && stepResultMetas[index] !== undefined
              ? "completed"
              : index === i
              ? "running"
              : "pending",
          payloadSummary: "",
          startedAt: null,
          finishedAt: null,
          resultSummary: null,
          resultMeta: index < i ? (stepResultMetas[index] ?? null) : null,
          error: null,
        })),
        nextActionIndex: i,
        createdAt: now(),
        updatedAt: now(),
        approvedAt: null,
        approvedBy: null,
        pausedAt: null,
        pausedReason: null,
        stoppedAt: null,
        stopReason: null,
        completedAt: null,
        failedAt: null,
        lastError: null,
        events: [],
      });
      if (!resolved.ok) {
        respond(res, 409, {
          ok: false,
          mode: "execute",
          error: "Execution paused: unresolved step dependencies.",
          message: resolved.message,
          guardrails: runGuardrailsSummary,
        });
        return;
      }
      const actionForExecution = resolved.action;
      stepResults.push(
        await executeWriteAction(db, actionForExecution, { runId, caps: plan.caps, callerEmail: plan.callerEmail }),
      );
      stepResultMetas[i] = buildStepResultMeta(actionForExecution, stepResults[stepResults.length - 1]);
    }

    respond(res, 202, {
      ok: true,
      mode: "execute",
      runId,
      caps: plan.caps,
      estimate: plan.estimate,
      stepResults,
      guardrails: runGuardrailsSummary,
    });
  };
};

const handler = createAiAdminExecutePlanHandler();

export default handler;
