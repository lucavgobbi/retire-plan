import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountType } from "@budgettool/engine";
import { useWorkspace } from "../../store/api";
import type { ScenarioBase, ScenarioDelta } from "../../domain/types";

const ACCOUNT_TYPES: AccountType[] = ["tfsa", "rrsp", "nonreg"];

type Overrides = NonNullable<ScenarioDelta["overrides"]>;
type EditorDraft = {
  name: string;
  retirementAge: string;
  equity: string;
  bond: string;
  cash: string;
  order: AccountType[];
};
/** Fully populated overrides; `Overrides` may leave returnAssumptions/withdrawalOrder unset. */
type FullOverrides = {
  retirementAge: number;
  returnAssumptions: { equity: number; bond: number; cash: number };
  withdrawalOrder: AccountType[];
};

/**
 * Percent text for a stored rate, preserving decimal precision (5.5% stays "5.5",
 * never rounds to "6"). Rounds away float binary noise (0.07→7.000000000000001)
 * at the 10th decimal of the percent value — far below any meaningful input precision.
 */
function fmtPercentInput(rate: number): string {
  return String(Math.round(rate * 1e12) / 1e10);
}

function effectiveOverrides(delta: ScenarioDelta | null, base: ScenarioBase): FullOverrides {
  return {
    retirementAge: delta?.overrides.retirementAge ?? base.retirementAge,
    returnAssumptions: {
      equity: delta?.overrides.returnAssumptions?.equity ?? base.returnAssumptions.equity,
      bond: delta?.overrides.returnAssumptions?.bond ?? base.returnAssumptions.bond,
      cash: delta?.overrides.returnAssumptions?.cash ?? base.returnAssumptions.cash,
    },
    withdrawalOrder: [...(delta?.overrides.withdrawalOrder ?? base.withdrawalOrder)],
  };
}

function draftOf(storedDelta: ScenarioDelta | null, base: ScenarioBase): EditorDraft {
  if (!storedDelta) {
    return {
      name: "",
      retirementAge: String(base.retirementAge),
      equity: fmtPercentInput(base.returnAssumptions.equity),
      bond: fmtPercentInput(base.returnAssumptions.bond),
      cash: fmtPercentInput(base.returnAssumptions.cash),
      order: [...base.withdrawalOrder],
    };
  }
  const overrides = effectiveOverrides(storedDelta, base);
  return {
    name: storedDelta.name,
    retirementAge: String(overrides.retirementAge),
    equity: fmtPercentInput(overrides.returnAssumptions.equity),
    bond: fmtPercentInput(overrides.returnAssumptions.bond),
    cash: fmtPercentInput(overrides.returnAssumptions.cash),
    order: overrides.withdrawalOrder,
  };
}

/**
 * Create/edit editor for a ScenarioDelta that saves on edit. Percent fields are
 * return-rate assumptions (sum-free validation, they are not a mix); withdrawal
 * order uses three selects with a duplicate guard because engine `fundDeficit`
 * walks the array in order. Untouched rate inputs preserve the stored precision.
 * A newly named scenario is added on the first valid change, and later edits
 * update that same delta.
 */
