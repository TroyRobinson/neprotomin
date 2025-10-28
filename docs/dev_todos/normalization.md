# Normalization TODOs

## Background
Multiple modules implement their own normalization helpers (`normalizeScopeLabel`, `normalizeParentArea`, etc.), which caused mismatches between ETL-written `parentArea` values and React expectations. We patched the Census loader to align with the React normalizer, but long-term we should consolidate to a shared utility.

## Status
- ✅ Shared helper landed as `src/lib/scopeLabels.ts` (2025-10-29) and is now used by the Census ETL, React hooks (`useStats`), the imperatively controlled map, and the vanilla stat store. The Tulsa ZIP scope mismatch is resolved.

## Remaining Tasks
- Add a lightweight test (unit or script-level) to assert that known inputs map to the same normalized outputs (e.g., `"Tulsa" → "Tulsa County"`, `"Oklahoma"` → `"Oklahoma"`).
- Extend the test to cover alias handling (`buildScopeLabelAliases`) so “Tulsa County” resolves synonymously with “Tulsa”.
- Document the helper in `docs/coding_guidelines.md` (or similar) so future contributors import it instead of re-implementing normalization.

## Open Questions
- Should normalization be locale-aware (e.g., handling apostrophes, “Mc/Mac” cases) or is current Title-Case sufficient?
- Do we need to preserve original casing anywhere for display purposes?
