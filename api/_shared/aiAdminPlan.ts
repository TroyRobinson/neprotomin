export const AI_ADMIN_ALLOWED_ACTION_TYPES = [
  "research_census",
  "import_census_stat",
  "create_derived_stat",
  "create_stat_family_links",
] as const;

export type AiAdminAllowedActionType = (typeof AI_ADMIN_ALLOWED_ACTION_TYPES)[number];

export type AiAdminRunCaps = {
  maxSteps: number;
  maxStatsCreated: number;
  maxRowsWritten: number;
};

export type AiAdminAction = {
  id: string;
  type: AiAdminAllowedActionType;
  payload: Record<string, unknown>;
};

export type AiAdminPlanEstimate = {
  actionCount: number;
  writeActionCount: number;
  estimatedStatsCreated: number;
  estimatedRowsWritten: number;
};

export type AiAdminPlan = {
  callerEmail: string | null;
  dryRun: boolean;
  validateOnly: boolean;
  caps: AiAdminRunCaps;
  actions: AiAdminAction[];
  estimate: AiAdminPlanEstimate;
};

export type AiAdminValidationError = {
  code:
    | "invalid_body"
    | "invalid_caps"
    | "invalid_actions"
    | "unsupported_action_type"
    | "invalid_action_payload"
    | "blocked_mutation_intent"
    | "caps_exceeded";
  message: string;
  path?: string;
};

export type AiAdminPlanValidationResult =
  | {
      ok: true;
      plan: AiAdminPlan;
    }
  | {
      ok: false;
      errors: AiAdminValidationError[];
    };

export const AI_ADMIN_DEFAULT_CAPS: AiAdminRunCaps = {
  maxSteps: 12,
  maxStatsCreated: 8,
  maxRowsWritten: 60000,
};

export const AI_ADMIN_HARD_CAPS: AiAdminRunCaps = {
  maxSteps: 50,
  maxStatsCreated: 25,
  maxRowsWritten: 200000,
};

const WRITE_ACTION_TYPES = new Set<AiAdminAllowedActionType>([
  "import_census_stat",
  "create_derived_stat",
  "create_stat_family_links",
]);

const BLOCKED_MUTATION_TOKENS = new Set<string>([
  "delete",
  "remove",
  "update",
  "edit",
  "drop",
  "truncate",
  "destroy",
  "unlink",
  "overwrite",
  "replace",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeString = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const parseBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "1" || lowered === "true" || lowered === "yes") return true;
    if (lowered === "0" || lowered === "false" || lowered === "no") return false;
  }
  return fallback;
};

const parseIntegerLike = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
};

const clampCap = (
  raw: unknown,
  fallback: number,
  hardLimit: number,
  path: string,
  errors: AiAdminValidationError[],
): number => {
  if (raw === undefined) return fallback;
  const parsed = parseIntegerLike(raw);
  if (parsed === null || parsed < 1) {
    errors.push({
      code: "invalid_caps",
      message: "Run caps must be positive integers.",
      path,
    });
    return fallback;
  }
  if (parsed > hardLimit) {
    errors.push({
      code: "invalid_caps",
      message: `Run cap exceeds hard limit (${hardLimit}).`,
      path,
    });
    return hardLimit;
  }
  return parsed;
};

const normalizeCaps = (
  rawCaps: unknown,
  errors: AiAdminValidationError[],
): AiAdminRunCaps => {
  if (rawCaps !== undefined && !isRecord(rawCaps)) {
    errors.push({
      code: "invalid_caps",
      message: "caps must be an object.",
      path: "caps",
    });
    return { ...AI_ADMIN_DEFAULT_CAPS };
  }

  const capsObj = isRecord(rawCaps) ? rawCaps : {};
  return {
    maxSteps: clampCap(
      capsObj.maxSteps,
      AI_ADMIN_DEFAULT_CAPS.maxSteps,
      AI_ADMIN_HARD_CAPS.maxSteps,
      "caps.maxSteps",
      errors,
    ),
    maxStatsCreated: clampCap(
      capsObj.maxStatsCreated,
      AI_ADMIN_DEFAULT_CAPS.maxStatsCreated,
      AI_ADMIN_HARD_CAPS.maxStatsCreated,
      "caps.maxStatsCreated",
      errors,
    ),
    maxRowsWritten: clampCap(
      capsObj.maxRowsWritten,
      AI_ADMIN_DEFAULT_CAPS.maxRowsWritten,
      AI_ADMIN_HARD_CAPS.maxRowsWritten,
      "caps.maxRowsWritten",
      errors,
    ),
  };
};

const isAllowedActionType = (value: string): value is AiAdminAllowedActionType =>
  (AI_ADMIN_ALLOWED_ACTION_TYPES as readonly string[]).includes(value);

const splitKeyTokens = (key: string): string[] =>
  key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

const getBlockedTokenForKey = (key: string): string | null => {
  const tokens = splitKeyTokens(key);
  for (const token of tokens) {
    if (BLOCKED_MUTATION_TOKENS.has(token)) return token;
  }
  return null;
};

const findBlockedMutationIntent = (
  value: unknown,
  path: string,
): { path: string; token: string } | null => {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findBlockedMutationIntent(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }

  if (!isRecord(value)) return null;

  for (const [key, nested] of Object.entries(value)) {
    const blockedToken = getBlockedTokenForKey(key);
    if (blockedToken) {
      return { path: `${path}.${key}`, token: blockedToken };
    }
    const found = findBlockedMutationIntent(nested, `${path}.${key}`);
    if (found) return found;
  }

  return null;
};

