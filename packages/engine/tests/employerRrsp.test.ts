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

const fixed = (value: number) => ({ mode: "fixed", value }) as const;
const percent = (value: number) => ({ mode: "salary-percent", value }) as const;
const matched = (value = 1) => ({ mode: "match", value }) as const;

describe("employment RRSP contributions", () => {
  it("deposits into the selected RRSP in a deficit and holds only pre-deposit balances available for withdrawals", () => {
    const input = plan(10_000, 10_800);
    input.accounts = [rrsp("work"), { ...rrsp("group"), balance: 50, name: "Group RRSP" }];
    input.incomes[0]!.employmentContribution = { accountId: "group", personal: fixed(500), company: fixed(1_000) };
    const year = run(input)[0]!;
    expect(year.accountBreakdown).toMatchObject([
      { id: "work", contributions: 0, withdrawals: 0 },
      {
        id: "group",
        contributions: 1_500,
        withdrawals: 50,
        employmentRrspPersonal: 500,
        employerRrspContribution: 1_000,
      },
    ]);
    expect(year.cashflow).toMatchObject({
      employerRrspContribution: 1_000,
      employmentRrspPersonal: 500,
      closingIdleCash: 0,
    });
    expect(year.income).toMatchObject({ employment: 10_000, other: 1_000 });
    expect(year.shortfall).toBe(1_250);
    expect(year.taxableIncome).toBe(9_550);
    expect(year.rrspRoom).toBe(480);
    expect(year.netWorth).toBe(1_500);
  });

  it.each([null, "deleted", "cash"])("warns and books no deposit for unavailable destination %s", (accountId) => {
    const input = plan(65_000);
    input.accounts.push({ id: "cash", type: "cash", balance: 0 });
    const payroll = { cpp: true, ei: true, cppOptOut65to69: false };
    const baseline = run(input, { payroll })[0]!;
    input.incomes[0]!.employmentContribution = { accountId, personal: percent(0.04), company: percent(0.05) };
    const year = run(input, { payroll })[0]!;
    expect(year.contributions.rrsp).toBe(0);
    expect(year.income).toEqual(baseline.income);
    expect(year.taxableIncome).toBe(baseline.taxableIncome);
    expect(year.payroll).toEqual(baseline.payroll);
    expect(year.cashflow?.closingIdleCash).toBe(baseline.cashflow?.closingIdleCash);
    expect(year.warnings).toContainEqual(expect.stringContaining("choose an existing RRSP destination"));
  });

  it("keeps ambiguous saved account IDs usable for general savings and blocks direct deposits to them", () => {
    const input = plan();
    input.accounts.push({ ...rrsp("work"), balance: 100 });
    input.incomes[0]!.employmentContribution = { accountId: "work", personal: fixed(500), company: matched() };
    input.savingsPolicy = [{ id: "general", target: "rrsp", priority: 1, perYearCap: 150 }];
    const year = run(input)[0]!;
    expect(year.accountBreakdown).toMatchObject([{ contributions: 0 }, { contributions: 150 }]);
    expect(year.cashflow?.employmentRrspPersonal).toBeUndefined();
    expect(year.cashflow?.employerRrspMatch).toBe(0);
    expect(year.warnings).toContainEqual(expect.stringContaining("unique account identifier"));
  });

  it("pauses a migrated capped formula with a review warning and no blocked amount", () => {
    const input = plan(100_000);
    input.incomes[0]!.employmentContribution = {
      accountId: "work",
      personal: fixed(0),
      company: percent(0.1),
      recovery: { previousSalaryRate: 0.1, previousAnnualCap: 1_000 },
    };
    const year = run(input)[0]!;
    expect(year.contributions.rrsp).toBe(0);
    expect(year.income.other).toBe(0);
    expect(year.taxableIncome).toBe(100_000);
    expect(year.cashflow?.blockedEmployerRrspContribution).toBeUndefined();
    expect(year.warnings).toContainEqual(expect.stringContaining("review the previous capped company contribution"));
  });

  it("settles a dollar-for-dollar match against partial room then allocates general surplus", () => {
    const input = plan();
    input.accounts.unshift({ ...rrsp("other"), balance: 100 });
    input.incomes[0]!.employmentContribution = { accountId: "work", personal: fixed(1_000), company: matched() };
    input.savingsPolicy = [{ id: "cash", target: "cash", priority: 1 }];
    const year = run(input)[0]!;
    expect(year.cashflow).toMatchObject({
      employmentRrspPersonal: 900,
      employerRrspMatch: 900,
    });
    expect(year.accountBreakdown).toMatchObject([
      { id: "other", contributions: 0 },
      { id: "work", contributions: 1_800, employmentRrspPersonal: 900, employerRrspMatch: 900 },
    ]);
    expect(year.contributions).toEqual({ rrsp: 1_800, tfsa: 0, nonreg: 0, cash: 9_100 });
    expect(year.rrspRoom).toBe(162);
    expect(year.taxableIncome).toBe(9_100);
  });

  it("prioritizes fixed company deposits across streams and does not use company benefits to fund their room", () => {
    const input = plan();
    input.accounts.push(rrsp("second"));
    input.incomes[0]!.employmentContribution = { accountId: "work", personal: fixed(100), company: matched() };
    input.incomes.push({
      id: "otherJob",
      kind: "employment",
      annualAmount: 10_000,
      startAge: 40,
      raiseRate: 0,
      employmentContribution: { accountId: "second", personal: fixed(0), company: fixed(10_000) },
    });
    const [first, second] = run(input);
    expect(first?.accountBreakdown).toMatchObject([
      { id: "work", contributions: 0 },
      { id: "second", contributions: 3_600 },
    ]);
    expect(first?.cashflow).toMatchObject({
      employerRrspContribution: 3_600,
      blockedEmployerRrspContribution: 6_400,
      employerRrspMatch: 0,
    });
    expect(first?.rrspRoom).toBe(648);
    expect(second?.cashflow?.employerRrspContribution).toBe(4_248);
  });

  it("uses raised base pay for both percentages and follows linked and ongoing pay schedules", () => {
    const input = plan();
    input.profile.endAge = 42;
    const job = input.incomes[0]!;
    Object.assign(job, {
      bonusRate: 0.5,
      raiseRate: 0.2,
      endAtRetirement: true,
      employmentContribution: { accountId: "work", personal: percent(0.04), company: percent(0.05) },
    });
    const [first, second, retired] = run(input, { retirementAge: 42 });
    expect(first?.income.employment).toBe(15_000);
    expect(second?.income.employment).toBe(18_000);
    expect(first?.cashflow).toMatchObject({ employmentRrspPersonal: 400, employerRrspContribution: 500 });
    expect(second?.cashflow).toMatchObject({ employmentRrspPersonal: 480, employerRrspContribution: 600 });
    expect(retired?.contributions.rrsp).toBe(0);
    job.endAtRetirement = false;
    expect(run(input, { retirementAge: 42 })[2]?.cashflow).toMatchObject({
      employmentRrspPersonal: 576,
      employerRrspContribution: 720,
    });
    job.endAge = 41;
    expect(run(input, { retirementAge: 42 })[2]?.contributions.rrsp).toBe(0);
  });

  it("stops at zero room or RRSP age ineligibility even with employment", () => {
    const input = plan(0);
    input.incomes[0]!.employmentContribution = { accountId: "work", personal: fixed(100), company: fixed(100) };
    expect(run(input)[0]?.contributions.rrsp).toBe(0);
    input.profile = { ...input.profile, birthYear: 1954, currentAge: 72, endAge: 73 };
    input.incomes[0]!.annualAmount = 20_000;
    const year = run(input)[0]!;
    expect(year.contributions.rrsp).toBe(0);
    expect(year.warnings).toContainEqual(expect.stringContaining("RRSP age eligibility"));
  });

  it("counts actual company deposits for CPP and EI and deducts only landed personal contributions", () => {
    const input = plan(65_000, 25_000);
    input.incomes[0]!.employmentContribution = { accountId: "work", personal: fixed(5_000), company: matched() };
    const payroll = { cpp: true, ei: true, cppOptOut65to69: false };
    const year = run(input, { payroll })[0]!;
    const expected = annualPayroll(70_000, 0, 40, payroll, loadTables(tablesJson).payroll, []);
    expect(year.payroll).toEqual(expected);
    expect(year.cashflow).toMatchObject({ employmentRrspPersonal: 5_000, employerRrspMatch: 5_000 });
    expect(year.taxableIncome).toBeCloseTo(60_000 - expected.enhancedCppDeduction, 2);
    expect(year.cashflow!.closingIdleCash).toBeCloseTo(
      65_000 - 5_000 - year.expenses - expected.total - year.tax.total,
      2,
    );
  });

  it("limits personal deposits to own-stream pay and the shared net wage budget without recycling planned draws", () => {
    const input = plan(9_000);
    input.accounts[0]!.balance = 100_000;
    input.incomes.push({
      id: "partTime",
      kind: "employment",
      annualAmount: 1_000,
      startAge: 40,
      raiseRate: 0,
      employmentContribution: { accountId: "work", personal: fixed(10_000), company: matched(0.5) },
    });
    const configured = run(input)[0]!;
    expect(configured.cashflow).toMatchObject({ employmentRrspPersonal: 1_000, employerRrspMatch: 500 });
    const planned = simulate(
      input,
      { ...scenario, withdrawalStrategy: "tax-minimizing" },
      buildDeterministicReturns(returns, 40, 41),
      undefined,
      { strategy: "tax-minimizing", byAge: [], fillTargetTaxable: 20_000 },
    ).years[0]!;
    expect(planned.plannedRrspDraw).toBe(11_000);
    expect(planned.contributions.rrsp).toBe(1_500);
    expect(planned.taxableIncome).toBe(20_000);
  });

  it("caps aggregate personal deposits by net wages even when room has accumulated and withdrawals cover expenses", () => {
    const input = plan(100_000);
    input.profile.endAge = 42;
    input.incomes[0]!.endAge = 40;
    input.accounts[0]!.balance = 50_000;
    input.expenses[0]!.annualAmount = 10_000;
    input.incomes.push({
      id: "partTime",
      kind: "employment",
      annualAmount: 5_000,
      startAge: 41,
      raiseRate: 0,
      employmentContribution: { accountId: "work", personal: fixed(10_000), company: matched() },
    });
    const payroll = { cpp: true, ei: true, cppOptOut65to69: false };
    const baseline = run(input, { payroll })[1]!;
    const landed = baseline.cashflow!.employmentRrspPersonal!;
    expect(landed).toBeGreaterThan(4_000);
    expect(landed).toBeLessThan(5_000);
    expect(baseline.cashflow!.employerRrspMatch).toBe(landed);
    expect(landed).toBeCloseTo(5_000 - baseline.payroll!.total + baseline.payroll!.eiRefund, 2);
    input.expenses[0]!.annualAmount = 100_000;
    const deficit = run(input, { payroll })[1]!;
    expect(deficit.withdrawals.rrsp).toBeGreaterThan(0);
    expect(deficit.cashflow?.employmentRrspPersonal).toBe(landed);
    expect(deficit.cashflow?.employerRrspMatch).toBe(landed);
  });

  it("keeps legacy matches without employment setups and warns on an active overlap", () => {
    const input = plan();
    input.accounts = [
      { ...rrsp("work"), balance: 100 },
      { ...rrsp("other"), balance: 300 },
    ];
    input.savingsPolicy = [{ ...match, perYearCap: 100 }];
    const legacy = run(input)[0]!;
    expect(legacy.contributions.rrsp).toBe(150);
    expect(legacy.taxableIncome).toBe(10_000);
    expect(legacy.accountBreakdown).toMatchObject([
      { contributions: 37.5, employerRrspMatch: 12.5 },
      { contributions: 112.5, employerRrspMatch: 37.5 },
    ]);
    input.incomes[0]!.employmentContribution = { accountId: "work", personal: fixed(100), company: matched() };
    const current = run(input)[0]!;
    expect(current.contributions.rrsp).toBe(300);
    expect(current.cashflow?.employerRrspMatch).toBe(100);
    expect(current.warnings).toContainEqual(expect.stringContaining("legacy RRSP savings match overlaps"));
    input.incomes[0]!.endAtRetirement = true;
    input.incomes.push({ id: "nextJob", kind: "employment", annualAmount: 10_000, startAge: 41, raiseRate: 0 });
    const next = run(input, { retirementAge: 41 })[1]!;
    expect(next.cashflow?.employerRrspMatch).toBe(50);
    expect(next.warnings).not.toContainEqual(expect.stringContaining("legacy RRSP savings match overlaps"));
  });

  it.each(["recovery", "missing", "zero", "personal only"])(
    "retains a legacy match when the employment setup is %s",
    (state) => {
      const input = plan();
      input.savingsPolicy = [{ ...match, perYearCap: 100 }];
      input.incomes[0]!.employmentContribution = {
        accountId: state === "missing" ? "missing" : "work",
        personal: fixed(state === "zero" ? 0 : 100),
        company: state === "personal only" ? fixed(0) : matched(),
        ...(state === "recovery" ? { recovery: { previousSalaryRate: 0.1, previousAnnualCap: 800 } } : {}),
      };
      const year = run(input)[0]!;
      expect(year.cashflow?.employerRrspMatch).toBe(50);
      expect(year.warnings).not.toContainEqual(expect.stringContaining("legacy RRSP savings match overlaps"));
    },
  );

  it("validates nonfinite, out-of-range, fractional-cent rules and employment-only placement", () => {
    const input = plan();
    const job = input.incomes[0]!;
    job.employmentContribution = { accountId: "work", personal: fixed(1.001), company: matched(Infinity) };
    expect(validatePlan(input)).toEqual([
      expect.stringContaining("personal amount"),
      expect.stringContaining("company amount"),
    ]);
    job.kind = "other";
    job.employmentContribution = { accountId: "work", personal: fixed(0), company: percent(0.05) };
    expect(validatePlan(input)).toEqual([expect.stringContaining("requires employment income")]);
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
