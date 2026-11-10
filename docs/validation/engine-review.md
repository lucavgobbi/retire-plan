# Engine review: flow allocation, non-reg ACB, and golden reference

Reviewed commits `dd2aa6c`, `7fc1ba9`, and `87fc0ed` against the Phase 1 plan, design spec, and `docs/assumptions.md`.

## Findings and resolutions

### Resolved — Production stepper surplus flow bypassed the reviewed helper

`packages/engine/src/simulate.ts:319-355` reimplements surplus allocation instead of using `allocateSurplus`; `:362-428` similarly reimplements deficit allocation instead of using `fundDeficit`. The helpers' unit tests therefore do not exercise the production behavior. There are already observable differences:

- At `simulate.ts:351-354`, mortgage prepayment takes the entire remaining surplus with no debt cap. Reproduction: a valid working plan with $10,000 after-tax surplus, a $2,500 mortgage balance, and a sole `mortgage-prepay` policy step reports `$10,000` in `savings.mortgage`; only $2,500 can reduce debt, and the other $7,500 disappears from net worth. The helper at `accounts/flows.ts:114-119` caps the prepayment, but the stepper does not.
- At `simulate.ts:322`, a step is skipped at `age >= untilAge`; `accounts/flows.ts:43-45` keeps it active through `untilAge` and only skips when `age > untilAge`.

**Resolution:** `simulate` now calls `allocateSurplus`, passing the post-scheduled-payment mortgage debt. The helper caps prepayment and returns any terminal remainder as cash; `YearResult.balances.cash` carries that reserve into net worth and future obligations. The stepper and helper both keep `untilAge` inclusive. Regressions cover cap, retained cash, net-worth conservation, inclusive age, and no duplicate cash after a non-reg sweep.

The allocator also receives explicit account-presence flags and skips TFSA, RRSP/match, or non-reg targets the plan cannot hold. When no account can accept the surplus, the amount remains in cash. Direct-helper and stepper regressions cover all missing account types and ledger conservation.

### Resolved — Simulation could not seed non-reg ACB below market value

`packages/engine/src/simulate.ts:150-154` initializes aggregate `nonregBook` to the sum of current non-reg balances. Fresh contributions and home-sale proceeds also add equal amounts to market and book (`:232-235`, `:429-442`), withdrawals consume the same amount from both when the ratio is 1, and growth adds the same dollar change to each (`:444-459`). Consequently, ordinary simulated plans keep book equal to market and realize no non-reg capital gains. The added tax path at `:396-417` is never exercised by a positive gain from any valid initial plan. The ACB unit tests use a $6,000 book on $10,000 market, but that state cannot be represented by `Plan`.

**Resolution:** `AccountPlan.bookValue` is an optional, validated non-reg ACB input and defaults to market value for backwards compatibility. The aggregate basis is seeded from these values. A stepper regression now exercises a taxable non-reg draw.

### Resolved — Deficit non-reg draws did not gross up for their tax

At `packages/engine/src/simulate.ts:400-416`, a non-reg draw is capped at the pre-tax `need`, then its realized-gain tax is deducted from that amount. The loop does not gross up the draw from that same account to cover the tax it creates. Once non-reg basis below market is representable (see finding above), a deficit funded only from non-reg can report a shortfall despite an available balance. For example, with $100,000 market / $60,000 basis, a $1,000 net need, and a 25% marginal rate, the draw realizes $400 of gain; after 50% inclusion, tax is $50. The stepper draws $1,000, leaves a $50 shortfall, and still has $99,000 invested.

**Resolution:** Non-reg draws now iterate proceeds to deliver the requested net amount after tax, bounded by market value, using the current income shape including prior RRSP draws. Capital losses offset current-year gains only; unused losses do not carry forward or reduce ordinary income. This v1 limit is documented and tests cover gain-driven gross-up.

### Resolved — Book above market was silently clamped to zero realized loss

`packages/engine/src/accounts/nonreg.ts:58-63` clamps `book / market` to at most 1. A book-above-market withdrawal is therefore treated as having no capital loss, and a full liquidation leaves phantom book behind. Direct reproduction: `nonregWithdrawal({market: 100, book: 150}, 100, 100)` returns `realizedGain: 0`, `newMarket: 0`, `newBook: 50`. That violates the ledger relationship between disposed proceeds and basis and discards a $50 capital loss.

**Resolution:** The withdrawal helper permits a basis-to-market ratio above one, recognizes negative proceeds-minus-basis results, and consumes all basis on full liquidation. Unused losses are not carried forward (documented approximation). Partial and full liquidation tests cover the below-ACB case.

### Resolved — A return below -100% created negative account balances

`packages/engine/src/accounts/nonreg.ts:34-37` returns negative market/book values when a loss exceeds 100%; the account update in `simulate.ts:460-464` has the same issue for every account type. `ReturnSeries` is caller-supplied and Monte Carlo uses an unbounded Gaussian, so these values are not rejected at the boundary. Reproduction: a 100% equity account with a `-1.5` equity return ends the year at `-50` from an initial `100`, violating the no-negative-balances invariant.

**Resolution:** Every investment account is floored at zero after growth. A total non-reg wipeout resets basis to zero. Unit and stepper tests cover returns below -100%.

### Resolved — RRIF factors differed from the CRA “All other RRIFs” schedule

The initial table used several factors that differed from CRA's prescribed column, including ages 80, 90, and 94. The full age 71–94 schedule is now updated in the JSON table and source registry; the age 95+ cap remains 20%. Tests pin every factor against the independently verified schedule at the official CRA chart URL.

### Resolved — Projection-year tax parameters remained at 2026 values

The stepper previously called tax and benefit calculations with the same base-year table for the full horizon. It now applies the federal and Ontario indexation factors for `birthYear + age - tableYear` on each simulated year. The independent golden reference derives those indexed thresholds independently; the first-year tax pin remains unchanged, and the first three years agree with the corrected reference. Regression checks cover federal and provincial tax separately.

The $2,000 federal pension income amount is fixed by statute and does not index; `applyIndexation` now preserves it. GIS in the stepper already excluded OAS; a new integration regression confirms the behavior.

### Resolved — OAS recovery tax could exceed the OAS payment

The raw recovery calculation is now capped at OAS paid in the simulated year. A high-income year before OAS starts has no recovery charge; after the stream starts, recovery cannot exceed the benefit received. Regressions cover delayed OAS and a recovery amount above the annual benefit.

## Validation run

- `npm test -w packages/engine`: passed, 186 tests in 18 files.
- `npx tsc --noEmit -p packages/engine`: passed.
- First-year golden pins remain unchanged. Later golden years are reconciled against the independently indexed reference calculator.

