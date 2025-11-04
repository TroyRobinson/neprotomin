# Selection System Refactor Roadmap

This note captures the current behavior of the selection features (areas, organizations, clusters, address search) and outlines refactor opportunities that surfaced while implementing the recent mobile search + organization zoom updates. Each proposal includes rationale, expected impact, and an implementation sketch so a future dev can scope the work quickly.

## Current State Overview

Selection logic is orchestrated primarily inside `src/react/ReactMapApp.tsx` with the imperative map controller in `src/react/imperative/mapView.ts` driving layer updates. Important pieces:

- **Area selections** (`areaSelections` state) hold ZIP/COUNTY/TRACT selected, pinned, and transient IDs. Mutations flow through `applyAreaSelection` and the `handle*AreaSelection*` handlers.
- **Org selections** track a direct org list (`selectedOrgIds`), the active org ID for hover/spotlight, a highlight list, and a boolean flag (`selectedOrgIdsFromMap`) to distinguish map-driven vs. sidebar-driven picks.
- **Search flows** (city, address, org) manipulate both sets of selections and sometimes clear one while maintaining the other.
- **Suppression flags** were introduced (`suppressAreaSelectionClearRef`) to avoid recursively clearing org selections when we programmatically clear areas prior to focusing an org or address. This works but couples search flows to area handlers.
- **Sidebar derivations** recompute “in selection” vs. “all” lists by combining map-visible orgs, area selections, and direct org picks.

The resulting surface area is functional but difficult to reason about: state is scattered across React state hooks, refs, map callbacks, and search logic; race conditions can happen when multiple sources update simultaneously; and small adjustments (e.g., new search behavior) require touching several layers.

## Refactor Opportunities

| Proposal | Benefit | Difficulty |
| --- | --- | --- |
| 1. Selection Reducer / State Machine | High | Medium |
| 2. Map vs. Sidebar Selection Abstraction | Medium | Medium |
| 3. Selection Service (Unified API) | High | High |
| 4. Transactional Selection Updates | Medium | Medium–High |
| 5. Persistable Selection Model | Medium | Medium |

### 1. Centralize Selections in a Reducer or State Machine

**Context:** `ReactMapApp` manually orchestrates selection state with multiple `useState` hooks. Dependencies between org and area selections are encoded through imperative checks (`if (selection.selected.length > 0)…`). Managing suppression flags is brittle.

**Proposal:** Extract a dedicated reducer (or a lightweight finite state machine) that encapsulates all selection mutations. Events would include `AREA_SELECTED`, `ORG_SELECTED`, `SEARCH_ORG_FOCUS`, `SEARCH_ADDRESS_FOCUS`, `CLEAR_SELECTIONS`, etc. The reducer can carry derived flags (e.g., `source: 'map' | 'sidebar' | 'search'`) and handle precedence rules internally.

**Benefits:**
- Single source of truth for selection transitions, reducing duplicated logic.
- Easier to write unit tests for selection semantics independent of the map.
- Makes “undo” or future time-travel features more approachable.

**Implementation Sketch:**
1. Define a `SelectionState` type capturing areas, orgs, origin metadata, and highlight flags.
2. Implement a reducer + action union inside a new module, e.g., `src/react/state/selectionReducer.ts`.
3. Replace individual `useState` hooks in `ReactMapApp` with `useReducer`.
4. Update map callbacks (`onAreaSelectionChange`, `onClusterClick`, etc.) to dispatch actions instead of mutating local state.
5. Adjust sidebar derivations to read from reducer state.

**Risk/Considerations:** Ensure reducer actions remain synchronous to avoid race conditions with map events. Might need to wrap imperative map calls (fit bounds, highlight updates) inside `useEffect` watching reducer state.

### 2. Abstract Selection Sources (Map vs. Sidebar vs. Search)

**Context:** We currently track origin with `selectedOrgIdsFromMap` and occasional suppression flags. Extending to more sources (e.g., saved queries) would add more ad-hoc booleans.

**Proposal:** Introduce a `SelectionContext` object (or extend the reducer) that records both *what* is selected and *who* requested the change. For example:

```ts
type SelectionSource = 'map' | 'sidebar' | 'search' | 'system';

interface SelectionUpdate {
  source: SelectionSource;
  type: 'areas' | 'orgs';
  payload: ...;
}
```

Handlers can make decisions based on the source without bespoke flags.

**Benefits:** Clear provenance for selections (useful for analytics), simplifies logic when multiple sources clash (e.g., search should override previous map selections but not vice versa).

