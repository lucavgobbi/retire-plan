import { describe, expect, it } from "vitest";
import { buildDeterministicReturns, loadTables, simulate, validatePlan, type Plan, type Scenario } from "../src";
import { annualPayroll } from "../src/tax/payroll";
import tablesJson from "../data/tax/ca-2026.json";

const returns = { equity: 0, bond: 0, cash: 0 };
const mix = { equity: 0, bond: 0, cash: 1 };
const scenario: Scenario = {
  id: "base",
  name: "Base",
  simMode: "deterministic",
  retirementAge: 66,
  returnAssumptions: returns,
  withdrawalOrder: ["nonreg", "tfsa", "rrsp"],
  benefits: { cpp: false, oas: false, gis: false },
};
const match = { id: "match", target: "rrsp-match", priority: 1, matchRate: 0.5 } as const;
const rrsp = (id: string) => ({ id, type: "rrsp", balance: 0, assetMix: mix }) as const;

function plan(salary = 10_000, expense = 0): Plan {
  return {
    profile: { currentAge: 40, endAge: 41, birthYear: 1986, province: "ON" },
    accounts: [rrsp("work")],
    assets: [],
    debts: [],
    incomes: [{ id: "salary", kind: "employment", annualAmount: salary, startAge: 40, raiseRate: 0 }],
    expenses: [{ id: "expense", annualAmount: expense, startAge: 40, inflationRate: 0 }],
    savingsPolicy: [],
  };
}

function run(input: Plan, overrides?: Partial<Scenario>) {
  const { currentAge, endAge } = input.profile;
  return simulate(input, { ...scenario, ...overrides }, buildDeterministicReturns(returns, currentAge, endAge)).years;
}

