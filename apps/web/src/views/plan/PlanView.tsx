import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  AccountPlan,
  AssetPlan,
  DebtPlan,
  ExpensePlan,
  IncomePlan,
  SavingsPolicyStep,
  SavingsTarget,
} from "@retire-plan/engine";
import { calculateCurrentAge, useWorkspace } from "../../store/api";
import { NumberTextInput } from "../../components/NumberTextInput";
import { fmtMoney, fmtPercent } from "../projection/fmt";
import "./planView.css";

type Tab = "Profile" | "Accounts" | "Assets & debts" | "Income" | "Expenses" | "Savings";
const TABS: Tab[] = ["Profile", "Accounts", "Assets & debts", "Income", "Expenses", "Savings"];

function makeId(prefix: string): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? `${prefix}-${crypto.randomUUID()}`
    : `${prefix}-${Date.now()}`;
}

function TextInput({ label, value, onChange, step, min, optional = false, group = true }: {
  label: string; value: string; onChange: (value: string) => void; step?: string; min?: string; optional?: boolean; group?: boolean;
}) {
  return <label className="plan-field"><span className="field-label">{label}{optional && <span className="plan-optional"> · optional</span>}</span>
    <NumberTextInput step={step ?? "any"} min={min} group={group} allowNegative={min === undefined || Number(min) < 0}
      value={value} onChange={onChange} />
  </label>;
}

function TextField({ label, value, onChange, placeholder, optional = false }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; optional?: boolean;
}) {
  return <label className="plan-field"><span className="field-label">{label}{optional && <span className="plan-optional"> · optional</span>}</span><input type="text" value={value} placeholder={placeholder}
    onChange={event => onChange(event.currentTarget.value)} /></label>;
}

function SelectField<T extends string>({ label, value, choices, onChange, labels }: {
  label: string; value: T; choices: readonly T[]; onChange: (value: T) => void; labels?: Record<T, string>;
}) {
  return <label className="plan-field"><span className="field-label">{label}</span><select value={value} onChange={event => onChange(event.currentTarget.value as T)}>
    {choices.map(choice => <option key={choice} value={choice}>{labels?.[choice] ?? choice}</option>)}
  </select></label>;
}

function requiredNumber(raw: string, label: string, errors: string[], minimum?: number): number {
  if (raw.trim() === "") { errors.push(`${label} is required.`); return 0; }
  const value = Number(raw);
  if (!Number.isFinite(value)) { errors.push(`${label} must be a finite number.`); return 0; }
  if (minimum !== undefined && value < minimum) errors.push(`${label} must be at least ${minimum}.`);
  return value;
}

function optionalNumber(raw: string, label: string, errors: string[], minimum?: number): number | undefined {
  if (raw.trim() === "") return undefined;
  return requiredNumber(raw, label, errors, minimum);
}

function requiredInteger(raw: string, label: string, errors: string[], minimum?: number): number {
  const value = requiredNumber(raw, label, errors, minimum);
  if (Number.isFinite(value) && !Number.isInteger(value)) errors.push(`${label} must be a whole number.`);
  return value;
}

function optionalInteger(raw: string, label: string, errors: string[], minimum?: number): number | undefined {
  if (raw.trim() === "") return undefined;
  return requiredInteger(raw, label, errors, minimum);
}

function ErrorList({ errors }: { errors: string[] }) {
  if (!errors.length) return null;
  return <div className="plan-errors" role="alert">{errors.map(error => <p key={error}>{error}</p>)}</div>;
}

/** Inline editor shell: heading, Remove, fields, and validation errors — no save buttons. */
function ItemForm({ title, children, errors, onRemove }: {
  title: string; children: ReactNode; errors: string[]; onRemove?: () => void;
}) {
  return <section className="plan-item-form" aria-label={title}>
    <div className="plan-item-heading"><h3>{title}</h3>{onRemove && <button type="button" className="plan-remove" onClick={onRemove}>Remove</button>}</div>
    <div className="plan-fields">{children}</div>
    <ErrorList errors={errors} />
  </section>;
}

function ReadOnlyItemCard({ title, badge, primaryLabel, primaryValue, details, editing, onEdit }: {
  title: string; badge: string; primaryLabel: string; primaryValue: string;
  details: [string, string][]; editing: boolean; onEdit: () => void;
}) {
  return <section className="plan-summary-card" aria-label={`${title} summary`}>
    <div className="plan-summary-heading"><div><span className="plan-type-badge">{badge}</span><h3>{title}</h3></div>
      <button type="button" aria-expanded={editing} onClick={onEdit}>{editing ? "Close editor" : "Edit"}</button>
    </div>
    <div className="plan-primary-value"><span>{primaryLabel}</span><strong>{primaryValue}</strong></div>
    {details.length > 0 && <dl className="plan-summary-details">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
  </section>;
}

function useInlineEditors() {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  return {
    isOpen: (id: string) => openIds.has(id),
    open: (id: string) => setOpenIds(current => new Set(current).add(id)),
    toggle: (id: string) => setOpenIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    }),
    close: (id: string) => setOpenIds(current => {
      if (!current.has(id)) return current;
      const next = new Set(current); next.delete(id); return next;
    }),
  };
}

/**
 * Autosave-on-edit pattern (same as the account rows): keep the draft as text,
 * parse on every change, dispatch only when the parsed item is valid and differs
 * from the last applied value. Invalid keystrokes stay in the input without
 * touching the store; external store changes refresh the draft without dispatching.
 */
