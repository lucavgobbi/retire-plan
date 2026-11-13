import { useEffect, useMemo, useRef, useState } from "react";
import { HISTORICAL_DATASET, type AccountType } from "@retire-plan/engine";
import { useWorkspace } from "../../store/api";
import type { BenefitSettings, ScenarioBase, ScenarioDelta, WithdrawalStrategy } from "../../domain/types";
import { NumberTextInput } from "../../components/NumberTextInput";
import { TAX_MINIMIZING_STRATEGY_HELP } from "../../content/assumptions";
import { ACCOUNT_TYPE_LABELS, cashOrderPosition, INVESTMENT_ACCOUNT_TYPES, investmentOrder, orderWithCashPosition, swapOrderPosition, type CashOrderPosition } from "../../domain/accountOrder";

const ACCOUNT_TYPES: AccountType[] = [...INVESTMENT_ACCOUNT_TYPES];
const HISTORICAL_FIRST_YEAR = HISTORICAL_DATASET.coverageStart;
const HISTORICAL_LAST_YEAR = HISTORICAL_DATASET.coverageEnd;

type Overrides = NonNullable<ScenarioDelta["overrides"]>;
type EditorDraft = {
  name: string;
  simMode: ScenarioDelta["simMode"];
  retirementAge: string;
  equity: string;
  bond: string;
  cash: string;
  order: AccountType[];
  runs: string;
  seed: string;
  equitySd: string;
  bondSd: string;
  cashSd: string;
  historicalStartYear: string;
  cashPosition: CashOrderPosition;
  benefits: BenefitSettings;
  benefitsOverridden: boolean;
  withdrawalStrategy: WithdrawalStrategy;
  withdrawalStrategyOverridden: boolean;
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
    withdrawalOrder: investmentOrder(delta?.overrides.withdrawalOrder ?? base.withdrawalOrder),
  };
}

