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

## RRIF prescribed factors

The engine uses the CRA chart's **All other RRIFs** column, ages 71–94, with the 20%
factor from age 95 onward. Qualifying and legacy RRIF columns are not modeled. The full
schedule is pinned in `packages/engine/tests/benefits/rrif.test.ts` and sourced in
`packages/engine/data/tax/SOURCES.md`.

## Year stepper conventions

- **RRSP room availability (in-year):** the allocator treats a year's earned room
  (18% of salary, capped at the annual limit) as contributable THAT year; CRA formally
  makes it contributable the following year. The employer pension adjustment is applied
  once, at the year-end room roll.
- **RRIF minimum's own tax:** the year's obligation prices the mandatory RRIF minimum's
  marginal tax in, so a year funded only by the minimum lands in the funding branch it
  really belongs to (its tax is never silently swallowed by a surplus clamp).
- **Deficit gross-up:** RRSP draws are iterated to a self-consistent gross amount
  (draw = need + its own marginal tax); the residual after convergence is either drawn,
  taken from the next account in the withdrawal order, or recorded as shortfall.
- **Final mortgage year:** annual mortgage cash is capped at (opening balance +
  interest) — a partial final year does not bill payments that were never due.
- **Unmatched policy steps:** a savings-policy step aimed at an account type the plan
  does not hold is skipped (the money stays in the surplus default). Unallocated
  surplus defaults to non-registered only when a non-registered account exists.
- **Employer RRSP match:** an income-side inflow (compensation) that lands in the RRSP
  tax-free in v1 and consumes RRSP room through the pension adjustment.
- **GIS sequencing:** GIS is evaluated on THIS year's income streams but the PRIOR
  year's RRSP/TFSA withdrawals (single-pass-y sequencing simplification).
- **Projection cash reserve:** the plan has no starting cash account, but cash is tracked
  in year results when surplus remains after a terminal mortgage-prepayment step or when
  no eligible investment account can receive it. The reserve earns no return and is
  available to meet later-year obligations before investment withdrawals.
- **Non-registered ACB (Task 14):** basis is tracked as an aggregate across all
  non-reg accounts. Because flows distribute proportional to balance, the aggregate
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
  tax; the charged tax is folded component-wise into annual tax. Losses offset current
  year gains only. TFSA draws carry no tax (Task 7 contract).
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