**Implementation Sketch:** Wrap the reducer dispatch (Proposal 1) with helper functions such as `selectOrgFromSource(source, orgId)`. Replace direct calls to `setSelectedOrgIds` / `setSelectedOrgIdsFromMap`.

**Risk:** Requires touching most selection calls, but mechanical once the abstractions exist.

### 3. Expose a Unified Selection Service

**Context:** The imperative map controller, React component, and sidebar each modify selections differently. A shared service could mediate between them.

**Proposal:** Create a `useSelectionController` hook that returns a stable API (e.g., `selection.selectArea`, `selection.selectOrg`, `selection.clear`, `selection.getState`). Internally it can use the reducer from Proposal 1 and expose read-only selectors plus action dispatchers.

**Benefits:** 
- Decouples UI components from selection implementation details.
- Enables future reuse (e.g., embedding the map elsewhere or writing integration tests) by mocking the controller.
- Makes side-effect management (map fit, analytics) centralized via hook effects.

**Implementation Sketch:** 
1. Build the hook and export a context/provider around `ReactMapApp`.
2. Update map callbacks and sidebar components to consume the hook rather than prop drilling individual handlers.
3. Move analytics logging into the hook where action types are known.

**Difficulty:** High – this refactor requires wide changes but yields a cleaner architecture long-term.

### 4. Transactional Selection Updates Instead of Suppression Flags

**Context:** The new `suppressAreaSelectionClearRef` prevents area-clearing side effects when performing multi-step operations (e.g., search -> clear -> highlight org). While functional, it’s not intuitive.

**Proposal:** Introduce a small helper (e.g., `withSelectionTransaction`) that batches updates and defers area-change notifications until the transaction completes. Something like:

```ts
runSelectionTransaction(() => {
  selection.clearAreas();
  selection.focusOrg(orgId);
});
```

During the transaction we either queue handlers or mark them as originating from `source: 'system'`, allowing standard logic to ignore them.

**Benefits:** Removes manual ref counting, clarifies intent (“do these updates atomically”), and prevents future regressions when more steps are added.

**Implementation Sketch:** The reducer could accept a `batch` action or the new selection service could expose a `transaction` method storing a counter and skipping certain side effects until `finally`.

### 5. Persistable Selection Model (URL or Storage)

**Context:** We already sync area selections to InstantDB + localStorage, but org selections and focus state aren’t persisted. More formal serialization would allow deep links and better hand-off between sessions.

**Proposal:** Define a serializable selection model (e.g., `?selectedOrg=...&zip=...`) and a hydration path. This could live alongside the reducer: when the state changes, emit an encoded string; when the app loads, parse the URL/localStorage and dispatch initialization actions.

**Benefits:** 
- Shareable links satisfying analytics/customer requests.
- Cleaner initial state logic (no ad-hoc `hydrateFromPersistedSelection`).
- Paves the way for a “back to previous selection” button or breadcrumbs.

**Implementation Sketch:** 
1. Extend the reducer with an `INIT_FROM_STATE` action.
2. Create utilities in `src/react/lib/selectionSerialization.ts`.
3. Update startup to read query params / storage and dispatch one action.

**Difficulty:** Medium; serialization/reporting wins are meaningful even if other refactors happen later.

## Suggested Sequence

1. **Reducer Foundation (Proposal 1)** – Unlocks saner state management and simplifies subsequent work.
2. **Transactional Updates (Proposal 4)** – Once the reducer exists, replacing suppression flags becomes straightforward.
3. **Selection Source Abstraction (Proposal 2)** – Can piggyback on the reducer’s action types.
4. **Unified Selection Service (Proposal 3)** – Larger change; schedule when tackling broader map-component refactors.
5. **Persistable Model (Proposal 5)** – Implement after the reducer so serialization is derived from a single state object.

## Testing Considerations

- Unit-test the reducer/service with sequences reflecting current edge cases (address search → org search, cluster selection, area clearing).
- Integration-test using Cypress Playwright flows: verify highlights persist, zoom levels match expectations, and URL/state hydration works.
- Ensure map fit/zoom side effects remain accurate; the reducer/hook should expose derived selectors so `useEffect` can react to specific changes instead of full state comparisons.

Adopting these refactors will move the selection subsystem toward a cohesive, testable, and shareable core, making future UX changes (multi-select orgs, cross-state interactions, join-to-play features) far easier to implement safely.
