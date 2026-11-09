import { describe, expect, it } from "vitest";
import tablesJson from "../data/tax/ca-2026.json";
import { loadTables, type TaxYearTables } from "../src/tax/tables";
import {
  federalTax,
  taxableIncome,
  type IncomeForTax,
} from "../src/tax/federal";
import { ontarioTax } from "../src/tax/ontario";
import { oasClawback } from "../src/tax/oasClawback";
import { mortgageYear } from "../src/mortgage";
import { buildDeterministicReturns } from "../src/returns/deterministic";
import { runMonteCarlo } from "../src/returns/montecarlo";
import { simulate } from "../src/simulate";
import { makePlan } from "./fixtures";
import type { Plan, ReturnSeries, Scenario, YearResult } from "../src/types";
import type { AccountPlan } from "../src/types";

const tables: TaxYearTables = loadTables(tablesJson);

const ZERO_RETURNS = { equity: 0, bond: 0, cash: 0 };
const MIXED_RETURNS = { equity: 0.06, bond: 0.03, cash: 0.02 };

function detScenario(retirementAge: number, returns = ZERO_RETURNS): Scenario {
  return {
    id: "det",
    name: "Deterministic",
    simMode: "deterministic",
    retirementAge,
    returnAssumptions: returns,
    withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
  };
}

function detReturns(startAge: number, endAge: number, assumptions = ZERO_RETURNS): ReturnSeries {
  return buildDeterministicReturns(assumptions, startAge, endAge);
}

/** Clone of makePlan with surgical edits applied. */
function plan(edit: (p: Plan) => void): Plan {
  const p = makePlan();
  edit(p);
  return p;
}

/** Combined 2026 tax on an income shape (the already-tested unit engines). */
function combinedTax(income: IncomeForTax): {
  federal: number;
  provincial: number;
  surtax: number;
  oasClawback: number;
  total: number;
} {
  const fed = federalTax(income, tables);
  const ont = ontarioTax(income, tables);
  const taxable = taxableIncome(income);
  // Matches the stepper contract: the OAS recovery tax applies only at 65+.
  const claw = income.age >= 65 ? oasClawback(taxable, tables) : 0;
  const total = fed.tax + ont.total + claw;
  return { federal: fed.tax, provincial: ont.tax, surtax: ont.surtax, oasClawback: claw, total };
}

function initialBalances(p: Plan): YearResult["balances"] {
  const bal = { tfsa: 0, rrsp: 0, nonreg: 0, home: 0, debt: 0 };
  for (const a of p.accounts) bal[a.type] += a.balance;
  for (const home of p.assets.filter((x) => x.kind === "primary-home")) bal.home += home.value;
  const m = p.debts[0];
  if (m) bal.debt = m.balance;
  return bal;
}

/**
 * Solvent variant of the golden fixture: verified economics (see ledger rulings) —
 * cpp+oas from 65, expenses at 1% inflation trimmed to 45k so taxed RRSP draws can
 * fund the 45→95 horizon at the 6/3/2 return mix.
 */
function healthyPlan(): Plan {
  const p = makePlan();
  p.incomes.push(
    { id: "cpp", kind: "cpp", annualAmount: 8_000, startAge: 65, raiseRate: 0.02 },
    { id: "oas", kind: "oas", annualAmount: 8_000, startAge: 65, raiseRate: 0.02 },
  );
  for (const e of p.expenses) {
    e.inflationRate = 0.01;
    e.annualAmount = 45_000;
  }
  return p;
}

function blended(mix: { equity: number; bond: number; cash: number }, r: { equity: number; bond: number; cash: number }): number {
  return mix.equity * r.equity + mix.bond * r.bond + mix.cash * r.cash;
}

function run(plan_: Plan, scen: Scenario = detScenario(65), assumptions = ZERO_RETURNS) {
  return simulate(plan_, scen, detReturns(plan_.profile.currentAge, plan_.profile.endAge, assumptions));
}

