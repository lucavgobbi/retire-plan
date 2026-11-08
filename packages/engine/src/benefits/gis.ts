import type { TaxYearTables } from "../tax/tables";

/**
 * The year's income inputs to the GIS (Guaranteed Income Supplement) eligibility test.
 *
 * GIS counts a specific set of income (not the tax definition of income!): CPP/RRIF/RRSP
 * withdrawals, other taxable income, and employment income after the first-tier exemption.
 * TFSA withdrawals are NOT GIS income — they must not reduce GIS (Review Focus #1).
 */
export interface GisIncomeSources {
  cpp: number;
  rrspRrifWithdrawals: number;
  employmentIncome: number;
  otherTaxableIncome: number;
  tfsaWithdrawals: number;
}

const GIS_ELIGIBILITY_AGE = 65;

/**
 * Annual GIS for a single senior at `age` (spouses/couples are a fast-follow; the table
 * carries the single maximum only).
 *
 *   gisIncome = cpp + rrspRrifWithdrawals + otherTaxableIncome
 *                + max(0, employmentIncome - exclusionEmployment)
 *
 * `tfsaWithdrawals` are excluded entirely (TFSA money is invisible to GIS income tests).
 *
 *   annual = max(0, annualMaxSingle - taperRate x gisIncome) for age >= 65, else 0.
 *
 * v1 simplification (documented in SOURCES.md): only the first employment-income exemption
 * tier ($5,000, fully exempt) is modeled; the 50% band of employment income between $5,000
 * and $15,000 is a fast-follow, per ESDC footnote. Quarterly top-up mechanics are absorbed
 * into the annualized maximum (includes top-ups, per the ESDC maximum footnote).
 */
export function gisAnnual(age: number, income: GisIncomeSources, tables: TaxYearTables): number {
  if (age < GIS_ELIGIBILITY_AGE) return 0;
  const gisIncome =
    income.cpp +
    income.rrspRrifWithdrawals +
    income.otherTaxableIncome +
    Math.max(0, income.employmentIncome - tables.gis.exclusionEmployment);
  const reduction = tables.gis.taperRate * Math.max(0, gisIncome);
  return Math.max(0, tables.gis.annualMaxSingle - reduction);
}
