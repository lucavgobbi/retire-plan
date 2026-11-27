import type { SimulationResult } from "@retire-plan/engine";
import type { RunAnalysis } from "../../domain/run";
import type { RunRecord } from "../../domain/types";
import { useProjectionRun, useWorkspace } from "../../store/api";
import {
  accountFlowsSeries,
  contributionRoomSeries,
  drawdownSeries,
  expenseBreakdownSeries,
  incomeSpendSeries,
  incomeSourcesSeries,
  netWorthBarSeries,
  oasKeptSeries,
  ensembleStatPoints,
  rrifWithdrawalSeries,
  runCapturesRrifMinimum,
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
import { SpendingBreakdownChart } from "./charts/SpendingBreakdownChart";
import { RrifWithdrawalsChart } from "./charts/RrifWithdrawalsChart";
import { OasClawbackChart } from "./charts/OasClawbackChart";
import { EnsembleFanChart } from "./charts/EnsembleFanChart";
import { ShortfallRiskChart } from "./charts/ShortfallRiskChart";
import {
  ACCOUNT_FLOWS_HELP,
  CONTRIBUTION_ROOM_HELP,
  DRAWDOWN_HELP,
  INCOME_SOURCES_HELP,
  INCOME_SPEND_HELP,
  MC_FAN_HELP,
  NET_WORTH_HELP,
  OAS_KEPT_HELP,
  RRIF_RRSP_HELP,
  SHORTFALL_RISK_HELP,
  SPENDING_BREAKDOWN_HELP,
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
  { id: "spending-breakdown", title: "Spending breakdown" },
  { id: "rrif-rrsp", title: "RRIF vs RRSP withdrawals" },
  { id: "oas-clawback", title: "OAS kept vs clawback" },
  { id: "mc-fan", title: "Net worth range (Monte Carlo)" },
  { id: "shortfall-risk", title: "Shortfall risk by age (Monte Carlo)" },
];

/** Projection dashboard charts; each chart reads its data via an adapter. */
export function DashboardSection({ result, analysis }: { result?: SimulationResult; analysis?: RunAnalysis }) {
  const { run, runProjection, error, isRunning, cancelRun, runCancelled } = useProjectionRun();
  const { workspace } = useWorkspace();
  if (!result) {
    // Standalone use (charts tests / direct tab state): run on demand here.
    if (!run) {
      return (
        <section aria-label="Dashboard" className="dashboard empty-state">
          <p className="hint">Run the projection to populate the dashboard charts.</p>
          <button
            type="button"
            disabled={isRunning}
            onClick={() => {
              void runProjection();
            }}
          >
            Run projection
          </button>
          {isRunning && (
            <>
              <p role="status">Projection running in the background…</p>
              <button type="button" onClick={cancelRun}>
                Cancel projection
              </button>
            </>
          )}
          {runCancelled && <p role="status">Projection cancelled.</p>}
          {error && <p role="alert">The projection could not run: {error}</p>}
        </section>
      );
    }
    result = run.result;
    analysis = run.analysis;
  }

  const charts = dashboardCharts(dashboardData(result, analysis));
  return (
    <section aria-label="Dashboard" className="dashboard">
      <div className="chart-grid">
        {charts
          .filter((chart) => !workspace.hiddenProjectionCharts?.includes(chart.id))
          .map((chart) => (
            <ChartCard key={chart.id} {...chart}>
              {chart.body}
            </ChartCard>
          ))}
      </div>
    </section>
  );
}

function dashboardData(result: SimulationResult, analysis?: RunAnalysis) {
  const { years } = result;
  const mcAnalysis = analysis?.mode === "montecarlo" ? analysis : undefined;
  return {
    netWorth: netWorthBarSeries(years),
    incomeSpend: incomeSpendSeries(years),
    incomeSources: incomeSourcesSeries(years),
    tax: taxStackSeries(years),
    accountFlows: accountFlowsSeries(years),
    drawdown: drawdownSeries(years),
    contributionRoom: contributionRoomSeries(years),
    breakdown: expenseBreakdownSeries(years),
    rrifPoints: rrifWithdrawalSeries(years),
    capturesRrifMinimum: runCapturesRrifMinimum(years),
    oasPoints: oasKeptSeries(years),
    mcAnalysis,
    mcStats: ensembleStatPoints(mcAnalysis),
  };
}

type DashboardData = ReturnType<typeof dashboardData>;

function dashboardCharts(data: DashboardData, peers?: DashboardData[]) {
  const { breakdown, rrifPoints, oasPoints, mcAnalysis, mcStats } = data;
  const rerun = (message: string) => (
    <p className="hint" data-chart-state="rerun">
      {message}
    </p>
  );
  const mcCharts =
    mcAnalysis === undefined
      ? []
      : [
          {
            id: "mc-fan",
            title: "Net worth range (Monte Carlo)",
            subtitle: "p10–p90 band across simulated paths; dashed median (ensemble, not one path)",
            ariaLabel: "Monte Carlo net worth range chart",
            legend: [
              { label: "Middle 80% of paths (p10–p90)", color: "rgba(37, 99, 235, 0.35)" },
              { label: "Median path (p50)", color: PALETTE.color1 },
            ],
            help: MC_FAN_HELP,
            body: mcStats ? (
              <EnsembleFanChart points={mcStats} scalePoints={peers?.flatMap((peer) => peer.mcStats ?? [])} />
            ) : (
              rerun(
                "This Monte Carlo run predates per-age statistics. Run the projection again to see the range across simulated paths.",
              )
            ),
          },
          {
            id: "shortfall-risk",
            title: "Shortfall risk by age (Monte Carlo)",
            subtitle: "Share of simulated paths with any shortfall so far (0–100% fixed axis)",
            ariaLabel: "Monte Carlo shortfall risk chart",
            legend: [{ label: "Cumulative shortfall risk", color: PALETTE.color3 }],
            help: SHORTFALL_RISK_HELP,
            body: mcStats ? (
              <ShortfallRiskChart points={mcStats} scalePoints={peers?.flatMap((peer) => peer.mcStats ?? [])} />
            ) : (
              rerun(
                "This Monte Carlo run predates per-age statistics. Run the projection again to see the cumulative shortfall risk.",
              )
            ),
          },
        ];
  return [
    {
      id: "net-worth",
      title: "Net worth",
      subtitle: "Stacked owned balances by account type, debt below zero, net worth marker (today's dollars)",
      ariaLabel: "Net worth chart",
      legend: [
        ...["TFSA", "RRSP", "Non-registered", "Cash", "Home", "Other assets"].map((label, i) => ({
          label,
          color: STACK_COLORS[i % STACK_COLORS.length]!,
        })),
        { label: "Debt (owed, below zero)", color: "rgba(220, 38, 38, 0.55)" },
        { label: "Net worth marker", color: PALETTE.ink },
      ],
      help: NET_WORTH_HELP,
      body: <NetWorthChart points={data.netWorth} scalePoints={peers?.flatMap((peer) => peer.netWorth)} />,
    },
    {
      id: "income-spend",
      title: "Income vs spending",
      subtitle: "Total annual income line with the spending band",
      ariaLabel: "Income versus spending chart",
      legend: [
        { label: "Income", color: PALETTE.color1 },
        { label: "Spending", color: PALETTE.color3 },
      ],
      help: INCOME_SPEND_HELP,
      body: <IncomeSpendChart points={data.incomeSpend} scalePoints={peers?.flatMap((peer) => peer.incomeSpend)} />,
    },
    {
      id: "income-sources",
      title: "Income sources",
      subtitle: "Employment · other income · cash interest · CPP · OAS · GIS",
      ariaLabel: "Income sources chart",
      legend: ["Employment", "Other income", "Cash interest", "CPP", "OAS", "GIS"].map((label, i) => ({
        label,
        color: STACK_COLORS[i % STACK_COLORS.length]!,
      })),
      help: INCOME_SOURCES_HELP,
      body: (
        <IncomeSourcesChart points={data.incomeSources} scalePoints={peers?.flatMap((peer) => peer.incomeSources)} />
      ),
    },
    {
      id: "tax",
      title: "Tax by component",
      subtitle: "Federal + provincial + surtax + OAS clawback",
      ariaLabel: "Tax by component chart",
      legend: ["Federal", "Provincial", "Surtax", "OAS clawback"].map((label, i) => ({
        label,
        color: STACK_COLORS[i]!,
      })),
      help: TAX_HELP,
      body: <TaxStackChart points={data.tax} scalePoints={peers?.flatMap((peer) => peer.tax)} />,
    },
    {
      id: "account-flows",
      title: "Contributions vs withdrawals",
      subtitle: "Money into accounts above zero, withdrawn below zero, by account",
      ariaLabel: "Account flows chart",
      legend: [
        ...["TFSA", "RRSP", "Non-registered", "Cash"].map((label, i) => ({
          label: `${label} contributions`,
          color: STACK_COLORS[i]!,
        })),
        // Withdrawal swatches reuse the account color at reduced alpha (8-digit hex).
        ...["TFSA", "RRSP", "Non-registered", "Cash"].map((label, i) => ({
          label: `${label} withdrawals (below zero)`,
          color: `${STACK_COLORS[i]}59`,
        })),
      ],
      help: ACCOUNT_FLOWS_HELP,
      body: <AccountFlowsChart points={data.accountFlows} scalePoints={peers?.flatMap((peer) => peer.accountFlows)} />,
    },
    {
      id: "drawdown",
      title: "Account drawdown",
      subtitle: "TFSA · RRSP · Non-registered · cash accounts + reserve balances",
      ariaLabel: "Account drawdown chart",
      legend: ["TFSA", "RRSP", "Non-registered", "Cash accounts + reserve", "Other assets"].map((label, i) => ({
        label,
        color: STACK_COLORS[i]!,
      })),
      help: DRAWDOWN_HELP,
      body: <DrawDownChart points={data.drawdown} scalePoints={peers?.flatMap((peer) => peer.drawdown)} />,
    },
    {
      id: "contribution-room",
      title: "Contribution room",
      subtitle: "Remaining TFSA and RRSP headroom; zero = room fully used",
      ariaLabel: "Contribution room chart",
      legend: [
        { label: "TFSA room", color: PALETTE.color1 },
        { label: "RRSP room", color: PALETTE.color2 },
      ],
      help: CONTRIBUTION_ROOM_HELP,
      body: (
        <ContributionRoomChart
          points={data.contributionRoom}
          scalePoints={peers?.flatMap((peer) => peer.contributionRoom)}
        />
      ),
    },
    {
      id: "spending-breakdown",
      title: "Spending breakdown",
      subtitle: "Annual spending split by expense item (stacked)",
      ariaLabel: "Spending breakdown chart",
      legend: breakdown
        ? breakdown.items.map((item, i) => ({ label: item.name, color: STACK_COLORS[i % STACK_COLORS.length]! }))
        : [],
      help: SPENDING_BREAKDOWN_HELP,
      body: breakdown ? (
        breakdown.items.length === 0 ? (
          <p className="hint" data-chart-state="no-expenses">
            This plan records no expense items, so there is nothing to break down.
          </p>
        ) : (
          <SpendingBreakdownChart
            series={breakdown}
            scalePoints={peers?.flatMap((peer) => peer.breakdown?.points ?? [])}
          />
        )
      ) : (
        rerun(
          "This run predates per-item spending capture. Run the projection again to split spending by expense item.",
        )
      ),
    },
    {
      id: "rrif-rrsp",
      title: "RRIF vs RRSP withdrawals",
      subtitle: "Actual RRSP withdrawals against the mandatory RRIF minimum",
      ariaLabel: "RRIF versus RRSP withdrawals chart",
      legend: [
        { label: "Actual RRSP withdrawals", color: PALETTE.color2 },
        { label: "RRIF minimum", color: PALETTE.color1 },
      ],
      help: RRIF_RRSP_HELP,
      body: data.capturesRrifMinimum ? (
        <RrifWithdrawalsChart points={rrifPoints} scalePoints={peers?.flatMap((peer) => peer.rrifPoints)} />
      ) : (
        rerun(
          "This run predates RRIF minimum capture. Run the projection again to compare the required minimum with actual withdrawals.",
        )
      ),
    },
    {
      id: "oas-clawback",
      title: "OAS kept vs clawback",
      subtitle: "OAS received split into kept and recovery tax; kept + clawback = gross",
      ariaLabel: "OAS kept versus clawback chart",
      legend: [
        { label: "OAS kept", color: PALETTE.color2 },
        { label: "OAS clawback", color: PALETTE.color4 },
      ],
      help: OAS_KEPT_HELP,
      body: <OasClawbackChart points={oasPoints} scalePoints={peers?.flatMap((peer) => peer.oasPoints)} />,
    },
    ...mcCharts,
  ];
}

type ComparisonChartScenario = { run: RunRecord; label: string; color: string; birthYear: number; path: string };

export function ComparisonDashboard({ scenarios }: { scenarios: ComparisonChartScenario[] }) {
  const { workspace } = useWorkspace();
  const hidden = sanitizeHiddenIds(
    workspace.hiddenProjectionCharts,
    PROJECTION_CHARTS.map(({ id }) => id),
  );
  const datasets = scenarios.map(({ run }) => dashboardData(run.result, run.analysis));
  const charts = datasets.map((dataset) => dashboardCharts(dataset, datasets));
  return (
    <section aria-label="Scenario charts" className="compare-chart-groups">
      {PROJECTION_CHARTS.filter(
        ({ id }) => !hidden?.includes(id) && charts.some((items) => items.some((chart) => chart.id === id)),
      ).map(({ id, title }) => (
        <div
          key={id}
          className="compare-scenario-grid"
          data-scenario-count={scenarios.length}
          role="group"
          aria-label={title}
        >
          {scenarios.map(({ run, label, color, birthYear, path }, index) => {
            const chart = charts[index]?.find((item) => item.id === id);
            const ensemble = id === "mc-fan" || id === "shortfall-risk";
            const scenario = { label, color, birthYear, path: ensemble ? "Monte Carlo ensemble" : path };
            return chart ? (
              <ChartCard key={run.id} {...chart} scenario={scenario}>
                {chart.body}
              </ChartCard>
            ) : (
              <div className="compare-scenario-card" key={run.id} style={{ borderTopColor: color }}>
                <strong>{label}</strong>
                <p className="hint">Available for Monte Carlo runs.</p>
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
}
