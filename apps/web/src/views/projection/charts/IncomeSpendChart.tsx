/**
 * Income vs spending: total annual income line with an expenses band (spec §6.2).
 * Non-finite values contribute no point on the polyline / band (never-NaN rule).
 */
import { domainOf, fmtTick, H, PAD, polylinePoints, ticks, W, xScale, yScale } from "./svg";
import { PALETTE } from "./palette";

interface Point {
  x: number;
  income: number;
  expenses: number;
  shortfall: number;
}

export function IncomeSpendChart({ points }: { points: Point[] }) {
  const xs = points.map((p) => p.x);
  const firstX = xs[0];
  const lastX = xs[xs.length - 1];
  if (xs.length === 0 || firstX === undefined || lastX === undefined) return <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="No data" role="img" />;
  const xDomain: [number, number] = [firstX, lastX];
  const yDomain = domainOf(points.flatMap((p) => [p.income, p.expenses, p.shortfall]));
  const yTicks = ticks(yDomain[0], yDomain[1]);

  const bandPts = points
    .filter((p) => Number.isFinite(p.expenses))
    .map((p) => `${xScale(p.x, xDomain).toFixed(1)},${yScale(p.expenses, yDomain).toFixed(1)}`);
  const baseline = yScale(0, yDomain).toFixed(1);
  const bandPath =
    bandPts.length > 1
      ? `M${bandPts[0]!.split(",")[0]},${baseline} L${bandPts.join(" L")} L${bandPts[bandPts.length - 1]!.split(",")[0]},${baseline} Z`
      : "";
  const incomeLine = polylinePoints(
    points.map((p) => ({ x: p.x, y: Number.isFinite(p.income) ? p.income : null })),
    xDomain,
    yDomain,
  );

  return (
    <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="Total annual income against spending at each age" role="img">
      <title>Income vs spending over age</title>
      <desc>Total annual income line with a spending band; shortfall ages are visible where income falls short.</desc>
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={yScale(t, yDomain)} y2={yScale(t, yDomain)} className="chart-gridline" />
          <text x={PAD.left - 6} y={yScale(t, yDomain) + 3} textAnchor="end" className="chart-tick">
            {fmtTick(t)}
          </text>
        </g>
      ))}
      {ticks(xDomain[0], xDomain[1]).map((t) => (
        <text key={t} x={xScale(t, xDomain)} y={H - 6} textAnchor="middle" className="chart-tick">
          {Math.round(t)}
        </text>
      ))}
      <path d={bandPath} fill={PALETTE.color3} fillOpacity="0.25" stroke={PALETTE.color3} strokeDasharray="4 3" />
      <polyline points={incomeLine} fill="none" stroke={PALETTE.color1} strokeWidth="2" />
    </svg>
  );
}
