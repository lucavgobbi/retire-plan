import { describe, expect, it } from "vitest";
import { buildDeterministicReturns, simulate, validatePlan, type Plan, type Scenario } from "../src";

const returns = { equity: 0, bond: 0, cash: 0 };
const returnsAsCash = { equity: 0, bond: 0, cash: 1 };
const scenario: Scenario = {
  id: "base",
  name: "Base",
  simMode: "deterministic",
  retirementAge: 62,
  returnAssumptions: returns,
  withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
};

function employmentPlan(): Plan {
  return {
    profile: { birthYear: 1966, currentAge: 60, endAge: 66, province: "ON" },
    accounts: [
      { id: "rrsp", type: "rrsp", balance: 0, assetMix: returnsAsCash },
      { id: "tfsa", type: "tfsa", balance: 0, assetMix: returnsAsCash },
    ],
    assets: [],
    debts: [],
    incomes: [
      {
        id: "linked",
        kind: "employment",
        annualAmount: 50_000,
        bonusRate: 0.1,
        startAge: 60,
        endAtRetirement: true,
        raiseRate: 0,
      },
      { id: "fixed", kind: "employment", annualAmount: 6_000, startAge: 60, endAge: 64, raiseRate: 0 },
      { id: "cpp", kind: "cpp", annualAmount: 12_000, startAge: 63, raiseRate: 0 },
      { id: "oas", kind: "oas", annualAmount: 8_000, startAge: 65, raiseRate: 0 },
    ],
    expenses: [{ id: "living", annualAmount: 8_000, startAge: 60, inflationRate: 0 }],
    savingsPolicy: [
      { id: "match", priority: 1, target: "rrsp-match", perYearCap: 2_000, matchRate: 0.5 },
      { id: "tfsa", priority: 2, target: "tfsa", perYearCap: 3_000 },
    ],
  };
}

function project(plan: Plan, retirementAge: number) {
  const series = buildDeterministicReturns(returns, plan.profile.currentAge, plan.profile.endAge);
  const result = simulate(plan, { ...scenario, retirementAge }, series);
  return (age: number) => result.years.find((year) => year.age === age)!;
}

describe("retirement-linked employment", () => {
  it("moves salary and bonus with each scenario age while keeping fixed wages, benefits and expenses on their schedules", () => {
    const plan = employmentPlan();
    const early = project(plan, 62);
    const late = project(plan, 66);
    expect(early(61).income.employment).toBe(61_000);
    expect(early(62).income.employment).toBe(6_000);
    expect(late(62).income.employment).toBe(61_000);
    expect(late(62).taxableIncome - early(62).taxableIncome).toBe(55_000);
    expect(late(62).tax.total).toBeGreaterThan(early(62).tax.total);
    expect(late(62).netWorth).toBeGreaterThan(early(62).netWorth);
    expect(early(64).income.employment).toBe(6_000);
    expect(early(65).income.employment).toBe(0);
    expect(late(65).income.employment).toBe(55_000);
    expect(late(66).income.employment).toBe(0);
    expect(late(65).income.cpp).toBe(early(65).income.cpp);
    expect(late(65).income.oas).toBe(early(65).income.oas);
    expect(late(65).expenses).toBe(early(65).expenses);
    expect(early(65).contributions.tfsa).toBe(3_000);
    expect(early(65).contributions.rrsp).toBe(2_000);
    expect(early(65).income.other).toBe(0);
    expect(late(65).income.other).toBe(1_000);
  });

  it("keeps legacy ongoing and explicit fixed schedules independent of retirement", () => {
    const plan = employmentPlan();
    delete plan.incomes[0]!.endAtRetirement;
    expect(project(plan, 62)(66).income.employment).toBe(55_000);
    plan.incomes[0]!.endAge = 63;
    expect(project(plan, 60)(63).income.employment).toBe(61_000);
    expect(project(plan, 66)(64).income.employment).toBe(6_000);
  });

  it("keeps employer matching while a fixed job pays after linked employment ends", () => {
    const year = project(employmentPlan(), 62)(64);
    expect(year.income.employment).toBe(6_000);
    expect(year.income.other).toBe(1_000);
    expect(year.contributions.rrsp).toBe(3_000);
  });

  it("does not redeposit a proactive RRSP draw when wages end and contribution room remains", () => {
    const plan = employmentPlan();
    plan.accounts[0]!.balance = 300_000;
    const series = buildDeterministicReturns(returns, plan.profile.currentAge, plan.profile.endAge);
    const result = simulate(plan, { ...scenario, withdrawalStrategy: "tax-minimizing" }, series, undefined, {
      strategy: "tax-minimizing",
      fillTargetTaxable: 45_000,
      byAge: [],
    });
    const year = result.years.find((row) => row.age === 65)!;
    expect(year.income.employment).toBe(0);
    expect(year.plannedRrspDraw).toBe(25_000);
    expect(year.withdrawals.rrsp).toBe(25_000);
    expect(year.rrspRoom).toBeGreaterThan(2_000);
    expect(year.income.other).toBe(0);
    expect(year.contributions.rrsp).toBe(0);
    expect(year.contributions.tfsa).toBe(3_000);
  });

  it("pays no linked salary when its first year is at or after retirement", () => {
    const plan = employmentPlan();
    plan.incomes[0]!.startAge = 62;
    expect(project(plan, 62)(62).income.employment).toBe(6_000);
  });

  it("requires a boolean, limits it to employment, and rejects competing linked and fixed schedules", () => {
    const plan = employmentPlan();
    const salary = plan.incomes[0]!;
    expect(validatePlan(plan)).toEqual([]);
    salary.endAge = 65;
    expect(validatePlan(plan)).toContain('Income "linked" cannot specify both endAtRetirement and a fixed endAge.');
    salary.endAtRetirement = false;
    expect(validatePlan(plan)).toEqual([]);
    plan.incomes[2]!.endAtRetirement = false;
    expect(validatePlan(plan)).toContain('Income "cpp" endAtRetirement is supported only for employment income.');
    const imported = JSON.parse(
      JSON.stringify(employmentPlan()).replace('"endAtRetirement":true', '"endAtRetirement":"true"'),
    ) as Plan;
    expect(validatePlan(imported)).toContain('Income "linked" endAtRetirement must be a boolean.');
  });
});
