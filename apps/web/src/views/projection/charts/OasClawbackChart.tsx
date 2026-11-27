/** OAS kept vs clawback: kept + clawback stack exactly to the gross OAS received. */
import { chartAgeDomain, stackedBandPaths, ticks, domainOf, fmtTick, H, PAD, W, xScale, yScale } from "./svg";
import { PALETTE } from "./palette";
import { ChartCrosshair, ChartMarkers, ChartTooltip, stackTops, useChartInteraction } from "./chartInteraction";
import type { OasPoint } from "./adapters";

const SERIES = ["OAS kept", "OAS clawback"] as const;

export function OasClawbackChart({ points, scalePoints = points }: { points: OasPoint[]; scalePoints?: OasPoint[] }) {
  const xs = points.map((p) => p.x);
  const firstX = xs[0];
  const lastX = xs[xs.length - 1];
  const xDomain = chartAgeDomain(xs, scalePoints, (p) => p.x);
  const it = useChartInteraction(xs, xDomain);
  if (xs.length === 0 || firstX === undefined || lastX === undefined) {
    return <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="No data" role="img" />;
  }
  const yDomain = domainOf(scalePoints.map((p) => p.gross));
  const yTicks = ticks(yDomain[0], yDomain[1]);
  const bands = stackedBandPaths(xs, [points.map((p) => p.kept), points.map((p) => p.clawback)], yDomain, xDomain);
  // Kept below, clawback stacked above — together exactly the gross OAS received.
  const colors = [PALETTE.color2, PALETTE.color4] as const;

  return (
    <>
      <svg
        className="financial-chart chart-interactive"
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        aria-label="OAS kept versus OAS clawback by age"
        role="img"
        {...it.svgProps}
      >
        <title>OAS kept versus clawback over age</title>
        <desc>
          Stacked bands: the OAS kept after the recovery tax, plus the clawback charged back — together the gross OAS
          received.
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
        {bands.map((d, index) => (
          <path key={SERIES[index]} d={d} fill={colors[index]} fillOpacity="0.75" data-series={SERIES[index]} />
        ))}
        {it.active !== null &&
          (() => {
            const p = points[it.active]!;
            const cx = xScale(p.x, xDomain);
            const tops = stackTops([p.kept, p.clawback]);
            return (
              <>
                <ChartCrosshair x={cx} />
                <ChartMarkers coords={tops.map((top, s) => ({ cx, cy: yScale(top, yDomain), color: colors[s]! }))} />
              </>
            );
          })()}
      </svg>
      {it.active !== null &&
        (() => {
          const p = points[it.active]!;
          return (
            <ChartTooltip
              age={p.x}
              fraction={xScale(p.x, xDomain) / W}
              keyboard={it.keyboard}
              rows={[
                { label: "Gross OAS", value: p.gross },
                { label: "OAS kept", value: p.kept },
                { label: "OAS clawback", value: p.clawback },
              ]}
            />
          );
        })()}
    </>
  );
}
