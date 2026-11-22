import type { PayrollSettings, YearResult } from "../types";
import type { TaxYearTables } from "./tables";

const CPP_FIRST_AGE = 18;
const CPP_ELECTION_FIRST_AGE = 65;
const CPP_END_AGE = 70;

function roundCent(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/** Estimate annual employee withholding for one Ontario employer. */
export function annualPayroll(
  employment: number,
  cppIncome: number,
  age: number,
  settings: PayrollSettings | undefined,
  tables: TaxYearTables["payroll"],
  warnings: string[],
): NonNullable<YearResult["payroll"]> {
  const earnings = Math.max(0, employment);
  const cppAgeEligible = age >= CPP_FIRST_AGE && age < CPP_END_AGE;
  const electionAgeEligible = age >= CPP_ELECTION_FIRST_AGE && age < CPP_END_AGE;
  const elected = settings?.cppOptOut65to69 === true;
  const electedOut = elected && settings?.cpp === true && electionAgeEligible && cppIncome > 0;

  if (earnings > 0) {
    if (elected && !electedOut) {
      warnings.push(
        "CPP opt-out could not apply. It requires CPP payroll enabled, age 65–69, and active CPP retirement pension income.",
      );
    }
    if (!settings?.cpp && cppAgeEligible) warnings.push("CPP and CPP2 payroll deductions are off for this projection.");
    if (!settings?.ei) warnings.push("EI payroll deductions are off for this projection.");
    if (settings?.cpp || settings?.ei) {
      warnings.push(
        "Payroll assumes a single Ontario employer. CPP pension and post-retirement benefits require entered amounts. EI benefits are outside this calculation.",
      );
    }
    if (settings?.cpp && (age === CPP_FIRST_AGE || age === CPP_END_AGE || electedOut)) {
      warnings.push(
        "CPP uses whole projection years for birthday and election cutoffs. Actual payroll can change partway through the year.",
      );
    }
  }

  let cppBase = 0;
  let cppAdditional = 0;
  let cpp2 = 0;
  let ei = 0;
  let eiRefund = 0;
  if (tables && settings?.cpp && cppAgeEligible && !electedOut) {
    const band = Math.max(0, Math.min(earnings, tables.cppFirstCeiling) - tables.cppBasicExemption);
    const combinedRate = tables.cppBaseRate + tables.cppAdditionalRate;
    const cpp = roundCent(band * combinedRate);
    cppBase = roundCent(cpp * (tables.cppBaseRate / combinedRate));
    cppAdditional = roundCent(cpp - cppBase);
    cpp2 = roundCent(
      Math.max(0, Math.min(earnings, tables.cppSecondCeiling) - tables.cppFirstCeiling) * tables.cpp2Rate,
    );
  }
  if (tables && settings?.ei) {
    ei = roundCent(Math.min(earnings, tables.eiInsurableCeiling) * tables.eiRate);
    if (earnings <= tables.eiRefundEarningsLimit) eiRefund = ei;
  }
  return {
    cppBase,
    cppAdditional,
    cpp2,
    ei,
    total: roundCent(cppBase + cppAdditional + cpp2 + ei),
    enhancedCppDeduction: roundCent(cppAdditional + cpp2),
    eiRefund,
  };
}
