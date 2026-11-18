import { describe, expect, it } from "vitest";
import tablesJson from "../data/tax/ca-2026.json";
import {
  applyIndexation,
  buildDeterministicReturns,
  loadTables,
  simulate,
  validateScenarioSettings,
  type PayrollSettings,
  type Plan,
  type Scenario,
} from "../src";

const zeroReturns = { equity: 0, bond: 0, cash: 0 };
const cashMix = { equity: 0, bond: 0, cash: 1 };
const enabled: PayrollSettings = { cpp: true, ei: true, cppOptOut65to69: false };
const disabled: PayrollSettings = { cpp: false, ei: false, cppOptOut65to69: false };
const electOut: PayrollSettings = { ...enabled, cppOptOut65to69: true };
const noDeductions = {
  cppBase: 0, cppAdditional: 0, cpp2: 0, ei: 0, total: 0, enhancedCppDeduction: 0, eiRefund: 0,
};

function salaryPlan(age: number, annualAmount: number): Plan {
  return {
    profile: { birthYear: 2026 - age, currentAge: age, endAge: age + 1, province: "ON" },
    accounts: [],
    assets: [],
    debts: [],
    expenses: [],
    incomes: [{ id: "job", kind: "employment", annualAmount, startAge: age, raiseRate: 0 }],
    savingsPolicy: [],
  };
}

function scenario(payroll?: PayrollSettings, overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "payroll",
    name: "Payroll",
    simMode: "deterministic",
    retirementAge: 65,
    returnAssumptions: zeroReturns,
    withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
    ...(payroll === undefined ? {} : { payroll }),
    ...overrides,
  };
}

function run(plan: Plan, settings: Scenario, planned?: Parameters<typeof simulate>[4]) {
  return simulate(
    plan,
    settings,
    buildDeterministicReturns(zeroReturns, plan.profile.currentAge, plan.profile.endAge),
    undefined,
    planned,
  );
}

