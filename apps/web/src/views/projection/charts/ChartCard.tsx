import type { ReactNode } from "react";
import { ChartScenarioContext } from "./chartInteraction";
import { ChartHelp } from "./ChartHelp";

/** Shared chart wrapper (plan Task 7): figure with title, subtitle, accessible label. */
export function ChartCard({
  title,
  subtitle,
  ariaLabel,
  children,
  legend = [],
  axisLabel = "Age",
  help,
  scenario,
}: {
  title: string;
  subtitle?: string;
  ariaLabel: string;
  children: ReactNode;
  axisLabel?: string;
  legend?: { label: string; color: string }[];
  /** Shared explanatory copy ("what it shows / how to read it"); renders the accessible ⓘ help. */
  help?: string;
  scenario?: { label: string; color: string; birthYear: number; path: string };
}) {
  return (
    <figure
      className={scenario ? "chart-card compare-scenario-card" : "chart-card"}
      aria-label={scenario ? `${ariaLabel} · ${scenario.label}` : ariaLabel}
      role="figure"
      style={scenario ? { borderTopColor: scenario.color } : undefined}
    >
      <figcaption>
        {scenario && <strong>{scenario.label}</strong>}
        <h3>{title}</h3>
        {scenario && <p className="hint">{scenario.path}</p>}
        {subtitle && <p className="hint">{subtitle}</p>}
        {help && <ChartHelp>{help}</ChartHelp>}
      </figcaption>
      <div className="chart-plot">
        <ChartScenarioContext.Provider value={scenario}>{children}</ChartScenarioContext.Provider>
      </div>
      <p className="chart-axis-label">{axisLabel}</p>
      {legend.length > 0 && (
        <ul className="chart-legend" aria-label={`${title} series`}>
          {legend.map((item) => (
            <li key={item.label}>
              <span className="legend-swatch" aria-hidden="true" style={{ backgroundColor: item.color }} />
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