function useAutoApplyForm<TDraft extends object, TItem extends object>(
  stored: TItem,
  toDraft: (item: TItem) => TDraft,
  readDraft: (draft: TDraft) => { errors: string[]; item: TItem },
  onApply: (item: TItem) => void,
): { draft: TDraft; change: (patch: Partial<TDraft>) => void; applied: boolean; errors: string[] } {
  const [draft, setDraft] = useState(() => toDraft(stored));
  const [applied, setApplied] = useState(false);
  const lastApplied = useRef<TDraft>(toDraft(stored));
  const refresh = useRef(toDraft);
  refresh.current = toDraft;
  useEffect(() => {
    const current = refresh.current(stored);
    if (JSON.stringify(current) !== JSON.stringify(lastApplied.current)) {
      lastApplied.current = current;
      setDraft(current);
      setApplied(false);
    }
  }, [stored]);
  const change = (patch: Partial<TDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    const parsed = readDraft(next);
    if (parsed.errors.length > 0) { setApplied(false); return; }
    // Compare normalized drafts so typing "100." keeps its caret and text while
    // the stored value remains 100.
    const normalized = refresh.current(parsed.item);
    if (JSON.stringify(normalized) !== JSON.stringify(lastApplied.current)) {
      lastApplied.current = normalized;
      onApply(parsed.item);
    }
    setApplied(true);
  };
  return { draft, change, applied, errors: readDraft(draft).errors };
}

/** The "edits apply themselves" notices shared by every inline editor. */
function ApplyNotice({ errors, applied }: { errors: string[]; applied: boolean }) {
  return errors.length > 0 ? <p className="draft-notice" role="status">These edits are not applied. Fix the errors to update the plan; the last valid values are kept.</p>
    : applied ? <p className="plan-help" role="status">Changes applied automatically. Local saving status is shown above.</p>
    : <p className="plan-help">Valid edits apply automatically.</p>;
}

interface AccountDraft { id: string; name: string; type: AccountPlan["type"]; balance: string; bookValue: string; equity: string; bond: string; cash: string; interestRate: string }
const ACCOUNT_LABELS: Record<AccountPlan["type"], string> = { tfsa: "TFSA", rrsp: "RRSP", nonreg: "Non-registered", cash: "Cash account" };
function accountDraft(account: AccountPlan): AccountDraft {
  if (account.type === "cash") return { id: account.id, name: account.name ?? "", type: "cash", balance: String(account.balance), bookValue: "", equity: "", bond: "", cash: "", interestRate: String((account.interestRate ?? 0) * 100) };
  const mix = account.assetMix ?? { equity: 0.6, bond: 0.3, cash: 0.1 };
  return { id: account.id, name: account.name ?? "", type: account.type, balance: String(account.balance), bookValue: account.bookValue === undefined ? "" : String(account.bookValue), equity: String(mix.equity * 100), bond: String(mix.bond * 100), cash: String(mix.cash * 100), interestRate: "0" };
}
function readAccountDraft(draft: AccountDraft): { errors: string[]; item: AccountPlan } {
  const errors: string[] = [];
  const balance = requiredNumber(draft.balance, "Balance", errors, 0);
  if (draft.type === "cash") {
    const interestRate = requiredNumber(draft.interestRate, "Annual interest rate", errors, 0) / 100;
    return { errors, item: { id: draft.id, name: draft.name.trim() === "" ? undefined : draft.name.trim(), type: "cash", balance, bookValue: undefined, assetMix: undefined, interestRate } };
  }
  const bookValue = draft.type === "nonreg" ? optionalNumber(draft.bookValue, "ACB / book value", errors, 0) : undefined;
  const equity = requiredNumber(draft.equity, "Equity allocation", errors, 0);
  const bond = requiredNumber(draft.bond, "Bond allocation", errors, 0);
  const cash = requiredNumber(draft.cash, "Cash allocation", errors, 0);
  if (Math.abs(equity + bond + cash - 100) > 0.1) errors.push("Asset mix must total 100%.");
  return { errors, item: { id: draft.id, name: draft.name.trim() === "" ? undefined : draft.name.trim(), type: draft.type, balance, bookValue, assetMix: { equity: equity / 100, bond: bond / 100, cash: cash / 100 }, interestRate: undefined } };
}
function newAccountDraft(): AccountDraft {
  return { id: makeId("account"), name: "", type: "tfsa", balance: "0", bookValue: "", equity: "60", bond: "30", cash: "10", interestRate: "0" };
}

function AccountForm({ account, onApply, onRemove }: { account: AccountPlan; onApply: (item: AccountPlan) => void; onRemove: () => void }) {
  const { draft, change, applied, errors } = useAutoApplyForm(account, accountDraft, readAccountDraft, onApply);
  return <ItemForm title={draft.name.trim() || (draft.type === "cash" ? "Cash account" : `${ACCOUNT_LABELS[draft.type]} account`)} errors={errors} onRemove={onRemove}>
    <TextField label="Name" value={draft.name} onChange={name => change({ name })} optional />
    <SelectField label="Account type" value={draft.type} choices={["tfsa", "rrsp", "nonreg", "cash"] as const} labels={ACCOUNT_LABELS} onChange={type => change({ type, ...(type !== "nonreg" ? { bookValue: "" } : {}), ...(type === "cash" ? { equity: "", bond: "", cash: "", interestRate: "0" } : { equity: "60", bond: "30", cash: "10" }) })} />
    <TextInput label="Current balance ($)" value={draft.balance} min="0" onChange={balance => change({ balance })} />
    {draft.type === "cash" ? <TextInput label="Annual interest rate (%)" value={draft.interestRate} min="0" onChange={interestRate => change({ interestRate })} /> : <>
    {draft.type === "nonreg" && <TextInput label="ACB / book value ($)" value={draft.bookValue} min="0" optional onChange={bookValue => change({ bookValue })} />}
    <TextInput label="Equity (%)" value={draft.equity} min="0" onChange={equity => change({ equity })} />
    <TextInput label="Bonds (%)" value={draft.bond} min="0" onChange={bond => change({ bond })} />
    <TextInput label="Cash (%)" value={draft.cash} min="0" onChange={cash => change({ cash })} />
    </>}
    <ApplyNotice errors={errors} applied={applied} />
  </ItemForm>;
}