describe("simulate — focused, hand-checked cases", () => {
  it("a simple employed plan: income, tax, expenses, default surplus to non-registered", () => {
    const p = plan((x) => {
      x.profile.currentAge = 40;
      x.profile.endAge = 42;
      x.accounts = [{ id: "nr", type: "nonreg", balance: 0, assetMix: { equity: 0, bond: 0, cash: 1 } }];
      x.assets = [];
      x.debts = [];
      x.incomes = [{ id: "job", kind: "employment", annualAmount: 120_000, startAge: 40, raiseRate: 0 }];
      x.expenses = [{ id: "life", name: "Life", annualAmount: 80_000, startAge: 40, inflationRate: 0 }];
      x.savingsPolicy = [];
    });
    const out = run(p, detScenario(65), ZERO_RETURNS);
    expect(out.years).toHaveLength(3); // ages 40, 41, 42
    const y = out.years[0]!;
    expect(y.age).toBe(40);
    expect(y.income.employment).toBe(120_000);
    expect(y.expenses).toBe(80_000);
    const t = combinedTax({ employmentIncome: 120_000, otherTaxableIncome: 0, rrspWithdrawals: 0, pensionEligibleIncome: 0, capitalGains: 0, dividendsEligible: 0, age: 40 });
    expect(y.tax.total).toBeCloseTo(t.total, 2);
    // Surplus flows to non-registered by default (empty policy), after tax + expenses.
    expect(y.contributions.nonreg).toBeCloseTo(120_000 - t.total - 80_000, 2);
    expect(y.balances.nonreg).toBeCloseTo(120_000 - t.total - 80_000, 2);
    expect(y.netWorth).toBeCloseTo(120_000 - t.total - 80_000, 2);
    // TFSA room: seeded with the 2026 cumulative (includes the 2026 limit) + one more limit.
    expect(y.tfsaRoom).toBe(tables.tfsa.cumulativeRoomAsOf2026 + tables.tfsa.annualLimit);
    // RRSP room: 18% of earned income, first year carryforward 0.
    expect(y.rrspRoom).toBeCloseTo(tables.rrsp.incomeRate * 120_000, 8);
    expect(y.withdrawals).toEqual({ tfsa: 0, rrsp: 0, nonreg: 0 });
    expect(y.shortfall).toBe(0);
    expect(y.warnings).toEqual([]);
  });

  it("retirement, CPP/OAS start events, and GIS for a 65-year-old retiree", () => {
    const p = plan((x) => {
      x.profile.currentAge = 65;
      x.profile.endAge = 66;
      x.accounts = [
        { id: "rrsp", type: "rrsp", balance: 200_000, assetMix: { equity: 0, bond: 0, cash: 1 } },
        { id: "nr", type: "nonreg", balance: 0, assetMix: { equity: 0, bond: 0, cash: 1 } },
      ];
      x.assets = [];
      x.debts = [];
      x.incomes = [
        { id: "cpp", kind: "cpp", annualAmount: 8_000, startAge: 65, raiseRate: 0 },
        { id: "oas", kind: "oas", annualAmount: 8_000, startAge: 65, raiseRate: 0 },
        { id: "dividend", kind: "other", annualAmount: 2_000, startAge: 65, raiseRate: 0 },
      ];
      x.expenses = [{ id: "life", name: "Life", annualAmount: 12_000, startAge: 65, inflationRate: 0 }];
      x.savingsPolicy = [];
    });
    const out = run(p);
    const y = out.years[0]!;
    expect(y.age).toBe(65);
    expect(y.events).toContain("retirement");
    expect(y.events).toContain("cpp-start");
    expect(y.events).toContain("oas-start");
    expect(y.income.cpp).toBe(8_000);
    expect(y.income.oas).toBe(8_000);
    // GIS income = cpp 8,000 + other 2,000 (employment 0, no prior withdrawals).
    expect(y.income.gis).toBeCloseTo(tables.gis.annualMaxSingle - 0.5 * 10_000, 2);
    // CPP and OAS are taxable in reality; the combined engine treats them as other taxable income.
    const t = combinedTax({ employmentIncome: 0, otherTaxableIncome: 18_000, rrspWithdrawals: 0, pensionEligibleIncome: 0, capitalGains: 0, dividendsEligible: 0, age: 65 });
    expect(y.tax.total).toBeCloseTo(t.total, 2);
    expect(y.tax.oasClawback).toBe(0); // far below the recovery threshold
    // Surplus = cpp + oas + other income + GIS - tax - expenses -> default non-registered
    expect(y.contributions.nonreg).toBeCloseTo(18_000 + y.income.gis - t.total - 12_000, 2);
    expect(y.balances.rrsp).toBeCloseTo(200_000, 2); // untouched
  });

  it("an employer-matched policy adds match money to the RRSP and the income-side inflow", () => {
    const p = plan((x) => {
      x.profile.currentAge = 40;
      x.profile.endAge = 42;
      x.accounts = [
        { id: "rrsp", type: "rrsp", balance: 0, assetMix: { equity: 0, bond: 0, cash: 1 } },
        { id: "nr", type: "nonreg", balance: 0, assetMix: { equity: 0, bond: 0, cash: 1 } },
      ];
      x.assets = [];
      x.debts = [];
      x.incomes = [{ id: "job", kind: "employment", annualAmount: 120_000, startAge: 40, raiseRate: 0 }];
      x.expenses = [{ id: "life", name: "Life", annualAmount: 80_000, startAge: 40, inflationRate: 0 }];
      x.savingsPolicy = [{ id: "match", priority: 1, target: "rrsp-match", matchRate: 0.05 }];
    });
    const out = run(p);
    const y = out.years[0]!;
    const tax = combinedTax({ employmentIncome: 120_000, otherTaxableIncome: 0, rrspWithdrawals: 0, pensionEligibleIncome: 0, capitalGains: 0, dividendsEligible: 0, age: 40 }).total;
    const surplus = 120_000 - tax - 80_000;
    expect(y.contributions.rrsp).toBeCloseTo(surplus * 1.05, 1); // employee + 5% employer match
    expect(y.income.other).toBeCloseTo(surplus * 0.05, 1); // match recognized as employer compensation inflow
    // Pension adjustment: the match reduces the earned room AND the used room is netted
    // against the carryforward when the next room is computed. (±0.02: the engine
    // records contributions/match in whole cents and the roll reuses those amounts.)
    const expectedRoom =
      -surplus * 1.05 + tables.rrsp.incomeRate * Math.max(0, 120_000 - surplus * 0.05);
    expect(Math.abs(y.rrspRoom - expectedRoom)).toBeLessThanOrEqual(0.02);
  });

  it("the negative-amortization warning is emitted by the stepper (Task 10 note)", () => {
    const p = plan((x) => {
      x.debts[0]!.monthlyPayment = 100;
    });
    const out = run(p);
    const y = out.years[0]!;
    expect(y.warnings.some((w) => /negative amortization/i.test(w))).toBe(true);
    expect(y.balances.debt).toBeGreaterThan(350_000); // payment cannot cover interest
    expect(y.savings.mortgage).toBe(0);
  });

  it("a home sold per sellEvent: proceeds (net of costs) to non-registered, home zeroed, gain taxed", () => {
    const sellAge = 50;
    const p = plan((x) => {
      x.profile.endAge = 52;
      x.accounts = [{ id: "nr", type: "nonreg", balance: 0, assetMix: { equity: 0, bond: 0, cash: 1 } }];
      x.incomes = [];
      x.expenses = [{ id: "life", name: "Life", annualAmount: 0, startAge: 45, inflationRate: 0 }];
      x.assets[0]!.sellEvent = { age: sellAge, costsPct: 0.05 };
      x.debts = [];
    });
    const out = run(p);
    const sold = out.years.find((y) => y.age === sellAge)!;
    const value = 700_000 * Math.pow(1.02, sellAge - 45);
    const proceeds = value * 0.95;
    const acb = 700_000;
    const gain = Math.max(0, proceeds - acb);
    expect(sold.events).toContain("home-sold");
    expect(sold.balances.home).toBe(0);
    const t = combinedTax({ employmentIncome: 0, otherTaxableIncome: 0, rrspWithdrawals: 0, pensionEligibleIncome: 0, capitalGains: gain, dividendsEligible: 0, age: sellAge });
    // The gain's own tax is funded from the proceeds that same year.
    expect(sold.taxableIncome).toBeCloseTo(0.5 * gain, 2);
    expect(sold.tax.total).toBeCloseTo(t.total, 2);
    expect(sold.withdrawals.nonreg).toBeCloseTo(t.total, 2);
    expect(sold.balances.nonreg).toBeCloseTo(proceeds - t.total, 2);
    // Later years: home stays 0, nonreg persists.
    expect(out.years[out.years.length - 1]!.balances.home).toBe(0);
  });

  it("RRIF minimums are withdrawn from age 71 and always returned to cash flow", () => {
    const p = plan((x) => {
      x.profile.currentAge = 71;
      x.profile.endAge = 73;
      x.accounts = [{ id: "rrsp", type: "rrsp", balance: 400_000, assetMix: { equity: 0, bond: 0, cash: 1 } }];
      x.assets = [];
      x.debts = [];
      x.incomes = [];
      x.expenses = [{ id: "life", name: "Life", annualAmount: 12_000, startAge: 71, inflationRate: 0 }];
      x.savingsPolicy = [];
    });
    const out = run(p, detScenario(70));
    const y71 = out.years[0]!;
    // 5.28% x 400,000 = 21,120, taken regardless of surplus/deficit, counted in rrsp withdrawals.
    expect(y71.withdrawals.rrsp).toBeCloseTo(21_120, 2);
    expect(y71.balances.rrsp).toBeCloseTo(400_000 - 21_120, 2);
    // Income: employment 0; taxable income includes the RRIF draw.
    expect(y71.taxableIncome).toBeCloseTo(21_120, 2);
    expect(y71.income.cpp + y71.income.oas + y71.income.other).toBe(0);
  });
});

