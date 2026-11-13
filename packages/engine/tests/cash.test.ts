import { describe, expect, it } from "vitest";
import tablesJson from "../data/tax/ca-2026.json";
import { applyIndexation, loadTables, type TaxYearTables } from "../src/tax/tables";
import { gisAnnual } from "../src/benefits/gis";
import { buildDeterministicReturns } from "../src/returns/deterministic";
import { runMonteCarlo } from "../src/returns/montecarlo";
import { buildHistoricalReturns, runHistorical, type HistoricalReturnObservation } from "../src/returns/historical";
import { simulate } from "../src/simulate";
import type { Plan, ReturnSeries, Scenario } from "../src/types";

const tables: TaxYearTables = loadTables(tablesJson);

const MIXED_RETURNS = { equity: 0.06, bond: 0.03, cash: 0.02 }; // market cash rate 2% != account 5%

function detScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "det",
    name: "Deterministic",
    simMode: "deterministic",
    retirementAge: 65,
    returnAssumptions: MIXED_RETURNS,
    withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
    ...overrides,
  };
}

function detReturns(startAge: number, endAge: number): ReturnSeries {
  return buildDeterministicReturns(MIXED_RETURNS, startAge, endAge);
}

/** Bare plan: single 1000 cash account at 5% unless edited; ages 45-46. */
function cashPlan(edit?: (p: Plan) => void): Plan {
  const p: Plan = {
    profile: { birthYear: 1981, currentAge: 45, province: "ON", endAge: 46 },
    accounts: [{ id: "cash-1", type: "cash", balance: 1000, interestRate: 0.05 }],
    assets: [],
    debts: [],
    incomes: [],
    expenses: [],
    savingsPolicy: [],
  };
  edit?.(p);
  return p;
}

describe("cash accounts — interest truthfulness", () => {
  it("1000 cash @5% with no other flows: 50 interest, taxed, net worth 1050 (credited once, not 1100)", () => {
    const out = simulate(cashPlan(), detScenario(), detReturns(45, 46));
    const y1 = out.years[0]!;
    expect(y1.cashInterest).toBe(50);
    expect(y1.taxableIncome).toBe(50); // ordinary income (BPA keeps tax 0)
    expect(y1.tax.total).toBe(0);
    expect(y1.income).toEqual({ employment: 0, cpp: 0, oas: 0, gis: 0, other: 0 }); // NOT in income
    expect(y1.netWorth).toBe(1050); // single credit: interest is the account credit
    const y2 = out.years[1]!;
    expect(y2.cashInterest).toBe(52.5); // compounding on the credited balance
    expect(y2.balances.cash).toBe(1102.5);
    expect(y2.netWorth).toBe(1102.5);
  });

  it("aggregate cashInterest is cent-rounded across multiple accounts (no float noise in JSON)", () => {
    // 333.33 @5% -> 16.67 credited; 111.11 @5% -> 5.56 credited; raw sum 22.230000000000002.
    const plan = cashPlan((p) => {
      p.accounts = [
        { id: "cash-1", type: "cash", balance: 333.33, interestRate: 0.05 },
        { id: "cash-2", type: "cash", balance: 111.11, interestRate: 0.05 },
      ];
    });
    const out = simulate(plan, detScenario(), detReturns(45, 46));
    expect(out.years[0]!.cashInterest).toBe(22.23); // strict toBe: exact cent
  });

  it("principal withdrawal is untaxed; opening interest is credited before flows", () => {
    // Deficit 500 at age 45: interest accrues on the OPENING 1000 (=50, credited
    // to 1050) BEFORE the 500 draw — end balance 550, not 500 + 25.
    const out = simulate(cashPlan((p) => {
      p.expenses.push({ id: "e", annualAmount: 500, startAge: 45, endAge: 46, inflationRate: 0 });
    }), detScenario(), detReturns(45, 46));
    const y1 = out.years[0]!;
    expect(y1.cashInterest).toBe(50);
    expect(y1.withdrawals.cash).toBe(500);
    expect(y1.balances.cash).toBe(550);
    expect(y1.tax.total).toBe(0); // principal carries no tax; only the (0-tax) interest is income
  });

  it("cash accounts ignore the market return series — deterministic, Monte Carlo and historical paths agree", () => {
    // Deterministic: market cash rate 2% must not touch a 5% cash account.
    const det = simulate(cashPlan(), detScenario(), detReturns(45, 46));
    expect(det.years[1]!.balances.cash).toBe(1102.5);

    const mcScenario = detScenario({
      simMode: "montecarlo",
      mcConfig: { runs: 50, seed: 7, stdDev: { equity: 0.2, bond: 0.1, cash: 0.1 } },
    });
    const mc = runMonteCarlo(cashPlan(), mcScenario);
    expect(mc.percentileNetWorth.p50).toBe(1102.5); // volatile markets leave the fixed rate untouched
    expect(mc.representativeResult.years[1]!.balances.cash).toBe(1102.5);

    const histScenario = detScenario({
      simMode: "historical",
      historicalConfig: { startYear: 2000 },
    });
    const hist = runHistorical(cashPlan(), histScenario);
    expect(hist.percentileNetWorth.p50).toBe(1102.5);
    expect(hist.representativeResult.years[1]!.balances.cash).toBe(1102.5);
  });

  it("zero-interest cash accounts and legacy no-cash plans produce exact legacy result shapes", () => {
    // Zero-rate named cash account: no interest key, no cash flow keys, balance flat.
    const out = simulate(cashPlan((p) => {
      p.accounts[0]!.interestRate = undefined;
    }), detScenario(), detReturns(45, 46));
    const y1 = out.years[0]!;
    expect("cashInterest" in y1).toBe(false);
    expect(y1.cashAccounts).toEqual([{ id: "cash-1", balance: 1000 }]); // named account still reported
    expect(y1.balances.cash).toBe(1000);
    expect(Object.keys(y1.withdrawals)).toEqual(["tfsa", "rrsp", "nonreg"]);

    // Legacy no-cash plan (makePlan-shaped): no optional cash fields anywhere.
    const legacy: Plan = {
      profile: { birthYear: 1981, currentAge: 45, province: "ON", endAge: 46 },
      accounts: [
        { id: "tfsa-1", type: "tfsa", balance: 1000, assetMix: { equity: 1, bond: 0, cash: 0 } },
      ],
      assets: [],
      debts: [],
      incomes: [],
      expenses: [],
      savingsPolicy: [],
    };
    const legacyOut = simulate(legacy, detScenario(), detReturns(45, 46));
    for (const y of legacyOut.years) {
      expect("cashInterest" in y).toBe(false);
      expect("cashAccounts" in y).toBe(false);
      expect(Object.keys(y.withdrawals)).toEqual(["tfsa", "rrsp", "nonreg"]);
      expect(Object.keys(y.contributions)).toEqual(["tfsa", "rrsp", "nonreg"]);
      expect(Object.keys(y.savings)).toEqual(["tfsa", "rrsp", "nonreg", "mortgage"]);
    }
  });
});

