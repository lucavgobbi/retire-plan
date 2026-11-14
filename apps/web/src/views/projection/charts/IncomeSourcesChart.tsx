/** Income by source: stacked bands for employment, other, cash interest, CPP, OAS, GIS. */
import { domainOf, fmtTick, H, PAD, W, stackedBandPaths, ticks, xScale, yScale } from "./svg";
import { STACK_COLORS } from "./palette";

interface Point {
  x: number;
  employment: number;
  other: number;
  /** Top-level cash-account interest — a separate source, never merged into `other`. */
  cashInterest: number;
  cpp: number;
  oas: number;
  gis: number;
}

const SERIES = ["Employment", "Other income", "Cash interest", "CPP", "OAS", "GIS"] as const;

export function IncomeSourcesChart({ points }: { points: Point[] }) {
  const xs = points.map((p) => p.x);
  const firstX = xs[0];
  const lastX = xs[xs.length - 1];
  if (xs.length === 0 || firstX === undefined || lastX === undefined) return <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="No data" role="img" />;
  const xDomain: [number, number] = [firstX, lastX];
  const values = (p: Point) => [p.employment, p.other, p.cashInterest, p.cpp, p.oas, p.gis];
  const totals = points.map((p) => {
    const parts = values(p);
    return parts.every(Number.isFinite) ? parts.reduce((a, b) => a + b, 0) : NaN;
  });
  const yDomain = domainOf([...totals, 0]);
  const yTicks = ticks(yDomain[0], yDomain[1]);
  const bands = stackedBandPaths(xs, SERIES.map((_, s) => points.map((p) => values(p)[s] ?? 0)), yDomain);

  return (
    <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label={`Stacked annual income by source over age: ${SERIES.join(", ")}`} role="img">
      <title>Income by source over age</title>
      <desc>Stacked areas for employment, other income, cash-account interest, CPP, OAS and GIS at each age; the shift from employment to public benefits is visible over time.</desc>
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
        <path key={SERIES[index]} d={d} fill={STACK_COLORS[index % STACK_COLORS.length]} fillOpacity="0.75" data-series={SERIES[index]}>
          <title>{SERIES[index]}</title>
        </path>
      ))}
    </svg>
  );
}
