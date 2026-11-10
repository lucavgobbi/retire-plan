import { fmtMoney, fmtMoneyDetail, fmtPercent } from "../projection/fmt";
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
      label: "Outcome",
      text: (row) => (row.success ? "Success" : `Fails at age ${row.failureAge ?? "unknown"}`),
    },
    { label: "Worst shortfall", text: (row) => (row.worstShortfallAge !== null ? `age ${row.worstShortfallAge}` : "—") },
    { label: "Final net worth", text: (row) => fmtMoney(row.finalNetWorth) },
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
          ? `${(row.returnAssumptions.equity * 100).toFixed(0)}%/${(row.returnAssumptions.bond * 100).toFixed(0)}%/${(row.returnAssumptions.cash * 100).toFixed(0)}% (e/b/c)`
          : "—",
    },
    {
      label: "Withdrawal order",
      text: (row) => (row.withdrawalOrder ? row.withdrawalOrder.join(" → ") : "—"),
    },
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
