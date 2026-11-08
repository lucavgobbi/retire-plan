# BudgetTool — Design Spec

**Date:** 2026-11-08
**Status:** Approved design, pending implementation plan
**Classification:** Architectural (new project)

## 1. Purpose

A private, browser-based financial planning and retirement-scenario tool for a single
Canadian resident (Ontario, v1). It is a **planning** tool, not a tracking tool: the user
enters their financial life (investments, assets, debts, income, expenses, savings policy)
and projects it forward year by year under configurable retirement scenarios.

**Success criteria:**

- Year-by-year projections that a knowledgeable user can trace line by line (every number
  auditable via the per-year `events` log and detailed table).
- Correctly models the Canadian-specific mechanisms that decide retirement feasibility:
  indexed federal/Ontario tax brackets (incl. Ontario surtax), RRIF minimum withdrawals,
  OAS clawback, GIS taper, TFSA room recharge, RRSP room accrual.
- Three simulation modes sharing one engine: deterministic, Monte Carlo, historical backtest.
- Side-by-side scenario comparison.
- All data stored locally; nothing leaves the user's machine.

**Non-goals (v1):** account linking/bank feeds, multi-user/auth, pension income splitting
(single taxpayer), Quebec/other provinces (the engine supports adding them, tables ship per
province), dividend gross-up/dividend tax credit modeling (default off in v1, fast-follow,
documented as a known simplification), productization for other users.

## 2. Architecture

Monorepo with an engine/UI split. The one architectural rule: **`packages/engine` never
touches the DOM, network, or storage.**

```
BudgetTool/
├── packages/engine/        # Pure TypeScript simulation engine (no UI, no I/O)
│   ├── src/
│   │   ├── simulate.ts     # year-stepper: (Plan, Scenario, ReturnSeries) → YearResult[]
│   │   ├── tax/            # federal + ON brackets, surtax, clawback, RRIF, credits
│   │   ├── benefits/       # CPP/OAS/GIS timing + amounts + GIS taper
│   │   ├── accounts/       # TFSA/RRSP/non-reg growth, room tracking, withdrawals
│   │   ├── mortgage/       # amortization
│   │   └── returns/        # deterministic / Monte Carlo / historical series builders
│   └── tests/              # golden tests, hand-computed tax cases, property tests
├── apps/web/               # Vite + React UI (charts, forms, scenario runner)
└── data/                   # JSON tax tables (2026 federal/ON), MC/historical datasets
```

- **Tech:** Vite + React + TypeScript; charting library (Recharts or equivalent); Tailwind-classed
  plain components (no heavy UI kit). Vitest for tests across both packages.
- **Persistence:** plans/scenarios in **IndexedDB**; **JSON export/import** (one file per plan
  workspace) as the backup/restore story. No server, no accounts.
- **Scenarios as deltas:** a scenario stores overrides against a base plan (retirement age,
  return assumptions, withdrawal order, per-year overrides), making dozens of scenarios cheap
  and comparison natural.
- **Future-proofing:** because the engine is I/O-free, a CLI, desktop wrapper, or server can
  reuse it unchanged.

## 3. Data model

```ts
Plan {
  profile:        { birthYear, retirementGoalAge, province: "ON", endAge }
  accounts:       [ { id, type: "tfsa"|"rrsp"|"nonreg", balance,
                      assetMix: { equity, bond, cash }, growthRate? } ]
  assets:         [ { id, name, kind: "primary-home"|"other", value, appreciationRate,
                      sellEvent?: { age, taxImpact } } ]
  debts:          [ { id, kind: "mortgage", balance, rate, termYears, amortizationYears,
                      payment } ]
  incomes:        [ { id, kind: "employment"|"cpp"|"oas"|"other"|"gis-eligible",
                      annualAmount, startAge, endAge, raiseRate, indexed } ]
  expenses:       [ { id, name, annualAmount, startAge, endAge, inflationRate } ]
  savingsPolicy:  [ { id, priority, target: "rrsp-match"|"rrsp"|"tfsa"|"nonreg"|"mortgage-prepay",
                      cap?: { perYear, untilAge } } ]
}

Scenario {
  id, name, basePlanId,
  overrides: { retirementAge?, returnAssumptions?, withdrawalOrder?, perYearOverrides? },
  simMode: "deterministic" | "montecarlo" | "historical",
  mcConfig?: { runs, returnStdDev, inflationStdDev },
}

YearResult {
  age, year,
  income: { employment, cpp, oas, gis, other },
  taxableIncome,
  tax: { federal, provincial, oasClawback, total, marginalRate },
  withdrawals: { tfsa, rrsp, nonreg },
  contributions: { tfsa, rrsp, nonreg },
  savings: { toTfsa, toRrsp, toNonreg, toMortgage },
  expensesAfterTax, shortfall?,
  balances: { tfsa, rrsp, nonreg, home, debt },
  netWorth, tfsaRoom, rrspRoom,
  events: string[],   // human-readable trace: "retired", "CPP started", "house sold", warnings
}

PlanFile {           // serialized workspace
  schemaVersion,     // migrations on load
  plans: [{ meta, plan }], scenarios: [Scenario], runs: [cached results (optional)]
}
```

**Key modeling decisions baked in:**

- **TFSA room recharge** — TFSA withdrawals in year N restore contribution room in year N+1.
- **RRSP room** — cumulative accrual per CRA rules (18% of earned income, to the annual cap),
  tracked per year; `rrsp-match` target honors employer matching before other priorities.
- **Mortgage** — payment flows through cash flow; balance amortizes at stated rate/term.
- **Events array per year** — the audit trail; every impactful decision or warning is recorded.
- **Plan schema versioning** — migrations run on load so old exports always open.

## 4. Simulation engine

