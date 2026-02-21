import type {
  AiAdminAction,
  AiAdminPlanEstimate,
  AiAdminRunCaps,
} from "./aiAdminPlan.ts";

export type AiAdminRunStatus =
  | "draft"
  | "awaiting_approval"
  | "approved"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "stopped";

export type AiAdminStepStatus = "pending" | "running" | "completed" | "failed";

export type AiAdminRunEventType =
  | "run_created"
  | "run_awaiting_approval"
  | "run_approved"
  | "run_started"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "run_paused"
  | "run_resumed"
  | "run_completed"
  | "run_stopped";

export type AiAdminRunEvent = {
  id: string;
  runId: string;
  type: AiAdminRunEventType;
  createdAt: number;
  summary: string;
  metadata?: Record<string, unknown>;
};

export type AiAdminRunStep = {
  index: number;
  actionId: string;
  actionType: AiAdminAction["type"];
  status: AiAdminStepStatus;
  payloadSummary: string;
  startedAt: number | null;
  finishedAt: number | null;
  resultSummary: string | null;
  error: string | null;
};

type AiAdminRunInternal = {
  runId: string;
  status: AiAdminRunStatus;
  callerEmail: string | null;
  caps: AiAdminRunCaps;
  estimate: AiAdminPlanEstimate;
  actions: AiAdminAction[];
  steps: AiAdminRunStep[];
  nextActionIndex: number;
  createdAt: number;
  updatedAt: number;
  approvedAt: number | null;
  approvedBy: string | null;
  pausedAt: number | null;
  pausedReason: string | null;
  stoppedAt: number | null;
  stopReason: string | null;
  completedAt: number | null;
  failedAt: number | null;
  lastError: string | null;
  events: AiAdminRunEvent[];
};

export type AiAdminRunSnapshot = Omit<AiAdminRunInternal, "actions"> & {
  actions: AiAdminAction[];
};

type CreateRunInput = {
  runId: string;
  callerEmail: string | null;
  caps: AiAdminRunCaps;
  estimate: AiAdminPlanEstimate;
  actions: AiAdminAction[];
  createdAt: number;
};

type StepStartResult =
  | {
      ok: true;
      run: AiAdminRunSnapshot;
      action: AiAdminAction;
      stepIndex: number;
    }
  | {
      ok: false;
      code:
        | "run_not_found"
        | "run_not_executable"
        | "run_paused"
        | "run_stopped"
        | "run_completed"
        | "run_failed"
        | "no_pending_steps";
      message: string;
      run?: AiAdminRunSnapshot;
    };

type TransitionResult =
  | { ok: true; run: AiAdminRunSnapshot }
  | { ok: false; code: "run_not_found" | "invalid_transition"; message: string; run?: AiAdminRunSnapshot };

const runs = new Map<string, AiAdminRunInternal>();