export function ScenarioEditorForm({ delta, onDone }: { delta: ScenarioDelta | null; onDone: () => void }) {
  const workspace = useWorkspace();
  const base = workspace.baseScenario;
  const basePlanId = workspace.workspace.meta?.id ?? "unsaved";
  const [draft, setDraft] = useState<EditorDraft>(() => draftOf(delta, base));
  const appliedId = useRef<string | null>(delta?.id ?? null);
  const lastApplied = useRef<ScenarioDelta | null>(delta);
  useEffect(() => {
    const storedDelta = workspace.workspace.scenarios.find(item => item.id === appliedId.current) ?? null;
    if (JSON.stringify(storedDelta) !== JSON.stringify(lastApplied.current)) {
      lastApplied.current = storedDelta;
      setDraft(draftOf(storedDelta, base));
    }
  }, [workspace.workspace.scenarios, base, delta]);

  const duplicateOrder = useMemo(() => new Set(draft.order).size !== draft.order.length, [draft.order]);

  const validate = (draftState: EditorDraft): string[] => {
    const validationErrors: string[] = [];
    const age = Number(draftState.retirementAge);
    if (!Number.isFinite(age) || age <= 0) validationErrors.push("Retirement age must be a positive number.");
    else if (!Number.isInteger(age)) validationErrors.push("Retirement age must be a whole number of years.");
    for (const label of ["equity", "bond", "cash"] as const) {
      if (!Number.isFinite(Number(draftState[label]))) validationErrors.push(`Return assumption (capital ${label}) must be a number.`);
    }
    if (duplicateOrder) validationErrors.push("Choose each withdrawal account exactly once.");
    if (!draftState.name.trim()) validationErrors.push("Name the scenario.");
    return validationErrors;
  };
  const errors = validate(draft);

  const change = (patch: Partial<EditorDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (validate(next).length > 0) return;
    // Untouched rate inputs (their text equals the stored rate's display) keep the
    // exact stored precision instead of round-tripping through a number.
    const source = effectiveOverrides(lastApplied.current, base);
    const overrides: Overrides = {
      retirementAge: Number(next.retirementAge),
      returnAssumptions: {
        equity: next.equity === fmtPercentInput(source.returnAssumptions.equity) ? source.returnAssumptions.equity : Number(next.equity) / 100,
        bond: next.bond === fmtPercentInput(source.returnAssumptions.bond) ? source.returnAssumptions.bond : Number(next.bond) / 100,
        cash: next.cash === fmtPercentInput(source.returnAssumptions.cash) ? source.returnAssumptions.cash : Number(next.cash) / 100,
      },
      withdrawalOrder: [...next.order],
    };
    const nextDelta: ScenarioDelta = {
      id: appliedId.current ?? crypto.randomUUID(),
      name: next.name.trim(),
      basePlanId,
      simMode: "deterministic",
      overrides,
    };
    if (JSON.stringify(nextDelta) === JSON.stringify(lastApplied.current)) return;
    workspace.dispatch({ type: appliedId.current ? "scenario/update" : "scenario/add", delta: nextDelta });
    appliedId.current = nextDelta.id;
    lastApplied.current = nextDelta;
  };

  return (
    <div className="scenario-editor" aria-label="Scenario editor">
      <label>
        Name
        <input
          aria-label="Name"
          type="text"
          value={draft.name}
          onChange={(e) => change({ name: e.target.value })}
        />
      </label>

      <label>
        <span>Simulation mode</span>
        <select value="deterministic" onChange={() => undefined} aria-label="Simulation mode">
          <option value="deterministic">deterministic</option>
          <option value="montecarlo" disabled>
            montecarlo
          </option>
          <option value="historical" disabled>
            historical
          </option>
        </select>
        <span className="hint">montecarlo and historical are coming in Phase 3</span>
      </label>

      <label>
        <span>Retirement age override</span>
        <input
          aria-label="Retirement age override"
          type="number"
          min={1}
          step={1}
          value={draft.retirementAge}
          onChange={(e) => change({ retirementAge: e.target.value })}
        />
        <span className="hint">Whole years only (integer ages).</span>
      </label>

      <fieldset>
        <legend>Return assumptions (rates, not a mix — no sum check)</legend>
        <label>
          Equity %
          <input
            aria-label="Equity %"
            type="number"
            value={draft.equity}
            onChange={(e) => change({ equity: e.target.value })}
          />
        </label>
        <label>
          Bond %
          <input
            aria-label="Bond %"
            type="number"
            value={draft.bond}
            onChange={(e) => change({ bond: e.target.value })}
          />
        </label>
        <label>
          Cash %
          <input
            aria-label="Cash %"
            type="number"
            value={draft.cash}
            onChange={(e) => change({ cash: e.target.value })}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Withdrawal order (order in which accounts fund deficits)</legend>
        {[0, 1, 2].map((index) => (
          <label key={index}>
            <span>{`${index + 1}${["st", "nd", "rd"][index]} drawn`}</span>
            <select
              aria-label={`${index + 1}${["st", "nd", "rd"][index]} drawn`}
              value={draft.order[index]}
              onChange={(e) => {
                const order = [...draft.order];
                order[index] = e.target.value as AccountType;
                change({ order });
              }}
            >
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>

      {errors.length > 0 && (
        <div role="status" className="form-errors">
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}

      <div className="editor-actions">
        <button type="button" onClick={onDone}>
          Back
        </button>
      </div>
    </div>
  );
}
