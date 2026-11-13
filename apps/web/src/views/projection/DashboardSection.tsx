import type { SimulationResult } from "@retire-plan/engine";
import { useProjectionRun } from "../../store/api";
import {
  drawdownSeries,
  incomeSpendSeries,
  netWorthBarSeries,
  taxStackSeries,
} from "./charts/adapters";
import { PALETTE, STACK_COLORS } from "./charts/palette";
import { ChartCard } from "./charts/ChartCard";
import { DrawDownChart } from "./charts/DrawDownChart";
import { IncomeSpendChart } from "./charts/IncomeSpendChart";
import { NetWorthChart } from "./charts/NetWorthChart";
import { TaxStackChart } from "./charts/TaxStackChart";
import { DRAWDOWN_HELP, INCOME_SPEND_HELP, NET_WORTH_HELP, TAX_HELP } from "./charts/chartHelpContent";

/** Dashboard charts above the year table; each chart reads its data via an adapter. */
export function DashboardSection({ result }: { result?: SimulationResult }) {
  const { run, runProjection, error, isRunning, cancelRun, runCancelled } = useProjectionRun();
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

  // Non-finite values anywhere already degrade to null points inside the adapters.
  const charts = [
    {
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
      title: "Income vs spending",
      subtitle: "Total annual income line with the spending band",
      ariaLabel: "Income versus spending chart",
      legend: [{ label: "Income", color: PALETTE.color1 }, { label: "Spending", color: PALETTE.color3 }],
      help: INCOME_SPEND_HELP,
      body: <IncomeSpendChart points={incomeSpendSeries(result.years)} />,
    },
    {
      title: "Tax by component",
      subtitle: "Federal + provincial + surtax + OAS clawback",
      ariaLabel: "Tax by component chart",
      legend: ["Federal", "Provincial", "Surtax", "OAS clawback"].map((label, i) => ({ label, color: STACK_COLORS[i]! })),
      help: TAX_HELP,
      body: <TaxStackChart points={taxStackSeries(result.years)} />,
    },
    {
      title: "Account drawdown",
      subtitle: "TFSA · RRSP · Non-registered · cash accounts + reserve balances",
      ariaLabel: "Account drawdown chart",
      legend: ["TFSA", "RRSP", "Non-registered", "Cash accounts + reserve", "Other assets"].map((label, i) => ({ label, color: STACK_COLORS[i]! })),
      help: DRAWDOWN_HELP,
      body: <DrawDownChart points={drawdownSeries(result.years)} />,
    },
  ];

  return (
    <section aria-label="Dashboard" className="dashboard">
      <div className="chart-grid">
        {charts.map((chart) => (
          <ChartCard key={chart.title} title={chart.title} subtitle={chart.subtitle} ariaLabel={chart.ariaLabel} legend={chart.legend} help={chart.help}>
            {chart.body}
          </ChartCard>
        ))}
      </div>
    </section>
  );
}
