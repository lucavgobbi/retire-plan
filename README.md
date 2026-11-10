# BudgetTool

A local Canadian retirement planning app for Ontario, with a deterministic TypeScript engine and a React web interface. The app includes plan editing, year-by-year projections, charts, scenario comparisons, and the modeling assumptions.

## Run locally

Use Node **20, 22, or 24+** and npm (verification used Node **24.5.0**). Run commands from the repository root:

```sh
npm install
npm run dev -w apps/web
```

Open the local URL printed by Vite. A new workspace starts with the sample plan. Edit the plan and working scenario settings, run the deterministic projection, create scenario overrides in Scenarios, and inspect saved runs in Compare.

## Save and move a workspace

Changes autosave to IndexedDB on the current browser/device. **Export JSON** downloads a versioned workspace, including plan fields, scenario deltas, and working settings. Keep exports when moving between browsers or devices.

**Import JSON** validates the file and presents a preview before replacement. Confirming replacement saves a backup first; **Restore previous** returns to that backup. The app retains up to three backups. This version imports one plan per workspace file.

If saved data cannot be read, the recovery screen keeps it in place and offers a raw JSON download, a valid backup when available, or the sample plan. If browser storage is unavailable, **Continue without local saving** opens a session without persistence.

## Verify

```sh
npm test -w packages/engine
npm test -w apps/web
npx tsc --noEmit -p packages/engine
npm run typecheck -w apps/web
npm run build -w apps/web
```

The root `npm test` runs the engine suite only. Tooling uses Vitest **4.1.12** and Vite **6.4.6**. Current verification: **187 engine tests** and **155 web tests** pass; both typechecks and the production build pass. Scoped Safari smoke (launch, run, projection, compare, reload) also passes; browser JSON file actions were not exercised. See the [web review](docs/validation/web-review.md). Final cosmetic tests, web typecheck, and production build also passed. The completed status is tracked in the [Phase 2 progress ledger](docs/superpowers/plans/2026-11-10-web-ui.md#8-progress-status).

## Scope and assumptions

Read [modeling assumptions](docs/assumptions.md) and the [external cross-check, limitations, and source references](docs/validation/cross-check.md) before interpreting a projection. The app uses 2026 tax parameters and documented future-year conventions. Ontario health premiums, CPP/EI payroll contributions, and other listed simplifications remain outside the current model.

Phase 1 validation and Phase 2 implementation/verification are complete in the working tree. Monte Carlo and historical UI, CSV/print/PDF exports, per-year overrides, and multi-plan management remain queued for Phase 3. Current closeout changes are uncommitted.
