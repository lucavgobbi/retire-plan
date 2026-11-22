/** Monte Carlo net-worth fan: p10–p90 band across ALL simulated paths + dashed median.
 * Ensemble chart: dashed = aggregated across paths (single-path charts use solid lines). */
import { bandBetweenPaths, domainOf, fmtTick, H, PAD, polylinePoints, ticks, W, xScale, yScale } from "./svg";
import { PALETTE } from "./palette";
import { ChartCrosshair, ChartMarkers, ChartTooltip, useChartInteraction } from "./chartInteraction";
import type { EnsembleStatPoint } from "./adapters";

export function EnsembleFanChart({ points }: { points: EnsembleStatPoint[] }) {
  const xs = points.map((p) => p.age);
  const firstX = xs[0];
  const lastX = xs[xs.length - 1];
  const it = useChartInteraction(xs, firstX !== undefined && lastX !== undefined ? [firstX, lastX] : [0, 0]);
  if (xs.length === 0 || firstX === undefined || lastX === undefined) {
    return <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="No data" role="img" />;
  }
  const xDomain: [number, number] = [firstX, lastX];
  const yDomain = domainOf(points.flatMap((p) => [p.netWorth.p10, p.netWorth.p90]));
  const yTicks = ticks(yDomain[0], yDomain[1]);
  const band = bandBetweenPaths(
    xs,
    points.map((p) => p.netWorth.p90),
    points.map((p) => p.netWorth.p10),
    yDomain,
  );
  const median = polylinePoints(
    points.map((p) => ({ x: p.age, y: p.netWorth.p50 })),
    xDomain,
    yDomain,
  );
  const p90Line = polylinePoints(
    points.map((p) => ({ x: p.age, y: p.netWorth.p90 })),
    xDomain,
    yDomain,
  );
  const p10Line = polylinePoints(
    points.map((p) => ({ x: p.age, y: p.netWorth.p10 })),
    xDomain,
    yDomain,
  );

  return (
    <>
      <svg
        className="financial-chart chart-interactive"
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        aria-label="Monte Carlo net worth range by age across simulated paths"
        role="img"
        data-ensemble="true"
        {...it.svgProps}
      >
        <title>Monte Carlo net worth range over age</title>
        <desc>
          Shaded band spanning the 10th to 90th percentile of net worth across ALL simulated paths at each age; the
          dashed line inside is the median.
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
        <path d={band} fill={PALETTE.color1} fillOpacity="0.25" data-series="p10–p90 band" />
        <polyline
          points={p90Line}
          fill="none"
          stroke={PALETTE.color1}
          strokeWidth="1"
          strokeOpacity="0.5"
          data-series="p90"
        />
        <polyline
          points={p10Line}
          fill="none"
          stroke={PALETTE.color1}
          strokeWidth="1"
          strokeOpacity="0.5"
          data-series="p10"
        />
        {/* Dashed median: aggregate across paths — visually distinct from solid single-path lines. */}
        <polyline
          points={median}
          fill="none"
          stroke={PALETTE.color1}
          strokeWidth="2"
          strokeDasharray="6 4"
          data-series="Median (p50)"
        />
        {it.active !== null &&
          (() => {
            const p = points[it.active]!;
            const cx = xScale(p.age, xDomain);
            return (
              <>
                <ChartCrosshair x={cx} />
                <ChartMarkers
                  coords={[
                    { cx, cy: yScale(p.netWorth.p90, yDomain), color: PALETTE.color1 },
                    { cx, cy: yScale(p.netWorth.p50, yDomain), color: PALETTE.color1 },
                    { cx, cy: yScale(p.netWorth.p10, yDomain), color: PALETTE.color1 },
                  ]}
                />
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
                { label: "P90 net worth", value: p.netWorth.p90 },
                { label: "Median (p50)", value: p.netWorth.p50 },
                { label: "P10 net worth", value: p.netWorth.p10 },
                { label: "Paths simulated", value: p.sampleCount, format: "count" },
              ]}
            />
          );
        })()}
    </>
  );
}
