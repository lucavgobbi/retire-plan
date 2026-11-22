# RetirePlan

A local Canadian retirement planning app for Ontario, with a deterministic TypeScript engine and a React web interface. The app includes plan editing, year-by-year projections, charts, scenario comparisons, and the modeling assumptions.

## Run locally

Use Node **20.19+ on the 20.x line**, **22.13+ on the 22.x line**, or **24+**, with npm. Run commands from the repository root:

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

The root runs ESLint across both workspaces, their tests, and the repository's JavaScript and TypeScript tooling. Prettier processes supported files tracked by Git, including files staged for addition. It skips the generated npm lockfile and historical returns dataset.

```sh
npm run lint          # Report lint violations
npm run lint:fix      # Apply ESLint's automatic fixes
npm run format        # Format tracked files
npm run format:check  # Check formatting
```

GitHub Actions runs lint and formatting checks before building the Pages deployment.

The Python historical data extractor is formatted separately. To check or apply its formatting locally, use Ruff through `uvx`.

```sh
uvx ruff@0.17.6 format --isolated --check packages/engine/data/historical/extract-usa-returns.py
uvx ruff@0.17.6 format --isolated packages/engine/data/historical/extract-usa-returns.py
```

Run the test suites, typechecks, and production build from the root.

```sh
npm test -w packages/engine
npm test -w apps/web
npm run typecheck -w packages/engine
npm run typecheck -w apps/web
npm run build -w apps/web
```

The root `npm test` runs the engine suite only. Tooling uses Vitest **4.1.12** and Vite **6.4.6**. Current verification covers **288 engine tests**, **428 web tests**, both typechecks, and the production build. See the [web review](docs/validation/web-review.md) for the earlier Safari smoke check covering launch, run, projection, compare, and reload. That check did not exercise browser JSON file actions. The completed status is tracked in the [Phase 2 progress ledger](docs/superpowers/plans/2026-11-10-web-ui.md#8-progress-status).

## Scope and assumptions

The engine uses 2026 tax parameters and documented future-year assumptions. Optional employee CPP, CPP2, and EI payroll deductions model one Ontario employer per year and default to off. Ontario health premiums remain outside the model. [Modeling assumptions](docs/assumptions.md) · [External cross-check and limitations](docs/validation/cross-check.md)

Phase 1 validation and Phase 2 implementation/verification are complete in the working tree. Monte Carlo and historical UI, CSV/print/PDF exports, per-year overrides, and multi-plan management remain queued for Phase 3. Current closeout changes are uncommitted.
