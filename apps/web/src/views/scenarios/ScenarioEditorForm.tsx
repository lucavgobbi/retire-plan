import { useEffect, useMemo, useRef, useState } from "react";
import { HISTORICAL_DATASET, type AccountType } from "@retire-plan/engine";
import { useWorkspace } from "../../store/api";
import type { BenefitSettings, PayrollSettings, ScenarioBase, ScenarioDelta, WithdrawalStrategy } from "../../domain/types";
import { NumberTextInput } from "../../components/NumberTextInput";
import { FormSection } from "../../components/FormSection";
import { PayrollOptions } from "../../components/PayrollOptions";
import { InlineEditorPanel } from "../../components/InlineEditorPanel";
import { TAX_MINIMIZING_STRATEGY_HELP } from "../../content/assumptions";
import { fmtPercentInput } from "../projection/fmt";
import { ACCOUNT_TYPE_LABELS, cashOrderPosition, INVESTMENT_ACCOUNT_TYPES, investmentOrder, orderWithCashPosition, swapOrderPosition, type CashOrderPosition } from "../../domain/accountOrder";

const ACCOUNT_TYPES: AccountType[] = [...INVESTMENT_ACCOUNT_TYPES];
const HISTORICAL_FIRST_YEAR = HISTORICAL_DATASET.coverageStart;
const HISTORICAL_LAST_YEAR = HISTORICAL_DATASET.coverageEnd;