const ASSET_KIND_LABELS: Record<AssetPlan["kind"], string> = { "primary-home": "Primary home", other: "Other" };
const SAVINGS_TARGET_LABELS: Record<SavingsTarget, string> = { tfsa: "TFSA", "rrsp-match": "RRSP (employer match)", rrsp: "RRSP", nonreg: "Non-registered", cash: "Cash accounts", "mortgage-prepay": "Mortgage prepayment" };
interface AssetDraft { id: string; kind: AssetPlan["kind"]; name: string; value: string; appreciationRate: string; hasSale: boolean; saleAge: string; saleCosts: string }
function assetDraft(asset: AssetPlan): AssetDraft { return { id: asset.id, kind: asset.kind, name: asset.name ?? "", value: String(asset.value), appreciationRate: String(asset.appreciationRate * 100), hasSale: !!asset.sellEvent, saleAge: asset.sellEvent ? String(asset.sellEvent.age) : "", saleCosts: asset.sellEvent ? String(asset.sellEvent.costsPct * 100) : "" }; }
function newAssetDraft(): AssetDraft { return { id: makeId("asset"), kind: "primary-home", name: "", value: "0", appreciationRate: "2", hasSale: false, saleAge: "", saleCosts: "5" }; }
function readAssetDraft(draft: AssetDraft): { errors: string[]; item: AssetPlan } {
  const errors: string[] = [];
  // Name is optional: a blank name is simply not stored.
  const value = requiredNumber(draft.value, "Value", errors, 0);
  const appreciationRate = requiredNumber(draft.appreciationRate, "Appreciation rate", errors) / 100;
  const saleAge = draft.hasSale ? requiredInteger(draft.saleAge, "Sale age", errors, 1) : undefined;
  const saleCostsPct = draft.hasSale ? requiredNumber(draft.saleCosts, "Sale costs", errors, 0) : undefined;
  if (saleCostsPct !== undefined && saleCostsPct > 100) errors.push("Sale costs cannot exceed 100%.");
  const saleCosts = saleCostsPct === undefined ? undefined : saleCostsPct / 100;
  return { errors, item: { id: draft.id, kind: draft.kind, name: draft.name.trim() === "" ? undefined : draft.name.trim(), value, appreciationRate, ...(saleAge === undefined ? {} : { sellEvent: { age: saleAge, costsPct: saleCosts ?? 0 } }) } };
}
function AssetForm({ asset, onApply, onRemove }: { asset: AssetPlan; onApply: (item: AssetPlan) => void; onRemove: () => void }) {
  const { draft, change, applied, errors } = useAutoApplyForm(asset, assetDraft, readAssetDraft, onApply);
  return <ItemForm title={draft.name || "Asset"} errors={errors} onRemove={onRemove}>
    <SelectField label="Asset kind" value={draft.kind} choices={["primary-home", "other"] as const} labels={ASSET_KIND_LABELS} onChange={kind => change({ kind })} />
    <TextField label="Name" value={draft.name} onChange={name => change({ name })} optional />
    <TextInput label="Current value ($)" value={draft.value} min="0" onChange={value => change({ value })} />
    <TextInput label="Annual appreciation (%)" value={draft.appreciationRate} onChange={appreciationRate => change({ appreciationRate })} />
    <label className="plan-check"><input type="checkbox" checked={draft.hasSale} onChange={event => change({ hasSale: event.currentTarget.checked })} />Plan a sale event</label>
    {draft.hasSale && <>
      <TextInput label="Sale age" value={draft.saleAge} min="1" step="1" onChange={saleAge => change({ saleAge })} />
      <TextInput label="Sale costs (%)" value={draft.saleCosts} min="0" onChange={saleCosts => change({ saleCosts })} />
    </>}
    <ApplyNotice errors={errors} applied={applied} />
  </ItemForm>;
}
interface DebtDraft { id: string; paymentFrequency: DebtPlan["paymentFrequency"]; rate: string; termYears: string; amortizationYears: string; balance: string; monthlyPayment: string }
const FREQUENCY_LABELS: Record<NonNullable<DebtPlan["paymentFrequency"]>, string> = { monthly: "Monthly (12×)", biweekly: "Biweekly (26×)", weekly: "Weekly (52×)" };
function debtDraft(debt: DebtPlan): DebtDraft { return { id: debt.id, paymentFrequency: debt.paymentFrequency ?? "monthly", rate: String(debt.rate * 100), termYears: String(debt.termYears), amortizationYears: String(debt.amortizationYears), balance: String(debt.balance), monthlyPayment: String(debt.monthlyPayment) }; }
function newDebtDraft(): DebtDraft { return { id: makeId("mortgage"), paymentFrequency: "monthly", rate: "4.5", termYears: "5", amortizationYears: "25", balance: "1", monthlyPayment: "1" }; }
function readDebtDraft(draft: DebtDraft): { errors: string[]; item: DebtPlan } {
  const errors: string[] = [];
  const rate = requiredNumber(draft.rate, "Interest rate", errors, 0) / 100;
  const termYears = requiredInteger(draft.termYears, "Term", errors, 1);
  const amortizationYears = requiredInteger(draft.amortizationYears, "Amortization", errors, 1);
  const balance = requiredNumber(draft.balance, "Balance", errors, 0);
  const monthlyPayment = requiredNumber(draft.monthlyPayment, "Payment", errors, 0);
  if (balance <= 0) errors.push("Mortgage balance must be greater than $0.");
  if (monthlyPayment <= 0) errors.push("Payment must be greater than $0.");
  return { errors, item: { id: draft.id, kind: "mortgage", rate, termYears, amortizationYears, balance, monthlyPayment, paymentFrequency: draft.paymentFrequency === "monthly" ? undefined : draft.paymentFrequency } };
}
function DebtForm({ debt, onApply, onRemove }: { debt: DebtPlan; onApply: (item: DebtPlan) => void; onRemove: () => void }) {
  const { draft, change, applied, errors } = useAutoApplyForm(debt, debtDraft, readDebtDraft, onApply);
  return <ItemForm title="Mortgage" errors={errors} onRemove={onRemove}>
    <TextInput label="Annual interest rate (%)" value={draft.rate} min="0" onChange={rate => change({ rate })} />
    <TextInput label="Mortgage balance ($)" value={draft.balance} min="0" onChange={balance => change({ balance })} />
    <TextInput label="Payment ($)" value={draft.monthlyPayment} min="0" onChange={monthlyPayment => change({ monthlyPayment })} />
    <SelectField label="Payment frequency" value={draft.paymentFrequency ?? "monthly"} choices={["monthly", "biweekly", "weekly"] as const} labels={FREQUENCY_LABELS} onChange={paymentFrequency => change({ paymentFrequency })} />
    <TextInput label="Term (years)" value={draft.termYears} min="1" step="1" onChange={termYears => change({ termYears })} />
    <TextInput label="Amortization (years)" value={draft.amortizationYears} min="1" step="1" onChange={amortizationYears => change({ amortizationYears })} />
    <ApplyNotice errors={errors} applied={applied} />
  </ItemForm>;
}

