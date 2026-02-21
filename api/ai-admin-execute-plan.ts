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
  resumeAiAdminRun,
  startNextAiAdminRunStep,
  stopAiAdminRun,
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

const runGuardrailsSummary = {
  createOnly: true,
  allowlistedActionsOnly: true,
  payloadMutationIntentBlocked: true,
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
      const run = getAiAdminRun(runId);
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

        const conflicts = await detectPreflightConflicts(db, [action]);
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
          result = await executeWriteAction(db as InstantAdminLike, action, {
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

      const completed = completeAiAdminRunStep(runId, stepIndex, summarizeUnknown(result), now());
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
    for (const action of plan.actions) {
      if (!isWriteActionType(action.type)) {
        stepResults.push({
          actionId: action.id,
          actionType: action.type,
          status: "accepted_not_executed",
          message: "Read-only action accepted. Research execution wiring is planned in a later slice.",
        });
        continue;
      }
      stepResults.push(
        await executeWriteAction(db, action, { runId, caps: plan.caps, callerEmail: plan.callerEmail }),
      );
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
