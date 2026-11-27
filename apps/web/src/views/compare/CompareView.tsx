import { useLayoutEffect } from "react";
import { comparisonScenarios, comparisonSelection } from "../../domain/comparisonSelection";
import { useStore } from "../../store/api";
import { CompareAssumptions, CompareTable, displayedPath } from "./CompareTable";
import { COMPARISON_COLORS, computeComparison } from "./compare";
import { ComparisonDashboard } from "../projection/DashboardSection";
import { ProjectionChartSettings, ProjectionTableSection } from "../projection/ProjectionSettings";
import { RunAnalysisSummary } from "../projection/RunAnalysisSummary";
import { ProjectionTabs } from "../projection/ProjectionTabs";
import { ComparisonCashflow } from "./ComparisonCashflow";
import { ComparisonProjectionTable } from "./ComparisonProjectionTable";
import "./compare.css";

const COMPARE_TABS = [
  { id: "charts", label: "Charts" },
  { id: "cashflow", label: "Cashflow" },
] as const;

const OPTION_PREFIX = "scenario:";

function comparisonChoices(scenarios: ReturnType<typeof comparisonScenarios>) {
  const choices = [
    { id: "", label: "Base scenario" },
    ...scenarios.map((scenario) => ({ id: scenario.id, label: scenario.name.trim() || scenario.id })),
  ];
  const names = new Set(choices.map(({ label }) => label));
  const seen = new Set<string>();
  return choices.map(({ id, label }) => {
    if (!seen.has(label)) {
      seen.add(label);
      return { id, label };
    }
    let index = 2;
    while (names.has(`${label} (${index})`)) index++;
    const uniqueLabel = `${label} (${index})`;
    names.add(uniqueLabel);
    return { id, label: uniqueLabel };
  });
}