interface IncomeDraft { id: string; name: string; kind: IncomePlan["kind"]; annualAmount: string; startAge: string; endAge: string; raiseRate: string }
function incomeDraft(income: IncomePlan): IncomeDraft { return { id: income.id, name: income.name ?? "", kind: income.kind, annualAmount: String(income.annualAmount), startAge: String(income.startAge), endAge: income.endAge === undefined ? "" : String(income.endAge), raiseRate: String(income.raiseRate * 100) }; }
function newIncomeDraft(kind: IncomePlan["kind"], currentAge: number, retirementAge: number): IncomeDraft { return { id: makeId("income"), name: "", kind, annualAmount: "0", startAge: String(currentAge), endAge: kind === "employment" ? String(Math.max(currentAge, retirementAge - 1)) : "", raiseRate: kind === "employment" ? "2" : "0" }; }
const INCOME_LABELS: Record<IncomePlan["kind"], string> = { employment: "Employment", cpp: "CPP", oas: "OAS", other: "Other" };
function readIncomeDraft(draft: IncomeDraft): { errors: string[]; item: IncomePlan } {
  const errors: string[] = [];
  const annualAmount = requiredNumber(draft.annualAmount, "Annual amount", errors, 0);
  const startAge = requiredInteger(draft.startAge, "Start age", errors, 1);
  const endAge = optionalInteger(draft.endAge, "End age", errors, 1);
  const raiseRate = requiredNumber(draft.raiseRate, "Annual raise (%)", errors) / 100;
  if (endAge !== undefined && endAge < startAge) errors.push("End age must be on or after start age.");
  return { errors, item: { id: draft.id, name: draft.name.trim() === "" ? undefined : draft.name.trim(), kind: draft.kind, annualAmount, startAge, ...(endAge === undefined ? {} : { endAge }), raiseRate } };
}
function IncomeForm({ income, onApply, onRemove }: { income: IncomePlan; onApply: (item: IncomePlan) => void; onRemove: () => void }) {
  const { draft, change, applied, errors } = useAutoApplyForm(income, incomeDraft, readIncomeDraft, onApply);
  return <ItemForm title={draft.name.trim() || INCOME_LABELS[draft.kind]} errors={errors} onRemove={onRemove}>
    <TextField label="Name" value={draft.name} onChange={name => change({ name })} optional />
    <SelectField label="Income type" value={draft.kind} choices={["employment", "cpp", "oas", "other"] as const} labels={INCOME_LABELS} onChange={kind => change({ kind, ...(kind === "employment" ? {} : { endAge: "" }) })} />
    <TextInput label="Annual amount ($)" value={draft.annualAmount} min="0" onChange={annualAmount => change({ annualAmount })} />
    <TextInput label="Start age" value={draft.startAge} min="1" step="1" onChange={startAge => change({ startAge })} />
    <TextInput label="End age" value={draft.endAge} min="1" step="1" optional onChange={endAge => change({ endAge })} />
    <TextInput label="Annual raise / indexing (%)" value={draft.raiseRate} onChange={raiseRate => change({ raiseRate })} />
    <ApplyNotice errors={errors} applied={applied} />
  </ItemForm>;
}
interface ExpenseDraft { id: string; name: string; annualAmount: string; startAge: string; endAge: string; inflationRate: string }
function expenseDraft(expense: ExpensePlan): ExpenseDraft { return { id: expense.id, name: expense.name ?? "", annualAmount: String(expense.annualAmount), startAge: String(expense.startAge), endAge: expense.endAge === undefined ? "" : String(expense.endAge), inflationRate: String(expense.inflationRate * 100) }; }
function newExpenseDraft(currentAge: number): ExpenseDraft { return { id: makeId("expense"), name: "", annualAmount: "0", startAge: String(currentAge), endAge: "", inflationRate: "2" }; }
function readExpenseDraft(draft: ExpenseDraft): { errors: string[]; item: ExpensePlan } {
  const errors: string[] = [];
  // Name is optional: a blank name is simply not stored.
  const annualAmount = requiredNumber(draft.annualAmount, "Annual amount", errors, 0);
  const startAge = requiredInteger(draft.startAge, "Start age", errors, 1);
  const endAge = optionalInteger(draft.endAge, "End age", errors, 1);
  const inflationRate = requiredNumber(draft.inflationRate, "Annual inflation (%)", errors) / 100;
  if (endAge !== undefined && endAge < startAge) errors.push("End age must be on or after start age.");
  return { errors, item: { id: draft.id, name: draft.name.trim() === "" ? undefined : draft.name.trim(), annualAmount, startAge, ...(endAge === undefined ? {} : { endAge }), inflationRate } };
}
function ExpenseForm({ expense, onApply, onRemove }: { expense: ExpensePlan; onApply: (item: ExpensePlan) => void; onRemove: () => void }) {
  const { draft, change, applied, errors } = useAutoApplyForm(expense, expenseDraft, readExpenseDraft, onApply);
  return <ItemForm title={draft.name || "Expense"} errors={errors} onRemove={onRemove}>
    <TextField label="Name" value={draft.name} onChange={name => change({ name })} optional />
    <TextInput label="Annual amount ($)" value={draft.annualAmount} min="0" onChange={annualAmount => change({ annualAmount })} />
    <TextInput label="Start age" value={draft.startAge} min="1" step="1" onChange={startAge => change({ startAge })} />
    <TextInput label="End age" value={draft.endAge} min="1" step="1" optional onChange={endAge => change({ endAge })} />
    <TextInput label="Annual inflation (%)" value={draft.inflationRate} onChange={inflationRate => change({ inflationRate })} />
    <ApplyNotice errors={errors} applied={applied} />
  </ItemForm>;
}
interface SavingsDraft { id: string; priority: string; target: SavingsTarget; perYearCap: string; untilAge: string; matchRate: string }
function savingsDraft(step: SavingsPolicyStep): SavingsDraft { return { id: step.id, priority: String(step.priority), target: step.target, perYearCap: step.perYearCap === undefined ? "" : String(step.perYearCap), untilAge: step.untilAge === undefined ? "" : String(step.untilAge), matchRate: step.matchRate === undefined ? "5" : String(step.matchRate * 100) }; }
function newSavingsDraft(priority: number): SavingsDraft { return { id: makeId("saving"), priority: String(priority), target: "tfsa", perYearCap: "", untilAge: "", matchRate: "5" }; }
function readSavingsDraft(draft: SavingsDraft): { errors: string[]; item: SavingsPolicyStep } {
  const errors: string[] = [];
  const priority = requiredNumber(draft.priority, "Priority", errors, 1);
  const perYearCap = optionalNumber(draft.perYearCap, "Annual cap", errors, 0);
  const untilAge = optionalInteger(draft.untilAge, "Until age", errors, 1);
  const matchRate = draft.target === "rrsp-match" ? requiredNumber(draft.matchRate, "Employer match (%)", errors, 0) / 100 : undefined;
  if (matchRate !== undefined && matchRate > 1) errors.push("Employer match must be between 0% and 100%.");
  return { errors, item: { id: draft.id, priority, target: draft.target, ...(perYearCap === undefined ? {} : { perYearCap }), ...(untilAge === undefined ? {} : { untilAge }), ...(matchRate === undefined ? {} : { matchRate }) } };
}
function SavingsForm({ step, onApply, onRemove }: { step: SavingsPolicyStep; onApply: (item: SavingsPolicyStep) => void; onRemove: () => void }) {
  const { draft, change, applied, errors } = useAutoApplyForm(step, savingsDraft, readSavingsDraft, onApply);
  return <ItemForm title={`Priority ${draft.priority}`} errors={errors} onRemove={onRemove}>
    <TextInput label="Priority" value={draft.priority} min="1" onChange={priority => change({ priority })} />
    <SelectField label="Savings target" value={draft.target} choices={["tfsa", "rrsp-match", "rrsp", "nonreg", "cash", "mortgage-prepay"] as const} labels={SAVINGS_TARGET_LABELS} onChange={target => change({ target })} />
    <TextInput label="Annual cap ($)" value={draft.perYearCap} min="0" optional onChange={perYearCap => change({ perYearCap })} />
    <TextInput label="Active through age" value={draft.untilAge} min="1" step="1" optional onChange={untilAge => change({ untilAge })} />
    {draft.target === "rrsp-match" && <TextInput label="Employer match (%)" value={draft.matchRate} min="0" onChange={matchRate => change({ matchRate })} />}
    <ApplyNotice errors={errors} applied={applied} />
  </ItemForm>;
}

