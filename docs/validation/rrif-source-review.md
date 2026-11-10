# RRIF source and engine review

## Official CRA factors

Verified against the CRA's current [Chart – Prescribed factors](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/completing-slips-summaries/t4rsp-t4rif-information-returns/payments/chart-prescribed-factors.html), using the **All other RRIFs** column:

| Age | Factor | Age | Factor | Age | Factor |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 71 | 5.28% | 80 | 6.82% | 89 | 10.99% |
| 72 | 5.40% | 81 | 7.08% | 90 | 11.92% |
| 73 | 5.53% | 82 | 7.38% | 91 | 13.06% |
| 74 | 5.67% | 83 | 7.71% | 92 | 14.49% |
| 75 | 5.82% | 84 | 8.08% | 93 | 16.34% |
| 76 | 5.98% | 85 | 8.51% | 94 | 18.79% |
| 77 | 6.17% | 86 | 8.99% | 95+ | 20.00% |
| 78 | 6.36% | 87 | 9.55% |  |  |
| 79 | 6.58% | 88 | 10.21% |  |  |

The implementation and complete pinned schedule match this column. CRA also publishes separate factors for qualifying RRIFs and pre-March 1986 RRIFs; this engine models the All other RRIFs column.

## Engine review signoff

Reviewed the current uncommitted engine diff against the remediation findings and `docs/assumptions.md`. The previously identified surplus double count is fixed: a default sweep sets the leftover to zero before the allocator returns cash. Policy steps for absent account types are skipped, with helper and stepper regressions. The `untilAge` boundary is inclusive, matching the documented contract. Seeded non-registered ACB, grossed-up non-registered withdrawals, capital-loss handling, zero floors on account returns, and cash reserve flows are internally consistent with the documented model. Projection-year indexation is wired through tax calculations; the statutory $2,000 federal pension income amount remains fixed. OAS recovery is capped at the OAS benefit received.

**Engine gate: approved.** Builder reports 186/186 engine tests passing and `tsc --noEmit` passing. Cross-check report cleanup is tracked separately.