function draftOf(storedDelta: ScenarioDelta | null, base: ScenarioBase): EditorDraft {
  if (!storedDelta) {
    return {
      name: "",
      simMode: "deterministic",
      retirementAge: String(base.retirementAge),
      equity: fmtPercentInput(base.returnAssumptions.equity),
      bond: fmtPercentInput(base.returnAssumptions.bond),
      cash: fmtPercentInput(base.returnAssumptions.cash),
      order: investmentOrder(base.withdrawalOrder),
      runs: "1000", seed: "12345", equitySd: "18", bondSd: "7", cashSd: "2", historicalStartYear: String(base.historicalConfig?.startYear ?? HISTORICAL_FIRST_YEAR),
      cashPosition: cashOrderPosition(base.withdrawalOrder),
      benefits: base.benefits ?? { cpp: true, oas: true, gis: true },
      benefitsOverridden: false,
      withdrawalStrategy: base.withdrawalStrategy ?? "manual",
      withdrawalStrategyOverridden: false,
    };
  }
  const overrides = effectiveOverrides(storedDelta, base);
  return {
    name: storedDelta.name,
    simMode: storedDelta.simMode ?? "deterministic",
    retirementAge: String(overrides.retirementAge),
    equity: fmtPercentInput(overrides.returnAssumptions.equity),
    bond: fmtPercentInput(overrides.returnAssumptions.bond),
    cash: fmtPercentInput(overrides.returnAssumptions.cash),
    order: overrides.withdrawalOrder,
    runs: String(storedDelta.mcConfig?.runs ?? 1000), seed: String(storedDelta.mcConfig?.seed ?? 12345),
    equitySd: String((storedDelta.mcConfig?.stdDev.equity ?? 0.18) * 100),
    bondSd: String((storedDelta.mcConfig?.stdDev.bond ?? 0.07) * 100),
    cashSd: String((storedDelta.mcConfig?.stdDev.cash ?? 0.02) * 100),
    historicalStartYear: String(storedDelta.historicalConfig?.startYear ?? base.historicalConfig?.startYear ?? HISTORICAL_FIRST_YEAR),
    cashPosition: cashOrderPosition(storedDelta.overrides.withdrawalOrder ?? base.withdrawalOrder),
    benefits: storedDelta.benefits ?? base.benefits ?? { cpp: true, oas: true, gis: true },
    benefitsOverridden: storedDelta.benefits !== undefined,
    withdrawalStrategy: storedDelta.withdrawalStrategy ?? base.withdrawalStrategy ?? "manual",
    withdrawalStrategyOverridden: storedDelta.withdrawalStrategy !== undefined,
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
  const latestWindowStart = HISTORICAL_LAST_YEAR - (workspace.workspace.plan.profile.endAge - workspace.workspace.plan.profile.currentAge);
  const basePlanId = workspace.workspace.meta?.id ?? "unsaved";
  const configuredIncomes = workspace.workspace.plan.incomes;
  const [draft, setDraft] = useState<EditorDraft>(() => draftOf(delta, base));
  const appliedId = useRef<string | null>(delta?.id ?? null);
  const lastApplied = useRef<ScenarioDelta | null>(delta);
  const lastBase = useRef(JSON.stringify(base));
  useEffect(() => {
    const storedDelta = workspace.workspace.scenarios.find(item => item.id === appliedId.current) ?? null;
    const deltaChanged = JSON.stringify(storedDelta) !== JSON.stringify(lastApplied.current);
    const baseChanged = JSON.stringify(base) !== lastBase.current;
    if (deltaChanged || baseChanged) {
      lastApplied.current = storedDelta;
      lastBase.current = JSON.stringify(base);
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
    if (draft.order.length !== 3 || duplicateOrder || !INVESTMENT_ACCOUNT_TYPES.every(type => draft.order.includes(type))) validationErrors.push("Choose each investment withdrawal account exactly once.");
    if (!draftState.name.trim()) validationErrors.push("Name the scenario.");
    if (draftState.simMode === "montecarlo") {
      const runs = Number(draftState.runs); const seed = Number(draftState.seed);
      if (!Number.isInteger(runs) || runs < 1 || runs > 10_000) validationErrors.push("Monte Carlo runs must be a whole number from 1 to 10,000.");
      if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) validationErrors.push("Monte Carlo seed must be an unsigned 32-bit whole number.");
      for (const [label, value] of [["equity", draftState.equitySd], ["bond", draftState.bondSd], ["cash", draftState.cashSd]] as const) {
        const deviation = Number(value);
        if (!Number.isFinite(deviation) || deviation < 0 || deviation > 100) validationErrors.push(`${label} standard deviation must be from 0% to 100%.`);
      }
    }
    if (draftState.simMode === "historical") {
      const startYear = Number(draftState.historicalStartYear);
      if (!Number.isInteger(startYear) || startYear < HISTORICAL_FIRST_YEAR || startYear > latestWindowStart) {
        validationErrors.push(`Historical start year must be from ${HISTORICAL_FIRST_YEAR} through ${latestWindowStart}, the latest full window for this plan.`);
      }
    }
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
      withdrawalOrder: orderWithCashPosition(next.order, next.cashPosition),
    };
    const nextDelta: ScenarioDelta = {
      id: appliedId.current ?? crypto.randomUUID(),
      name: next.name.trim(),
      basePlanId,
      simMode: next.simMode,
      ...(next.benefitsOverridden ? { benefits: { ...next.benefits, gis: next.benefits.oas && next.benefits.gis } } : {}),
      ...(next.withdrawalStrategyOverridden ? { withdrawalStrategy: next.withdrawalStrategy } : {}),
      ...(next.simMode === "montecarlo" ? { mcConfig: {
        runs: Number(next.runs), seed: Number(next.seed),
        stdDev: { equity: Number(next.equitySd) / 100, bond: Number(next.bondSd) / 100, cash: Number(next.cashSd) / 100 },
      } } : lastApplied.current?.simMode === next.simMode && lastApplied.current.mcConfig
        ? { mcConfig: structuredClone(lastApplied.current.mcConfig) } : {}),
      ...(next.simMode === "historical" ? { historicalConfig: { startYear: Number(next.historicalStartYear) } }
        : lastApplied.current?.simMode === next.simMode && lastApplied.current.historicalConfig
          ? { historicalConfig: structuredClone(lastApplied.current.historicalConfig) } : {}),
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

      <fieldset>
        <legend>Benefits in this scenario</legend>
        {!draft.benefitsOverridden ? <p className="hint">Using the base scenario benefit choices.</p> : <button type="button" onClick={() => change({ benefits: base.benefits ?? { cpp: true, oas: true, gis: true }, benefitsOverridden: false })}>Use base benefit choices</button>}
        <label><input type="checkbox" aria-label="Scenario include CPP" checked={draft.benefits.cpp} onChange={e => change({ benefits: { ...draft.benefits, cpp: e.currentTarget.checked }, benefitsOverridden: true })} /> Include configured CPP income</label>
        {draft.benefits.cpp && !configuredIncomes.some(income => income.kind === "cpp") && <p className="hint">No CPP income stream is configured. Add one under Plan → Incomes to model CPP.</p>}
        <label><input type="checkbox" aria-label="Scenario include OAS" checked={draft.benefits.oas} onChange={e => change({ benefits: { ...draft.benefits, oas: e.currentTarget.checked, gis: e.currentTarget.checked && draft.benefits.gis }, benefitsOverridden: true })} /> Include configured OAS income</label>
        {draft.benefits.oas && !configuredIncomes.some(income => income.kind === "oas") && <p className="hint">No OAS income stream is configured. Add one under Plan → Incomes to model OAS.</p>}
        <label><input type="checkbox" aria-label="Scenario include GIS" checked={draft.benefits.gis && draft.benefits.oas} disabled={!draft.benefits.oas} onChange={e => change({ benefits: { ...draft.benefits, gis: e.currentTarget.checked }, benefitsOverridden: true })} /> Include modeled GIS</label>
        <p className="hint">CPP and OAS amounts and start/end ages come from the income streams in Plan; these switches do not create amounts. GIS requires OAS in this model; <a href="https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/guaranteed-income-supplement/eligibility.html" target="_blank" rel="noreferrer">Service Canada eligibility</a>. Starting age and other eligibility assumptions are simplified.</p>
      </fieldset>

      <div className="field">
        <label htmlFor="scenario-withdrawal-strategy">Withdrawal strategy</label>
        {!draft.withdrawalStrategyOverridden ? <span className="hint">Using the base scenario strategy.</span> : <button type="button" onClick={() => change({ withdrawalStrategy: base.withdrawalStrategy ?? "manual", withdrawalStrategyOverridden: false })}>Use base withdrawal strategy</button>}
        <select id="scenario-withdrawal-strategy" aria-label="Withdrawal strategy" value={draft.withdrawalStrategy} onChange={e => change({ withdrawalStrategy: e.currentTarget.value as WithdrawalStrategy, withdrawalStrategyOverridden: true })}>
          <option value="manual">Manual account order</option>
          <option value="tax-minimizing">Tax-minimizing planning</option>
        </select>
        {draft.withdrawalStrategy === "tax-minimizing" && <span className="hint">{TAX_MINIMIZING_STRATEGY_HELP}</span>}
      </div>

      <label>
        <span>Simulation mode</span>
        <select value={draft.simMode} onChange={(event) => change({ simMode: event.currentTarget.value as ScenarioDelta["simMode"] })} aria-label="Simulation mode">
          <option value="deterministic">Deterministic</option>
          <option value="montecarlo">Monte Carlo</option>
          <option value="historical">Historical JST U.S. proxy</option>
        </select>
        {draft.simMode === "montecarlo" && <span className="hint">Monte Carlo shows ensemble outcomes and one reproducible representative year path.</span>}
        {draft.simMode === "historical" && <span className="hint">{HISTORICAL_DATASET.name} · {HISTORICAL_DATASET.release} · {HISTORICAL_DATASET.country} nominal USD · non-Canadian proxy · no FX conversion · {HISTORICAL_DATASET.license} (noncommercial).</span>}
      </label>

      {draft.simMode === "montecarlo" && <fieldset>
        <legend>Monte Carlo settings</legend>
        <label>Runs<NumberTextInput aria-label="Monte Carlo runs" min={1} max={10000} step={1} allowNegative={false} value={draft.runs} onChange={(runs) => change({ runs })} /></label>
        <label>Seed<NumberTextInput aria-label="Monte Carlo seed" min={0} max={4294967295} step={1} allowNegative={false} value={draft.seed} onChange={(seed) => change({ seed })} /></label>
        <label>Equity standard deviation (%)<NumberTextInput aria-label="Equity standard deviation (%)" min={0} max={100} allowNegative={false} value={draft.equitySd} onChange={(equitySd) => change({ equitySd })} /></label>
        <label>Bond standard deviation (%)<NumberTextInput aria-label="Bond standard deviation (%)" min={0} max={100} allowNegative={false} value={draft.bondSd} onChange={(bondSd) => change({ bondSd })} /></label>
        <label>Cash standard deviation (%)<NumberTextInput aria-label="Cash standard deviation (%)" min={0} max={100} allowNegative={false} value={draft.cashSd} onChange={(cashSd) => change({ cashSd })} /></label>
      </fieldset>}

      {draft.simMode === "historical" && <fieldset>
        <legend>Historical return windows</legend>
        <label>Earliest source year<NumberTextInput aria-label="Historical start year" min={HISTORICAL_FIRST_YEAR} max={latestWindowStart} step={1} allowNegative={false} value={draft.historicalStartYear} onChange={(historicalStartYear) => change({ historicalStartYear })} /></label>
        <p className="hint">Runs every complete consecutive window from this source year through {latestWindowStart}. Source years map to ages; household calendar years remain based on birth year.</p>
      </fieldset>}

      <label>
        <span>Retirement age override</span>
        <NumberTextInput
          aria-label="Retirement age override"
          min={1}
          step={1}
          allowNegative={false}
          value={draft.retirementAge}
          onChange={(retirementAge) => change({ retirementAge })}
        />
        <span className="hint">Whole years only (integer ages).</span>
      </label>

      {draft.simMode !== "historical" && <fieldset>
        <legend>Return assumptions (rates, not a mix — no sum check)</legend>
        <label>
          Equity %
          <NumberTextInput
            aria-label="Equity %"
            value={draft.equity}
            onChange={(equity) => change({ equity })}
          />
        </label>
        <label>
          Bond %
          <NumberTextInput
            aria-label="Bond %"
            value={draft.bond}
            onChange={(bond) => change({ bond })}
          />
        </label>
        <label>
          Cash %
          <NumberTextInput
            aria-label="Cash %"
            value={draft.cash}
            onChange={(cash) => change({ cash })}
          />
        </label>
      </fieldset>}

      <fieldset>
        <legend>Withdrawal order (order in which accounts fund deficits)</legend>
        <p className="hint">Choose an account to swap it with the account at that priority.</p>
        {[0, 1, 2].map((index) => (
          <label key={index}>
            <span>{`${index + 1}${["st", "nd", "rd"][index]} drawn`}</span>
            <select
              aria-label={`${index + 1}${["st", "nd", "rd"][index]} drawn`}
              value={draft.order[index]}
              onChange={(e) => {
                change({ order: swapOrderPosition(draft.order, index, e.target.value as AccountType) });
              }}
            >
              {ACCOUNT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {ACCOUNT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
        ))}
        <label>
          <span>Named cash withdrawal order</span>
          <select aria-label="Cash withdrawal order" value={draft.cashPosition} onChange={e => change({ cashPosition: e.target.value as CashOrderPosition })}>
            <option value="automatic">Automatic (cash first when named cash accounts exist)</option>
            {["First", "Second", "Third", "Fourth"].map((label, index) => <option key={label} value={String(index)}>{label}</option>)}
          </select>
        </label>
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
