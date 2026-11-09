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
