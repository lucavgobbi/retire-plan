import { useEffect, useRef, useState } from "react";
import { useProjectionRun, useRuns, useWorkspace } from "../../store/api";
import { DashboardSection, PROJECTION_CHARTS } from "./DashboardSection";
import { ProjectionTable, columns, sanitizeHiddenColumns } from "./ProjectionTable";
import { sanitizeHiddenIds } from "./hiddenIds";
import { FailBanner } from "./FailBanner";
import { RunAnalysisSummary } from "./RunAnalysisSummary";
import "./projection.css";

/**
 * Default (zero-prop) projection view: the deterministic year table with its audit
 * trail expansion, the run-out fail banner, and the dashboard charts above it.
 * Runs dispatch through the store hook — never `simulate` directly.
 *
 * A dropdown chooses WHAT to run: the baseline (the working plan with the base
 * scenario) or any saved scenario. The selection is passed into
 * `useProjectionRun(planId, scenarioId)`, which keys the active run, staleness,
 * busy and cancel state on exactly that scenario id — the displayed result always
 * belongs to the selected scenario, and `runProjection` re-runs the resolved
 * delta (user item 7). While a run is busy the dropdown is disabled (the store
 * has a single run slot) — cancel means cancelling the running projection. The
 * selection is PERSISTED as workspace.projectionScenarioId (the Provider also
 * records each run's intent there at request time); the UI derives from it.
 */