export function CompareView() {
  const {
    workspace,
    dispatch,
    runs,
    runComparison,
    comparisonRun,
    cancelComparison,
    isRunning,
    resetRuns,
    validationErrors,
  } = useStore();
  useLayoutEffect(() => cancelComparison, [cancelComparison]);

  const scenarios = comparisonScenarios(workspace);
  const { baselineId, alternativeIds } = comparisonSelection(workspace, scenarios);
  const choices = comparisonChoices(scenarios);
  const busy = comparisonRun?.status === "running";
  const changeBaseline = (id: string) =>
    dispatch({
      type: "projection/setComparison",
      selection: { baselineId: id, alternativeIds: alternativeIds.map((alt) => (alt === id ? baselineId : alt)) },
    });
  const changeAlternative = (index: number, value: string) => {
    const next = [...alternativeIds];
    if (value === "") next.splice(index, 1);
    else next[index] = value.slice(OPTION_PREFIX.length);
    dispatch({ type: "projection/setComparison", selection: { baselineId, alternativeIds: next } });
  };

  const { birthYear } = workspace.plan.profile;
  const comparison =
    comparisonRun?.status === "ready"
      ? computeComparison(comparisonRun.records, birthYear, new Map(choices.map(({ id, label }) => [id, label])))
      : null;
  const activeTab = workspace.projectionComparisonActiveTab ?? "charts";
  const panels = comparison?.columns.map(({ run, label }, index) => ({
    run,
    label,
    color: COMPARISON_COLORS[index]!,
    birthYear: run.birthYear ?? birthYear,
    path: displayedPath(run),
  }));
  return (
    <div className="compare-view">
      <div className="compare-controls no-print">
        {scenarios.length === 0 ? (
          <p className="hint empty-state">
            Save a scenario on the Scenarios tab to compare it with your base scenario.
          </p>
        ) : (
          <>
            <div className="compare-selects">
              <label className="field">
                Baseline
                <select
                  value={baselineId}
                  disabled={busy}
                  onChange={(event) => changeBaseline(event.currentTarget.value)}
                >
                  {choices.map(({ id, label }) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              {Array.from({ length: choices.length >= 3 && alternativeIds.length > 0 ? 2 : 1 }, (_, index) => (
                <label className="field" key={index}>
                  Alternative {index + 1}
                  {index === 1 ? " (optional)" : ""}
                  <select
                    value={alternativeIds[index] === undefined ? "" : OPTION_PREFIX + alternativeIds[index]}
                    disabled={busy}
                    onChange={(event) => changeAlternative(index, event.currentTarget.value)}
                  >
                    <option value="">Choose a scenario</option>
                    {choices
                      .filter(
                        ({ id }) => id !== baselineId && !alternativeIds.some((alt, i) => alt === id && i !== index),
                      )
                      .map(({ id, label }) => (
                        <option key={id} value={OPTION_PREFIX + id}>
                          {label}
                        </option>
                      ))}
                  </select>
                </label>
              ))}
            </div>
            <div className="compare-actions">
              <button
                type="button"
                onClick={() => void runComparison()}
                disabled={busy || isRunning || !alternativeIds.length || validationErrors.length > 0}
              >
                Run comparison
              </button>
              {busy && (
                <button type="button" onClick={cancelComparison}>
                  Cancel comparison
                </button>
              )}
              {(comparisonRun || runs.length > 0 || isRunning) && (
                <button type="button" onClick={resetRuns}>
                  Reset runs
                </button>
              )}
            </div>
          </>
        )}
        {busy && (
          <p role="status">
            Running scenario {comparisonRun.current} of {comparisonRun.total} · {comparisonRun.label}…
          </p>
        )}
        {isRunning && <p role="status">A projection is running. The comparison can start when it finishes.</p>}
        {comparisonRun?.status === "error" && (
          <p role="alert" className="run-error">
            {comparisonRun.message}
          </p>
        )}
        {comparisonRun?.status === "cancelled" && <p role="status">Comparison cancelled.</p>}
        {comparisonRun?.status === "changed" && (
          <p role="status">Inputs or selections changed. Run the comparison to update the results.</p>
        )}
      </div>
      <ProjectionTabs
        prefix="compare"
        label="Comparison view"
        tabs={COMPARE_TABS}
        active={activeTab}
        onSelect={(tab) => {
          if (tab !== activeTab) dispatch({ type: "projection/setComparisonActiveTab", tab });
        }}
      />
      {panels?.some(({ run }) => run.analysis) && (
        <p className="hint">
          Path charts, year-by-year results and cashflow show one representative path for each ensemble. Charts labeled
          Monte Carlo ensemble and the ensemble outcomes below summarize multiple paths.
        </p>
      )}
      <div
        role="tabpanel"
        id="compare-panel-charts"
        aria-labelledby="compare-tab-charts"
        className="projection-panel"
        hidden={activeTab !== "charts"}
      >
        <ProjectionChartSettings />
        {panels && <ComparisonDashboard scenarios={panels} />}
      </div>
      <div
        role="tabpanel"
        id="compare-panel-cashflow"
        aria-labelledby="compare-tab-cashflow"
        className="projection-panel"
        hidden={activeTab !== "cashflow"}
      >
        <ProjectionTableSection>
          {(hiddenColumnIds) =>
            panels && (
              <ComparisonProjectionTable
                runs={panels.map(({ run }) => run)}
                labels={panels.map(({ label }) => label)}
                colors={panels.map(({ color }) => color)}
                birthYear={birthYear}
                hiddenColumnIds={hiddenColumnIds}
              />
            )
          }
        </ProjectionTableSection>
        {comparison && panels && <ComparisonCashflow scenarios={panels} years={comparison.years} />}
      </div>
      {comparison && panels && (
        <details className="run-summary-collapse">
          <summary>Outcomes and assumptions</summary>
          <div className="compare-results">
            <CompareTable comparison={comparison} birthYear={birthYear} />
            <CompareAssumptions columns={comparison.columns} plan={workspace.plan} />
            {panels.some(({ run }) => run.analysis || run.result.withdrawalPlan || !run.result.summary.success) && (
              <div className="compare-scenario-grid" data-scenario-count={panels.length}>
                {panels.map(({ run, label, color }) => (
                  <section
                    className="compare-scenario-card"
                    aria-label={`${label} run analysis`}
                    key={run.id}
                    style={{ borderTopColor: color }}
                  >
                    <h3>{label}</h3>
                    {!run.result.summary.success && (
                      <p className="hint">First shortfall at age {run.result.summary.failureAge ?? "unknown"}.</p>
                    )}
                    <RunAnalysisSummary run={run} />
                    {run.result.summary.success && !run.analysis && !run.result.withdrawalPlan && (
                      <p className="hint">Completed without a shortfall.</p>
                    )}
                  </section>
                ))}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}
