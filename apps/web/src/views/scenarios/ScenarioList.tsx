import type { ScenarioDelta } from "../../domain/types";
import { useProjectionRun, useWorkspace } from "../../store/api";
import { fmtMoney, fmtPercent } from "../projection/fmt";
import { formatAccountOrder } from "../../domain/accountOrder";

interface ScenarioSummary {
  success: boolean;
  failureAge?: number;
  finalNetWorth: number;
  worstShortfallAge?: number;
}

export function ScenarioList({
  deltas,
  editingId,
  onEdit,
}: {
  deltas: ScenarioDelta[];
  editingId: string | null;
  onEdit: (id: string) => void;
}) {
  if (deltas.length === 0 && editingId === null) return null;
  return (
    <ul className="scenario-list" aria-label="Scenario list">
      {deltas.map((delta) => (
        <ScenarioListItem key={delta.id} delta={delta} editing={editingId === delta.id} onEdit={onEdit} />
      ))}
    </ul>
  );
}

/** One list item: overrides summary, per-scenario Run (with summary strip), edit/delete. */
export function ScenarioListItem({
  delta,
  editing,
  onEdit,
}: {
  delta: ScenarioDelta;
  editing: boolean;
  onEdit: (id: string) => void;
}) {
  const { dispatch, workspace } = useWorkspace();
  const { run, runProjection, error, stale, isRunning, cancelRun } = useProjectionRun(undefined, delta.id);

  return (
    <li className="scenario-item">
      <div className="scenario-head">
        <strong>{delta.name}</strong>
        <span className="badge">{delta.simMode === "montecarlo" ? "Monte Carlo" : delta.simMode === "historical" ? "Historical" : "Deterministic"}</span>
        <div className="scenario-actions">
          <button type="button" aria-label={`Run ${delta.name}`} disabled={isRunning} onClick={() => { void runProjection(); }}>
            Run
          </button>
          {isRunning && <button type="button" onClick={cancelRun}>Cancel projection</button>}
          <button type="button" onClick={() => onEdit(delta.id)}>
            Edit
          </button>
          <button
            type="button"
            aria-label={`Duplicate ${delta.name}`}
            onClick={() => {
              const copy = duplicateScenario(delta, workspace.scenarios.map(item => item.name));
              dispatch({ type: "scenario/add", delta: copy });
              onEdit(copy.id);
            }}
          >
            Duplicate
          </button>
          <button
            type="button"
            aria-label={`Delete ${delta.name}`}
            onClick={() => {
              if (window.confirm(`Delete scenario "${delta.name}"? This cannot be undone.`)) {
                dispatch({ type: "scenario/remove", delta });
              }
            }}
          >
            Delete
          </button>
        </div>
      </div>
      <p className="hint scenario-overrides">{describeOverrides(delta)}</p>
      {run && !editing && run.analysis ? <p className="summary-strip">
        {run.analysis.mode === "historical" ? `Historical ${run.analysis.representativeStartYear}–${run.analysis.representativeEndYear} · ` : "Monte Carlo · "}
        {(run.analysis.successRate * 100).toFixed(1)}% success · final net worth p10 {fmtMoney(run.analysis.percentileNetWorth.p10)}, median {fmtMoney(run.analysis.percentileNetWorth.p50)}, p90 {fmtMoney(run.analysis.percentileNetWorth.p90)}
      </p> : run && !editing && <SummaryStrip summary={run.result.summary} />}
      {run && (
        <p className="hint scenario-run-stamp">
          Last run {new Date(run.createdAt).toLocaleString()}.
          {stale && (
            <>
              {" "}
              <strong>Plan or scenario changed since this run —</strong> re-run to refresh.
            </>
          )}
        </p>
      )}
      {error && <p role="alert">The scenario run failed: {error}</p>}
    </li>
  );
}

export function uniqueCopyName(sourceName: string, existingNames: Iterable<string>): string {
  const occupied = new Set([...existingNames].map(name => name.trim().toLocaleLowerCase()));
  const stem = `Copy of ${sourceName.trim() || "Scenario"}`;
  let name = stem;
  let suffix = 2;
  while (occupied.has(name.toLocaleLowerCase())) name = `${stem} (${suffix++})`;
  return name;
}

export function duplicateScenario(delta: ScenarioDelta, existingNames: Iterable<string>): ScenarioDelta {
  return {
    ...structuredClone(delta),
    id: crypto.randomUUID(),
    name: uniqueCopyName(delta.name, existingNames),
  };
}

export function SummaryStrip({ summary }: { summary: ScenarioSummary }) {
  return (
    <p className="summary-strip">
      {summary.success ? "Success" : `Fails at age ${summary.failureAge ?? "unknown"}`}
      {" · "}
      final net worth {fmtMoney(summary.finalNetWorth)}
      {summary.worstShortfallAge !== undefined && <> · worst shortfall age {summary.worstShortfallAge}</>}
    </p>
  );
}

export function describeOverrides(delta: ScenarioDelta): string {
  const parts: string[] = [];
  const o = delta.overrides;
  if (delta.benefits) {
    const included = [delta.benefits.cpp && "CPP", delta.benefits.oas && "OAS", delta.benefits.oas && delta.benefits.gis && "GIS"].filter(Boolean);
    parts.push(`benefits ${included.length ? included.join(", ") : "none"}`);
  }
  if (delta.withdrawalStrategy === "tax-minimizing") parts.push("tax-minimizing planning");
  else if (delta.withdrawalStrategy === "manual") parts.push("manual withdrawal order");
  if (o.retirementAge !== undefined) parts.push(`retirement age ${o.retirementAge}`);
  if (delta.simMode === "historical") {
    parts.push(`JST historical windows from ${delta.historicalConfig?.startYear ?? "the working setting"}`);
  } else if (o.returnAssumptions) {
    parts.push(
      `returns ${fmtPercent(o.returnAssumptions.equity)} equity, ${fmtPercent(o.returnAssumptions.bond)} bonds, ${fmtPercent(o.returnAssumptions.cash)} cash`,
    );
  }
  if (o.withdrawalOrder) parts.push(`withdrawal order ${formatAccountOrder(o.withdrawalOrder)}`);
  return parts.length === 0 ? "inherits the working scenario (no overrides)" : parts.join(" · ");
}
