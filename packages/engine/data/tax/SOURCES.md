# SOURCES — `ca-2026.json` (2026 tax year, Ontario)

Every value in `ca-2026.json` is recorded here with the official source it was verified
against (fetched during implementation on 2026-11-08). Values were **not** taken from memory.

Primary source for the retirement-simplification choices (OAS single rate, GIS single max,
employment-income exclusion tier) is the Government of Canada / CRA page cited.

## Federal

| Field | Value (2026) | Source | URL |
| --- | --- | --- | --- |
| `federal.brackets` (rates 14%, 20.5%, 26%, 29%, 33%; thresholds $58,523 / $117,045 / $181,440 / $258,482) | — | CRA "Income tax rates and income thresholds" (T4127 payroll, effective Jan 1, 2026); cross-checked with "Adjustment for personal income tax and benefit amounts" and CRA "Tax rates and income brackets — 2026" | https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/income-tax/reducing-remuneration-subject-income-tax.html · https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-year.html |
| Lowest rate 14% (vs 14.5% in 2025) | 0.14 | CRA indexation page + legislation enacting the July 1, 2025 cut to 14%; PwC Worldwide Tax Summaries 2026 note ("14.5% for 2025 and to 14% for 2026") | https://taxsummaries.pwc.com/canada/individual/taxes-on-personal-income |
| `federal.basicPersonalAmount` | $16,452 | CRA "Indexation adjustment for personal income tax and benefit amounts", "Basic personal amount (maximum) ... net income ≤ amount at which the 29% tax bracket begins ($181,440)" | https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html |
| `federal.indexationFactor` | 1.020 (2.0%) | CRA indexation page: "The federal indexing factor for January 1, 2026 is 2.0%" / table "Indexation increase 2026: 2.0%" | https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/income-tax/reducing-remuneration-subject-income-tax.html · https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html |
| `federal.ageCredit.amount` | $9,208 | CRA indexation page "Age amount" row (2026 column) | https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html |
| `federal.ageCredit.reductionThreshold` | $46,432 | CRA indexation page "Net income threshold for age amount" row | (same as above) |
| `federal.ageCredit.reductionRate` | 0.15 (15%) | ITA s.118(2)/ CRA Federal Worksheet 5000-D1 "Applicable rate" for the age amount (structure confirmed on the official 2025 worksheet; rate unchanged for 2026) | https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-30100-amount.html |
| `federal.employmentCreditAmount` | $1,501 | CRA indexation page "Canada employment amount (maximum)" row (2026 column) | https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html |
| `federal.pensionIncomeCredit.amount` | $2,000 | CRA "Pension income amount — Line 31400" ("claim whichever is less: $2,000, …") — amount is **not indexed**, fixed by ITA s.118(3) | https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/about-your-tax-return/tax-return/completing-a-tax-return/deductions-credits-expenses/line-31400-pension-income-amount.html |
| `federal.pensionIncomeCredit.incomeThreshold` / `.reductionRate` | 0 / 0 | **No income phase-out exists in current law**: the official Federal Worksheet 5000-D1 (verified 2025 edition, PDF) computes the pension income amount as min(eligible pension income, $2,000) with no net-income reduction chart. Stored as 0/0 ("no reduction") so the engine's generic reduction formula is a no-op. If CRA reinstates a phase-out, set both from the worksheet. | https://www.canada.ca/content/dam/cra-arc/formspubs/pbg/5000-d1/5000-d1-fill-25e.pdf |

## Ontario

