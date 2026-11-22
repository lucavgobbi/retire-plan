import { useEffect, useRef, useState } from "react";
import { HISTORICAL_DATASET } from "@retire-plan/engine";
import { useWorkspace, type AccountType, type Scenario } from "../store/api";
import type { BenefitSettings, PayrollSettings, WithdrawalStrategy } from "../domain/types";
import { NumberTextInput } from "./NumberTextInput";
import { FormSection } from "./FormSection";
import { PayrollOptions } from "./PayrollOptions";
import { TAX_MINIMIZING_STRATEGY_HELP } from "../content/assumptions";
import {
  ACCOUNT_TYPE_LABELS,
  cashOrderPosition,
  INVESTMENT_ACCOUNT_TYPES,
  investmentOrder,
  orderWithCashPosition,
  swapOrderPosition,
  type CashOrderPosition,
} from "../domain/accountOrder";
import "./baseScenarioSettings.css";

function percentInput(rate: number): string {
  return String(Math.round(rate * 1e12) / 1e10);
}

type SettingsDraft = {
  simMode: Scenario["simMode"];
  runs: string;
  seed: string;
  equitySd: string;
  bondSd: string;
  cashSd: string;
  historicalStartYear: string;
  retirementAge: string;
  equity: string;
  bond: string;
  cash: string;
  order: AccountType[];
  cashPosition: CashOrderPosition;
  benefits: BenefitSettings;
  payroll: PayrollSettings;
  withdrawalStrategy: WithdrawalStrategy;
};
type SettingsItem = {
  simMode?: Scenario["simMode"];
  mcConfig?: Scenario["mcConfig"];
  historicalConfig?: Scenario["historicalConfig"];
  retirementAge: number;
  returnAssumptions: { equity: number; bond: number; cash: number };
  withdrawalOrder: AccountType[];
  benefits?: BenefitSettings;
  payroll?: PayrollSettings;
  withdrawalStrategy?: WithdrawalStrategy;
};
const HISTORICAL_FIRST_YEAR = HISTORICAL_DATASET.coverageStart;
const HISTORICAL_LAST_YEAR = HISTORICAL_DATASET.coverageEnd;
const EMPTY_BASE_SETTINGS: SettingsItem = {
  simMode: "deterministic",
  retirementAge: 0,
  returnAssumptions: { equity: NaN, bond: NaN, cash: NaN },
  withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
};

function settingsDraftOf(base: SettingsItem): SettingsDraft {
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
    payroll: base.payroll ?? { cpp: false, ei: false, cppOptOut65to69: false },
    withdrawalStrategy: base.withdrawalStrategy ?? "manual",
  };
}

/**
 * Parse a draft into applied settings. Untouched rate inputs (their text equals
 * the stored rate's display) preserve the exact stored precision instead of
 * round-tripping through a number.
 */
function readSettingsDraft(
  draft: SettingsDraft,
  stored: SettingsItem,
  latestWindowStart: number,
): { errors: string[]; item: SettingsItem } {
  const errors: string[] = [];
  const retirementAge = Number(draft.retirementAge);
  if (!Number.isInteger(retirementAge) || retirementAge <= 0) errors.push("Use a positive whole retirement age.");
  const returnAssumptions = { ...stored.returnAssumptions };
  for (const key of ["equity", "bond", "cash"] as const) {
    const rate = Number(draft[key]);
    if (!Number.isFinite(rate)) errors.push(`Base ${key} return (%) must be a number.`);
    else
      returnAssumptions[key] =
        draft[key] === percentInput(stored.returnAssumptions[key]) ? stored.returnAssumptions[key] : rate / 100;
  }
  if (
    draft.order.length !== 3 ||
    new Set(draft.order).size !== 3 ||
    !INVESTMENT_ACCOUNT_TYPES.every((type) => draft.order.includes(type))
  )
    errors.push("Choose each investment withdrawal account exactly once.");
  let mcConfig: Scenario["mcConfig"];
  if (draft.simMode === "montecarlo") {
    const runs = Number(draft.runs);
    const seed = Number(draft.seed);
    if (!Number.isInteger(runs) || runs < 1 || runs > 10_000)
      errors.push("Monte Carlo runs must be a whole number from 1 to 10,000.");
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff)
      errors.push("Monte Carlo seed must be an unsigned 32-bit whole number.");
    const standardDeviations = [draft.equitySd, draft.bondSd, draft.cashSd].map(Number);
    if (standardDeviations.some((value) => !Number.isFinite(value) || value < 0 || value > 100))
      errors.push("Monte Carlo standard deviations must be from 0% to 100%.");
    mcConfig = {
      runs,
      seed,
      stdDev: {
        equity: standardDeviations[0]! / 100,
        bond: standardDeviations[1]! / 100,
        cash: standardDeviations[2]! / 100,
      },
    };
  }
  let historicalConfig: Scenario["historicalConfig"];
  if (draft.simMode === "historical") {
    const startYear = Number(draft.historicalStartYear);
    if (!Number.isInteger(startYear) || startYear < HISTORICAL_FIRST_YEAR || startYear > latestWindowStart) {
      errors.push(
        `Historical start year must be from ${HISTORICAL_FIRST_YEAR} through ${latestWindowStart}, the latest full window for this plan.`,
      );
    } else historicalConfig = { startYear };
  }
  return {
    errors,
    item: {
      simMode: draft.simMode,
      ...(mcConfig ? { mcConfig } : {}),
      ...(historicalConfig ? { historicalConfig } : {}),
      retirementAge,
      returnAssumptions,
      withdrawalOrder: orderWithCashPosition(draft.order, draft.cashPosition),
      benefits: { ...draft.benefits, gis: draft.benefits.oas && draft.benefits.gis },
      payroll: { ...draft.payroll },
      withdrawalStrategy: draft.withdrawalStrategy,
    },
  };
}

