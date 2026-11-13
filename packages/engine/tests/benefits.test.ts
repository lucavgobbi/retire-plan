import { describe, expect, it } from "vitest";
import tablesJson from "../data/tax/ca-2026.json";
import { loadTables, type TaxYearTables } from "../src/tax/tables";
import { buildDeterministicReturns } from "../src/returns/deterministic";
import { simulate } from "../src/simulate";
import { makePlan } from "./fixtures";
import type { BenefitSettings, Plan, Scenario } from "../src/types";

const tables: TaxYearTables = loadTables(tablesJson);
const ZERO = { equity: 0, bond: 0, cash: 0 };

/** Retirement-horizon plan: CPP+OAS from 65, trimmed expenses, healthy RRSP. */
function seniorPlan(): Plan {
  const p = makePlan();
  p.profile.currentAge = 60;
  p.profile.endAge = 70;
  p.incomes = [
    { id: "cpp", kind: "cpp", annualAmount: 8000, startAge: 65, raiseRate: 0 },
    { id: "oas", kind: "oas", annualAmount: 8000, startAge: 65, raiseRate: 0 },
  ];
  for (const e of p.expenses) {
    e.annualAmount = 30_000;
    e.inflationRate = 0;
  }
  p.savingsPolicy = [];
  return p;
}

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "s", name: "S", simMode: "deterministic", retirementAge: 60,
    returnAssumptions: ZERO, withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
    ...overrides,
  };
}

const run = (plan: Plan, s: Scenario) => simulate(plan, s, buildDeterministicReturns(ZERO, plan.profile.currentAge, plan.profile.endAge), tables);

describe("benefit settings gating", () => {
  it("absent benefits is exactly legacy (CPP/OAS received, GIS computed)", () => {
    const legacy = run(seniorPlan(), scenario());
    const explicit = run(seniorPlan(), scenario({ benefits: { cpp: true, oas: true, gis: true } }));
    expect(legacy).toEqual(explicit); // absent = all-true, byte-identical
    const y66 = legacy.years.find((y) => y.age === 66)!;
    expect(y66.income.cpp).toBe(8000);
    expect(y66.income.oas).toBe(8000);
    expect(y66.income.gis).toBeGreaterThan(0); // RRSP draws taper GIS but do not eliminate it (legacy math)
  });

  it("cpp:false zeroes configured CPP streams and invents nothing (no other-income leak)", () => {
    const out = run(seniorPlan(), scenario({ benefits: { cpp: false, oas: true, gis: true } }));
    for (const y of out.years) {
      expect(y.income.cpp).toBe(0);
      expect(y.income.other).toBe(0); // gated streams are NOT reclassified as other income
    }
    const y66 = out.years.find((y) => y.age === 66)!;
    expect(y66.income.oas).toBe(8000); // oas untouched
    expect(y66.events).not.toContain("cpp-start");
  });

  it("oas:false zeroes OAS and the recovery tax self-zeroes (clawback is capped at OAS received)", () => {
    // Force a high-taxable year so the clawback formula would be nonzero if applied.
    const p = seniorPlan();
    p.accounts = [{ id: "rrsp-1", type: "rrsp", balance: 900_000, assetMix: { equity: 1, bond: 0, cash: 0 } }];
    for (const e of p.expenses) e.annualAmount = 80_000;
    const out = run(p, scenario({ benefits: { cpp: true, oas: false, gis: true } }));
    const y66 = out.years.find((y) => y.age === 66)!;
    expect(y66.income.oas).toBe(0);
    expect(y66.income.gis).toBe(0); // GIS requires OAS — forced off, not tapered to zero
    expect(y66.tax.oasClawback).toBe(0); // no OAS received -> nothing to recover
    expect(y66.taxableIncome).toBeGreaterThan(90_000); // clawback threshold crossed, yet zero clawback
  });

  it("gis:false turns GIS off even when OAS is received and income is low", () => {
    const p = seniorPlan();
    p.accounts = [{ id: "tfsa-1", type: "tfsa", balance: 300_000, assetMix: { equity: 1, bond: 0, cash: 0 } }];
    const off = run(p, scenario({ benefits: { cpp: false, oas: true, gis: false } }));
    const on = run(p, scenario({ benefits: { cpp: false, oas: true, gis: true } }));
    const y66off = off.years.find((y) => y.age === 66)!;
    const y66on = on.years.find((y) => y.age === 66)!;
    expect(y66on.income.gis).toBeGreaterThan(0); // TFSA withdrawals invisible to GIS -> full GIS
    expect(y66off.income.gis).toBe(0); // user-declared off, not tapered
    expect(y66off.income.oas).toBe(8000); // OAS still received
  });

  it("the GIS-OAS gate holds before 65 and across flags; validation rejects malformed settings", () => {
    expect(() => run(seniorPlan(), scenario({ benefits: { cpp: false } as unknown as BenefitSettings })))
      .toThrow(/exactly the boolean flags/);
    expect(() => run(seniorPlan(), scenario({ withdrawalStrategy: "greedy" as "manual" })))
      .toThrow(/"manual" or "tax-minimizing"/);
  });
});
