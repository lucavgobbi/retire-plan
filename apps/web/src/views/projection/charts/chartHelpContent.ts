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

export const SPENDING_BREAKDOWN_HELP =
  "How the annual spending total splits across the expense items in your plan, one stacked band " +
  "per item at each age. Each item keeps its own colour from the first year onward. A run made " +
  "before per-item amounts were captured cannot be split honestly — it shows a run-again note " +
  "instead of invented data.";

export const RRIF_RRSP_HELP =
  "Compares the RRSP withdrawals actually taken each year with the mandatory RRIF minimum the " +
  "engine applies once minimums are active. Before that there is no minimum line — the gap is " +
  "real, not missing data. When the required minimum rises above what you would choose to draw, " +
  "the two lines converge: withdrawals become forced. Descriptive only — it does not recommend a " +
  "withdrawal amount.";

export const OAS_KEPT_HELP =
  "Old Age Security split into what you keep and what is charged back. Gross OAS is the benefit " +
  "as received; the OAS clawback (recovery tax) is charged when net income is above the recovery " +
  "threshold; what remains is the OAS you keep. Kept plus clawback always equals the gross OAS, " +
  "and the clawback never exceeds the OAS received. GIS is not shown because a GIS charge-back " +
  "amount is not recorded.";

export const MC_FAN_HELP =
  "Monte Carlo only. The shaded band spans the 10th to 90th percentile of net worth across ALL " +
  "simulated market paths at each age — not one path — and the dashed line inside is the median " +
  "(50th percentile). A wider band means outcomes differ more between paths. This is a range " +
  "across simulations, not a guarantee for any single future. A run made before per-age " +
  "statistics were captured shows a run-again note instead of a synthetic range.";

export const SHORTFALL_RISK_HELP =
  "Monte Carlo only. At each age, the share of simulated paths that have run a shortfall — spent " +
  "more money than they had — in that year or any earlier year. The axis is fixed from 0% to " +
  "100% and the value only ever rises with age. It describes the simulated paths, not advice, " +
  "and the tooltip shows how many paths were simulated at that age.";
