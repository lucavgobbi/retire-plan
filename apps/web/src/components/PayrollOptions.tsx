import type { PayrollSettings } from "../domain/types";

/**
 * The three payroll switches shared by the base settings and the scenario
 * editor. CPP includes CPP2 (there is no separate CPP2 switch); EI is
 * independent; the 65–69 opt-out is a valid election only while receiving the
 * CPP retirement pension. The legacy/off note stays with each caller because
 * its wording differs slightly.
 */
export function PayrollOptions({ ariaPrefix, payroll, onChange, hasEmploymentIncome }: {
  ariaPrefix: "Base" | "Scenario";
  payroll: PayrollSettings;
  onChange: (patch: Partial<PayrollSettings>) => void;
  hasEmploymentIncome: boolean;
}) {
  return <>
    <div className="form-section-option-grid" role="group" aria-label={`${ariaPrefix} employee payroll deductions`}>
      <label className="form-section-option"><input type="checkbox" aria-label={`${ariaPrefix} employee CPP`} checked={payroll.cpp} onChange={e => onChange({ cpp: e.currentTarget.checked })} /><span><span className="form-section-option-title">CPP (includes CPP2)</span><span className="form-section-option-note">Employee CPP contributions; CPP2 follows CPP with no separate switch</span></span></label>
      <label className="form-section-option"><input type="checkbox" aria-label={`${ariaPrefix} employee EI`} checked={payroll.ei} onChange={e => onChange({ ei: e.currentTarget.checked })} /><span><span className="form-section-option-title">EI</span><span className="form-section-option-note">Employee EI premiums</span></span></label>
      <label className="form-section-option"><input type="checkbox" aria-label={`${ariaPrefix} CPP opt-out ages 65–69`} checked={payroll.cppOptOut65to69} onChange={e => onChange({ cppOptOut65to69: e.currentTarget.checked })} /><span><span className="form-section-option-title">CPP opt-out 65–69</span><span className="form-section-option-note">Valid election only while receiving the CPP retirement pension</span></span></label>
    </div>
    {(payroll.cpp || payroll.ei) && !hasEmploymentIncome && <p className="form-section-note">No employment income is configured. Add one under Plan → Incomes for payroll deductions to apply.</p>}
    <p className="form-section-note">Employee, single-employer annual approximation. EI benefits, CPP pension accrual and post-retirement benefit increases are not calculated.</p>
  </>;
}
