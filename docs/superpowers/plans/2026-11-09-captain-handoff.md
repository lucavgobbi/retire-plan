# Captain Handoff — BudgetTool (Phase 1 → Phase 2)

> Written 2026-11-09 by the retiring oh-my-captain. Addressed to the next oh-my-captain taking over the session. Read this top-to-bottom before touching anything.

## 1. What this project is

A private, browser-based Canadian (Ontario) retirement planning/budget tool. Design → spec → plan → agent-fleet implementation; the captain coordinates a herdr-managed fleet of opencode agents on **free models only** (no paid subscription). The repo's `opencode.json` pins every session to `opencode/glm-5.3-flash-free`.

- **Master spec:** `docs/superpowers/specs/2026-11-08-budget-tool-design.md` — authoritative for intent.
- **Phase 1 plan:** `docs/superpowers/plans/2026-11-08-engine-core.md` — authoritative for Phase 1 decisions. It now contains a **Progress Status table (2026-11-09)** listing every task, its commit, and its completion ledger. Read that first.
- **Modeling conventions:** `docs/assumptions.md` — every v1 simplification with reasoning. Keep it in sync with the engine; if engine behavior changes, update this file in the same commit.

## 2. Repo state at handoff (2026-11-10 closeout)

- Phase 1 implementation and Task 16 review resolutions are complete. **187 engine tests / 18 files pass under Vitest 4.1.12**; engine typecheck is clean.
- Phase 2 Tasks 1–10 are complete in `apps/web`; the full web suite passes **155 tests / 24 files**, with production build and web typecheck clean. Scoped Safari browser smoke passes (launch/run/projection/compare/reload); JSON actions are covered by integration tests rather than this browser run. The final cosmetic sample-banner adjustment passed 6/6 targeted tests, with web typecheck and production build rerun clean. The Phase 2 plan tracks final verification.
- Current engine fixes, validation artifacts, web app, tooling updates, and closeout docs remain **uncommitted**. The git metadata approval was canceled; no new commit SHA is claimed. Do not stage unrelated files.
- The golden year-1 hand-derived reference and its existing tolerances remain unchanged. Actual engine net worth is 660,532.49 versus the 660,532.60 reference (±0.50 tolerance). Later years reconcile against the independently indexed reference in `packages/engine/tests/golden/reference.ts`.
- Tooling: Vite **6.4.6**, Vitest **4.1.12**; dependency audit reports **0 vulnerabilities**. Node 20, 22, or 24+ is supported by the current test runner; closeout runs used Node **24.5.0**. See the root README for commands and the app workflow.

### Phase 1 closeout: resolved

Task 16 artifacts are `docs/validation/cross-check.md` and `packages/engine/tests/validation/crosscheck.test.ts`. The review findings are resolved, including RRIF factors, per-year tax indexation, the OAS recovery cap, and the statutory fixed pension income amount. The reference independently implements published official formulas; no interactive government-calculator run is claimed. The engine validation gate is cleared. Repository commit closeout remains pending separately.

## 3. Review status

Tasks 13–15 (`dd2aa6c`, `7fc1ba9`, `faf41ef`, `87fc0ed`) have now received independent review and approval after fixes. Findings and resolutions are recorded in `docs/validation/engine-review.md`. The book-above-market loss case, negative returns, missing account targets, surplus conservation, taxable non-reg draws, and OAS recovery cap all have regressions.

## 4. Conventions you must not break

All in `docs/assumptions.md`; the load-bearing ones:

1. Money in CAD, real (today's) dollars; `roundCent` at storage boundaries.
2. `tfsaRoomNextYear` takes **post-contribution** room; seed = `cumulativeRoomAsOf2026`.
3. Mortgage rate = **nominal compounded monthly**; negative-amortization warning is emitted by the **stepper**.
4. `mortgage-prepay` savings step is **terminal** — leftover surplus after it rests as cash.
5. Non-reg ACB: optional `bookValue` seeds current basis (defaults to market); withdrawals can realize gains or losses and deliver net of their gains tax.
6. Prior-year positive non-reg gains count as GIS income; losses are not GIS deductions, and OAS is excluded.
7. Determinism: randomness only via injected `seededRandom` (mulberry32).
8. Commits: conventional (`feat:`, `fix:`, `test:`, `docs:`), one commit per task, tests green before each commit.
9. Golden pins must always match: run the golden test before refactoring `simulate.ts`.

## 5. Immediate next actions (in order)

1. Phase 2 is complete in the working tree: combined suite, final cosmetic tests, production build, typechecks, and scoped Safari browser smoke pass. See `docs/validation/web-review.md` for the exact browser scope.
2. Keep the engine suite and both package typechecks green. The source implementation and review fixes are already in the working tree.
3. Leave current changes uncommitted unless repository metadata access is authorized; the earlier approval was canceled. Preserve clear task ownership if preparing later commits.
4. Phase 3 remains queued: Monte Carlo UX (percentiles, heatmap), historical data/mode, CSV and print/PDF exports, per-year overrides, and multi-plan management. Engine fast-follows remain documented in the assumptions and validation reports.

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

Year 1 (age 45, age 45 employment 95k): federal 13,157.59 / ON basic 5,827.02 + surtax 1.80 / total **18,986.41**; mortgage end **342,435.13**; TFSA draw 2,146.41 → end 60,167.73; RRSP 187,200.00; non-reg 41,600.00; home 714,000.00; net worth **660,532.60**. These are hand-derived references, not all cent-exact engine outputs: actual mortgage balance is **342,435.24** and net worth is **660,532.49**, within the source golden test's existing **±0.50** tolerance. Preserve that reference/tolerance and reconcile any drift line by line rather than changing pins silently.

Phase 1 is validated and the Phase 2 app is implemented. Preserve the engine invariants, complete the recorded integration/browser verification, and leave Phase 3 queued.
