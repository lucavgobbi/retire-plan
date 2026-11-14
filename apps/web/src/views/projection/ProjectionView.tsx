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
 * selection is in-memory view state; the store has no
 * UI-preferences persistence pattern, so none is invented here.
 */
export function ProjectionView() {
  const [jumpAge, setJumpAge] = useState<number | null>(null);
  const [jumpKey, setJumpKey] = useState(0);
  const workspace = useWorkspace();
  const runs = useRuns();
  const { validationErrors, runError } = workspace;
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  // The ACTIVE run for the current plan (the store's single run slot). The dropdown
  // initializes from it (entering Projection with a completed saved-scenario run
  // must show that run, not hide it behind a null selection) and FOLLOWS each newly
  // completed run by id — including a run that finishes after the view mounted
  // mid-background-run. Idle manual dropdown changes are never reverted: the sync
  // fires only when the active run ID changes, and stays locked while a run is busy.
  const planId = workspace.workspace.meta?.id ?? "unsaved";
  const activeRun = [...runs].reverse().find((record) => record.id === workspace.activeRunId && record.planId === planId);
  const followedRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeRun === undefined || followedRunIdRef.current === activeRun.id) return;
    followedRunIdRef.current = activeRun.id;
    setSelectedScenarioId(activeRun.scenarioId);
  }, [activeRun]);
  // Actual state reset (not just the derived fallback): when the selected id no
  // longer exists (scenario deleted / import dropped it), clear it so restoring
  // the SAME id later does not auto-reselect. The functional updater validates
  // the CURRENT value, so it never clobbers a newly-followed active run set by
  // the effect above.
  useEffect(() => {
    setSelectedScenarioId((current) => {
      if (current === null) return current;
      const stillExists = workspace.workspace.scenarios.some((item) => item.id === current);
      return stillExists ? current : null;
    });
  }, [workspace.workspace.scenarios]);
  // Fallback guard: if the selected scenario is deleted (or a workspace import drops it)
  // while the view is mounted, an unknown id must NOT keep keying the run lookup or
  // silently no-op Run — it falls back to baseline (user item 7 edge).
  const selectedScenario = selectedScenarioId === null
    ? null
    : workspace.workspace.scenarios.find((item) => item.id === selectedScenarioId) ?? null;
  const effectiveScenarioId = selectedScenario?.id ?? null;
  const { run, runProjection, stale, isRunning, runCancelled, cancelRun } = useProjectionRun(planId, effectiveScenarioId);

  // Column visibility: the workspace persists HIDDEN data-column ids (absent or
  // empty = all visible, so columns added later default visible; stale ids are
  // dropped by the sanitizer). Age/calendar-year and Audit stay pinned.
  const allColumns = columns();
  const selectableIds = allColumns.slice(1).map((col) => col.id);
  const hiddenList = sanitizeHiddenColumns(workspace.workspace.hiddenProjectionColumns, selectableIds);
  const hiddenIds = hiddenList === null ? undefined : new Set(hiddenList);
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
              setSelectedScenarioId(event.currentTarget.value === "" ? null : event.currentTarget.value);
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
            <button type="button" onClick={() => {
              workspace.dispatch({ type: "projection/setHiddenColumns", hiddenColumnIds: null });
              workspace.dispatch({ type: "projection/setHiddenCharts", hiddenChartIds: null });
            }}>
              Show everything
            </button>
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
          <RunAnalysisSummary run={run} />
          {run.analysis && <p className="hint">Year table audit counts and failures describe the representative path shown below.</p>}
          <DashboardSection result={run.result} />
          <ProjectionTable result={run.result} birthYear={birthYear} historicalSourceStartYear={historicalSourceStartYear} jumpAge={jumpAge} jumpKey={jumpKey} hiddenColumnIds={hiddenIds} />
        </>
      )}
    </section>
  );
}
