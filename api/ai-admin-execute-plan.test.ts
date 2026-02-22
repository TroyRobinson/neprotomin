import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAiAdminExecutePlanHandler } from "./ai-admin-execute-plan";
import { resetAiAdminRunStoreForTests } from "./_shared/aiAdminRunStore";

type MockReqInit = {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
};

type MockResState = {
  statusCode: number;
  payload: unknown;
  headers: Record<string, string>;
};

const createMockRequest = (init: MockReqInit) => ({
  method: init.method ?? "POST",
  body: init.body ?? {},
  headers: init.headers ?? {},
});

const createMockResponse = (): {
  res: {
    status: (code: number) => any;
    json: (payload: unknown) => void;
    setHeader: (name: string, value: string) => void;
  };
  state: MockResState;
} => {
  const state: MockResState = {
    statusCode: 200,
    payload: null,
    headers: {},
  };

  const res = {
    status: (code: number) => {
      state.statusCode = code;
      return res;
    },
    json: (payload: unknown) => {
      state.payload = payload;
    },
    setHeader: (name: string, value: string) => {
      state.headers[name] = value;
    },
  };

  return { res, state };
};

const withApiKeyAuth = (body: Record<string, unknown>) => ({
  body,
  headers: { "x-ai-admin-api-key": "test-api-key" },
});

