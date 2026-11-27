import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ProjectionActiveTab } from "../../domain/types";
import { useProjectionRun, useRuns, useWorkspace } from "../../store/api";
import { DashboardSection, PROJECTION_CHARTS } from "./DashboardSection";
import { ProjectionTable, columns, sanitizeHiddenColumns } from "./ProjectionTable";
import { sanitizeHiddenIds } from "./hiddenIds";
import { FailBanner } from "./FailBanner";
import { RunAnalysisSummary } from "./RunAnalysisSummary";
import { CashflowSankey } from "./cashflow/CashflowSankey";
import { resolveSankeyRange, runYearRange } from "./sankeyRange";
import { CompareView } from "../compare/CompareView";
import "./projection.css";

const PROJECTION_TABS: { id: ProjectionActiveTab; label: string }[] = [
  { id: "charts", label: "Charts" },
  { id: "cashflow", label: "Cashflow" },
  { id: "compare", label: "Compare" },
];

function SettingsGear({ label }: { label: string }) {
  return (
    <summary aria-label={label} title={label}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <g fill="currentColor">
          {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
            <rect key={angle} x="11" y="2.5" width="2" height="5" rx="1" transform={`rotate(${angle} 12 12)`} />
          ))}
          <circle cx="12" cy="12" r="5.2" />
        </g>
        <circle cx="12" cy="12" r="2.2" fill="#fff" />
      </svg>
    </summary>
  );
}