describe("employer RRSP contributions", () => {
  it("lands independent money in a deficit without making it spendable or drawable this year", () => {
    const input = plan(10_000, 10_800);
    input.incomes[0]!.employerContributionRate = 0.1;
    input.savingsPolicy = [match];

    const first = run(input)[0]!;
    expect(first.cashflow).toMatchObject({ employerRrspContribution: 1_000, employerRrspMatch: 0, closingIdleCash: 0 });
    expect(first.income).toMatchObject({ employment: 10_000, other: 1_000 });
    expect(first.contributions.rrsp).toBe(1_000);
    expect(first.withdrawals.rrsp).toBe(0);
    expect(first.shortfall).toBe(800);
    expect(first.taxableIncome).toBe(10_000);
    expect(first.rrspRoom).toBe(980);
    expect(first.netWorth).toBe(1_000);
  });

  it("fills two capped RRSPs with gross deposits and preserves overflow through the next step and idle cash", () => {
    const input = plan(10_000, 8_500);
    input.accounts = [
      { ...rrsp("second"), depositPriority: 2, annualDepositLimit: 602 },
      { ...rrsp("first"), depositPriority: 1, annualDepositLimit: 600 },
      { id: "fallback", type: "nonreg", balance: 0, assetMix: mix, annualDepositLimit: 100 },
    ];
    input.incomes[0]!.employerContributionRate = 0.08;
    input.savingsPolicy = [match, { id: "nonreg", target: "nonreg", priority: 2 }];

    const years = run(input);
    for (const year of years) {
      expect(year.accountBreakdown).toMatchObject([
        { id: "second", contributions: 602, employerRrspContribution: 200, employerRrspMatch: 134 },
        { id: "first", contributions: 600, employerRrspContribution: 600 },
        { id: "fallback", contributions: 100 },
      ]);
      expect(year.accountBreakdown![1]!.employerRrspMatch).toBeUndefined();
      expect(year.cashflow).toMatchObject({ employerRrspContribution: 800, employerRrspMatch: 134 });
      expect(year.income.other).toBe(934);
      expect(year.contributions).toEqual({ rrsp: 1_202, tfsa: 0, nonreg: 100 });
      const startingCash = year.cashflow!.openingIdleCash;
      expect(year.cashflow!.closingIdleCash - startingCash).toBe(1_132);
    }
  });

  it("warns on zero-capacity and missing RRSP accounts and preserves all personal cash", () => {
    const input = plan();
    input.incomes[0]!.employerContributionRate = 0.1;
    input.savingsPolicy = [match];
    for (const accounts of [[], [{ ...rrsp("closed"), annualDepositLimit: 0 }]]) {
      input.accounts = accounts;
      expect(validatePlan(input)).toEqual([]);
      const year = run(input)[0]!;
      expect(year.cashflow).toMatchObject({ blockedEmployerRrspContribution: 1_000, closingIdleCash: 10_000 });
      expect(year.cashflow?.employerRrspContribution).toBeUndefined();
      expect(year.warnings).toContainEqual(expect.stringContaining("$1000.00"));
      expect(year.taxableIncome).toBe(10_000);
      expect(year.contributions.rrsp).toBe(0);
      expect(year.rrspRoom).toBe(1_800);
    }
  });

  it("caps independent money at pre-benefit room and carries its extra earned room forward", () => {
    const input = plan();
    input.incomes[0]!.employerContributionRate = 1;
    input.savingsPolicy = [match];
    const [first, second] = run(input);
    expect(first?.cashflow).toMatchObject({ employerRrspContribution: 1_800, blockedEmployerRrspContribution: 8_200 });
    expect(first?.cashflow?.employerRrspMatch).toBe(0);
    expect(first?.rrspRoom).toBe(324);
    expect(second?.cashflow?.employerRrspContribution).toBe(2_124);
  });

  it("reserves tight room for the full match and carries personal residue to the next step", () => {
    const input = plan();
    input.savingsPolicy = [match, { id: "cash", target: "cash", priority: 2 }];
    const year = run(input)[0]!;
    expect(year.cashflow?.employerRrspMatch).toBe(600);
    expect(year.contributions).toEqual({ rrsp: 1_800, tfsa: 0, nonreg: 0, cash: 8_800 });
    expect(year.rrspRoom).toBe(108);
    expect(year.taxableIncome).toBe(10_000);
  });

  it("models the landed employer benefit using shared CPP and EI ceilings", () => {
    const input = plan(65_000);
    input.incomes[0]!.employerContributionRate = 0.1;
    const payroll = { cpp: true, ei: true, cppOptOut65to69: false };
    const baseline = run(input, { payroll })[0]!;
    input.expenses[0]!.annualAmount = baseline.balances.cash - 1_000;
    input.savingsPolicy = [{ ...match, matchRate: 1 }];
    const year = run(input, { payroll })[0]!;
    const employer = year.cashflow!.employerRrspContribution! + year.cashflow!.employerRrspMatch;
    const expectedPayroll = annualPayroll(65_000 + employer, 0, 40, payroll, loadTables(tablesJson).payroll, []);
    expect(year.cashflow!.employerRrspMatch).toBeGreaterThan(0);
    expect(year.cashflow!.employerRrspMatch).toBeLessThan(1_000);
    expect(year.payroll).toEqual(expectedPayroll);
    expect(year.taxableIncome).toBeCloseTo(65_000 - expectedPayroll.enhancedCppDeduction, 2);
    expect(year.contributions.rrsp - employer + year.balances.cash).toBeCloseTo(
      65_000 - year.expenses - expectedPayroll.total - year.tax.total,
      2,
    );
  });

  it("reconciles match across the discontinuous EI refund cutoff", () => {
    const input = plan(1_900, 1_880);
    input.incomes[0]!.employerContributionRate = 0.05;
    input.savingsPolicy = [{ ...match, matchRate: 1 }];
    const year = run(input, { payroll: { cpp: false, ei: true, cppOptOut65to69: false } })[0]!;
    expect(year.cashflow).toMatchObject({ employerRrspContribution: 95, employerRrspMatch: 5, closingIdleCash: 15 });
    expect(year.payroll!.eiRefund).toBe(year.payroll!.ei);
    expect(year.shortfall).toBe(0);
    expect(year.contributions.rrsp).toBe(105);
  });

  it("uses raised base salary before bonus and stops with linked retirement", () => {
    const input = plan();
    input.profile.endAge = 42;
    Object.assign(input.incomes[0]!, {
      bonusRate: 0.5,
      raiseRate: 0.2,
      endAtRetirement: true,
      employerContributionRate: 0.1,
      employerContributionAnnualCap: 1_150,
    });
    input.savingsPolicy = [{ ...match, perYearCap: 100 }];
    const [first, second, retired] = run(input, { retirementAge: 42 });
    expect(first?.income.employment).toBe(15_000);
    expect(second?.income.employment).toBe(18_000);
    expect(first?.cashflow?.employerRrspContribution).toBe(1_000);
    expect(second?.cashflow?.employerRrspContribution).toBe(1_150);
    expect(second?.cashflow?.employerRrspMatch).toBe(50);
    expect(retired?.cashflow?.employerRrspContribution).toBeUndefined();
    expect(retired?.cashflow?.employerRrspMatch).toBe(0);
  });

  it("warns when active employment offers an RRSP deposit after age 71", () => {
    const input = plan();
    input.profile = { ...input.profile, birthYear: 1954, currentAge: 72, endAge: 73 };
    input.incomes[0]!.employerContributionRate = 0.1;
    input.savingsPolicy = [match];
    const year = run(input)[0]!;
    expect(year.cashflow).toMatchObject({ blockedEmployerRrspContribution: 1_000, employerRrspMatch: 0 });
    expect(year.contributions.rrsp).toBe(0);
    expect(year.balances.cash).toBe(10_000);
  });

  it.each([
    { salary: 50_000, expenses: 20_000, fillTargetTaxable: 50_000.01, draw: 0.01, landedMatch: 1_000 },
    { salary: 10_000, expenses: 10_000, fillTargetTaxable: 11_000, draw: 1_000, landedMatch: 0 },
  ])(
    "only matches surplus independent of a $draw proactive draw",
    ({ salary, expenses, fillTargetTaxable, draw, landedMatch }) => {
      const input = plan(salary, expenses);
      input.accounts[0]!.balance = 1_000;
      input.savingsPolicy = [
        { id: "ordinary", priority: 0, target: "rrsp", perYearCap: 100 },
        { ...match, perYearCap: 1_000, matchRate: 1 },
      ];
      const year = simulate(
        input,
        { ...scenario, withdrawalStrategy: "tax-minimizing" },
        buildDeterministicReturns(returns, 40, 41),
        undefined,
        { strategy: "tax-minimizing", byAge: [], fillTargetTaxable },
      ).years[0]!;
      expect(year.plannedRrspDraw).toBe(draw);
      expect(year.cashflow?.employerRrspMatch).toBe(landedMatch);
      expect(year.contributions.rrsp).toBe(landedMatch * 2);
    },
  );
});

