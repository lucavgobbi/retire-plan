import { useEffect, useRef, useState } from "react";
import { HISTORICAL_DATASET } from "@retire-plan/engine";
import { useWorkspace, type AccountType, type Scenario } from "../store/api";
import type { BenefitSettings, WithdrawalStrategy } from "../domain/types";
import { NumberTextInput } from "./NumberTextInput";
import { TAX_MINIMIZING_STRATEGY_HELP } from "../content/assumptions";
import { ACCOUNT_TYPE_LABELS, cashOrderPosition, INVESTMENT_ACCOUNT_TYPES, investmentOrder, orderWithCashPosition, swapOrderPosition, type CashOrderPosition } from "../domain/accountOrder";

function percentInput(rate: number): string { return String(Math.round(rate * 1e12) / 1e10); }

type SettingsDraft = { simMode: Scenario["simMode"]; runs: string; seed: string; equitySd: string; bondSd: string; cashSd: string; historicalStartYear: string; retirementAge: string; equity: string; bond: string; cash: string; order: AccountType[]; cashPosition: CashOrderPosition; benefits: BenefitSettings; withdrawalStrategy: WithdrawalStrategy };
type SettingsItem = { simMode?: Scenario["simMode"]; mcConfig?: Scenario["mcConfig"]; historicalConfig?: Scenario["historicalConfig"]; retirementAge: number; returnAssumptions: { equity: number; bond: number; cash: number }; withdrawalOrder: AccountType[]; benefits?: BenefitSettings; withdrawalStrategy?: WithdrawalStrategy };
const HISTORICAL_FIRST_YEAR = HISTORICAL_DATASET.coverageStart;
const HISTORICAL_LAST_YEAR = HISTORICAL_DATASET.coverageEnd;

function settingsDraftOf(base: NonNullable<ReturnType<typeof useWorkspace>["baseScenario"]>): SettingsDraft {
  return {
    simMode: base.simMode ?? "deterministic",
    runs: String(base.mcConfig?.runs ?? 1_000),
    seed: String(base.mcConfig?.seed ?? 12_345),
    equitySd: String((base.mcConfig?.stdDev.equity ?? 0.18) * 100),
    bondSd: String((base.mcConfig?.stdDev.bond ?? 0.07) * 100),
    cashSd: String((base.mcConfig?.stdDev.cash ?? 0.02) * 100),
    historicalStartYear: String(base.historicalConfig?.startYear ?? HISTORICAL_FIRST_YEAR),
    retirementAge: String(base.retirementAge),
    equity: percentInput(base.returnAssumptions.equity),
    bond: percentInput(base.returnAssumptions.bond),
    cash: percentInput(base.returnAssumptions.cash),
    order: investmentOrder(base.withdrawalOrder),
    cashPosition: cashOrderPosition(base.withdrawalOrder),
    benefits: base.benefits ?? { cpp: true, oas: true, gis: true },
    withdrawalStrategy: base.withdrawalStrategy ?? "manual",
  };
}

/**
 * Parse a draft into applied settings. Untouched rate inputs (their text equals
 * the stored rate's display) preserve the exact stored precision instead of
 * round-tripping through a number.
 */
function readSettingsDraft(draft: SettingsDraft, stored: SettingsItem, latestWindowStart: number): { errors: string[]; item: SettingsItem } {
  const errors: string[] = [];
  const retirementAge = Number(draft.retirementAge);
  if (!Number.isInteger(retirementAge) || retirementAge <= 0) errors.push("Use a positive whole retirement age.");
  const returnAssumptions = { ...stored.returnAssumptions };
  for (const key of ["equity", "bond", "cash"] as const) {
    const rate = Number(draft[key]);
    if (!Number.isFinite(rate)) errors.push(`Base ${key} return (%) must be a number.`);
    else returnAssumptions[key] = draft[key] === percentInput(stored.returnAssumptions[key]) ? stored.returnAssumptions[key] : rate / 100;
  }
  if (draft.order.length !== 3 || new Set(draft.order).size !== 3 || !INVESTMENT_ACCOUNT_TYPES.every(type => draft.order.includes(type))) errors.push("Choose each investment withdrawal account exactly once.");
  let mcConfig: Scenario["mcConfig"];
  if (draft.simMode === "montecarlo") {
    const runs = Number(draft.runs); const seed = Number(draft.seed);
    if (!Number.isInteger(runs) || runs < 1 || runs > 10_000) errors.push("Monte Carlo runs must be a whole number from 1 to 10,000.");
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) errors.push("Monte Carlo seed must be an unsigned 32-bit whole number.");
    const standardDeviations = [draft.equitySd, draft.bondSd, draft.cashSd].map(Number);
    if (standardDeviations.some(value => !Number.isFinite(value) || value < 0 || value > 100)) errors.push("Monte Carlo standard deviations must be from 0% to 100%.");
    mcConfig = { runs, seed, stdDev: { equity: standardDeviations[0]! / 100, bond: standardDeviations[1]! / 100, cash: standardDeviations[2]! / 100 } };
  }
  let historicalConfig: Scenario["historicalConfig"];
  if (draft.simMode === "historical") {
    const startYear = Number(draft.historicalStartYear);
    if (!Number.isInteger(startYear) || startYear < HISTORICAL_FIRST_YEAR || startYear > latestWindowStart) {
      errors.push(`Historical start year must be from ${HISTORICAL_FIRST_YEAR} through ${latestWindowStart}, the latest full window for this plan.`);
    } else historicalConfig = { startYear };
  }
  return { errors, item: { simMode: draft.simMode, ...(mcConfig ? { mcConfig } : {}), ...(historicalConfig ? { historicalConfig } : {}), retirementAge, returnAssumptions, withdrawalOrder: orderWithCashPosition(draft.order, draft.cashPosition), benefits: { ...draft.benefits, gis: draft.benefits.oas && draft.benefits.gis }, withdrawalStrategy: draft.withdrawalStrategy } };
}

