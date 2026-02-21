# AI Admin Automation Research

## Overview
This document outlines the current architecture for importing US Census statistics, creating derived statistics, and grouping them into families. It is intended to support the development of an AI agent that can perform these actions autonomously.

## 1. Core Concepts & Data Models

### Database Schema (`src/instant.schema.ts`)
*   **`stats`**: Metadata for a statistic (name, category, source, type).
*   **`statData`**: The actual data values. stored as a JSON map of `{ [areaCode]: value }`.
    *   Keyed by `statId`, `parentArea`, `boundaryType`, `date`.
*   **`statDataSummaries`**: Pre-computed rollups (min, max, avg) for UI performance.
*   **`statRelations`**: Defines the "Family" structure.
    *   Fields: `parentStatId`, `childStatId`, `statAttribute` (e.g., "Male", "18-24").
*   **`statRelations`**: Used to group stats (e.g., "Population" is parent of "Male Population" and "Female Population").

## 2. Census Import Workflow

**Current Flow:**
1.  **Search:** User searches for a topic (e.g., "income").
    *   API: `/api/census-groups` (Census API proxy) or `/api/ai-census-suggest` (Claude-based suggestion).
2.  **Preview:** User selects a Census Group (e.g., "B19013").
    *   API: `/api/census-preview`. Returns list of variables (e.g., "B19013_001E").
3.  **Queue & Import:** User selects variables and adds them to a client-side queue.
    *   API: `/api/census-import`.
    *   **Logic:** Fetches data from Census API, hydrates ZIP/County buckets, writes to `stats` and `statData`.
    *   **Note:** The import process is atomic per variable/year.

**Key Files:**
*   `api/census-import.ts`: Main import endpoint.
*   `api/_shared/census.ts`: Shared logic for fetching and processing Census data.
*   `src/react/hooks/useCensusImportQueue.ts`: Manages the client-side queue.

## 3. Derived Statistics

**Current Implementation:**
*   **Type:** Materialized View (Snapshot).
*   **Mechanism:** Derived stats (e.g., percentages, rates) are calculated *once* and stored as static records in `statData`. They do **not** update automatically if the source changes.
*   **Logic Location:** `src/react/components/AdminScreen.tsx` -> `computeDerivedValues`.
*   **Supported Formulas:**
    *   `percent` (A / B)
    *   `sum` (A + B + ...)
    *   `difference` (A - B)
    *   `rate_per_1000` ((A / B) * 1000)
    *   `change_over_time` ((End - Start) / Start)
*   **Creation Flow (`handleDerivedSubmit` in `AdminScreen.tsx`):**
    1.  Frontend fetches *all* raw data for the operand stats (using `db.queryOnce`).
    2.  Frontend runs `computeDerivedValues` in memory.
    3.  Frontend writes the result to `statData` and `statDataSummaries` via `db.transact`.

**Automation Gap:**
The calculation logic (`computeDerivedValues`) and the orchestration ("fetch data -> compute -> save") are tightly coupled to the React `AdminScreen` component. To allow an AI agent to do this, this logic must be extracted into a shared library (e.g., `src/lib/derivedStats.ts`) or a new API endpoint (e.g., `/api/stats-derive`).

## 4. Grouping (Stat Families)

**Current Implementation:**
*   **Logic:** Parent-Child relationships stored in `statRelations`.
*   **UI:** Users can manually link stats or "Group" them under a new parent in the Admin UI.
*   **Creation Flow:**
    *   Simple `db.transact` call to insert `statRelations` records.
    *   Logic exists in `AdminScreen.tsx` (around line 4000).

**Automation Gap:**
Like derived stats, the logic to create these relations is currently inside the React component.

## 5. Recommendations for AI Agent Implementation

To enable an AI agent to "Import, Combine, and Group":

