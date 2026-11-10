# Captain Handoff — BudgetTool (Phase 1 → Phase 2)

> Written 2026-11-09 by the retiring oh-my-captain. Addressed to the next oh-my-captain taking over the session. Read this top-to-bottom before touching anything.

## 1. What this project is

A private, browser-based Canadian (Ontario) retirement planning/budget tool. Design → spec → plan → agent-fleet implementation; the captain coordinates a herdr-managed fleet of opencode agents on **free models only** (no paid subscription). The repo's `opencode.json` pins every session to `opencode/glm-5.3-flash-free`.

- **Master spec:** `docs/superpowers/specs/2026-11-08-budget-tool-design.md` — authoritative for intent.
- **Phase 1 plan:** `docs/superpowers/plans/2026-11-08-engine-core.md` — authoritative for Phase 1 decisions. It now contains a **Progress Status table (2026-11-09)** listing every task, its commit, and its completion ledger. Read that first.
- **Modeling conventions:** `docs/assumptions.md` — every v1 simplification with reasoning. Keep it in sync with the engine; if engine behavior changes, update this file in the same commit.

## 2. Repo state at handoff

- Branch `master`, working tree clean.
- **156 tests / 17 files green** (`npm test -w packages/engine` — run from repo root, NOT from inside the package).
- `npx tsc --noEmit -p packages/engine` clean.
- Engine is complete (Phases 1's Tasks 1–15): scaffold, types, 2026 tax tables (`packages/engine/data/tax/ca-2026.json` + `SOURCES.md`), federal/ON/OAS-clawback/GIS/RRIF, TFSA/RRSP rooms, mortgage, deterministic + Monte Carlo returns, year stepper (`packages/engine/src/simulate.ts`), flows (`src/accounts/flows.ts`), non-reg ACB (`src/accounts/nonreg.ts`), golden projection with an **independent reference calculator** (`tests/golden/reference.ts`) and hand-derived pins.

### The ONE open Phase 1 item: Task 16 (external cross-check)

Dispatched to the reviewer **twice**; both runs were lost (free-model daily quota first, then the pane vanished before output). **No commit, no files.** Nothing was received from it — treat as never-started. The task as written in the plan (create `docs/validation/cross-check.md` + `packages/engine/tests/validation/crosscheck.test.ts`, commit `docs: external cross-check of tax engine`) defines it fully: verify against official sources (a) golden year-1 tax 18,986.41 on 95k employment, (b) RRIF factor at 72 = 5.40%, (c) OAS repayment threshold 95,323, (d) TFSA cumulative room 109,000.

## 3. Outstanding review debt

- Tasks 13–15 (commits `dd2aa6c`, `7fc1ba9`, `faf41ef`, `87fc0ed`) were implemented **natively by the captain** when the builder was quota-blocked, so they **lack independent review**. Task 16's reviewer prompt (see §5) includes a PART A audit for exactly this.
- One flagged edge case never fully explored: **negative-year behavior when non-reg book > market** (i.e., book/market ratio clamped at 1 — check whether a declining-market scenario can realize negative gains or produce a negative book). The ACB module code and its tests are in `nonreg.ts` and `tests/accounts/nonreg.test.ts`.

## 4. Conventions you must not break

All in `docs/assumptions.md`; the load-bearing ones:

1. Money in CAD, real (today's) dollars; `roundCent` at storage boundaries.
2. `tfsaRoomNextYear` takes **post-contribution** room; seed = `cumulativeRoomAsOf2026`.
3. Mortgage rate = **nominal compounded monthly**; negative-amortization warning is emitted by the **stepper**.
4. `mortgage-prepay` savings step is **terminal** — leftover surplus after it rests as cash.
5. Non-reg ACB: growth adds the blended dollar gain to **both** market and book; draws deliver net of their own chunk tax, which folds into reported tax.
6. Prior-year realized non-reg gains count as GIS income.
7. Determinism: randomness only via injected `seededRandom` (mulberry32).
8. Commits: conventional (`feat:`, `fix:`, `test:`, `docs:`), one commit per task, tests green before each commit.
9. Golden pins must always match: run the golden test before refactoring `simulate.ts`.

## 5. Immediate next actions (in order)

1. **Restart the fleet** (both panes died — see §6 for exact commands) and re-dispatch the reviewer with the lost run's prompt:
   - PART A: independently review dd2aa6c / 7fc1ba9 / 87fc0ed (flows, ACB wiring, golden) — tests, arithmetic, ledger conservation, plus the book>market edge case.
   - PART B: execute plan Task 16 as written (external cross-check, two files, one commit).
2. **Process findings**: fix BLOCKER/MAJOR immediately (captain native if the fleet is quota-blocked); log MINORs in the plan.
3. When Task 16 lands and PART A comes back clean, **Phase 1 is complete**.
4. **Write the Phase 2 plan** in this folder (`docs/superpowers/plans/2026-11-09-web-ui.md` would be the natural name): UI per spec sections 6–8 — plan data entry, projection year table + charts, scenario comparison (side-by-side), IndexedDB persistence, JSON export/import, assumptions view. Apps live at `apps/web` (Vite + React + TS). Engage the brainstorming + writing-plans skills before writing it.
5. Phase 2 execution: builder (implement, test) + reviewer (independent audit) loop as before.
6. Phase 3 (queue, do not start yet): Monte Carlo UX (percentiles, heatmap), CSV/print export — spec §9. Fast-follows: historical backtest dataset, dividend gross-up, GIS earnings disregard.

## 6. Fleet operations cheat-sheet (herdr)

Recreate panes (both were lost at handoff):

```sh
herdr pane split --current --direction right --cwd "$PWD" --no-focus   # → w1:pA (builder)
herdr pane split --pane w1:p1 --direction down --cwd "$PWD" --no-focus # → w1:pB (reviewer)
herdr agent start builder --kind opencode --pane w1:pA
herdr agent start reviewer --kind opencode --pane w1:pB
```

Prompt/wait: `herdr agent prompt <name> "<msg>" --wait --timeout 2700000` (CLI wait can time out before the status flips — if it errors with `timed out waiting for agent status`, check `herdr agent get <name>`; if `working`, follow with `herdr agent wait <name>`). Read replies with `herdr pane read <pane> --source visible --lines N`.

Blocked-state playbook:

- If agents show `blocked` and panes show **"You've used today's free messages. They reset at 7:19 PM"**: it's the free-tier quota. You cannot dismiss the overlay with `esc` reliably; the fix that worked is to **close and recreate the panes** (commands above) after the reset time. If blocked before reset: implement natively as captain, log the work, and queue the review.
- `herdr agent explain <name>` is vague on quota blocks (says `rule: none`); trust the pane text over the explain output.
- Agents always confirm their model id (`GLM-5.3-Flash Free`) in replies — if one isn't on a free model, stop and re-check `opencode.json`.

## 7. Known frictions

- `npm test -w packages/engine` **must** run from the repo root.
- `opencode` TUI here does not accept `--model`; only config-file pinning works, and `OPENCODE_CONFIG` env does NOT stick.
- The engine's `tsconfig` uses `noUncheckedIndexedAccess` — index access needs `!` in tests; the golden test was already fixed for this.
- The builder left an unfinished stub once (Task 13's last test was `void 0;`) — when resuming agent-written TDD files, check for stub tests before running.

## 8. Golden pins quick reference

Year 1 (age 45, age 45 employment 95k): federal 13,157.59 / ON basic 5,827.02 + surtax 1.80 / total **18,986.41**; mortgage end **342,435.13**; TFSA draw 2,146.41 → end 60,167.73; RRSP 187,200.00; non-reg 41,600.00; home 714,000.00; net worth **660,532.60**. If any of these drifts, reconcile line by line — never adjust pins silently.

Good luck. The engine is in excellent shape — protect its invariants, get Task 16 done, and the fun (Phase 2 UI) awaits.
