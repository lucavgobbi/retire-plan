import { describe, expect, it } from "vitest";
import { buildDeterministicReturns, simulate, type Plan, type Scenario } from "../src";

const noGrowth = { equity: 0, bond: 0, cash: 0 };
const cashMix = { equity: 0, bond: 0, cash: 1 };
const scenario: Scenario = {
  id: "breakdown", name: "Breakdown", simMode: "deterministic", retirementAge: 72,
  returnAssumptions: noGrowth, withdrawalOrder: ["nonreg", "tfsa", "rrsp"],
  benefits: { cpp: false, oas: false, gis: false },
};

function makePlan(currentAge = 70): Plan {
  return {
    profile: { currentAge, endAge: currentAge + 1, birthYear: 2026 - currentAge, province: "ON" },
    accounts: [], assets: [], debts: [], incomes: [], expenses: [], savingsPolicy: [],
  };
}

function run(plan: Plan) {
  return simulate(plan, scenario, buildDeterministicReturns(noGrowth, plan.profile.currentAge, plan.profile.endAge)).years;
}

const cents = (amount: number) => Math.round(amount * 100);

describe("YearResult item breakdown", () => {
  it("preserves repeated IDs and records actual RRIF draws and matched deposits for every RRSP", () => {
    const plan = makePlan();
    plan.accounts = [
      { id: "duplicate", name: "Retirement", type: "rrsp", balance: 10_000, assetMix: cashMix },
      { id: "duplicate", name: "Retirement", type: "rrsp", balance: 30_000, assetMix: cashMix },
      { id: "empty", type: "rrsp", balance: 0, assetMix: cashMix },
    ];
    plan.incomes = [
      { id: "income", name: "Pay", kind: "employment", annualAmount: 60_000, bonusRate: 0.05, startAge: 70, raiseRate: 0 },
      { id: "income", name: "Rent", kind: "other", annualAmount: 200, startAge: 71, raiseRate: 0 },
      { id: "cpp", kind: "cpp", annualAmount: 8_000, startAge: 71, raiseRate: 0 },
      { id: "oas", kind: "oas", annualAmount: 8_000, startAge: 71, raiseRate: 0 },
    ];
    plan.savingsPolicy = [
      { id: "match", priority: 0, target: "rrsp-match", perYearCap: 1_000.01, matchRate: 0.5 },
      { id: "prepay", priority: 1, target: "mortgage-prepay", perYearCap: 500 },
    ];
    plan.debts = [{ id: "mortgage", kind: "mortgage", balance: 10_000, rate: 0, monthlyPayment: 100, termYears: 10, amortizationYears: 10 }];
    const year = run(plan)[1]!;
    plan.accounts[0]!.name = "Renamed after run";
    plan.incomes[0]!.name = "Renamed pay";

    expect(year.incomeBreakdown).toEqual([
      { id: "income", name: "Pay", kind: "employment", amount: 63_000, sourceIndex: 0 },
      { id: "income", name: "Rent", kind: "other", amount: 200, sourceIndex: 1 },
    ]);
    expect(year.income.other).toBeCloseTo(200 + year.cashflow!.employerRrspMatch, 2);
    expect(year.rrifMinimumWithdrawal).toBe(2_191.2);
    expect(year.accountBreakdown).toEqual([
      { id: "duplicate", name: "Retirement", type: "rrsp", openingBalance: 10_375, closingBalance: 10_202.2, withdrawals: 547.8, contributions: 375, employerRrspMatch: 125 },
      { id: "duplicate", name: "Retirement", type: "rrsp", openingBalance: 31_125.02, closingBalance: 30_606.63, withdrawals: 1_643.4, contributions: 1_125.02, employerRrspMatch: 375.01 },
      { id: "empty", type: "rrsp", openingBalance: 0, closingBalance: 0, withdrawals: 0, contributions: 0 },
    ]);
    const accounts = year.accountBreakdown!;
    expect(accounts.reduce((sum, item) => sum + cents(item.withdrawals), 0)).toBe(cents(year.withdrawals.rrsp));
    expect(accounts.reduce((sum, item) => sum + cents(item.contributions), 0)).toBe(cents(year.contributions.rrsp));
    expect(accounts.reduce((sum, item) => sum + cents(item.employerRrspMatch ?? 0), 0)).toBe(cents(year.cashflow!.employerRrspMatch));
    expect(year.mortgageBreakdown).toEqual({ id: "mortgage", openingBalance: 8_300, scheduledPayment: 1_200, prepayment: 500, closingBalance: 6_600 });
  });

  it("records named sales, direct deposits, partial withdrawals, and the final partial mortgage payment", () => {
    const plan = makePlan(45);
    plan.accounts = [
      { id: "first", type: "nonreg", balance: 100, assetMix: cashMix },
      { id: "second", type: "nonreg", balance: 300, assetMix: cashMix },
    ];
    plan.assets = [
      { id: "sale", name: "Home", kind: "primary-home", value: 75.005, appreciationRate: 0, sellEvent: { age: 45, costsPct: 0 } },
      { id: "sale", name: "Cabin", kind: "other", value: 25.005, appreciationRate: 0, sellEvent: { age: 45, costsPct: 0 } },
    ];
    plan.debts = [{ id: "mortgage", kind: "mortgage", balance: 150, rate: 0, monthlyPayment: 100, termYears: 1, amortizationYears: 1 }];
    plan.expenses = [
      { id: "bills", name: "Food", annualAmount: 100.005, startAge: 45, inflationRate: 0 },
      { id: "bills", name: "Travel", annualAmount: 100.005, startAge: 45, inflationRate: 0 },
    ];
    const [year, next] = run(plan);
    expect(year!.assetBreakdown).toEqual([
      { id: "sale", name: "Home", kind: "primary-home", closingBalance: 0, sale: { proceeds: 75.01, destination: "nonreg" } },
      { id: "sale", name: "Cabin", kind: "other", closingBalance: 0, sale: { proceeds: 25, destination: "nonreg" } },
    ]);
    expect(year!.expenseBreakdown).toEqual([
      { id: "bills", name: "Food", amount: 100.005, sourceIndex: 0 },
      { id: "bills", name: "Travel", amount: 100.005, sourceIndex: 1 },
    ]);
    expect(year!.cashflow!.assetSaleToNonreg).toBe(100.01);
    expect(year!.withdrawals.nonreg).toBe(350.01);
    expect(year!.accountBreakdown).toMatchObject([
      { id: "first", assetSaleDeposit: 25, withdrawals: 87.5, contributions: 0 },
      { id: "second", assetSaleDeposit: 75.01, withdrawals: 262.51, contributions: 0 },
    ]);
    expect(year!.mortgageBreakdown).toEqual({ id: "mortgage", openingBalance: 150, scheduledPayment: 150, prepayment: 0, closingBalance: 0 });
    expect(next!.mortgageBreakdown?.scheduledPayment).toBe(0);
    expect(next!.assetBreakdown?.every((item) => item.sale === undefined)).toBe(true);
  });

  it("uses the first account when both start empty and keeps idle-cash routing separate", () => {
    const plan = makePlan(45);
    plan.accounts = [{ id: "first", type: "cash", balance: 0, interestRate: 0.01 }, { id: "second", type: "cash", balance: 0 }];
    plan.assets = [{ id: "property", name: "Property", kind: "other", value: 105, appreciationRate: 0, sellEvent: { age: 45, costsPct: 0 } }];
    plan.savingsPolicy = [{ id: "deposit", priority: 0, target: "cash", perYearCap: 100 }];
    const [year, next] = run(plan);
    expect(year!.assetBreakdown?.[0]?.sale).toEqual({ proceeds: 105, destination: "idleCash" });
    expect(year!.cashflow).toMatchObject({ assetSaleToIdleCash: 105, assetSaleToNonreg: 0, closingIdleCash: 5, cashContributionsToIdleCash: 0 });
    expect(year!.accountBreakdown).toMatchObject([{ contributions: 100, closingBalance: 100 }, { contributions: 0, closingBalance: 0 }]);
    expect(next!.accountBreakdown).toMatchObject([{ openingBalance: 100, cashInterest: 1 }, { openingBalance: 0 }]);
    expect(next!.accountBreakdown?.map(({ closingBalance }) => closingBalance)).toEqual(next!.cashAccounts?.map(({ balance }) => balance));
    const empty = run(makePlan(45))[0]!;
    expect(empty).toMatchObject({ accountBreakdown: [], incomeBreakdown: [], assetBreakdown: [] });
    expect(empty.mortgageBreakdown).toBeUndefined();
  });

  it("reports fractional-cent cash balances together, without changing the next year's opening positions", () => {
    const plan = makePlan(45);
    plan.accounts = [
      { id: "cash-1", type: "cash", balance: 1 }, { id: "cash-2", type: "cash", balance: 1 },
    ];
    plan.expenses = [{ id: "expense", annualAmount: 0.99, startAge: 45, endAge: 45, inflationRate: 0 }];
    const [year, next] = run(plan);
    expect(year!.withdrawals.cash).toBe(0.99);
    expect(year!.balances.cash).toBe(1.01);
    expect(year!.accountBreakdown?.map((account) => account.withdrawals)).toEqual([0.5, 0.49]);
    expect(year!.accountBreakdown?.map((account) => account.closingBalance)).toEqual([0.51, 0.5]);
    expect(year!.cashAccounts?.map((account) => account.balance)).toEqual([0.51, 0.5]);
    expect(next!.accountBreakdown?.map((account) => account.openingBalance)).toEqual([0.51, 0.5]);
  });

  it("records the capped RRSP debit rather than rounding the requested draw into the account", () => {
    const plan = makePlan(71);
    plan.accounts = [{ id: "rrsp", type: "rrsp", balance: 1.044, assetMix: cashMix }];
    const returns = buildDeterministicReturns(noGrowth, 71, 72);
    const year = simulate(plan, { ...scenario, withdrawalStrategy: "tax-minimizing" }, returns, undefined,
      { strategy: "tax-minimizing", byAge: [], fillTargetTaxable: 50_000 }).years[0]!;
    expect(year.withdrawals.rrsp).toBe(1.05);
    expect(year.accountBreakdown?.[0]).toMatchObject({ openingBalance: 1.04, withdrawals: 1.04, closingBalance: 0 });
  });

  it("keeps zero-proceeds sales and closes only the sold asset when IDs repeat", () => {
    const plan = makePlan(45);
    plan.assets = [
      { id: "same", name: "Sold", kind: "other", value: 100, appreciationRate: 0, sellEvent: { age: 45, costsPct: 1 } },
      { id: "same", name: "Retained", kind: "other", value: 200, appreciationRate: 0.1 },
    ];
    const [year, next] = run(plan);
    expect(year!.assetBreakdown).toEqual([
      { id: "same", name: "Sold", kind: "other", closingBalance: 0, sale: { proceeds: 0, destination: "idleCash" } },
      { id: "same", name: "Retained", kind: "other", closingBalance: 220 },
    ]);
    expect(year!.balances.otherAssets).toBe(220);
    expect(next!.balances.otherAssets).toBe(242);
    expect(next!.assetBreakdown?.[0]?.sale).toBeUndefined();
  });

  it("keeps full plan indexes for repeated IDs and names active in disjoint years", () => {
    const plan = makePlan(45);
    plan.incomes = [
      { id: "job", name: "Work", kind: "employment", startAge: 45, endAge: 45, annualAmount: 100, raiseRate: 0 },
      { id: "job", name: "Work", kind: "employment", startAge: 46, endAge: 46, annualAmount: 200, raiseRate: 0 },
    ];
    plan.expenses = [
      { id: "cost", name: "Travel", startAge: 46, endAge: 46, annualAmount: 20, inflationRate: 0 },
      { id: "cost", name: "Travel", startAge: 45, endAge: 45, annualAmount: 10, inflationRate: 0 },
    ];
    const [first, second] = run(plan);
    expect(first?.incomeBreakdown).toMatchObject([{ sourceIndex: 0, amount: 100 }]);
    expect(second?.incomeBreakdown).toMatchObject([{ sourceIndex: 1, amount: 200 }]);
    expect(first?.expenseBreakdown).toMatchObject([{ sourceIndex: 1, amount: 10 }]);
    expect(second?.expenseBreakdown).toMatchObject([{ sourceIndex: 0, amount: 20 }]);
  });
});
