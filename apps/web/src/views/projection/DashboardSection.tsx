import type { SimulationResult } from "@retire-plan/engine";
import { useProjectionRun, useWorkspace } from "../../store/api";
import {
  accountFlowsSeries,
  contributionRoomSeries,
  drawdownSeries,
  incomeSpendSeries,
  incomeSourcesSeries,
  netWorthBarSeries,
  taxStackSeries,
} from "./charts/adapters";
import { PALETTE, STACK_COLORS } from "./charts/palette";
import { ChartCard } from "./charts/ChartCard";
import { AccountFlowsChart } from "./charts/AccountFlowsChart";
import { ContributionRoomChart } from "./charts/ContributionRoomChart";
import { DrawDownChart } from "./charts/DrawDownChart";
import { IncomeSourcesChart } from "./charts/IncomeSourcesChart";
import { IncomeSpendChart } from "./charts/IncomeSpendChart";
import { NetWorthChart } from "./charts/NetWorthChart";
import { TaxStackChart } from "./charts/TaxStackChart";
import {
  ACCOUNT_FLOWS_HELP,
  CONTRIBUTION_ROOM_HELP,
  DRAWDOWN_HELP,
  INCOME_SOURCES_HELP,
  INCOME_SPEND_HELP,
  NET_WORTH_HELP,
  TAX_HELP,
} from "./charts/chartHelpContent";
import { sanitizeHiddenIds } from "./hiddenIds";

/** Stable dashboard chart ids (persisted in hiddenProjectionCharts) with picker labels. */
export const PROJECTION_CHARTS: { id: string; title: string }[] = [
  { id: "net-worth", title: "Net worth" },
  { id: "income-spend", title: "Income vs spending" },
  { id: "income-sources", title: "Income sources" },
  { id: "tax", title: "Tax by component" },
  { id: "account-flows", title: "Contributions vs withdrawals" },
  { id: "drawdown", title: "Account drawdown" },
  { id: "contribution-room", title: "Contribution room" },
];

/** Dashboard charts above the year table; each chart reads its data via an adapter. */
export function DashboardSection({ result }: { result?: SimulationResult }) {
  const { run, runProjection, error, isRunning, cancelRun, runCancelled } = useProjectionRun();
  const { workspace } = useWorkspace();
  if (!result) {
    // Standalone use (charts tests / direct tab state): run on demand here.
    if (!run) {
      return (
        <section aria-label="Dashboard" className="dashboard empty-state">
          <p className="hint">Run the projection to populate the dashboard charts.</p>
          <button type="button" disabled={isRunning} onClick={() => { void runProjection(); }}>
            Run projection
          </button>
          {isRunning && <><p role="status">Projection running in the background…</p><button type="button" onClick={cancelRun}>Cancel projection</button></>}
          {runCancelled && <p role="status">Projection cancelled.</p>}
          {error && <p role="alert">The projection could not run: {error}</p>}
        </section>
      );
    }
    result = run.result;
  }

  // Chart visibility: the workspace persists HIDDEN chart ids (absent or empty =
  // all charts visible, so charts added later default visible; stale ids dropped).
  const hiddenCharts = sanitizeHiddenIds(workspace.hiddenProjectionCharts, PROJECTION_CHARTS.map((chart) => chart.id));

  // Non-finite values anywhere already degrade to null points inside the adapters.
  const charts = [
    {
      id: "net-worth",
      title: "Net worth",
      subtitle: "Stacked owned balances by account type, debt below zero, net worth marker (today's dollars)",
      ariaLabel: "Net worth chart",
      legend: [
        ...["TFSA", "RRSP", "Non-registered", "Cash", "Home", "Other assets"].map((label, i) => ({ label, color: STACK_COLORS[i % STACK_COLORS.length]! })),
        { label: "Debt (owed, below zero)", color: "rgba(220, 38, 38, 0.55)" },
        { label: "Net worth marker", color: PALETTE.ink },
      ],
      help: NET_WORTH_HELP,
      body: <NetWorthChart points={netWorthBarSeries(result.years)} />,
    },
    {
      id: "income-spend",
      title: "Income vs spending",
      subtitle: "Total annual income line with the spending band",
      ariaLabel: "Income versus spending chart",
      legend: [{ label: "Income", color: PALETTE.color1 }, { label: "Spending", color: PALETTE.color3 }],
      help: INCOME_SPEND_HELP,
      body: <IncomeSpendChart points={incomeSpendSeries(result.years)} />,
    },
    {
      id: "income-sources",
      title: "Income sources",
      subtitle: "Employment · other income · cash interest · CPP · OAS · GIS",
      ariaLabel: "Income sources chart",
      legend: ["Employment", "Other income", "Cash interest", "CPP", "OAS", "GIS"].map((label, i) => ({ label, color: STACK_COLORS[i % STACK_COLORS.length]! })),
      help: INCOME_SOURCES_HELP,
      body: <IncomeSourcesChart points={incomeSourcesSeries(result.years)} />,
    },
    {
      id: "tax",
      title: "Tax by component",
      subtitle: "Federal + provincial + surtax + OAS clawback",
      ariaLabel: "Tax by component chart",
      legend: ["Federal", "Provincial", "Surtax", "OAS clawback"].map((label, i) => ({ label, color: STACK_COLORS[i]! })),
      help: TAX_HELP,
      body: <TaxStackChart points={taxStackSeries(result.years)} />,
    },
    {
      id: "account-flows",
      title: "Contributions vs withdrawals",
      subtitle: "Money into accounts above zero, withdrawn below zero, by account",
      ariaLabel: "Account flows chart",
      legend: [
        ...["TFSA", "RRSP", "Non-registered", "Cash"].map((label, i) => ({ label: `${label} contributions`, color: STACK_COLORS[i]! })),
        // Withdrawal swatches reuse the account color at reduced alpha (8-digit hex).
        ...["TFSA", "RRSP", "Non-registered", "Cash"].map((label, i) => ({ label: `${label} withdrawals (below zero)`, color: `${STACK_COLORS[i]}59` })),
      ],
      help: ACCOUNT_FLOWS_HELP,
      body: <AccountFlowsChart points={accountFlowsSeries(result.years)} />,
    },
    {
      id: "drawdown",
      title: "Account drawdown",
      subtitle: "TFSA · RRSP · Non-registered · cash accounts + reserve balances",
      ariaLabel: "Account drawdown chart",
      legend: ["TFSA", "RRSP", "Non-registered", "Cash accounts + reserve", "Other assets"].map((label, i) => ({ label, color: STACK_COLORS[i]! })),
      help: DRAWDOWN_HELP,
      body: <DrawDownChart points={drawdownSeries(result.years)} />,
    },
    {
      id: "contribution-room",
      title: "Contribution room",
      subtitle: "Remaining TFSA and RRSP headroom; zero = room fully used",
      ariaLabel: "Contribution room chart",
      legend: [{ label: "TFSA room", color: PALETTE.color1 }, { label: "RRSP room", color: PALETTE.color2 }],
      help: CONTRIBUTION_ROOM_HELP,
      body: <ContributionRoomChart points={contributionRoomSeries(result.years)} />,
    },
  ].filter((chart) => !hiddenCharts?.includes(chart.id));

  return (
    <section aria-label="Dashboard" className="dashboard">
      <div className="chart-grid">
        {charts.map((chart) => (
          <ChartCard key={chart.id} title={chart.title} subtitle={chart.subtitle} ariaLabel={chart.ariaLabel} legend={chart.legend} help={chart.help}>
            {chart.body}
          </ChartCard>
        ))}
      </div>
    </section>
  );
}
