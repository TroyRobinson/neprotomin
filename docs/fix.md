# Outstanding Fixes – Areas Refactor

_Created: 2025-10-22_

This note captures the remaining edge cases we identified while testing the new Areas dropdown + report alignment work. Each item includes the scope we validated today, and the follow-up needed for the next iteration.

---

## 1. County (and future area kinds) stat-hover overlays — ✅
Resolved by reusing the shared area label controller (`createZipLabels`) for both ZIPs and counties. Hovering any county centroid now shows the stat tooltip (primary + secondary when available).

## 2. CSV export generalisation — ✅
The export builder now honours the active Areas dropdown: it outputs rows for the selected kind and appends pinned areas from other kinds as context. Columns were standardised (`area_kind`, `area_code`, `area_name`, `is_context`, stats…).

## 3. QA follow-up — ℹ️
- Mixed selections, highlight context colouring, export, and dropdown control smoke-tested after the fixes above.
- Keep re-running the regression pass if additional tweaks land later.
