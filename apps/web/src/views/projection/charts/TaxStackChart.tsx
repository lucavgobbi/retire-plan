/** Tax: stacked area of federal + provincial + surtax + oasClawback over age. */
import { stackedBandPaths, ticks, domainOf, fmtTick, H, PAD, W, xScale, yScale } from "./svg";
import { STACK_COLORS } from "./palette";

interface Point {
  x: number;
  federal: number;
  provincial: number;
  surtax: number;
  oasClawback: number;
  total: number;
}

const SERIES = ["Federal", "Provincial", "Surtax", "OAS clawback"] as const;

export function TaxStackChart({ points }: { points: Point[] }) {
  const xs = points.map((p) => p.x);
  const firstX = xs[0];
  const lastX = xs[xs.length - 1];
  if (xs.length === 0 || firstX === undefined || lastX === undefined) return <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="No data" role="img" />;
  const xDomain: [number, number] = [firstX, lastX];
  const yDomain = domainOf(points.map((p) => p.total));
  const yTicks = ticks(yDomain[0], yDomain[1]);
  const bands = stackedBandPaths(
    xs,
    [
      points.map((p) => p.federal),
      points.map((p) => p.provincial),
      points.map((p) => p.surtax),
      points.map((p) => p.oasClawback),
    ],
    yDomain,
  );

  return (
    <svg
      className="financial-chart"
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      aria-label="Stacked tax components by age: federal, provincial, surtax and OAS clawback"
      role="img"
    >
      <title>Tax by component over age</title>
      <desc>Stacked areas for federal, provincial, Ontario surtax and OAS clawback tax at each age.</desc>
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