1.  **Refactor Logic:** Move `computeDerivedValues` and the "create derived stat" transaction logic from `AdminScreen.tsx` to a shared `src/lib/admin-actions.ts` or similar.
2.  **New API Capability:** The AI needs a way to execute these actions. Since the AI runs server-side (likely), we might need an API endpoint like `/api/admin/execute-plan` that can:
    *   Accept a "Recipe" (e.g., "Import B01001, then create derived stat 'Sex Ratio', then group under 'Demographics'").
    *   Or, simply expose the existing `census-import` and new `stats-derive` and `stats-group` primitives to the agent.

### Proposed AI "Action" Primitives

*   **`import_census_stat(dataset, group, variable, year)`**: Wraps `/api/census-import`.
*   **`create_derived_stat(name, formula, operands)`**: **Needs Implementation.** Would need to fetch data and write results server-side (or via a new API).
*   **`group_stats(parent_id, child_ids, attributes)`**: **Needs Implementation.** Simple DB write.

## 6. Existing AI Assets
*   `api/ai-census-suggest.ts`: Already exists. Uses Claude 3.5 Haiku to map natural language queries to Census Group IDs. This is a perfect "Research" tool for the agent.

## 7. Implementation Plan (User-Verifiable Slices)

### Product constraints to honor
*   AI should execute actions, not only suggest.
*   User approves a multi-step run after initial Census research/confirmation.
*   UI lives in an Admin chat popup modal in the bottom-right.
*   User can watch steps execute and pause at any time.
*   Blast radius is create-only: no delete/edit by AI.
*   Primary scope is creating stats + statData (and creating family links if explicitly included in approved plan).

### Recommended delivery approach
Use a hybrid of "copilot + constrained agent":
*   Copilot phase: AI researches and proposes an explicit step plan with expected outputs.
*   Agent phase: after approval, backend executes only allowlisted create actions step-by-step.
*   Human control: run can be paused/resumed/stopped any time from chat modal.

### Slice 1: Create-only action contract and guardrails
*   Add shared action types for an allowlist: `research_census`, `import_census_stat`, `create_derived_stat`, `create_stat_family_links`.
*   Reject any non-allowlisted action or payload containing delete/update intents.
*   Add per-run caps (`maxSteps`, `maxStatsCreated`, `maxRowsWritten`) to limit blast radius.
*   Add `dryRun`/`validateOnly` support for plan validation without writes.
*   Verification: unit tests prove blocked actions (`delete`, `edit`, unknown action) return 4xx and no writes happen.

### Slice 2: Move derived/group execution out of `AdminScreen` into server primitives
*   Extract derived stat orchestration from `src/react/components/AdminScreen.tsx` (`handleDerivedSubmit`, `computeDerivedValues`) into shared server-side helpers.
*   Add create-only endpoints for derived stats and family links (or one endpoint with typed sub-actions).
*   Keep writes idempotent using deterministic keys/checks where possible (e.g., relationKey dedupe, stat identity guardrails).
*   Verification: API integration tests create a derived stat from known operands and assert `stats`, `statData`, `statDataSummaries` rows were created.

### Slice 3: AI planning endpoint (research first, no writes)
*   Add planning route that performs read-only discovery using existing assets (`/api/ai-census-suggest`, `/api/census-groups`, `/api/census-preview`).
*   Return a machine-readable proposed run plan with steps, confidence, and expected created entities.
*   Include explicit Census evidence per import step (dataset/group/variable/year availability).
*   Verification: from chat, prompt "import X and derive Y" returns a plan with verifiable group/variable previews before approval.

### Slice 4: Run orchestration with approval + pause/resume
*   Add run state machine: `draft -> awaiting_approval -> approved -> running -> paused -> completed|failed|stopped`.
*   Execute one step at a time on server so UI can stream progress and pause between steps.
*   Store step logs/events with timestamps and payload/result summaries.
*   Verification: user approves a plan, run executes step-by-step, pause halts future steps, resume continues from next pending step.

