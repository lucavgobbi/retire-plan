# BudgetTool — Phase 1: Engine Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure, fully-tested TypeScript simulation engine: deterministic year-stepper, Ontario/Federal 2026 tax engine, Canadian account rules (TFSA/RRSP room, RRIF minimums), mortgage amortization, and the Monte Carlo runner — no UI.

**Architecture:** Monorepo `packages/engine` (pure TS, zero runtime deps) + data JSON tables. One law: the engine never touches DOM/network/storage. `simulate(plan, scenario, returns)` is deterministic; Monte Carlo feeds it generated return series. Silver-dollar simplicity: the stepper is closed over its inputs; identical inputs always yield identical outputs.

**Tech Stack:** TypeScript (strict), Vitest, npm workspaces, Node >= 20.

**Spec:** `docs/superpowers/specs/2026-11-08-budget-tool-design.md` (read both; the spec is authoritative for intent, this plan for decisions).

## Global Constraints

- TypeScript `strict: true`; **no `any` in exported interfaces**.
- `packages/engine` has **zero runtime dependencies** (only `typescript`/`vitest` as devDeps). JSON tables imported via `resolveJsonModule`.
- **Node >= 20**, npm workspaces; scripts runnable as `npm test -w packages/engine`.
- **Determinism:** all randomness enters via an injected rand function `(seed) => () => [0,1)`; no `Math.random` outside a documented `seededRandom` helper.
- Money is plain numbers in CAD; round at storage boundaries with `roundCent(x) = Math.round(x * 100) / 100`.
- All CRA parameters come from JSON tables; **no tax rate, threshold, or limit hardcoded in `.ts`**.
- Amounts are **real (today's) dollars**; per-item inflation applies explicitly.
- Every task ends with all tests green and one commit.
- Commit messages: `feat:`, `test:`, `fix:`, `docs:` conventional style.

## Review Focus

The five failure modes the spec implies but individual task tests may not reach:

1. **TFSA withdrawals during GIS-eligible years must not reduce GIS** — TFSA money is invisible to GIS income tests. Test lives in Task 7 (GIS).
2. **Ontario high-income surtax double-ladder** — a first-year high earner expects surtax on the *excess* base only; missteps produce cliff artifacts. Test lives in Task 5.
3. **A plan that runs out of money** — later years must show `shortfall` and keep sensible balances, never NaN or a thrown error. Test lives in Task 12.
4. **Federal vs Ontario indexation drift over decades** — a 40-year projection must not fuse federal and provincial thresholds; per-table index factors apply separately every year. Test lives in Task 3.
5. **Mortgage payment insufficient to cover interest after a rate shock** — the balance must *rise* and a warning event is emitted; amortization never returns `undefined`. Test lives in Task 10.

---
### Task 1: Workspace scaffold

**Files:**
- `package.json` (root; `workspaces: ["packages/*"]`)
- `.gitignore` (node_modules, dist, *.tsbuildinfo)
- `packages/engine/package.json` — name `@budgettool/engine`, type module, exports `./src/index.ts`
- `packages/engine/tsconfig.json` — strict, ES2022 target, `resolveJsonModule: true`, `typedConfigPath` for tests
- `packages/engine/vitest.config.ts`
- `packages/engine/src/index.ts` (empty export placeholder)
- Test: `packages/engine/tests/smoke.test.ts`

**Interfaces:**
- Produces: npm script `npm test -w packages/engine` that runs Vitest.

- [ ] **Step 1: Write `packages/engine/tests/smoke.test.ts`** — a single test that imports from `../src/index` and asserts the module object exists.
- [ ] **Step 2:** `npm install` then `npm test -w packages/engine` — expected: **1 passing**.
- [ ] **Step 3: Commit** — `git add -A && git commit -m "feat: scaffold npm workspace with engine package"`

### Task 2: Core domain types

**Files:**
- Create: `packages/engine/src/types.ts`
- Modify: `packages/engine/src/index.ts` (re-export)
- Test: `packages/engine/tests/types.test.ts`

**Interfaces:**
- Produces (everything later depends on these names/fields, copied verbatim):
```ts
export type AccountType = "tfsa" | "rrsp" | "nonreg";
export interface AccountPlan { id: string; type: AccountType; balance: number; assetMix: { equity: number; bond: number; cash: number }; }
export interface AssetPlan { id: string; kind: "primary-home" | "other"; name: string; value: number; appreciationRate: number; sellEvent?: { age: number; costsPct: number }; }
export interface DebtPlan { id: string; kind: "mortgage"; rate: number; termYears: number; amortizationYears: number; balance: number; monthlyPayment: number; }
export interface IncomePlan { id: string; kind: "employment" | "cpp" | "oas" | "other"; annualAmount: number; startAge: number; endAge?: number; raiseRate: number; }
export interface ExpensePlan { id: string; name: string; annualAmount: number; startAge: number; endAge?: number; inflationRate: number; }
export type SavingsTarget = "rrsp-match" | "rrsp" | "tfsa" | "nonreg" | "mortgage-prepay";
export interface SavingsPolicyStep { id: string; priority: number; target: SavingsTarget; perYearCap?: number; untilAge?: number; matchRate?: number; }
export interface Plan { profile: { birthYear: number; currentAge: number; province: "ON"; endAge: number }; accounts: AccountPlan[]; assets: AssetPlan[]; debts: DebtPlan[]; incomes: IncomePlan[]; expenses: ExpensePlan[]; savingsPolicy: SavingsPolicyStep[]; }
export interface ReturnSeries { years: { age: number; equity: number; bond: number; cash: number }[]; }
export interface Scenario { id: string; name: string; simMode: "deterministic" | "montecarlo" | "historical"; retirementAge: number; returnAssumptions: { equity: number; bond: number; cash: number }; withdrawalOrder: AccountType[]; mcConfig?: { runs: number; stdDev: { equity: number; bond: number; cash: number }; seed: number }; }
export interface YearResult { age: number; income: { employment: number; cpp: number; oas: number; gis: number; other: number }; taxableIncome: number; tax: { federal: number; provincial: number; surtax: number; oasClawback: number; total: number; marginalRate: number }; withdrawals: { tfsa: number; rrsp: number; nonreg: number }; contributions: { tfsa: number; rrsp: number; nonreg: number }; savings: { tfsa: number; rrsp: number; nonreg: number; mortgage: number }; expenses: number; shortfall: number; balances: { tfsa: number; rrsp: number; nonreg: number; home: number; debt: number }; netWorth: number; tfsaRoom: number; rrspRoom: number; events: string[]; warnings: string[]; }
export interface SimulationResult { years: YearResult[]; summary: { success: boolean; failureAge?: number; finalNetWorth: number; worstShortfallAge?: number }; }
export function validatePlan(plan: Plan): string[];
```
- `validatePlan` returns an array of plain-language errors (empty = valid): non-positive ages, `endAge <= currentAge`, assetMix components each ≥ 0 and summing to 1 ± 0.001, negative balances, withdrawal targets inconsistent, mortgage balance/payment ≤ 0, incomes ending before start.

- [ ] **Step 1: Write `types.test.ts`** — a minimal valid `Plan` fixture (helper `makePlan()` exported from `tests/fixtures.ts`) validates to `[]`; 5 invalid variations each produce ≥1 error naming the field.
- [ ] **Step 2:** run tests — expected FAIL (not implemented).
- [ ] **Step 3: Implement** both exports.
- [ ] **Step 4:** run tests — expected PASS.
- [ ] **Step 5: Commit** — `feat: core plan/scenario/result types with validation`

### Task 3: Tax tables (2026, verified)

**Files:**
- Create: `packages/engine/data/tax/ca-2026.json`
- Create: `packages/engine/data/tax/SOURCES.md`
- Create: `packages/engine/src/tax/tables.ts`
- Test: `packages/engine/tests/tax/tables.test.ts`

**Interfaces:**
- Produces:
```ts
export interface TaxYearTables { year: number; province: "ON"; federal: { brackets: { threshold: number; rate: number }[]; basicPersonalAmount: number; indexationFactor: number; ageCredit: { amount: number; reductionThreshold: number; reductionRate: number }; employmentCreditAmount: number; pensionIncomeCredit: { amount: number; incomeThreshold: number; reductionRate: number } }; ontario: { brackets: { threshold: number; rate: number }[]; surtax: { rate: number; onTaxOverPctOfTaxable: number }[]; basicPersonalAmount: number; indexationFactor: number }; oas: { annualMax: number; clawbackThreshold: number; recoveryRate: number }; gis: { annualMaxSingle: number; taperRate: number; exclusionEmployment: number }; rrif: { minimumFactors: { age: number; factor: number }[] }; tfsa: { annualLimit: number; cumulativeRoomAsOf2026: number; roomStartAge: number }; rrsp: { incomeRate: number; annualLimit: number } }
export function loadTables(json: unknown): TaxYearTables;
export function applyIndexation(testTables: TaxYearTables, yearOffset: number): TaxYearTables; // multiplies thresholds/limits by each table's indexationFactor^yearOffset; recovery/GIS thresholds and age/pension credit thresholds included; factor itself does NOT compound on the factors
```
- **Schema shape and value sourcing (do not guess):** the implementer MUST verify 2026 values from official sources and record, per field, the URL in `SOURCES.md`: CRA "Canadian income tax rates for individuals" (federal + ON brackets), CRA basic personal amounts page, Government of Canada OAS recovery threshold / GIS tables, CRA RRIF minimum factor table, TFSA annual limit / cumulative room page. RRIF minimum factors are stable published values (age 71 5.28%, 72 5.40%, 73 5.53%, 74 5.67%, 75 5.82%, 76 5.99%, 77 6.17%, 78 6.36%, 79 6.57%, 80 6.79%, 81 7.04%, 82 7.28%, 83 7.55%, 84 7.83%, 85 8.11%, 86 8.42%, 87 8.75%, 88 9.09%, 89 9.55%, 90 10.01%, 91 10.54%, 92 11.11%, 93 11.70%, 94 12.34%, 95+ 20%) — pin these exactly.
- Ontario surtax is two ladders: `20% of ON tax exceeding (20%A × taxable)` and an extra `20% of ON tax exceeding (20%B × taxable)`, netting 36% above tier B. Pinned shape, thresholds from table.
- Test pins monotonic bump-order invariants: brackets sorted ascending with strictly-increasing rates; RRIF factors non-decreasing with age (below the 95 cap); federal/ON thresholds independent (` applyIndexation(testTables, 3)` yields different scaling of the two provinces' tables than one shared number would).
- Also pin: GIS taper 0.5; OAS recovery 0.15; RRSP income rate 0.18; TFSA room recharge (Task 9) not here.

- [ ] **Step 1:** Write `tables.test.ts` with the invariants above using whatever values the loader accepts (schema tests), plus the RUN-at-Task-level invariant tests.
- [ ] **Step 2:** run — expected FAIL.
- [ ] **Step 3:** Research and record values in `ca-2026.json` + `SOURCES.md` (every number gets a URL).
- [ ] **Step 4:** Implement `loadTables` + `applyIndexation`.
- [ ] **Step 5:** run tests — PASS.
- [ ] **Step 6: Commit** — `feat: verified 2026 Ontario/Federal tax tables with source log`

### Task 4: Federal tax computation

**Files:**
- Create: `packages/engine/src/tax/federal.ts`
- Test: `packages/engine/tests/tax/federal.test.ts`

**Interfaces:**
- Consumes: `TaxYearTables`, `applyIndexation` (Task 3).
- Produces:
```ts
export interface IncomeForTax { employmentIncome: number; otherTaxableIncome: number; rrspWithdrawals: number; pensionEligibleIncome: number; capitalGains: number; dividendsEligible: number; /* must be 0 in v1; > 0 is a plan-level error flagged by the stepper */ age: number; }
export function taxableIncome(income: IncomeForTax): number;   // capitalGains × 0.5; dividends assert 0
export function federalTax(income: IncomeForTax, tables: TaxYearTables): { tax: number; taxable: number; credits: number; grossTax: number };
```
- Credit stack inside `federalTax`: lowest-rate bracket rate × (BPA + employment amount + age amount after reduction + pension income credit after reduction + CPP/OAS credits assumed fully consumed in v1) then subtract; tax floor 0.
- Tests: hand-computed zones: below/inside each of at least 3 brackets; zero-income → 0; income under BPA → 0; age credit appears at 65, reduced out at high income; capital gains haircut; **bracket-boundary invariance**: tax at threshold−$1 and +$1 differ by ~rate×$2.

- [ ] **Step 1:** failing tests (independent arithmetic in the test, never importing `federalTax` as the oracle).
- [ ] **Step 2:** run — FAIL. **Step 3:** implement. **Step 4:** run — PASS. **Step 5: Commit** — `feat: federal income tax engine`

### Task 5: Ontario tax + surtax

**Files:**
- Create: `packages/engine/src/tax/ontario.ts`
- Test: `packages/engine/tests/tax/ontario.test.ts`

**Interfaces:**
- Consumes: Task 3 tables, Task 4 `IncomeForTax`/`taxableIncome`.
- Produces:
```ts
export function ontarioTax(income: IncomeForTax, tables: TaxYearTables): { tax: number; surtax: number; total: number; taxable: number };
export function ontarioSurtax(onBase: number, taxable: number, tables: TaxYearTables): number;
```
- Tests: three zones — at basic taxable (no surtax), mid (20% ladder engages), high (36% combined engages); **bracket-straddle case**: onBase crossing a surtax tier produces the correct *marginal* 36% on the spring, verified by $1-straddle comparability like Task 4's invariance test (Review Focus #2).
- [ ] Steps: failing tests → run → implement → run → commit (`feat: Ontario tax engine with surtax`)

### Task 6: OAS clawback

**Files:**
- Create: `packages/engine/src/tax/oasClawback.ts`
- Test: `packages/engine/tests/tax/oasClawback.test.ts`

**Interfaces:**
- Consumes: tables.
- Produces: `export function oasClawback(netIncome: number, tables: TaxYearTables): number;` — `0.15 × max(0, netIncome − threshold)`, with threshold indexed by the **OAS recovery threshold's own factor** (from table `federal.indexationFactor`).
- Tests: zero below threshold; exact at threshold; linear above; high-income example invariant MR = 15%.

- [ ] Steps: failing tests → run → implement → run → commit (`feat: OAS recovery tax (clawback)`)

### Task 7: GIS taper

**Files:**
- Create: `packages/engine/src/benefits/gis.ts`
- Test: `packages/engine/tests/benefits/gis.test.ts`

**Interfaces:**
- Consumes: tables.
- Produces:
```ts
export interface GisIncomeSources { cpp: number; rrspRrifWithdrawals: number; employmentIncome: number; otherTaxableIncome: number; tfsaWithdrawals: number; }
export function gisAnnual(age: number, income: GisIncomeSources, tables: TaxYearTables): number;
```
- GIS income = cpp + rrsp/rrif + otherTaxable + max(0, employment − `exclusionEmployment`); **tfsaWithdrawals excluded entirely** (Review Focus #1).
- Reduction = `taperRate × income`; annual GIS = `annualMaxSingle − reduction`, floor 0; only when age ≥ 65.
- Tests: (a) no other income → full max; (b) RRSP withdrawal eats 50¢ per $1; (c) **TFSA withdrawal leaves GIS untouched**; (d) employment uses the exemption; (e) under 65 → 0.

- [ ] Steps: failing tests → run → implement → run → commit (`feat: GIS with correct income definitions`)

### Task 8: RRIF minimums

**Files:**
- Create: `packages/engine/src/benefits/rrif.ts`
- Test: `packages/engine/tests/benefits/rrif.test.ts`

**Interfaces:**
- Consumes: tables.
- Produces: `export function rrifMinimum(age: number, balance: number, tables: TaxYearTables): { minimum: number; factor: number } | null;` — `null` for age < 71 if not holder of a RRIF earlier, ≥ 71 uses table factor; age ≥ 95 caps at 20%.
- Tests: pins factors at 71, 80, 95; factor × balance exactness; null below 71.

- [ ] Steps: failing tests → run → implement → run → commit (`feat: RRIF minimum withdrawal schedule`)

### Task 9: TFSA & RRSP room tracking

**Files:**
- Create: `packages/engine/src/accounts/rooms.ts`
- Test: `packages/engine/tests/accounts/rooms.test.ts`

**Interfaces:**
- Consumes: tables.
- Produces:
```ts
export interface TfsaRoomState { room: number; currentAge: number; }
export function tfsaRoomNextYear(state: TfsaRoomState, withdrawalsThisYear: number, tables: TaxYearTables, eligibleAge: boolean): number;
// next-year room = room − usedThisYear + (eligibleAge ? annualLimit : 0) + withdrawalsThisYear, floor 0
export function rrspRoomEarn(currentAge: number, earnedIncome: number, carryforward: number, tables: TaxYearTables, employerContributions: number): number;
// new room = carryforward + min(incomeRate × max(0, earnedIncome − employerContributions), annualLimit) ; cap room at annualLimit+carryforward
```
- Tests: no history → TFSA room ramps from `roomStartAge` (`cumulativeRoomAsOf2026` at 2026-covered ages); withdrawal recharges next year; RRSP cap binds; employer match reduces earned room.

- [ ] Steps: failing tests → run → implement → run → commit (`feat: TFSA/RRSP contribution room tracking`)

### Task 10: Mortgage amortization

**Files:**
- Create: `packages/engine/src/mortgage.ts`
- Test: `packages/engine/tests/mortgage.test.ts`

**Interfaces:**
- Produces:
```ts
export interface MortgageYearResult { endBalance: number; interest: number; principalPaid: number; paymentsMade: number; }
export function mortgageYear(m: { balance: number; annualRate: number; monthlyPayment: number }): MortgageYearResult;
```
- Monthly loop: `interest_m = balance_m × rate/12; principal_m = payment − interest_m; endBalance = max(0, balance + interest − payment)`.
- Tests: standard 25-yr, 5% annually-compounded-equivalent → amortization reaches 0 at term end (within tolerance); slow-payment case (payment < interest) → balance grows and Task integrates warning upstream (`mortgageYear` itself returns larger positive endBalance). Review Focus #5 pinned by the slow-payment case.

- [ ] Steps: failing tests → run → implement → run → commit (`feat: mortgage amortization`)

### Task 11: Return series (deterministic + Monte Carlo)

**Files:**
- Create: `packages/engine/src/returns/deterministic.ts`, `packages/engine/src/returns/montecarlo.ts`, `packages/engine/src/returns/seededRandom.ts`
- Test: `packages/engine/tests/returns/*.test.ts`

**Interfaces:**
- Consumes: `ReturnSeries` (Task 2).
- Produces:
```ts
export type Rand = () => number;
export function seededRandom(seed: number): Rand;      // mulberry32; no Math.random anywhere else
export function buildDeterministicReturns(assumptions: Scenario["returnAssumptions"], startAge: number, endAge: number): ReturnSeries; // constant every year
export function generateMonteCarloRun(rand: Rand, assumptions: Scenario["returnAssumptions"], stdDev: Scenario["mcConfig"]["stdDev"], startAge: number, endAge: number): ReturnSeries; // Gaussian via Box–Muller
export function runMonteCarlo(plan: Plan, scenario: Scenario, tables: TaxYearTables): { successRate: number; percentileNetWorth: { p10: number; p50: number; p90: number }; sampleFailureAge: number | null };
```
- `runMonteCarlo` (this task) drives `simulate` (Task 12) `mcConfig.runs` times, each with a fresh seeded series; `success` = final net worth ≥ 0 AND no shortfall after retirement.
- Tests: deterministic constant; seeded reproducibility (`seededRandom(42)` twice → identical series); MC mean ≈ assumption ± tolerance across 200 runs; reproducible with same seed.

- [ ] Steps: failing tests → run → implement → run → commit (`feat: deterministic + MC return series`)

### Task 12: Year stepper

**Files:**
- Create: `packages/engine/src/simulate.ts`
- Test: `packages/engine/tests/simulate.test.ts` (multiple focused cases + one property test)

**Interfaces:**
- Consumes: everything above (exact names: `TaxableIncome`→`taxableIncome`, `federalTax`, `ontarioTax`, `oasClawback`, `gisAnnual`, `rrifMinimum`, `tfsaRoomNextYear`, `rrspRoomEarn`, `mortgageYear`, `buildDeterministicReturns`).
- Produces: `export function simulate(plan: Plan, scenario: Scenario, returns: ReturnSeries): SimulationResult;` — the contract the UI and MC runner use.

**Per-year algorithm (in order):**
1. events: retirement at `scenario.retirementAge`; CPP/OAS per their `startAge`; home sale per `sellEvent.age` (proceeds net of `costsPct` to nonreg with 50% gain inclusion under ACB=100% at sale for v1)…
2. income: employment (raiseRate on balance growth), cpp/oas/expenses inflation perExpense; GIS via Task 7; age ≥ 65 gates.
3. mortgage via Task 10.
4. net cash flow = after-tax income − expenses − mortgage voluntary payment.
5. allocate/withdraw (Task 13 supplies `allocateSurplus`/`fundDeficit`; this task orchestrates).
6. account growth: balance × (equity×ret.eq + bond×ret.bond + cash×ret.cash).
7. taxes via Tasks 4–6; `marginalRate` recorded.
8. `shortfall` when cash flow negative and accounts too thin — successive years remain runnable.

**Property tests (invariants):** every year — `balances.netWorth + cumulativeTaxPaid` reconciles to cumulative inflows within $1; no negative balances; empty-plan input produces thrown `validatePlan` error (fail fast, not silently).
**Run-out test (Review Focus #3):** a spendthrift plan with only a small RRSP: retirement at 60, expenses never drop — simulation runs to `endAge`, every post-exhaustion year has `shortfall > 0`, `success: false`, `failureAge` set, no NaN anywhere.

- [ ] Steps: failing invariant tests → run → implement stepper (algorithm above) → run → commit (`feat: deterministic year stepper`)

### Task 13: Savings allocation + withdrawals

**Files:**
- Create: `packages/engine/src/accounts/flows.ts`
- Test: `packages/engine/tests/accounts/flows.test.ts`

**Interfaces:**
- Consumes: Task 9 rooms, Task 8 RRIF minimums, types.
- Produces:
```ts
export function allocateSurplus(amount: number, policy: SavingsPolicyStep[], rooms: { tfsa: number; rrsp: number }, balances: { tfsa: number; rrsp: number; nonreg: number; debt: number }, mortgage: DebtPlan | undefined): { contributions: YearResult["contributions"]; amounts: YearResult["savings"]; newRooms: { tfsa: number; rrsp: number } };
export function fundDeficit(deficit: number, order: AccountType[], balances: Record<AccountType, number>, rrifMinimumDue: number): { withdrawals: YearResult["withdrawals"]; rrifMinimumTaken: number; remainingShortfall: number };
```
- `allocateSurplus` walks `policy` by ascending `priority`, respects `perYearCap`/`untilAge`, RRSP contributions capped by current room, `rrsp-match` matches `matchRate × amount` (employer) before the remainder hits other targets.
- `fundDeficit` walks `order` (default `["tfsa","nonreg","rrsp"]`), never overdraws; `rrifMinimumDue` is withdrawn *first and always* (it's mandatory), counted in `rrsp` withdrawals, and returns to cash flow.
- Tests: priority ordering; contribution-room stop; match rate; deficit draught TFSA→nonreg→RRSP; forced RRIF minimum reversed into cash flow; shortfall if none left.

- [ ] Steps: failing tests → run → implement → run → commit (`feat: savings allocation + withdrawal order`)

### Task 14: Non-registered ACB + realized gains

**Files:**
- Modify: `packages/engine/src/simulate.ts` (nonreg growth → split basis/market)
- Create: `packages/engine/src/accounts/nonreg.ts`
- Test: `packages/engine/tests/accounts/nonreg.test.ts`

**Interfaces:**
- Consumes: `ReturnSeries`, `IncomeForTax` (Task 4).
- Produces: integrated into `YearResult` via the stepper's tax input: annual capital gains realized on nonreg withdrawals computed from a maintained book value (`bookValue` tracks exposure — on growth it does `book += market × blendedReturn`, and a withdrawal reduces market by the full amount and reduces book by `withdrawal × book/market ratio`). Keep it simple, deterministic, and document the simplification in `docs/assumptions.md`:
```ts
export interface NonregState { market: number; book: number; }
export function nonregWithdrawal(state: NonregState, marketAfterGrowth: number, withdrawal: number): { realizedGain: number; newBook: number; newMarket: number; };
export function nonregGrow(state: NonregState, yearReturn: { equity: number; bond: number; cash: number }, assetMix: AccountPlan["assetMix"]): NonregState;
// growth: market += market × blendedReturn; book += market × blendedReturn (implicitly unrealized, ACB tracks along with growth in this simplified model)
```
- Tests: explicit $10k market / $6k book, 25% withdrawal → ratio-based gain; growth entries; consumption across multiple years.

- [ ] Steps: failing tests → run → wire into simulate (revision of relevant year results stays consistent) → run → commit (`feat: non-registered ACB tracking with realized capital gains`)

### Task 15: Golden projection snapshot

**Files:**
- Create: `packages/engine/tests/golden/samplePlan.ts`, `packages/engine/tests/golden/golden.test.ts`
- Create: `docs/assumptions.md`

**Interfaces:**
- Consumes: rendered full pipeline.
- Produces: `samplePlan` fixture — a realistic 45-year-old Ontarian: home $700k (2% appreciation), mortgage $350k @4.5%/25yr/$1930/mo, RRSP $180k, TFSA $60k, non-reg $40k, salary $95k (2% raises), expenses $55k (2% inflation), TFSA→RRSP-match→RRSP policy, retirement 65, CPP $8k @65, OAS @65, end age 95.

- [ ] **Step 1:** Write `golden.test.ts` asserting: (a) the first three years' `netWorth`, tax total, and balances **are exact pinned numbers**, hand-derived in comments showing the arithmetic from table values; (b) plan survives to 95 with success and net worth > 0; (c) aggregate invariants (lifetime tax > 0, balances never negative). Run — it will pass or fail depending on engine correctness; adjust NOTHING silently — any mismatch must be reconciled line-item by line-item until the hand-derived numbers agree.
- [ ] **Step 2:** `docs/assumptions.md` — every documented v1 simplification from the spec (dividend gross-up off, GIS earnings approximations, ACB growth model, pension income splitting excluded) with reasoning.
- [ ] **Step 3: Commit** — `test: golden projection sample with pinned first-years + assumptions doc`

### Task 16: External cross-check

**Files:**
- Create: `docs/validation/cross-check.md`
- Test: `packages/engine/tests/validation/crosscheck.test.ts`

**Interfaces:**
- Consumes: Task 15 fixture.
- Produces: documented external validation: run Government of Canada Retirement Income Calculator (or equivalent) on the Task 15 plan's first 3 retirement years and record side-by-side figures. Test asserts our engine's per-year net income and taxes across the compared years are within 10% of external figures (documented tolerance; divergence investigated and explained, not silently accepted).

- [ ] Steps: fixture test → external tool comparison → document → commit (`docs: external cross-check of tax engine`)

## Out of scope for this plan

- UI (`apps/web`), IndexedDB persistence, scenario-delta editing, comparison views → **Phase 2 plan** (written after Phase 1 lands).
- Monte Carlo UX (heatmap, percentile charts) → Phase 3; only the engine runner + numbers exist here.
- Historical backtest dataset, dividend gross-up/credit, extra provinces → fast-follows.

## Notes for the fleet

- Tasks 3–8, 10–11 are **independent given Task 2's types** — parallel implementers are safe for those.
- Tasks 12–15 are **sequential** (stepper → flows → ACB integration → golden).
- The tax tables (Task 3) are the plan's single **verify-from-official-sources** step; other tasks pin only *shapes and stable published constants*.