describe("ai-admin-execute-plan guardrails", () => {
  const originalApiKey = process.env.AI_ADMIN_API_KEY;

  beforeEach(() => {
    process.env.AI_ADMIN_API_KEY = "test-api-key";
  });

  afterEach(() => {
    resetAiAdminRunStoreForTests();
    if (originalApiKey === undefined) {
      delete process.env.AI_ADMIN_API_KEY;
    } else {
      process.env.AI_ADMIN_API_KEY = originalApiKey;
    }
  });

  it("returns 4xx for non-allowlisted actions and does not execute writes", async () => {
    const writeSpy = vi.fn(async () => ({ ok: true }));
    const handler = createAiAdminExecutePlanHandler({
      executeWriteAction: writeSpy,
      createDb: () => ({ query: vi.fn(), transact: vi.fn() }) as any,
    });
    const { res, state } = createMockResponse();

    await handler(
      createMockRequest(
        withApiKeyAuth({
          callerEmail: "admin@example.com",
          actions: [{ type: "delete_stat", payload: {} }],
        }),
      ) as any,
      res as any,
    );

    expect(state.statusCode).toBe(400);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("returns 4xx for payload mutation intent and does not execute writes", async () => {
    const writeSpy = vi.fn(async () => ({ ok: true }));
    const handler = createAiAdminExecutePlanHandler({
      executeWriteAction: writeSpy,
      createDb: () => ({ query: vi.fn(), transact: vi.fn() }) as any,
    });
    const { res, state } = createMockResponse();

    await handler(
      createMockRequest(
        withApiKeyAuth({
          callerEmail: "admin@example.com",
          actions: [
            {
              type: "import_census_stat",
              payload: {
                dataset: "acs/acs5",
                group: "B01001",
                variable: "B01001_001E",
                deleteExisting: true,
              },
            },
          ],
        }),
      ) as any,
      res as any,
    );

    expect(state.statusCode).toBe(400);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("returns 4xx when caps are exceeded and does not execute writes", async () => {
    const writeSpy = vi.fn(async () => ({ ok: true }));
    const handler = createAiAdminExecutePlanHandler({
      executeWriteAction: writeSpy,
      createDb: () => ({ query: vi.fn(), transact: vi.fn() }) as any,
    });
    const { res, state } = createMockResponse();

    await handler(
      createMockRequest(
        withApiKeyAuth({
          callerEmail: "admin@example.com",
          caps: { maxSteps: 1, maxStatsCreated: 10, maxRowsWritten: 60000 },
          actions: [
            { type: "import_census_stat", payload: { dataset: "acs/acs5" } },
            { type: "create_derived_stat", payload: { formula: "percent" } },
          ],
        }),
      ) as any,
      res as any,
    );

    expect(state.statusCode).toBe(400);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("supports dryRun without invoking write execution", async () => {
    const writeSpy = vi.fn(async () => ({ ok: true }));
    const handler = createAiAdminExecutePlanHandler({
      executeWriteAction: writeSpy,
      createDb: () => ({ query: vi.fn(), transact: vi.fn() }) as any,
    });
    const { res, state } = createMockResponse();

    await handler(
      createMockRequest(
        withApiKeyAuth({
          callerEmail: "admin@example.com",
          dryRun: true,
          actions: [
            {
              type: "import_census_stat",
              payload: { dataset: "acs/acs5", group: "B01001", variable: "B01001_001E", years: 1 },
            },
          ],
        }),
      ) as any,
      res as any,
    );

    expect(state.statusCode).toBe(200);
    expect((state.payload as { mode?: string }).mode).toBe("dry_run");
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("supports validateOnly without invoking write execution", async () => {
    const writeSpy = vi.fn(async () => ({ ok: true }));
    const handler = createAiAdminExecutePlanHandler({
      executeWriteAction: writeSpy,
      createDb: () => ({ query: vi.fn(), transact: vi.fn() }) as any,
    });
    const { res, state } = createMockResponse();

    await handler(
      createMockRequest(
        withApiKeyAuth({
          callerEmail: "admin@example.com",
          validateOnly: true,
          actions: [
            {
              type: "create_derived_stat",
              payload: { formula: "percent", expectedStatsCreated: 1, expectedRowsWritten: 1000 },
            },
          ],
        }),
      ) as any,
      res as any,
    );

    expect(state.statusCode).toBe(200);
    expect((state.payload as { mode?: string }).mode).toBe("validate_only");
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("pauses before execution when existing stat conflicts are found", async () => {
    const writeSpy = vi.fn(async () => ({ ok: true }));
    const handler = createAiAdminExecutePlanHandler({
      executeWriteAction: writeSpy,
      createDb: () => ({ query: vi.fn(), transact: vi.fn() }) as any,
      detectPreflightConflicts: vi.fn(async () => [
        {
          actionId: "step-1",
          actionType: "import_census_stat",
          reason: "existing_stat_neid",
          statId: "stat-1",
          neId: "census:B01001_001E",
          detail: "Existing stat found.",
        },
      ]),
    });
    const { res, state } = createMockResponse();

    await handler(
      createMockRequest(
        withApiKeyAuth({
          callerEmail: "admin@example.com",
          actions: [
            {
              id: "step-1",
              type: "import_census_stat",
              payload: { dataset: "acs/acs5", group: "B01001", variable: "B01001_001E" },
            },
          ],
        }),
      ) as any,
      res as any,
    );

    expect(state.statusCode).toBe(409);
    expect((state.payload as { paused?: boolean }).paused).toBe(true);
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it("executes write actions when preflight has no conflicts", async () => {
    const writeSpy = vi.fn(async (_db, action) => ({
      actionId: action.id,
      actionType: action.type,
      status: "completed",
    }));
    const handler = createAiAdminExecutePlanHandler({
      executeWriteAction: writeSpy as any,
      createDb: () => ({ query: vi.fn(), transact: vi.fn() }) as any,
      detectPreflightConflicts: vi.fn(async () => []),
      now: () => 1234567890,
    });
    const { res, state } = createMockResponse();

    await handler(
      createMockRequest(
        withApiKeyAuth({
          callerEmail: "admin@example.com",
          actions: [
            {
              id: "step-1",
              type: "create_stat_family_links",
              payload: {
                parentStatId: "p1",
                childStatIds: ["c1"],
                statAttribute: "Total",
              },
            },
          ],
        }),
      ) as any,
      res as any,
    );

    expect(state.statusCode).toBe(202);
    expect((state.payload as { runId?: string }).runId).toBe("ai-run-1234567890");
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it("creates an awaiting-approval run and executes one step at a time after approval", async () => {
    const writeSpy = vi.fn(async (_db, action) => ({
      actionId: action.id,
      actionType: action.type,
      status: "completed",
      createdStatId: "stat-1",
    }));
    const handler = createAiAdminExecutePlanHandler({
      executeWriteAction: writeSpy as any,
      createDb: () => ({ query: vi.fn(), transact: vi.fn() }) as any,
      detectPreflightConflicts: vi.fn(async () => []),
      now: () => 22334455,
    });

    const { res: createRes, state: createState } = createMockResponse();
    await handler(
      createMockRequest(
        withApiKeyAuth({
          command: "create_run",
          callerEmail: "admin@example.com",
          actions: [
            {
              id: "step-1",
              type: "create_stat_family_links",
              payload: { parentStatId: "p1", childStatIds: ["c1"] },
            },
            {
              id: "step-2",
              type: "research_census",
              payload: { query: "income" },
            },
          ],
        }),
      ) as any,
      createRes as any,
    );

    expect(createState.statusCode).toBe(202);
    const runId = (createState.payload as { run?: { runId?: string } }).run?.runId;
    expect(runId).toBe("ai-run-22334455");
    expect((createState.payload as { run?: { status?: string } }).run?.status).toBe("awaiting_approval");

    const { res: approveRes, state: approveState } = createMockResponse();
    await handler(
      createMockRequest(
        withApiKeyAuth({
          command: "approve_run",
          callerEmail: "admin@example.com",
          runId,
        }),
      ) as any,
      approveRes as any,
    );
    expect(approveState.statusCode).toBe(200);
    expect((approveState.payload as { run?: { status?: string } }).run?.status).toBe("approved");

    const { res: next1Res, state: next1State } = createMockResponse();
    await handler(
      createMockRequest(
        withApiKeyAuth({
          command: "run_next_step",
          callerEmail: "admin@example.com",
          runId,
        }),
      ) as any,
      next1Res as any,
    );
    expect(next1State.statusCode).toBe(202);
    expect((next1State.payload as { run?: { nextActionIndex?: number } }).run?.nextActionIndex).toBe(1);
    expect(writeSpy).toHaveBeenCalledTimes(1);

    const { res: next2Res, state: next2State } = createMockResponse();
    await handler(
      createMockRequest(
        withApiKeyAuth({
          command: "run_next_step",
          callerEmail: "admin@example.com",
          runId,
        }),
      ) as any,
      next2Res as any,
    );
    expect(next2State.statusCode).toBe(202);
    expect((next2State.payload as { run?: { status?: string } }).run?.status).toBe("completed");
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it("supports pause and resume while a run is in progress", async () => {
    const writeSpy = vi.fn(async (_db, action) => ({
      actionId: action.id,
      actionType: action.type,
      status: "completed",
    }));
    const handler = createAiAdminExecutePlanHandler({
      executeWriteAction: writeSpy as any,
      createDb: () => ({ query: vi.fn(), transact: vi.fn() }) as any,
      detectPreflightConflicts: vi.fn(async () => []),
      now: () => 99887766,
    });

    const { res: createRes, state: createState } = createMockResponse();
    await handler(
      createMockRequest(
        withApiKeyAuth({
          command: "create_run",
          callerEmail: "admin@example.com",
          actions: [
            { id: "step-1", type: "create_stat_family_links", payload: { parentStatId: "p1", childStatIds: ["c1"] } },
            { id: "step-2", type: "create_stat_family_links", payload: { parentStatId: "p1", childStatIds: ["c2"] } },
          ],
        }),
      ) as any,
      createRes as any,
    );
    const runId = (createState.payload as { run?: { runId?: string } }).run?.runId;

    const { res: approveRes } = createMockResponse();
    await handler(
      createMockRequest(withApiKeyAuth({ command: "approve_run", callerEmail: "admin@example.com", runId })) as any,
      approveRes as any,
    );

    const { res: pauseRes, state: pauseState } = createMockResponse();
    await handler(
      createMockRequest(withApiKeyAuth({ command: "pause_run", callerEmail: "admin@example.com", runId })) as any,
      pauseRes as any,
    );
    expect(pauseState.statusCode).toBe(200);
    expect((pauseState.payload as { run?: { status?: string } }).run?.status).toBe("paused");

    const { res: blockedNextRes, state: blockedNextState } = createMockResponse();
    await handler(
      createMockRequest(withApiKeyAuth({ command: "run_next_step", callerEmail: "admin@example.com", runId })) as any,
      blockedNextRes as any,
    );
    expect(blockedNextState.statusCode).toBe(409);
    expect(writeSpy).toHaveBeenCalledTimes(0);

    const { res: resumeRes, state: resumeState } = createMockResponse();
    await handler(
      createMockRequest(withApiKeyAuth({ command: "resume_run", callerEmail: "admin@example.com", runId })) as any,
      resumeRes as any,
    );
    expect(resumeState.statusCode).toBe(200);
    expect((resumeState.payload as { run?: { status?: string } }).run?.status).toBe("running");

    const { res: nextRes, state: nextState } = createMockResponse();
    await handler(
      createMockRequest(withApiKeyAuth({ command: "run_next_step", callerEmail: "admin@example.com", runId })) as any,
      nextRes as any,
    );
    expect(nextState.statusCode).toBe(202);
    expect(writeSpy).toHaveBeenCalledTimes(1);
  });

  it("rehydrates run state from runSnapshot when in-memory store is missing the run", async () => {
    const writeSpy = vi.fn(async (_db, action) => ({
      actionId: action.id,
      actionType: action.type,
      status: "completed",
    }));
    const handler = createAiAdminExecutePlanHandler({
      executeWriteAction: writeSpy as any,
      createDb: () => ({ query: vi.fn(), transact: vi.fn() }) as any,
      detectPreflightConflicts: vi.fn(async () => []),
      now: () => 55667788,
    });

    const { res: createRes, state: createState } = createMockResponse();
    await handler(
      createMockRequest(
        withApiKeyAuth({
          command: "create_run",
          callerEmail: "admin@example.com",
          actions: [{ id: "step-1", type: "create_stat_family_links", payload: { parentStatId: "p1", childStatIds: ["c1"] } }],
        }),
      ) as any,
      createRes as any,
    );

    expect(createState.statusCode).toBe(202);
    const createdRun = (createState.payload as { run?: any }).run;
    const runId = createdRun?.runId as string;
    expect(runId).toBe("ai-run-55667788");

    // Simulate a different serverless instance/process with empty in-memory store.
    resetAiAdminRunStoreForTests();

    const { res: approveRes, state: approveState } = createMockResponse();
    await handler(
      createMockRequest(
        withApiKeyAuth({
          command: "approve_run",
          callerEmail: "admin@example.com",
          runId,
          runSnapshot: createdRun,
        }),
      ) as any,
      approveRes as any,
    );

    expect(approveState.statusCode).toBe(200);
    expect((approveState.payload as { run?: { status?: string } }).run?.status).toBe("approved");
  });

  it("resolves derived and family dependencies from prior step results during a run", async () => {
    const querySpy = vi.fn(async (query: any) => {
      const nameFilter = query?.stats?.$?.where?.name?.$in;
      if (Array.isArray(nameFilter) && nameFilter.includes("Business")) {
        return { stats: [{ id: "stat-parent", name: "Business", neId: null }] };
      }
      return { stats: [] };
    });

    const callPayloads: Array<{ id: string; type: string; payload: Record<string, unknown> }> = [];
    const writeSpy = vi.fn(async (_db, action) => {
      callPayloads.push({ id: action.id, type: action.type, payload: { ...action.payload } });
      if (action.type === "import_census_stat") {
        return {
          actionId: action.id,
          actionType: action.type,
          status: "completed",
          createdStatId: "stat-import-retail",
          createdStatName: "Retail trade",
        };
      }
      if (action.type === "create_derived_stat") {
        return {
          actionId: action.id,
          actionType: action.type,
          status: "completed",
          createdStatId: "stat-derived-total",
          createdStatName: "Total Self Employed Businesses",
        };
      }
      if (action.type === "create_stat_family_links") {
        return {
          actionId: action.id,
          actionType: action.type,
          status: "completed",
          createdRelations: 1,
        };
      }
      return { actionId: action.id, actionType: action.type, status: "completed" };
    });

    const handler = createAiAdminExecutePlanHandler({
      executeWriteAction: writeSpy as any,
      createDb: () => ({ query: querySpy, transact: vi.fn() }) as any,
      detectPreflightConflicts: vi.fn(async () => []),
      now: (() => {
        let t = 70000000;
        return () => ++t;
      })(),
    });

    const actions = [
      {
        id: "step-import-1",
        type: "import_census_stat",
        payload: { dataset: "acs/acs5", group: "C24070", variable: "C24070_034E" },
      },
      {
        id: "step-derived-1",
        type: "create_derived_stat",
        payload: {
          name: "Total Self Employed Businesses",
          formula: "sum",
          sumOperandVariables: ["C24070_034E"],
          sumOperandImportStepIds: ["step-import-1"],
        },
      },
      {
        id: "step-family-1",
        type: "create_stat_family_links",
        payload: {
          parentName: "Business",
          childNames: ["Total Self Employed Businesses"],
          statAttribute: "Total",
        },
      },
    ];

    const { res: createRes, state: createState } = createMockResponse();
    await handler(
      createMockRequest(withApiKeyAuth({ command: "create_run", callerEmail: "admin@example.com", actions })) as any,
      createRes as any,
    );
    expect(createState.statusCode).toBe(202);
    const runId = (createState.payload as { run?: { runId?: string } }).run?.runId;
    expect(runId).toBeTruthy();

    const { res: approveRes } = createMockResponse();
    await handler(
      createMockRequest(withApiKeyAuth({ command: "approve_run", callerEmail: "admin@example.com", runId })) as any,
      approveRes as any,
    );

    for (let i = 0; i < actions.length; i += 1) {
      const { res: nextRes, state: nextState } = createMockResponse();
      await handler(
        createMockRequest(withApiKeyAuth({ command: "run_next_step", callerEmail: "admin@example.com", runId })) as any,
        nextRes as any,
      );
      expect(nextState.statusCode).toBe(202);
    }

    expect(writeSpy).toHaveBeenCalledTimes(3);
    const derivedCall = callPayloads.find((entry) => entry.type === "create_derived_stat");
    expect(Array.isArray(derivedCall?.payload.sumOperandIds)).toBe(true);
    expect((derivedCall?.payload.sumOperandIds as string[])[0]).toBe("stat-import-retail");

    const familyCall = callPayloads.find((entry) => entry.type === "create_stat_family_links");
    expect(familyCall?.payload.parentStatId).toBe("stat-parent");
    expect((familyCall?.payload.childStatIds as string[])[0]).toBe("stat-derived-total");
    expect(querySpy).toHaveBeenCalled();
  });
});
