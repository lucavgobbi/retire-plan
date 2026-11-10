import type { ReactNode } from "react";

/** Shared chart wrapper (plan Task 7): figure with title, subtitle, accessible label. */
export function ChartCard({
  title,
  subtitle,
  ariaLabel,
  children,
  legend = [],
}: {
  title: string;
  subtitle?: string;
  ariaLabel: string;
  children: ReactNode;
  legend?: { label: string; color: string }[];
}) {
  return (
    <figure className="chart-card" aria-label={ariaLabel} role="figure">
      <figcaption>
        <h3>{title}</h3>
        {subtitle && <p className="hint">{subtitle}</p>}
      </figcaption>
      <div className="chart-plot">{children}</div>
      <p className="chart-axis-label">Age</p>
      {legend.length > 0 && <ul className="chart-legend" aria-label={`${title} series`}>
        {legend.map((item) => <li key={item.label}><span className="legend-swatch" aria-hidden="true" style={{ backgroundColor: item.color }} /><span>{item.label}</span></li>)}
      </ul>}
    </figure>
  );
}
