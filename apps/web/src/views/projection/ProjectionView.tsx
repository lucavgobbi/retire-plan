import { useProjectionRun, useWorkspace } from "../../store/api";
import { DashboardSection } from "./DashboardSection";
import { ProjectionTable } from "./ProjectionTable";
import { FailBanner } from "./FailBanner";
import "./projection.css";

/**
 * Default (zero-prop) projection view: the deterministic year table with its audit
 * trail expansion, the run-out fail banner, and the dashboard charts above it.
 * Runs dispatch through the store hook — never `simulate` directly.
 * `stale` comes straight off `useProjectionRun`; legacy fixture runs without a
 * `birthYear` stamp fall back to the plan's profile birth year only for the table axis.
 */
export function ProjectionView() {
  const workspace = useWorkspace();
  const { validationErrors, runError } = workspace;
  const { run, runProjection, stale } = useProjectionRun();

  const failureAge = run && !run.result.summary.success ? (run.result.summary.failureAge ?? null) : null;
  const birthYear = run?.birthYear ?? workspace.workspace.plan.profile.birthYear;

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
        <button type="button" onClick={() => runProjection()} disabled={validationErrors.length > 0}>
          Run projection
        </button>
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
          {failureAge !== null && <FailBanner summary={run.result.summary} />}
          <DashboardSection result={run.result} />
          <ProjectionTable result={run.result} birthYear={birthYear} />
        </>
      )}
    </section>
  );
}
