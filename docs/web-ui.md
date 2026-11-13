# RetirePlan web UI

From the repository root, install dependencies and start the local app:

```sh
npm install --cache .npm-cache
npm run dev -w @retire-plan/web
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

Open **Settings** (gear icon in the header) to set the plan file (export/import JSON), retirement age, base return assumptions,
withdrawal order, benefit choices, and withdrawal strategy. These settings persist with the workspace and JSON backup.
Scenarios inherit base settings unless they have an explicit override; scenario editors can reset benefit and strategy choices
to the base settings. Older saved scenarios without these fields retain the legacy behavior: configured benefits are enabled
and withdrawals use the manual account order.

CPP and OAS switches include or exclude configured income streams. Their amounts and start/end ages are entered under Plan →
Incomes; switches do not create benefit amounts. GIS is modeled by the engine and its control is disabled when OAS is off,
consistent with the [Service Canada eligibility conditions](https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/guaranteed-income-supplement/eligibility.html).
The model uses simplified GIS assumptions, documented in the assumptions registry.

**Tax-minimizing planning** selects a bounded proactive RRSP withdrawal policy intended to reduce total modeled income tax
through the plan's end age, excluding estate taxes. Required RRIF minimums and spending needs remain part of the projection.
Results compare the planned policy with manual account order for total tax, net worth, success, and modeled GIS. This is a
heuristic, not a global optimum. For Monte Carlo and historical runs, the policy is planned once under deterministic assumptions
and reused across paths; actual taxes, net worth, and benefits can differ by path.
The planner only selects candidates that meet retirement success and have finite, zero shortfall in every modeled year,
including pre-retirement years. If none does, it retains the manual order and reports that no fully funded tested policy
was found. If the manual baseline is not fully funded but a candidate is, the selected plan's
tax can exceed the failed baseline; the comparison calls out that difference.
In years with a planned proactive draw, employee RRSP savings-policy steps are skipped to avoid withdrawing and redepositing
the same funds; employer-match RRSP deposits and other savings rules can still apply, and remaining surplus follows those rules
or is retained as cash. If manual order is infeasible but the selected policy succeeds, their tax totals are not an apples-to-apples
tax-saving comparison.

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

Applied changes autosave after 800 ms to IndexedDB database `retire-plan` (layout
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

Deterministic, Monte Carlo, and historical projections are supported. Monte Carlo settings
include run count, seed, and annual standard deviations; the results show success
probability and final-wealth percentiles separately from one coherent seeded path
used for the charts and year table. Historical mode replays complete rolling windows
of the JST R.6 USA equity/bond/bill series (1872–2020); the selected year is the
earliest source-window start. U.S. return rates are measured in nominal USD and
applied as a non-Canadian proxy; no CAD/USD conversion or currency-return effects
are modeled. Existing Canadian/Ontario tax and benefit assumptions remain in effect.
Historical results show ensemble success
probability and final-wealth percentiles, plus one coherent actual window nearest the
median final net worth; percentile values are never combined into a synthetic annual
path. Source years map to plan ages, while household tax/calendar years continue to
use the birth year. The bundled dataset is CC BY-NC-SA 4.0 and restricted to
noncommercial use; `packages/engine/data/historical/` includes attribution, license,
coverage/method notes, and a reproducible extraction script. CSV/print-file export is
also deferred; ordinary browser printing uses the projection's print stylesheet.
The engine owns all financial arithmetic; the UI formats results and compares
snapshots.
