import type { TaxYearTables } from "./tables";
import { progressiveGrossTax, taxableIncome, type IncomeForTax } from "./federal";

export interface OntarioTaxResult {
  /** Ontario tax on taxable income after non-refundable credits, before surtax. */
  tax: number;
  /** Ontario surtax computed on `tax` (the "basic provincial tax payable"). */
  surtax: number;
  /** `tax + surtax`. */
  total: number;
  /** Taxable income used. */
  taxable: number;
}

/**
 * Ontario surtax over the ladders stored in the table. Thresholds are dollar amounts of
 * *basic Ontario tax* ($5,818 and $7,446 for 2026 — see SOURCES.md; the schema field name
 * `onTaxOverPctOfTaxable` is kept verbatim for plan compatibility). Each ladder applies its
 * rate to the excess of the base over the threshold only:
 *
 *   surtax = Σ_ladders rate_l x max(0, onBase - threshold_l)
 *
 * For 2026 that is 20% of base tax over $5,818 **plus** 36% of base tax over $7,446 — the
 * official total above tier B is 56% (it lifts the top 13.16% bracket to 20.53%), per
 * CRA Payroll Tables T4032-ON. `taxable` is accepted per the plan's pinned signature; the
 * CRA surtax base is the tax-dollar base, so it is not used by the ladder math itself.
 */
export function ontarioSurtax(onBase: number, taxable: number, tables: TaxYearTables): number {
  void taxable;
  let surtax = 0;
  for (const ladder of tables.ontario.surtax) {
    surtax += ladder.rate * Math.max(0, onBase - ladder.onTaxOverPctOfTaxable);
  }
  return surtax;
}

/**
 * Ontario tax for the year.
 *
 * Flow mirrors the ON428 ordering: progressive tax on taxable income, minus non-refundable
 * credits (v1 stack: lowest-ON-rate x Ontario BPA), then the surtax is computed on that
 * "basic provincial tax payable" (credits reduce the surtax base; dividend credits would
 * apply after it but are not modeled in v1 — see docs/assumptions.md when it ships).
 */
export function ontarioTax(income: IncomeForTax, tables: TaxYearTables): OntarioTaxResult {
  const taxable = taxableIncome(income);
  const brackets = tables.ontario.brackets;
  if (brackets.length === 0 || brackets[0]!.threshold !== 0) {
    throw new Error("ontario table brackets must start with a threshold-0 bracket (loadTables enforces this).");
  }
  const lowestRate = brackets[0]!.rate;
  const gross = progressiveGrossTax(taxable, brackets);
  const tax = Math.max(0, gross - lowestRate * tables.ontario.basicPersonalAmount);
  const surtax = ontarioSurtax(tax, taxable, tables);
  return { tax, surtax, total: tax + surtax, taxable };
}
