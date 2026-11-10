/**
 * INDEPENDENT reference calculator (plan Task 15). Mirrors the DOCUMENTED
 * formulas fed by the pinned sample plan for the first years of projection —
 * it shares NO arithmetic code with the engine. If the engine drifts, this
 * reference must be re-derived consciously.
 *
 * Covers only mechanics exercised in the golden years (all working-age years:
 * employment income only, deficit funded by TFSA draws, no RRIF, no policy
 * surplus, no home sale, no GIS).
 */
import type { Plan } from "../../src/types";
import type { TaxYearTables } from "../../src/tax/tables";

const rc = (x: number): number => Math.round(x * 100) / 100;

interface FedOut { fed: number; on: number; onSurtax: number }

/** Federal + Ontario tax on a working-age employment-only income shape. */
function incomeTax(employment: number, tables: TaxYearTables, age: number): FedOut {
  // ---- Federal: bracket tax minus non-refundable credits at the LOWEST rate.
  let fedGross = 0;
  let prev = 0;
  for (const b of tables.federal.brackets) {
    if (employment > b.threshold) {
      fedGross += (Math.min(employment, nextThreshold(tables.federal.brackets, b.threshold)) - b.threshold) * b.rate;
    }
    prev = b.threshold;
  }
  const creditBase = tables.federal.basicPersonalAmount + tables.federal.employmentCreditAmount;
  const fed = Math.max(0, fedGross - tables.federal.brackets[0]!.rate * creditBase);

  // ---- Ontario: brackets, credits at its lowest rate, then the surtax ladder
  // (thresholds are dollar amounts OF basic Ontario tax).
  let onGross = 0;
  for (const b of tables.ontario.brackets) {
    if (employment > b.threshold) {
      const top = nextThreshold(tables.ontario.brackets, b.threshold);
      if (employment > b.threshold) onGross += (Math.min(employment, top) - b.threshold) * b.rate;
    }
  }
  const onBase = Math.max(0, onGross - tables.ontario.brackets[0]!.rate * tables.ontario.basicPersonalAmount);
  let onSurtax = 0;
  for (const s of tables.ontario.surtax) {
    if (onBase > s.onTaxOverPctOfTaxable) onSurtax += s.rate * (onBase - s.onTaxOverPctOfTaxable);
  }
  void age;
  return { fed: rc(fed), on: rc(onBase), onSurtax: rc(onSurtax) };
}

function nextThreshold(brackets: { threshold: number; rate: number }[], t: number): number {
  for (const b of brackets) if (b.threshold > t) return b.threshold;
  return Number.POSITIVE_INFINITY;
}

export interface GoldenYear {
  age: number;
  employment: number;
  expenses: number;
  taxTotal: number;
  tfsaDraw: number;
  tfsaEnd: number;
  rrspEnd: number;
  nonregEnd: number;
  homeEnd: number;
  debtEnd: number;
  netWorth: number;
}

/**
 * Runs the sample plan ages startAge..startAge+2 with the reference formulas.
 * Deficit branch only: draws from TFSA first (the only account above $0 need),
 * grows accounts at the blended 4% (0.7x5% + 0.25x2% + 0.05x0%).
 */
export function referenceGoldenYears(
  plan: Plan,
  tables: TaxYearTables,
  startAge: number,
  count: number,
): GoldenYear[] {
  const mortgage = plan.debts.find((d) => d.kind === "mortgage")!;
  const home = plan.assets.find((a) => a.kind === "primary-home")!;
  const salary = plan.incomes.find((i) => i.kind === "employment")!;
  const living = plan.expenses[0]!;
  const blend = 0.7 * 0.05 + 0.25 * 0.02 + 0.05 * 0; // 0.04

  const account = new Map<string, number>(
    plan.accounts.map((a) => [a.id, a.balance] as const),
  );
  let debt = mortgage.balance;
  let homeValue = home.value;
  const out: GoldenYear[] = [];

  for (let age = startAge; age < startAge + count; age++) {
    const employment = rc(salary.annualAmount * Math.pow(1 + salary.raiseRate, age - salary.startAge));
    const expenses = living.annualAmount * Math.pow(1 + living.inflationRate, age - living.startAge);
    const t = incomeTax(employment, tables, age);
    const taxTotal = rc(t.fed + t.on + t.onSurtax);

    let tfsa = account.get("tfsa")!;
    let rrsp = account.get("rrsp")!;
    let nonreg = account.get("nonreg")!;

    // Deficit: need = expenses + tax + 12 mortgage payments - employment income.
    // Mortgage: monthly loop (nominal monthly compounding), clamped final payment.
    let balance = debt;
    for (let m = 0; m < 12 && balance > 0; m++) {
      const interest = balance * (mortgage.rate / 12);
      const payment = Math.min(mortgage.monthlyPayment, balance + interest);
      balance = Math.max(0, balance + interest - payment);
    }
    const debtEnd = balance;
    const mortgageCash = 12 * mortgage.monthlyPayment; // no payoff year in range

    const need = expenses + taxTotal + mortgageCash - employment;
    const tfsaDraw = Math.max(0, need); // TFSA first; never dry in these years and stays < need
    tfsa -= tfsaDraw;
    tfsa = rc(tfsa * (1 + blend));
    rrsp = rc(rrsp * (1 + blend));
    nonreg = rc(nonreg * (1 + blend)); // ACB absorbs growth — not exercised in the pins
    homeValue = rc(homeValue * (1 + home.appreciationRate));

    out.push({
      age,
      employment,
      expenses: rc(expenses),
      taxTotal,
      tfsaDraw: rc(tfsaDraw),
      tfsaEnd: tfsa,
      rrspEnd: rrsp,
      nonregEnd: nonreg,
      homeEnd: homeValue,
      debtEnd: rc(debtEnd),
      netWorth: rc(tfsa + rrsp + nonreg + homeValue - debtEnd),
    });
    account.set("tfsa", tfsa);
    account.set("rrsp", rrsp);
    account.set("nonreg", nonreg);
    debt = debtEnd;
  }

  void plan; // types imported for shape alignment only
  return out;
}
