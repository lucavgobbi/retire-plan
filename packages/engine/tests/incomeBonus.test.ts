import { describe, expect, it } from "vitest";
import tablesJson from "../data/tax/ca-2026.json";
import { loadTables, type TaxYearTables } from "../src/tax/tables";
import { buildDeterministicReturns } from "../src/returns/deterministic";
import { federalTax } from "../src/tax/federal";
import { ontarioTax } from "../src/tax/ontario";
import { simulate } from "../src/simulate";
import { validatePlan, type IncomePlan, type Plan, type ReturnSeries, type Scenario } from "../src/types";

const tables: TaxYearTables = loadTables(tablesJson);

const ZERO_RETURNS = { equity: 0, bond: 0, cash: 0 };

function detScenario(): Scenario {
  return {
    id: "det",
    name: "Deterministic",
    simMode: "deterministic",
    retirementAge: 65,
    returnAssumptions: ZERO_RETURNS,
    withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
  };
}

function detReturns(startAge: number, endAge: number): ReturnSeries {
  return buildDeterministicReturns(ZERO_RETURNS, startAge, endAge);
}

/** Small solvent plan: one employment stream, one flat expense, no savings policy. */
function salaryPlan(bonusRate?: number): Plan {
  const salary: IncomePlan = {
    id: "salary",
    kind: "employment",
    annualAmount: 50_000,
    startAge: 45,
    endAge: 47,
    raiseRate: 0.02,
  };
  if (bonusRate !== undefined) salary.bonusRate = bonusRate;
  return {
    profile: { birthYear: 1981, currentAge: 45, province: "ON", endAge: 50 },
    accounts: [],
    assets: [],
    debts: [],
    incomes: [salary],
    expenses: [{ id: "living", annualAmount: 30_000, startAge: 45, inflationRate: 0 }],
    savingsPolicy: [],
  };
}

function yearOf(plan: Plan, age: number) {
  const years = simulate(plan, detScenario(), detReturns(plan.profile.currentAge, plan.profile.endAge)).years;
  return years.find((y) => y.age === age)!;
}

describe("employment bonus rate (engine)", () => {
  it("adds the bonus to the raised base and counts it once in employment income", () => {
    // Age 45: base 50,000 (no raise yet), bonus 5,000. Age 46: base 51,000 after the
    // 2% raise, bonus 5,100 — the bonus rides on the post-raise amount.
    expect(yearOf(salaryPlan(0.1), 45).income.employment).toBe(55_000);
    expect(yearOf(salaryPlan(0.1), 46).income.employment).toBe(56_100);
  });

  it("treats an absent bonusRate as legacy (no bonus) and 0 identically", () => {
    const without = simulate(salaryPlan(), detScenario(), detReturns(45, 50));
    const zero = simulate(salaryPlan(0), detScenario(), detReturns(45, 50));
    expect(zero.years).toEqual(without.years);
    expect(without.years.find((y) => y.age === 45)!.income.employment).toBe(50_000);
  });

  it("stops the bonus when the stream ends; CPP/OAS/other income is untouched", () => {
    const plan = salaryPlan(0.1);
    expect(yearOf(plan, 47).income.employment).toBeCloseTo(50_000 * 1.02 ** 2 * 1.1, 6);
    expect(yearOf(plan, 48).income.employment).toBe(0);
    expect(yearOf(plan, 48).income.cpp).toBe(0);
    expect(yearOf(plan, 48).income.oas).toBe(0);
    expect(yearOf(plan, 48).income.other).toBe(0);
  });

  it("routes the bonus through the existing tax rules as employment income", () => {
    // Surplus year with no withdrawals: the reported tax is the full-year tax on the
    // base income shape — the bonus must be inside employmentIncome for it.
    const incomeShape = {
      employmentIncome: 55_000,
      otherTaxableIncome: 0,
      rrspWithdrawals: 0,
      pensionEligibleIncome: 0,
      capitalGains: 0,
      dividendsEligible: 0,
      age: 45,
    };
    const expected = federalTax(incomeShape, tables).tax + ontarioTax(incomeShape, tables).total;
    const year = yearOf(salaryPlan(0.1), 45);
    expect(year.tax.total).toBe(Math.round(expected * 100) / 100);
    // And strictly more than the same year without the bonus.
    expect(year.tax.total).toBeGreaterThan(yearOf(salaryPlan(), 45).tax.total);
  });

  it("earns RRSP contribution room on the base-plus-bonus employment income", () => {
    // No savings policy, no employer match: room earned = 18% of employment income.
    const withBonus = yearOf(salaryPlan(0.1), 45);
    expect(withBonus.rrspRoom).toBe(Math.round(Math.min(tables.rrsp.incomeRate * 55_000, tables.rrsp.annualLimit) * 100) / 100);
    expect(withBonus.rrspRoom).toBeGreaterThan(yearOf(salaryPlan(), 45).rrspRoom);
  });

  it("feeds the bonus into the GIS employment-income test (after the $5,000 exemption)", () => {
    // Age-65-only employment: 5,000 base is fully exempt; +10% bonus = 500 counts.
    const basePlan: Plan = {
      ...salaryPlan(),
      profile: { birthYear: 1981, currentAge: 65, province: "ON", endAge: 70 },
      incomes: [{ id: "salary", kind: "employment", annualAmount: 5_000, startAge: 65, endAge: 70, raiseRate: 0 }],
      expenses: [{ id: "living", annualAmount: 0, startAge: 65, inflationRate: 0 }],
    };
    const bonusPlan: Plan = {
      ...basePlan,
      incomes: [{ ...basePlan.incomes[0]!, bonusRate: 0.1 }],
    };
    const base = yearOf(basePlan, 65);
    const bonus = yearOf(bonusPlan, 65);
    expect(base.income.gis).toBeGreaterThan(0);
    expect(base.income.gis - bonus.income.gis).toBeCloseTo(tables.gis.taperRate * 500, 6);
  });
});

describe("bonusRate validation", () => {
  it("rejects negative and non-finite bonus rates", () => {
    for (const bad of [-0.1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const errors = validatePlan(salaryPlan(bad));
      expect(errors.some((e) => e.includes("salary") && e.includes("bonusRate"))).toBe(true);
    }
  });

  it("rejects bonusRate on non-employment income kinds", () => {
    const plan = salaryPlan();
    plan.incomes = [{ id: "pension", kind: "cpp", annualAmount: 10_000, startAge: 65, raiseRate: 0, bonusRate: 0.1 }];
    const errors = validatePlan(plan);
    expect(errors.some((e) => e.includes("pension") && e.includes("bonusRate") && e.includes("employment"))).toBe(true);
  });

  it("accepts finite rates of any size (0, fractions, and above 100%)", () => {
    expect(validatePlan(salaryPlan(0))).toEqual([]);
    expect(validatePlan(salaryPlan(0.5))).toEqual([]);
    expect(validatePlan(salaryPlan(1.5))).toEqual([]);
  });
});