describe("savings deposit routing", () => {
  it("carries a cent past a fractional-cent TFSA step cap without duplicating it", () => {
    const input = plan(100.01, 100);
    input.accounts = [
      { id: "tfsa", type: "tfsa", balance: 0, assetMix: mix, annualDepositLimit: 0.01 },
      { id: "fallback", type: "nonreg", balance: 0, assetMix: mix, annualDepositLimit: 0.01 },
    ];
    input.savingsPolicy = [{ id: "tfsa", target: "tfsa", priority: 0, perYearCap: 0.005 }];
    const year = run(input)[0]!;
    expect(year.contributions).toEqual({ tfsa: 0, rrsp: 0, nonreg: 0.01 });
    expect(year.accountBreakdown?.map((item) => item.contributions)).toEqual([0, 0.01]);
    expect(year.cashflow?.closingIdleCash).toBe(0);
    expect(year.netWorth).toBe(0.01);
  });

  it("uses explicit priorities first, plan order for ties, and omitted priorities last", () => {
    const input = plan(100);
    input.accounts = [
      { id: "omitted", type: "cash", balance: 5 },
      { id: "lower", type: "cash", balance: 0, depositPriority: 9, annualDepositLimit: 20 },
      { id: "first", type: "cash", balance: 0, depositPriority: 0, annualDepositLimit: 25 },
      { id: "tie", type: "cash", balance: 0, depositPriority: 0, annualDepositLimit: 30 },
    ];
    input.savingsPolicy = [{ id: "cash", target: "cash", priority: 1 }];
    expect(run(input)[0]?.accountBreakdown?.map((item) => item.contributions)).toEqual([25, 20, 25, 30]);
  });

  it("keeps legacy proportional routing and reconciles employer sources to named deposits in cents", () => {
    const input = plan(10_000, 9_800);
    input.accounts = [
      { ...rrsp("small"), balance: 1 },
      { ...rrsp("large"), balance: 2 },
    ];
    input.incomes[0]!.employerContributionRate = 0.001;
    input.incomes[0]!.employerContributionAnnualCap = 0.01;
    input.savingsPolicy = [{ ...match, perYearCap: 100.01 }];
    const year = run(input)[0]!;
    expect(year.accountBreakdown?.map((row) => row.contributions)).toEqual([50.01, 100.02]);
    expect(year.cashflow).toMatchObject({ employerRrspContribution: 0.01, employerRrspMatch: 50.01 });
    const cents = (amount: number) => Math.round(amount * 100);
    const accounts = year.accountBreakdown!;
    expect(accounts.reduce((sum, row) => sum + cents(row.employerRrspContribution ?? 0), 0)).toBe(1);
    expect(accounts.reduce((sum, row) => sum + cents(row.employerRrspMatch ?? 0), 0)).toBe(5_001);
    for (const row of accounts) {
      expect(cents(row.employerRrspContribution ?? 0) + cents(row.employerRrspMatch ?? 0)).toBeLessThanOrEqual(
        cents(row.contributions),
      );
    }
  });

  it("excludes direct asset-sale deposits from both priority and annual capacity", () => {
    const input = plan(100);
    input.accounts = [
      { id: "first", type: "nonreg", balance: 100, assetMix: mix, annualDepositLimit: 0 },
      { id: "second", type: "nonreg", balance: 300, assetMix: mix, depositPriority: 0, annualDepositLimit: 20 },
    ];
    input.assets = [
      { id: "sale", kind: "other", value: 100, appreciationRate: 0, sellEvent: { age: 40, costsPct: 0 } },
    ];
    const year = run(input)[0]!;
    expect(year.accountBreakdown).toMatchObject([
      { assetSaleDeposit: 25, contributions: 0 },
      { assetSaleDeposit: 75, contributions: 20 },
    ]);
    expect(year.cashflow?.closingIdleCash).toBe(80);
  });

  it("captures match on the accounts where the matched deposit lands after earlier personal deposits", () => {
    const input = plan();
    input.accounts = [{ ...rrsp("first"), depositPriority: 0, annualDepositLimit: 100 }, rrsp("second")];
    input.incomes[0]!.employerContributionRate = 0.005;
    input.savingsPolicy = [
      { id: "personal", target: "rrsp", priority: 0, perYearCap: 50 },
      { ...match, perYearCap: 50 },
    ];
    const [first, second] = run(input)[0]!.accountBreakdown!;
    expect(first).toMatchObject({ contributions: 100, employerRrspContribution: 50 });
    expect(first?.employerRrspMatch).toBeUndefined();
    expect(second).toMatchObject({ contributions: 75, employerRrspMatch: 25 });
    expect(second?.employerRrspContribution).toBeUndefined();
  });
});

