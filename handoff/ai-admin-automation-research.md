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

## 15. Post-Slice 5 Observations + Scope Adjustments (2026-02-21)

### What failed in live testing
*   User requested business-count stats with size disaggregation, but generated plans proposed unrelated ACS groups/variables (e.g., `B01001` sex/age and `B28001` computing devices).
*   Chat model often produced plausible plain-text planning language before grounded evidence was validated.
*   Plan card showed non-executable derived/family steps, creating understandable confusion about why they cannot run in the same approved flow yet.

### Root causes
*   Planner currently biases to `acs/acs5` and does not yet enforce a strict relevance threshold between user intent and selected Census group/variable evidence.
*   Planning fallback can still produce a "best available" group even when semantic fit is weak.
*   Derived/family execution requires resolved stat ids, but planner output still describes variable/name-level intents.
*   Execution pipeline has no dependency resolver yet to map import outputs (`createdStatId`) into downstream derived/family action payloads.

### Confirmed UX direction update
Add an explicit, grounded "search first" workflow before plan approval:
*   Keep conversational flow.
*   Show a user-reviewable list of Census variables sourced from real Census metadata/evidence before plan drafting.
*   Add a dedicated Search button in chat UI (next to/near plan trigger) so user can request fresh evidence search at any time.

### New implementation slices

#### Slice 5A: Grounded Census search results in chat
*   Add a read-only search action/endpoint for "candidate variables" with evidence:
    *   Dataset/group/variable id
    *   Concept + universe
    *   Availability checks
    *   Simple relevance score/reason against user request
*   Render search-result cards in chat thread (not plain text only).
*   Add explicit Search button in chat composer as manual trigger for new evidence pass.
*   Verification:
    *   For prompt "business count by size", search cards should show business-relevant candidates or an explicit "no strong match yet" response (not unrelated demographics/computers by default).

#### Slice 5B: Relevance gating before plan generation
*   Block or warn plan generation when evidence relevance is below threshold.
*   If confidence is low, assistant asks clarifying question instead of drafting executable imports.
*   Require plan draft to reference selected/confirmed search candidates.
*   Verification:
    *   Plan draft is not produced from weakly related groups unless user explicitly overrides.

#### Slice 5C: Dependency resolution for one-run execution (imports -> derived -> family)
*   Resolve variable-based derived intents into stat-id payloads after import steps complete.
*   Resolve family parent/child names into concrete stat ids (newly created or pre-existing where allowed).
*   Permit a single approved run to execute:
    1. import steps
    2. derived creation
    3. family-link creation
*   Keep create-only guardrails unchanged.
*   Verification:
    *   End-to-end run creates imported stats, then derived stats, then family links in one run without manual intervention.

### Clarification note for current behavior
The "Planned in Slice 3 only" blocker text is expected with current backend shape: those steps are intentionally retained as future intents until dependency resolution wiring is implemented.

## 16. Slice 5A Completion (2026-02-21)

### Implemented
*   Added grounded Census search mode to chat endpoint: `api/ai-admin-chat.ts`
    *   New `requestSearch: true` request path.
    *   Search is read-only and evidence-backed from Census metadata (`groups.json` + group metadata + resolved variables + availability summaries).
    *   Response now returns a structured `search` payload with:
        *   query, dataset, year
        *   matched groups with relevance score/reason
        *   per-variable metadata (id, label, stat name, inferred type, concept, ZIP/County row counts)
        *   warnings for weak/no matches or per-group inspection failures
*   Added chat endpoint test coverage: `api/ai-admin-chat.test.ts`
    *   Verifies `requestSearch` returns structured grounded search results and does not draft plan.
*   Updated admin chat UI: `src/react/components/AdminAiChatModal.tsx`
    *   Added Search button in composer (adjacent to plan button).
    *   Added search loading state (`Searching Census variables...`).
    *   Renders grounded search result cards directly in chat thread (not plain text only).
    *   Cards show group metadata and variable metadata in user-reviewable format before planning.

### Verification
1. Open admin screen and AI chat modal.
2. Send user context message like: `I want business count with size disaggregation`.
3. Click the new Search (magnifier) button.
4. Confirm chat shows:
   *   assistant search status message
   *   grounded search cards with Census group ids and variable ids
   *   metadata rows (Universe, Dataset, Vintage, Type, Concept)
5. Confirm no plan is drafted unless plan is explicitly requested.

## 17. Generalized Dataset Scope Direction (2026-02-21)

### User-approved additions (beyond business-only handling)
1. Add a dataset capability registry so the agent can clearly state what is searchable/importable now versus out-of-range.
2. Expand grounded search to run across an allowlist of supported datasets (not ACS-only).
3. Show result-card badges/status indicating `Importable now`, `Research-only`, or `Out of range`, with concise reason.

