import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChatBubbleOvalLeftEllipsisIcon,
  ClipboardDocumentListIcon,
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  PauseIcon,
  PlayIcon,
  StopIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { getEnvString } from "../../lib/env";

type ChatRole = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  search?: GroundedSearchResult;
};

type GroundedSearchVariable = {
  variable: string;
  label: string;
  statName: string;
  inferredType: string;
  concept: string | null;
  zipCount: number;
  countyCount: number;
  relevanceScore: number;
  relevanceReason: string;
};

type GroundedSearchGroup = {
  group: string;
  dataset: string;
  supportTier?: "importable_now" | "research_only" | "out_of_scope";
  year: number;
  description: string;
  relevanceScore: number;
  relevanceReason: string;
  concept: string | null;
  universe: string | null;
  tableUrl: string;
  variables: GroundedSearchVariable[];
  error?: string;
};

type GroundedSearchResult = {
  query: string;
  queryUsed?: string;
  dataset: string;
  year: number;
  searchedDatasets?: string[];
  intent?: {
    business: boolean;
  };
  researchAlternatives?: Array<{
    dataset: string;
    group: string;
    title: string;
    variable: string;
    statName: string;
    supportTier?: "importable_now" | "research_only" | "out_of_scope";
  }>;
  datasetCapability?: {
    dataset: string;
    label: string;
    searchable: boolean;
    importable: boolean;
    supportTier: "importable_now" | "research_only" | "out_of_scope";
    supportedGeographies: string[];
    notes: string;
  } | null;
  knownDatasetCapabilities?: Array<{
    dataset: string;
    label: string;
    searchable: boolean;
    importable: boolean;
    supportTier: "importable_now" | "research_only" | "out_of_scope";
    supportedGeographies: string[];
    notes: string;
  }>;
  groups: GroundedSearchGroup[];
  warnings: string[];
};

type AiAdminAction = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
};

type AiAdminPlanDraft = {
  notes: string;
  confidence: number;
  steps: Array<{
    id: string;
    type: string;
    title: string;
    description: string;
    confidence: number;
    executableNow: boolean;
    payload: Record<string, unknown>;
    evidence?: Record<string, unknown>;
    blockers?: string[];
  }>;
  executeRequestDraft: {
    callerEmail: string | null;
    dryRun: boolean;
    validateOnly: boolean;
    caps: {
      maxSteps: number;
      maxStatsCreated: number;
      maxRowsWritten: number;
    };
    actions: AiAdminAction[];
  };
  expectedCreates?: {
    relationLinks?: number;
    stats?: Array<{ name?: string; key?: string }>;
  };
  preflightCheck?: "ok" | "unavailable";
  preflightConflicts?: Array<{
    actionId: string;
    actionType: string;
    reason: string;
    detail: string;
    statId?: string;
    statName?: string;
    neId?: string;
  }>;
  approvalBlocked?: boolean;
  approvalBlockReason?: string | null;
};

type AiAdminRun = {
  runId: string;
  status: string;
  nextActionIndex: number;
  steps: Array<{
    index: number;
    actionId: string;
    actionType: string;
    status: string;
    resultSummary: string | null;
    error: string | null;
  }>;
  events: Array<{
    id: string;
    type: string;
    createdAt: number;
    summary: string;
  }>;
};

type ApiJsonResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
};

const DEFAULT_DATASET = "acs/acs5";
const DEFAULT_YEAR = 2023;
const RUNNING_STATUSES = new Set(["approved", "running"]);
const DATASET_SCOPE_OPTIONS = [
  { value: "auto", label: "Auto (ACS + fallbacks)" },
  { value: "acs/acs5", label: "ACS Detailed (importable)" },
  { value: "acs/acs5/profile", label: "ACS Profile (importable)" },
  { value: "acs/acs5/subject", label: "ACS Subject (importable)" },
  { value: "acs/acs5/cprofile", label: "ACS Comparison (importable)" },
  { value: "cbp", label: "County Business Patterns (research)" },
  { value: "abscb", label: "Annual Business Survey (research)" },
] as const;