describe("employee payroll projections", () => {
  it("withholds on combined wages and bonus once and carries the deductions through tax, savings and RRSP room", () => {
    const plan = salaryPlan(45, 62_500);
    plan.incomes[0]!.bonusRate = 0.16;
    plan.incomes.push({ id: "same-employer", kind: "employment", annualAmount: 7_500, startAge: 45, raiseRate: 0 });
    plan.accounts.push({ id: "savings", type: "nonreg", balance: 0, assetMix: cashMix });
    const year = run(plan, scenario(enabled)).years[0]!;
    expect(year.income.employment).toBe(80_000);
    expect(year.payroll).toEqual({
      cppBase: 3_519.45, cppAdditional: 711, cpp2: 216, ei: 1_123.07,
      total: 5_569.52, enhancedCppDeduction: 927, eiRefund: 0,
    });
    // 80,000 less the enhanced deduction. The credit base is 3,519.45 + 1,123.07.
    expect(year.taxableIncome).toBe(79_073);
    expect(year.tax).toMatchObject({ federal: 9_242.60, provincial: 4_135.26, total: 13_377.85, marginalRate: 0.2965 });
    expect(year.contributions.nonreg).toBe(61_052.63);
    expect(year.rrspRoom).toBe(14_400);
    expect(year.warnings.join(" ")).toMatch(/single Ontario employer.*post-retirement benefits.*EI benefits/);
  });

  it.each([
    [3_499, 0, 0, 0, 57.03],
    [3_500, 0, 0, 0, 57.05],
    [50_000, 2_301.75, 465, 0, 815],
    [74_600, 3_519.45, 711, 0, 1_123.07],
    [85_000, 3_519.45, 711, 416, 1_123.07],
    [120_000, 3_519.45, 711, 416, 1_123.07],
  ])("uses the 2026 thresholds at $%d of earnings", (earnings, cppBase, cppAdditional, cpp2, ei) => {
    const year = run(salaryPlan(45, earnings), scenario(enabled)).years[0]!;
    expect(year.payroll).toMatchObject({ cppBase, cppAdditional, cpp2, ei, eiRefund: 0 });
  });

  it("preserves legacy cash and tax with zero payroll fields and discloses the omission", () => {
    const plan = salaryPlan(45, 50_000);
    const legacy = run(plan, scenario());
    expect(legacy).toEqual(run(plan, scenario(disabled)));
    const year = legacy.years[0]!;
    expect(year.payroll).toEqual(noDeductions);
    expect(year.taxableIncome).toBe(50_000);
    expect(year.netWorth).toBeCloseTo(50_000 - year.tax.total, 2);
    expect(year.warnings).toEqual([
      "CPP and CPP2 payroll deductions are off for this projection.",
      "EI payroll deductions are off for this projection.",
    ]);
  });

  it("keeps CPP and EI independent and ignores pension and other income for withholding", () => {
    const plan = salaryPlan(65, 50_000);
    plan.incomes.push(
      { id: "cpp", kind: "cpp", annualAmount: 5_000, startAge: 65, raiseRate: 0 },
      { id: "oas", kind: "oas", annualAmount: 6_000, startAge: 65, raiseRate: 0 },
      { id: "other", kind: "other", annualAmount: 30_000, startAge: 65, raiseRate: 0 },
    );
    const cpp = run(plan, scenario({ ...disabled, cpp: true })).years[0]!;
    const ei = run(plan, scenario({ ...disabled, ei: true })).years[0]!;
    expect(cpp.payroll).toMatchObject({ cppBase: 2_301.75, cppAdditional: 465, cpp2: 0, ei: 0 });
    expect(ei.payroll).toEqual({ ...noDeductions, ei: 815, total: 815 });
    expect(cpp.income.cpp).toBe(5_000);
    expect(ei.income.cpp).toBe(5_000);
  });

  it("changes CPP at the modeled ages 18 and 70 while continuing EI", () => {
    const early = run(salaryPlan(17, 85_000), scenario(enabled)).years;
    expect(early[0]!.payroll).toMatchObject({ cppBase: 0, cpp2: 0, ei: 1_123.07 });
    expect(early[1]!.payroll).toMatchObject({ cppBase: 3_519.45, cpp2: 416, ei: 1_123.07 });
    expect(early[1]!.warnings.join(" ")).toContain("whole projection years");
    const late = run(salaryPlan(69, 85_000), scenario(enabled)).years;
    expect(late[0]!.payroll).toMatchObject({ cppBase: 3_519.45, cpp2: 416, ei: 1_123.07 });
    expect(late[1]!.payroll).toMatchObject({ cppBase: 0, cpp2: 0, ei: 1_123.07 });
    expect(late[1]!.warnings.join(" ")).toContain("whole projection years");
  });

  it("honours an election only from 65 through 69 while a positive configured CPP pension is paid", () => {
    const plan = salaryPlan(64, 85_000);
    plan.profile.endAge = 70;
    plan.incomes.push({ id: "cpp", kind: "cpp", annualAmount: 500, startAge: 66, endAge: 68, raiseRate: 0 });
    const years = run(plan, scenario(electOut)).years;
    expect(years.map(y => y.payroll?.cpp2)).toEqual([416, 416, 0, 0, 0, 416, 0]);
    expect(years.map(y => y.income.cpp)).toEqual([0, 0, 500, 500, 500, 0, 0]);
    expect(years[1]!.warnings.join(" ")).toContain("CPP opt-out could not apply");
    expect(years[2]!.warnings.join(" ")).not.toContain("CPP opt-out could not apply");
    expect(years.every(y => y.payroll?.ei === 1_123.07)).toBe(true);
    const gated = run(plan, scenario(electOut, { benefits: { cpp: false, oas: true, gis: true } })).years[2]!;
    expect(gated.payroll?.cpp2).toBe(416);
    expect(gated.warnings.join(" ")).toContain("CPP opt-out could not apply");
    plan.incomes[1]!.annualAmount = 0;
    expect(run(plan, scenario(electOut)).years[2]!.payroll?.cpp2).toBe(416);
  });

  it("reconciles EI up to $2,000 into same-year cash with zero credit", () => {
    const plan = salaryPlan(45, 2_000);
    plan.incomes.push({ id: "other", kind: "other", annualAmount: 60_000, startAge: 45, raiseRate: 0 });
    const first = run(plan, scenario(enabled)).years[0]!;
    const baseline = run(plan, scenario(disabled)).years[0]!;
    expect(first.payroll).toEqual({ ...noDeductions, ei: 32.60, total: 32.60, eiRefund: 32.60 });
    expect(first.tax).toEqual(baseline.tax);
    expect(first.netWorth).toBe(baseline.netWorth);
    plan.incomes[0]!.annualAmount = 2_001;
    const over = run(plan, scenario(enabled)).years[0]!;
    expect(over.payroll).toMatchObject({ ei: 32.62, eiRefund: 0 });
    expect(over.tax.total).toBeLessThan(run(plan, scenario(disabled)).years[0]!.tax.total);
  });

  it("applies the EI refund threshold to cent-rounded combined employment and bonus", () => {
    const plan = salaryPlan(45, 1_024.13);
    plan.incomes[0]!.bonusRate = 0.1;
    plan.incomes.push(
      { id: "second", kind: "employment", annualAmount: 873.46, startAge: 45, raiseRate: 0 },
      { id: "other", kind: "other", annualAmount: 60_000, startAge: 45, raiseRate: 0 },
    );
    // $1,024.13 + $102.41 bonus + $873.46 sums to 2000.0000000000002 in JS.
    const atLimit = run(plan, scenario(enabled)).years[0]!;
    const baseline = run(plan, scenario(disabled)).years[0]!;
    expect(atLimit.income.employment).toBe(2_000);
    expect(atLimit.payroll).toMatchObject({ ei: 32.60, eiRefund: 32.60 });
    expect(atLimit.tax).toEqual(baseline.tax);
    expect(atLimit.balances.cash).toBe(baseline.balances.cash);

    plan.incomes[1]!.annualAmount = 873.47;
    const aboveLimit = run(plan, scenario(enabled)).years[0]!;
    expect(aboveLimit.income.employment).toBe(2_000.01);
    expect(aboveLimit.payroll).toMatchObject({ ei: 32.60, eiRefund: 0 });
  });

  it("uses enhanced CPP in the existing OAS recovery income base", () => {
    const plan = salaryPlan(65, 92_000);
    plan.incomes.push({ id: "oas", kind: "oas", annualAmount: 6_000, startAge: 65, raiseRate: 0 });
    const year = run(plan, scenario(enabled)).years[0]!;
    expect(year.income.oas).toBe(6_000);
    expect(year.taxableIncome).toBe(96_873);
    expect(year.tax.oasClawback).toBe(232.50); // (96,873 − 95,323) × 15%
    // The diagnostic adds a $100 RRSP draw, which also gets the modeled pension credit at age 65.
    expect(year.tax.marginalRate).toBe(0.3275);
  });

  it("uses net eligible payroll amounts once in the GIS employment-income calculation", () => {
    const plan = salaryPlan(65, 10_000);
    const withPayroll = run(plan, scenario(enabled)).years[0]!;
    const without = run(plan, scenario(disabled)).years[0]!;
    expect(withPayroll.income.employment).toBe(10_000);
    expect(withPayroll.payroll?.total).toBe(549.75);
    expect(withPayroll.income.gis - without.income.gis).toBeCloseTo(274.88, 8);
  });

  it.each(["rrsp", "nonreg"] as const)("funds the net payroll cost through %s deficit withdrawals with tax", type => {
    const plan = salaryPlan(45, 80_000);
    plan.accounts.push({
      id: type, type, balance: 100_000, assetMix: cashMix,
      ...(type === "nonreg" ? { bookValue: 60_000 } : {}),
    });
    plan.expenses.push({ id: "living", annualAmount: 75_000, inflationRate: 0, startAge: 45 });
    const year = run(plan, scenario(enabled)).years[0]!;
    const draw = year.withdrawals[type];
    expect(draw).toBeGreaterThan(run(plan, scenario(disabled)).years[0]!.withdrawals[type]);
    const extraTaxable = type === "rrsp" ? draw : draw * 0.4 * 0.5;
    expect(year.taxableIncome).toBeCloseTo(79_073 + extraTaxable, 1);
    expect(80_000 + draw - 75_000 - 5_569.52 - year.tax.total).toBeCloseTo(0, 2);
    expect(year.shortfall).toBe(0);
  });

  it.each([
    { first: "nonreg", second: "rrsp", rrspBalance: 100_000, nonregDraw: 20_000, rrspDraw: 2_071.42, tax: 8_489.67 },
    { first: "rrsp", second: "nonreg", rrspBalance: 5_000, nonregDraw: 17_581.15, rrspDraw: 5_000, tax: 8_999.40 },
  ] as const)("conserves cash and prices the combined tax with $first before $second", fixture => {
    const plan = salaryPlan(45, 50_000);
    plan.accounts.push(
      { id: "nonreg", type: "nonreg", balance: 20_000, bookValue: 0, assetMix: cashMix },
      { id: "rrsp", type: "rrsp", balance: fixture.rrspBalance, assetMix: cashMix },
    );
    plan.expenses.push({ id: "living", annualAmount: 60_000, inflationRate: 0, startAge: 45 });
    const year = run(plan, scenario(enabled, { withdrawalOrder: [fixture.first, fixture.second, "tfsa"] })).years[0]!;
    expect(year.payroll?.total).toBe(3_581.75);
    expect(year.withdrawals).toEqual({ nonreg: fixture.nonregDraw, rrsp: fixture.rrspDraw, tfsa: 0 });
    // Tax at the 2026 federal and Ontario brackets on wages − $465 enhanced CPP
    // + half of the zero-basis sale + the RRSP withdrawal, with both payroll credits.
    expect(year.taxableIncome).toBeCloseTo(49_535 + fixture.nonregDraw / 2 + fixture.rrspDraw, 1);
    expect(year.tax.total).toBe(fixture.tax);
    expect(50_000 + fixture.nonregDraw + fixture.rrspDraw - 60_000 - 3_581.75 - year.tax.total).toBeCloseTo(0, 2);
    expect(year.balances.cash).toBe(0);
    expect(year.shortfall).toBe(0);
  });

  it("prices a non-registered withdrawal after counting the already funded proactive RRSP draw", () => {
    const plan = salaryPlan(45, 50_000);
    plan.accounts.push(
      { id: "nonreg", type: "nonreg", balance: 25_000, bookValue: 0, assetMix: cashMix },
      { id: "rrsp", type: "rrsp", balance: 100_000, assetMix: cashMix },
    );
    plan.expenses.push({ id: "living", annualAmount: 60_000, inflationRate: 0, startAge: 45 });
    const settings = scenario(enabled, { withdrawalStrategy: "tax-minimizing" });
    const year = run(plan, settings, { strategy: "tax-minimizing", fillTargetTaxable: 54_535, byAge: [] }).years[0]!;
    expect(year.plannedRrspDraw).toBe(5_000);
    expect(year.withdrawals).toEqual({ nonreg: 17_581.15, rrsp: 5_000, tfsa: 0 });
    expect(year.tax.total).toBe(8_999.40);
    expect(year.balances.cash).toBe(0);
    expect(year.shortfall).toBe(0);
  });

  it("fully draws a capped non-registered balance when a capital loss reduces tax but leaves a deficit", () => {
    const plan = salaryPlan(45, 50_000);
    plan.incomes[0]!.startAge = 46;
    plan.accounts.push(
      { id: "nonreg", type: "nonreg", balance: 15_000, bookValue: 21_000, assetMix: cashMix },
      { id: "rrsp", type: "rrsp", balance: 100_000, assetMix: cashMix },
    );
    plan.assets.push({ id: "sale", kind: "other", value: 5_000, appreciationRate: 1, sellEvent: { age: 46, costsPct: 0 } });
    plan.expenses.push({ id: "living", annualAmount: 80_000, inflationRate: 0, startAge: 46 });
    const year = run(plan, scenario(enabled)).years[1]!;
    // The sale adds $10,000 at cost. Liquidating the combined $25,000 account
    // realizes a $6,000 loss, which offsets the $5,000 gain from the asset sale.
    expect(year.withdrawals.nonreg).toBe(25_000);
    expect(year.balances.nonreg).toBe(0);
    expect(year.taxableIncome).toBeCloseTo(49_535 + year.withdrawals.rrsp, 1);
    expect(50_000 + 25_000 + year.withdrawals.rrsp - 80_000 - 3_581.75 - year.tax.total).toBeCloseTo(0, 2);
    expect(year.shortfall).toBe(0);
  });

  it("funds a small deficit with a partial sale when a large capital loss reduces tax sharply", () => {
    const plan = salaryPlan(44, 50_000);
    plan.profile.birthYear = 1981;
    plan.incomes[0]!.startAge = 45;
    plan.accounts.push({ id: "nonreg", type: "nonreg", balance: 1_000, bookValue: 201_000, assetMix: cashMix });
    plan.assets.push({ id: "sale", kind: "other", value: 5_000, appreciationRate: 1, sellEvent: { age: 45, costsPct: 0 } });
    plan.expenses.push({ id: "living", annualAmount: 40_668.69, inflationRate: 0, startAge: 45 });
    const year = run(plan, scenario(enabled)).years[1]!;
    // In 2026 the asset sale contributes $10,000 of proceeds and $5,000 of gains.
    // A $146.42 non-reg draw offsets enough of that gain to save $253.58 in
    // income tax, jointly funding the original $400 gap.
    expect(year.withdrawals.nonreg).toBe(146.42);
    expect(year.tax.total).toBe(5_895.98);
    expect(year.balances.nonreg).toBe(10_853.58);
    expect(year.balances.cash).toBe(0);
    expect(year.shortfall).toBe(0);
    expect(year.income.employment + year.withdrawals.nonreg - year.expenses - year.payroll!.total - year.tax.total).toBeCloseTo(0, 2);
  });

  it("fills the optimizer target after the enhanced CPP deduction and reports payroll-aware comparisons", () => {
    const plan = salaryPlan(65, 80_000);
    plan.accounts.push({ id: "rrsp", type: "rrsp", balance: 500_000, assetMix: cashMix });
    const settings = scenario(enabled, { withdrawalStrategy: "tax-minimizing" });
    const explicit = run(plan, settings, { strategy: "tax-minimizing", fillTargetTaxable: 90_000, byAge: [] }).years[0]!;
    expect(explicit.plannedRrspDraw).toBe(10_927);
    expect(explicit.taxableIncome).toBe(90_000);
    const manual = run(plan, scenario(enabled));
    const optimized = run(plan, settings);
    expect(optimized.withdrawalPlan?.comparison.manualTotalTax).toBeCloseTo(
      manual.years.reduce((total, year) => total + year.tax.total, 0), 2,
    );
    expect(optimized.withdrawalPlan?.comparison.optimizedTotalTax).toBeCloseTo(
      optimized.years.reduce((total, year) => total + year.tax.total, 0), 2,
    );
    expect(optimized.years[0]!.payroll).toEqual(manual.years[0]!.payroll);
  });
});