/** Adds an item whose default draft parses cleanly; invalid sections never dispatch. */
function addFromDraft<TDraft extends object, TItem extends { id: string }>(
  dispatch: ReturnType<typeof useWorkspace>["dispatch"],
  section: "accounts" | "assets" | "debts" | "incomes" | "expenses" | "savingsPolicy",
  newDraft: TDraft,
  readDraft: (draft: TDraft) => { errors: string[]; item: TItem },
): string | null {
  const parsed = readDraft(newDraft);
  if (parsed.errors.length > 0) return null;
  // Section and item come from the same call site, so the pair is a valid Action;
  // the generic TItem is erased by the union, hence the unknown cast.
  const action = { type: "plan/addItem", section, item: parsed.item } as unknown as Parameters<typeof dispatch>[0];
  dispatch(action);
  return parsed.item.id;
}

function ProfileEditor() {
  const { workspace, dispatch, baseScenario, validationErrors, runProjection, runError, isRunning, runCancelled, cancelRun, calendarYear } = useWorkspace();
  const profile = workspace.plan.profile;
  const { draft, change, applied, errors } = useAutoApplyForm(
    profile,
    stored => ({ birthYear: String(stored.birthYear), endAge: String(stored.endAge) }),
    draft => {
      const nextErrors: string[] = [];
      const birth = requiredInteger(draft.birthYear, "Birth year", nextErrors, 1);
      const age = calculateCurrentAge(birth, calendarYear);
      if (age <= 0) nextErrors.push(`Birth year must be before ${calendarYear}.`);
      const end = requiredInteger(draft.endAge, "Projection end age", nextErrors, 1);
      if (end <= age) nextErrors.push("Projection end age must be greater than current age.");
      return { errors: nextErrors, item: { ...profile, birthYear: birth, endAge: end } };
    },
    patch => dispatch({ type: "plan/setProfile", patch }),
  );
  const previewAge = draft.birthYear.trim() !== "" && Number.isInteger(Number(draft.birthYear)) ? calculateCurrentAge(Number(draft.birthYear), calendarYear) : null;
  return <section className="plan-panel" aria-labelledby="profile-title">
    <h2 id="profile-title">Profile and projection</h2>
    <p className="plan-help">Set the starting point and the last age to project. Valid edits apply automatically. Province is Ontario in this version.</p>
    <div>
      <div className="plan-fields">
        <TextInput label="Birth year" value={draft.birthYear} min="1" step="1" onChange={birthYear => change({ birthYear })} group={false} />
        <label className="plan-field"><span className="field-label">Current age</span><input type="number" aria-label="Current age" readOnly value={previewAge !== null && previewAge > 0 ? previewAge : ""} aria-describedby="current-age-help" /><small id="current-age-help">Age reached in {calendarYear}, calculated from birth year.</small></label>
        <TextInput label="Projection end age" value={draft.endAge} min="1" step="1" onChange={endAge => change({ endAge })} />
        <label className="plan-field"><span className="field-label">Province</span><select value="ON" disabled><option value="ON">Ontario (ON)</option></select></label>
        <label className="plan-field"><span className="field-label">Retirement age</span><input type="number" aria-label="Retirement age" readOnly value={baseScenario.retirementAge} /><small>Change this in Base projection settings.</small></label>
      </div>
      <ErrorList errors={errors} />
      <ApplyNotice errors={errors} applied={applied} />
      <div className="plan-actions">
        <button type="button" disabled={validationErrors.length > 0 || isRunning} onClick={() => { void runProjection(); }}>Run projection</button>
        {isRunning && <><span role="status">Projection running in the background…</span><button type="button" onClick={cancelRun}>Cancel projection</button></>}
        {runCancelled && <span role="status">Projection cancelled.</span>}
      </div>
    </div>
    {validationErrors.length > 0 && <div className="plan-errors" role="alert" aria-label="Plan validation errors"><strong>Plan needs attention</strong>{validationErrors.map(error => <p key={error}>{error}</p>)}</div>}
    {runError && <p role="alert" className="plan-errors">{runError}</p>}
  </section>;
}

