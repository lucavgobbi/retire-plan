import type { ScenarioBase, ScenarioDelta, WithdrawalStrategy } from "../../domain/types";
import { useProjectionRun, useWorkspace } from "../../store/api";
import { fmtMoney, fmtPercent } from "../projection/fmt";
import { formatAccountOrder } from "../../domain/accountOrder";
import { ScenarioEditorForm } from "./ScenarioEditorForm";

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
  onEdit: (id: string | null) => void;
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
  onEdit: (id: string | null) => void;
}) {
  const { dispatch, workspace, baseScenario } = useWorkspace();
  const { run, runProjection, error, stale, isRunning, cancelRun } = useProjectionRun(undefined, delta.id);
  // Current cards describe the mode the scenario will actually run with, not just
  // an explicit override: inherited base strategy matters here too.
  const withdrawalStrategy = effectiveWithdrawalStrategy(delta, baseScenario);

  return (
    <li className="scenario-item" data-inline-edit-row>
      <div className="scenario-head">
        <strong>{delta.name}</strong>
        <span className="badge">
          {delta.simMode === "montecarlo"
            ? "Monte Carlo"
            : delta.simMode === "historical"
              ? "Historical"
              : "Deterministic"}
        </span>
        <div className="scenario-actions">
          <button
            type="button"
            aria-label={`Run ${delta.name}`}
            disabled={isRunning}
            onClick={() => {
              void runProjection();
            }}
          >
            Run
          </button>
          {isRunning && (
            <button type="button" onClick={cancelRun}>
              Cancel projection
            </button>
          )}
          {!editing && (
            <button type="button" data-inline-edit-trigger onClick={() => onEdit(delta.id)}>
              Edit
            </button>
          )}
          <button
            type="button"
            aria-label={`Duplicate ${delta.name}`}
            onClick={() => {
              const copy = duplicateScenario(
                delta,
                workspace.scenarios.map((item) => item.name),
              );
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
      {editing ? (
        <ScenarioEditorForm key={delta.id} delta={delta} onDone={() => onEdit(null)} />
      ) : (
        <>
          <p className="hint scenario-withdrawal-mode">
            Withdrawal mode <strong>{withdrawalStrategyLabel(withdrawalStrategy)}</strong>
          </p>
          <p className="hint scenario-overrides">{describeOverrides(delta)}</p>
          {run && run.analysis ? (
            <p className="summary-strip">
              {run.analysis.mode === "historical"
                ? `Historical ${run.analysis.representativeStartYear}–${run.analysis.representativeEndYear} · `
                : "Monte Carlo · "}
              {(run.analysis.successRate * 100).toFixed(1)}% success · final net worth p10{" "}
              {fmtMoney(run.analysis.percentileNetWorth.p10)}, median {fmtMoney(run.analysis.percentileNetWorth.p50)},
              p90 {fmtMoney(run.analysis.percentileNetWorth.p90)}
            </p>
          ) : (
            run && <SummaryStrip summary={run.result.summary} />
          )}
        </>
      )}
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
  const occupied = new Set([...existingNames].map((name) => name.trim().toLocaleLowerCase()));
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

/** Effective mode for a current scenario: explicit override, then base, then legacy manual. */
export function effectiveWithdrawalStrategy(delta: ScenarioDelta, base: ScenarioBase): WithdrawalStrategy {
  return delta.withdrawalStrategy ?? base.withdrawalStrategy ?? "manual";
}

export function withdrawalStrategyLabel(strategy: WithdrawalStrategy): string {
  return strategy === "tax-minimizing" ? "Tax-minimizing planning" : "Manual account order";
}

export function describeOverrides(delta: ScenarioDelta): string {
  const parts: string[] = [];
  const o = delta.overrides;
  if (delta.benefits) {
    const included = [
      delta.benefits.cpp && "CPP",
      delta.benefits.oas && "OAS",
      delta.benefits.oas && delta.benefits.gis && "GIS",
    ].filter(Boolean);
    parts.push(`benefits ${included.length ? included.join(", ") : "none"}`);
  }
  // Explicit payroll is an override even when it turns both programs off — it
  // differs from absent (inherit the working settings).
  if (delta.payroll) {
    const programs = [delta.payroll.cpp && "CPP", delta.payroll.ei && "EI"].filter(Boolean);
    const optOut = delta.payroll.cppOptOut65to69 ? " · opt-out 65–69" : "";
    parts.push(`payroll ${programs.length ? programs.join(" + ") : "none"}${optOut}`);
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