describe("cash accounts — deposits, withdrawals, allocation", () => {
  it("employment + cash savings target: deposit credited once to the first named account; next-year interest basis includes it", () => {
    const plan = cashPlan((p) => {
      p.accounts.push({ id: "cash-2", type: "cash", balance: 0, interestRate: 0.05 });
      p.incomes.push({ id: "job", kind: "employment", annualAmount: 50_000, startAge: 45, endAge: 65, raiseRate: 0 });
      p.expenses.push({ id: "e", annualAmount: 30_000, startAge: 45, endAge: 65, inflationRate: 0 });
      p.savingsPolicy.push({ id: "save-cash", priority: 1, target: "cash", perYearCap: 5000 });
    });
    const out = simulate(plan, detScenario(), detReturns(45, 46));
    const y1 = out.years[0]!;
    expect(y1.contributions.cash).toBe(5000); // reported once
    expect(y1.savings.cash).toBe(5000);
    // Proportional among same-type balances: cash-1 holds the only balance, so the
    // deposit lands there (all-zero would take the first account — documented rule).
    // Opening interest (50 on 1000) credits BEFORE the deposit: 1000 + 50 + 5000.
    expect(y1.cashAccounts).toEqual([
      { id: "cash-1", balance: 6050 },
      { id: "cash-2", balance: 0 },
    ]);
    // The only assets are cash: net worth = pool + named, counted once.
    expect(y1.balances.cash).toBe(y1.netWorth);
    const y2 = out.years[1]!;
    expect(y2.cashInterest).toBe(302.5); // 5% of 6050 — basis includes the deposit, credited once
  });

  it("explicit cash position in withdrawalOrder is respected; fallback puts cash first only when the order lacks it", () => {
    const plan = cashPlan((p) => {
      p.accounts = [
        { id: "tfsa-1", type: "tfsa", balance: 3000, assetMix: { equity: 1, bond: 0, cash: 0 } },
        { id: "cash-1", type: "cash", balance: 1000, interestRate: 0 },
      ];
      p.expenses.push({ id: "e", annualAmount: 2000, startAge: 45, endAge: 46, inflationRate: 0 });
    });
    // Explicit: cash LAST — tfsa covers the deficit, cash untouched.
    const explicit = simulate(plan, detScenario({
      withdrawalOrder: ["tfsa", "nonreg", "rrsp", "cash"],
    }), detReturns(45, 46));
    const yExplicit = explicit.years[0]!;
    expect(yExplicit.withdrawals.tfsa).toBe(2000);
    expect(yExplicit.withdrawals.cash).toBeUndefined();
    expect(yExplicit.balances.cash).toBe(1000);

    // Stored legacy 3-type order + named cash present -> engine cash-first fallback.
    const fallback = simulate(plan, detScenario(), detReturns(45, 46));
    const yFallback = fallback.years[0]!;
    expect(yFallback.withdrawals.cash).toBe(1000);
    expect(yFallback.withdrawals.tfsa).toBe(1000);
    expect(yFallback.balances.cash).toBe(0);
  });

  it("withdrawals across multiple named cash accounts are proportional to balances (applyFlows rule)", () => {
    const plan = cashPlan((p) => {
      p.accounts = [
        { id: "cash-1", type: "cash", balance: 600, interestRate: 0 },
        { id: "cash-2", type: "cash", balance: 400, interestRate: 0 },
      ];
      p.expenses.push({ id: "e", annualAmount: 500, startAge: 45, endAge: 46, inflationRate: 0 });
    });
    const out = simulate(plan, detScenario(), detReturns(45, 46));
    const y1 = out.years[0]!;
    expect(y1.withdrawals.cash).toBe(500);
    expect(y1.cashAccounts).toEqual([
      { id: "cash-1", balance: 300 },
      { id: "cash-2", balance: 200 },
    ]);
  });
});

