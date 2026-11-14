/** Contribution room remaining: TFSA and RRSP room lines; 0 means the room is used up. */
import { domainOf, fmtTick, H, PAD, polylinePoints, ticks, W, xScale, yScale } from "./svg";
import { PALETTE } from "./palette";

interface Point {
  x: number;
  tfsaRoom: number;
  rrspRoom: number;
}

export function ContributionRoomChart({ points }: { points: Point[] }) {
  const xs = points.map((p) => p.x);
  const firstX = xs[0];
  const lastX = xs[xs.length - 1];
  if (xs.length === 0 || firstX === undefined || lastX === undefined) return <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="No data" role="img" />;
  const xDomain: [number, number] = [firstX, lastX];
  const yDomain = domainOf([...points.flatMap((p) => [p.tfsaRoom, p.rrspRoom]), 0]);
  const yTicks = ticks(yDomain[0], yDomain[1]);
  const tfsaLine = polylinePoints(points.map((p) => ({ x: p.x, y: Number.isFinite(p.tfsaRoom) ? p.tfsaRoom : null })), xDomain, yDomain);
  const rrspLine = polylinePoints(points.map((p) => ({ x: p.x, y: Number.isFinite(p.rrspRoom) ? p.rrspRoom : null })), xDomain, yDomain);

  return (
    <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="Remaining TFSA and RRSP contribution room over age" role="img">
      <title>Contribution room remaining over age</title>
      <desc>Remaining TFSA and RRSP contribution headroom at each age; a line reaching zero means that room is fully used.</desc>
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
      <polyline points={tfsaLine} fill="none" stroke={PALETTE.color1} strokeWidth="2" data-series="TFSA room">
        <title>TFSA room</title>
      </polyline>
      <polyline points={rrspLine} fill="none" stroke={PALETTE.color2} strokeWidth="2" data-series="RRSP room">
        <title>RRSP room</title>
      </polyline>
    </svg>
  );
}