describe("employer and deposit field validation", () => {
  it("rejects nonfinite, out-of-range and fractional-cent inputs", () => {
    for (const value of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
      const input = plan();
      input.accounts[0]!.depositPriority = value;
      expect(validatePlan(input)).toContainEqual(expect.stringContaining("depositPriority"));
    }
    for (const value of [-1, 1.001, Infinity, NaN]) {
      const input = plan();
      input.accounts[0]!.annualDepositLimit = value;
      input.incomes[0]!.employerContributionAnnualCap = value;
      input.incomes[0]!.employerContributionRate = 0.5;
      expect(validatePlan(input)).toEqual([
        expect.stringContaining("annualDepositLimit"),
        expect.stringContaining("employerContributionAnnualCap"),
      ]);
    }
    for (const value of [-0.1, 1.01, Infinity, NaN]) {
      const input = plan();
      input.incomes[0]!.employerContributionRate = value;
      expect(validatePlan(input)).toContainEqual(expect.stringContaining("employerContributionRate"));
    }
  });

  it("requires a rate for the annual employer cap and confines both fields to employment", () => {
    const input = plan();
    input.incomes[0]!.employerContributionAnnualCap = 0;
    expect(validatePlan(input)).toContainEqual(expect.stringContaining("requires a rate"));
    input.incomes[0]!.employerContributionRate = 0;
    expect(validatePlan(input)).toEqual([]);
    input.incomes[0]!.kind = "other";
    expect(validatePlan(input)).toContainEqual(expect.stringContaining("only for employment"));
  });
});