One pure function runs age-by-age (to the plan's `endAge`, default 100):

1. **Apply events** — retirement at scenario `retirementAge`, CPP/OAS start at claiming ages,
   house sale, contribution unlocks.
2. **Income** — employment (with raises), pension income; CPP/OAS entered manually (from
   Service Canada statements, at their legislated indexing mode); GIS eligibility evaluated.
3. **Expenses** — each item inflated at its own per-item rate.
4. **Net cash flow** — income − expenses − mortgage payment.
5. **Allocate / withdraw:**
   - Surplus → `savingsPolicy` priorities in order, gated by cumulative RRSP/TFSA room.
   - Deficit → withdraw in default order **TFSA → non-reg → RRSP/RRIF** unless overridden;
     RRSP withdrawals respect the **RRIF minimum schedule** from age 71.
   - Underfunded year → record `shortfall`; running out of money is a first-class outcome.
6. **Grow accounts** — per-account asset mix × the year's return from the `ReturnSeries`
   (real, after-inflation returns).
7. **Tax engine** — one call with the year's income + withdrawals + realized gains.
8. **Record `YearResult`** including events/warnings.

**Return series sources (three sim modes, same stepper):**

- **Deterministic** — constant real returns from scenario assumptions (presets, e.g.
  5% equity / 2% bond / 0% cash real).
- **Monte Carlo** — per-run random annual return sequences from mean/stdDev per asset class
  (default 1,000 runs); aggregates into success rate and percentile net-worth bands (P10/50/90),
  plus a retire-age × spending-level heatmap of success percentages.
- **Historical** — rolling 30/40-year windows from a bundled real-return dataset (Canada/US
  equities, bonds, inflation). If data sourcing proves problematic this becomes a fast-follow;
  the engine slot already exists.

## 5. Canadian tax engine (Ontario v1)

CRA parameters live in versioned JSON tables (`data/tax/on-2026.json`); the engine hardcodes
no rates. Each tax year is a new table file.

- Federal + Ontario brackets, both indexed (different indexation bases).
- **Ontario surtax** on high-bracket income (modeled explicitly).
- Non-refundable credits: basic personal, CPP, OAS, age amount (65+), pension income credit,
  employment amount, etc.
- **OAS clawback** (recovery tax, 15% of net income above the indexed threshold).
- **GIS** — income-tested 50% taper with correct GIS income definitions: RRSP withdrawals
  count, TFSA withdrawals don't.
- Taxable income composition: employment/pension/RRIF income at face value; **capital gains
  at 50% inclusion**; non-registered asset sales via **ACB tracking**.
- **Known v1 simplification (documented in the Assumptions view and fast-follow):** Canadian
  dividends modeled without gross-up/credit (non-reg dividend treatment approximated);
  estate/probate beyond will-amounts not modeled; GIS earnings disregard (employment
  income while collecting GIS) approximated.

Goal framing: trustworthy **relative** comparisons between scenarios with the big
Canadian-specific traps (clawback, GIS cliffs, forced RRIF minimums, surtax) modeled correctly,
plus an always-visible registry of what is exact vs. approximated.

## 6. UI

Views (single SPA, boring-on-purpose, dense and printable):

1. **Plan** — tabbed data entry: Accounts / Assets & Debts / Income / Expenses / Savings
   Policy; inline plain-language validation.
2. **Projection** — year-by-year detail table + dashboard charts (net worth, income vs.
   spending bands, tax stacked by federal/provincial/clawback, account drawdown).
3. **Scenarios** — create/run scenarios, Monte Carlo results (success %, percentile bands,
   heatmap).
4. **Compare** — select 2+ runs → overlaid charts + deltas table → CSV export.
5. **Assumptions** — the human-readable registry of every modeling decision and
   simplification, versioned with the tax tables.

Also: print-friendly CSS for the year table; a "plan fails at age N" banner for unaffordable
scenarios (never a NaN chart).

## 7. Testing & error handling

**Testing:**

- **Golden tax tests** — hand-verified cases: 2026 bracket boundaries (federal and ON),
  Ontario surtax steps, OAS clawback exact threshold, GIS taper with RRSP vs. TFSA withdrawal,
  RRIF minimums at 72+, marginal rates at each boundary, credit phase-outs.
- **Property/invariant tests** — per simulated year: net-worth change = income − spending −
  taxes (within capital-gains accounting); no negative balances; no negative room.
- **Golden projection snapshot** — one scripted sample plan with pinned expected output;
  engine changes altering it force conscious (reviewed) updates.
- **External cross-check** — one fixed scenario validated against CRA/Government of Canada
  calculators and known published figures.
- Light UI integration tests; engine is the deep-coverage target.

**Error handling:**

- Simulation never throws silently: each year always produces a result plus **warnings**
  (deficit funded from principal, account exhausted at year N, mortgage payment can't cover
  interest, expenses continue with no income sources).
- Input validation with plain-language messages at the form layer.
- Schema versioning + migrations on plan load.
- Monte Carlo outputs always defined (a failed run is still a data point).

## 8. Phasing

1. **Phase 1 — Engine core:** data model, deterministic stepper, Ontario/Federal 2026 tax
   engine, TFSA/RRSP room tracking, mortgage amortization, golden + property tests.
2. **Phase 2 — UI v1:** Plan data entry, Projection table + charts, scenario runner,
   deterministic mode end-to-end, IndexedDB persistence + JSON export/import.
3. **Phase 3 — Analysis depth:** Monte Carlo (success %, bands, heatmap), Compare view with
   deltas, CSV/print export, Assumptions view.
4. **Phase 4 — Fast-follows:** historical backtest dataset (if v1 slot unused), dividend
   gross-up/credit, GIS earnings disregard precision, additional provinces.
