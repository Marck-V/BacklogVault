---
name: metrics-log
description: Record measured before/after numbers for a change in PROJECT_METRICS.md. Use before starting any feature, fix, refactor or dependency change (to capture the "before"), and again after it works (to record the "after", work log and study notes). Never invent numbers.
---

# Metrics log

The user is preparing for interviews and wants every improvement quantified and understood. `PROJECT_METRICS.md` (repo root) is the record. This skill has two phases; do phase 1 BEFORE touching code.

## Rules

- A number goes in the file only if a command produced it in this session. Write the command next to it.
- If something could not be measured or verified (no browser, no live site, CI not run), say so under "Not yet measured" with the command that will measure it. Never estimate.
- Ask before any request to the live Railway site; describe it and get an OK first.
- Be upfront about your own mistakes found during review.

## Phase 1: baseline (before the change)

Pick the measurements that the change could move, run them, and keep the output. Typical set:

| What | Command |
|---|---|
| Backend tests | `cd backend && npx vitest run` (tests passed/skipped, file count) |
| Backend coverage | `cd backend && npm run test:coverage` |
| Frontend tests | `cd frontend && npx vitest run` |
| Typecheck | `cd backend && npm run typecheck` and `cd frontend && npm run typecheck` |
| Vulnerabilities | `cd backend && npm audit` and `cd frontend && npm audit` |
| Lines of code | the non-blank-line count method used in section 1 "Size of the codebase" |
| Task-specific | a number for the thing being improved (requests to IGDB per dashboard load, response time, image size, rows written, and so on) |

Always add one task-specific number; the generic ones alone do not show the improvement. State the baseline to the user in one line before starting.

## Phase 2: record (after the change works)

1. Re-run exactly the same commands. Note any that changed.
2. Add a row to the **Improvement log (before and after)** table at the top of `PROJECT_METRICS.md` (newest last): Date | Improvement | Before | After | Evidence. The evidence is a command the user can re-run.
3. Update the affected numbers in section 1 (Measured) and the "Last updated" date.
4. Add a short entry to **2. Work log**, and to **Bugs and risks found** if review turned up anything.
5. Move anything unverified to **3. Not yet measured**, with its command.
6. Add or extend a study note in **5. How it works**: why it is built this way, the trade-off given up, and likely interview questions with plain-language answers.
7. Tell the user what was recorded, which numbers are new, and what could not be measured. Do not commit unless asked.

## If there is no change to measure

If the user invokes this with no code change (for example, to refresh numbers), run phase 1 commands, update section 1 and the date, and add no improvement-log row.