export function ProjectionView() {
  const [jumpAge, setJumpAge] = useState<number | null>(null);
  const [jumpKey, setJumpKey] = useState(0);
  const workspace = useWorkspace();
  const runs = useRuns();
  const { validationErrors, runError, resetRuns, dispatch } = workspace;
  // Scenario selection is PERSISTED as workspace.projectionScenarioId under the
  // agreed contract: "" (the UI's empty option) is an EXPLICIT base choice,
  // undefined is absence/default (also the base), and any NON-EMPTY string is an
  // actual saved-scenario id — no sentinel id is invented. null is reserved for
  // the CLEAR action. An explicit base choice survives remounts even when the
  // plan's most recent run is a saved-scenario run.
  const planId = workspace.workspace.meta?.id ?? "unsaved";
  const storedScenarioId = workspace.workspace.projectionScenarioId ?? "";
  const { scenarios } = workspace.workspace;
  // Run-analysis disclosure preference: persisted as an explicit boolean
  // (true = collapsed, false = expanded); the field's absence is also expanded.
  const summaryCollapsed = workspace.workspace.projectionRunSummaryCollapsed === true;
  // The shown selection derives DIRECTLY from the persisted preference: a
  // non-empty id must match a CURRENT saved scenario — no view-side run-follow
  // heuristics, since the Provider records the run intent into the preference
  // AT REQUEST TIME. An invalid stored id falls back to the baseline (the
  // empty option), never to some older run; a stale stored id (deleted while
  // mounted, or an import that dropped it) is also persist-cleared below so
  // autosave/exports stop carrying the dead id.
  useEffect(() => {
    if (storedScenarioId === "" || scenarios.some((item) => item.id === storedScenarioId)) return;
    dispatch({ type: "projection/setScenarioId", scenarioId: null });
  }, [storedScenarioId, scenarios, dispatch]);
  const selectedScenario =
    storedScenarioId === "" ? null : (scenarios.find((item) => item.id === storedScenarioId) ?? null);
  const effectiveScenarioId = selectedScenario?.id ?? null;
  const { run, runProjection, stale, isRunning, runCancelled, cancelRun } = useProjectionRun(
    planId,
    effectiveScenarioId,
  );

  // Subtabs: persisted workspace preference (absent = Charts). Switching tabs only
  // changes which mounted panel is exposed — it never dispatches a run.
  const activeTab = workspace.workspace.projectionActiveTab ?? "charts";
  const tabRefs = useRef<Partial<Record<ProjectionActiveTab, HTMLButtonElement | null>>>({});
  const setActiveTab = (tab: ProjectionActiveTab) => {
    if (tab === activeTab) return;
    if (tab === "charts") setJumpAge(null);
    workspace.dispatch({ type: "projection/setActiveTab", tab });
  };
  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const index = PROJECTION_TABS.findIndex((tab) => tab.id === activeTab);
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % PROJECTION_TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + PROJECTION_TABS.length) % PROJECTION_TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = PROJECTION_TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = PROJECTION_TABS[nextIndex]!;
    setActiveTab(next.id);
    tabRefs.current[next.id]?.focus();
  };

  // Column visibility: the workspace persists HIDDEN data-column ids (absent or
  // empty = all visible, so columns added later default visible; stale ids are
  // dropped by the sanitizer). Age/calendar-year and Audit stay pinned.
  const allColumns = columns();
  const selectableIds = allColumns.slice(1).map((col) => col.id);
  const hiddenList = sanitizeHiddenColumns(workspace.workspace.hiddenProjectionColumns, selectableIds);
  const hiddenIds = hiddenList === null ? undefined : new Set(hiddenList);
  // Bulk column checkbox: DOM `indeterminate` is the native accessible "mixed"
  // state — set whenever a partial (non-empty, non-full) set of columns is
  // hidden. Recomputed every render (no dependency array) so it tracks the
  // workspace state without extra effects dependencies.
  const bulkColumnsRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (bulkColumnsRef.current) {
      const hiddenCount = (hiddenList ?? []).length;
      bulkColumnsRef.current.indeterminate = hiddenCount > 0 && hiddenCount < selectableIds.length;
    }
  });
  // Chart visibility: sanitized against the stable dashboard chart ids.
  const hiddenCharts = sanitizeHiddenIds(
    workspace.workspace.hiddenProjectionCharts,
    PROJECTION_CHARTS.map((chart) => chart.id),
  );
  const columnPickerGroups: { group: string; items: { id: string; label: string }[] }[] = [];
  const pickerByName = new Map<string, { group: string; items: { id: string; label: string }[] }>();
  for (const col of allColumns.slice(1)) {
    const name = col.group ?? "Other";
    let entry = pickerByName.get(name);
    if (!entry) {
      entry = { group: name, items: [] };
      pickerByName.set(name, entry);
      columnPickerGroups.push(entry);
    }
    entry.items.push({ id: col.id, label: col.label });
  }
  const toggleColumn = (id: string) => {
    const current = hiddenList ?? [];
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    workspace.dispatch({ type: "projection/setHiddenColumns", hiddenColumnIds: next });
  };
  const toggleChart = (id: string) => {
    const current = hiddenCharts ?? [];
    const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
    workspace.dispatch({ type: "projection/setHiddenCharts", hiddenChartIds: next });
  };

  const failureAge = run && !run.result.summary.success ? (run.result.summary.failureAge ?? null) : null;
  // The SAME run snapshot birth year feeds the table and the Sankey so calendar
  // years agree everywhere; a run's snapshot wins over the live plan profile.
  const birthYear = run?.birthYear ?? workspace.workspace.plan.profile.birthYear;
  const historicalSourceStartYear =
    run?.analysis?.mode === "historical" ? run.analysis.representativeStartYear : undefined;
  // Sankey period: stored preference resolved against the CURRENT run span.
  // A valid stored range is preserved exactly; out-of-span ranges are clamped for
  // display only — mounting a run never rewrites the persisted preference.
  const sankeyRange = run
    ? resolveSankeyRange(workspace.workspace.projectionSankeyRange, runYearRange(run.result.years, birthYear))
    : null;

  return (
    <section
      id="projection-results"
      tabIndex={-1}
      aria-label="Projection"
      className="projection-view"
      data-active-tab={activeTab}
    >
      <header className="projection-controls no-print">
        <h2>Projection</h2>
        {validationErrors.length > 0 && (
          <p className="hint">
            Fix {validationErrors.length} plan validation {validationErrors.length === 1 ? "error" : "errors"} on the
            Plan tab before running.
          </p>
        )}
        {activeTab !== "compare" && (
          <>
            <label className="field">
              Run{" "}
              <select
                aria-label="Scenario to run"
                value={effectiveScenarioId ?? ""}
                disabled={isRunning}
                onChange={(event) => {
                  // Persist the RAW option value: "" is the explicit base choice,
                  // a non-empty value the saved scenario's own id.
                  workspace.dispatch({ type: "projection/setScenarioId", scenarioId: event.currentTarget.value });
                }}
              >
                <option value="">Baseline — working plan with base scenario</option>
                {workspace.workspace.scenarios.map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name || scenario.id}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                void runProjection();
              }}
              disabled={validationErrors.length > 0 || isRunning}
            >
              Run projection
            </button>
            {(runs.length > 0 || isRunning) && (
              <div className="reset-runs">
                <button type="button" onClick={resetRuns} aria-describedby="reset-runs-hint">
                  Reset runs
                </button>
                <p id="reset-runs-hint" className="hint">
                  Clears generated runs and results only; your plan, scenarios, base settings and preferences are kept.
                </p>
              </div>
            )}
            {isRunning && (
              <>
                <p role="status" aria-live="polite">
                  Projection running in the background…
                </p>
                <button type="button" onClick={cancelRun}>
                  Cancel projection
                </button>
              </>
            )}
            {runCancelled && <p role="status">Projection cancelled.</p>}
            {runError && (
              <p role="alert" className="run-error">
                The projection could not run: {runError}
              </p>
            )}
          </>
        )}
      </header>

      {activeTab !== "compare" &&
        (!run ? (
          <p className="hint empty-state">
            Run the projection to see charts, the year-by-year table and the cashflow diagram.
          </p>
        ) : (
          <>
            {/* Shared run context stays ABOVE the tablist so both subtabs describe
              the same run: stamp, stale notice, fail banner and analysis summary. */}
            <p className="hint run-stamp">
              Results for <strong>{run.scenario.name}</strong>
              {effectiveScenarioId === null
                ? " (baseline)"
                : selectedScenario?.name === run.scenario.name
                  ? ""
                  : " (saved scenario)"}{" "}
              · {new Date(run.createdAt).toLocaleString()}.
              {stale && (
                <>
                  {" "}
                  <strong>Plan or scenario changed since this run —</strong> re-run to refresh.
                </>
              )}
            </p>
            {failureAge !== null && (
              <FailBanner
                summary={run.result.summary}
                onJump={(age) => {
                  setActiveTab("cashflow");
                  setJumpAge(age);
                  setJumpKey((key) => key + 1);
                }}
              />
            )}
            {/* Run summary region (ALL modes that have one): RunAnalysisSummary —
              deterministic = "Tax strategy planning comparison", MC = "Monte Carlo
              ensemble", historical = "Historical rolling-window results" — in ONE
              native collapsible, PERSISTED (projectionRunSummaryCollapsed: true =
              collapsed, false = expanded; the field's absence is also expanded).
              onToggle writes the actual state only when it differs — the toggle
              never fires on mount, so nothing clobbers the stored preference. */}
            {(run.analysis !== undefined || run.result.withdrawalPlan !== undefined) && (
              <details
                className="run-summary-collapse"
                open={!summaryCollapsed}
                onToggle={(event) => {
                  const collapsed = !event.currentTarget.open;
                  if (collapsed === summaryCollapsed) return;
                  workspace.dispatch({ type: "projection/setRunSummaryCollapsed", collapsed });
                }}
              >
                <summary>Run analysis</summary>
                <RunAnalysisSummary run={run} />
                {run.analysis && (
                  <p className="hint">
                    Year table audit counts and failures describe the representative path shown below.
                  </p>
                )}
              </details>
            )}
          </>
        ))}

      <div className="projection-tablist no-print" role="tablist" aria-label="Projection view">
        {PROJECTION_TABS.map((tab) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                tabRefs.current[tab.id] = element;
              }}
              type="button"
              role="tab"
              id={`projection-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`projection-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={onTabKeyDown}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Keep both panels mounted to preserve their local state between tab switches. */}
      <div
        role="tabpanel"
        id="projection-panel-charts"
        aria-labelledby="projection-tab-charts"
        className="projection-panel"
        hidden={activeTab !== "charts"}
      >
        <div className="projection-panel-toolbar no-print">
          <details className="projection-settings projection-chart-settings">
            <SettingsGear label="Chart settings" />
            <div className="projection-settings-menu">
              <p className="settings-heading">Dashboard charts</p>
              {PROJECTION_CHARTS.map((chart) => (
                <label key={chart.id}>
                  <input
                    type="checkbox"
                    checked={!(hiddenCharts ?? []).includes(chart.id)}
                    onChange={() => toggleChart(chart.id)}
                  />{" "}
                  {chart.title}
                </label>
              ))}
            </div>
          </details>
        </div>
        {run && <DashboardSection result={run.result} analysis={run.analysis} />}
      </div>

      <div
        role="tabpanel"
        id="projection-panel-cashflow"
        aria-labelledby="projection-tab-cashflow"
        className="projection-panel"
        hidden={activeTab !== "cashflow"}
      >
        <div className="projection-panel-toolbar projection-table-toolbar">
          <h3>Year-by-year results</h3>
          <details className="projection-settings projection-table-settings no-print">
            <SettingsGear label="Table settings" />
            <div className="projection-settings-menu">
              <p className="settings-heading">Table columns</p>
              {/* ONE bulk action for TABLE columns only (charts unaffected): a native
                  checkbox — checked when every selectable column is visible, unchecked
                  when none is, DOM-`indeterminate` (announced as "mixed") in any
                  partial state. Clicking in a partial or none state selects all;
                  clicking while checked unselects all. Pinned Age/calendar-year and
                  Audit columns are never selectable, so they always remain. */}
              <div className="bulk-columns">
                <label>
                  <input
                    ref={bulkColumnsRef}
                    type="checkbox"
                    aria-label="Select all columns"
                    checked={(hiddenList ?? []).length === 0}
                    onChange={() => {
                      const allVisible = (hiddenList ?? []).length === 0;
                      workspace.dispatch({
                        type: "projection/setHiddenColumns",
                        hiddenColumnIds: allVisible ? selectableIds : null,
                      });
                    }}
                  />{" "}
                  Select all columns
                </label>{" "}
                <span className="bulk-columns-count">
                  ({selectableIds.length - (hiddenList ?? []).length} of {selectableIds.length} shown)
                </span>
              </div>
              {columnPickerGroups.map(({ group, items }) => (
                <div key={group} className="settings-group">
                  <p className="settings-group-name">{group}</p>
                  {items.map((col) => (
                    <label key={col.id}>
                      <input type="checkbox" checked={!hiddenIds?.has(col.id)} onChange={() => toggleColumn(col.id)} />{" "}
                      {col.label}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </details>
        </div>
        {run && (
          <ProjectionTable
            result={run.result}
            birthYear={birthYear}
            historicalSourceStartYear={historicalSourceStartYear}
            jumpAge={jumpAge}
            jumpKey={jumpKey}
            hiddenColumnIds={hiddenIds}
            visible={activeTab === "cashflow"}
          />
        )}
        {run &&
          (sankeyRange ? (
            <CashflowSankey
              years={run.result.years}
              birthYear={birthYear}
              range={sankeyRange}
              onRangeChange={(range) => workspace.dispatch({ type: "projection/setSankeyRange", range })}
              showAccounts={workspace.workspace.projectionSankeyShowAccounts === true}
              onShowAccountsChange={(showAccounts) =>
                workspace.dispatch({ type: "projection/setSankeyShowAccounts", showAccounts })
              }
            />
          ) : (
            <p className="hint">No projection years are available for the cashflow diagram.</p>
          ))}
      </div>
      <div
        role="tabpanel"
        id="projection-panel-compare"
        aria-labelledby="projection-tab-compare"
        className="projection-panel"
        hidden={activeTab !== "compare"}
      >
        {activeTab === "compare" && <CompareView />}
      </div>
    </section>
  );
}
