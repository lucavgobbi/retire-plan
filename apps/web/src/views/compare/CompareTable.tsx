import { fmtMoney, fmtMoneyDetail, fmtPercent } from "../projection/fmt";
import { formatAccountOrder } from "../../domain/accountOrder";
import type { ComparisonRow } from "./compare";

/**
 * Side-by-side summary table (plan Task 8): success/failureAge/finalNetWorth/
 * retirementAge/assumptions/withdrawal order/worst shortfall, plus a Δ pair
 * (absolute + %) vs the selected baseline when present.
 */
export function CompareTable({ rows }: { rows: ComparisonRow[] }) {
  const hasBaseline = rows.some((row) => row.absDelta !== null || row.pctDelta !== null);

  const cellFor: { label: string; text: (row: ComparisonRow) => string; delta?: boolean }[] = [
    {
      label: "Run",
      text: (row) => row.label,
    },
    {
      label: "Representative path outcome",
      text: (row) => (row.success ? "Success" : `Fails at age ${row.failureAge ?? "unknown"}`),
    },
    { label: "Worst shortfall", text: (row) => (row.worstShortfallAge !== null ? `age ${row.worstShortfallAge}` : "—") },
    { label: "Final net worth (representative path)", text: (row) => fmtMoney(row.finalNetWorth) },
    { label: "Ensemble success probability", text: (row) => row.monteCarlo ? fmtPercent(row.monteCarlo.successRate) : "—" },
    { label: "Ensemble final net worth p10 / p50 / p90", text: (row) => row.monteCarlo
      ? `${fmtMoney(row.monteCarlo.percentileNetWorth.p10)} / ${fmtMoney(row.monteCarlo.percentileNetWorth.p50)} / ${fmtMoney(row.monteCarlo.percentileNetWorth.p90)}` : "—" },
    { label: "Historical representative source window", text: (row) => row.monteCarlo?.mode === "historical"
      ? `${row.monteCarlo.representativeStartYear}–${row.monteCarlo.representativeEndYear} (${row.monteCarlo.windowCount} windows)` : "—" },
    {
      label: "Δ net worth (abs)",
      delta: true,
      text: (row) => (row.absDelta === null ? "—" : fmtMoneyDetail(row.absDelta)),
    },
    {
      label: "Δ net worth (%)",
      delta: true,
      text: (row) => (row.pctDelta === null ? "—" : fmtPercent(row.pctDelta / 100)),
    },
    { label: "Retirement age", text: (row) => String(row.retirementAge ?? "—") },
    {
      label: "Return assumptions",
      text: (row) =>
        row.returnAssumptions
          ? `${fmtPercent(row.returnAssumptions.equity)} equity · ${fmtPercent(row.returnAssumptions.bond)} bonds · ${fmtPercent(row.returnAssumptions.cash)} cash`
          : "—",
    },
    {
      label: "Withdrawal order",
      text: (row) => (row.withdrawalOrder ? formatAccountOrder(row.withdrawalOrder as Parameters<typeof formatAccountOrder>[0]) : "—"),
    },
    { label: "Benefits modeled", text: row => row.benefits },
    { label: "Withdrawal strategy", text: row => row.withdrawalStrategy === "tax-minimizing" ? "Tax-minimizing planning" : "Manual account order" },
  ];

  return (
    <div className="compare-table-wrap" role="region" aria-label="Side-by-side run comparison" tabIndex={0}>
    <table className="compare-table">
      <thead>
        <tr>
          <th colSpan={rows.length + 1}>Side by side{hasBaseline && " · Δ vs baseline"}</th>
        </tr>
      </thead>
      <tbody>
        {cellFor
          .filter((cell) => hasBaseline || cell.delta !== true)
          .map((cell) => (
            <tr key={cell.label}>
              <th scope="row">{cell.label}</th>
              {rows.map((row) => (
                <td key={row.runId}>{cell.text(row)}</td>
              ))}
            </tr>
          ))}
      </tbody>
    </table>
    </div>
  );
}