describe("payroll settings and table validation", () => {
  it("accepts absent and explicit settings but rejects incomplete or non-boolean settings", () => {
    expect(validateScenarioSettings({})).toEqual([]);
    expect(validateScenarioSettings({ payroll: enabled })).toEqual([]);
    for (const payroll of [null, { cpp: true, ei: false }, { ...enabled, ei: "yes" }, { ...enabled, cpp2: true }]) {
      expect(validateScenarioSettings({ payroll: payroll as PayrollSettings })[0]).toContain("payroll");
    }
  });

  it("keeps the 2026 payroll rates and limits fixed through the existing tax-table indexation", () => {
    const tables = loadTables(tablesJson);
    const indexed = applyIndexation(tables, 10);
    expect(indexed.federal.brackets[1]!.threshold).toBeGreaterThan(tables.federal.brackets[1]!.threshold);
    expect(indexed.payroll).toEqual(tables.payroll);
    expect(() => loadTables({
      ...tablesJson, payroll: { ...tablesJson.payroll, cppSecondCeiling: 70_000 },
    })).toThrow(/payroll CPP.*strictly ascending/);
  });

  it("retains compatibility with older custom tables until payroll is enabled", () => {
    const { payroll: _unused, ...oldTable } = tablesJson;
    const tables = loadTables(oldTable);
    const plan = salaryPlan(45, 50_000);
    const returns = buildDeterministicReturns(zeroReturns, 45, 46);
    expect(simulate(plan, scenario(), returns, tables).years[0]!.payroll).toEqual(noDeductions);
    expect(() => simulate(plan, scenario(enabled), returns, tables)).toThrow(/employee payroll parameters are required/);
  });
});
