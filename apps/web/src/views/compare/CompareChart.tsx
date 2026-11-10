import { H, PAD, polylinePoints, ticks, fmtTick, W, xScale, yScale } from "../projection/charts/svg";
import { PALETTE } from "../projection/charts/palette";
import type { ComparisonRow } from "./compare";

const LINE_COLORS = ["#2563eb", "#0f766e", "#b45309", "#7c3aed", "#dc2626", "#0369a1", "#4d7c0f", "#65a30d"];

/** Overlaid net-worth lines over age (multi-series) for the selected runs. */
export function CompareChart({ rows }: { rows: ComparisonRow[] }) {
  const xs = rows.flatMap((row) => row.netWorthAtAges.map((point) => point.x));
  if (xs.length < 2) return <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="No comparison data" role="img" />;
  const xDomain: [number, number] = [Math.min(...xs), Math.max(...xs)];
  const yDomainOf = (() => {
    const values = rows.flatMap((row) => row.netWorthAtAges.map((p) => p.y ?? NaN)).filter(Number.isFinite);
    const lo = Math.min(0, ...values);
    const hi = Math.max(1, ...values);
    return [lo, hi] as [number, number];
  })();
  const yTicks = ticks(yDomainOf[0], yDomainOf[1]);

  return (
    <figure className="compare-chart-card">
    <figcaption><h3>Net worth comparison</h3></figcaption>
    <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="Net worth comparison of the selected runs" role="img">
      <title>Net worth comparison over age</title>
      <desc>One net worth line per selected run, over age, for the side-by-side comparison.</desc>
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={yScale(t, yDomainOf)} y2={yScale(t, yDomainOf)} className="chart-gridline" />
          <text x={PAD.left - 6} y={yScale(t, yDomainOf) + 3} textAnchor="end" className="chart-tick">
            {fmtTick(t)}
          </text>
        </g>
      ))}
      {ticks(xDomain[0], xDomain[1]).map((t) => (
        <text key={t} x={xScale(t, xDomain)} y={H - 6} textAnchor="middle" className="chart-tick">
          {Math.round(t)}
        </text>
      ))}
      {rows.map((row, index) => (
        <g key={row.runId}>
          <polyline
            points={polylinePoints(row.netWorthAtAges, xDomain, yDomainOf)}
            fill="none"
            stroke={LINE_COLORS[index % LINE_COLORS.length] ?? PALETTE.color5}
            strokeWidth="2"
          />
        </g>
      ))}
    </svg>
    <p className="chart-axis-label">Age</p>
    <ul className="chart-legend" aria-label="Compared runs">
      {rows.map((row, index) => <li key={row.runId}>
        <span className="legend-swatch" aria-hidden="true" style={{ backgroundColor: LINE_COLORS[index % LINE_COLORS.length] ?? PALETTE.color5 }} />
        <span>{row.label}</span>
      </li>)}
    </ul>
    </figure>
  );
}