### Implementation status
*   Item 1 implemented in this pass.
*   Items 2 and 3 are queued for the next slice.

### Item 1 completion details
*   Added shared capability registry module: `api/_shared/censusDatasetCapabilities.ts`
    *   Includes current dataset support metadata (`acs/acs5`, profile/subject/cprofile, `cbp`, `abscb`).
    *   Tracks searchable/importable flags, support tier, geography coverage, and notes.
*   Wired registry into grounded search response in `api/ai-admin-chat.ts`
    *   Search responses now include:
        *   `datasetCapability` for the requested dataset
        *   `knownDatasetCapabilities` for transparent scope reporting
    *   If dataset is not in registry (or marked non-searchable), warnings are returned explicitly.

## 18. Auto-Search Initiative + Grounded Follow-up Context (2026-02-21)

### Implemented
*   `api/ai-admin-chat.ts`
    *   Added auto-search trigger for clear stat-intent messages (unless user explicitly requested plan or manually triggered search).
    *   Search messaging is now sequenced for clarity:
        1. brainstorming/intent framing message
        2. grounded search evidence payload
        3. post-search review + recommendations
    *   Search now returns an immediate review-style assistant message summarizing:
        *   dataset scope/support tier
        *   top group/variable candidates
        *   whether results are review-only versus importable now
    *   Response includes `autoSearchTriggered` to make behavior explicit for clients/debugging.
*   `src/react/components/AdminAiChatModal.tsx`
    *   Added serialization of grounded search evidence into message context sent back to the chat API.
    *   This allows follow-up prompts (e.g., "do these match?") to reference prior search results correctly.
    *   Added dataset scope line in search cards and warning rendering from search payload.
    *   Send-state now shows `Searching Census variables...` for likely stat-intent chat turns.

### Verification
1. Send a stat-intent message (without pressing Search), e.g. `business size disaggregate`.
2. Confirm chat auto-runs grounded search:
   *   spinner shows search wording
   *   assistant posts immediate review summary
   *   search cards are appended after summary
3. Ask follow-up `do these search results match?`
4. Confirm assistant references prior grounded search evidence (instead of claiming no results were shown).

## 19. Relevance + Routing Hardening (2026-02-21)

### Implemented
*   `api/ai-admin-chat.ts`
    *   Improved term normalization to avoid malformed stems (e.g., `businesses -> business`).
    *   Reworked brainstorm-term expansion to use a constrained allowlist + intent terms instead of broad sentence tokens.
    *   Added explicit business-intent relevance gating so non-business ACS groups are downranked/filtered for business prompts.
    *   Added optional auto-routing for business intent to research-only datasets (`cbp`, `abscb`) when needed.
    *   Added no-valid-match behavior for business intents so the assistant does not summarize unrelated top matches as valid.
    *   Search payload now includes `searchedDatasets`, per-group `supportTier`, and intent metadata for clearer UI/context.
*   `src/react/components/AdminAiChatModal.tsx`
    *   Search cards now show searched datasets and per-group support tier labels (`Importable now` / `Research-only`).
    *   Search evidence serialization includes searched dataset and support tier context for follow-up model reasoning.

### Verification
1. Send: `a count of businesses, and include disaggregate stats by business size`.
2. Confirm search terms are concise keyword-like terms (not long sentence fragments).
3. Confirm non-business ACS family/household tables are no longer presented as top business matches.
4. If importable ACS business matches are unavailable, confirm chat can surface research-only business dataset matches with explicit labeling.
5. If no high-confidence business match exists, confirm assistant states that clearly instead of implying unrelated matches are good.

## 20. Post-Search Summary UX Tightening (2026-02-21)

### Implemented
*   `api/ai-admin-chat.ts`
    *   Post-search review now formats top matches as interpreted bullet points using short human-readable titles plus variable IDs.
    *   Added fallback title logic so code-only concepts (`Bxxxx`) do not appear as the only user-facing title in summary text.
    *   Added explicit review-line surfacing for research-only alternatives when importable matches are present.
*   `src/react/components/AdminAiChatModal.tsx`
    *   Search card now includes a dedicated "Research-only alternatives" section when alternatives exist.
    *   Serialized search evidence includes alternative/tier context for follow-up assistant reasoning.

### Verification
1. Run a business-size prompt and confirm post-search review includes bullet list items with readable titles and `(VARIABLE_ID)`.
2. Confirm that when research-only alternatives exist, they appear in both:
   *   review message summary
   *   search-card alternatives block

## 21. Conversation/Plan Context Propagation Hardening (2026-02-21)

