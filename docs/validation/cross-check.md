# External Cross-Check of the Tax Engine (Plan Phase 1, Task 16)

Executed 2026-11-10 by the validation implementer (GLM-5.3-Flash Free). Files owned by
Task 16: this document and `packages/engine/tests/validation/crosscheck.test.ts`.

## 1. What "external" means here — read this first

**No interactive government calculator output is used anywhere in this validation.**
The official calculators (CRA Payroll Deductions Online Calculator, the ESDC/Government
of Canada Retirement Income Calculator) are interactive web applications that cannot be
scripted, so no figure in this document comes from having operated one. Every "external"
figure comes from exactly one of two things:

1. **Official published parameters**, read verbatim from Government of Canada pages
   (canada.ca) fetched LIVE on 2026-11-10 — not from memory, not from the repo's own
   `SOURCES.md`, and not from commercial aggregators. Listed in §2 with URLs.
2. **An independently computed official-formula reference**, implemented from scratch
   inside `crosscheck.test.ts` (bracket math, non-refundable credits, Ontario surtax,
   OAS recovery tax, GIS taper) using only those official constants plus the engine's
   documented indexation convention. It shares NO code with the engine; it reads only
   the engine's *ledger outputs* (income components, withdrawal amounts) as input shapes
   and re-prices tax on them.

This is a second, independent calculator — clearly distinct from an actual government
calculator's output, which remains documented here as a limitation (§6).

## 2. Official sources (all fetched live 2026-11-10)

