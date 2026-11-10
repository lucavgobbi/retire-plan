import type { TaxYearTables } from "./tables";

/**
 * The year's income assembled for tax computation (Ontario/federal taxpayers, v1).
 *
 * Field contract:
 *  - `employmentIncome`: taxable employment income (T4-style).
 *  - `rrspWithdrawals`: taxable RRSP/RRIF withdrawals, counted at face value.
 *  - `otherTaxableIncome`: every other taxable dollar (CPP, OAS, etc.) not covered above.
 *  - `pensionEligibleIncome`: the portion of the amounts above that qualifies for the
 *    federal pension income amount (superannuation/RRIF income). IMPORTANT: it is an
 *    annotation of a subset already counted in the taxable fields — it is NOT an extra
 *    taxable source, and `taxableIncome` must not add it again.
 *  - `capitalGains`: realized taxable capital gains; 50% inclusion.
 *  - `dividendsEligible`: must be 0 in v1 (gross-up/credit modeling off); > 0 throws here
 *    so the stepper surfaces it as a plan-level error upstream.
 *  - `age`: the taxpayer's age for the year (drives the age amount).
 */
export interface IncomeForTax {
  employmentIncome: number;
  otherTaxableIncome: number;
  rrspWithdrawals: number;
  pensionEligibleIncome: number;
  capitalGains: number;
  dividendsEligible: number;
  age: number;
}

const CAPITAL_GAINS_INCLUSION = 0.5; // ITA s.38: half of taxable capital gains are taxable.
const AGE_CREDIT_ELIGIBILITY = 65;

interface RateBracket {
  threshold: number;
  rate: number;
}

/**
 * Taxable income = all taxable sources + capital gains at 50%; eligible dividends assert 0.
 * `pensionEligibleIncome` is a subset annotation of other fields and is not added here.
 */
export function taxableIncome(income: IncomeForTax): number {
  if (income.dividendsEligible !== 0) {
    throw new Error(
      `dividendsEligible must be 0 in v1 (dividend gross-up/credit is off); got ${income.dividendsEligible}. Report this plan setup — eligible dividends are not modeled.`,
    );
  }
  return (
    income.employmentIncome +
    income.otherTaxableIncome +
    income.rrspWithdrawals +
    Math.max(0, income.capitalGains) * CAPITAL_GAINS_INCLUSION
  );
}

/** Progressive gross tax over ascending threshold/rate brackets (first threshold must be 0). */
export function progressiveGrossTax(taxable: number, brackets: RateBracket[]): number {
  let gross = 0;
  for (let i = 0; i < brackets.length; i++) {
    const lower = brackets[i]!.threshold;
    const rate = brackets[i]!.rate;
    const upper = i + 1 < brackets.length ? brackets[i + 1]!.threshold : Number.POSITIVE_INFINITY;
    if (taxable <= lower) break;
    const inBracket = Math.min(taxable, upper) - lower;
    if (inBracket > 0) gross += inBracket * rate;
  }
  return gross;
}

export interface FederalTaxResult {
  /** Final federal tax after non-refundable credits, floored at 0. */
  tax: number;
  /** Taxable income used for the bracket math. */
  taxable: number;
  /** Total non-refundable credits (already converted to tax dollars). */
  credits: number;
  /** Tax before credits. */
  grossTax: number;
}

/**
 * Federal tax for the year.
 *
 * Credit stack (converted to tax dollars at the lowest bracket rate, per ITA s.117(2)):
 *   lowest rate x (BPA + employment amount + age amount after reduction
 *                  + pension income amount + CPP/OAS credits — assumed fully consumed in v1)
 * Tax floor is 0.
 *
 * Reduction measures use the computed taxable income as the net-income proxy (v1 has no
 * deductions to model), and the age amount reduces per the Federal Worksheet 5000-D1
 * chart: max(0, amount - reductionRate x max(0, netIncome - threshold)), gated at 65+.
 * The pension income amount is min(table amount, eligible pension income) — current law
 * (verified on the official worksheet) has no income phase-out (see SOURCES.md).
 */
export function federalTax(income: IncomeForTax, tables: TaxYearTables): FederalTaxResult {
  const taxable = taxableIncome(income);
  const brackets = tables.federal.brackets;
  if (brackets.length === 0 || brackets[0]!.threshold !== 0) {
    throw new Error("federal table brackets must start with a threshold-0 bracket (loadTables enforces this).");
  }
  const lowestRate = brackets[0]!.rate;
  const grossTax = progressiveGrossTax(taxable, brackets);

  const employmentAmount = Math.min(income.employmentIncome, tables.federal.employmentCreditAmount);

  let ageAmount = 0;
  if (income.age >= AGE_CREDIT_ELIGIBILITY) {
    const excess = Math.max(0, taxable - tables.federal.ageCredit.reductionThreshold);
    ageAmount = Math.max(0, tables.federal.ageCredit.amount - tables.federal.ageCredit.reductionRate * excess);
  }

  const pensionAmount = Math.min(
    tables.federal.pensionIncomeCredit.amount,
    Math.max(0, income.pensionEligibleIncome),
  );

  const creditable = Math.max(
    0,
    tables.federal.basicPersonalAmount + employmentAmount + ageAmount + pensionAmount,
  );
  const credits = lowestRate * creditable;

  const tax = Math.max(0, grossTax - credits);
  return { tax, taxable, credits, grossTax };
}