### Slice 5: Admin chat popup modal (bottom-right)
*   Build an Admin-only chat launcher + modal anchored bottom-right.
*   Modal sections: conversation, proposed plan, run timeline/log, controls (`Approve`, `Run`, `Pause`, `Resume`, `Stop`).
*   Show pre-execution research evidence and post-step results in plain language.
*   Verification: manual QA in Admin screen confirms modal placement/behavior on desktop and mobile widths, and pause controls work during active run.

### Slice 6: Provenance, audit, and observability
*   Tag created stats/statData with run metadata (`aiRunId`, `createdBy`, `createdVia: "ai-admin"`).
*   Record immutable run audit entries for who approved, when, and what steps executed.
*   Add structured logs and analytics events for planning, approval, step success/failure, and pause/resume.
*   Verification: for any created stat, admin can trace back to run id, approval actor, and source prompt/plan.

### Slice 7: Safety hardening and rollout
*   Gate all AI admin endpoints by admin identity checks and feature flag.
*   Add timeout/retry policy for Census calls and partial-failure handling with explicit user-visible errors.
*   Roll out behind a flag to a small admin subset first.
*   Verification: staged rollout checklist passes; non-admin users cannot access endpoints/UI.

### Slice 8: "Definition of done" pilot scenario
*   Scenario: "Find Census variables for uninsured adults, import last 3 years, derive percent change, group under a new family."
*   User flow: chat prompt -> AI research plan -> user approval -> step execution -> pause/resume test -> completion summary.
*   Exit criteria: all created artifacts appear in Admin list; no edits/deletes performed by agent; full audit trail available.

### Notes on current-code alignment
*   Import path already exists server-side in `api/census-import.ts` and should be reused.
*   Derived and grouping logic is currently embedded in `src/react/components/AdminScreen.tsx`; extracting this is the key enabler for safe backend execution.
*   Existing `api/ai-census-suggest.ts` is useful as a research tool before approval, but execution must run through constrained server primitives.

## 8. Post-Slice 1 Implementation Notes

### Implemented in code
*   New guarded endpoint: `api/ai-admin-execute-plan.ts`
*   Shared plan validator + guardrails: `api/_shared/aiAdminPlan.ts`
*   Guardrail tests: `api/ai-admin-execute-plan.test.ts`

### What Slice 1 currently enforces
*   Allowlisted action types only.
*   Payload mutation-intent blocking (rejects delete/edit/update style keys).
*   Run caps (`maxSteps`, `maxStatsCreated`, `maxRowsWritten`) with hard limits.
*   `dryRun` and `validateOnly` modes.
*   Admin/API-key gated access (`AI_ADMIN_API_KEY`).

### Operational caveat
*   InstantDB admin SDK writes are privileged server-side; guardrails must remain in API logic (not just client perms).

## 9. Slice 2 Context + Decisions

### Decision added during planning
*   If a target stat already exists, execution must pause before any write begins and alert the user for review.

### Backend implications
*   Add a preflight conflict pass over the approved action plan.
*   Detect existing stat conflicts by:
    *   `import_census_stat`: existing `stats.neId` (e.g., `census:B01001_001E`).
    *   `create_derived_stat`: existing `stats.name`.
*   On conflict, return paused response and do not execute any write step.

### Slice 2 implementation target
*   Server-side create primitives for:
    *   census import execution
    *   derived stat creation
    *   stat family link creation
*   Keep create-only semantics: no update/delete operations in AI action execution path.

## 10. Slice 2 Completion Details

### Completed
*   Added server-side action execution module: `api/_shared/aiAdminActions.ts`
    *   Executes `import_census_stat`, `create_derived_stat`, and `create_stat_family_links`.
    *   Uses admin SDK + create-only action semantics in the AI execution path.
*   Added preflight conflict detection before execution:
    *   Conflicts on existing `stats.neId` for census imports.
    *   Conflicts on existing `stats.name` for derived stat creation.
    *   Conflicts on duplicate import/derived intents within the same approved plan.
