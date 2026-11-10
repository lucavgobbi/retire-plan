import type { XyPoint } from "./adapters";
import { H, PAD, polylinePoints, ticks, W, xScale, yScale, domainOf, fmtTick } from "./svg";

/** Net worth — a single line over age (spec §6.2). */
export function NetWorthChart({ points }: { points: XyPoint[] }) {
  const xs = points.map((p) => p.x);
  const firstX = xs[0];
  const lastX = xs[xs.length - 1];
  const xDomain: [number, number] =
    firstX !== undefined && lastX !== undefined ? [firstX, lastX] : [0, 1];
  const yDomain = domainOf(points.map((p) => p.y ?? NaN));
  const yTicks = ticks(yDomain[0], yDomain[1]);

  return (
    <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label={`Net worth from age ${xDomain[0]} to ${xDomain[1]}`} role="img">
      <title>Net worth over age</title>
      <desc>Line of projected net worth at each age, dollars of today (real).</desc>
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
      <polyline
        points={polylinePoints(points, xDomain, yDomain)}
        fill="none"
        stroke="#2563eb"
        strokeWidth="2"
      />
    </svg>
  );
}
