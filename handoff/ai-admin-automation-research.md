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