/**
 * Base projection settings, saved on edit like the plan editors: each valid
 * change dispatches immediately; invalid drafts stay local with an error.
 */
export function BaseScenarioSettings() {
  const { baseScenario, setBaseScenario, workspace } = useWorkspace();
  const latestWindowStart = HISTORICAL_LAST_YEAR - (workspace.plan.profile.endAge - workspace.plan.profile.currentAge);
  const stored = baseScenario ?? {
    simMode: "deterministic" as const, retirementAge: 0, returnAssumptions: { equity: NaN, bond: NaN, cash: NaN }, withdrawalOrder: ["tfsa", "nonreg", "rrsp"] as AccountType[],
  };
  const [draft, setDraft] = useState<SettingsDraft>(() => settingsDraftOf(stored));
  const lastApplied = useRef<SettingsDraft>(settingsDraftOf(stored));
  useEffect(() => {
    const current = settingsDraftOf(stored);
    if (JSON.stringify(current) !== JSON.stringify(lastApplied.current)) {
      lastApplied.current = current;
      setDraft(current);
    }
  }, [stored]);
  /** Normalized draft for comparing against the last applied value, like the plan editors. */
  const normalized = (item: SettingsItem): SettingsDraft => ({
    simMode: item.simMode ?? "deterministic",
    runs: String(item.mcConfig?.runs ?? 1_000), seed: String(item.mcConfig?.seed ?? 12_345),
    equitySd: String((item.mcConfig?.stdDev.equity ?? 0.18) * 100),
    bondSd: String((item.mcConfig?.stdDev.bond ?? 0.07) * 100),
    cashSd: String((item.mcConfig?.stdDev.cash ?? 0.02) * 100),
    historicalStartYear: String(item.historicalConfig?.startYear ?? HISTORICAL_FIRST_YEAR),
    retirementAge: String(item.retirementAge),
    equity: percentInput(item.returnAssumptions.equity),
    bond: percentInput(item.returnAssumptions.bond),
    cash: percentInput(item.returnAssumptions.cash),
    order: investmentOrder(item.withdrawalOrder),
    cashPosition: cashOrderPosition(item.withdrawalOrder),
    benefits: item.benefits ?? { cpp: true, oas: true, gis: true },
    withdrawalStrategy: item.withdrawalStrategy ?? "manual",
  });
  const change = (patch: Partial<SettingsDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    const { errors, item } = readSettingsDraft(next, stored, latestWindowStart);
    if (errors.length > 0) return;
    if (JSON.stringify(normalized(item)) !== JSON.stringify(lastApplied.current)) {
      lastApplied.current = normalized(item);
      setBaseScenario(item);
    }
  };
  const { errors } = readSettingsDraft(draft, stored, latestWindowStart);

  return <section className="panel" aria-label="Base projection settings">
    <h2>Base projection settings</h2>
    <p className="muted">Saved with this workspace on every edit. Scenarios inherit these settings unless they override them.</p>
    <div className="form-grid">
      <label className="field">Base simulation mode<select aria-label="Base simulation mode" value={draft.simMode} onChange={event => change({ simMode: event.currentTarget.value as Scenario["simMode"] })}><option value="deterministic">Deterministic</option><option value="montecarlo">Monte Carlo</option><option value="historical">Historical JST U.S. proxy</option></select></label>
      <fieldset className="field">
        <legend>Benefits in this projection</legend>
        <label><input type="checkbox" aria-label="Base include CPP" checked={draft.benefits.cpp} onChange={e => change({ benefits: { ...draft.benefits, cpp: e.currentTarget.checked } })} /> Include configured CPP income</label>
        {draft.benefits.cpp && !workspace.plan.incomes.some(income => income.kind === "cpp") && <p className="hint">No CPP income stream is configured. Add one under Plan → Incomes to model CPP.</p>}
        <label><input type="checkbox" aria-label="Base include OAS" checked={draft.benefits.oas} onChange={e => change({ benefits: { ...draft.benefits, oas: e.currentTarget.checked, gis: e.currentTarget.checked && draft.benefits.gis } })} /> Include configured OAS income</label>
        {draft.benefits.oas && !workspace.plan.incomes.some(income => income.kind === "oas") && <p className="hint">No OAS income stream is configured. Add one under Plan → Incomes to model OAS.</p>}
        <label><input type="checkbox" aria-label="Base include GIS" checked={draft.benefits.gis && draft.benefits.oas} disabled={!draft.benefits.oas} onChange={e => change({ benefits: { ...draft.benefits, gis: e.currentTarget.checked } })} /> Include modeled GIS</label>
        <p className="hint">CPP and OAS amounts and start/end ages come from the income streams in Plan. No benefit amount is created by these switches. GIS requires OAS in this model; <a href="https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/guaranteed-income-supplement/eligibility.html" target="_blank" rel="noreferrer">Service Canada eligibility</a>.</p>
      </fieldset>
      <label className="field">Base retirement age<NumberTextInput name="retirementAge" step="1" min="1" allowNegative={false} required value={draft.retirementAge} onChange={retirementAge => change({ retirementAge })} /></label>
      {draft.simMode !== "historical" && (["equity", "bond", "cash"] as const).map(key => <label className="field" key={key}>Base {key === "bond" ? "bonds" : key} return (%)<NumberTextInput name={key} step="any" required value={draft[key]} onChange={value => change({ [key]: value })} /></label>)}
      <label className="field">Withdrawal strategy<select aria-label="Base withdrawal strategy" value={draft.withdrawalStrategy} onChange={e => change({ withdrawalStrategy: e.currentTarget.value as WithdrawalStrategy })}><option value="manual">Manual account order</option><option value="tax-minimizing">Tax-minimizing planning</option></select>
        {draft.withdrawalStrategy === "tax-minimizing" && <span className="hint">{TAX_MINIMIZING_STRATEGY_HELP}</span>}
      </label>
      {draft.withdrawalStrategy === "manual" && <>
        <p className="hint">Choose an account to swap it with the account at that priority.</p>
        {draft.order.map((type, index) => <label className="field" key={index}>Base withdrawal priority {index + 1}<select name={`order${index}`} value={type} aria-label={`Base withdrawal priority ${index + 1}`} onChange={event => {
          change({ order: swapOrderPosition(draft.order, index, event.currentTarget.value as AccountType) });
        }}>{INVESTMENT_ACCOUNT_TYPES.map(account => <option key={account} value={account}>{ACCOUNT_TYPE_LABELS[account]}</option>)}</select></label>)}
        <label className="field">Named cash withdrawal order<select aria-label="Base cash withdrawal order" value={draft.cashPosition} onChange={event => change({ cashPosition: event.currentTarget.value as CashOrderPosition })}>
          <option value="automatic">Automatic (cash first when named cash accounts exist)</option>
          {["First", "Second", "Third", "Fourth"].map((label, index) => <option key={label} value={String(index)}>{label}</option>)}
        </select></label>
      </>}
      {draft.withdrawalStrategy === "tax-minimizing" && <p className="hint">Your saved order is retained as the optimizer fallback.</p>}
      {draft.simMode === "montecarlo" && <>
        <label className="field">Monte Carlo runs<NumberTextInput aria-label="Base Monte Carlo runs" min={1} max={10_000} step={1} allowNegative={false} value={draft.runs} onChange={runs => change({ runs })} /></label>
        <label className="field">Monte Carlo seed<NumberTextInput aria-label="Base Monte Carlo seed" min={0} max={4_294_967_295} step={1} allowNegative={false} value={draft.seed} onChange={seed => change({ seed })} /></label>
        <label className="field">Equity standard deviation (%)<NumberTextInput min={0} max={100} allowNegative={false} value={draft.equitySd} onChange={equitySd => change({ equitySd })} /></label>
        <label className="field">Bond standard deviation (%)<NumberTextInput min={0} max={100} allowNegative={false} value={draft.bondSd} onChange={bondSd => change({ bondSd })} /></label>
        <label className="field">Cash standard deviation (%)<NumberTextInput min={0} max={100} allowNegative={false} value={draft.cashSd} onChange={cashSd => change({ cashSd })} /></label>
      </>}
      {draft.simMode === "historical" && <>
        <label className="field">Earliest historical return year<NumberTextInput aria-label="Base historical start year" min={HISTORICAL_FIRST_YEAR} max={latestWindowStart} step={1} allowNegative={false} value={draft.historicalStartYear} onChange={historicalStartYear => change({ historicalStartYear })} /></label>
        <p className="hint">Uses complete rolling windows starting in this source year through {latestWindowStart}. Source years map to your ages; household calendar years still use birth year.</p>
        <p className="hint">{HISTORICAL_DATASET.country} annual nominal USD returns · non-Canadian proxy · no FX conversion · {HISTORICAL_DATASET.license} (noncommercial).</p>
      </>}
    </div>
    {errors.length > 0 && <div role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>}
  </section>;
}
