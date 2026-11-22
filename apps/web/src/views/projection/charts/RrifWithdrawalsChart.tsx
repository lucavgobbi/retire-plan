/** RRIF minimum vs actual RRSP withdrawals: two lines; gaps before RRIF minimums begin. */
import { domainOf, fmtTick, H, PAD, polylinePoints, ticks, W, xScale, yScale } from "./svg";
import { PALETTE } from "./palette";
import { ChartCrosshair, ChartMarkers, ChartTooltip, useChartInteraction } from "./chartInteraction";
import type { RrifPoint } from "./adapters";

export function RrifWithdrawalsChart({ points }: { points: RrifPoint[] }) {
  const xs = points.map((p) => p.x);
  const firstX = xs[0];
  const lastX = xs[xs.length - 1];
  const it = useChartInteraction(xs, firstX !== undefined && lastX !== undefined ? [firstX, lastX] : [0, 0]);
  if (xs.length === 0 || firstX === undefined || lastX === undefined) {
    return <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="No data" role="img" />;
  }
  const xDomain: [number, number] = [firstX, lastX];
  const actualPoints = points.map((p) => ({ x: p.x, y: p.actual }));
  const minimumPoints = points.map((p) => ({ x: p.x, y: p.minimum }));
  const yDomain = domainOf([
    ...points.filter((p) => Number.isFinite(p.actual)).map((p) => p.actual),
    ...points.filter((p): p is RrifPoint & { minimum: number } => p.minimum !== null).map((p) => p.minimum),
  ]);
  const yTicks = ticks(yDomain[0], yDomain[1]);

  return (
    <>
      <svg
        className="financial-chart chart-interactive"
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        aria-label="RRIF minimum versus actual RRSP withdrawals by age"
        role="img"
        {...it.svgProps}
      >
        <title>RRIF minimum versus actual RRSP withdrawals over age</title>
        <desc>
          Two lines: RRSP withdrawals actually taken, and the mandatory RRIF minimum. No minimum line before RRIF
          minimums begin.
        </desc>
        {yTicks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yScale(t, yDomain)}
              y2={yScale(t, yDomain)}
              className="chart-gridline"
            />
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
          points={polylinePoints(actualPoints, xDomain, yDomain)}
          fill="none"
          stroke={PALETTE.color2}
          strokeWidth="2"
          data-series="Actual RRSP withdrawals"
        />
        <polyline
          points={polylinePoints(minimumPoints, xDomain, yDomain)}
          fill="none"
          stroke={PALETTE.color1}
          strokeWidth="2"
          data-series="RRIF minimum"
        />
        {it.active !== null &&
          (() => {
            const p = points[it.active]!;
            const cx = xScale(p.x, xDomain);
            return (
              <>
                <ChartCrosshair x={cx} />
                <ChartMarkers
                  coords={[
                    { cx, cy: yScale(p.actual, yDomain), color: PALETTE.color2 },
                    ...(p.minimum !== null ? [{ cx, cy: yScale(p.minimum, yDomain), color: PALETTE.color1 }] : []),
                  ]}
                />
              </>
            );
          })()}
      </svg>
      {it.active !== null &&
        (() => {
          const p = points[it.active]!;
          const rows = [
            { label: "Actual RRSP withdrawals", value: p.actual },
            { label: "RRIF minimum", value: p.minimum ?? NaN },
            ...(p.planned > 0 ? [{ label: "Planned extra draw", value: p.planned }] : []),
          ];
          return <ChartTooltip age={p.x} fraction={xScale(p.x, xDomain) / W} keyboard={it.keyboard} rows={rows} />;
        })()}
    </>
  );
}
