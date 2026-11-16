/** Spending breakdown: one stacked band per expense item, stable colour per item. */
import { stackedBandPaths, ticks, domainOf, fmtTick, H, PAD, W, xScale, yScale } from "./svg";
import { STACK_COLORS } from "./palette";
import { ChartCrosshair, ChartMarkers, ChartTooltip, stackTops, useChartInteraction } from "./chartInteraction";
import type { ExpenseBreakdownSeries } from "./adapters";

const seriesColor = (index: number) => STACK_COLORS[index % STACK_COLORS.length]!;

export function SpendingBreakdownChart({ series }: { series: ExpenseBreakdownSeries }) {
  const points = series.points;
  const xs = points.map((p) => p.x);
  const firstX = xs[0];
  const lastX = xs[xs.length - 1];
  const it = useChartInteraction(xs, firstX !== undefined && lastX !== undefined ? [firstX, lastX] : [0, 0]);
  if (xs.length === 0 || firstX === undefined || lastX === undefined || series.items.length === 0) {
    return <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="No data" role="img" />;
  }
  const xDomain: [number, number] = [firstX, lastX];
  // The band stack tops at the sum of the shown item amounts (non-finite amounts are gaps).
  const itemTotals = points.map((p) => p.amounts.reduce((acc, value) => acc + (Number.isFinite(value) ? value : 0), 0));
  const yDomain = domainOf(itemTotals);
  const yTicks = ticks(yDomain[0], yDomain[1]);
  const bands = stackedBandPaths(xs, series.items.map((_, i) => points.map((p) => p.amounts[i] ?? NaN)), yDomain);

  return (
    <>
    <svg
      className="financial-chart chart-interactive"
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      aria-label={`Stacked spending by expense item by age: ${series.items.map((item) => item.name).join(", ")}`}
      role="img"
      {...it.svgProps}
    >
      <title>Spending breakdown over age</title>
      <desc>One stacked band per expense item at each age; each item keeps its own colour.</desc>
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
        <path key={series.items[index]!.id} d={d} fill={seriesColor(index)} fillOpacity="0.75" data-series={series.items[index]!.name} />
      ))}
      {it.active !== null && (() => {
        const p = points[it.active]!;
        const cx = xScale(p.x, xDomain);
        const tops = stackTops(p.amounts);
        return (
          <>
            <ChartCrosshair x={cx} />
            <ChartMarkers coords={tops.map((top, s) => ({ cx, cy: yScale(top, yDomain), color: seriesColor(s) }))} />
          </>
        );
      })()}
    </svg>
    {it.active !== null && (() => {
      const p = points[it.active]!;
      return (
        <ChartTooltip
          age={p.x}
          fraction={xScale(p.x, xDomain) / W}
          keyboard={it.keyboard}
          rows={[
            ...series.items.map((item, i) => ({ label: item.name, value: p.amounts[i] ?? NaN })),
            // Authoritative engine total for the year (item parts are pre-rounding).
            { label: "Total spending", value: p.total },
          ]}
        />
      );
    })()}
    </>
  );
}
