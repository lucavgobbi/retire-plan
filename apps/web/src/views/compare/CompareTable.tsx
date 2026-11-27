import { formatAccountOrder } from "../../domain/accountOrder";
import type { Plan, RunRecord } from "../../domain/types";
import { fmtMoney, fmtPercent, fmtPercentInput, yearForAge } from "../projection/fmt";
import { COMPARISON_COLORS } from "./compare";
import type { Comparison, ComparisonColumn } from "./compare";

type Metric = {
  label: string;
  value: (column: ComparisonColumn) => React.ReactNode;
};

function sideBySideDelta(current: number | null, base: number | null, format: (value: number) => string) {
  if (current === null || base === null || !Number.isFinite(current - base) || current === base) return null;
  const delta = current - base;
  return (
    <span className="compare-delta">
      {delta > 0 ? "+" : "−"}
      {format(Math.abs(delta))} vs baseline
    </span>
  );
}

function yearRange(start: number, end: number) {
  return start === end ? String(start) : `${start}–${end}`;
}

export function CompareTable({ comparison, birthYear }: { comparison: Comparison; birthYear: number }) {
  const { columns, start, end, retirementStart, differentHorizons } = comparison;
  const baseline = columns[0]!;
  const money: [string, "retirementIncome" | "retirementWithdrawals" | "lifetimeTax" | "finalNetWorth"][] = [
    ["Average retirement income from streams (before tax)", "retirementIncome"],
    ["Average annual savings withdrawals in retirement", "retirementWithdrawals"],
    [differentHorizons ? "Taxes over the shared years" : "Lifetime taxes over the projection", "lifetimeTax"],
    [end === undefined ? "Net worth over the shared years" : `Net worth at shared end (${end})`, "finalNetWorth"],
  ];
  const metrics: Metric[] = [
    ...money.map(([label, key]): Metric => ({
      label,
      value: (column) => (
        <>
          {retirementStart === undefined && (key === "retirementIncome" || key === "retirementWithdrawals")
            ? "N/A"
            : fmtMoney(column[key])}
          {column !== baseline && sideBySideDelta(column[key], baseline[key], fmtMoney)}
        </>
      ),
    })),
    ...(differentHorizons
      ? [
          {
            label: "Final net worth at each path’s end",
            value: ({ actualEnd, run }: ComparisonColumn) =>
              actualEnd === undefined ? "—" : `${fmtMoney(run.result.summary.finalNetWorth)} (${actualEnd})`,
          },
        ]
      : []),
    ...(
      [
        ["First year-end with no savings", "depletion"],
        ["First year with a cash shortfall", "shortfall"],
      ] as const
    ).map(([label, key]): Metric => ({
      label,
      value: (column) => {
        const row = column[key];
        if (!row) {
          if (start === undefined || (key === "depletion" && !column.hasRetirementYear)) return "N/A";
          return key === "depletion" ? "None in shared retirement years" : "None in shared years";
        }
        const year = yearForAge(column.run.birthYear ?? birthYear, row.age);
        const baseRow = baseline[key];
        return (
          <>
            Age {row.age} ({year})
            {column !== baseline &&
              baseRow &&
              sideBySideDelta(
                year,
                yearForAge(baseline.run.birthYear ?? birthYear, baseRow.age),
                (value) => `${value} ${value === 1 ? "year" : "years"}`,
              )}
          </>
        );
      },
    })),
  ];

  const hasMode = (mode: "montecarlo" | "historical") => columns.some(({ run }) => run.analysis?.mode === mode);
  const ensemble: Metric[] = [];
  for (const [mode, label] of [
    ["montecarlo", "Monte Carlo success rate"],
    ["historical", "Share of historical windows that succeeded"],
  ] as const) {
    if (!hasMode(mode)) continue;
    ensemble.push({
      label,
      value: (column) => {
        const analysis = column.run.analysis;
        if (analysis?.mode !== mode) return "—";
        return (
          <>
            {fmtPercent(analysis.successRate)}
            {!differentHorizons &&
              column !== baseline &&
              baseline.run.analysis?.mode === mode &&
              sideBySideDelta(
                analysis.successRate,
                baseline.run.analysis.successRate,
                (value) => `${(100 * value).toFixed(1)} percentage points`,
              )}
          </>
        );
      },
    });
  }
  if (ensemble.length) {
    ensemble.push({
      label: "Median final net worth across paths (p50)",
      value: (column) => {
        const analysis = column.run.analysis;
        if (!analysis) return "—";
        const value = analysis.percentileNetWorth.p50;
        return (
          <>
            {fmtMoney(value)}
            {differentHorizons && ` (${column.actualEnd})`}
            {!differentHorizons &&
              column !== baseline &&
              baseline.run.analysis?.mode === analysis.mode &&
              sideBySideDelta(value, baseline.run.analysis.percentileNetWorth.p50, fmtMoney)}
          </>
        );
      },
    });
  }

  function metricRows(rows: Metric[]) {
    return rows.map(({ label, value }) => (
      <tr key={label}>
        <th scope="row">{label}</th>
        {columns.map((column) => (
          <td key={column.run.scenarioId ?? ""}>{value(column)}</td>
        ))}
      </tr>
    ));
  }

  return (
    <section aria-labelledby="compare-outcomes-title">
      <h3 id="compare-outcomes-title">Side-by-side outcomes</h3>
      <p className="hint">
        {start === undefined || end === undefined
          ? "These paths have no shared projection years."
          : `Shared household projection years ${yearRange(start, end)} (CAD, nominal dollars).`}
        {end !== undefined && retirementStart !== undefined
          ? ` Retirement averages use ${yearRange(retirementStart, end)}, when every selected scenario has reached retirement age.`
          : " Retirement averages are unavailable without a shared retirement period."}
        {differentHorizons &&
          start !== undefined &&
          " Path horizons differ, so path differences use only the shared years."}
      </p>
      <div className="compare-table-wrap" role="region" aria-label="Side-by-side scenario outcomes" tabIndex={0}>
        <table className="compare-table">
          <thead>
            <tr>
              <th scope="col">Measure</th>
              <ComparisonHeaders columns={columns} />
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Displayed path</th>
              {columns.map(({ run }) => (
                <td key={run.scenarioId ?? ""}>{displayedPath(run)}</td>
              ))}
            </tr>
            {metricRows(metrics)}
          </tbody>
          {ensemble.length > 0 && (
            <tbody>
              <tr className="compare-section-row">
                <th colSpan={columns.length + 1} scope="rowgroup">
                  Full-horizon ensemble results
                </th>
              </tr>
              {metricRows(ensemble)}
            </tbody>
          )}
        </table>
      </div>
      <details className="compare-definitions">
        <summary>How outcomes are measured</summary>
        <p>
          Income includes employment, CPP, OAS, GIS and other modeled income streams before tax and payroll deductions.
          It excludes employer deposits, investment interest credited to accounts, withdrawals and asset sales.
        </p>
        <p>
          Savings withdrawals count money drawn from named cash accounts, TFSA, RRSP and non-registered accounts. The
          totals include required and planned withdrawals, which may be reinvested.
        </p>
        <p>
          Taxes include federal and provincial income tax, surtax and OAS recovery. Payroll deductions are excluded.
        </p>
        <p>
          The first year-end with no savings is the first year at or after that scenario’s retirement age when cash and
          investment balances total zero, excluding property and debts. Balances can recover in later years. A cash
          shortfall is a separate outcome.
        </p>
        {ensemble.length > 0 && (
          <p>
            Path figures and the chart use a single representative simulation or historical window. The ensemble median
            uses final values from all paths. Success means no retirement cash shortfall and nonnegative final net
            worth.
          </p>
        )}
      </details>
    </section>
  );
}

