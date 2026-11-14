/**
 * Shared, reusable explanatory copy for the projection dashboard charts.
 * Concise and accurate: what the chart shows and how to interpret it —
 * not raw data (the plots keep their own accessible labels and ticks).
 */
export const NET_WORTH_HELP =
  "Stacked bars of what the household OWNS at each age, by account and asset type: registered and " +
  "non-registered investments, total cash (named accounts + reserve), home and other assets. This " +
  "stack is GROSS assets: the height of the bars alone does not tell you whether spending is " +
  "affordable. DEBT is drawn below the zero line and is never counted as owned. The short marker on " +
  "each bar is the authoritative NET worth — gross assets minus debt — always equal to the engine's " +
  "netWorth for that year. Whether the plan actually sustains its spending is judged by the year " +
  "table's funding and shortfall warnings (and the fail banner), not by the bar heights. Amounts are " +
  "today's dollars (real terms), so bars are comparable across ages.";

export const INCOME_SPEND_HELP =
  "The line is total annual income (employment, CPP, OAS, GIS, other, plus taxable cash-account " +
  "interest); the band is total modelled spending. When the line sits above the band the year " +
  "funds itself; when the band rises above the line, the gap is funded by withdrawals — the " +
  "year table's shortfall column shows anything that could not be funded at all.";

export const TAX_HELP =
  "Stacked areas of the four modelled tax components at each age: federal, provincial, Ontario " +
  "surtax and the OAS recovery tax (clawback). The top of the stack is the total income tax for " +
  "the year, matching the year table. Higher stacks usually mean higher RRIF/RRSP withdrawals " +
  "that year — the drawdown chart shows which accounts funded them.";

export const DRAWDOWN_HELP =
  "Stacked areas of account balances at each age: TFSA, RRSP, non-registered investments, total " +
  "cash (named accounts plus reserve) and other assets. The home is NOT included, and neither is " +
  "debt — the top of the stack is financial account and other-asset value only, not net worth. A " +
  "series flattening to zero shows that account being drawn down; use the net worth chart for the " +
  "after-debt, with-home total.";

export const INCOME_SOURCES_HELP =
  "Stacked areas splitting each year's income by source: employment, other income, cash-account " +
  "interest, CPP, OAS and GIS. Cash interest is the top-level interest earned by cash accounts " +
  "(a separate series, never merged into other income, so sources are not double-counted). The " +
  "shift from employment to public benefits over time is visible here; the total matches the " +
  "income line in the income vs spending chart.";

export const ACCOUNT_FLOWS_HELP =
  "Per-year bars of money moving through each account: contributions stacked ABOVE the zero line " +
  "(TFSA, RRSP, non-registered, cash) and withdrawals stacked BELOW it. Withdrawal bars are the " +
  "actual amounts drawn out that year — including required RRIF minimums — not negative wealth; " +
  "account balances themselves live in the net worth and drawdown charts.";

export const CONTRIBUTION_ROOM_HELP =
  "Remaining TFSA and RRSP contribution headroom at each age, as tracked by the engine's " +
  "contribution-room rules. A line reaching zero means the room is fully used. TFSA withdrawals " +
  "restore that room the FOLLOWING year; RRSP withdrawals do NOT restore room — RRSP room only " +
  "grows from new earned income or unused carry-forward, and contributions consume it.";