*   Updated `api/ai-admin-execute-plan.ts` to:
    *   Run preflight conflict checks before any write.
    *   Return `409` + `paused: true` + `requiresUserReview: true` when conflicts exist.
    *   Execute write actions only when preflight is clean.
*   Expanded endpoint tests in `api/ai-admin-execute-plan.test.ts` for:
    *   pause-on-conflict behavior
    *   execution path when preflight has no conflicts

### Verification completed during implementation
*   `npm test -- api/ai-admin-execute-plan.test.ts`
*   `npm test`
*   `npm run build`

### Remaining for later slices
*   Wire chat modal UX to render preflight conflicts and pause/resume controls.
*   Add persistent run state machine (`draft/approved/running/paused/...`) and audit trail storage.
*   Add richer idempotency behavior for partial-run retries across requests.

## 11. Slice 3 Completion Details

### Completed
*   Added read-only planning endpoint: `api/ai-admin-plan.ts`
    *   `POST /api/ai-admin-plan` accepts a natural-language prompt and returns a machine-readable proposed run plan.
    *   Endpoint is admin/API-key gated with the same auth model as `ai-admin-execute-plan`.
    *   No writes are executed in this route (`guardrails.writesExecuted: false`).
*   Planning response now includes:
    *   `plan.steps` with action type, confidence, payload, and execution readiness.
    *   `plan.actions` (full proposed actions) and `plan.executeRequestDraft` (currently executable subset).
    *   `plan.expectedCreates` (expected stats and relation link counts).
    *   `research.importEvidence` with explicit Census evidence (dataset/group/variable/year, concept/universe, table URL, variable availability, ZIP/county preview counts).
*   Added OpenRouter-backed planning intent generation for multi-step plan proposals.
*   Added fallback AI group/variable suggestion reuse via exported helper in `api/ai-census-suggest.ts` (`suggestCensusWithAI`).
*   Added tests for planning endpoint behavior: `api/ai-admin-plan.test.ts`.

### Current behavior notes
*   Slice 3 is intentionally planning-first. Derived/family steps are returned as structured steps but marked non-executable in this slice (`executableNow: false`) when they require additional resolution.
*   `plan.executeRequestDraft` contains only actions that are executable today without additional orchestration.

### Verification completed during implementation
*   `npm test -- api/ai-admin-plan.test.ts`
*   `npm test -- api/ai-admin-plan.test.ts api/ai-admin-execute-plan.test.ts`
*   `npm run build`

### Slice 4 handoff context
*   Add run orchestration that can resolve planned references (e.g., derived/family dependencies) at execution time.
*   Stream per-step execution state into chat UI (`awaiting_approval -> running -> paused/resumed`).
*   Persist run events and approval/audit metadata.

## 12. Slice 4 Completion Details

### Completed
*   Added in-memory run orchestration store: `api/_shared/aiAdminRunStore.ts`
    *   Run state machine implemented with statuses:
        *   `draft -> awaiting_approval -> approved -> running -> paused -> completed | failed | stopped`
    *   Per-step state tracked (`pending/running/completed/failed`) with timestamps.
    *   Timestamped run events recorded for approval and step lifecycle transitions.
*   Extended `api/ai-admin-execute-plan.ts` with command-driven run orchestration:
    *   `create_run`: validate + preflight + create an `awaiting_approval` run.
    *   `get_run`: fetch run snapshot.
    *   `approve_run`: transition to `approved`.
    *   `run_next_step`: execute exactly one next step on server.
    *   `pause_run` / `resume_run` / `stop_run`: explicit control transitions.
*   `run_next_step` behavior:
    *   Executes exactly one action (read-only action returns accepted-not-executed summary; write action executes through existing create-only primitives).
    *   Re-checks preflight conflicts for write action before executing that step; on conflict, pauses run and returns review-required response.
    *   Records step result summary and updates run status to `completed` when last step finishes.