describe("simulate — summary semantics", () => {
  it("a healthy plan succeeds with no failureAge", () => {
    const out = run(healthyPlan(), detScenario(65), MIXED_RETURNS);
    expect(out.summary.success).toBe(true);
    expect(out.summary.failureAge).toBeUndefined();
    expect(out.summary.finalNetWorth).toBeGreaterThan(0);
  });

  it("validates the plan first — invalid input throws derive validatePlan errors", () => {
    const bad = plan((x) => {
      x.profile.endAge = 40; // <= currentAge 45
    });
    expect(() => run(bad)).toThrow(/validatePlan/);
    const bad2 = plan((x) => {
      x.profile.currentAge = 0;
    });
    expect(() => run(bad2)).toThrow(/validatePlan/);
  });
});

describe("simulate — run-out (Review Focus #3)", () => {
  it("spendthrift plan with a small RRSP: runs to endAge, post-exhaustion shortfall every year, no NaN", () => {
    const p = plan((x) => {
      x.profile.currentAge = 60;
      x.profile.endAge = 95;
      x.accounts = [{ id: "rrsp", type: "rrsp", balance: 50_000, assetMix: { equity: 0, bond: 0, cash: 1 } }];
      x.assets = [];
      x.debts = [];
      x.incomes = [];
      x.expenses = [{ id: "life", name: "Life", annualAmount: 30_000, startAge: 60, inflationRate: 0 }];
      x.savingsPolicy = [];
    });
    const out = run(p, detScenario(60));
    expect(out.years).toHaveLength(36); // ages 60..95 inclusive
    expect(out.summary.success).toBe(false);
    expect(out.summary.failureAge).toBe(61); // RRSP drained by the taxed draw in year 60
    for (const y of out.years) {
      // No NaN anywhere: every numeric field must be finite.
      const numbers = [
        y.income.employment, y.income.cpp, y.income.oas, y.income.gis, y.income.other,
        y.taxableIncome, y.tax.total, y.expenses, y.shortfall, y.netWorth,
        y.balances.tfsa, y.balances.rrsp, y.balances.nonreg, y.balances.debt,
      ];
      for (const n of numbers) expect(Number.isFinite(n)).toBe(true);
      expect(y.balances.rrsp).toBeGreaterThanOrEqual(0);
    }
    // Post-exhaustion: shortfall each year, RRSP drained. Until 65 the need is the full
    // 30,000; from 65 on full GIS (13,304.88, no other income) covers the rest.
    for (const y of out.years.filter((yy) => yy.age >= 62 && yy.age < 65)) {
      expect(y.shortfall).toBeCloseTo(30_000, 2);
    }
    for (const y of out.years.filter((yy) => yy.age >= 65)) {
      expect(y.shortfall).toBeCloseTo(30_000 - tables.gis.annualMaxSingle, 2);
      expect(y.income.gis).toBeCloseTo(tables.gis.annualMaxSingle, 2);
      expect(y.balances.rrsp).toBe(0);
      expect(y.withdrawals.rrsp).toBe(0);
    }
    for (const y of out.years.filter((yy) => yy.age >= 62 && yy.age < 65)) {
      expect(y.balances.rrsp).toBe(0);
      expect(y.withdrawals.rrsp).toBe(0);
    }
    // Failure age is the first shortfall year.
    expect(out.years.filter((y) => y.shortfall > 0)[0]!.age).toBe(61);
  });
});

