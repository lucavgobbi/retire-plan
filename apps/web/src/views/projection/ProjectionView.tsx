import { useState } from "react";
import { useProjectionRun, useWorkspace } from "../../store/api";
import { DashboardSection } from "./DashboardSection";
import { ProjectionTable } from "./ProjectionTable";
import { FailBanner } from "./FailBanner";
import { RunAnalysisSummary } from "./RunAnalysisSummary";
import "./projection.css";

/**
 * Default (zero-prop) projection view: the deterministic year table with its audit
 * trail expansion, the run-out fail banner, and the dashboard charts above it.
 * Runs dispatch through the store hook — never `simulate` directly.
 * `stale` comes straight off `useProjectionRun`; legacy fixture runs without a
 * `birthYear` stamp fall back to the plan's profile birth year only for the table axis.
 */
export function ProjectionView() {
  const [jumpAge, setJumpAge] = useState<number | null>(null);
  const [jumpKey, setJumpKey] = useState(0);
  const workspace = useWorkspace();
  const { validationErrors, runError } = workspace;
  const { run, runProjection, stale, isRunning, runCancelled, cancelRun } = useProjectionRun();

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
        <button type="button" onClick={() => { void runProjection(); }} disabled={validationErrors.length > 0 || isRunning}>
          Run projection
        </button>
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
            Results for <strong>{run.scenario.name}</strong> · {new Date(run.createdAt).toLocaleString()}.
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
          <ProjectionTable result={run.result} birthYear={birthYear} historicalSourceStartYear={historicalSourceStartYear} jumpAge={jumpAge} jumpKey={jumpKey} />
        </>
      )}
    </section>
  );
}