function AccountSummary({ account, editing, onEdit }: { account: AccountPlan; editing: boolean; onEdit: () => void }) {
  const label = ACCOUNT_LABELS[account.type];
  const details: [string, string][] = account.type === "cash"
    ? [["Annual interest", account.interestRate === undefined ? "Not set (defaults to 0%)" : fmtPercent(account.interestRate)]]
    : [
      ...(account.type === "nonreg" ? [["ACB / book value", account.bookValue === undefined ? "Not set (defaults to market value)" : fmtMoney(account.bookValue)] as [string, string]] : []),
      ["Equity", fmtPercent(account.assetMix?.equity)], ["Bonds", fmtPercent(account.assetMix?.bond)], ["Investment cash", fmtPercent(account.assetMix?.cash)],
    ];
  return <ReadOnlyItemCard title={account.name || `${label} account`} badge={label} primaryLabel="Current balance" primaryValue={fmtMoney(account.balance)} details={details} editing={editing} onEdit={onEdit} />;
}

function AssetSummary({ asset, editing, onEdit }: { asset: AssetPlan; editing: boolean; onEdit: () => void }) {
  const kind = ASSET_KIND_LABELS[asset.kind];
  const details: [string, string][] = [["Annual appreciation", fmtPercent(asset.appreciationRate)]];
  details.push(["Planned sale", asset.sellEvent ? `Age ${asset.sellEvent.age} · ${fmtPercent(asset.sellEvent.costsPct)} costs` : "None"]);
  return <ReadOnlyItemCard title={asset.name || kind} badge={kind} primaryLabel="Current value" primaryValue={fmtMoney(asset.value)} details={details} editing={editing} onEdit={onEdit} />;
}

