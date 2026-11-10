# BudgetTool web UI

From the repository root, install dependencies and start the local app:

```sh
npm install --cache .npm-cache
npm run dev -w @budgettool/web
```

Open the loopback URL printed by Vite, normally `http://127.0.0.1:5173/`.
The application has no server account or external data service. Plan data stays in
the browser on this device. Different browser profiles and origins have separate
local workspaces.

## Working with a plan

The first launch opens the golden sample plan. On **Plan**, edit the profile,
accounts, assets and debts, income, expenses, and savings policy. Account rows
apply valid edits automatically; Add account creates a valid starting row ready
to edit. Other editors use their Save/Add buttons. Invalid values remain in the editor
with an explanation and do not become a projection input. Ages and years are whole
numbers; asset mixes must total 100%. Non-registered accounts optionally accept
cost basis (ACB); blank leaves the engine's default intact.

Enter the birth year; current age is calculated as the current calendar year minus
birth year. It represents the age reached during that year because the app does
not collect a birthday. Age is refreshed when opening or importing a workspace.
Draft edits are marked until applied; the separate local save indicator confirms
when the latest applied workspace has actually finished saving on this device.
If an account has an invalid partial edit (for example, its mix temporarily does
not total 100%), its last valid values stay in the plan until the errors are fixed.

Expand **Base projection settings** to set retirement age, real return assumptions,
and withdrawal order. These settings persist with the workspace and JSON backup.
Scenarios inherit base settings where no override is stored.

On **Projection**, press **Run projection** to create a result snapshot. The four
charts summarize net worth, income and spending, tax, and account balances. The
year table includes uninvested cash and other assets; expand an age for its events,
warnings, and detailed amounts. A failed plan still displays every projected year.
After changing inputs, results are marked stale until explicitly run again.
Running from Plan or Scenarios opens Projection and focuses the new run's year
table. Charts resize with the view; the wide audit table scrolls inside its region.

On **Scenarios**, create named variations and run them. **Compare** selects stored
runs and an optional baseline to show differences and net-worth curves. Up to 20
run snapshots are kept during the current session; inputs and scenarios persist,
but cached runs do not survive reload. **Assumptions** provides a searchable copy
of the engine's documented conventions and known simplifications.

## Saving, backup, and recovery

Applied changes autosave after 800 ms to IndexedDB database `budgettool` (layout
version 1). The live workspace and up to three recovery backups use separate
object stores. The save indicator reports success or errors. There is no cloud
sync; export a JSON backup to move or retain a workspace outside this browser.
The persisted metadata timestamp updates on save; metadata shown in an open
session retains its loaded timestamp until the workspace is reopened.

**Export JSON** downloads a versioned workspace file. **Import JSON** validates the
file and shows a preview before **Replace workspace**. Replacement saves a backup
first and offers **Restore previous**. Invalid and newer-version files do not
replace the current workspace; their original text remains available for
inspection and copying.

An unreadable saved row opens a recovery screen. Restore an available backup,
download the untouched raw data, or start with the sample plan after making a
backup. Storage failures can be handled with an explicitly selected session-only
workspace. Clearing the browser's site data removes local plans and backups.

## Checks and current scope

```sh
npm test -w packages/engine
npm test -w apps/web
npm run typecheck -w packages/engine
npm run typecheck -w apps/web
npm run build -w apps/web
```

Phase 2 supports deterministic projections. Monte Carlo and historical mode
options are disabled for Phase 3. CSV/print-file export is also deferred; ordinary
browser printing uses the projection's print stylesheet. The engine owns all
financial arithmetic; the UI formats results and compares snapshots.