const getPayloadNumber = (payload: Record<string, unknown>, key: string): number | null => {
  const parsed = parseIntegerLike(payload[key]);
  if (parsed === null || parsed < 0) return null;
  return parsed;
};

const estimateActionWriteImpact = (
  action: AiAdminAction,
): { statsCreated: number; rowsWritten: number } => {
  if (!isWriteActionType(action.type)) {
    return { statsCreated: 0, rowsWritten: 0 };
  }

  const payload = action.payload;
  const expectedStats = getPayloadNumber(payload, "expectedStatsCreated");
  const expectedRows = getPayloadNumber(payload, "expectedRowsWritten");
  const years = Math.max(getPayloadNumber(payload, "years") ?? 1, 1);

  if (action.type === "import_census_stat") {
    return {
      statsCreated: expectedStats ?? 1,
      rowsWritten: expectedRows ?? 12000 * years,
    };
  }

  if (action.type === "create_derived_stat") {
    return {
      statsCreated: expectedStats ?? 1,
      rowsWritten: expectedRows ?? 12000,
    };
  }

  return {
    statsCreated: expectedStats ?? 0,
    rowsWritten: expectedRows ?? 0,
  };
};

export const isWriteActionType = (type: AiAdminAllowedActionType): boolean =>
  WRITE_ACTION_TYPES.has(type);

export const validateAiAdminPlanRequest = (
  input: unknown,
): AiAdminPlanValidationResult => {
  const errors: AiAdminValidationError[] = [];

  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ code: "invalid_body", message: "Request body must be an object.", path: "body" }],
    };
  }

  const callerEmail = normalizeString(input.callerEmail);
  const dryRun = parseBoolean(input.dryRun, false);
  const validateOnly = parseBoolean(input.validateOnly, false);
  const caps = normalizeCaps(input.caps, errors);

  const rawActions = input.actions;
  if (!Array.isArray(rawActions) || rawActions.length === 0) {
    errors.push({
      code: "invalid_actions",
      message: "actions must be a non-empty array.",
      path: "actions",
    });
  }

  const actions: AiAdminAction[] = [];

  if (Array.isArray(rawActions)) {
    for (let i = 0; i < rawActions.length; i += 1) {
      const rawAction = rawActions[i];
      const basePath = `actions[${i}]`;

      if (!isRecord(rawAction)) {
        errors.push({
          code: "invalid_actions",
          message: "Each action must be an object.",
          path: basePath,
        });
        continue;
      }

      const typeRaw = normalizeString(rawAction.type);
      if (!typeRaw) {
        errors.push({
          code: "invalid_actions",
          message: "Action type is required.",
          path: `${basePath}.type`,
        });
        continue;
      }
      if (!isAllowedActionType(typeRaw)) {
        errors.push({
          code: "unsupported_action_type",
          message: `Unsupported action type: ${typeRaw}`,
          path: `${basePath}.type`,
        });
        continue;
      }

      const payloadRaw = rawAction.payload;
      if (payloadRaw !== undefined && !isRecord(payloadRaw)) {
        errors.push({
          code: "invalid_action_payload",
          message: "Action payload must be an object when provided.",
          path: `${basePath}.payload`,
        });
        continue;
      }

      const payload = isRecord(payloadRaw) ? payloadRaw : {};
      const blockedIntent = findBlockedMutationIntent(payload, `${basePath}.payload`);
      if (blockedIntent) {
        errors.push({
          code: "blocked_mutation_intent",
          message: `Blocked mutation intent token "${blockedIntent.token}" found in payload.`,
          path: blockedIntent.path,
        });
        continue;
      }

      const id = normalizeString(rawAction.id) ?? `step-${i + 1}`;
      actions.push({
        id,
        type: typeRaw,
        payload,
      });
    }
  }

  if (Array.isArray(rawActions) && rawActions.length > caps.maxSteps) {
    errors.push({
      code: "caps_exceeded",
      message: `Plan has ${rawActions.length} steps but maxSteps is ${caps.maxSteps}.`,
      path: "actions",
    });
  }

  const estimate = actions.reduce<AiAdminPlanEstimate>(
    (acc, action) => {
      const impact = estimateActionWriteImpact(action);
      return {
        actionCount: acc.actionCount + 1,
        writeActionCount: acc.writeActionCount + (isWriteActionType(action.type) ? 1 : 0),
        estimatedStatsCreated: acc.estimatedStatsCreated + impact.statsCreated,
        estimatedRowsWritten: acc.estimatedRowsWritten + impact.rowsWritten,
      };
    },
    {
      actionCount: 0,
      writeActionCount: 0,
      estimatedStatsCreated: 0,
      estimatedRowsWritten: 0,
    },
  );

  if (estimate.estimatedStatsCreated > caps.maxStatsCreated) {
    errors.push({
      code: "caps_exceeded",
      message: `Estimated stats to create (${estimate.estimatedStatsCreated}) exceed maxStatsCreated (${caps.maxStatsCreated}).`,
      path: "caps.maxStatsCreated",
    });
  }

  if (estimate.estimatedRowsWritten > caps.maxRowsWritten) {
    errors.push({
      code: "caps_exceeded",
      message: `Estimated rows to write (${estimate.estimatedRowsWritten}) exceed maxRowsWritten (${caps.maxRowsWritten}).`,
      path: "caps.maxRowsWritten",
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    plan: {
      callerEmail,
      dryRun,
      validateOnly,
      caps,
      actions,
      estimate,
    },
  };
};
