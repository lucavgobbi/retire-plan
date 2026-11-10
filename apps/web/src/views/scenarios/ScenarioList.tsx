import type { ScenarioDelta } from "../../domain/types";
import { useProjectionRun, useWorkspace } from "../../store/api";
import { fmtMoney } from "../projection/fmt";

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
  const { dispatch } = useWorkspace();
  const { run, runProjection, error, stale } = useProjectionRun(undefined, delta.id);

  return (
    <li className="scenario-item">
      <div className="scenario-head">
        <strong>{delta.name}</strong>
        <span className="badge">deterministic</span>
        <div className="scenario-actions">
          <button type="button" aria-label={`Run ${delta.name}`} onClick={() => runProjection()}>
            Run
          </button>
          <button type="button" onClick={() => onEdit(delta.id)}>
            Edit
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
      {run && !editing && <SummaryStrip summary={run.result.summary} />}
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
  if (o.retirementAge !== undefined) parts.push(`retirement age ${o.retirementAge}`);
  if (o.returnAssumptions) {
    parts.push(
      `returns ${(o.returnAssumptions.equity * 100).toFixed(0)}/${(o.returnAssumptions.bond * 100).toFixed(0)}/${(o.returnAssumptions.cash * 100).toFixed(0)}% (equity/bond/cash)`,
    );
  }
  if (o.withdrawalOrder) parts.push(`withdrawal order ${o.withdrawalOrder.join(", ")}`);
  return parts.length === 0 ? "inherits the working scenario (no overrides)" : parts.join(" · ");
}