type Overrides = NonNullable<ScenarioDelta["overrides"]>;
type EditorDraft = {
  name: string;
  simMode: ScenarioDelta["simMode"];
  retirementAge: string;
  /** False = follow the base age; true = the delta carries an explicit retirement age. */
  retirementAgeOverridden: boolean;
  equity: string;
  bond: string;
  cash: string;
  returnAssumptionsOverridden: boolean;
  order: AccountType[];
  withdrawalOrderOverridden: boolean;
  runs: string;
  seed: string;
  equitySd: string;
  bondSd: string;
  cashSd: string;
  historicalStartYear: string;
  cashPosition: CashOrderPosition;
  benefits: BenefitSettings;
  benefitsOverridden: boolean;
  payroll: PayrollSettings;
  payrollOverridden: boolean;
  withdrawalStrategy: WithdrawalStrategy;
  withdrawalStrategyOverridden: boolean;
};
/** Fully populated overrides; `Overrides` may leave returnAssumptions/withdrawalOrder unset. */
type FullOverrides = {
  retirementAge: number;
  returnAssumptions: { equity: number; bond: number; cash: number };
  withdrawalOrder: AccountType[];
};

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
      retirementAgeOverridden: false,
      equity: fmtPercentInput(base.returnAssumptions.equity),
      bond: fmtPercentInput(base.returnAssumptions.bond),
      cash: fmtPercentInput(base.returnAssumptions.cash),
      returnAssumptionsOverridden: false,
      order: investmentOrder(base.withdrawalOrder),
      withdrawalOrderOverridden: false,
      runs: "1000", seed: "12345", equitySd: "18", bondSd: "7", cashSd: "2", historicalStartYear: String(base.historicalConfig?.startYear ?? HISTORICAL_FIRST_YEAR),
      cashPosition: cashOrderPosition(base.withdrawalOrder),
      benefits: base.benefits ?? { cpp: true, oas: true, gis: true },
      benefitsOverridden: false,
      payroll: base.payroll ?? { cpp: false, ei: false, cppOptOut65to69: false },
      payrollOverridden: false,
      withdrawalStrategy: base.withdrawalStrategy ?? "manual",
      withdrawalStrategyOverridden: false,
    };
  }
  const overrides = effectiveOverrides(storedDelta, base);
  return {
    name: storedDelta.name,
    simMode: storedDelta.simMode ?? "deterministic",
    retirementAge: String(overrides.retirementAge),
    // Explicit means the key exists, even when the value happens to equal the
    // base: equality is not evidence of inheritance.
    retirementAgeOverridden: storedDelta.overrides.retirementAge !== undefined,
    equity: fmtPercentInput(overrides.returnAssumptions.equity),
    bond: fmtPercentInput(overrides.returnAssumptions.bond),
    cash: fmtPercentInput(overrides.returnAssumptions.cash),
    // Track each override key independently: an absent key inherits and must stay
    // absent through unrelated edits, even when its current value was displayed.
    returnAssumptionsOverridden: storedDelta.overrides.returnAssumptions !== undefined,
    order: overrides.withdrawalOrder,
    withdrawalOrderOverridden: storedDelta.overrides.withdrawalOrder !== undefined,
    runs: String(storedDelta.mcConfig?.runs ?? 1000), seed: String(storedDelta.mcConfig?.seed ?? 12345),
    equitySd: String((storedDelta.mcConfig?.stdDev.equity ?? 0.18) * 100),
    bondSd: String((storedDelta.mcConfig?.stdDev.bond ?? 0.07) * 100),
    cashSd: String((storedDelta.mcConfig?.stdDev.cash ?? 0.02) * 100),
    historicalStartYear: String(storedDelta.historicalConfig?.startYear ?? base.historicalConfig?.startYear ?? HISTORICAL_FIRST_YEAR),
    cashPosition: cashOrderPosition(storedDelta.overrides.withdrawalOrder ?? base.withdrawalOrder),
    benefits: storedDelta.benefits ?? base.benefits ?? { cpp: true, oas: true, gis: true },
    benefitsOverridden: storedDelta.benefits !== undefined,
    payroll: storedDelta.payroll ?? base.payroll ?? { cpp: false, ei: false, cppOptOut65to69: false },
    payrollOverridden: storedDelta.payroll !== undefined,
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
  const returnSettingsRef = useRef<HTMLDetailsElement>(null);
  const withdrawalSettingsRef = useRef<HTMLDetailsElement>(null);
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

  // Effective strategy follows override > base > legacy manual. The select's
  // "Base scenario strategy" option keeps the scenario following later base
  // changes (no strategy written to the delta); an explicit choice overrides.
  const effectiveStrategy = draft.withdrawalStrategyOverridden ? draft.withdrawalStrategy : (base.withdrawalStrategy ?? "manual");

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
  const returnSettingsInvalid = errors.some(error => error.startsWith("Return assumption (capital "));
  const withdrawalSettingsInvalid = errors.some(error => error.includes("investment withdrawal account"));

  useEffect(() => {
    // Invalid advanced fields remain visible until corrected. Other edits and
    // store autosaves leave the browser's native disclosure state untouched.
    if (returnSettingsInvalid && returnSettingsRef.current) returnSettingsRef.current.open = true;
    if (withdrawalSettingsInvalid && withdrawalSettingsRef.current) withdrawalSettingsRef.current.open = true;
  }, [returnSettingsInvalid, withdrawalSettingsInvalid]);

  const keepInvalidSectionOpen = (ref: React.RefObject<HTMLDetailsElement | null>, invalid: boolean) => {
    if (invalid && ref.current && !ref.current.open) ref.current.open = true;
  };

  const change = (patch: Partial<EditorDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (validate(next).length > 0) return;
    // Untouched rate inputs (their text equals the stored rate's display) keep the
    // exact stored precision instead of round-tripping through a number.
    const source = effectiveOverrides(lastApplied.current, base);
    const overrides: Overrides = {
      // Each override key is independent. Edits to one area (or a reset of the
      // age) must not snapshot values that the delta was inheriting.
      ...(next.retirementAgeOverridden ? { retirementAge: Number(next.retirementAge) } : {}),
      ...(next.returnAssumptionsOverridden ? { returnAssumptions: {
        equity: next.equity === fmtPercentInput(source.returnAssumptions.equity) ? source.returnAssumptions.equity : Number(next.equity) / 100,
        bond: next.bond === fmtPercentInput(source.returnAssumptions.bond) ? source.returnAssumptions.bond : Number(next.bond) / 100,
        cash: next.cash === fmtPercentInput(source.returnAssumptions.cash) ? source.returnAssumptions.cash : Number(next.cash) / 100,
      } } : {}),
      ...(next.withdrawalOrderOverridden ? { withdrawalOrder: orderWithCashPosition(next.order, next.cashPosition) } : {}),
    };
    const nextDelta: ScenarioDelta = {
      id: appliedId.current ?? crypto.randomUUID(),
      name: next.name.trim(),
      basePlanId,
      simMode: next.simMode,
      ...(next.benefitsOverridden ? { benefits: { ...next.benefits, gis: next.benefits.oas && next.benefits.gis } } : {}),
      ...(next.payrollOverridden ? { payroll: { ...next.payroll } } : {}),
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
    <InlineEditorPanel title={delta ? "Edit scenario" : "New scenario"} className="scenario-editor" onClose={onDone}>
      <FormSection title="Basics" description="Name the scenario and set its retirement age.">
        <div className="form-section-grid">
          <label className="form-field">Scenario name<input aria-label="Name" type="text" value={draft.name} onChange={(e) => change({ name: e.target.value })} /></label>
          <label className="form-field">Retirement age override<NumberTextInput aria-label="Retirement age override" min={1} step={1} allowNegative={false} value={draft.retirementAge} onChange={(retirementAge) => change({ retirementAge, retirementAgeOverridden: true })} /><span className="form-section-note">This value is used for this scenario. Salary set to “Until retirement” ends the year before this age; income and saving rules otherwise follow their own settings.</span></label>
          <div className="form-section-status" aria-live="polite">{draft.retirementAgeOverridden ? "Using a retirement age for this scenario." : "Following the base retirement age."}</div>
          {draft.retirementAgeOverridden && <button className="form-section-reset" type="button" onClick={() => change({ retirementAge: String(base.retirementAge), retirementAgeOverridden: false })}>Use base retirement age</button>}
        </div>
      </FormSection>

      <FormSection title="Benefits" description="Choose whether configured benefit income is included in this scenario.">
        <div className="form-section-status" aria-live="polite">{!draft.benefitsOverridden ? "Using the base scenario benefit choices." : "Using benefit choices for this scenario."}</div>
        {draft.benefitsOverridden && <button className="form-section-reset" type="button" onClick={() => change({ benefits: base.benefits ?? { cpp: true, oas: true, gis: true }, benefitsOverridden: false })}>Use base benefit choices</button>}
        <div className="form-section-option-grid" role="group" aria-label="Benefits in this scenario">
          <label className="form-section-option"><input type="checkbox" aria-label="Scenario include CPP" checked={draft.benefits.cpp} onChange={e => change({ benefits: { ...draft.benefits, cpp: e.currentTarget.checked }, benefitsOverridden: true })} /><span><span className="form-section-option-title">CPP</span><span className="form-section-option-note">Include configured CPP income</span></span></label>
          <label className="form-section-option"><input type="checkbox" aria-label="Scenario include OAS" checked={draft.benefits.oas} onChange={e => change({ benefits: { ...draft.benefits, oas: e.currentTarget.checked, gis: e.currentTarget.checked && draft.benefits.gis }, benefitsOverridden: true })} /><span><span className="form-section-option-title">OAS</span><span className="form-section-option-note">Include configured OAS income</span></span></label>
          <label className="form-section-option"><input type="checkbox" aria-label="Scenario include GIS" checked={draft.benefits.gis && draft.benefits.oas} disabled={!draft.benefits.oas} onChange={e => change({ benefits: { ...draft.benefits, gis: e.currentTarget.checked }, benefitsOverridden: true })} /><span><span className="form-section-option-title">GIS</span><span className="form-section-option-note">Include modeled GIS; requires OAS in this model</span></span></label>
        </div>
        {draft.benefits.cpp && !configuredIncomes.some(income => income.kind === "cpp") && <p className="form-section-note">No CPP income stream is configured. Add one under Plan → Incomes to model CPP.</p>}
        {draft.benefits.oas && !configuredIncomes.some(income => income.kind === "oas") && <p className="form-section-note">No OAS income stream is configured. Add one under Plan → Incomes to model OAS.</p>}
        <p className="form-section-note">CPP and OAS amounts and start/end ages come from Plan income streams; these switches do not create amounts. GIS requires OAS in this model; <a href="https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/guaranteed-income-supplement/eligibility.html" target="_blank" rel="noreferrer">Service Canada eligibility</a>. Starting age and other eligibility assumptions are simplified.</p>
      </FormSection>

      <FormSection title="Payroll" description="Choose whether employee payroll deductions are withheld from employment income in this scenario.">
        <div className="form-section-status" aria-live="polite">{!draft.payrollOverridden ? "Using the base scenario payroll choices." : "Using payroll choices for this scenario."}</div>
        {draft.payrollOverridden && <button className="form-section-reset" type="button" onClick={() => change({ payroll: base.payroll ?? { cpp: false, ei: false, cppOptOut65to69: false }, payrollOverridden: false })}>Use base payroll settings</button>}
        <PayrollOptions ariaPrefix="Scenario" payroll={draft.payroll} onChange={payroll => change({ payroll: { ...draft.payroll, ...payroll }, payrollOverridden: true })} hasEmploymentIncome={configuredIncomes.some(income => income.kind === "employment")} />
        {draft.payroll.cpp === false && draft.payroll.ei === false && <p className="form-section-note">Payroll is off — the legacy default: no employee CPP or EI amounts are withheld.</p>}
      </FormSection>

      <FormSection title="Simulation" description="Choose how this scenario generates investment returns.">
        <div className="form-section-grid">
          <label className="form-field form-section-wide">Simulation mode<select value={draft.simMode} onChange={(event) => change({ simMode: event.currentTarget.value as ScenarioDelta["simMode"] })} aria-label="Simulation mode"><option value="deterministic">Deterministic</option><option value="montecarlo">Monte Carlo</option><option value="historical">Historical JST U.S. proxy</option></select></label>
          {draft.simMode === "montecarlo" && <>
            <label className="form-field">Monte Carlo runs<NumberTextInput aria-label="Monte Carlo runs" min={1} max={10000} step={1} allowNegative={false} value={draft.runs} onChange={(runs) => change({ runs })} /></label>
            <label className="form-field">Monte Carlo seed<NumberTextInput aria-label="Monte Carlo seed" min={0} max={4294967295} step={1} allowNegative={false} value={draft.seed} onChange={(seed) => change({ seed })} /></label>
            <label className="form-field">Equity standard deviation (%)<NumberTextInput aria-label="Equity standard deviation (%)" min={0} max={100} allowNegative={false} value={draft.equitySd} onChange={(equitySd) => change({ equitySd })} /></label>
            <label className="form-field">Bond standard deviation (%)<NumberTextInput aria-label="Bond standard deviation (%)" min={0} max={100} allowNegative={false} value={draft.bondSd} onChange={(bondSd) => change({ bondSd })} /></label>
            <label className="form-field">Cash standard deviation (%)<NumberTextInput aria-label="Cash standard deviation (%)" min={0} max={100} allowNegative={false} value={draft.cashSd} onChange={(cashSd) => change({ cashSd })} /></label>
            <p className="form-section-note form-section-wide">Monte Carlo shows ensemble outcomes and one reproducible representative year path.</p>
          </>}
          {draft.simMode === "historical" && <>
            <label className="form-field form-section-wide">Earliest historical source year<NumberTextInput aria-label="Historical start year" min={HISTORICAL_FIRST_YEAR} max={latestWindowStart} step={1} allowNegative={false} value={draft.historicalStartYear} onChange={(historicalStartYear) => change({ historicalStartYear })} /></label>
            <p className="form-section-note form-section-wide">Runs every complete consecutive window from this source year through {latestWindowStart}. Source years map to ages; household calendar years remain based on birth year.</p>
            <p className="form-section-note form-section-wide">{HISTORICAL_DATASET.name} · {HISTORICAL_DATASET.release} · {HISTORICAL_DATASET.country} nominal USD · non-Canadian proxy · no FX conversion · {HISTORICAL_DATASET.license} (noncommercial).</p>
          </>}
        </div>
        {draft.simMode !== "historical" && <FormSection
          title="Return assumptions"
          description="Annual equity, bond and cash return rates. These are separate rates, not portfolio percentages."
          className="form-section-nested scenario-return-section"
          collapsible
          detailsRef={returnSettingsRef}
          onToggle={() => keepInvalidSectionOpen(returnSettingsRef, returnSettingsInvalid)}
        >
          <div className="form-section-grid">
            <label className="form-field">Equity %<NumberTextInput aria-label="Equity %" value={draft.equity} onChange={(equity) => change({ equity, returnAssumptionsOverridden: true })} /></label>
            <label className="form-field">Bond %<NumberTextInput aria-label="Bond %" value={draft.bond} onChange={(bond) => change({ bond, returnAssumptionsOverridden: true })} /></label>
            <label className="form-field">Cash %<NumberTextInput aria-label="Cash %" value={draft.cash} onChange={(cash) => change({ cash, returnAssumptionsOverridden: true })} /></label>
          </div>
        </FormSection>}
      </FormSection>

      <FormSection title="Withdrawals" description="Choose the scenario strategy. Manual account order is an additional setting.">
        <div className="form-section-grid">
          <label className="form-field form-section-wide">Withdrawal strategy<select aria-label="Withdrawal strategy" value={draft.withdrawalStrategyOverridden ? draft.withdrawalStrategy : "inherit"} onChange={(e) => {
            const value = e.target.value;
            if (value === "inherit") change({ withdrawalStrategy: base.withdrawalStrategy ?? "manual", withdrawalStrategyOverridden: false });
            else change({ withdrawalStrategy: value as WithdrawalStrategy, withdrawalStrategyOverridden: true });
          }}><option value="inherit">Use base strategy</option><option value="manual">Manual account order</option><option value="tax-minimizing">Tax-minimizing planning</option></select></label>
          {!draft.withdrawalStrategyOverridden && <p className="form-section-note form-section-wide">Following the base scenario strategy.</p>}
          {effectiveStrategy === "tax-minimizing" && <p className="form-section-note form-section-wide">{TAX_MINIMIZING_STRATEGY_HELP}</p>}
          {effectiveStrategy === "tax-minimizing" && <p className="form-section-note form-section-wide">Your saved account order is retained as the optimizer fallback.</p>}
          {effectiveStrategy === "manual" && <FormSection
            title="Account withdrawal order"
            description="Choose which accounts fund a deficit first. Changing one priority swaps the two positions."
            className="form-section-nested form-section-wide"
            collapsible
            detailsRef={withdrawalSettingsRef}
            onToggle={() => keepInvalidSectionOpen(withdrawalSettingsRef, withdrawalSettingsInvalid)}
          >
            <div className="form-section-grid">
              {[0, 1, 2].map((index) => <label className="form-field" key={index}><span>{`${index + 1}${["st", "nd", "rd"][index]} drawn`}</span><select aria-label={`${index + 1}${["st", "nd", "rd"][index]} drawn`} value={draft.order[index]} onChange={(e) => change({ order: swapOrderPosition(draft.order, index, e.target.value as AccountType), withdrawalOrderOverridden: true })}>{ACCOUNT_TYPES.map((type) => <option key={type} value={type}>{ACCOUNT_TYPE_LABELS[type]}</option>)}</select></label>)}
              <label className="form-field form-section-wide">Named cash withdrawal order<select aria-label="Cash withdrawal order" value={draft.cashPosition} onChange={e => change({ cashPosition: e.target.value as CashOrderPosition, withdrawalOrderOverridden: true })}><option value="automatic">Automatic (cash first when named cash accounts exist)</option>{["First", "Second", "Third", "Fourth"].map((label, index) => <option key={label} value={String(index)}>{label}</option>)}</select></label>
            </div>
          </FormSection>}
        </div>
      </FormSection>

      {errors.length > 0 && (
        <div role="status" className="form-errors">
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}

    </InlineEditorPanel>
  );
}
