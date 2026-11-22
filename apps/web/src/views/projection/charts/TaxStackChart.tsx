/** Tax: stacked area of federal + provincial + surtax + oasClawback over age. */
import { stackedBandPaths, ticks, domainOf, fmtTick, H, PAD, W, xScale, yScale } from "./svg";
import { STACK_COLORS } from "./palette";
import { ChartCrosshair, ChartMarkers, ChartTooltip, stackTops, useChartInteraction } from "./chartInteraction";

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
  const it = useChartInteraction(xs, firstX !== undefined && lastX !== undefined ? [firstX, lastX] : [0, 0]);
  if (xs.length === 0 || firstX === undefined || lastX === undefined)
    return <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="No data" role="img" />;
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
    <>
      <svg
        className="financial-chart chart-interactive"
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        aria-label="Stacked tax components by age: federal, provincial, surtax and OAS clawback"
        role="img"
        {...it.svgProps}
      >
        <title>Tax by component over age</title>
        <desc>Stacked areas for federal, provincial, Ontario surtax and OAS clawback tax at each age.</desc>
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
          <path key={index} d={d} fill={STACK_COLORS[index]} fillOpacity="0.75" data-series={SERIES[index]} />
        ))}
        {it.active !== null &&
          (() => {
            const p = points[it.active]!;
            const cx = xScale(p.x, xDomain);
            const tops = stackTops([p.federal, p.provincial, p.surtax, p.oasClawback]);
            return (
              <>
                <ChartCrosshair x={cx} />
                <ChartMarkers
                  coords={tops.map((top, s) => ({ cx, cy: yScale(top, yDomain), color: STACK_COLORS[s]! }))}
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
              age={p.x}
              fraction={xScale(p.x, xDomain) / W}
              keyboard={it.keyboard}
              rows={[
                { label: "Federal", value: p.federal },
                { label: "Provincial", value: p.provincial },
                { label: "Surtax", value: p.surtax },
                { label: "OAS clawback", value: p.oasClawback },
                { label: "Total tax", value: p.total },
              ]}
            />
          );
        })()}
    </>
  );
}