*   Backward compatibility retained:
    *   Existing direct execute path still works when no command is supplied (`mode: "execute"`).
*   Expanded endpoint tests (`api/ai-admin-execute-plan.test.ts`) for:
    *   create-run -> approve -> run-next-step sequencing
    *   pause/resume gating of step execution
    *   existing guardrail tests still passing

### Verification completed during implementation
*   `npm test -- api/ai-admin-execute-plan.test.ts`
*   `npm test -- api/ai-admin-plan.test.ts api/ai-admin-execute-plan.test.ts`

### Manual verification steps (API-level)
1. Create run:
   *   `POST /api/ai-admin-execute-plan` with `{ command: "create_run", callerEmail, actions: [...] }`
   *   Expect `202`, `mode: "create_run"`, `run.status: "awaiting_approval"`.
2. Approve:
   *   `POST /api/ai-admin-execute-plan` with `{ command: "approve_run", runId, callerEmail }`
   *   Expect `200`, `run.status: "approved"`.
3. Execute step-by-step:
   *   `POST /api/ai-admin-execute-plan` with `{ command: "run_next_step", runId, callerEmail }`
   *   Expect one step result per call and `run.nextActionIndex` increments by 1.
4. Pause / resume:
   *   Pause with `{ command: "pause_run", runId }`, expect `run.status: "paused"`.
   *   While paused, `run_next_step` should return `409`.
   *   Resume with `{ command: "resume_run", runId }`, expect `run.status: "running"`.
5. Completion:
   *   Repeated `run_next_step` eventually returns `run.status: "completed"` after the final pending step.

### Slice 5 handoff context
*   Wire chat popup modal controls to these orchestration commands (`create_run`, `approve_run`, `run_next_step`, `pause_run`, `resume_run`, `stop_run`, `get_run`).
*   Show step timeline from `run.steps` and lifecycle records from `run.events`.
*   Add lightweight polling/SSE strategy in UI for near-real-time run progression.

## 13. Post-Slice 4 Context for Slice 5 UI

### Endpoint command contract (`/api/ai-admin-execute-plan`)
*   `create_run`
    *   Input: validated `actions` plan + `callerEmail`.
    *   Output: `mode: "create_run"`, `run.status: "awaiting_approval"`.
*   `approve_run`
    *   Input: `runId`, `callerEmail`.
    *   Output: `mode: "approve_run"`, `run.status: "approved"`.
*   `run_next_step`
    *   Input: `runId`, `callerEmail`.
    *   Output: `mode: "run_next_step"`, one `stepResult`, updated `run`.
*   `pause_run` / `resume_run` / `stop_run`
    *   Input: `runId` (+ optional `reason` for pause/stop).
    *   Output: updated `run` state after transition.
*   `get_run`
    *   Input: `runId`.
    *   Output: current run snapshot for timeline refresh.

### UI polling expectations
*   During active execution, poll `get_run` to refresh `run.status`, `run.steps`, and `run.events`.
*   Disable step advancement controls while run is `paused`, `failed`, `completed`, or `stopped`.
*   Treat `409` on `run_next_step` as a control-state signal (paused/conflict/invalid transition), not just a generic error.

## 14. Conversation-First Product Direction (Confirmed)

Date captured: 2026-02-21

### Clarification Q&A log (for implementation)
1. Question: Should plan generation wait for explicit user go-ahead?
   Answer: Agent should wait for go-ahead by prompt policy, but may ask user if they want a plan draft after conversation lull.
   Implementation impact: Chat system prompt should enforce `no plan draft until user approval signal` while allowing polite check-ins.
2. Question: What should plan cards include?
   Answer: Include plain-English stat titles plus small gray metadata per variable (ID, Universe, Dataset, Vintage, Type, Concept), plus derived formula explanations and a family tree view (grandparent/children/grandchildren titles).
   Implementation impact: Slice 5 plan UI must render rich evidence blocks, derived formula narration, and family tree summary.
