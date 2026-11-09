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

## GIS employment-income exemption

v1 excludes only the first $5,000 of employment income. The CRA 50% band between
$5,000 and $15,000 is a documented fast-follow.

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
- **No cash account:** money is tracked only through account balances and debt; a year
  whose flows do not balance shows up as contributions, withdrawals, or shortfall —
  the per-year netWorth reconciliation property pins this.
