/**
 * Assumptions & simplifications registry (plan Task 9, Lane E).
 *
 * SOURCE OF TRUTH: docs/assumptions.md — this registry mirrors its current sections
 * (2026-11-10). Keep-in-sync rule: a new engine assumption lands in BOTH files in the
 * same change (reviewer checklist). Any doc edit re-syncs this list.
 */

export interface AssumptionEntry {
  id: string;
  title: string;
  category: "exact" | "approximation" | "deferred";
  since: string;
  body: string;
}

export const TAX_MINIMIZING_STRATEGY_HELP =
  "A bounded planning heuristic requires full funding in every modeled year, then prioritizes total income tax through your end age; it is not a global optimum. In years with a planned draw, employee RRSP savings-policy steps are skipped to avoid draw-and-redeposit circularity. Employer-match RRSP deposits and other savings rules remain available; remaining surplus follows those rules or is retained as cash. Stochastic outcomes can differ from the planning comparison.";

export const ASSUMPTIONS: AssumptionEntry[] = [
  {
    id: "mortgage-rate-convention",
    title: "Mortgage rate is nominal, compounded monthly",
    category: "approximation",
    since: "v1",
    body: "A quoted Canadian rate is used as a nominal annual rate compounded monthly. Canadian mortgages conventionally compound semi-annually, so the effective cost differs slightly. Enter quoted rates exactly as quoted; do not de-annualize.",
  },
  {
    id: "negative-amortization",
    title: "Negative amortization warns, never blocks",
    category: "approximation",
    since: "v1",
    body: "If a mortgage payment cannot cover the month's interest the balance rises; the stepper emits a warning for the year. The plan continues to run.",
  },
  {
    id: "tax-indexation-top-brackets",
    title: "Ontario's top two brackets are indexed uniformly",
    category: "approximation",
    since: "v1",
    body: "Ontario's $150,000 and $220,000 bracket thresholds are legislatively unindexed in reality; the engine applies uniform Ontario indexation to all brackets as a documented simplification.",
  },
  {
    id: "oas-recovery-cap",
    title: "OAS recovery tax is capped at the OAS actually paid",
    category: "exact",
    since: "v1",
    body: "The OAS repayment equals 15% of the excess of net income over the threshold, capped at the OAS amount actually received that year. If OAS has not started, no recovery tax is charged even above the threshold.",
  },
  {
    id: "gis-employment-exemption",
    title: "GIS excludes only the first $5,000 of employment income",
    category: "approximation",
    since: "v1",
    body: "The CRA 50% band between $5,000 and $15,000 of employment income is a documented fast-follow. The OAS pension itself is excluded from the GIS income test, per the official rule.",
  },
  {
    id: "projection-year-tax-indexation",
    title: "Per-year tax indexation is extrapolated from the base table",
    category: "approximation",
    since: "v1",
    body: "For age a the tax year is birthYear + a; the federal (2.0%) and Ontario (1.9%) factors scale brackets, indexed credits, Ontario surtax thresholds and the OAS recovery threshold from the 2026 base table. The federal pension income amount stays at its statutory $2,000 cap. Annually announced parameters (RRIF factors, TFSA/RRSP limits, OAS/GIS maximums) stay at base-table amounts — future announcements are not forecast.",
  },
  {
    id: "rrif-prescribed-factors",
    title: "RRIF minimums use the official 'All other RRIFs' factor chart",
    category: "exact",
    since: "v1",
    body: "CRA prescribed factors, ages 71–94, with the 20% factor from age 95 onward. Qualifying and legacy RRIF columns are not modeled.",
  },
  {
    id: "rrsp-room-in-year",
    title: "Earned RRSP room is contributable in the same year",
    category: "approximation",
    since: "v1",
    body: "CRA formally makes a year's earned room contributable the FOLLOWING calendar year; the allocator treats it as available that year. The employer pension adjustment is applied once, at the year-end room roll.",
  },
  {
    id: "rrif-minimum-tax",
    title: "RRIF minimum pricing is included in the year's funding decision",
    category: "approximation",
    since: "v1",
    body: "The mandatory RRIF minimum's marginal tax is priced into the year's obligation, so a year funded only by the minimum lands in the branch it really belongs to.",
  },
  {
    id: "deficit-gross-up",
    title: "RRSP deficit draws are grossed up to their own tax",
    category: "approximation",
    since: "v1",
    body: "RRSP draws iterate to a self-consistent gross amount (draw = need + its own marginal tax); any residual after convergence is drawn, taken from the next account in the withdrawal order, or recorded as shortfall.",
  },
  {
    id: "final-mortgage-year",
    title: "Final mortgage cash is capped at balance plus interest",
    category: "approximation",
    since: "v1",
    body: "A partial final mortgage year does not bill payments that were never due.",
  },
  {
    id: "unmatched-policy-steps",
    title: "Savings steps aimed at absent account types are skipped",
    category: "approximation",
    since: "v1",
    body: "A step targeting an account type the plan does not hold is skipped; its money stays in the surplus default. Unallocated surplus defaults to non-registered only when a non-registered account exists.",
  },
  {
    id: "employer-rrsp-match",
    title: "Employer RRSP match is an income-side inflow",
    category: "approximation",
    since: "v1",
    body: "Match contributions land in the RRSP tax-free and consume RRSP room through the pension adjustment.",
  },
  {
    id: "gis-sequencing",
    title: "GIS uses this year's income but LAST year's withdrawals",
    category: "approximation",
    since: "v1",
    body: "GIS is evaluated on this year's income streams but the prior year's RRSP/TFSA withdrawals — a single-pass sequencing simplification. Prior-year realized capital gains also feed the GIS income test.",
  },
  {
    id: "projection-cash-reserve",
    title: "Cash is tracked even without a starting cash account",
    category: "approximation",
    since: "v1",
    body: "Cash appears in year results when surplus remains after a terminal mortgage-prepayment step or when no eligible investment account can receive it. The reserve earns no return and funds later-year obligations before investment withdrawals.",
  },
  {
    id: "nonreg-acb",
    title: "Non-registered basis (ACB) is aggregate across accounts",
    category: "approximation",
    since: "v1 (Task 14)",
    body: "Basis is tracked as an aggregate; flows distribute proportionally to balance so the book/market ratio is exact under that distribution. AccountPlan.bookValue seeds current basis; omitted defaults to market value (no embedded gains assumed). Contributions and home-sale proceeds enter at par. Withdrawals consume basis pro rata; full liquidation may realize a capital loss.",
  },
  {
    id: "capital-losses",
    title: "Losses offset same-year gains only",
    category: "approximation",
    since: "v1",
    body: "Realized losses can offset realized gains in the same modeled year; taxable capital gains floor at zero and unused losses are not carried forward or applied against ordinary income.",
  },
  {
    id: "nonreg-draw-gains-tax",
    title: "Non-reg draws carry their own gains tax",
    category: "approximation",
    since: "v1",
    body: "In the deficit branch each non-reg draw is grossed up to deliver the requested net amount after its own realized-gain tax; the charged tax is folded component-wise into annual tax. TFSA draws carry no tax.",
  },
  {
    id: "mortgage-prepay-step",
    title: "Mortgage prepay is terminal; leftover stays as projection cash",
    category: "approximation",
    since: "v1",
    body: "Prepayments are capped at the debt remaining after scheduled payments; the step is terminal in the savings policy. untilAge is inclusive: the step stays active at its specified age and stops later.",
  },
  {
    id: "investment-return-floor",
    title: "Account values cannot fall below zero",
    category: "approximation",
    since: "v1",
    body: "Returns at or below −100% wipe out the affected holdings; larger losses never create negative assets.",
  },
  {
    id: "plan-assets",
    title: "Other assets appreciate, sell at market value after sale costs",
    category: "approximation",
    since: "v1",
    body: "Every asset, including kind “other”, appreciates annually at its entered rate and contributes to net worth. balances.home stays the aggregate of primary homes; balances.otherAssets is an additive optional result field for other assets. In the configured sale year the asset leaves its balance and net sale proceeds (after entered sale costs) enter non-registered holdings or projection cash. The initial entered value serves as the sale cost-base proxy: gains after sale costs are taxed at the 50% inclusion rate (home-sale convention). V1 omits the principal-residence exemption, asset-specific cost base, depreciation/recapture and capital-loss carryovers — asset-sale losses do not reduce taxable income.",
  },
  {
    id: "realized-gains-gis-income",
    title: "Realized capital gains count in the GIS income test",
    category: "approximation",
    since: "v1",
    body: "Prior-year realized capital gains feed the GIS income test (with the employment exemption unchanged), following the existing prior-year-withdrawals sequencing.",
  },
];
