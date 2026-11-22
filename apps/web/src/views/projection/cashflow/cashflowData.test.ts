import { describe, expect, it } from "vitest";
import type { Plan, Scenario, YearResult } from "@retire-plan/engine";
import { createDefaultPlan, DEFAULT_SCENARIO_BASE } from "../../../domain/defaults";
import { runDeterministic, runScenario } from "../../../domain/run";
import { aggregateCashflow, cashflowYears, type CashflowAmount } from "./cashflowData";

const scenario: Scenario = {
  ...DEFAULT_SCENARIO_BASE,
  id: "cashflow-test",
  name: "Cashflow test",
  simMode: "deterministic",
  returnAssumptions: { equity: 0, bond: 0, cash: 0 },
};
const from = (items: CashflowAmount[], id: string) => items.find((item) => item.id === id)?.cents ?? 0;
const year = (startYear: number, endYear = startYear) => ({ startYear, endYear });

function planAt(startAge = 45, endAge = startAge + 2): Plan {
  return {
    ...createDefaultPlan(),
    profile: { birthYear: 1981, currentAge: startAge, endAge, province: "ON" },
    savingsPolicy: [],
  };
}

function withoutCashflow(row: YearResult): YearResult {
  const { cashflow, payroll, ...legacy } = row;
  return legacy;
}