| Value used | Source page (canada.ca) |
| --- | --- |
| 2026 indexation 2.0%; federal thresholds 58,523 / 117,045 / 181,440 / 258,482; BPA $16,452; age amount $9,208 (threshold $46,432); Canada employment amount $1,501; OAS repayment threshold $95,323; TFSA 2026 limit $7,000 | [CRA: Indexation adjustment for personal income tax and benefit amounts](https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html) |
| Federal rates 14 / 20.5 / 26 / 29 / 33% ("For 2026 and subsequent tax year, the lowest federal tax rate will be 14%"); Ontario brackets 5.05 / 9.15 / 11.16 / 12.16 / 13.16% over 53,891 / 107,785; ON indexing 1.9% | [CRA T4127 payroll: Income tax rates and income thresholds](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/income-tax/reducing-remuneration-subject-income-tax.html) |
| Ontario surtax: 20% of basic ON tax over $5,818 **plus** 36% over $7,446; Ontario basic personal amount $12,989; Ontario health premium schedule (§5) | [CRA T4032-ON (E), effective Jan 1, 2026 — general information](https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032on-jan/t4032on-january-general-information.html) |
| OAS max $742.31/mo (age 65–74) ⇒ $8,907.72/yr; GIS single max $1,108.74/mo ⇒ $13,304.88/yr; footnote 7: "The OAS pension repayment range in 2026 is for net world income from $95,323 to $154,708"; footnote 6: GIS cut-offs exclude the OAS pension and the first $5,000 of employment income (+50% band to $15,000) | [ESDC: Maximum Benefit Amounts — CPP (2026) and OAS (Jan–Mar 2026)](https://www.canada.ca/en/employment-social-development/programs/pensions/pension/statistics/2026-quarterly-january-march.html) |
| Recovery rate 15% ("You must repay 15% of that amount"); threshold table showing income-year-2026 minimum threshold $95,323 | [CRA: Old Age Security pension recovery tax](https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/recovery-tax.html) |
| RRIF prescribed factors, "All other RRIFs" column (71: 5.28% … 72: 5.40% … 95+: 20.00%) | [CRA: Chart – Prescribed factors](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/completing-slips-summaries/t4rsp-t4rif-information-returns/payments/chart-prescribed-factors.html) |
| RRIF method: minimum = FMV at start of year × prescribed factor | [CRA: Minimum amount from a RRIF](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/completing-slips-summaries/t4rsp-t4rif-information-returns/payments/minimum-amount-a-rrif.html) |
| RRSP dollar limit $33,810 (2026); TFSA annual-limit history 2009–2026 (sums to $109,000) | [CRA: MP, DB, RRSP, DPSP, ALDA, TFSA limits, YMPE and the YAMPE](https://www.canada.ca/en/revenue-agency/services/tax/registered-plans-administrators/pspa/mp-rrsp-dpsp-tfsa-limits-ympe.html) |

A second independent verifier re-confirmed the RRIF chart page.

## 3. Constant verification — `ca-2026.json` vs official (all exact ✓)

Verified by `crosscheck.test.ts`, Part A (engine-independent: reads the data JSON, compares
against constants hard-typed from the sources above):

| Item | Engine | Official | Status |
| --- | --- | --- | --- |
| Federal brackets & rates (2026) | 14/20.5/26/29/33% over 58,523/117,045/181,440/258,482 | identical (T4127) | ✓ exact |
| Federal indexation factor | 1.020 | 2.0% | ✓ |
| BPA / employment amount | 16,452 / 1,501 | identical | ✓ |
| Age amount $9,208, threshold $46,432, reduction 15% | identical | identical | ✓ |
| Ontario brackets & rates | 5.05/9.15/11.16/12.16/13.16% over 53,891/107,785/150,000/220,000 | identical (T4127) | ✓ |
| Ontario BPA / indexation | 12,989 / 1.9% | identical (T4032-ON) | ✓ |
| Ontario surtax ladders | 20% over $5,818 + 36% over $7,446 (basic-tax dollars) | identical (T4032-ON) | ✓ |
| OAS annual max / clawback threshold / recovery rate | 8,907.72 / 95,323 / 0.15 | identical (ESDC + CRA) | ✓ (handoff item c) |
| GIS max single / taper / employment exclusion | 13,304.88 / 50% / $5,000 | identical (ESDC) | ✓ |
| **RRIF factor at 72** | **0.0540** | **0.0540** | ✓ (handoff item b) |
| **Full RRIF schedule, "All other RRIFs"** | see note below | 71–95+ chart | ✓ (after correction, see §4) |
| **TFSA annual limit 2026 / cumulative room** | **7,000 / 109,000** | **7,000 / official-limit sum = 109,000** | ✓ (handoff item d) |
| RRSP rate / 2026 dollar limit | 18% / 33,810 | identical (PSPA table) | ✓ |

The $109,000 cumulative room is re-derived inside the test as the sum of the officially
published annual limits 2009–2026 (the CRA PSPA page is itself the primary source; no
bank/aggregator figure is relied on).

## 4. RRIF data discrepancy found and fixed (history)

On the pre-fix tree the engine's `ca-2026.json` RRIF table diverged from the official
"Chart – Prescribed factors" ("All other RRIFs" column) at ages 76, 79 and 80–94 (e.g.
90: 10.01% vs official 11.92%; 94: 12.34% vs official 18.79%) — under-stating mandatory
minimums by up to 6.45 percentage points. The full official table was encoded as failing
tests and relayed (with URL) to the builder, who performed the data-only correction.
The schedule test now passes against the official chart and remains as a permanent guard.

## 5. Golden-plan comparisons — independent official-formula reference vs engine

Fixture: the Task 15 golden plan (`tests/golden/samplePlan.ts`), with one
validation-only override (§5b). All figures CAD, plan conventions per
`docs/assumptions.md`.

### 5a. Golden year 1 (age 45, employment 95,000) — handoff item (a)

| Component | Engine | Independent official-formula reference | Handoff pin |
| --- | --- | --- | --- |
| Federal | 13,157.59 | 13,157.59 | 13,157.59 |
| Ontario basic | 5,827.02 | 5,827.02 | 5,827.02 |
| Ontario surtax | 1.80 | 1.80 | 1.80 |
| OAS clawback | 0.00 | 0.00 | — |
| **Total tax** | **18,986.41** | **18,986.41** | **18,986.41** |

Exact to the cent, all three ways. This is the strongest check in the suite: official
base-year values are exact, no extrapolation involved.

### 5b. First three retirement years (ages 65–67) — no employment income

**Fixture convention (review item M3).** The shipped golden fixture leaves the employment
stream without an `endAge`, and engine semantics keep an unended employment stream running
into retirement. That made the earlier "retirement years" comparisons employment years
labeled as retirement. For this validation, a **validation-only override** ends employment
at 64, so ages 65–67 are genuinely post-employment years with analytically known inputs.
The convention question for the shipped fixture (does an unended employment stream
*intend* to continue past `retirementAge`?) is a design question flagged to the captain
(§6 item 8). The test asserts the analytic stream values directly (review item M2):
employment 0 (post-endAge), CPP exactly 8,000.00, OAS exactly 8,907.72 every year.

Method: the test re-prices each engine year's own income shape (CPP + OAS + withdrawals +
any realized-gain component) with the independent calculator, then compares reported tax,
per-year net income (income streams + GIS − tax), **and the GIS itself** against the
official formula. Tolerance per the plan: 10%. **Engine and reference agree to the cent on
tax, net income, and GIS in every compared year:**

| Age | Taxable income | Federal | ON basic | Surtax | OAS clawback | Total tax | GIS | Net income |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 65 | 16,907.72 | 0.00 | 0.00 | 0.00 | 0.00 | **0.00** | **9,304.88** | 26,212.60 |
| 66 | 16,907.72 | 0.00 | 0.00 | 0.00 | 0.00 | **0.00** | **9,304.88** | 26,212.60 |
| 67 | 16,907.72 | 0.00 | 0.00 | 0.00 | 0.00 | **0.00** | **9,304.88** | 26,212.60 |

Composition: CPP 8,000 + OAS 8,907.72 = 16,907.72 taxable; the retirement spending target
is met entirely by TFSA withdrawals (78,674.51 / 80,309.05 in 65/66 — not income) and, once
TFSA room is exhausted at 67, by a TFSA top-up of 29,286.37 plus a non-registered draw of
52,689.91. GIS equals 13,304.88 − 50% × (CPP 8,000) = 9,304.88 exactly under the official
rule (OAS excluded, no employment or RRSP income; see §6.4) on both sides.

### 5c. Discrepancies found during the check, root-caused, and fixed

1. **RRIF data** — see §4.
2. **Static base-year taxation.** The pre-fix engine charged **53,708.23** at age 65
   (48.7% above the reference). Every component of the pre-fix figure matched the
   **static base-year-2026 table exactly** (fed 28,344.02 = unscaled brackets − unscaled
   credits; ON 12,689.69 + surtax 3,262.07 on unscaled 5,818/7,446 thresholds; clawback
   9,412.46 = 0.15 × (158,072.72 − 95,323)). Root cause: `simulate.ts` used one base-year
   `TaxYearTables` for all ages and never called `applyIndexation(tables, yearOffset)` —
   a wiring gap, not a formula error (year-1 cents matched). Relay to the builder; fixed
   the same day.

### 5d. Pension income amount — fixed $2,000 statute, now matched by both engine and reference
(review item M4, resolved)

Official primary source ([CRA Line 31400](https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-31400-pension-income-amount.html),
fetched live 2026-11-10): the federal pension income amount is a **fixed $2,000**
(ITA 118(3)) — it is **not indexed**; eligible pension income includes RRIF withdrawals
and RRSP annuity/withdrawal income at 65+; **CPP/OAS are explicitly NOT eligible**.

Status: the engine now stores the base `pensionIncomeCredit.amount` at the statutory
**2,000** (`ca-2026.json`) and `applyIndexation` passes it through unscaled with an
explicit statute comment — matching the official rule. The independent reference in
`crosscheck.test.ts` uses the same fixed 2,000 at every year offset. Verdict: engine and
official law now agree; no open item.

## 6. Documented limitations & gaps (honest, not fixed)

1. **Not an actual government-calculator run.** See §1. The ESDC Retirement Income
   Calculator and PDOC cannot be scripted; no figure attributed to them anywhere.
2. **Ontario health premium — not modeled by the engine.** Official 2026 schedule
   (T4032-ON): $0 ≤ 20k; else min(300, 6% over 20k); min(450, 300+6% over 36k);
   min(600, 450+25% over 48k); min(750, 600+25% over 72k); min(900, 750+25% over 200k).
   For this plan's **base-fixture** retirement-year taxable incomes (~158–164k) the
   premium would be **$750**/yr for every compared year — material to net income. (Under
   the §5b retired fixture the compared years have taxable ≈ 16.9k and no premium.) Fast
   -follow candidate.
3. **CPP/EI payroll contributions — not modeled.** 2026 employee rate 5.95% (max 4,230.45
   on YMPE 74,600), CPP2 4.00% (max 416.00), EI 1.63% (max 1,123.07). Affects working
   years' net cash; CPP pension is already taxed correctly as income. Fast-follow.
4. **GIS income test (corrected during this check — an earlier draft of this document
   stated the engine counts OAS; that was false).** Exact code evidence: the engine's GIS
   call passes cpp / prior-year RRSP·RRIF withdrawals / employment income / (other plan
   streams + prior-year realized non-reg gains) / TFSA withdrawals into
   `GisIncomeSources`, holds OAS in a separate variable and never passes it, and the
   interface has no `oas` field. The engine therefore **excludes the OAS pension from the
   GIS income test — which is the officially correct treatment** (ESDC Table 5 footnote 6:
   the income level cut-offs "do not include the OAS pension"). The one remaining
   divergence from official law is the engine's omission of the **50% band on employment
   income between $5,000 and $15,000** (v1 counts all employment income above $5,000 —
   conservative for that band, and a documented fast-follow). GIS in the §5b compared
   years = 9,304.88 under the official formula and matches the engine to the cent.
5. **Future-year indexation is extrapolation** (both engine and reference): per-year
   federal 2.0% / Ontario 1.9% factors applied geometrically from base 2026. No official
   future-year values exist; CRA announces each fall. Corroboration: the official OAS
   repayment threshold grew 90,997 → 93,454 (2024→2025, +2.7% = the 2025 federally
   announced factor) → 95,323 (2025→2026, +2.0% = the 2026 factor) — the mechanism the
   engine extrapolates matches its history. Ontario's legislatively unindexed 150k/220k
   brackets are uniformly indexed by the engine — documented simplification
   (`docs/assumptions.md`).
6. **Shared-interpretation note.** The independent reference re-implements the official
   formulas but necessarily shares certain *interpretations* (age-credit reduction
   formula per Federal Worksheet 5000-D1; pension income amount with no income phase-out;
   credit conversion at the lowest rate). These interpretations are themselves sourced
   from official documents and are exact at base year (§5a matches to the cent), but the
   cost of a *misinterpretation* would not be caught twice by this design. Base-year
   discrepancies would appear prominently because the values are exact.
7. **Emigration proration / room-vs-residency:** TFSA room is seeded at the full
   cumulative (appropriate for a resident eligible since 18, as in this plan); arrival
   dates and residency proration are out of v1 scope.
8. **Employment stream without `endAge` continues into retirement (design flag).**
   Engine semantics: `isActive` treats a missing `endAge` as "runs until `profile.endAge`",
   so the shipped golden fixture's employment stream produces salary at ages 65–67
   despite the plan being described as retired. Validation therefore uses a
   validation-only override ending employment at 64 (§5b). Whether the *shipped* fixture
   intends continued employment past `retirementAge` is a fixture-intent question for the
   captain — the engine's semantics are internally consistent either way.

## 6b. Official-rule adjudications (review round)

- **OAS recovery base — reviewer's "net income must include the FULL capital gains"
  claim NOT confirmed; no change made.** The official recovery (line 23400) operates on
  **net world income** for the year, and net world income includes capital gains at their
  **taxable (one-half, ITA s.38) portion** — exactly what the engine's `taxableIncome`
  feeds to `oasClawback`. Including the full gains would overstate the recovery. The
  engine's treatment matches official law.
- **OAS recovery cap — RESOLVED; enforced at the `simulate.ts` `taxOf` call site.**
  Official rule (CRA recovery-tax page, fetched live 2026-11-10): the repayment is 15%
  of the excess of net world income over the threshold, but it repays "part or your
  entire OAS pension" — i.e. it is **capped at the OAS benefit actually received**; the
  official 2026 upper income threshold on the recovery-tax page is **$155,320**, above
  which the full OAS is repaid. The raw `oasClawback()` helper computes the uncapped
  15% × max(0, taxable − threshold) BY DESIGN (single-purpose primitive), and the engine's
  actual taxpayer-facing tax function caps it at the call site:
  `taxOf` in `simulate.ts` applies `Math.min(Math.max(0, oasReceived), oasClawback(taxable, tables))`,
  so the repayment can never exceed the OAS received — matching the official rule.
  Context retained: the uncapped formula alone would first equal full max-OAS at taxable
  ≈ 95,323 + 8,907.72/0.15 ≈ **154,708** (matching the ESDC footnote-7 repayment-range
  top of 154,708; the CRA recovery-tax page gives 155,320 — a minor inter-source
  discrepancy worth noting), which is exactly why the call-site cap matters only in that
  band and above; the independent engine reviewer confirmed the fix resolved, and the
  186/186 suite includes high-income and delayed-OAS coverage of the cap.

## 7. Reproduce

```sh
# from the repository root
npx vitest run packages/engine/tests/validation/crosscheck.test.ts   # cross-check only
npx tsc --noEmit -p packages/engine                                  # typecheck
npm test -w packages/engine                                          # full suite
```

## 8. Verdict

- Handoff constants (a) 18,986.41 year-1 tax, (b) RRIF 5.40% at 72, (c) OAS threshold
  95,323 (+15% recovery), (d) TFSA cumulative room 109,000 — **all verified against
  official sources fetched live 2026-11-10**; (a) additionally re-derived independently
  to the cent.
- First three retirement years (ages 65–67, post-employment via the §5b validation
  override) — engine matches the independent official-formula reference to the cent in
  every tax component, in net income, and in GIS, after the discrepancies found during
  this task (RRIF data; missing per-year indexation wiring) were root-caused and fixed by
  the engine owner.
- Official-rule adjudications (§6b): the reviewer's "full capital gains in the OAS
  recovery base" claim was not confirmed (official base includes only the taxable
  one-half of gains; engine correct); the **OAS recovery repay-amount cap** is **closed** —
  `simulate.ts` `taxOf` caps the raw helper at the OAS actually received
  (`min(oasReceived, oasClawback(...))`), confirmed resolved with high-income and
  delayed-OAS coverage in the 186/186 suite; the pension income amount was corrected to
  the statutory fixed $2,000 in both engine and reference (§5d) — resolved.
- Remaining known gaps are documented above (§6): Ontario health premium and CPP/EI
  contributions are the material ones; the employment-stream fixture-intent question
  (§6.8) is the captain's call.