/**
 * Base projection settings, saved on edit like the plan editors: each valid
 * change dispatches immediately; invalid drafts stay local with an error.
 */
export function BaseScenarioSettings() {
  const { baseScenario, setBaseScenario, workspace } = useWorkspace();
  const latestWindowStart = HISTORICAL_LAST_YEAR - (workspace.plan.profile.endAge - workspace.plan.profile.currentAge);
  const stored = baseScenario ?? EMPTY_BASE_SETTINGS;
  const [draft, setDraft] = useState<SettingsDraft>(() => settingsDraftOf(stored));
  const returnSettingsRef = useRef<HTMLDetailsElement>(null);
  const withdrawalOrderRef = useRef<HTMLDetailsElement>(null);
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
    runs: String(item.mcConfig?.runs ?? 1_000),
    seed: String(item.mcConfig?.seed ?? 12_345),
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
    payroll: item.payroll ?? { cpp: false, ei: false, cppOptOut65to69: false },
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
  const returnSettingsInvalid = errors.some((error) => error.includes("return (%)"));
  const withdrawalOrderInvalid = errors.some((error) => error.includes("withdrawal account exactly once"));
  useEffect(() => {
    if (returnSettingsInvalid && returnSettingsRef.current) returnSettingsRef.current.open = true;
    if (withdrawalOrderInvalid && withdrawalOrderRef.current) withdrawalOrderRef.current.open = true;
  }, [returnSettingsInvalid, withdrawalOrderInvalid]);
  const keepInvalidSectionOpen = (ref: React.RefObject<HTMLDetailsElement | null>, invalid: boolean) => {
    if (invalid && ref.current && !ref.current.open) ref.current.open = true;
  };

  return (
    <section className="base-scenario-settings" aria-label="Base projection settings">
      <header className="base-settings-heading">
        <h2>Base projection settings</h2>
        <p>Edits apply as you make them. Scenarios use these settings unless they override them.</p>
      </header>
      <div className="base-settings-sections">
        <FormSection title="Basics" description="Choose the retirement age to use in this projection.">
          <div className="form-section-grid">
            <label className="form-field">
              Base retirement age
              <NumberTextInput
                aria-label="Base retirement age"
                name="retirementAge"
                step="1"
                min="1"
                required
                value={draft.retirementAge}
                onChange={(retirementAge) => change({ retirementAge })}
              />
            </label>
          </div>
        </FormSection>

        <FormSection
          title="Benefits"
          description="Choose which configured benefits to include. The switches do not create benefit amounts."
        >
          <div className="form-section-option-grid" role="group" aria-label="Benefits in this projection">
            <label className="form-section-option">
              <input
                type="checkbox"
                aria-label="Base include CPP"
                checked={draft.benefits.cpp}
                onChange={(e) => change({ benefits: { ...draft.benefits, cpp: e.currentTarget.checked } })}
              />
              <span>
                <span className="form-section-option-title">CPP</span>
                <span className="form-section-option-note">Include configured CPP income</span>
              </span>
            </label>
            <label className="form-section-option">
              <input
                type="checkbox"
                aria-label="Base include OAS"
                checked={draft.benefits.oas}
                onChange={(e) =>
                  change({
                    benefits: {
                      ...draft.benefits,
                      oas: e.currentTarget.checked,
                      gis: e.currentTarget.checked && draft.benefits.gis,
                    },
                  })
                }
              />
              <span>
                <span className="form-section-option-title">OAS</span>
                <span className="form-section-option-note">Include configured OAS income</span>
              </span>
            </label>
            <label className="form-section-option">
              <input
                type="checkbox"
                aria-label="Base include GIS"
                checked={draft.benefits.gis && draft.benefits.oas}
                disabled={!draft.benefits.oas}
                onChange={(e) => change({ benefits: { ...draft.benefits, gis: e.currentTarget.checked } })}
              />
              <span>
                <span className="form-section-option-title">GIS</span>
                <span className="form-section-option-note">Include modeled GIS; requires OAS in this model</span>
              </span>
            </label>
          </div>
          {draft.benefits.cpp && !workspace.plan.incomes.some((income) => income.kind === "cpp") && (
            <p className="form-section-note">
              No CPP income stream is configured. Add one under Plan → Incomes to model CPP.
            </p>
          )}
          {draft.benefits.oas && !workspace.plan.incomes.some((income) => income.kind === "oas") && (
            <p className="form-section-note">
              No OAS income stream is configured. Add one under Plan → Incomes to model OAS.
            </p>
          )}
          <p className="form-section-note">
            CPP and OAS amounts and start/end ages come from the Plan income streams. GIS requires OAS here;{" "}
            <a
              href="https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/guaranteed-income-supplement/eligibility.html"
              target="_blank"
              rel="noreferrer"
            >
              Service Canada eligibility
            </a>
            .
          </p>
        </FormSection>

        <FormSection
          title="Payroll"
          description="Employee payroll deductions withheld from employment income. These are separate from the benefit switches above."
        >
          <PayrollOptions
            ariaPrefix="Base"
            payroll={draft.payroll}
            onChange={(payroll) => change({ payroll: { ...draft.payroll, ...payroll } })}
            hasEmploymentIncome={workspace.plan.incomes.some((income) => income.kind === "employment")}
          />
          {draft.payroll.cpp === false && draft.payroll.ei === false && (
            <p className="form-section-note">
              Payroll is off — the legacy default: no employee CPP or EI amounts are withheld and working-year cash flow
              is unchanged.
            </p>
          )}
          <p className="form-section-note">CPP applies ages 18–69.</p>
        </FormSection>

        <FormSection
          title="Simulation"
          description="Choose how investment returns are generated for the base projection."
        >
          <div className="form-section-grid">
            <label className="form-field form-section-wide">
              Simulation mode
              <select
                aria-label="Base simulation mode"
                value={draft.simMode}
                onChange={(event) => change({ simMode: event.currentTarget.value as Scenario["simMode"] })}
              >
                <option value="deterministic">Deterministic</option>
                <option value="montecarlo">Monte Carlo</option>
                <option value="historical">Historical JST U.S. proxy</option>
              </select>
            </label>
            {draft.simMode === "montecarlo" && (
              <>
                <label className="form-field">
                  Monte Carlo runs
                  <NumberTextInput
                    aria-label="Base Monte Carlo runs"
                    min={1}
                    max={10_000}
                    step={1}
                    value={draft.runs}
                    onChange={(runs) => change({ runs })}
                  />
                </label>
                <label className="form-field">
                  Monte Carlo seed
                  <NumberTextInput
                    aria-label="Base Monte Carlo seed"
                    min={0}
                    max={4_294_967_295}
                    step={1}
                    value={draft.seed}
                    onChange={(seed) => change({ seed })}
                  />
                </label>
                <label className="form-field">
                  Equity standard deviation (%)
                  <NumberTextInput
                    aria-label="Base equity standard deviation (%)"
                    min={0}
                    max={100}
                    value={draft.equitySd}
                    onChange={(equitySd) => change({ equitySd })}
                  />
                </label>
                <label className="form-field">
                  Bond standard deviation (%)
                  <NumberTextInput
                    aria-label="Base bond standard deviation (%)"
                    min={0}
                    max={100}
                    value={draft.bondSd}
                    onChange={(bondSd) => change({ bondSd })}
                  />
                </label>
                <label className="form-field">
                  Cash standard deviation (%)
                  <NumberTextInput
                    aria-label="Base cash standard deviation (%)"
                    min={0}
                    max={100}
                    value={draft.cashSd}
                    onChange={(cashSd) => change({ cashSd })}
                  />
                </label>
                <p className="form-section-note form-section-wide">
                  Monte Carlo reports the ensemble outcomes and one reproducible representative year path.
                </p>
              </>
            )}
            {draft.simMode === "historical" && (
              <>
                <label className="form-field form-section-wide">
                  Earliest historical return year
                  <NumberTextInput
                    aria-label="Base historical start year"
                    min={HISTORICAL_FIRST_YEAR}
                    max={latestWindowStart}
                    step={1}
                    value={draft.historicalStartYear}
                    onChange={(historicalStartYear) => change({ historicalStartYear })}
                  />
                </label>
                <p className="form-section-note form-section-wide">
                  Uses complete rolling windows from this source year through {latestWindowStart}. Source years map to
                  ages; household calendar years still use birth year.
                </p>
                <p className="form-section-note form-section-wide">
                  {HISTORICAL_DATASET.country} annual nominal USD returns · non-Canadian proxy · no FX conversion ·{" "}
                  {HISTORICAL_DATASET.license} (noncommercial).
                </p>
              </>
            )}
          </div>
          {draft.simMode !== "historical" && (
            <FormSection
              title="Return assumptions"
              description="Annual rates for equity, bonds and cash. These are separate rates, not portfolio percentages."
              className="form-section-nested base-return-section"
              collapsible
              detailsRef={returnSettingsRef}
              onToggle={() => keepInvalidSectionOpen(returnSettingsRef, returnSettingsInvalid)}
            >
              <div className="form-section-grid">
                {(["equity", "bond", "cash"] as const).map((key) => (
                  <label className="form-field" key={key}>
                    Base {key === "bond" ? "bonds" : key} return (%)
                    <NumberTextInput
                      aria-label={`Base ${key} return (%)`}
                      name={key}
                      step="any"
                      required
                      value={draft[key]}
                      onChange={(value) => change({ [key]: value })}
                    />
                  </label>
                ))}
              </div>
            </FormSection>
          )}
          {draft.simMode === "historical" && (
            <p className="form-section-note">
              Historical mode supplies the return path; the equity, bond and cash assumptions do not apply.
            </p>
          )}
        </FormSection>

        <FormSection
          title="Withdrawals"
          description="Choose the planning strategy. Manual account order is an additional setting."
        >
          <div className="form-section-grid">
            <label className="form-field form-section-wide">
              Withdrawal strategy
              <select
                aria-label="Base withdrawal strategy"
                value={draft.withdrawalStrategy}
                onChange={(e) => change({ withdrawalStrategy: e.currentTarget.value as WithdrawalStrategy })}
              >
                <option value="manual">Manual account order</option>
                <option value="tax-minimizing">Tax-minimizing planning</option>
              </select>
            </label>
            {draft.withdrawalStrategy === "tax-minimizing" && (
              <>
                <p className="form-section-note form-section-wide">{TAX_MINIMIZING_STRATEGY_HELP}</p>
                <p className="form-section-note form-section-wide">
                  Your saved account order remains the optimizer fallback.
                </p>
              </>
            )}
            {draft.withdrawalStrategy === "manual" && (
              <FormSection
                title="Account withdrawal order"
                description="Choose which accounts fund a deficit first. Changes swap positions."
                className="form-section-nested form-section-wide"
                collapsible
                detailsRef={withdrawalOrderRef}
                onToggle={() => keepInvalidSectionOpen(withdrawalOrderRef, withdrawalOrderInvalid)}
              >
                <div className="form-section-grid">
                  {draft.order.map((type, index) => (
                    <label className="form-field" key={index}>
                      Base withdrawal priority {index + 1}
                      <select
                        name={`order${index}`}
                        value={type}
                        aria-label={`Base withdrawal priority ${index + 1}`}
                        onChange={(event) =>
                          change({
                            order: swapOrderPosition(draft.order, index, event.currentTarget.value as AccountType),
                          })
                        }
                      >
                        {INVESTMENT_ACCOUNT_TYPES.map((account) => (
                          <option key={account} value={account}>
                            {ACCOUNT_TYPE_LABELS[account]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <label className="form-field form-section-wide">
                    Named cash withdrawal order
                    <select
                      aria-label="Base cash withdrawal order"
                      value={draft.cashPosition}
                      onChange={(event) => change({ cashPosition: event.currentTarget.value as CashOrderPosition })}
                    >
                      <option value="automatic">Automatic (cash first when named cash accounts exist)</option>
                      {["First", "Second", "Third", "Fourth"].map((label, index) => (
                        <option key={label} value={String(index)}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </FormSection>
            )}
          </div>
        </FormSection>
        {errors.length > 0 && (
          <div role="alert" className="form-errors">
            {errors.map((error) => (
              <p key={error}>{error}</p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