const toShortString = (value: unknown): string => {
  if (value == null) return "null";
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `[${value.slice(0, 5).map(toShortString).join(",")}${value.length > 5 ? ",..." : ""}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 4);
    const compact = entries.map(([key, entry]) => `${key}:${toShortString(entry)}`).join(",");
    return `{${compact}${Object.keys(value as Record<string, unknown>).length > 4 ? ",..." : ""}}`;
  }
  return String(value);
};

const summarizePayload = (payload: Record<string, unknown>): string => {
  const keys = Object.keys(payload ?? {});
  if (keys.length === 0) return "no_payload";
  return keys
    .slice(0, 5)
    .map((key) => `${key}=${toShortString(payload[key])}`)
    .join("; ");
};

const cloneRun = (run: AiAdminRunInternal): AiAdminRunSnapshot =>
  JSON.parse(JSON.stringify(run)) as AiAdminRunSnapshot;

const createEvent = (
  run: AiAdminRunInternal,
  type: AiAdminRunEventType,
  createdAt: number,
  summary: string,
  metadata?: Record<string, unknown>,
): AiAdminRunEvent => ({
  id: `${run.runId}::${type}::${createdAt}::${run.events.length + 1}`,
  runId: run.runId,
  type,
  createdAt,
  summary,
  metadata,
});

const addEvent = (
  run: AiAdminRunInternal,
  type: AiAdminRunEventType,
  createdAt: number,
  summary: string,
  metadata?: Record<string, unknown>,
) => {
  run.events.push(createEvent(run, type, createdAt, summary, metadata));
  run.updatedAt = createdAt;
};

const getRunInternal = (runId: string): AiAdminRunInternal | null => runs.get(runId) ?? null;

export const createAiAdminRun = (input: CreateRunInput): AiAdminRunSnapshot => {
  const steps: AiAdminRunStep[] = input.actions.map((action, index) => ({
    index,
    actionId: action.id,
    actionType: action.type,
    status: "pending",
    payloadSummary: summarizePayload(action.payload ?? {}),
    startedAt: null,
    finishedAt: null,
    resultSummary: null,
    error: null,
  }));

  const run: AiAdminRunInternal = {
    runId: input.runId,
    status: "draft",
    callerEmail: input.callerEmail,
    caps: input.caps,
    estimate: input.estimate,
    actions: input.actions,
    steps,
    nextActionIndex: 0,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
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
  };

  addEvent(run, "run_created", input.createdAt, "Run created in draft state.");
  run.status = "awaiting_approval";
  addEvent(run, "run_awaiting_approval", input.createdAt, "Run is awaiting user approval.");

  runs.set(run.runId, run);
  return cloneRun(run);
};

export const getAiAdminRun = (runId: string): AiAdminRunSnapshot | null => {
  const run = getRunInternal(runId);
  return run ? cloneRun(run) : null;
};

export const approveAiAdminRun = (
  runId: string,
  approvedBy: string | null,
  now: number,
): TransitionResult => {
  const run = getRunInternal(runId);
  if (!run) return { ok: false, code: "run_not_found", message: "Run not found." };
  if (run.status !== "awaiting_approval" && run.status !== "draft") {
    return {
      ok: false,
      code: "invalid_transition",
      message: `Run cannot be approved from status "${run.status}".`,
      run: cloneRun(run),
    };
  }
  run.status = "approved";
  run.approvedAt = now;
  run.approvedBy = approvedBy;
  run.updatedAt = now;
  addEvent(run, "run_approved", now, "Run approved for execution.", {
    approvedBy: approvedBy ?? "unknown",
  });
  return { ok: true, run: cloneRun(run) };
};

export const pauseAiAdminRun = (
  runId: string,
  reason: string,
  now: number,
): TransitionResult => {
  const run = getRunInternal(runId);
  if (!run) return { ok: false, code: "run_not_found", message: "Run not found." };
  if (run.status !== "running" && run.status !== "approved") {
    return {
      ok: false,
      code: "invalid_transition",
      message: `Run cannot be paused from status "${run.status}".`,
      run: cloneRun(run),
    };
  }
  run.status = "paused";
  run.pausedAt = now;
  run.pausedReason = reason;
  run.updatedAt = now;
  addEvent(run, "run_paused", now, reason || "Run paused.");
  return { ok: true, run: cloneRun(run) };
};

export const resumeAiAdminRun = (runId: string, now: number): TransitionResult => {
  const run = getRunInternal(runId);
  if (!run) return { ok: false, code: "run_not_found", message: "Run not found." };
  if (run.status !== "paused") {
    return {
      ok: false,
      code: "invalid_transition",
      message: `Run cannot be resumed from status "${run.status}".`,
      run: cloneRun(run),
    };
  }
  run.status = "running";
  run.pausedAt = null;
  run.pausedReason = null;
  run.updatedAt = now;
  addEvent(run, "run_resumed", now, "Run resumed.");
  return { ok: true, run: cloneRun(run) };
};

export const stopAiAdminRun = (
  runId: string,
  reason: string,
  now: number,
): TransitionResult => {
  const run = getRunInternal(runId);
  if (!run) return { ok: false, code: "run_not_found", message: "Run not found." };
  if (run.status === "completed" || run.status === "failed" || run.status === "stopped") {
    return {
      ok: false,
      code: "invalid_transition",
      message: `Run cannot be stopped from status "${run.status}".`,
      run: cloneRun(run),
    };
  }
  run.status = "stopped";
  run.stoppedAt = now;
  run.stopReason = reason;
  run.updatedAt = now;
  addEvent(run, "run_stopped", now, reason || "Run stopped.");
  return { ok: true, run: cloneRun(run) };
};

export const startNextAiAdminRunStep = (runId: string, now: number): StepStartResult => {
  const run = getRunInternal(runId);
  if (!run) return { ok: false, code: "run_not_found", message: "Run not found." };
  if (run.status === "paused") return { ok: false, code: "run_paused", message: "Run is paused.", run: cloneRun(run) };
  if (run.status === "stopped") return { ok: false, code: "run_stopped", message: "Run is stopped.", run: cloneRun(run) };
  if (run.status === "completed") {
    return { ok: false, code: "run_completed", message: "Run is already completed.", run: cloneRun(run) };
  }
  if (run.status === "failed") return { ok: false, code: "run_failed", message: "Run has failed.", run: cloneRun(run) };
  if (run.status !== "approved" && run.status !== "running") {
    return {
      ok: false,
      code: "run_not_executable",
      message: `Run is not executable from status "${run.status}".`,
      run: cloneRun(run),
    };
  }
  if (run.nextActionIndex >= run.actions.length) {
    return { ok: false, code: "no_pending_steps", message: "No pending actions.", run: cloneRun(run) };
  }

  const step = run.steps[run.nextActionIndex];
  if (!step) {
    return { ok: false, code: "no_pending_steps", message: "No pending step metadata.", run: cloneRun(run) };
  }

  const wasApproved = run.status === "approved";
  run.status = "running";
  run.updatedAt = now;
  if (wasApproved) addEvent(run, "run_started", now, "Run execution started.");
  step.status = "running";
  step.startedAt = now;
  step.finishedAt = null;
  step.error = null;
  addEvent(run, "step_started", now, `Started ${step.actionType} (${step.actionId}).`, {
    stepIndex: step.index,
    actionId: step.actionId,
    actionType: step.actionType,
  });

  return {
    ok: true,
    run: cloneRun(run),
    action: run.actions[run.nextActionIndex],
    stepIndex: step.index,
  };
};

export const completeAiAdminRunStep = (
  runId: string,
  stepIndex: number,
  resultSummary: string,
  now: number,
): TransitionResult => {
  const run = getRunInternal(runId);
  if (!run) return { ok: false, code: "run_not_found", message: "Run not found." };
  const step = run.steps[stepIndex];
  if (!step || step.status !== "running") {
    return {
      ok: false,
      code: "invalid_transition",
      message: "Step is not running.",
      run: cloneRun(run),
    };
  }
  step.status = "completed";
  step.finishedAt = now;
  step.resultSummary = resultSummary;
  step.error = null;
  run.nextActionIndex = Math.max(run.nextActionIndex, stepIndex + 1);
  run.updatedAt = now;
  addEvent(run, "step_completed", now, `Completed ${step.actionType} (${step.actionId}).`, {
    stepIndex: step.index,
    actionId: step.actionId,
    actionType: step.actionType,
    resultSummary,
  });

  if (run.nextActionIndex >= run.actions.length) {
    run.status = "completed";
    run.completedAt = now;
    addEvent(run, "run_completed", now, "Run completed successfully.");
  } else if (run.status !== "paused") {
    run.status = "running";
  }
  return { ok: true, run: cloneRun(run) };
};

export const failAiAdminRunStep = (
  runId: string,
  stepIndex: number,
  errorMessage: string,
  now: number,
): TransitionResult => {
  const run = getRunInternal(runId);
  if (!run) return { ok: false, code: "run_not_found", message: "Run not found." };
  const step = run.steps[stepIndex];
  if (!step || step.status !== "running") {
    return {
      ok: false,
      code: "invalid_transition",
      message: "Step is not running.",
      run: cloneRun(run),
    };
  }
  step.status = "failed";
  step.finishedAt = now;
  step.error = errorMessage;
  step.resultSummary = null;
  run.status = "failed";
  run.failedAt = now;
  run.lastError = errorMessage;
  run.updatedAt = now;
  addEvent(run, "step_failed", now, `Failed ${step.actionType} (${step.actionId}).`, {
    stepIndex: step.index,
    actionId: step.actionId,
    actionType: step.actionType,
    error: errorMessage,
  });
  return { ok: true, run: cloneRun(run) };
};

export const listAiAdminRunEvents = (runId: string): AiAdminRunEvent[] => {
  const run = getRunInternal(runId);
  if (!run) return [];
  return run.events.map((event) => ({ ...event }));
};

export const resetAiAdminRunStoreForTests = (): void => {
  runs.clear();
};
