import type { RunRecord } from "../../domain/types";
import { useWorkspace } from "../../store/api";
import { CashflowSankey } from "../projection/cashflow/CashflowSankey";
import { resolveSankeyRange, runYearRange } from "../projection/sankeyRange";

export function ComparisonCashflow({
  scenarios,
  years,
}: {
  scenarios: { run: RunRecord; label: string; color: string; birthYear: number; path: string }[];
  years: number[];
}) {
  const { workspace, dispatch } = useWorkspace();
  const startYear = years[0];
  const endYear = years.at(-1);
  const common = startYear !== undefined && endYear !== undefined ? { startYear, endYear } : null;
  const sharedRange = resolveSankeyRange(workspace.projectionSankeyRange, common);
  return (
    <div className="compare-scenario-grid compare-cashflows" data-scenario-count={scenarios.length}>
      {scenarios.map(({ run, label, color, birthYear, path }) => {
        const range =
          sharedRange ?? resolveSankeyRange(workspace.projectionSankeyRange, runYearRange(run.result.years, birthYear));
        return (
          <section className="compare-scenario-card" aria-label={label} key={run.id} style={{ borderTopColor: color }}>
            <h3>{label}</h3>
            <p className="hint">{path}</p>
            {range ? (
              <CashflowSankey
                years={run.result.years}
                birthYear={birthYear}
                range={range}
                rangeOptions={sharedRange ? years : undefined}
                onRangeChange={(range) => dispatch({ type: "projection/setSankeyRange", range })}
                showAccounts={workspace.projectionSankeyShowAccounts === true}
                onShowAccountsChange={(showAccounts) =>
                  dispatch({ type: "projection/setSankeyShowAccounts", showAccounts })
                }
              />
            ) : (
              <p className="hint">No projection years are available for the cashflow diagram.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