describe("cash accounts — GIS treatment", () => {
  it("prior-year cash interest counts as GIS income; principal withdrawals do not", () => {
    const plan = cashPlan((p) => {
      p.profile.currentAge = 65;
      p.profile.endAge = 66;
    });
    const out = simulate(plan, detScenario(), detReturns(65, 66));
    const y2 = out.years[1]!;
    // Year 2's GIS sees ONLY year 1's interest (50) — no principal, no current interest.
    const yearOffset = Math.max(0, 1981 + 66 - tables.year);
    const expected = gisAnnual(
      66,
      { cpp: 0, rrspRrifWithdrawals: 0, employmentIncome: 0, otherTaxableIncome: 50, tfsaWithdrawals: 0 },
      applyIndexation(tables, yearOffset),
    );
    expect(y2.income.gis).toBe(expected);
    expect(y2.income.gis).toBeGreaterThan(0); // sanity: the assertion is non-trivial
  });
});

describe("cash accounts — validation", () => {
  it("rejects assetMix and negative interestRate on cash accounts", () => {
    expect(() => simulate(cashPlan((p) => {
      (p.accounts[0] as { assetMix?: unknown }).assetMix = { equity: 1, bond: 0, cash: 0 };
    }), detScenario(), detReturns(45, 46))).toThrow(/cash accounts have no assetMix/);
    expect(() => simulate(cashPlan((p) => {
      p.accounts[0]!.interestRate = -0.01;
    }), detScenario(), detReturns(45, 46))).toThrow(/interestRate/);
  });

  it("enforces the withdrawal-order contract: core types exactly once, cash at most once", () => {
    expect(() => simulate(cashPlan(), detScenario({ withdrawalOrder: ["tfsa", "rrsp"] }), detReturns(45, 46)))
      .toThrow(/"nonreg" exactly once/);
    expect(() => simulate(cashPlan(), detScenario({
      withdrawalOrder: ["cash", "tfsa", "nonreg", "rrsp", "cash"],
    }), detReturns(45, 46))).toThrow(/"cash" at most once/);
  });
});

describe("cash accounts — historical mode with market exposure", () => {
  it("historical window returns apply to invested accounts, never to cash accounts", () => {
    const observations: HistoricalReturnObservation[] = [
      { year: 2000, equity: 0.3, bond: 0.2, cash: 0.1 },
      { year: 2001, equity: -0.2, bond: 0.05, cash: 0.05 },
    ];
    const plan = cashPlan((p) => {
      p.accounts.unshift({ id: "tfsa-1", type: "tfsa", balance: 10_000, assetMix: { equity: 1, bond: 0, cash: 0 } });
    });
    const out = simulate(plan, detScenario(), buildHistoricalReturns(observations, 2000, 45, 46));
    const y1 = out.years[0]!;
    expect(y1.balances.tfsa).toBe(13_000); // tfsa takes the 30% equity year
    expect(y1.balances.cash).toBe(1050); // cash takes only its fixed 5%
  });
});

/** (helper removed — use the real buildHistoricalReturns) */
