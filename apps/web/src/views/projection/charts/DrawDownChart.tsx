/** Account drawdown: stacked area of balances.{tfsa, rrsp, nonreg} plus cash and other assets over age. */
import { stackedBandPaths, ticks, domainOf, fmtTick, H, PAD, W, xScale, yScale } from "./svg";
import { STACK_COLORS } from "./palette";

interface Point {
  x: number;
  tfsa: number;
  rrsp: number;
  nonreg: number;
  cash: number;
  /** Optional additive result field (older runs / legacy fixtures may omit it). */
  otherAssets?: number;
}

const SERIES = ["TFSA", "RRSP", "Non-registered", "Cash reserve", "Other assets"] as const;

export function DrawDownChart({ points }: { points: Point[] }) {
  const xs = points.map((p) => p.x);
  const firstX = xs[0];
  const lastX = xs[xs.length - 1];
  if (xs.length === 0 || firstX === undefined || lastX === undefined) return <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="No data" role="img" />;
  const xDomain: [number, number] = [firstX, lastX];
  const other = (p: Point) => p.otherAssets ?? 0;
  const totals = points.map((p) =>
    Number.isFinite(p.tfsa + p.rrsp + p.nonreg + p.cash + other(p))
      ? p.tfsa + p.rrsp + p.nonreg + p.cash + other(p)
      : NaN,
  );
  const yDomain = domainOf(totals);
  const yTicks = ticks(yDomain[0], yDomain[1]);
  const bands = stackedBandPaths(
    xs,
    [
      points.map((p) => p.tfsa),
      points.map((p) => p.rrsp),
      points.map((p) => p.nonreg),
      points.map((p) => p.cash),
      points.map(other),
    ],
    yDomain,
  );

  return (
    <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="Stacked account balances by age: TFSA, RRSP, non-registered, cash reserve and other assets" role="img">
      <title>Account drawdown over age</title>
      <desc>Stacked areas for TFSA, RRSP, non-registered, cash reserve and other asset balances at each age.</desc>
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
      {bands.map((d, index) => (
        <path key={index} d={d} fill={STACK_COLORS[index]} fillOpacity="0.75" data-series={SERIES[index]} />
      ))}
    </svg>
  );
}