### Problem addressed
User-observed disconnect: chat recommendations were grounded in one direction, but later plan generation/search fallback could drift because only a compressed subset of conversation state was being used for planning/search.

### Implemented
*   `api/ai-admin-chat.ts`
    *   Increased retained message window (`MAX_CONTEXT_MESSAGES`) from a narrow cap to a larger thread window.
    *   Added request-level `artifacts` ingestion with normalized fields:
        *   `latestSearchSummary`
        *   `latestPlanSummary`
        *   `latestRunSummary`
    *   Added artifact context block injection (`[Thread Artifacts Context]`) into model-facing messages so chat/search brainstorming can incorporate latest plan/run/search state even when not represented as plain thread text.
    *   Planning prompt construction now includes recent transcript lines with both roles, plus explicit artifact context for continuity.
    *   Planner invocation now sends both:
        *   `prompt` (rich, context-heavy planning prompt)
        *   `searchPrompt` (intent-focused query for group search/suggestion fallbacks)
*   `api/ai-admin-plan.ts`
    *   Added optional `searchPrompt` handling.
    *   Group search and AI suggest fallback now use `searchPrompt` instead of full planning transcript, reducing noisy term dilution.
*   `src/react/components/AdminAiChatModal.tsx`
    *   Added compact artifact serialization on every chat/search/plan request:
        *   latest grounded search evidence summary
        *   latest plan summary (notes/confidence/blockers/step overview)
        *   latest run summary (status/recent steps/events)
    *   This preserves non-message state as model context without polluting user-visible chat text.
*   Tests
    *   `api/ai-admin-chat.test.ts`
        *   Added test for artifact context injection into model input.
        *   Extended plan-phrase test to assert `searchPrompt` preserves user intent topic.

### Verification
1. Have a conversation, run grounded search, then generate a plan.
2. Ask follow-up refinements and regenerate plan.
3. Confirm follow-up model responses and new plan continue referencing prior search/plan state.
4. Confirm plan endpoint behavior uses intent query for group search (less drift to unrelated groups when prompt transcript is long).

## 22. Next-Slice Direction: Resolver + Strict Planner Provenance (2026-02-21)

### User clarification (what should happen next)
1. The plan executor should be able to run a single approved sequence where:
   * imports run first
   * derived stats run after import success
   * family/group links run after derived/import success
2. If a step fails, execution should pause and the agent should re-evaluate with that failure context available in chat history.
3. Executable imports should come only from the AI planner's suggested import candidates (not backend-added fallback candidates).
4. Planning should still validate/filter the AI model's suggestions and show explicit notes when a suggested stat cannot be used, including why.
5. Those planning rejections/errors should be included in the agent's future chat context so the agent can self-correct on the next plan attempt.

### Current state (important constraint)
*   Backend execution already supports:
    * `create_derived_stat`
    * `create_stat_family_links`
*   Planner currently blocks those from execution because it emits symbolic references (variables/names), not resolved stat IDs.
*   Planner currently merges model candidates with fallback candidates (AI suggest fallback + grounded top-group backup), which can admit semantically off-topic but valid imports.

### Planned implementation changes (next slices)

### A. Strict planner provenance for executable imports
*   Add provenance metadata to import candidates (`model`, `ai_fallback`, `grounded_backup`).
*   Make executable import actions derive only from `model` provenance candidates (default mode for chat planner path).
*   Preserve non-model candidates as research notes only (not executable actions).
*   Add `rejectedModelCandidates` (or equivalent) to plan payload with reasons such as:
    * invalid group/variable
    * census metadata 404 / unavailable
    * not available in selected dataset/year
    * low semantic relevance / failed relevance gate
*   Include these rejection notes in chat artifact context so later AI turns can see what failed and why.

### B. Dependency resolver for sequential execution
*   Add runtime resolver state to run execution (or a resolver helper invoked during `run_next_step`) that maps:
    * import step results -> created stat IDs
    * imported variable / NE ID -> created stat IDs
    * derived stat names -> created stat IDs
    * family names/titles -> resolved stat IDs (where applicable)
*   Rewrite pending derived/family action payloads to concrete IDs before execution:
    * derived: `numeratorId`, `denominatorId`, `sumOperandIds`
    * family: `parentStatId`, `childStatIds`
*   Promote derived/family actions into executable plan actions once their dependencies are resolvable.

### C. Failure pause + re-evaluate loop
*   On execution failure:
    * pause run
    * record structured failure event and step error detail
    * expose failure artifact to chat context
*   Agent can then propose a revised plan/patch (user approval required before additional writes).
*   Initial scope can stop at "pause + visible error + context captured"; automatic re-planning can come next.