export function displayedPath(run: RunRecord) {
  const analysis = run.analysis;
  if (analysis?.mode === "montecarlo") return `Representative Monte Carlo path (run ${analysis.representativeRun})`;
  if (analysis?.mode === "historical") {
    return `Representative historical path (returns from ${analysis.representativeStartYear}–${analysis.representativeEndYear}; ${analysis.windowCount} windows tested)`;
  }
  return "Deterministic projection";
}

function ComparisonHeaders({ columns }: { columns: ComparisonColumn[] }) {
  return columns.map((column, index) => (
    <th scope="col" key={column.run.scenarioId ?? ""} style={{ borderTop: `3px solid ${COMPARISON_COLORS[index]}` }}>
      {column.label}
      {index === 0 && <span className="compare-delta">Baseline</span>}
    </th>
  ));
}

const percent = (rate: number) => `${fmtPercentInput(rate)}%`;
const rates = ({ equity, bond, cash }: RunRecord["scenario"]["returnAssumptions"]) =>
  `${percent(equity)} equity · ${percent(bond)} bonds · ${percent(cash)} cash`;
const enabled = (flags: [string, boolean | undefined][]) =>
  flags
    .filter(([, applies]) => applies)
    .map(([name]) => name)
    .join(", ") || "None";

export function CompareAssumptions({ columns, plan }: { columns: ComparisonColumn[]; plan: Plan }) {
  const settings = columns.map(({ run: { scenario } }) => [
    `Age ${scenario.retirementAge}`,
    enabled([
      ["CPP", scenario.benefits?.cpp ?? true],
      ["OAS", scenario.benefits?.oas ?? true],
      ["GIS", (scenario.benefits?.oas ?? true) && (scenario.benefits?.gis ?? true)],
    ]),
    enabled([
      ["CPP", scenario.payroll?.cpp],
      ["EI", scenario.payroll?.ei],
      ["CPP opt-out at ages 65–69", scenario.payroll?.cpp && scenario.payroll.cppOptOut65to69],
    ]),
    scenario.withdrawalStrategy === "tax-minimizing" ? "Tax-minimizing planning" : "Manual account order",
    formatAccountOrder(scenario.withdrawalOrder),
    { deterministic: "Deterministic", montecarlo: "Monte Carlo", historical: "Historical" }[scenario.simMode],
    scenario.simMode === "historical"
      ? scenario.withdrawalStrategy === "tax-minimizing"
        ? `Historical returns · planning rates ${rates(scenario.returnAssumptions)}`
        : "Historical returns"
      : rates(scenario.returnAssumptions),
    scenario.simMode === "montecarlo" && scenario.mcConfig
      ? `${scenario.mcConfig.runs} paths · seed ${scenario.mcConfig.seed} · SD ${rates(scenario.mcConfig.stdDev)}`
      : "—",
    scenario.simMode === "historical" ? String(scenario.historicalConfig?.startYear ?? "—") : "—",
  ]);
  const labels = [
    "Retirement age",
    "Benefits enabled",
    "Payroll deductions",
    "Withdrawal strategy",
    "Configured withdrawal order",
    "Simulation mode",
    "Annual return assumptions",
    "Monte Carlo settings",
    "First historical window start year",
  ];
  const inflation = [...new Set(plan.expenses.map(({ inflationRate }) => inflationRate))].sort((a, b) => a - b);
  return (
    <section aria-labelledby="compare-assumptions-title">
      <h3 id="compare-assumptions-title">Scenario assumptions</h3>
      <p className="hint">
        Shared plan horizon ages {plan.profile.currentAge}–{plan.profile.endAge}. Annual expense inflation{" "}
        {inflation.length ? inflation.map(percent).join(", ") : "— no expenses configured"}.
      </p>
      <div className="compare-table-wrap" role="region" aria-label="Resolved scenario assumptions" tabIndex={0}>
        <table className="compare-table">
          <thead>
            <tr>
              <th scope="col">Setting</th>
              <ComparisonHeaders columns={columns} />
            </tr>
          </thead>
          <tbody>
            {labels.map(
              (label, setting) =>
                settings.some((values) => values[setting] !== "—") && (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    {columns.map((column, index) => {
                      const value = settings[index]?.[setting];
                      const changed = index > 0 && value !== settings[0]?.[setting];
                      return (
                        <td key={column.run.scenarioId ?? ""} className={changed ? "compare-changed" : undefined}>
                          {value}
                          {changed && <span className="compare-delta">Changed</span>}
                        </td>
                      );
                    })}
                  </tr>
                ),
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