function DebtSummary({ debt, editing, onEdit }: { debt: DebtPlan; editing: boolean; onEdit: () => void }) {
  const frequency = FREQUENCY_LABELS[debt.paymentFrequency ?? "monthly"].replace(/\s+\([^)]*\)/, "");
  return <ReadOnlyItemCard title="Mortgage" badge="Debt" primaryLabel="Balance" primaryValue={fmtMoney(debt.balance)} details={[
    ["Interest rate", fmtPercent(debt.rate)], ["Payment", `${fmtMoney(debt.monthlyPayment)} · ${frequency}`],
    ["Term", `${debt.termYears} years`], ["Amortization", `${debt.amortizationYears} years`],
  ]} editing={editing} onEdit={onEdit} />;
}

function IncomeSummary({ income, editing, onEdit }: { income: IncomePlan; editing: boolean; onEdit: () => void }) {
  const kind = INCOME_LABELS[income.kind];
  return <ReadOnlyItemCard title={income.name || kind} badge={kind} primaryLabel="Configured annual amount" primaryValue={fmtMoney(income.annualAmount)} details={[
    ["Active ages", `${income.startAge}–${income.endAge ?? "ongoing"}`], ["Annual raise / indexing", fmtPercent(income.raiseRate)],
  ]} editing={editing} onEdit={onEdit} />;
}

function ExpenseSummary({ expense, editing, onEdit }: { expense: ExpensePlan; editing: boolean; onEdit: () => void }) {
  return <ReadOnlyItemCard title={expense.name || "Expense"} badge="Spending" primaryLabel="Annual amount" primaryValue={fmtMoney(expense.annualAmount)} details={[
    ["Active ages", `${expense.startAge}–${expense.endAge ?? "ongoing"}`], ["Annual inflation", fmtPercent(expense.inflationRate)],
  ]} editing={editing} onEdit={onEdit} />;
}

function SavingsSummary({ step, editing, onEdit }: { step: SavingsPolicyStep; editing: boolean; onEdit: () => void }) {
  const details: [string, string][] = [["Priority", String(step.priority)], ["Active through age", step.untilAge === undefined ? "No age limit" : String(step.untilAge)]];
  if (step.target === "rrsp-match") details.push(["Employer match", step.matchRate === undefined ? "Not set (defaults to 0%)" : fmtPercent(step.matchRate)]);
  return <ReadOnlyItemCard title={`Savings step ${step.priority}`} badge={SAVINGS_TARGET_LABELS[step.target]} primaryLabel="Annual cap" primaryValue={step.perYearCap === undefined ? "No cap" : fmtMoney(step.perYearCap)} details={details} editing={editing} onEdit={onEdit} />;
}

function AccountsEditor() {
  const { workspace, dispatch } = useWorkspace(); const items = workspace.plan.accounts;
  const editors = useInlineEditors();
  const add = () => { const id = addFromDraft(dispatch, "accounts", newAccountDraft(), readAccountDraft); if (id) editors.open(id); };
  return <section className="plan-panel"><div className="plan-section-heading"><div><h2>Accounts</h2><p>Balances, account type, and investments. Cash accounts earn their own fixed interest rate.</p></div><button type="button" onClick={add}>Add account</button></div>
    {items.map(item => <div className="plan-item-entry" key={item.id}>
      <AccountSummary account={item} editing={editors.isOpen(item.id)} onEdit={() => editors.toggle(item.id)} />
      {editors.isOpen(item.id) && <AccountForm account={item} onApply={value => dispatch({ type: "plan/updateItem", section: "accounts", id: item.id, patch: value })} onRemove={() => { dispatch({ type: "plan/removeItem", section: "accounts", id: item.id }); editors.close(item.id); }} />}
    </div>)}
    {!items.length && <p className="plan-empty">No accounts yet. Add a TFSA, RRSP, non-registered, or cash account.</p>}
  </section>;
}

function AssetsDebtsEditor() {
  const { workspace, dispatch } = useWorkspace(); const { assets, debts } = workspace.plan;
  const assetEditors = useInlineEditors();
  const debtEditors = useInlineEditors();
  const addAsset = () => { const id = addFromDraft(dispatch, "assets", newAssetDraft(), readAssetDraft); if (id) assetEditors.open(id); };
  const addDebt = () => { const id = addFromDraft(dispatch, "debts", newDebtDraft(), readDebtDraft); if (id) debtEditors.open(id); };
  return <section className="plan-panel">
    <div className="plan-section-heading"><div><h2>Assets</h2><p>Homes and other assets, including optional sale events.</p></div><button type="button" onClick={addAsset}>Add asset</button></div>
    {assets.map(item => <div className="plan-item-entry" key={item.id}><AssetSummary asset={item} editing={assetEditors.isOpen(item.id)} onEdit={() => assetEditors.toggle(item.id)} />
      {assetEditors.isOpen(item.id) && <AssetForm asset={item} onApply={value => dispatch({ type: "plan/updateItem", section: "assets", id: item.id, patch: value })} onRemove={() => { dispatch({ type: "plan/removeItem", section: "assets", id: item.id }); assetEditors.close(item.id); }} />}
    </div>)}
    {!assets.length && <p className="plan-empty">No assets yet.</p>}
    <div className="plan-section-heading plan-subsection"><div><h2>Debts</h2><p>Mortgage rate, term, amortization, and payment.</p></div><button type="button" onClick={addDebt} disabled={debts.length > 0}>Add mortgage</button></div>
    {debts.map(item => <div className="plan-item-entry" key={item.id}><DebtSummary debt={item} editing={debtEditors.isOpen(item.id)} onEdit={() => debtEditors.toggle(item.id)} />
      {debtEditors.isOpen(item.id) && <DebtForm debt={item} onApply={value => dispatch({ type: "plan/updateItem", section: "debts", id: item.id, patch: value })} onRemove={() => { dispatch({ type: "plan/removeItem", section: "debts", id: item.id }); debtEditors.close(item.id); }} />}
    </div>)}
    {!debts.length && <p className="plan-empty">No mortgage added.</p>}
  </section>;
}

