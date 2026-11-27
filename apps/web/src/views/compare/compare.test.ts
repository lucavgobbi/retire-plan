import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO_BASE } from "../../domain/defaults";
import { runScenario } from "../../domain/run";
import { resolveScenario } from "../../domain/scenario";
import type { RunRecord } from "../../domain/types";
import { makeSamplePlan } from "../projection/testFixtures";
import { computeComparison } from "./compare";

function fixture(): RunRecord {
  const plan = makeSamplePlan();
  plan.profile.endAge = 67;
  const scenario = resolveScenario(null, DEFAULT_SCENARIO_BASE);
  return {
    id: "base-run",
    planId: "plan-test",
    scenarioId: null,
    scenario,
    result: runScenario(plan, scenario).result,
    birthYear: plan.profile.birthYear,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("comparison metrics", () => {
  it("aligns lifetime taxes, withdrawals and end net worth by the shared years", () => {
    const base = fixture();
    const other = structuredClone(base);
    other.result.years = other.result.years.filter((row) => row.age >= 50 && row.age <= 66);
    other.result.summary.finalNetWorth = other.result.years.at(-1)!.netWorth;
    other.scenario.retirementAge = 66;
    const result = computeComparison([base, other], 1981);
    const [a, b] = result.columns;
    expect([result.start, result.retirementStart, result.end]).toEqual([2031, 2047, 2047]);
    expect(a!.actualEnd).toBe(2048);
    expect(a!.finalNetWorth).toBe(other.result.summary.finalNetWorth);
    expect(a!.points).toEqual(b!.points);
    expect(a!.points[0]?.x).toBe(2031);
    expect(a!.lifetimeTax).toBeCloseTo(other.result.years.reduce((total, year) => total + year.tax.total, 0));
    const { tfsa, rrsp, nonreg, cash = 0 } = other.result.years.at(-1)!.withdrawals;
    expect(a!.retirementWithdrawals).toBeCloseTo(tfsa + rrsp + nonreg + cash);
  });

  it("uses cash income streams, excluding employer deposits, account interest and transfers", () => {
    const record = fixture();
    const row = record.result.years.at(-1)!;
    record.result.years = [row];
    row.income = { employment: 10, cpp: 20, oas: 30, gis: 40, other: 100 };
    row.cashflow!.employerRrspMatch = 10;
    row.cashflow!.employerRrspContribution = 20;
    row.cashInterest = 1000;
    row.expenses = 1000;
    row.withdrawals = { tfsa: 300, rrsp: 400, nonreg: 500, cash: 600 };
    const compare = () => computeComparison([record], 1981).columns[0]!;
    expect(compare().retirementIncome).toBe(170);
    expect(compare().retirementWithdrawals).toBe(1800);
    delete row.cashflow;
    row.incomeBreakdown = [{ id: "stream", kind: "other", amount: 60 }];
    expect(compare().retirementIncome).toBe(100);
    delete row.incomeBreakdown;
    expect(compare().retirementIncome).toBeNull();
  });

  it("starts depletion at retirement and tracks shortfalls separately, including when retirement is beyond the horizon", () => {
    const record = fixture();
    const empty = { cash: 0, tfsa: 0, rrsp: 0, nonreg: 0, home: 100_000, debt: 2000 };
    record.result.years[0]!.balances = empty;
    record.result.years[0]!.shortfall = 1;
    record.result.years.at(-1)!.balances = empty;
    const compare = () => computeComparison([record], 1981).columns[0]!;
    expect(compare().depletion?.age).toBe(67);
    expect(compare().shortfall?.age).toBe(45);
    record.scenario.retirementAge = 68;
    expect(compare()).toMatchObject({ hasRetirementYear: false, retirementIncome: null, retirementWithdrawals: null });
    expect(compare().depletion).toBeUndefined();
  });
});
