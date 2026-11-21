import { describe, expect, it } from "vitest";
import type { Plan, Scenario, YearResult } from "@retire-plan/engine";
import { createDefaultPlan, DEFAULT_SCENARIO_BASE } from "../../../domain/defaults";
import { runDeterministic, runScenario } from "../../../domain/run";
import { aggregateCashflow, cashflowYears, type CashflowAmount } from "./cashflowData";

const scenario: Scenario = {
  ...DEFAULT_SCENARIO_BASE, id: "cashflow-test", name: "Cashflow test", simMode: "deterministic",
  returnAssumptions: { equity: 0, bond: 0, cash: 0 },
};
const from = (items: CashflowAmount[], id: string) => items.find((item) => item.id === id)?.cents ?? 0;
const year = (startYear: number, endYear = startYear) => ({ startYear, endYear });

function planAt(startAge = 45, endAge = startAge + 2): Plan {
  return { ...createDefaultPlan(), profile: { birthYear: 1981, currentAge: startAge, endAge, province: "ON" }, savingsPolicy: [] };
}

function withoutCashflow(row: YearResult): YearResult {
  const { cashflow, payroll, ...legacy } = row;
  return legacy;
}

describe("aggregateCashflow", () => {
  it("uses the inclusive household calendar range and counts idle cash at the two boundaries", () => {
    const plan = planAt();
    plan.assets.push({ id: "asset", kind: "other", value: 1_000, appreciationRate: 1, sellEvent: { age: 45, costsPct: 0.1 } });
    plan.expenses.push({ id: "bill", annualAmount: 150, startAge: 45, inflationRate: 0 });
    plan.savingsPolicy = [{ id: "cash", priority: 1, target: "cash", perYearCap: 75 }];
    const { years } = runDeterministic(plan, scenario);
    expect(cashflowYears(years, 1981)).toEqual([2026, 2027, 2028]);
    expect(years[0]?.cashflow).toMatchObject({ openingIdleCash: 0, closingIdleCash: 750, assetSaleToIdleCash: 900, cashContributionsToIdleCash: 75 });
    expect(years[1]?.cashflow).toMatchObject({ openingIdleCash: 750, closingIdleCash: 600 });

    const partial = aggregateCashflow(years, 1981, year(2027, 2028));
    expect(from(partial.sources, "opening-cash")).toBe(75_000);
    expect(from(partial.sources, "asset-sales")).toBe(0);
    expect(from(partial.uses, "closing-cash")).toBe(45_000);
    expect(from(partial.uses, "cash-contribution")).toBe(0);
    expect(partial.sourceCents).toBe(75_000);
    expect(partial.useCents).toBe(75_000);

    const full = aggregateCashflow(years, 1981, year(2026, 2028));
    expect(from(full.sources, "asset-sales")).toBe(90_000);
    expect(from(full.uses, "closing-cash")).toBe(45_000);
    expect(full.cashContributionsToIdleCash).toBe(22_500);
    expect(full.sourceCents).toBe(full.useCents);
  });

  it("tracks partial mortgage payoff, net payroll, named cash deposits and direct employer match", () => {
    const plan = planAt();
    plan.accounts.push({ id: "rrsp", type: "rrsp", balance: 0, assetMix: { equity: 0, bond: 0, cash: 1 } }, { id: "cash", type: "cash", balance: 1_000, interestRate: 0.05 });
    plan.incomes.push({ id: "job", kind: "employment", annualAmount: 60_000, startAge: 45, endAge: 45, raiseRate: 0 });
    plan.debts.push({ id: "mortgage", kind: "mortgage", rate: 0, termYears: 1, amortizationYears: 1, balance: 1_050, monthlyPayment: 100 });
    plan.savingsPolicy = [{ id: "match", target: "rrsp-match", priority: 1, perYearCap: 1_000, matchRate: 0.5 }, { id: "deposit", target: "cash", priority: 2, perYearCap: 500 }];
    const { years } = runDeterministic(plan, { ...scenario, payroll: { cpp: true, ei: true, cppOptOut65to69: false } });
    const row = years[0]!;
    expect(row.cashflow).toMatchObject({ scheduledMortgagePayment: 1_050, employerRrspMatch: 500, cashContributionsToIdleCash: 0 });
    expect(row.cashInterest).toBe(50);
    expect(row.income.other).toBe(500);
    expect(row.contributions.rrsp).toBe(1_500);
    const data = aggregateCashflow(years, 1981, year(2026));
    expect(data.sourceCents).toBe(6_000_000);
    expect(data.useCents).toBe(data.sourceCents);
    expect(from(data.sources, "other")).toBe(0);
    expect(from(data.uses, "scheduled-mortgage")).toBe(105_000);
    expect(from(data.uses, "payroll")).toBe(Math.round((row.payroll!.total - row.payroll!.eiRefund) * 100));
    expect(from(data.uses, "rrsp-contribution")).toBe(100_000);
    expect(from(data.uses, "cash-contribution")).toBe(50_000);
    expect(data.employerRrspMatch).toBe(50_000);
  });

  it("removes refunded EI from the payroll use", () => {
    const plan = planAt();
    plan.incomes.push({ id: "job", kind: "employment", annualAmount: 2_000, startAge: 45, raiseRate: 0 });
    const { years } = runDeterministic(plan, { ...scenario, payroll: { cpp: false, ei: true, cppOptOut65to69: false } });
    expect(years[0]?.payroll).toMatchObject({ ei: 32.60, eiRefund: 32.60 });
    const data = aggregateCashflow(years, 1981, year(2026));
    expect(from(data.uses, "payroll")).toBe(0);
    expect(data.sourceCents).toBe(200_000);
    expect(data.useCents).toBe(200_000);
  });

  it("counts sale proceeds routed to non-registered only when they are withdrawn", () => {
    const plan = planAt();
    plan.accounts.push({ id: "nonreg", type: "nonreg", balance: 0, assetMix: { equity: 0, bond: 0, cash: 1 } });
    plan.assets.push({ id: "asset", kind: "other", value: 100, appreciationRate: 0, sellEvent: { age: 45, costsPct: 0 } });
    plan.expenses.push({ id: "bill", annualAmount: 35, startAge: 45, inflationRate: 0 });
    const { years } = runDeterministic(plan, scenario);
    const data = aggregateCashflow(years, 1981, year(2026, 2028));
    expect(data.assetSaleToNonreg).toBe(10_000);
    expect(data.sources).toEqual([{ id: "nonreg-withdrawal", label: "Non-registered withdrawals", kind: "transfer", cents: 10_000 }]);
    expect(from(data.uses, "covered-bills")).toBe(3_000);
    expect(data.shortfallCents).toBe(500);
    expect(data.useCents).toBe(data.sourceCents);
    expect(data.obligations[0]?.cents).toBe(10_500);
  });

  it("keeps covered obligations unavailable when a legacy shortfall includes missing bills", () => {
    const plan = planAt();
    plan.incomes.push({ id: "other", kind: "other", annualAmount: 50, startAge: 45, raiseRate: 0 });
    plan.expenses.push({ id: "bill", annualAmount: 30, startAge: 45, inflationRate: 0 });
    plan.debts.push({ id: "mortgage", kind: "mortgage", rate: 0, termYears: 1, amortizationYears: 1, balance: 100, monthlyPayment: 100 });
    const { years } = runDeterministic(plan, scenario);
    const data = aggregateCashflow(years.map(withoutCashflow), 1981, year(2026));
    expect(data.unknownCoverageYears).toBe(1);
    expect(data.shortfallCents).toBe(8_000);
    expect(data.sourceCents).toBe(5_000);
    expect(data.useCents).toBe(0);
    expect(data.unreconciledSourceCents).toBe(5_000);
    expect(data.unreconciledUseCents).toBe(0);
    expect(data.obligations).toMatchObject([{ id: "expenses", cents: 3_000 }]);
  });

  it("treats negative income as an obligation when calculating shortfall coverage", () => {
    const plan = planAt();
    plan.incomes.push({ id: "adjustment", kind: "other", annualAmount: -100, startAge: 45, raiseRate: 0 });
    const { years } = runDeterministic(plan, scenario);
    const data = aggregateCashflow(years, 1981, year(2026));
    expect(data.shortfallCents).toBe(10_000);
    expect(data.sources).toEqual([]);
    expect(data.uses).toEqual([]);
    expect(data.unreconciledSourceCents).toBe(0);
    expect(data.unreconciledUseCents).toBe(0);
    expect(data.obligations).toMatchObject([{ id: "other-reversal", cents: 10_000 }]);
  });

  it.each([
    { mortgage: 200, shortfallCents: 10_000, useId: "covered-bills" },
    { mortgage: 100, shortfallCents: 0, useId: "scheduled-mortgage" },
  ])("counts a negative expense as funding toward a $$mortgage mortgage payment", ({ mortgage, shortfallCents, useId }) => {
    const plan = planAt();
    plan.expenses.push({ id: "adjustment", annualAmount: -100, startAge: 45, inflationRate: 0 });
    plan.debts.push({ id: "mortgage", kind: "mortgage", rate: 0, termYears: 1, amortizationYears: 1, balance: mortgage, monthlyPayment: mortgage });
    const { years } = runDeterministic(plan, scenario);
    expect(years[0]?.expenses).toBe(-100);
    expect(years[0]?.cashflow?.scheduledMortgagePayment).toBe(mortgage);
    const data = aggregateCashflow(years, 1981, year(2026));
    expect(data.shortfallCents).toBe(shortfallCents);
    expect(from(data.sources, "expenses-reversal")).toBe(10_000);
    expect(from(data.uses, useId)).toBe(10_000);
    expect(data.sourceCents).toBe(data.useCents);
    expect(data.unreconciledSourceCents).toBe(0);
    expect(data.unreconciledUseCents).toBe(0);
    expect(data.obligations).toMatchObject([{ id: "scheduled-mortgage", cents: mortgage * 100 }]);
  });

  it.each(["montecarlo", "historical"] as const)("can reconcile a coherent %s representative result", (simMode) => {
    const plan = planAt();
    plan.accounts.push({ id: "tfsa", type: "tfsa", balance: 1_000, assetMix: { equity: 1, bond: 0, cash: 0 } });
    plan.expenses.push({ id: "bill", annualAmount: 400, startAge: 45, inflationRate: 0 });
    const { result, analysis } = runScenario(plan, { ...scenario, simMode, historicalConfig: { startYear: 1900 }, mcConfig: { runs: 10, stdDev: { equity: 0.2, bond: 0, cash: 0 }, seed: 42 } });
    const data = aggregateCashflow(result.years, 1981, year(2026, 2028));
    const withdrawal = result.years.reduce((total, row) => total + Math.round(row.withdrawals.tfsa * 100), 0);
    expect(analysis?.mode).toBe(simMode);
    expect(from(data.sources, "tfsa-withdrawal")).toBe(withdrawal);
    expect(data.useCents).toBe(data.sourceCents);
    expect(data.legacyYears).toBe(0);
  });
});