describe("aggregateCashflow", () => {
  it("splits two RRSPs, incomes, and expenses by saved name without changing period totals", () => {
    const plan = planAt(45, 46);
    const assetMix = { equity: 0, bond: 0, cash: 1 };
    plan.accounts = [
      { id: "retirement-a", name: "Retirement", type: "rrsp", balance: 3_000, assetMix },
      { id: "retirement-b", name: "Retirement", type: "rrsp", balance: 1_000, assetMix },
    ];
    plan.incomes = [
      { id: "job-a", name: "Library", kind: "employment", annualAmount: 1_000, startAge: 45, endAge: 45, raiseRate: 0 },
      {
        id: "job-b",
        name: "Weekend shift",
        kind: "employment",
        annualAmount: 100,
        startAge: 45,
        endAge: 45,
        raiseRate: 0,
      },
    ];
    plan.expenses = [
      { id: "bill-a", name: "Rent", annualAmount: 500.005, startAge: 45, inflationRate: 0 },
      { id: "bill-b", name: "Groceries", annualAmount: 100.005, startAge: 45, inflationRate: 0 },
    ];
    plan.savingsPolicy = [
      { id: "match", target: "rrsp-match", priority: 1, perYearCap: 100, matchRate: 0.5 },
      { id: "deposit", target: "rrsp", priority: 2 },
    ];
    const { years } = runDeterministic(plan, scenario);
    const period = year(2026, 2027);
    const grouped = aggregateCashflow(years, 1981, period);
    const named = aggregateCashflow(years, 1981, period, true);
    const amounts = (items: CashflowAmount[], pattern: RegExp) =>
      items.filter(({ label }) => pattern.test(label)).map(({ label, cents }) => [label, cents]);
    expect(named.named).toBe(true);
    expect(named.sourceCents).toBe(grouped.sourceCents);
    expect(named.useCents).toBe(grouped.useCents);
    expect(named.unreconciledUseCents).toBe(0);
    expect(named.unreconciledSourceCents).toBe(0);
    expect(amounts(named.sources, /Library|Weekend shift/)).toEqual([
      ["Library", 100_000],
      ["Weekend shift", 10_000],
    ]);
    expect(amounts(named.sources, /Retirement .* withdrawals/)).toEqual(
      years[1]!.accountBreakdown!.map((account, index) => [
        `Retirement (${index + 1}) withdrawals`,
        Math.round(account.withdrawals * 100),
      ]),
    );
    expect(amounts(named.uses, /Retirement .* contributions/)).toEqual(
      years[0]!.accountBreakdown!.map((account, index) => [
        `Retirement (${index + 1}) contributions`,
        Math.round((account.contributions - (account.employerRrspMatch ?? 0)) * 100),
      ]),
    );
    expect(amounts(named.uses, /Rent|Groceries/)).toEqual([
      ["Rent", 100_002],
      ["Groceries", 20_000],
    ]);
    expect(named.matches.map(({ label, cents }) => [label, cents])).toEqual([
      ["Employer match → Retirement (1)", 3_750],
      ["Employer match → Retirement (2)", 1_250],
    ]);
  });

  it("keeps repeated IDs separate across years and retains named obligations during a shortfall", () => {
    const plan = planAt(45, 46);
    plan.incomes = [{ id: "income", name: "Pension", kind: "other", annualAmount: 50, startAge: 45, raiseRate: 0 }];
    plan.expenses = [
      { id: "same", name: "Utilities", annualAmount: 30, startAge: 45, inflationRate: 0 },
      { id: "same", name: "Utilities", annualAmount: 40, startAge: 45, inflationRate: 0 },
    ];
    const { years } = runDeterministic(plan, scenario);
    const withoutIndices = years.map((row) => ({
      ...row,
      expenseBreakdown: row.expenseBreakdown?.map(({ sourceIndex, ...item }) => item),
    }));
    const named = aggregateCashflow(withoutIndices, 1981, year(2026, 2027), true);
    expect(named.shortfallCents).toBe(4_000);
    expect(named.uses).toMatchObject([{ label: "Covered obligations", cents: 10_000 }]);
    expect(named.obligations).toMatchObject([
      { label: "Utilities (1)", cents: 6_000 },
      { label: "Utilities (2)", cents: 8_000 },
    ]);
  });

  it("uses the captured plan indices to separate identical items active in different years", () => {
    const plan = planAt(45, 46);
    plan.incomes = [45, 46].map((age) => ({
      id: "income",
      name: "Contract",
      kind: "employment",
      annualAmount: (age - 44) * 100,
      startAge: age,
      endAge: age,
      raiseRate: 0,
    }));
    plan.expenses = [45, 46].map((age) => ({
      id: "expense",
      name: "Utilities",
      annualAmount: (age - 44) * 20,
      startAge: age,
      endAge: age,
      inflationRate: 0,
    }));
    const { years } = runDeterministic(plan, scenario);
    const named = aggregateCashflow(years, 1981, year(2026, 2027), true);
    expect(named.sources.filter(({ kind }) => kind === "income")).toMatchObject([
      { label: "Contract (1)", cents: 10_000 },
      { label: "Contract (2)", cents: 20_000 },
    ]);
    expect(named.uses.filter(({ kind }) => kind === "expense")).toMatchObject([
      { label: "Utilities (1)", cents: 2_000 },
      { label: "Utilities (2)", cents: 4_000 },
    ]);
  });

  it("reconciles an aggregate withdrawal cent without changing a captured account debit", () => {
    const plan = planAt();
    plan.accounts = [
      { id: "rrsp", name: "Work RRSP", type: "rrsp", balance: 200, assetMix: { equity: 0, bond: 0, cash: 1 } },
    ];
    plan.expenses = [{ id: "bill", annualAmount: 100, startAge: 45, inflationRate: 0 }];
    const { years } = runDeterministic(plan, scenario);
    const row = years[0]!;
    const recorded = row.accountBreakdown![0]!;
    const saved = { ...row, accountBreakdown: [{ ...recorded, withdrawals: recorded.withdrawals - 0.01 }] };
    const grouped = aggregateCashflow([saved], 1981, year(2026));
    const named = aggregateCashflow([saved], 1981, year(2026), true);
    expect(named.sourceCents).toBe(grouped.sourceCents);
    expect(named.useCents).toBe(grouped.useCents);
    expect(named.hasNamedGaps).toBe(true);
    expect(named.sources).toMatchObject([
      { label: "Work RRSP withdrawals", cents: 9_999 },
      { label: "RRSP / RRIF withdrawals (rounding difference)", cents: 1 },
    ]);
  });

  it("keeps the category net total when named charges and credits offset one another", () => {
    const plan = planAt();
    plan.incomes = [{ id: "income", name: "Pension", kind: "other", annualAmount: 50, startAge: 45, raiseRate: 0 }];
    plan.expenses = [
      { id: "charge", name: "Utilities", annualAmount: 100, startAge: 45, inflationRate: 0 },
      { id: "credit", name: "Utility credit", annualAmount: -50, startAge: 45, inflationRate: 0 },
    ];
    const { years } = runDeterministic(plan, scenario);
    const grouped = aggregateCashflow(years, 1981, year(2026));
    const named = aggregateCashflow(years, 1981, year(2026), true);
    expect(named.sources).toContainEqual(expect.objectContaining({ label: "Utility credit reversal", cents: 5_000 }));
    expect(named.uses).toContainEqual(expect.objectContaining({ label: "Utilities", cents: 10_000 }));
    expect(named.categoryOffsetCents).toBe(5_000);
    expect(named.sourceCents - named.categoryOffsetCents).toBe(grouped.sourceCents);
    expect(named.useCents - named.categoryOffsetCents).toBe(grouped.useCents);
  });

  it("uses saved asset sale and receiving account names without putting direct deposits in the pool", () => {
    const plan = planAt();
    plan.assets = [
      {
        id: "asset",
        name: "Cabin",
        kind: "other",
        value: 100,
        appreciationRate: 0,
        sellEvent: { age: 45, costsPct: 0 },
      },
    ];
    const withoutAccount = runDeterministic(plan, scenario);
    expect(aggregateCashflow(withoutAccount.years, 1981, year(2026), true).sources).toMatchObject([
      { label: "Cabin sale", cents: 10_000 },
    ]);

    plan.accounts = [
      { id: "nonreg", name: "Brokerage", type: "nonreg", balance: 0, assetMix: { equity: 0, bond: 0, cash: 1 } },
    ];
    const withAccount = runDeterministic(plan, scenario);
    const named = aggregateCashflow(withAccount.years, 1981, year(2026), true);
    expect(named.sources.every(({ cents }) => cents === 0)).toBe(true);
    expect(named.assetSaleToNonreg).toBe(10_000);
    expect(named.directSales).toMatchObject([{ label: "Cabin sale", cents: 10_000 }]);
    expect(named.saleDeposits).toMatchObject([{ label: "Brokerage", cents: 10_000 }]);
  });

  it("falls back across a mixed saved range and uses item detail when only captured years are selected", () => {
    const plan = planAt(45, 46);
    plan.incomes = [
      { id: "income", name: "Library", kind: "employment", annualAmount: 1_000, startAge: 45, raiseRate: 0 },
    ];
    const { years } = runDeterministic(plan, scenario);
    const { incomeBreakdown, ...legacy } = years[0]!;
    const mixed = [legacy, years[1]!];
    expect(aggregateCashflow(mixed, 1981, year(2026, 2027), true)).toMatchObject({
      named: false,
      namedUnavailable: true,
      sources: [{ label: "Employment", cents: 200_000 }],
    });
    expect(aggregateCashflow(mixed, 1981, year(2027), true)).toMatchObject({
      named: true,
      namedUnavailable: false,
      sources: [
        { label: "Library", cents: 100_000 },
        { label: "Idle cash brought forward", cents: 100_000 },
      ],
    });
  });

  it("uses the inclusive household calendar range and counts idle cash at the two boundaries", () => {
    const plan = planAt();
    plan.assets.push({
      id: "asset",
      kind: "other",
      value: 1_000,
      appreciationRate: 1,
      sellEvent: { age: 45, costsPct: 0.1 },
    });
    plan.expenses.push({ id: "bill", annualAmount: 150, startAge: 45, inflationRate: 0 });
    plan.savingsPolicy = [{ id: "cash", priority: 1, target: "cash", perYearCap: 75 }];
    const { years } = runDeterministic(plan, scenario);
    expect(cashflowYears(years, 1981)).toEqual([2026, 2027, 2028]);
    expect(years[0]?.cashflow).toMatchObject({
      openingIdleCash: 0,
      closingIdleCash: 750,
      assetSaleToIdleCash: 900,
      cashContributionsToIdleCash: 75,
    });
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
    plan.accounts.push(
      { id: "rrsp", type: "rrsp", balance: 0, assetMix: { equity: 0, bond: 0, cash: 1 } },
      { id: "cash", type: "cash", balance: 1_000, interestRate: 0.05 },
    );
    plan.incomes.push({ id: "job", kind: "employment", annualAmount: 60_000, startAge: 45, endAge: 45, raiseRate: 0 });
    plan.debts.push({
      id: "mortgage",
      kind: "mortgage",
      rate: 0,
      termYears: 1,
      amortizationYears: 1,
      balance: 1_050,
      monthlyPayment: 100,
    });
    plan.savingsPolicy = [
      { id: "match", target: "rrsp-match", priority: 1, perYearCap: 1_000, matchRate: 0.5 },
      { id: "deposit", target: "cash", priority: 2, perYearCap: 500 },
    ];
    const { years } = runDeterministic(plan, { ...scenario, payroll: { cpp: true, ei: true, cppOptOut65to69: false } });
    const row = years[0]!;
    expect(row.cashflow).toMatchObject({
      scheduledMortgagePayment: 1_050,
      employerRrspMatch: 500,
      cashContributionsToIdleCash: 0,
    });
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
    const { years } = runDeterministic(plan, {
      ...scenario,
      payroll: { cpp: false, ei: true, cppOptOut65to69: false },
    });
    expect(years[0]?.payroll).toMatchObject({ ei: 32.6, eiRefund: 32.6 });
    const data = aggregateCashflow(years, 1981, year(2026));
    expect(from(data.uses, "payroll")).toBe(0);
    expect(data.sourceCents).toBe(200_000);
    expect(data.useCents).toBe(200_000);
  });

  it("counts sale proceeds routed to non-registered only when they are withdrawn", () => {
    const plan = planAt();
    plan.accounts.push({ id: "nonreg", type: "nonreg", balance: 0, assetMix: { equity: 0, bond: 0, cash: 1 } });
    plan.assets.push({
      id: "asset",
      kind: "other",
      value: 100,
      appreciationRate: 0,
      sellEvent: { age: 45, costsPct: 0 },
    });
    plan.expenses.push({ id: "bill", annualAmount: 35, startAge: 45, inflationRate: 0 });
    const { years } = runDeterministic(plan, scenario);
    const data = aggregateCashflow(years, 1981, year(2026, 2028));
    expect(data.assetSaleToNonreg).toBe(10_000);
    expect(data.sources).toEqual([
      { id: "nonreg-withdrawal", label: "Non-registered withdrawals", kind: "transfer", cents: 10_000 },
    ]);
    expect(from(data.uses, "covered-bills")).toBe(3_000);
    expect(data.shortfallCents).toBe(500);
    expect(data.useCents).toBe(data.sourceCents);
    expect(data.obligations[0]?.cents).toBe(10_500);
  });

  it("keeps covered obligations unavailable when a legacy shortfall includes missing bills", () => {
    const plan = planAt();
    plan.incomes.push({ id: "other", kind: "other", annualAmount: 50, startAge: 45, raiseRate: 0 });
    plan.expenses.push({ id: "bill", annualAmount: 30, startAge: 45, inflationRate: 0 });
    plan.debts.push({
      id: "mortgage",
      kind: "mortgage",
      rate: 0,
      termYears: 1,
      amortizationYears: 1,
      balance: 100,
      monthlyPayment: 100,
    });
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
  ])(
    "counts a negative expense as funding toward a $$mortgage mortgage payment",
    ({ mortgage, shortfallCents, useId }) => {
      const plan = planAt();
      plan.expenses.push({ id: "adjustment", annualAmount: -100, startAge: 45, inflationRate: 0 });
      plan.debts.push({
        id: "mortgage",
        kind: "mortgage",
        rate: 0,
        termYears: 1,
        amortizationYears: 1,
        balance: mortgage,
        monthlyPayment: mortgage,
      });
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
    },
  );

  it.each(["montecarlo", "historical"] as const)("can reconcile a coherent %s representative result", (simMode) => {
    const plan = planAt();
    plan.accounts.push({ id: "tfsa", type: "tfsa", balance: 1_000, assetMix: { equity: 1, bond: 0, cash: 0 } });
    plan.expenses.push({ id: "bill", annualAmount: 400, startAge: 45, inflationRate: 0 });
    const { result, analysis } = runScenario(plan, {
      ...scenario,
      simMode,
      historicalConfig: { startYear: 1900 },
      mcConfig: { runs: 10, stdDev: { equity: 0.2, bond: 0, cash: 0 }, seed: 42 },
    });
    const data = aggregateCashflow(result.years, 1981, year(2026, 2028));
    const withdrawal = result.years.reduce((total, row) => total + Math.round(row.withdrawals.tfsa * 100), 0);
    expect(analysis?.mode).toBe(simMode);
    expect(from(data.sources, "tfsa-withdrawal")).toBe(withdrawal);
    expect(data.useCents).toBe(data.sourceCents);
    expect(data.legacyYears).toBe(0);
  });
});