const makeMessageId = () => `msg-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const PLAN_INTENT_PATTERNS = [
  /\bgo ahead\b/i,
  /\bready\b.*\bplan\b/i,
  /\bdraft\b.*\bplan\b/i,
  /\bshow\b.*\bplan\b/i,
  /\bapprove\b.*\bplan\b/i,
  /\b(create|build|make|generate)\b.*\b(plan|draft)\b/i,
  /\b(plan|draft)\b.*\b(create|build|make|generate)\b/i,
];

const hasPlanIntent = (text: string): boolean => PLAN_INTENT_PATTERNS.some((pattern) => pattern.test(text));

const AUTO_SEARCH_HINT_PATTERNS = [
  /\bstat(s|istic|istics)?\b/i,
  /\bcount(s)?\b/i,
  /\bbreakdown|disaggregate|disaggregation\b/i,
  /\bimport|variable|dataset\b/i,
  /\bderive(d)?|formula\b/i,
  /\bby\s+(size|age|race|ethnicity|income|sector|industry)\b/i,
  /\bbusiness|population|household|employment|poverty|income|housing\b/i,
];

const hasAutoSearchHint = (text: string): boolean =>
  AUTO_SEARCH_HINT_PATTERNS.some((pattern) => pattern.test(text));

const getCallerEmail = (input: string | null | undefined): string | null => {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const formatTimestamp = (value: number): string => {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
};

const formatPct = (value: number): string => `${Math.round(Math.max(0, Math.min(1, value)) * 100)}%`;

const buildDerivedFormulaLabel = (payload: Record<string, unknown>): string => {
  const formula = typeof payload.formula === "string" ? payload.formula : "formula";
  const numerator = typeof payload.numeratorVariable === "string" ? payload.numeratorVariable : "A";
  const denominator = typeof payload.denominatorVariable === "string" ? payload.denominatorVariable : "B";
  const sumOperandVariables = Array.isArray(payload.sumOperandVariables)
    ? payload.sumOperandVariables.filter((entry): entry is string => typeof entry === "string")
    : [];

  switch (formula) {
    case "sum":
      return sumOperandVariables.length > 0 ? sumOperandVariables.join(" + ") : "A + B";
    case "difference":
      return `${numerator} - ${denominator}`;
    case "rate_per_1000":
      return `(${numerator} / ${denominator}) * 1000`;
    case "ratio":
      return `${numerator} / ${denominator}`;
    case "index":
      return `(${numerator} / ${denominator}) * 100`;
    case "change_over_time":
      return "(End - Start) / Start";
    case "percent":
    default:
      return `(${numerator} / ${denominator}) * 100`;
  }
};

const supportTierLabel = (tier: "importable_now" | "research_only" | "out_of_scope"): string => {
  if (tier === "importable_now") return "Importable now";
  if (tier === "research_only") return "Research-only";
  return "Out of range";
};

const buildSearchEvidenceText = (search: GroundedSearchResult): string => {
  const scopeLine = search.datasetCapability
    ? `Dataset scope: ${search.datasetCapability.dataset} (${supportTierLabel(search.datasetCapability.supportTier)}).`
    : `Dataset scope: ${search.dataset} (unregistered capability).`;

  const groupLines = search.groups.slice(0, 4).map((group) => {
    const variableList = group.variables
      .slice(0, 4)
      .map((variable) => `${variable.variable} (${variable.statName})`)
      .join(", ");
    const tier = group.supportTier ? ` [${supportTierLabel(group.supportTier)}]` : "";
    return `${group.group}${tier}: ${variableList || "no variable matches"}`;
  });

  const warningLines = (search.warnings ?? []).slice(0, 4).map((warning) => `Warning: ${warning}`);
  const alternativeLines = (search.researchAlternatives ?? [])
    .slice(0, 2)
    .map(
      (entry) =>
        `Research alternative: ${entry.title} [${entry.group}] ${entry.statName} (${entry.variable})` +
        (entry.supportTier ? ` [${supportTierLabel(entry.supportTier)}]` : ""),
    );
  return [
    `[Grounded Search Evidence]`,
    `Query: ${search.query}`,
    search.queryUsed && search.queryUsed !== search.query ? `Search terms used: ${search.queryUsed}` : null,
    Array.isArray(search.searchedDatasets) && search.searchedDatasets.length > 0
      ? `Searched datasets: ${search.searchedDatasets.join(", ")}`
      : null,
    scopeLine,
    ...groupLines,
    ...alternativeLines,
    ...warningLines,
  ]
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .join("\n");
};

const mapMessagesForApi = (messages: ChatMessage[]): Array<{ role: ChatRole; content: string }> =>
  messages.map((message) => ({
    role: message.role,
    content: message.search ? `${message.content}\n\n${buildSearchEvidenceText(message.search)}` : message.content,
  }));

type ChatArtifactsPayload = {
  latestSearchSummary?: string;
  latestPlanSummary?: string;
  latestRunSummary?: string;
};

const buildPlanSummaryText = (plan: AiAdminPlanDraft | null): string | null => {
  if (!plan) return null;
  const stepLines = plan.steps.slice(0, 8).map((step, index) => {
    const blockers = (step.blockers ?? []).slice(0, 2).join("; ");
    return `${index + 1}. ${step.title} [${step.type}] · executableNow=${step.executableNow}${
      blockers ? ` · blockers: ${blockers}` : ""
    }`;
  });
  const actionLines = plan.executeRequestDraft.actions
    .slice(0, 8)
    .map((action, index) => `${index + 1}. ${action.type} (${action.id})`);
  const conflictLines = (plan.preflightConflicts ?? [])
    .slice(0, 4)
    .map((conflict) => `${conflict.actionType}: ${conflict.detail}`);

  return [
    "[Plan Artifact]",
    `Notes: ${plan.notes}`,
    `Confidence: ${Math.round(plan.confidence * 100)}%`,
    `Approval blocked: ${plan.approvalBlocked ? "yes" : "no"}${
      plan.approvalBlockReason ? ` (${plan.approvalBlockReason})` : ""
    }`,
    stepLines.length > 0 ? "Steps:\n" + stepLines.join("\n") : null,
    actionLines.length > 0 ? "Planned actions:\n" + actionLines.join("\n") : null,
    conflictLines.length > 0 ? "Preflight conflicts:\n" + conflictLines.join("\n") : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
};

const buildRunSummaryText = (run: AiAdminRun | null): string | null => {
  if (!run) return null;
  const latestEvents = run.events.slice(-5).map((event) => `${event.type}: ${event.summary}`);
  const latestSteps = run.steps.slice(-6).map((step) => `${step.actionType} -> ${step.status}`);
  return [
    "[Run Artifact]",
    `Status: ${run.status}`,
    `Next action index: ${run.nextActionIndex}`,
    latestSteps.length > 0 ? "Recent step states:\n" + latestSteps.join("\n") : null,
    latestEvents.length > 0 ? "Recent events:\n" + latestEvents.join("\n") : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
};

const buildArtifactsForApi = (
  messages: ChatMessage[],
  plan: AiAdminPlanDraft | null,
  run: AiAdminRun | null,
): ChatArtifactsPayload => {
  const latestSearch = [...messages].reverse().find((message) => message.search)?.search ?? null;
  return {
    latestSearchSummary: latestSearch ? buildSearchEvidenceText(latestSearch) : undefined,
    latestPlanSummary: buildPlanSummaryText(plan) ?? undefined,
    latestRunSummary: buildRunSummaryText(run) ?? undefined,
  };
};

const filterNonSearchWarnings = (allWarnings: string[] | undefined, searchWarnings: string[] | undefined): string[] => {
  const normalizedSearchWarnings = new Set((searchWarnings ?? []).map((warning) => warning.trim()));
  return (allWarnings ?? []).filter((warning) => !normalizedSearchWarnings.has(warning.trim()));
};

export const AdminAiChatModal = ({ callerEmail }: { callerEmail: string | null | undefined }) => {
  const apiKey = getEnvString("VITE_AI_ADMIN_API_KEY") ?? "";
  const normalizedCallerEmail = useMemo(() => getCallerEmail(callerEmail), [callerEmail]);

  const [isOpen, setIsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [datasetScope, setDatasetScope] = useState<(typeof DATASET_SCOPE_OPTIONS)[number]["value"]>("auto");
  const [isSending, setIsSending] = useState(false);
  const [sendMode, setSendMode] = useState<"chat" | "plan" | "search" | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const [plan, setPlan] = useState<AiAdminPlanDraft | null>(null);
  const [run, setRun] = useState<AiAdminRun | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [isBusyRunControl, setIsBusyRunControl] = useState(false);
  const [isAutoRunning, setIsAutoRunning] = useState(false);

  const [localConflicts, setLocalConflicts] = useState<AiAdminPlanDraft["preflightConflicts"]>([]);

  const autoRunRef = useRef(false);
  const runRef = useRef<AiAdminRun | null>(null);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    if (!isOpen) return;
    setUnreadCount(0);
  }, [isOpen]);

  const canApprovePlan = useMemo(() => {
    if (!plan) return false;
    const conflicts = [...(plan.preflightConflicts ?? []), ...(localConflicts ?? [])];
    return !(plan.approvalBlocked || conflicts.length > 0);
  }, [localConflicts, plan]);

  const activeConflicts = useMemo(
    () => [...(plan?.preflightConflicts ?? []), ...(localConflicts ?? [])],
    [localConflicts, plan?.preflightConflicts],
  );

  const progress = useMemo(() => {
    if (!run || run.steps.length === 0) return 0;
    const completed = run.steps.filter((step) => step.status === "completed").length;
    return completed / run.steps.length;
  }, [run]);

  const runSummaryLabel = useMemo(() => {
    if (!run) return "No run";
    const completed = run.steps.filter((step) => step.status === "completed").length;
    return `${completed}/${run.steps.length} steps`;
  }, [run]);

  const hasAnyUserMessage = useMemo(
    () => messages.some((message) => message.role === "user"),
    [messages],
  );

  const executablePlanSteps = useMemo(
    () => (plan?.steps ?? []).filter((step) => step.executableNow),
    [plan?.steps],
  );

  const futureSuggestionSteps = useMemo(
    () => (plan?.steps ?? []).filter((step) => !step.executableNow),
    [plan?.steps],
  );

  const requestJson = useCallback(
    async <T,>(url: string, body: Record<string, unknown>): Promise<ApiJsonResult<T>> => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (apiKey) headers["x-ai-admin-api-key"] = apiKey;
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => null)) as T | null;
      const errorText =
        payload && typeof payload === "object" && typeof (payload as any).error === "string"
          ? (payload as any).error
          : null;
      return {
        ok: response.ok,
        status: response.status,
        data: payload,
        error: errorText,
      };
    },
    [apiKey],
  );

  const appendAssistantMessage = useCallback((content: string, search?: GroundedSearchResult) => {
    const message: ChatMessage = {
      id: makeMessageId(),
      role: "assistant",
      content,
      createdAt: Date.now(),
      search,
    };
    setMessages((prev) => [...prev, message]);
    if (!isOpen) setUnreadCount((count) => count + 1);
  }, [isOpen]);

  const runNextStep = useCallback(async (): Promise<{ done: boolean }> => {
    const current = runRef.current;
    if (!current) return { done: true };
    const response = await requestJson<{ run?: AiAdminRun; error?: string; conflicts?: unknown[] }>(
      "/api/ai-admin-execute-plan",
      {
        command: "run_next_step",
        runId: current.runId,
        callerEmail: normalizedCallerEmail,
      },
    );

    const nextRun = response.data && typeof response.data === "object" ? (response.data as any).run : null;
    if (nextRun) {
      setRun(nextRun as AiAdminRun);
      runRef.current = nextRun as AiAdminRun;
    }

    if (!response.ok) {
      const maybeConflicts = response.data && typeof response.data === "object" ? (response.data as any).conflicts : null;
      if (Array.isArray(maybeConflicts) && maybeConflicts.length > 0) {
        setLocalConflicts(maybeConflicts as AiAdminPlanDraft["preflightConflicts"]);
      }
      setRunError(response.error ?? "Run step failed.");
      return { done: true };
    }

    const status = (nextRun as AiAdminRun | null)?.status ?? "";
    if (["completed", "failed", "stopped", "paused"].includes(status)) return { done: true };
    return { done: false };
  }, [normalizedCallerEmail, requestJson]);

  // Run execution is stepped so pause/cancel can interrupt between writes.
  const startAutoRun = useCallback(async () => {
    if (!runRef.current) return;
    autoRunRef.current = true;
    setIsAutoRunning(true);
    setRunError(null);
    while (autoRunRef.current) {
      const currentRun = runRef.current;
      if (!currentRun || !RUNNING_STATUSES.has(currentRun.status)) break;
      const result = await runNextStep();
      if (result.done) break;
      await new Promise((resolve) => setTimeout(resolve, 180));
    }
    autoRunRef.current = false;
    setIsAutoRunning(false);
  }, [runNextStep]);

  const pauseAutoRun = useCallback(() => {
    autoRunRef.current = false;
    setIsAutoRunning(false);
  }, []);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || isSending) return;
    const wantsPlan = hasPlanIntent(trimmed);
    setInput("");
    setChatError(null);
    setWarnings([]);

    const nextMessages: ChatMessage[] = [
      ...messages,
      { id: makeMessageId(), role: "user", content: trimmed, createdAt: Date.now() },
    ];
    setMessages(nextMessages);

    setIsSending(true);
    setSendMode(wantsPlan ? "plan" : hasAutoSearchHint(trimmed) ? "search" : "chat");
    let response: ApiJsonResult<{
      assistantMessage?: { role?: string; content?: string };
      searchReviewMessage?: { role?: string; content?: string } | null;
      plan?: AiAdminPlanDraft | null;
      search?: GroundedSearchResult | null;
      warnings?: string[];
    }>;
    try {
      const selectedDataset = datasetScope === "auto" ? DEFAULT_DATASET : datasetScope;
      response = await requestJson("/api/ai-admin-chat", {
        callerEmail: normalizedCallerEmail,
        dataset: selectedDataset,
        year: DEFAULT_YEAR,
        requestPlan: wantsPlan,
        searchStrictDataset: datasetScope !== "auto",
        messages: mapMessagesForApi(nextMessages),
        artifacts: buildArtifactsForApi(nextMessages, plan, run),
      });
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Failed to chat with AI admin.");
      return;
    } finally {
      setIsSending(false);
      setSendMode(null);
    }

    if (!response.ok || !response.data) {
      setChatError(response.error ?? "Failed to chat with AI admin.");
      return;
    }

    const assistantContent =
      response.data.assistantMessage && typeof response.data.assistantMessage.content === "string"
        ? response.data.assistantMessage.content
        : "I can keep researching with you. Tell me what you want to refine.";
    appendAssistantMessage(assistantContent);

    if (response.data.search) {
      appendAssistantMessage("Grounded Census variable search results:", response.data.search);
    }
    if (response.data.searchReviewMessage?.content) {
      appendAssistantMessage(response.data.searchReviewMessage.content);
    }
    if (Array.isArray(response.data.warnings)) {
      const typedWarnings = response.data.warnings.filter((entry): entry is string => typeof entry === "string");
      setWarnings(filterNonSearchWarnings(typedWarnings, response.data.search?.warnings));
    }

    if (response.data.plan) {
      setPlan(response.data.plan);
      setLocalConflicts([]);
      if (wantsPlan) {
        appendAssistantMessage("Draft plan ready. Review the plan card below and approve when ready.");
      }
    }
  }, [appendAssistantMessage, datasetScope, input, isSending, messages, normalizedCallerEmail, plan, requestJson, run]);

  const sendPromptForPlan = useCallback(async () => {
    const latestUser = [...messages].reverse().find((message) => message.role === "user");
    const prompt = latestUser?.content?.trim();
    if (!prompt) {
      setChatError("Send a user message first so I have context for drafting a plan.");
      return;
    }
    setIsSending(true);
    setSendMode("plan");
    setChatError(null);
    setWarnings([]);
    let response: ApiJsonResult<{
      assistantMessage?: { content?: string };
      plan?: AiAdminPlanDraft | null;
      warnings?: string[];
    }>;
    try {
      const selectedDataset = datasetScope === "auto" ? DEFAULT_DATASET : datasetScope;
      response = await requestJson("/api/ai-admin-chat", {
        callerEmail: normalizedCallerEmail,
        dataset: selectedDataset,
        year: DEFAULT_YEAR,
        requestPlan: true,
        messages: mapMessagesForApi(messages),
        artifacts: buildArtifactsForApi(messages, plan, run),
      });
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Failed to draft plan.");
      return;
    } finally {
      setIsSending(false);
      setSendMode(null);
    }
    if (!response.ok || !response.data) {
      setChatError(response.error ?? "Failed to draft plan.");
      return;
    }
    if (response.data.assistantMessage?.content) {
      appendAssistantMessage(response.data.assistantMessage.content);
    }
    if (response.data.plan) {
      setPlan(response.data.plan);
      setLocalConflicts([]);
      appendAssistantMessage("Draft plan ready. Review the plan card below and approve when ready.");
    }
    if (Array.isArray(response.data.warnings)) {
      setWarnings(response.data.warnings.filter((entry): entry is string => typeof entry === "string"));
    }
  }, [appendAssistantMessage, datasetScope, messages, normalizedCallerEmail, plan, requestJson, run]);

  const sendPromptForSearch = useCallback(async () => {
    const latestUser = [...messages].reverse().find((message) => message.role === "user");
    const prompt = latestUser?.content?.trim();
    if (!prompt) {
      setChatError("Send a user message first so I can run a grounded Census search.");
      return;
    }

    setIsSending(true);
    setSendMode("search");
    setChatError(null);
    setWarnings([]);

    let response: ApiJsonResult<{
      assistantMessage?: { content?: string };
      searchReviewMessage?: { content?: string } | null;
      search?: GroundedSearchResult | null;
      warnings?: string[];
    }>;
    try {
      const selectedDataset = datasetScope === "auto" ? DEFAULT_DATASET : datasetScope;
      response = await requestJson("/api/ai-admin-chat", {
        callerEmail: normalizedCallerEmail,
        dataset: selectedDataset,
        year: DEFAULT_YEAR,
        requestSearch: true,
        searchStrictDataset: datasetScope !== "auto",
        messages: mapMessagesForApi(messages),
        artifacts: buildArtifactsForApi(messages, plan, run),
      });
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "Failed to run grounded search.");
      return;
    } finally {
      setIsSending(false);
      setSendMode(null);
    }

    if (!response.ok || !response.data) {
      setChatError(response.error ?? "Failed to run grounded search.");
      return;
    }

    if (response.data.assistantMessage?.content) {
      appendAssistantMessage(response.data.assistantMessage.content);
    }
    if (response.data.search) {
      appendAssistantMessage("Grounded Census variable search results:", response.data.search);
    }
    if (response.data.searchReviewMessage?.content) {
      appendAssistantMessage(response.data.searchReviewMessage.content);
    }
    if (Array.isArray(response.data.warnings)) {
      const typedWarnings = response.data.warnings.filter((entry): entry is string => typeof entry === "string");
      setWarnings(filterNonSearchWarnings(typedWarnings, response.data.search?.warnings));
    }
  }, [appendAssistantMessage, datasetScope, messages, normalizedCallerEmail, plan, requestJson, run]);

  const handleApprovePlan = useCallback(async () => {
    if (!plan || isBusyRunControl) return;
    setRunError(null);
    setIsBusyRunControl(true);
    pauseAutoRun();

    const createResponse = await requestJson<{
      run?: AiAdminRun;
      conflicts?: AiAdminPlanDraft["preflightConflicts"];
      error?: string;
    }>("/api/ai-admin-execute-plan", {
      command: "create_run",
      callerEmail: normalizedCallerEmail,
      caps: plan.executeRequestDraft.caps,
      actions: plan.executeRequestDraft.actions,
    });

    if (!createResponse.ok || !createResponse.data?.run) {
      setRunError(createResponse.error ?? "Failed to create run.");
      if (Array.isArray(createResponse.data?.conflicts) && createResponse.data?.conflicts.length > 0) {
        setLocalConflicts(createResponse.data.conflicts);
      }
      setIsBusyRunControl(false);
      return;
    }

    const createdRun = createResponse.data.run;
    const approveResponse = await requestJson<{ run?: AiAdminRun; error?: string }>(
      "/api/ai-admin-execute-plan",
      {
        command: "approve_run",
        callerEmail: normalizedCallerEmail,
        runId: createdRun.runId,
      },
    );
    setIsBusyRunControl(false);

    if (!approveResponse.ok || !approveResponse.data?.run) {
      setRun(createdRun);
      runRef.current = createdRun;
      setRunError(approveResponse.error ?? "Run was created but approval failed.");
      return;
    }

    setRun(approveResponse.data.run);
    runRef.current = approveResponse.data.run;
    appendAssistantMessage("Plan approved. Click Run to execute step-by-step.");
  }, [appendAssistantMessage, isBusyRunControl, normalizedCallerEmail, pauseAutoRun, plan, requestJson]);

  const handlePauseRun = useCallback(async () => {
    if (!run || isBusyRunControl) return;
    pauseAutoRun();
    setIsBusyRunControl(true);
    const response = await requestJson<{ run?: AiAdminRun; error?: string }>(
      "/api/ai-admin-execute-plan",
      {
        command: "pause_run",
        runId: run.runId,
        callerEmail: normalizedCallerEmail,
        reason: "Paused from chat controls.",
      },
    );
    setIsBusyRunControl(false);
    if (!response.ok || !response.data?.run) {
      setRunError(response.error ?? "Failed to pause run.");
      return;
    }
    setRun(response.data.run);
    runRef.current = response.data.run;
  }, [isBusyRunControl, normalizedCallerEmail, pauseAutoRun, requestJson, run]);

  const handleResumeRun = useCallback(async () => {
    if (!run || isBusyRunControl) return;
    setIsBusyRunControl(true);
    const response = await requestJson<{ run?: AiAdminRun; error?: string }>(
      "/api/ai-admin-execute-plan",
      {
        command: "resume_run",
        runId: run.runId,
        callerEmail: normalizedCallerEmail,
      },
    );
    setIsBusyRunControl(false);
    if (!response.ok || !response.data?.run) {
      setRunError(response.error ?? "Failed to resume run.");
      return;
    }
    setRun(response.data.run);
    runRef.current = response.data.run;
    void startAutoRun();
  }, [isBusyRunControl, normalizedCallerEmail, requestJson, run, startAutoRun]);

  const handleStopRun = useCallback(async () => {
    if (!run || isBusyRunControl) return;
    pauseAutoRun();
    setIsBusyRunControl(true);
    const response = await requestJson<{ run?: AiAdminRun; error?: string }>(
      "/api/ai-admin-execute-plan",
      {
        command: "stop_run",
        runId: run.runId,
        callerEmail: normalizedCallerEmail,
        reason: "Stopped from chat progress controls.",
      },
    );
    setIsBusyRunControl(false);
    if (!response.ok || !response.data?.run) {
      setRunError(response.error ?? "Failed to stop run.");
      return;
    }
    setRun(response.data.run);
    runRef.current = response.data.run;
  }, [isBusyRunControl, normalizedCallerEmail, pauseAutoRun, requestJson, run]);

  const handleRunClick = useCallback(async () => {
    if (!run || isBusyRunControl) return;
    setRunError(null);

    if (run.status === "paused") {
      await handleResumeRun();
      return;
    }
    if (!RUNNING_STATUSES.has(run.status)) return;
    await startAutoRun();
  }, [handleResumeRun, isBusyRunControl, run, startAutoRun]);

  useEffect(() => {
    if (!run || isAutoRunning) return;
    if (!RUNNING_STATUSES.has(run.status) && run.status !== "paused") return;
    const interval = window.setInterval(async () => {
      const response = await requestJson<{ run?: AiAdminRun }>("/api/ai-admin-execute-plan", {
        command: "get_run",
        runId: run.runId,
        callerEmail: normalizedCallerEmail,
      });
      if (response.ok && response.data?.run) {
        setRun(response.data.run);
        runRef.current = response.data.run;
      }
    }, 1800);
    return () => window.clearInterval(interval);
  }, [isAutoRunning, normalizedCallerEmail, requestJson, run]);

  const handleClearChat = useCallback(() => {
    pauseAutoRun();
    setInput("");
    setMessages([]);
    setPlan(null);
    setRun(null);
    runRef.current = null;
    setRunError(null);
    setChatError(null);
    setWarnings([]);
    setLocalConflicts([]);
    setUnreadCount(0);
  }, [pauseAutoRun]);

  const launcherLabel = run
    ? `AI Stat Agent (${run.status})`
    : "AI Stat Agent";

  return (
    <>
      {isOpen && (
        <div className="fixed bottom-20 right-3 z-[70] w-[min(94vw,30rem)] rounded-2xl border border-slate-300 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:bottom-5 sm:right-5">
          <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2 dark:border-slate-800">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">AI Stat Agent</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Chat, approve plan, then run step-by-step
              </p>
            </div>
            <div className="flex items-center gap-1">
              <label className="sr-only" htmlFor="ai-agent-dataset-scope">
                Dataset scope
              </label>
              <select
                id="ai-agent-dataset-scope"
                value={datasetScope}
                onChange={(event) =>
                  setDatasetScope(event.target.value as (typeof DATASET_SCOPE_OPTIONS)[number]["value"])}
                className="h-7 w-[11ch] max-w-[11ch] truncate overflow-hidden text-ellipsis whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 text-[11px] text-slate-600 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                title="Filter chat/search to a specific dataset"
              >
                {DATASET_SCOPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleClearChat}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <TrashIcon className="h-3.5 w-3.5" />
                <span>Clear chat</span>
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="Minimize AI chat"
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="max-h-[68vh] overflow-y-auto px-3 py-3 sm:max-h-[70vh]">
            <section className="space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Conversation
              </p>
              {messages.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                  Describe the stats you want. Use search for grounded variables, then ask for a plan when ready.
                </div>
              ) : (
                <div className="space-y-2">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`rounded-lg px-3 py-2 text-xs ${
                        message.role === "user"
                          ? "ml-8 bg-brand-500 text-white"
                          : "mr-8 border border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                      }`}
                    >
                      <div className="whitespace-pre-wrap break-words">{message.content}</div>
                      {message.search && (
                        <div className="mt-2 space-y-2 rounded-md border border-slate-200 bg-white/80 p-2 text-[11px] text-slate-700 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-200">
                          <p className="font-semibold">
                            Search query: {message.search.query}
                          </p>
                          {message.search.queryUsed && message.search.queryUsed !== message.search.query && (
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                              Search terms used: {message.search.queryUsed}
                            </p>
                          )}
                          {message.search.datasetCapability ? (
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                              Dataset scope: {message.search.datasetCapability.label} (
                              {message.search.datasetCapability.dataset}) ·{" "}
                              {supportTierLabel(message.search.datasetCapability.supportTier)}
                            </p>
                          ) : (
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                              Dataset scope for {message.search.dataset} is not registered yet.
                            </p>
                          )}
                          {Array.isArray(message.search.searchedDatasets) && message.search.searchedDatasets.length > 0 && (
                            <p className="text-[10px] text-slate-500 dark:text-slate-400">
                              Searched datasets: {message.search.searchedDatasets.join(", ")}
                            </p>
                          )}
                          {Array.isArray(message.search.researchAlternatives) &&
                            message.search.researchAlternatives.length > 0 && (
                              <div className="rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-[10px] text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200">
                                <p className="font-semibold">Research-only alternatives</p>
                                {message.search.researchAlternatives.slice(0, 2).map((entry, index) => (
                                  <p key={`${message.id}-alt-${index}`}>
                                    {entry.title} [{entry.group}] {entry.statName} ({entry.variable})
                                    {entry.supportTier ? ` · ${supportTierLabel(entry.supportTier)}` : ""}
                                  </p>
                                ))}
                              </div>
                            )}
                          {message.search.groups.length === 0 && (
                            <p className="text-slate-600 dark:text-slate-300">
                              No strong match yet. Refine your goal, then run search again.
                            </p>
                          )}
                          {message.search.warnings.length > 0 && (
                            <div className="space-y-1">
                              {message.search.warnings.slice(0, 3).map((warning, index) => (
                                <p
                                  key={`${message.id}-search-warning-${index}`}
                                  className="text-[10px] text-amber-600 dark:text-amber-300"
                                >
                                  {warning}
                                </p>
                              ))}
                            </div>
                          )}
                          {message.search.groups.map((group) => (
                            <div
                              key={`${message.id}-${group.group}`}
                              className="rounded-md border border-slate-200 bg-white px-2 py-2 dark:border-slate-700 dark:bg-slate-950"
                            >
                              <p className="font-semibold text-slate-800 dark:text-slate-100">
                                {group.group} ({group.dataset}, {group.year})
                                {group.supportTier ? ` · ${supportTierLabel(group.supportTier)}` : ""}
                              </p>
                              <p className="mt-0.5 text-slate-600 dark:text-slate-300">{group.description}</p>
                              <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                                Universe: {group.universe ?? "n/a"} · Concept: {group.concept ?? "n/a"} · Score:{" "}
                                {Math.round(group.relevanceScore)}
                              </p>
                              <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                                {group.relevanceReason}
                              </p>
                              {group.error && (
                                <p className="mt-1 text-[10px] text-rose-600 dark:text-rose-300">{group.error}</p>
                              )}
                              <div className="mt-1 space-y-1">
                                {group.variables.map((variable) => (
                                  <div key={`${group.group}-${variable.variable}`} className="rounded border border-slate-200 px-2 py-1 dark:border-slate-700">
                                    <p className="font-medium text-slate-800 dark:text-slate-100">
                                      {variable.statName}
                                    </p>
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                      {variable.variable} · Universe: {group.universe ?? "n/a"} · Dataset:{" "}
                                      {group.dataset} · Vintage: {group.year} · Type: {variable.inferredType} ·
                                      Concept: {variable.concept ?? group.concept ?? "n/a"}
                                    </p>
                                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                      ZIP rows: {variable.zipCount} · County rows: {variable.countyCount}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div
                        className={`mt-1 text-[10px] ${
                          message.role === "user" ? "text-brand-100" : "text-slate-500 dark:text-slate-400"
                        }`}
                      >
                        {formatTimestamp(message.createdAt)}
                      </div>
                    </div>
                  ))}
                  {isSending && (
                    <div className="mr-8 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100">
                      <div className="flex items-center gap-2">
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-500 dark:border-slate-600 dark:border-t-brand-400" />
                        <span>
                          {sendMode === "plan"
                            ? "Drafting plan..."
                            : sendMode === "search"
                              ? "Searching Census variables..."
                              : "Thinking..."}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>

            {plan && (
              <section className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Proposed Plan
                  </p>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    Confidence {formatPct(plan.confidence)}
                  </span>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-950">
                  <p className="text-slate-700 dark:text-slate-200">{plan.notes}</p>

                  {activeConflicts.length > 0 && (
                    <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-2 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-200">
                      <p className="text-[11px] font-semibold">Approval blocked: duplicate creates detected.</p>
                      <ul className="mt-1 space-y-1 text-[11px]">
                        {activeConflicts.slice(0, 4).map((conflict, index) => (
                          <li key={`${conflict.actionId}-${index}`}>
                            {conflict.detail}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {activeConflicts.length === 0 && plan.approvalBlocked && plan.approvalBlockReason && (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200">
                      {plan.approvalBlockReason}
                    </div>
                  )}

                  {plan.preflightCheck === "unavailable" && (
                    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                      Duplicate preflight check was unavailable. Approval is not blocked, but review carefully.
                    </div>
                  )}

                  <div className="mt-3 space-y-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                      Executable Now
                    </p>
                    {executablePlanSteps.map((step) => (
                      <div key={step.id} className="rounded-md border border-slate-200 px-2 py-2 dark:border-slate-700">
                        <p className="font-semibold text-slate-800 dark:text-slate-100">{step.title}</p>
                        <p className="text-slate-600 dark:text-slate-300">{step.description}</p>

                        {step.type === "import_census_stat" && step.evidence && (
                          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                            {typeof (step.evidence as any).variable?.variable === "string"
                              ? (step.evidence as any).variable.variable
                              : "Variable"}{" "}
                            · Universe: {(step.evidence as any).universe ?? "n/a"} · Dataset: {(step.evidence as any).dataset ?? "n/a"} · Vintage: {(step.evidence as any).year ?? "n/a"} · Type:{" "}
                            {(step.evidence as any).variable?.inferredType ?? "n/a"} · Concept:{" "}
                            {(step.evidence as any).concept ?? "n/a"}
                          </p>
                        )}
                      </div>
                    ))}
                    {executablePlanSteps.length === 0 && (
                      <p className="rounded-md border border-slate-200 px-2 py-2 text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
                        No executable steps in this draft yet.
                      </p>
                    )}
                  </div>

                  {futureSuggestionSteps.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Future Suggestions
                      </p>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        These are retained in the plan draft but currently non-executable until dependency resolution is wired.
                      </p>
                      {futureSuggestionSteps.map((step) => (
                        <div key={step.id} className="rounded-md border border-slate-200 px-2 py-2 dark:border-slate-700">
                          <p className="font-semibold text-slate-800 dark:text-slate-100">{step.title}</p>
                          <p className="text-slate-600 dark:text-slate-300">{step.description}</p>

                          {step.type === "create_derived_stat" && (
                            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                              Formula: {buildDerivedFormulaLabel(step.payload)}
                            </p>
                          )}

                          {Array.isArray(step.blockers) && step.blockers.length > 0 && (
                            <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-300">
                              {step.blockers.join(" ")}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {futureSuggestionSteps.some((step) => step.type === "create_stat_family_links") && (
                    <div className="mt-3 rounded-md border border-slate-200 px-2 py-2 dark:border-slate-700">
                      <p className="font-semibold text-slate-700 dark:text-slate-200">Family Tree</p>
                      <div className="mt-1 space-y-1 text-[11px] text-slate-600 dark:text-slate-300">
                        {futureSuggestionSteps
                          .filter((step) => step.type === "create_stat_family_links")
                          .map((step) => {
                            const parentName =
                              typeof step.payload.parentName === "string" ? step.payload.parentName : "Parent";
                            const childNames = Array.isArray(step.payload.childNames)
                              ? step.payload.childNames.filter((entry): entry is string => typeof entry === "string")
                              : [];
                            return (
                              <p key={step.id}>
                                {parentName} → {childNames.join(", ") || "No children"}
                              </p>
                            );
                          })}
                      </div>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleApprovePlan}
                      disabled={!canApprovePlan || isBusyRunControl || Boolean(run)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium ${
                        !canApprovePlan || isBusyRunControl || Boolean(run)
                          ? "cursor-not-allowed bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                          : "bg-brand-500 text-white hover:bg-brand-600"
                      }`}
                    >
                      Approve Plan
                    </button>
                    <button
                      type="button"
                      onClick={sendPromptForPlan}
                      disabled={isSending}
                      className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      Refresh Plan
                    </button>
                  </div>
                </div>
              </section>
            )}

            {run && (
              <section className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Run Timeline
                  </p>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {run.status}
                  </span>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-950">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={handleRunClick}
                      disabled={!RUNNING_STATUSES.has(run.status) || isBusyRunControl || isAutoRunning}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                        !RUNNING_STATUSES.has(run.status) || isBusyRunControl || isAutoRunning
                          ? "cursor-not-allowed bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                          : "bg-emerald-500 text-white hover:bg-emerald-600"
                      }`}
                    >
                      <PlayIcon className="h-3.5 w-3.5" />
                      <span>Run</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePauseRun}
                      disabled={run.status !== "running" || isBusyRunControl}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 ${
                        run.status !== "running" || isBusyRunControl
                          ? "cursor-not-allowed bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                          : "bg-amber-500 text-white hover:bg-amber-600"
                      }`}
                    >
                      <PauseIcon className="h-3.5 w-3.5" />
                      <span>Pause</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleResumeRun}
                      disabled={run.status !== "paused" || isBusyRunControl}
                      className={`rounded-md px-2 py-1 ${
                        run.status !== "paused" || isBusyRunControl
                          ? "cursor-not-allowed bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                          : "bg-indigo-500 text-white hover:bg-indigo-600"
                      }`}
                    >
                      Resume
                    </button>
                  </div>

                  <div className="space-y-1">
                    {run.events.slice(-8).map((event) => (
                      <div key={event.id} className="rounded-md border border-slate-200 px-2 py-1 dark:border-slate-700">
                        <p className="text-[11px] text-slate-700 dark:text-slate-200">{event.summary}</p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">{formatTimestamp(event.createdAt)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {(chatError || runError || warnings.length > 0) && (
              <section className="mt-3 space-y-2 text-xs">
                {chatError && (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-200">
                    {chatError}
                  </div>
                )}
                {runError && (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/40 dark:text-rose-200">
                    {runError}
                  </div>
                )}
                {warnings.map((warning, index) => (
                  <div
                    key={`warn-${index}`}
                    className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-200"
                  >
                    {warning}
                  </div>
                ))}
              </section>
            )}
          </div>

          {run && (
            <div className="border-t border-slate-200 px-3 py-2 dark:border-slate-800">
              <div className="flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300">
                <span>{runSummaryLabel}</span>
                <span>{Math.round(progress * 100)}%</span>
              </div>
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                <div className="h-full bg-brand-500 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={handleStopRun}
                  disabled={isBusyRunControl || run.status === "stopped" || run.status === "completed"}
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
                    isBusyRunControl || run.status === "stopped" || run.status === "completed"
                      ? "cursor-not-allowed bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                      : "bg-rose-500 text-white hover:bg-rose-600"
                  }`}
                >
                  <StopIcon className="h-3.5 w-3.5" />
                  <span>Cancel</span>
                </button>
              </div>
            </div>
          )}

          <div className="border-t border-slate-200 px-3 py-2 dark:border-slate-800">
            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => void sendPromptForPlan()}
                disabled={isSending || !hasAnyUserMessage}
                className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border ${
                  isSending || !hasAnyUserMessage
                    ? "cursor-not-allowed border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
                    : "border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                }`}
                aria-label="Create plan draft"
                title="Create plan draft"
              >
                <ClipboardDocumentListIcon className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => void sendPromptForSearch()}
                disabled={isSending || !hasAnyUserMessage}
                className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border ${
                  isSending || !hasAnyUserMessage
                    ? "cursor-not-allowed border-slate-200 text-slate-400 dark:border-slate-700 dark:text-slate-500"
                    : "border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
                }`}
                aria-label="Search Census variables"
                title="Search Census variables"
              >
                <MagnifyingGlassIcon className="h-4 w-4" />
              </button>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                rows={2}
                placeholder="Ask about Census variables or derived formulas..."
                className="min-h-[2.8rem] flex-1 resize-none rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-300 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={isSending || !input.trim()}
                className={`inline-flex items-center justify-center rounded-lg p-2 ${
                  isSending || !input.trim()
                    ? "cursor-not-allowed bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                    : "bg-brand-500 text-white hover:bg-brand-600"
                }`}
                aria-label="Send chat message"
              >
                <PaperAirplaneIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        className="fixed bottom-5 right-5 z-[65] inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-lg transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <ChatBubbleOvalLeftEllipsisIcon className="h-4 w-4" />
        <span>{launcherLabel}</span>
        {unreadCount > 0 && (
          <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
    </>
  );
};
