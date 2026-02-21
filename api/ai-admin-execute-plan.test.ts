import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAiAdminExecutePlanHandler } from "./ai-admin-execute-plan";

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
});
