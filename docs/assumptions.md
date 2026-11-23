# Documented v1 Assumptions

Every simplification below is deliberate and pinned by tests; this file grows as
upcoming tasks (golden projection, cross-check) land their documented simplifications.

## Mortgage rate convention

`DebtPlan.rate` / `mortgageYear`'s `annualRate` is a **nominal annual rate compounded
monthly** — the monthly loop charges `rate/12` per month. Canadian mortgages normally
compound semi-annually, so a quoted Canadian rate mapped one-to-one into this engine is
a deliberate approximation (slightly different effective cost). Real Canadian quoted
rates fed in directly are fine; callers must not annualize or de-annualize differently.
Pinned by the 25-year amortization test at the same convention
(`packages/engine/tests/mortgage.test.ts`).

### Negative amortization

`mortgageYear` reports fields only — it never emits warnings. If a payment cannot cover
a month's interest the balance rises; the **stepper** detects `endBalance > startBalance`
(with a positive payment) and emits a warning event itself (Review Focus #5).

## Tax-table indexation

Ontario's top two brackets ($150,000 / $220,000) are legislatively unindexed in reality
(see `packages/engine/data/tax/SOURCES.md`); the engine applies uniform Ontario
indexation as a documented simplification.

OAS recovery tax is capped at the OAS amount actually paid in that year. If the OAS
income stream has not started, no recovery tax is charged even when net income is above
the recovery threshold.

## GIS employment-income exemption

v1 excludes only the first $5,000 of employment income. The CRA 50% band between
$5,000 and $15,000 is a documented fast-follow.

## Projection-year tax indexation

The loaded tax table is labelled with its base calendar year. For age `a`, the stepper
derives the projected calendar year as `birthYear + a` and applies the federal and
Ontario indexation factors from that year to the table year. This scales tax brackets,
indexed personal credits, Ontario surtax thresholds, and the OAS recovery threshold. The
federal pension income amount stays at its statutory $2,000 cap. Parameters fixed by
annual announcement (including RRIF factors, TFSA/RRSP dollar limits, and OAS/GIS
maximums) remain at their base-table amounts in v1; future announced values are not
forecast.

## Retirement-linked salary

Employment streams set to **Until retirement** pay through the year before the
retirement age resolved for the run. The base age applies unless a scenario
overrides it. If the start age is at or after that retirement age, the linked
stream pays nothing. Salary and bonus use the same active years. Fixed end ages
are inclusive, and older streams without an end age or a retirement link stay
ongoing. CPP, OAS, expenses and savings steps use their own ages.

### Employment RRSP contributions

Each employment income can target one named RRSP. Choose annual dollars or a
percentage of raised base salary for personal deposits. The company can use
either method or match a percentage of the personal deposit that lands.
A 100% match adds one company dollar per personal dollar. Salary percentages
exclude bonuses. Deposits follow the employment schedule, including retirement cutoff when enabled.

Fixed and salary-based company amounts use shared RRSP room first, in income
stream order. Personal and matching amounts then use the remaining room in
the same order. The personal amount is limited by pay from that job and
available household wages after payroll and income tax, with the personal
deduction included in the calculation. The engine reserves this amount
before expenses, mortgage payments and general savings. It fixes the amounts
before pricing withdrawals and books them after withdrawals, so new deposits
are unavailable to fund this year's shortfall. Missing or ambiguous destinations and previous capped formulas awaiting
review produce warnings and book no deposit.

A legacy surplus-match step remains available for saved plans and requires
employment pay. When an employment setup books a company deposit, the surplus step makes
personal deposits only and the projection warns about the overlap.
Review the legacy step and configure the intended company match on the
corresponding employment income.

## Employee payroll deductions

The optional scenario payroll settings enable CPP and EI independently. Legacy
scenarios omit payroll deductions, and enabled scenarios use the employee share
for one Ontario taxpayer with one employer per calendar year. All active employment
streams, bonuses and landed employer RRSP deposits share a single calculation
of CPP, CPP2 and EI. The model assumes a group RRSP that permits withdrawals
during employment, so employer deposits are pensionable and insurable under
the same rules as wages. Payroll models employee deductions only.
Self-employment, Quebec payroll and multi-employer reconciliation are outside
the model. [CRA taxable benefits and payroll guide](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4130/employers-guide-taxable-benefits-allowances.html)

The bundled model uses the 2026 payroll rates, earnings ceilings, basic CPP
exemption and EI refund threshold in every projected year. Like the annual
TFSA and RRSP limits, these amounts stay at the base-table values when ordinary
income-tax brackets and credits are indexed. The projection does not fetch
current payroll rates or forecast changes announced for later years.

CPP, including CPP2, applies in modeled years at ages 18 through 69. The
optional age 65–69 election applies only when a positive configured CPP
retirement pension is paid in the same scenario and year. This annual model
uses whole years for birthdays and elections. Actual payroll starts after
the month of the 18th birthday, continues through the month of the 70th
birthday, and generally changes in the month after an employer receives a
valid CPT30 election. CPP-recognized disability, election revocations and
partial-year payroll require more detail than the plan stores. EI remains
age independent.

Gross payroll withholding appears separately from income tax. The annual cash
cost is total withholding minus the EI refund, reconciled in the same model
year when annual insurable earnings are $2,000 or less. Base CPP and EI retained
after the refund generate non-refundable federal and Ontario credits. First
additional CPP and CPP2 reduce taxable income and the OAS recovery income proxy.
GIS uses employment income net of payroll before its existing exemption. The
RRSP room calculation continues to use gross employment income. Annual tax
and payroll deductions reduce available cash before savings or deficit funding.

The CPP pension remains the amount entered by the user. Future CPP pension
accrual, the CPP Post-Retirement Benefit, and EI benefit payments are outside
the payroll model. [CRA Ontario 2026 payroll tables](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032on-jan/t4032on-january-general-information.html) · [CRA CPP elections and cutoffs](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/canada-pension-plan-cpp/starting-stopping-cpp-deductions.html) · [CRA EI credit and refund](https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-31200-employment-insurance-premiums-through-employment.html) · [Service Canada PRB eligibility](https://www.canada.ca/en/services/benefits/publicpensions/cpp/cpp-post-retirement/eligibility.html)

## Monte Carlo returns

Monte Carlo draws independent annual normal returns for equity, bonds, and cash,
centered on the scenario's return assumptions. Standard deviations are absolute
percentage-point deviations (for example, 18% means 0.18), not multipliers. A draw
is floored at -100%; no generated return can lose more than the full asset value.
The configured 32-bit seed reproduces the same paths. Success probability is the
fraction of simulated paths marked successful by the year stepper. Final-wealth
percentiles summarize separate paths; charts and yearly details use one actual run
at the median final-wealth order statistic and never combine percentile values into
a synthetic cash-flow path.

## JST historical return proxy

Historical mode uses the bundled JST Macrohistory Database R.6 USA annual equity,
government bond, and bill return rates. The observation series spans 1872–2020 and
is measured in nominal USD. It is a non-Canadian proxy: fractional return rates are
applied to plan balances without CAD/USD conversion or modeled currency-return
effects. Existing Canadian/Ontario taxes and modeled benefits remain in effect;
historical tax, benefit, and household cashflows are not replayed.

`historicalConfig.startYear` selects the earliest rolling-window start. Each complete
window maps its first source year to the plan's current age and advances one source
year per age; the horizon includes both current and end ages. The engine runs every
complete window from that start through the last one fitting within 2020. Windows
never wrap or reach the present. Success rate and final-wealth percentiles summarize
separate windows; the displayed path is one actual window nearest median final wealth.

The bundled partial dataset is licensed CC BY-NC-SA 4.0 for noncommercial use;
redistribution and derivatives require attribution and the same license. Source page,
release, extraction method, data fields, license details, consultation date, and
required JST citations are in `packages/engine/data/historical/SOURCES.md`. Cite both
the 2017 Macrofinancial History paper and the 2019 Rate of Return paper when using
these return series.

## RRIF prescribed factors

The engine uses the CRA chart's **All other RRIFs** column, ages 71–94, with the 20%
factor from age 95 onward. Qualifying and legacy RRIF columns are not modeled. The full
schedule is pinned in `packages/engine/tests/benefits/rrif.test.ts` and sourced in
`packages/engine/data/tax/SOURCES.md`.

## Year stepper conventions

- **RRSP room availability (in-year):** the projection starts with zero
  carryforward and makes room on salary and bonuses (18%, capped at the annual
  limit) usable in the same year. CRA uses prior-year earned income and permits
  personal RRSP contributions through the year the account holder turns 71.
  All landed RRSP deposits consume room once. At year end the model adds any
  incremental room earned on the taxable employer benefit, within the same
  annual limit, for use in later years. Group RRSP deposits do not generate
  pension adjustments. [CRA RRSP guide](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4040/rrsps-other-registered-plans-retirement.html) · [CRA Pension Adjustment Guide](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4084/pension-adjustment-guide.html)
- **RRIF minimum's own tax:** the year's obligation prices the mandatory RRIF minimum's
  marginal tax in, so a year funded only by the minimum lands in the funding branch it
  really belongs to (its tax is never silently swallowed by a surplus clamp).
- **Deficit gross-up:** RRSP draws are iterated to a self-consistent gross amount
  (draw = need + its own marginal tax); the residual after convergence is either drawn,
  taken from the next account in the withdrawal order, or recorded as shortfall.
- **Final mortgage year:** annual mortgage cash is capped at (opening balance +
  interest) — a partial final year does not bill payments that were never due.
- **Savings overflow:** contributions that cannot land continue to the next
  savings-policy step. The default sweep uses a non-registered account when available
  and otherwise retains the surplus as idle cash. Savings steps accept whole
  cents and round down when a step cap or shared contribution room binds.
  Without a named cash account an explicit cash step can deposit into idle cash.
- **Employment RRSP tax and cash flow:** landed employer deposits are taxable
  employment benefits with an equal modeled RRSP deduction and flow directly
  into the RRSP. Landed personal employment deposits also qualify for a modeled
  deduction. Ordinary surplus RRSP deposits carry no modeled deduction.
  Employee payroll costs, credits and enhanced CPP deductions can change with
  the employer benefit. Legacy surplus matching is reconciled after payroll
  and income tax, including changes to EI refund eligibility.
  CRA permits an employer to omit income-tax withholding on the benefit
  when it reasonably expects the employee to deduct it that year.
  [CRA taxable benefits and payroll guide](https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/t4130/employers-guide-taxable-benefits-allowances.html)
- **GIS sequencing:** GIS is evaluated on THIS year's income streams but the PRIOR
  year's RRSP/TFSA withdrawals (single-pass-y sequencing simplification).
- **Projection cash reserve:** the plan has no starting cash account, but cash is tracked
  in year results when surplus remains after a terminal mortgage-prepayment step or when
  no eligible investment account can receive it. The reserve earns no return and is
  available to meet later-year obligations before investment withdrawals.
- **Non-registered ACB (Task 14):** basis is tracked as an aggregate across all
  non-reg accounts. Because withdrawals distribute proportional to balance, the aggregate
  book/market ratio is exact under that distribution. `AccountPlan.bookValue` seeds
  current basis; if omitted, it defaults to market value for backwards compatibility.
  Contributions and home-sale proceeds enter at par. Growth adds the portfolio's dollar
  market change to basis; both values floor at zero, and a total market wipeout resets
  basis to zero. Withdrawals consume basis pro rata to market (including when basis is
  above market); full liquidation consumes all basis and may realize a capital loss.
- **Capital losses:** realized losses can offset realized gains in the same modeled year,
  but taxable capital gains floor at zero and unused losses are not carried forward or
  applied against ordinary income. This is a v1 single-year approximation.
- **Non-reg draws carry their own gains tax:** in the deficit branch, each non-reg
  draw is grossed up to deliver the requested net amount after its own realized-gain
  tax. RRSP and non-reg draws price their incremental tax against the running liability,
  including earlier gains and mandatory or proactive RRSP draws. Losses offset current
  year gains only. TFSA withdrawals are tax-free.
- **Mortgage-prepay step:** prepayments are capped at the debt remaining after scheduled
  payments. The step is terminal in the savings policy; leftover surplus is kept as
  uninvested projection cash. `untilAge` is inclusive: a step remains active at its
  specified age and stops in later years.
- **Investment return floor:** account market values cannot fall below zero. Returns at
  or below -100% wipe out the affected holdings; larger losses do not create negative
  assets.
- **Plan assets:** every asset, including `kind: "other"`, appreciates annually at its
  entered rate and contributes to net worth. `balances.home` remains the aggregate of
  primary homes; `balances.otherAssets` reports other assets and is an additive optional
  result field for older consumers. An asset leaves its balance in its configured sale
  year, and net sale proceeds (after entered sale costs) are available that year in
  non-registered holdings or projection cash. The initial entered value is the sale
  cost-base proxy. Positive gains after sale costs are taxed at the 50% inclusion rate,
  matching the existing home-sale convention. V1 does not model principal-residence
  exemption, asset-specific cost base, depreciation/recapture, or capital-loss carryovers;
  asset-sale losses do not reduce taxable income.
- **Realized gains count as GIS income:** prior-year realized capital gains feed
  the GIS income test (with the employment exemption unchanged) — GIS for tax
  year N is computed from tax year N-1 income, matching the existing
  prior-year-withdrawals sequencing.

## Cash accounts

Named cash accounts (chequing/savings) are a fourth account type, `type: "cash"`,
distinct from both the registered/registered-like investment accounts and the
floating idle-cash pool that absorbs surplus after a terminal mortgage
prepayment. A cash account takes an optional fixed nominal `interestRate`
(default 0%) and never an `assetMix`: it has no market exposure in any
simulation mode (deterministic, Monte Carlo and historical) — the market return
series, including its cash-class rate, is applied only to invested accounts.

- **Interest timing:** annual interest accrues on the account's OPENING balance
  and is credited before that year's flows, so the same year's withdrawals may
  draw it. Interest compounds only through the credited balance.
- **Taxation (CRA):** interest is ordinary income, taxed in the year credited as
  part of the fully-taxable income bucket — never capital gains; principal is
  never taxed. Source: CRA Line 12100, "Interest and other investment income
  form part of your total income"; bank interest is reported annually as "paid
  or credited" (canada.ca, page dated 2026-01-20, consulted 2026-11-13).
- **Counted once:** the interest appears as the account credit and as taxable
  income, and is not also added to spendable income; `YearResult.cashInterest`
  (top-level, optional) reports it, `income` does not.
- **GIS:** the prior year's cash interest counts in the GIS income test
  (`prevCashInterest`), mirroring prior-year realized gains; principal
  withdrawals do not.
- **Savings deposit order:** general savings deposits are proportional to
  balances after withdrawals, with the first account used when all are empty.
  Employment deposits go to their selected accounts. Withdrawals and direct
  asset-sale transfers remain proportional by balance.
- **Withdrawal order:** a plan's `withdrawalOrder` contains tfsa/nonreg/rrsp
  exactly once each, plus optional cash once. When named cash accounts exist and
  the stored order predates cash, the engine draws cash first (most-liquid
  fallback); an order that positions cash explicitly is respected verbatim. The
  floating pool remains consumed first, as before. Cash principal draws carry no
  tax (interest was taxed at the year's opening).
- **Result fields (all optional, absent for legacy plans):** `withdrawals.cash`,
  `contributions.cash`, `savings.cash`, top-level `cashInterest`,
  `cashAccounts` (year-end named-account balances). `balances.cash` remains the
  floating pool PLUS the sum of named cash accounts, counted once; net worth
  likewise adds named cash exactly once. Old saved plans without cash accounts
  produce byte-identical results to the pre-cash engine.

## Benefit receipt toggles (`Scenario.benefits`)

`Scenario.benefits = { cpp, oas, gis }` (all booleans) — **absent means every
configured benefit is received (legacy behavior; results are byte-identical to the
pre-flags engine)**. The flags only GATE income streams the user actually configured:
no entitlement income is ever invented. `cpp: false` / `oas: false` zero the
corresponding configured streams (they are not reclassified as other income).

**GIS requires OAS (primary source, canada.ca — "Guaranteed Income Supplement"
page, page dated 2026-10-28, consulted 2026-11-13):** GIS "is available to Old Age
Security (OAS) pensioners with low income" and "To qualify for the GIS, you must also
qualify for OAS." Therefore `benefits.oas: false` forces GIS off in the engine even
when `gis: true` (a UI-level explanation/redirect is expected there; the engine gate
is unconditional).

**OAS recovery tax self-zeroes when OAS is off (canada.ca — "Old Age Security
recovery tax" page, consulted 2026-11-13):** the recovery tax is 15% of income over
the threshold, recovered from OAS payments, and "cannot be more than the amount of
OAS benefits you receive." The engine already caps clawback at OAS received
(`simulate.ts`: `min(oasReceived, oasClawback(taxable))`), so `oas: false` zeroes the
clawback with no new law function.

## Tax-minimizing withdrawal strategy (`withdrawalStrategy: "tax-minimizing"`)

Absent (or `"manual"`) means the configured `withdrawalOrder` runs exactly as before
(legacy, byte-identical). With `"tax-minimizing"`:

- **Planning happens once per run** from deterministic known assumptions (the
  scenario's own return assumptions — never Monte Carlo noise, never future paths).
  The chosen policy is a fixed execution RULE (`PlannedWithdrawals.fillTargetTaxable`,
  a base-table federal taxable-income target re-resolved per year from the indexed
  year tables) that every path — deterministic, Monte Carlo, historical — replays
  with current-year information only. **No per-path lookahead**; the metadata is a
  planning-time comparison, not a pathwise guarantee.
- **Candidate grid (bounded, reproducible, evaluated by full simulates):** proactive
  RRSP draws above the mandatory RRIF minimum fill the year's taxable income to one
  of — 0 (defer), federal basic personal amount, first federal bracket top, second
  federal bracket top, OAS recovery threshold − $1 — five candidates in fixed
  ascending order, each priced through the existing tax/GIS/clawback functions.
  Planning therefore costs exactly 6 simulates once per run (measured: a 50-run
  Monte Carlo with planning took ~19 ms vs ~10 ms manual — an ~9 ms one-time cost).
- **Objective:** total projected income tax through `endAge` only; estate and future
  tax are excluded by design. Heuristic over a bounded grid — no guaranteed global
  optimum.
- **Safety:** if the manual baseline is feasible, a candidate is selected only if it
  is feasible AND strictly lowers total tax (`status: "optimized"`); otherwise manual
  is retained (`status: "manual-retained"`). If manual is infeasible, only fully
  funded successful candidates are eligible (lowest-tax one wins); if none is
  feasible, manual is retained and reported as `status: "no-feasible-policy"` with an
  empty planned schedule — **a failed plan is never chosen for an earlier tax drop**.
  A feasible candidate chosen over a failed manual baseline may cost more tax; the
  comparison fields disclose that. No arbitrary wealth floor; final net worth is
  disclosed, not optimized.
- **Circular-redeposit guard:** in a year with a planned proactive draw,
  ordinary employee RRSP savings steps are suppressed. An eligible legacy match
  can use after-tax surplus available without the proactive draw, up to what
  remains after earlier policy steps. Employment RRSP deposits use wages before
  withdrawals. TFSA, non-registered, cash and mortgage steps continue on their schedules.
- Planned draws are taxed like any RRSP withdrawal and count as GIS income the
  following year via the standard prior-year withdrawal channel.
