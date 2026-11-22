/** Account drawdown: stacked area of balances.{tfsa, rrsp, nonreg} plus cash and other assets over age. */
import { stackedBandPaths, ticks, domainOf, fmtTick, H, PAD, W, xScale, yScale } from "./svg";
import { STACK_COLORS } from "./palette";
import { ChartCrosshair, ChartMarkers, ChartTooltip, stackTops, useChartInteraction } from "./chartInteraction";

interface Point {
  x: number;
  tfsa: number;
  rrsp: number;
  nonreg: number;
  cash: number;
  /** Optional additive result field (older runs / legacy fixtures may omit it). */
  otherAssets?: number;
}

const SERIES = ["TFSA", "RRSP", "Non-registered", "Cash accounts + reserve", "Other assets"] as const;

export function DrawDownChart({ points }: { points: Point[] }) {
  const xs = points.map((p) => p.x);
  const firstX = xs[0];
  const lastX = xs[xs.length - 1];
  const it = useChartInteraction(xs, firstX !== undefined && lastX !== undefined ? [firstX, lastX] : [0, 0]);
  if (xs.length === 0 || firstX === undefined || lastX === undefined)
    return <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="No data" role="img" />;
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
    <>
      <svg
        className="financial-chart chart-interactive"
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        aria-label="Stacked account balances by age: TFSA, RRSP, non-registered, cash accounts plus reserve, and other assets"
        role="img"
        {...it.svgProps}
      >
        <title>Account drawdown over age</title>
        <desc>
          Stacked areas for TFSA, RRSP, non-registered, total cash across named accounts and reserve, and other asset
          balances at each age.
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
          <path key={index} d={d} fill={STACK_COLORS[index]} fillOpacity="0.75" data-series={SERIES[index]} />
        ))}
        {it.active !== null &&
          (() => {
            const p = points[it.active]!;
            const cx = xScale(p.x, xDomain);
            const values = [p.tfsa, p.rrsp, p.nonreg, p.cash, other(p)];
            const tops = stackTops(values);
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
          const values = [p.tfsa, p.rrsp, p.nonreg, p.cash, other(p)];
          const total = Number.isFinite(values.reduce((a, b) => a + b, 0)) ? values.reduce((a, b) => a + b, 0) : NaN;
          return (
            <ChartTooltip
              age={p.x}
              fraction={xScale(p.x, xDomain) / W}
              keyboard={it.keyboard}
              rows={[...SERIES.map((label, s) => ({ label, value: values[s]! })), { label: "Total", value: total }]}
            />
          );
        })()}
    </>
  );
}
