/** Cumulative shortfall risk by age: share of simulated paths with any positive
 * shortfall year through that age (0..1). FIXED percent axis — never currency. */
import { bandBetweenPaths, H, PAD, polylinePoints, ticks, W, xScale, yScale } from "./svg";
import { PALETTE } from "./palette";
import { ChartCrosshair, ChartMarkers, ChartTooltip, useChartInteraction } from "./chartInteraction";
import type { EnsembleStatPoint } from "./adapters";

const percentTick = (value: number) => `${Math.round(value * 100)}%`;

export function ShortfallRiskChart({ points }: { points: EnsembleStatPoint[] }) {
  const xs = points.map((p) => p.age);
  const firstX = xs[0];
  const lastX = xs[xs.length - 1];
  const it = useChartInteraction(xs, firstX !== undefined && lastX !== undefined ? [firstX, lastX] : [0, 0]);
  if (xs.length === 0 || firstX === undefined || lastX === undefined) {
    return <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="No data" role="img" />;
  }
  const xDomain: [number, number] = [firstX, lastX];
  // FIXED 0..1 fraction domain: risk is a share of paths, not an amount.
  const yDomain: [number, number] = [0, 1];
  const yTicks = ticks(0, 1);
  const line = polylinePoints(
    points.map((p) => ({ x: p.age, y: p.shortfallRate })),
    xDomain,
    yDomain,
  );
  const area = bandBetweenPaths(
    xs,
    points.map((p) => p.shortfallRate),
    xs.map(() => 0),
    yDomain,
  );

  return (
    <>
      <svg
        className="financial-chart chart-interactive"
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        aria-label="Cumulative shortfall risk by age across simulated paths"
        role="img"
        data-ensemble="true"
        {...it.svgProps}
      >
        <title>Cumulative shortfall risk over age</title>
        <desc>
          At each age, the share of simulated paths that have run a shortfall in that year or any earlier year. Fixed 0%
          to 100% axis.
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
              {percentTick(t)}
            </text>
          </g>
        ))}
        {ticks(xDomain[0], xDomain[1]).map((t) => (
          <text key={t} x={xScale(t, xDomain)} y={H - 6} textAnchor="middle" className="chart-tick">
            {Math.round(t)}
          </text>
        ))}
        <path d={area} fill={PALETTE.color3} fillOpacity="0.2" data-series="Cumulative shortfall risk" />
        <polyline
          points={line}
          fill="none"
          stroke={PALETTE.color3}
          strokeWidth="2"
          data-series="Cumulative shortfall risk"
        />
        {it.active !== null &&
          (() => {
            const p = points[it.active]!;
            const cx = xScale(p.age, xDomain);
            return (
              <>
                <ChartCrosshair x={cx} />
                <ChartMarkers coords={[{ cx, cy: yScale(p.shortfallRate, yDomain), color: PALETTE.color3 }]} />
              </>
            );
          })()}
      </svg>
      {it.active !== null &&
        (() => {
          const p = points[it.active]!;
          return (
            <ChartTooltip
              age={p.age}
              fraction={xScale(p.age, xDomain) / W}
              keyboard={it.keyboard}
              rows={[
                { label: "Cumulative shortfall risk", value: p.shortfallRate, format: "percent" },
                { label: "Paths simulated", value: p.sampleCount, format: "count" },
              ]}
            />
          );
        })()}
    </>
  );
}