describe("simulate — per-year reconciliation property (money cannot leak)", () => {
  it("netWorth change == inflows (income + account growth) - outflows (expenses, tax, mortgage interest), every year", () => {
    const p = healthyPlan();
    const strat = detScenario(65, MIXED_RETURNS);
    const returns = detReturns(45, 95, MIXED_RETURNS);
    const out = simulate(p, strat, returns);

    const rrspMix = p.accounts[0]!.assetMix;
    const tfSaMix = p.accounts[1]!.assetMix;
    const nrMix = p.accounts[2]!.assetMix;
    const debt = p.debts[0]!;
    const home = p.assets[0]!;

    let prevBalances = initialBalances(p);
    let prevNW =
      prevBalances.tfsa + prevBalances.rrsp + prevBalances.nonreg + prevBalances.home - prevBalances.debt;

    for (let i = 0; i < out.years.length; i++) {
      const y = out.years[i]!;
      const r = returns.years[i]!;
      const b = (mix: AccountPlan["assetMix"]) => blended(mix, r);

      const growthTfSa = (prevBalances.tfsa - y.withdrawals.tfsa + y.contributions.tfsa) * b(tfSaMix);
      const growthRrsp = (prevBalances.rrsp - y.withdrawals.rrsp + y.contributions.rrsp) * b(rrspMix);
      const sold = y.events.includes("home-sold");
      const growthNonreg = (prevBalances.nonreg - y.withdrawals.nonreg + y.contributions.nonreg) * b(nrMix);
      const homeGrowth = sold ? 0 : prevBalances.home * home.appreciationRate;
      const mres = mortgageYear({ balance: prevBalances.debt, annualRate: debt.rate, monthlyPayment: debt.monthlyPayment });
      const interest = mres.interest; // prepay (savings.mortgage) applies after the month loop

      const inflows =
        y.income.employment + y.income.cpp + y.income.oas + y.income.other + y.income.gis +
        growthTfSa + growthRrsp + growthNonreg + homeGrowth;
      const outflows = (y.expenses - y.shortfall) + y.tax.total + interest;

      const expectedDebt = Math.max(0, mres.endBalance - y.savings.mortgage);
      const expectedHome = sold ? 0 : prevBalances.home * (1 + home.appreciationRate);
      // No negative balances.
      expect(y.balances.tfsa).toBeGreaterThanOrEqual(-0.005);
      expect(y.balances.rrsp).toBeGreaterThanOrEqual(-0.005);
      expect(y.balances.nonreg).toBeGreaterThanOrEqual(-0.005);
      expect(y.balances.debt).toBeGreaterThanOrEqual(-0.005);
      expect(y.balances.debt).toBeCloseTo(expectedDebt, 0);
      expect(y.balances.home).toBeCloseTo(expectedHome, 0);

      const expectedNW = prevNW + inflows - outflows;
      // Within the plan's $1 storage rounding (per-year cent rounding across ~5 balances
      // can accumulate to a few cents; $1 is the pinned tolerance).
      expect(Math.abs(y.netWorth - expectedNW)).toBeLessThanOrEqual(1);

      prevBalances = y.balances;
      prevNW = y.netWorth;
    }
    expect(out.summary.success).toBe(true);
  });
});

describe("runMonteCarlo — wired to the real stepper (Task 12)", () => {
  it("same seed reproduces an identical aggregate over the real simulation", () => {
    const p = makePlan();
    const scenario: Scenario = {
      ...detScenario(65, MIXED_RETURNS),
      simMode: "montecarlo",
      mcConfig: { runs: 4, stdDev: { equity: 0.1, bond: 0.05, cash: 0.02 }, seed: 2026 },
    };
    const a = runMonteCarlo(p, scenario, tables);
    const b = runMonteCarlo(p, scenario, tables);
    expect(b).toEqual(a);
    expect(a.successRate).toBeGreaterThanOrEqual(0);
    expect(a.successRate).toBeLessThanOrEqual(1);
  });
});