/** Full plan editor; mounted by the app shell at the Plan route. */
export function PlanView() {
  const { clearEditNotice } = useWorkspace();
  const [activeTab, setActiveTab] = useState<Tab>("Profile");
  return <div className="plan-view" onChangeCapture={clearEditNotice}>
    <div className="plan-view-header"><div><span className="eyebrow">YOUR FINANCIAL PICTURE</span><h1>Plan</h1><p className="plan-help">Edit your starting profile, accounts, income, spending, and savings rules.</p></div></div>
    <div className="plan-tabs" role="tablist" aria-label="Plan sections">
      {TABS.map(tab => <button key={tab} type="button" role="tab" id={`plan-tab-${tab.replaceAll(" ", "-").toLowerCase()}`} aria-selected={activeTab === tab} aria-controls="plan-tabpanel" onClick={() => setActiveTab(tab)}>{tab}</button>)}
    </div>
    <div role="tabpanel" id="plan-tabpanel" aria-labelledby={`plan-tab-${activeTab.replaceAll(" ", "-").toLowerCase()}`}>
      {activeTab === "Profile" && <ProfileEditor />}
      {activeTab === "Accounts" && <AccountsEditor />}
      {activeTab === "Assets & debts" && <AssetsDebtsEditor />}
      {activeTab === "Income" && <IncomesEditor />}
      {activeTab === "Expenses" && <ExpensesEditor />}
      {activeTab === "Savings" && <SavingsEditor />}
    </div>
  </div>;
}

function IncomesEditor() {
  const { workspace, dispatch, baseScenario } = useWorkspace(); const items = workspace.plan.incomes;
  const editors = useInlineEditors();
  const add = (kind: IncomePlan["kind"]) => { const id = addFromDraft(dispatch, "incomes", newIncomeDraft(kind, workspace.plan.profile.currentAge, baseScenario.retirementAge), readIncomeDraft); if (id) editors.open(id); };
  return <section className="plan-panel"><div className="plan-section-heading"><div><h2>Income</h2><p>Enter taxable income and the ages when each stream starts and ends. End age is optional.</p></div>
    <div className="plan-add-buttons">{(["employment", "cpp", "oas", "other"] as const).map(kind => <button key={kind} type="button" onClick={() => add(kind)}>Add {kind}</button>)}</div></div>
    {items.map(item => <div className="plan-item-entry" key={item.id}><IncomeSummary income={item} editing={editors.isOpen(item.id)} onEdit={() => editors.toggle(item.id)} />
      {editors.isOpen(item.id) && <IncomeForm income={item} onApply={value => dispatch({ type: "plan/updateItem", section: "incomes", id: item.id, patch: value })} onRemove={() => { dispatch({ type: "plan/removeItem", section: "incomes", id: item.id }); editors.close(item.id); }} />}
    </div>)}
    {!items.length && <p className="plan-empty">No income streams yet.</p>}
  </section>;
}

function ExpensesEditor() {
  const { workspace, dispatch } = useWorkspace(); const items = workspace.plan.expenses;
  const editors = useInlineEditors();
  const add = () => { const id = addFromDraft(dispatch, "expenses", newExpenseDraft(workspace.plan.profile.currentAge), readExpenseDraft); if (id) editors.open(id); };
  return <section className="plan-panel"><div className="plan-section-heading"><div><h2>Expenses</h2><p>Annual spending, active years, and the inflation rate.</p></div><button type="button" onClick={add}>Add expense</button></div>
    {items.map(item => <div className="plan-item-entry" key={item.id}><ExpenseSummary expense={item} editing={editors.isOpen(item.id)} onEdit={() => editors.toggle(item.id)} />
      {editors.isOpen(item.id) && <ExpenseForm expense={item} onApply={value => dispatch({ type: "plan/updateItem", section: "expenses", id: item.id, patch: value })} onRemove={() => { dispatch({ type: "plan/removeItem", section: "expenses", id: item.id }); editors.close(item.id); }} />}
    </div>)}
    {!items.length && <p className="plan-empty">No expenses yet.</p>}
  </section>;
}

function SavingsEditor() {
  const { workspace, dispatch } = useWorkspace(); const items = workspace.plan.savingsPolicy;
  const editors = useInlineEditors();
  const add = () => { const id = addFromDraft(dispatch, "savingsPolicy", newSavingsDraft(items.length + 1), readSavingsDraft); if (id) editors.open(id); };
  return <section className="plan-panel"><div className="plan-section-heading"><div><h2>Savings policy</h2><p>Order savings steps by priority. A TFSA/RRSP contribution uses available room.</p></div><button type="button" onClick={add}>Add savings step</button></div>
    {items.map(item => <div className="plan-item-entry" key={item.id}><SavingsSummary step={item} editing={editors.isOpen(item.id)} onEdit={() => editors.toggle(item.id)} />
      {editors.isOpen(item.id) && <SavingsForm step={item} onApply={value => dispatch({ type: "plan/updateItem", section: "savingsPolicy", id: item.id, patch: value })} onRemove={() => { dispatch({ type: "plan/removeItem", section: "savingsPolicy", id: item.id }); editors.close(item.id); }} />}
    </div>)}
    {!items.length && <p className="plan-empty">No savings steps yet. Unallocated surplus goes to non-registered savings when available.</p>}
  </section>;
}