export function ProjectionView() {
  const [jumpAge, setJumpAge] = useState<number | null>(null);
  const [jumpKey, setJumpKey] = useState(0);
  const workspace = useWorkspace();
  const runs = useRuns();
  const { validationErrors, runError, resetRuns } = workspace;
  // Scenario selection is PERSISTED as workspace.projectionScenarioId under the
  // agreed contract: "" (the UI's empty option) is an EXPLICIT base choice,
  // undefined is absence/default (also the base), and any NON-EMPTY string is an
  // actual saved-scenario id — no sentinel id is invented. null is reserved for
  // the CLEAR action. An explicit base choice survives remounts even when the
  // plan's most recent run is a saved-scenario run.
  const planId = workspace.workspace.meta?.id ?? "unsaved";
  const storedScenarioId = workspace.workspace.projectionScenarioId ?? "";
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
    const stored = workspace.workspace.projectionScenarioId;
    if (stored === undefined || stored === "") return;
    if (workspace.workspace.scenarios.some((item) => item.id === stored)) return;
    workspace.dispatch({ type: "projection/setScenarioId", scenarioId: null });
  }, [workspace.workspace.projectionScenarioId, workspace.workspace.scenarios]);
  const selectedScenario = storedScenarioId === ""
    ? null
    : workspace.workspace.scenarios.find((item) => item.id === storedScenarioId) ?? null;
  const effectiveScenarioId = selectedScenario?.id ?? null;
  const { run, runProjection, stale, isRunning, runCancelled, cancelRun } = useProjectionRun(planId, effectiveScenarioId);

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
  const hiddenCharts = sanitizeHiddenIds(workspace.workspace.hiddenProjectionCharts, PROJECTION_CHARTS.map((chart) => chart.id));
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
  const birthYear = run?.birthYear ?? workspace.workspace.plan.profile.birthYear;
  const historicalSourceStartYear = run?.analysis?.mode === "historical" ? run.analysis.representativeStartYear : undefined;

  return (
    <section id="projection-results" tabIndex={-1} aria-label="Projection" className="projection-view">
      <header className="projection-controls no-print">
        <h2>Projection</h2>
        {validationErrors.length > 0 && (
          <p className="hint">
            Fix {validationErrors.length} plan validation {validationErrors.length === 1 ? "error" : "errors"} on the
            Plan tab before running.
          </p>
        )}
        <label className="field">
          Run
          {" "}
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
              <option key={scenario.id} value={scenario.id}>{scenario.name || scenario.id}</option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => { void runProjection(); }} disabled={validationErrors.length > 0 || isRunning}>
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
        <details className="projection-settings">
          <summary aria-label="Projection settings" title="Projection settings">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
              <g fill="currentColor">
                {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => <rect key={angle} x="11" y="2.5" width="2" height="5" rx="1" transform={`rotate(${angle} 12 12)`} />)}
                <circle cx="12" cy="12" r="5.2" />
              </g>
              <circle cx="12" cy="12" r="2.2" fill="#fff" />
            </svg>
          </summary>
          <div className="projection-settings-menu">
            <div className="settings-section">
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
            <div className="settings-section">
              <p className="settings-heading">Table columns</p>
              {/* ONE bulk action for TABLE columns only (charts unaffected): a native
                  checkbox — checked when every selectable column is visible, unchecked
                  when none is, DOM-`indeterminate` (announced as "mixed") in any
                  partial state. Clicking in a partial or none state selects all;
                  clicking while checked unselects all. The visible count stays beside
                  the stable accessible label. Pinned Age/calendar-year and Audit
                  columns are never selectable, so they always remain. */}
              <div className="bulk-columns">
                <label>
                  <input
                    ref={bulkColumnsRef}
                    type="checkbox"
                    aria-label="Select all columns"
                    checked={(hiddenList ?? []).length === 0}
                    onChange={() => {
                      const allVisible = (hiddenList ?? []).length === 0;
                      workspace.dispatch({ type: "projection/setHiddenColumns", hiddenColumnIds: allVisible ? selectableIds : null });
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
                      <input
                        type="checkbox"
                        checked={!(hiddenIds ?? new Set<string>()).has(col.id)}
                        onChange={() => toggleColumn(col.id)}
                      />{" "}
                      {col.label}
                    </label>
                  ))}
                </div>
              ))}
            </div>
           </div>
         </details>
        {isRunning && <>
          <p role="status" aria-live="polite">Projection running in the background…</p>
          <button type="button" onClick={cancelRun}>Cancel projection</button>
        </>}
        {runCancelled && <p role="status">Projection cancelled.</p>}
        {runError && (
          <p role="alert" className="run-error">
            The projection could not run: {runError}
          </p>
        )}
      </header>

      {!run ? (
        <p className="hint empty-state">
          Run the projection to see the year-by-year table, audit trail and dashboard charts.
        </p>
      ) : (
        <>
          <p className="hint run-stamp">
            Results for <strong>{run.scenario.name}</strong>
            {effectiveScenarioId === null
              ? " (baseline)"
              : selectedScenario?.name === run.scenario.name ? "" : " (saved scenario)"} · {new Date(run.createdAt).toLocaleString()}.
            {stale && (
              <>
                {" "}
                <strong>Plan or scenario changed since this run —</strong> re-run to refresh.
              </>
            )}
          </p>
          {failureAge !== null && <FailBanner summary={run.result.summary} onJump={(age) => { setJumpAge(age); setJumpKey((key) => key + 1); }} />}
          {/* Run summary region (ALL modes that have one): RunAnalysisSummary —
              deterministic = "Tax strategy planning comparison", MC = "Monte Carlo
              ensemble", historical = "Historical rolling-window results" — in ONE
              native collapsible, PERSISTED (projectionRunSummaryCollapsed: true =
              collapsed, false = expanded; the field's absence is also expanded).
              onToggle writes the actual state only when it differs — the toggle
              never fires on mount, so nothing clobbers the stored preference.
              Context stamp, failure banner, run controls and charts stay outside.
              No box is invented for plain manual-order deterministic runs. */}
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
              {run.analysis && <p className="hint">Year table audit counts and failures describe the representative path shown below.</p>}
            </details>
          )}
          <DashboardSection result={run.result} />
          <ProjectionTable result={run.result} birthYear={birthYear} historicalSourceStartYear={historicalSourceStartYear} jumpAge={jumpAge} jumpKey={jumpKey} hiddenColumnIds={hiddenIds} />
        </>
      )}
    </section>
  );
}
