import { useEffect, useRef, useState } from "react";
import { useWorkspace, type AccountType } from "../store/api";

function percentInput(rate: number): string { return String(Math.round(rate * 1e12) / 1e10); }

type SettingsDraft = { retirementAge: string; equity: string; bond: string; cash: string; order: AccountType[] };
type SettingsItem = { retirementAge: number; returnAssumptions: { equity: number; bond: number; cash: number }; withdrawalOrder: AccountType[] };

function settingsDraftOf(base: NonNullable<ReturnType<typeof useWorkspace>["baseScenario"]>): SettingsDraft {
  return {
    retirementAge: String(base.retirementAge),
    equity: percentInput(base.returnAssumptions.equity),
    bond: percentInput(base.returnAssumptions.bond),
    cash: percentInput(base.returnAssumptions.cash),
    order: [...base.withdrawalOrder],
  };
}

/**
 * Parse a draft into applied settings. Untouched rate inputs (their text equals
 * the stored rate's display) preserve the exact stored precision instead of
 * round-tripping through a number.
 */
function readSettingsDraft(draft: SettingsDraft, stored: SettingsItem): { errors: string[]; item: SettingsItem } {
  const errors: string[] = [];
  const retirementAge = Number(draft.retirementAge);
  if (!Number.isInteger(retirementAge) || retirementAge <= 0) errors.push("Use a positive whole retirement age.");
  const returnAssumptions = { ...stored.returnAssumptions };
  for (const key of ["equity", "bond", "cash"] as const) {
    const rate = Number(draft[key]);
    if (!Number.isFinite(rate)) errors.push(`Base ${key} return (%) must be a number.`);
    else returnAssumptions[key] = draft[key] === percentInput(stored.returnAssumptions[key]) ? stored.returnAssumptions[key] : rate / 100;
  }
  if (new Set(draft.order).size !== 3) errors.push("Choose each withdrawal account exactly once.");
  return { errors, item: { retirementAge, returnAssumptions, withdrawalOrder: [...draft.order] } };
}

/**
 * Base projection settings, saved on edit like the plan editors: each valid
 * change dispatches immediately; invalid drafts stay local with an error.
 */
export function BaseScenarioSettings() {
  const { baseScenario, setBaseScenario, clearEditNotice } = useWorkspace();
  const stored = baseScenario ?? {
    retirementAge: 0, returnAssumptions: { equity: NaN, bond: NaN, cash: NaN }, withdrawalOrder: ["tfsa", "nonreg", "rrsp"] as AccountType[],
  };
  const [draft, setDraft] = useState<SettingsDraft>(() => settingsDraftOf(stored));
  const [applied, setApplied] = useState(false);
  const lastApplied = useRef<SettingsDraft>(settingsDraftOf(stored));
  useEffect(() => {
    const current = settingsDraftOf(stored);
    if (JSON.stringify(current) !== JSON.stringify(lastApplied.current)) {
      lastApplied.current = current;
      setDraft(current);
      setApplied(false);
    }
  }, [stored]);
  /** Normalized draft for comparing against the last applied value, like the plan editors. */
  const normalized = (item: SettingsItem): SettingsDraft => ({
    retirementAge: String(item.retirementAge),
    equity: percentInput(item.returnAssumptions.equity),
    bond: percentInput(item.returnAssumptions.bond),
    cash: percentInput(item.returnAssumptions.cash),
    order: item.withdrawalOrder,
  });
  const change = (patch: Partial<SettingsDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    clearEditNotice();
    const { errors, item } = readSettingsDraft(next, stored);
    if (errors.length > 0) { setApplied(false); return; }
    if (JSON.stringify(normalized(item)) !== JSON.stringify(lastApplied.current)) {
      lastApplied.current = normalized(item);
      setBaseScenario(item);
    }
    setApplied(true);
  };
  const { errors } = readSettingsDraft(draft, stored);

  return <details className="panel"><summary>Base projection settings</summary>
    <p className="muted">Saved with this workspace on every edit. Scenarios inherit these settings unless they override them.</p>
    <div className="form-grid">
      <label className="field">Base retirement age<input name="retirementAge" type="number" step="1" min="1" required value={draft.retirementAge} onChange={event => change({ retirementAge: event.currentTarget.value })} /></label>
      {(["equity", "bond", "cash"] as const).map(key => <label className="field" key={key}>Base {key} return (%)<input name={key} type="number" step="any" required value={draft[key]} onChange={event => change({ [key]: event.currentTarget.value })} /></label>)}
      {draft.order.map((type, index) => <label className="field" key={index}>Base withdrawal priority {index + 1}<select name={`order${index}`} value={type} aria-label={`Base withdrawal priority ${index + 1}`} onChange={event => {
        const order = [...draft.order];
        order[index] = event.currentTarget.value as AccountType;
        change({ order });
      }}>{(["tfsa", "nonreg", "rrsp"] as const).map(account => <option key={account} value={account}>{account.toUpperCase()}</option>)}</select></label>)}
    </div>
    {errors.length > 0 ? <div role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>
      : applied ? <p className="plan-help">Changes applied automatically; local saving status is shown above.</p> : null}
  </details>;
}