| Field | Value (2026) | Source | URL |
| --- | --- | --- | --- |
| `ontario.brackets` (5.05%, 9.15%, 11.16%, 12.16%, 13.16%; thresholds $53,891 / $107,785 / $150,000 / $220,000) | — | CRA T4127 payroll "Ontario tax for 2026 — tax rates and income thresholds"; cross-checked CRA "Tax rates and income brackets (2026)" provincial table | https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/income-tax/reducing-remuneration-subject-income-tax.html · https://www.canada.ca/en/revenue-agency/services/tax/individuals/tax-rates-brackets/current-year.html |
| `ontario.surtax` ladder 1 | 20% of basic ON tax over $5,818 | CRA Payroll Deductions Tables T4032-ON (January 2026), "Surtax" section | https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032on-jan/t4032on-january-general-information.html |
| `ontario.surtax` ladder 2 | additional 36% of basic ON tax over $7,446 (official total above tier B is 20% + 36% = 56%, raising the top 13.16% bracket to 20.53%) | Same T4032-ON surtax section; cross-checked TaxTips.ca Ontario 2026 ("The 36% surtax is in addition to the 20% surtax, for a total surtax of 56%") | (same as above) · https://www.taxtips.ca/taxrates/on.htm |
| `ontario.basicPersonalAmount` | $12,989 | TaxTips.ca Ontario 2026 (confirmed to CRA info); consistent with $12,747 (2025) × 1.019 | https://www.taxtips.ca/taxrates/on.htm |
| `ontario.indexationFactor` | 1.019 (1.9%) | TaxTips.ca Ontario 2026: "The Ontario tax brackets and personal tax credit amounts are increased for 2026 by an indexation factor of 1.019"; consistent with ON threshold pair ratios (53,891/52,886 and surtax 5,818/5,710) | https://www.taxtips.ca/taxrates/on.htm |

## OAS / GIS

| Field | Value (2026) | Source | URL |
| --- | --- | --- | --- |
| `oas.annualMax` | $8,907.72 (= $742.31/month × 12, age 65–74, January–March 2026 quarter) | ESDC "Maximum Benefit Amounts and Related Figures — CPP (2026) and OAS (January to March 2026)", Table 5 | https://www.canada.ca/en/employment-social-development/programs/pensions/pension/statistics/2026-quarterly-january-march.html |
| `oas.clawbackThreshold` | $95,323 | ESDC card footnote 7 ("OAS pension repayment range in 2026 … net world income from $95,323"); cross-checked CRA indexation page "Old age security repayment threshold" | https://www.canada.ca/en/employment-social-development/programs/pensions/pension/statistics/2026-quarterly-january-march.html · https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html · https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/recovery-tax.html |
| `oas.recoveryRate` | 0.15 (15%) | CRA "Old Age Security pension recovery tax" (repay 15% of net income above the threshold) | https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/recovery-tax.html |
| `gis.annualMaxSingle` | $13,304.88 (= $1,108.74/month × 12, single person receiving a full OAS pension, January–March 2026 quarter) | ESDC "CPP (2026) and OAS (January to March 2026)", Table 5, "Single person who receives an OAS pension" | https://www.canada.ca/en/employment-social-development/programs/pensions/pension/statistics/2026-quarterly-january-march.html |
| `gis.taperRate` | 0.5 (50%) | CRA/Government of Canada GIS rules (GIS reduced by 50¢ per $1 of income above the exclusion; also the single cut-off ≈ max + exclusion confirms the 50% taper) | https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/payments.html |
| `gis.exclusionEmployment` | $5,000 | ESDC card footnote 6: GIS income cut-offs exclude "the first $5,000 of employment or self-employment income and 50% of employment or self-employment income between $5,000 and $15,000". v1 models only the first exemption tier (documented simplification). | https://www.canada.ca/en/employment-social-development/programs/pensions/pension/statistics/2026-quarterly-january-march.html |

## Registered plans

