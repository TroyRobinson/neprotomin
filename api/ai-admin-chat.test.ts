import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createAiAdminChatHandler } from "./ai-admin-chat";

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

describe("ai-admin-chat", () => {
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
    const handler = createAiAdminChatHandler();
    const { res, state } = createMockResponse();

    await handler(createMockRequest({ method: "GET" }) as any, res as any);

    expect(state.statusCode).toBe(405);
  });

  it("requires API key auth when configured", async () => {
    const handler = createAiAdminChatHandler();
    const { res, state } = createMockResponse();

    await handler(
      createMockRequest({
        body: { messages: [{ role: "user", content: "hello" }] },
        headers: {},
      }) as any,
      res as any,
    );

    expect(state.statusCode).toBe(403);
    expect((state.payload as { reason?: string }).reason).toBe("invalid_api_key");
  });

  it("returns a conversational response without drafting a plan by default", async () => {
    const draftPlanSpy = vi.fn(async () => ({ statusCode: 200, payload: { plan: { steps: [] } } }));
    const modelSpy = vi.fn(async () => ({ text: "Tell me more about your goal." }));
    const handler = createAiAdminChatHandler({
      respondWithModel: modelSpy,
      draftPlan: draftPlanSpy,
      now: () => 1700000000000,
    });
    const { res, state } = createMockResponse();

    await handler(
      createMockRequest(
        withApiKeyAuth({
          callerEmail: "admin@example.com",
          messages: [{ role: "user", content: "hello there" }],
        }),
      ) as any,
      res as any,
    );

    expect(state.statusCode).toBe(200);
    const payload = state.payload as {
      mode: string;
      assistantMessage: { content: string; createdAt: number };
      planRequested: boolean;
      plan: unknown;
    };
    expect(payload.mode).toBe("chat");
    expect(payload.assistantMessage.content).toBe("Tell me more about your goal.");
    expect(payload.assistantMessage.createdAt).toBe(1700000000000);
    expect(payload.planRequested).toBe(false);
    expect(payload.plan).toBeNull();
    expect(draftPlanSpy).not.toHaveBeenCalled();
    expect(modelSpy).toHaveBeenCalledTimes(1);
  });

  it("drafts a plan when user gives explicit go-ahead", async () => {
    const draftPlanSpy = vi.fn(async () => ({
      statusCode: 200,
      payload: {
        plan: {
          notes: "Draft ready",
          steps: [{ id: "step-1", title: "Import", type: "import_census_stat" }],
        },
        research: { importEvidence: [] },
      },
    }));
    const handler = createAiAdminChatHandler({
      respondWithModel: async () => ({ text: "I can draft a plan now." }),
      draftPlan: draftPlanSpy,
    });
    const { res, state } = createMockResponse();

    await handler(
      createMockRequest(
        withApiKeyAuth({
          callerEmail: "admin@example.com",
          messages: [{ role: "user", content: "Go ahead and draft the plan." }],
        }),
      ) as any,
      res as any,
    );

    expect(state.statusCode).toBe(200);
    const payload = state.payload as {
      planRequested: boolean;
      plan: { notes?: string } | null;
    };
    expect(payload.planRequested).toBe(true);
    expect(payload.plan?.notes).toBe("Draft ready");
    expect(draftPlanSpy).toHaveBeenCalledTimes(1);
  });

  it("treats 'create our plan' phrasing as an explicit plan request", async () => {
    const draftPlanSpy = vi.fn(async ({ prompt }) => ({
      statusCode: 200,
      payload: { plan: { notes: String(prompt).includes("business count") ? "Context-aware plan." : "Plan created from phrasing match." }, research: {} },
    }));
    const handler = createAiAdminChatHandler({
      respondWithModel: async () => ({ text: "Drafting now." }),
      draftPlan: draftPlanSpy,
    });
    const { res, state } = createMockResponse();

    await handler(
      createMockRequest(
        withApiKeyAuth({
          callerEmail: "admin@example.com",
          messages: [
            { role: "user", content: "I want business count stats with size breakdown." },
            { role: "assistant", content: "Understood. Ready for plan?" },
            { role: "user", content: "yes create our plan" },
          ],
        }),
      ) as any,
      res as any,
    );

    expect(state.statusCode).toBe(200);
    expect((state.payload as { planRequested?: boolean }).planRequested).toBe(true);
    expect((state.payload as { plan?: { notes?: string } }).plan?.notes).toBe(
      "Context-aware plan.",
    );
    expect(draftPlanSpy).toHaveBeenCalledTimes(1);
    const firstCallInput = draftPlanSpy.mock.calls[0]?.[0] as { prompt?: string };
    expect(firstCallInput.prompt).toContain("business count");
    expect(firstCallInput.prompt).toContain("yes create our plan");
  });

  it("returns grounded search results when requestSearch is true", async () => {
    const searchSpy = vi.fn(async () => ({
      query: "business count by size",
      dataset: "acs/acs5",
      year: 2023,
      datasetCapability: {
        dataset: "acs/acs5",
        label: "ACS 5-Year Detailed Tables",
        searchable: true,
        importable: true,
        supportTier: "importable_now" as const,
        supportedGeographies: ["ZIP", "COUNTY"],
        notes: "Primary dataset path used by current import pipeline.",
      },
      knownDatasetCapabilities: [],
      warnings: [],
      groups: [
        {
          group: "CBP01",
          dataset: "acs/acs5",
          year: 2023,
          description: "Business establishments by size",
          relevanceScore: 82,
          relevanceReason: "Matched terms: business, size.",
          concept: "Business establishments",
          universe: "Employer businesses",
          tableUrl: "https://example.test/groups/CBP01.html",
          variables: [
            {
              variable: "CBP01_001E",
              label: "Total establishments",
              statName: "Total Business Establishments",
              inferredType: "count",
              concept: "Business establishments",
              zipCount: 1200,
              countyCount: 77,
              relevanceScore: 75,
              relevanceReason: "Matched terms: business.",
            },
          ],
        },
      ],
    }));
    const draftPlanSpy = vi.fn(async () => ({ statusCode: 200, payload: { plan: { steps: [] } } }));
    const handler = createAiAdminChatHandler({
      respondWithModel: async () => ({ text: "normal chat fallback" }),
      draftPlan: draftPlanSpy,
      searchCensus: searchSpy,
    });
    const { res, state } = createMockResponse();

    await handler(
      createMockRequest(
        withApiKeyAuth({
          callerEmail: "admin@example.com",
          requestSearch: true,
          messages: [{ role: "user", content: "business count by size" }],
        }),
      ) as any,
      res as any,
    );

    expect(state.statusCode).toBe(200);
    const payload = state.payload as {
      searchRequested: boolean;
      search: { query?: string; groups?: unknown[] } | null;
      assistantMessage?: { content?: string };
      searchReviewMessage?: { content?: string } | null;
    };
    expect(payload.searchRequested).toBe(true);
    expect(payload.search?.query).toBe("business count by size");
    expect(Array.isArray(payload.search?.groups)).toBe(true);
    expect(payload.assistantMessage?.content).toContain("Running grounded Census search");
    expect(payload.searchReviewMessage?.content).toContain("Grounded Census search results are ready");
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(draftPlanSpy).not.toHaveBeenCalled();
  });

  it("auto-triggers grounded search for stat-intent messages", async () => {
    const searchSpy = vi.fn(async () => ({
      query: "business size disaggregate",
      dataset: "acs/acs5",
      year: 2023,
      datasetCapability: {
        dataset: "acs/acs5",
        label: "ACS 5-Year Detailed Tables",
        searchable: true,
        importable: true,
        supportTier: "importable_now" as const,
        supportedGeographies: ["ZIP", "COUNTY"],
        notes: "Primary dataset path used by current import pipeline.",
      },
      knownDatasetCapabilities: [],
      warnings: [],
      groups: [],
    }));
    const modelSpy = vi.fn(async () => ({ text: "fallback chat response" }));
    const handler = createAiAdminChatHandler({
      respondWithModel: modelSpy,
      searchCensus: searchSpy,
    });
    const { res, state } = createMockResponse();

    await handler(
      createMockRequest(
        withApiKeyAuth({
          callerEmail: "admin@example.com",
          messages: [{ role: "user", content: "business size disaggregate" }],
        }),
      ) as any,
      res as any,
    );

    expect(state.statusCode).toBe(200);
    const payload = state.payload as {
      searchRequested?: boolean;
      autoSearchTriggered?: boolean;
      assistantMessage?: { content?: string };
      searchReviewMessage?: { content?: string } | null;
    };
    expect(payload.searchRequested).toBe(true);
    expect(payload.autoSearchTriggered).toBe(true);
    expect(payload.assistantMessage?.content).toContain("fallback chat response");
    expect(payload.searchReviewMessage?.content).toContain("I ran a grounded Census search");
    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(modelSpy).toHaveBeenCalledTimes(1);
  });
});
