import { ChartCard } from "../projection/charts/ChartCard";
import { ChartCrosshair, ChartMarkers, ChartTooltip, useChartInteraction } from "../projection/charts/chartInteraction";
import { domainOf, fmtTick, H, PAD, polylinePoints, ticks, W, xScale, yScale } from "../projection/charts/svg";
import type { Comparison } from "./compare";

const COLORS = ["#2563eb", "#0f766e", "#b45309"] as const;

export function CompareChart({ comparison, birthYear }: { comparison: Comparison; birthYear: number }) {
  const { columns, years, start, end } = comparison;
  const xDomain: [number, number] = [start ?? 0, end ?? 0];
  const interaction = useChartInteraction(years, xDomain);
  if (start === undefined || end === undefined) return null;
  const yDomain = domainOf(columns.flatMap(({ points }) => points.map(({ y }) => y)));
  const activeIndex = interaction.active;
  const activeYear = activeIndex === null ? undefined : years[activeIndex];
  const activePoints = activeIndex === null ? [] : columns.map(({ points }) => points[activeIndex]!);
  const activeX = activeYear === undefined ? 0 : xScale(activeYear, xDomain);

  return (
    <ChartCard
      title="Net worth comparison"
      ariaLabel="Net worth comparison"
      subtitle={
        columns.some(({ run }) => run.analysis)
          ? "One representative path per ensemble, aligned by household projection year."
          : "Year-end net worth aligned by household projection year."
      }
      axisLabel="Household projection year"
      legend={columns.map(({ label }, index) => ({ label, color: COLORS[index]! }))}
    >
      <svg
        className="financial-chart chart-interactive"
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        aria-label="Net worth by household projection year. Use arrow keys to explore values."
        role="img"
        {...interaction.svgProps}
      >
        {ticks(...yDomain).map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yScale(tick, yDomain)}
              y2={yScale(tick, yDomain)}
              className="chart-gridline"
            />
            <text x={PAD.left - 6} y={yScale(tick, yDomain) + 3} textAnchor="end" className="chart-tick">
              {fmtTick(tick)}
            </text>
          </g>
        ))}
        {[...new Set(ticks(start, end).map(Math.round))].map((year) => (
          <text key={year} x={xScale(year, xDomain)} y={H - 6} textAnchor="middle" className="chart-tick">
            {year}
          </text>
        ))}
        {columns.map(({ run, points }, index) => (
          <g key={run.scenarioId ?? ""}>
            <polyline
              points={polylinePoints(points, xDomain, yDomain)}
              fill="none"
              stroke={COLORS[index]}
              strokeWidth="2.5"
              strokeDasharray={index === 1 ? "6 3" : index === 2 ? "2 3" : undefined}
            />
            {points.length === 1 && Number.isFinite(points[0]!.y) && (
              <circle cx={xScale(start, xDomain)} cy={yScale(points[0]!.y, yDomain)} r="3.5" fill={COLORS[index]} />
            )}
          </g>
        ))}
        {activeYear !== undefined && (
          <>
            <ChartCrosshair x={activeX} />
            <ChartMarkers
              coords={activePoints.map(({ y }, index) => ({
                cx: activeX,
                cy: yScale(y, yDomain),
                color: COLORS[index]!,
              }))}
            />
          </>
        )}
      </svg>
      {activeYear !== undefined && (
        <ChartTooltip
          age={activeYear - birthYear}
          calendarYear={activeYear}
          fraction={activeX / W}
          keyboard={interaction.keyboard}
          rows={columns.map(({ label }, index) => ({ label, value: activePoints[index]!.y }))}
        />
      )}
    </ChartCard>
  );
}