3. Question: Should variable selections be a manual UI checklist or conversational edits?
   Answer: Conversational only for now; agent updates and re-sends latest plan as chat evolves.
   Implementation impact: No separate variable picker in Slice 5; rely on message-driven plan revisions.
4. Question: How should plan edits happen?
   Answer: Through chat only.
   Implementation impact: Plan UI needs a read-only preview + Approve action; corrections are done in message thread.
5. Question: How should execution run?
   Answer: Step-by-step with progress bar at bottom of chat and cancel button; cancel stops run; user may manually clean partial data from stats list.
   Implementation impact: Use `run_next_step` loop in UI with clear progress indicator and `stop_run` binding for cancel.
6. Question: Should chat history be stored?
   Answer: Yes; persist chat histories and list of generated stat IDs associated to that chat (prefer InstantDB).
   Implementation impact: Add persistence model for one thread + messages + linked run IDs/stat IDs in a follow-up slice.
7. Question: How should duplicates be handled?
   Answer: Plan should check for existing target stats and block approval for duplicate creates; using existing stats as derived operands is allowed.
   Implementation impact: Keep preflight conflict gating before approval/execution for creates; do not block existing-stat references used only as formula inputs.
8. Question: How should derived reasoning be presented?
   Answer: Agent should explain formula logic and why the formula is appropriate before plan approval.
   Implementation impact: System prompt + response templates must include formula reasoning before draft plan presentation.
9. Question: What should happen on minimize/navigation?
   Answer: Preserve chat on minimize and across page navigation if simple; show unread bubble on minimized launcher.
   Implementation impact: Persist thread state in client storage + hydrate on mount; add unread counters and run-status badges.
10. Question: One or many threads?
    Answer: One thread for now.
    Implementation impact: Single active admin thread keyed by admin user/session; defer multi-thread model.

### Revised Slice 5 scope (UI + orchestration client)
*   Build bottom-right Admin chat launcher + modal with:
    *   Conversation panel
    *   Plan preview card (read-only) + Approve button
    *   Run timeline/status
    *   Bottom progress bar + Cancel button
    *   Top-right `Clear chat` button
*   Add conversation policy in system prompt:
    *   Explore Census options and explain meanings first.
    *   Explain derived formulas and rationale.
    *   Only draft plan on explicit user go-ahead or after asking for permission during lull.
*   Use existing run API commands:
    *   `create_run` after user approves proposed plan draft
    *   `approve_run` on click
    *   iterative `run_next_step` for progress
    *   `stop_run` for cancel
    *   `get_run` for refresh/poll
*   Add plan rendering details:
    *   Plain-English titles
    *   Small metadata text (ID/Universe/Dataset/Vintage/Type/Concept)
    *   Derived formula section using generated stat names
    *   Family tree title-only visualization
*   Add pre-approval duplicate check display in plan card:
    *   If duplicate create detected, disable approval and instruct user to adjust plan.

### Revised Slice 6 scope (state persistence + one-thread memory)
*   Persist one chat thread and messages (InstantDB preferred).
*   Persist run links + generated stat IDs for traceability.
*   Restore chat state when modal is reopened or after page navigation.
*   Maintain unread bubble counts while minimized.

### Revised Slice 7 scope (audit + provenance hardening)
*   Extend existing run audit with chat linkage:
    *   thread id
    *   message ids used for approval context
    *   approved plan snapshot
*   Tag created entities with run metadata where feasible (`aiRunId`, `createdVia`).

### Revised Slice 8 scope (safety + rollout hardening)
*   Keep create-only blast radius enforcement.
*   Keep duplicate-create blocking as an approval gate.
*   Explicit user-facing behavior for partial runs on cancel (`stop_run`) and manual cleanup guidance.

### Additional future slice (optional)
*   Multi-thread chat support is explicitly deferred.
*   If needed later, add a dedicated slice for multiple saved threads and thread switching UX.