### Verification targets for upcoming work
1. Approve a plan with imports + derived + family steps and run it end-to-end.
2. Confirm derived stats appear after imports without a second approval flow.
3. Confirm family links/groupings are created after derived/import steps.
4. Confirm an invalid AI-suggested import appears as a rejected planner note (not executable).
5. Confirm that rejection note appears in later chat context and improves the next plan attempt.

## 23. Slice Update: Strict Planner Provenance + Rejected AI Import Notes (2026-02-22)

### Implemented
*   `api/ai-admin-plan.ts`
    *   Added internal import-candidate provenance (`model`, `ai_fallback`, `grounded_backup`).
    *   Enforced strict provenance for executable imports:
        *   only `model`-proposed import candidates can become executable `import_census_stat` actions.
        *   fallback candidates are still inspected/researched but remain non-executable.
    *   Added rejected AI-model import tracking (`rejectedModelImportCandidates`) for planner-visible/user-visible reasons including:
        *   sanitize failure (invalid group/variable shape)
        *   Census metadata validation failure (including sanitized 404 summaries)
        *   no importable variables available after validation
    *   Added explicit non-executable planner note steps for rejected AI-suggested imports so the plan UI communicates what the AI tried and why it was blocked.
    *   Added `importExecutionPolicy: "strict_model_only"` to plan payload.
*   `src/react/components/AdminAiChatModal.tsx`
    *   Extended plan artifact serialization to include strict import policy and rejected AI-suggested import notes, so future chat/planning turns can see those failures in context.
*   Tests
    *   `api/ai-admin-plan.test.ts`
        *   Updated fallback-related tests to reflect strict provenance (fallback imports no longer executable).
        *   Added assertions that rejected AI model candidates are surfaced in plan payload.

### Behavioral impact
*   This addresses the "random valid but off-topic stat got imported" class of failures by preventing backend-added fallback candidates from entering executable plan actions.
*   Planner can still inspect fallback/grounded candidates for research context, but execution approval is blocked unless at least one AI-model-suggested import validates.

### Remaining next step (still needed)
*   Dependency resolver for imports -> derived -> family so derived stats and grouping can execute in the same approved run after import success.

## 24. Slice Update: Runtime Dependency Resolver for Imports -> Derived -> Family (2026-02-22)

### Implemented
*   `api/_shared/aiAdminRunStore.ts`
    *   Run steps now persist structured `resultMeta` (in addition to `resultSummary`) so later steps can resolve dependencies across requests/serverless rehydration.
*   `api/ai-admin-execute-plan.ts`
    *   Added runtime dependency resolver before each write-step execution in `run_next_step`.
    *   Resolver builds state from prior completed step metadata:
        *   `actionId -> createdStatId`
        *   `census:VARIABLE -> createdStatId`
        *   `statName -> createdStatId`
    *   Derived stat steps (`create_derived_stat`) now auto-resolve:
        *   `numeratorId`
        *   `denominatorId`
        *   `sumOperandIds`
      using prior import results and (if needed) existing stats by `neId`.
    *   Family-link steps (`create_stat_family_links`) now auto-resolve:
        *   `parentStatId`
        *   `childStatIds`
      using prior created stat names and (if needed) existing stats by `name`.
    *   If dependencies cannot be resolved, the run is paused with a clear error message instead of silently failing.
    *   Resolved action payloads are used for both preflight conflict checks and execution.
*   `api/ai-admin-plan.ts`
    *   Derived steps with satisfiable import dependencies are now included in `executeRequestDraft.actions` (no longer forced into "Future Suggestions").
    *   Family-link steps are now included in `executeRequestDraft.actions` when structurally valid (runtime resolver handles ID/name resolution at execution time).
*   `src/react/components/AdminAiChatModal.tsx`
    *   Updated "Future Suggestions" copy to reflect generic non-executable reasons (instead of dependency resolver not being wired).
    *   Family Tree block now renders for all family-link plan steps, including executable ones.
*   Tests
    *   `api/ai-admin-execute-plan.test.ts`
        *   Added run-time chaining test that proves `import -> derived -> family` resolution and execution in one approved run.

### Behavioral impact
*   Approved runs can now automatically execute eligible derived stats after imports, and then family links, in sequence.
*   This removes the earlier need for a separate approval/execution pass for many derived/family steps.
*   Family-link success still depends on planner naming a real parent stat (either one created earlier in the run or an existing stat in the DB by name).

### Remaining known gap
*   Planner may still choose a conceptual family parent label (e.g. `"Business"`) that does not correspond to an actual stat record. In that case the runtime resolver will pause the run and surface the unresolved parent name. A later planning/prompting slice should improve parent-stat selection or introduce explicit parent-stat creation behavior where appropriate.
