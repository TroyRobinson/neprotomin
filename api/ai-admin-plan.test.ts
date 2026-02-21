import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAiAdminPlanHandler } from "./ai-admin-plan";

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

describe("ai-admin-plan", () => {
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

  it("rejects non-POST requests", async () => {
    const handler = createAiAdminPlanHandler();
    const { res, state } = createMockResponse();

    await handler(createMockRequest({ method: "GET" }) as any, res as any);

    expect(state.statusCode).toBe(405);
  });

  it("requires API key auth when configured", async () => {
    const handler = createAiAdminPlanHandler();
    const { res, state } = createMockResponse();

    await handler(
      createMockRequest({ body: { prompt: "import population" }, headers: {} }) as any,
      res as any,
    );

    expect(state.statusCode).toBe(403);
    expect((state.payload as { reason?: string }).reason).toBe("invalid_api_key");
  });

  it("returns a read-only plan with executable draft actions", async () => {
    const handler = createAiAdminPlanHandler({
      planFromModel: async () => ({
        confidence: 0.82,
        notes: "Use a single import and one derived stat.",
        imports: [
          {
            dataset: "acs/acs5",
            year: 2023,
            group: "B01001",
            variables: ["B01001_001E"],
            reason: "Import total population",
          },
        ],
        derived: [
          {
            name: "Male share",
            formula: "percent",
            numeratorVariable: "B01001_002E",
            denominatorVariable: "B01001_001E",
            sumOperandVariables: [],
            reason: "Compute male share",
          },
        ],
        families: [],
      }),
      searchGroups: async () => [
        { name: "B01001", description: "Sex by age", score: 95 },
      ],
      inspectImportCandidate: async (candidate) => ({
        status: "ok",
        dataset: candidate.dataset,
        year: candidate.year,
        group: candidate.group,
        concept: "Sex by age",
        universe: "Total population",
        tableUrl: "https://api.census.gov/data/2023/acs/acs5/groups/B01001.html",
        reason: candidate.reason,
        variables: [
          {
            variable: "B01001_001E",
            label: "Estimate!!Total:",
            statName: "Population",
            inferredType: "count",
            available: true,
            zipCount: 600,
            countyCount: 77,
          },
        ],
        missingVariables: [],
      }),
      now: () => 1700000000000,
    });

    const { res, state } = createMockResponse();

    await handler(
      createMockRequest(
        withApiKeyAuth({
          prompt: "Import population and derive male share",
          callerEmail: "admin@example.com",
        }),
      ) as any,
      res as any,
    );

    expect(state.statusCode).toBe(200);
    const payload = state.payload as {
      ok: boolean;
      mode: string;
      plan: {
        executeRequestDraft: { actions: Array<{ type: string }> };
        unresolvedSteps: Array<{ type: string }>;
      };
      research: { importEvidence: unknown[] };
    };

    expect(payload.ok).toBe(true);
    expect(payload.mode).toBe("plan");
    expect(payload.plan.executeRequestDraft.actions.map((action) => action.type)).toEqual([
      "research_census",
      "import_census_stat",
    ]);
    expect(payload.plan.unresolvedSteps.map((step) => step.type)).toContain("create_derived_stat");
    expect(payload.research.importEvidence.length).toBe(1);
  });
});