| Field | Value (2026) | Source | URL |
| --- | --- | --- | --- |
| `rrif.minimumFactors` (age 71: 5.28%, 72: 5.40%, 73: 5.53%, 74: 5.67%, 75: 5.82%, 76: 5.99%, 77: 6.17%, 78: 6.36%, 79: 6.57%, 80: 6.79%, 81: 7.04%, 82: 7.28%, 83: 7.55%, 84: 7.83%, 85: 8.11%, 86: 8.42%, 87: 8.75%, 88: 9.09%, 89: 9.55%, 90: 10.01%, 91: 10.54%, 92: 11.11%, 93: 11.70%, 94: 12.34%, 95+: 20.00%) | pinned | CRA "RRIF minimum withdrawal factors" (this schedule is stable, published values; the 20% factor at age 95+ is the legislated cap) | https://www.canada.ca/en/revenue-agency/services/tax/individuals/retirement-savings-plans/registered-retirement-income-fund.html |
| `tfsa.annualLimit` | $7,000 | CRA indexation page "Annual TFSA dollar limit" (2026) and CRA "MP, DB, RRSP, DPSP, ALDA, TFSA limits, YMPE and the YAMPE" table | https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html · https://www.canada.ca/en/revenue-agency/services/tax/registered-plans-administrators/pspa/mp-rrsp-dpsp-tfsa-limits-ympe.html |
| `tfsa.cumulativeRoomAsOf2026` | $109,000 | Sum of published annual TFSA limits 2009–2026 (5,000×4 + 5,500×5 + 10,000 + 6,000×4 + 6,500 + 7,000×3 = $109,000), as published by TD Bank ("2026 — cumulative limit $109,000") and iA Financial ("contribution limit of $109,000 in 2026") | https://www.td.com/ca/en/personal-banking/personal-investing/learn/tfsa-contribution-room-withdrawal-rules · https://ia.ca/advice-zone/finances/rrsp-tfsa-fhsa-contribution-limits |
| `tfsa.roomStartAge` | 18 | TFSA eligibility begins at age 18 with a valid SIN (CRA TFSA page) | https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/tax-free-savings-account.html |
| `rrsp.incomeRate` | 0.18 (18%) | CRA RRSP rules: new RRSP room = 18% of prior-year earned income (to the annual limit) | https://www.canada.ca/en/revenue-agency/services/tax/individuals/topics/rrsps-related-plans/contributing/contribution-limit.html |
| `rrsp.annualLimit` | $33,810 | CRA "What's new — Savings and pension plan administration" ("2026 RRSP limit will be $33,810") and CRA MP/DB/RRSP limits table | https://www.canada.ca/en/revenue-agency/services/tax/registered-plans-administrators/whats-new.html · https://www.canada.ca/en/revenue-agency/services/tax/registered-plans-administrators/pspa/mp-rrsp-dpsp-tfsa-limits-ympe.html |

## Interpretation notes / known simplifications recorded in the table

1. **Ontario surtax thresholds are tax dollars, not taxable income.** The plan's schema field
   is named `onTaxOverPctOfTaxable`; the CRA expresses the thresholds as dollar amounts of
   *basic Ontario tax* ($5,818 and $7,446 for 2026). The field name is kept verbatim for schema
   compatibility, but the stored values are the CRA tax-dollar thresholds and the surtax
   applies to the excess of basic ON tax over them, per T4032-ON.
2. **Ontario surtax above tier B is 56% combined** (20% over tier A + 36% over tier B), not a
   net 36%, per the official T4032 "Surtax" section — this corrects the plan prose
   (Task 5's tests will pin the official behaviour).
3. **Federal BPA phase-down is out of scope for the stored value**: the maximum BPA ($16,452 for
   net income ≤ $181,440) is stored; the legislated reduction to $14,829 for net income
   between $181,440 and $258,482 is a known v1 simplification, not performed by the engine (documented
   here and in `docs/assumptions.md` when it ships).
4. **Ontario's fixed brackets**: $150,000 and $220,000 are legislatively unindexed (TaxTips
   note). `applyIndexation` applies the ON factor uniformly, so multi-year scaling of those two
   thresholds is a documented simplification.
5. **OAS `annualMax` uses the age 65–74 rate** ($742.31/mo × 12). The 75+ rate ($816.54/mo) and
   OAS deferral adjustments are not modeled in v1.
6. **GIS `annualMaxSingle` uses the January–March 2026 quarter**; GIS maximums are adjusted
   quarterly, and the engine uses a single annualized figure for planning. Top-ups are included
   in the ESDC maximum-footnote figure and therefore in ours.
7. **GIS employment exclusion**: v1 applies only the first exemption tier ($5,000 full
   exemption); the 50% band between $5,000 and $15,000 is a fast-follow, per ESDC footnote 6.
8. **Age-credit elimination point**: the table stores amount / reduction threshold / 15%
   reduction rate; the derived net-income point where the credit reaches zero in 2026 is
   ≈ $107,819 (threshold + amount ÷ rate), following the Worksheet 5000-D1 formula.
9. **Credit amounts scale under projection** (engine-level decision, 2026-11-08 review): the
   $2,000 pension income amount is statutory for the base tax year and the age amount is
   annually indexed; for multi-year projections `applyIndexation` scales BOTH the age and
   pension credit amounts and their thresholds by the federal indexation factor, so projected
   years treat them in the same indexed terms as brackets/BPA. The stored base-year values
   are exact; only future-year extrapolation is approximated.
10. **Indexation is applied geometrically**: `applyIndexation(tables, n)` raises each
   jurisdiction's own factor to the n-th power; the factors themselves do not compound on
   themselves, per the plan. Real future-year factors drift from this approximation (published
   each November); re-verify when a new tax year is modelled directly.
