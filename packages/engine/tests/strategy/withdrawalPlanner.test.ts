import { describe, expect, it } from "vitest";
import tablesJson from "../../data/tax/ca-2026.json";
import { loadTables, type TaxYearTables } from "../../src/tax/tables";
import { buildDeterministicReturns } from "../../src/returns/deterministic";
import { runMonteCarlo, type SimulateFn } from "../../src/returns/montecarlo";
import { runHistorical } from "../../src/returns/historical";
import { simulate as realSimulate } from "../../src/simulate";
import { makePlan } from "../fixtures";
import type { PlannedWithdrawals, Plan, Scenario, SimulationResult } from "../../src/types";

const tables: TaxYearTables = loadTables(tablesJson);
const ZERO = { equity: 0, bond: 0, cash: 0 };

/**
 * The smoothing opportunity the optimizer exists for: a large RRSP left untouched
 * by TFSA-first spending until the 71+ mandatory RRIF minimums force huge taxable
 * spikes. Zero returns/inflation isolate the pure tax-distribution effect; benefit
 * flags off remove GIS/clawback interactions.
 */
function smoothingPlan(expenses: number): Plan {
  const p = makePlan();
  p.profile = { birthYear: 1981, currentAge: 60, province: "ON", endAge: 90 };
  p.accounts = [
    { id: "rrsp-1", type: "rrsp", balance: 2_000_000, assetMix: { equity: 1, bond: 0, cash: 0 } },
    { id: "tfsa-1", type: "tfsa", balance: 1_000_000, assetMix: { equity: 1, bond: 0, cash: 0 } },
  ];
  p.incomes = [];
  p.expenses = [{ id: "living", annualAmount: expenses, startAge: 60, endAge: 90, inflationRate: 0 }];
  p.savingsPolicy = [];
  p.debts = [];
  p.assets = [];
  return p;
}

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "s", name: "S", simMode: "deterministic", retirementAge: 60,
    returnAssumptions: ZERO,
    withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
    benefits: { cpp: false, oas: false, gis: false },
    ...overrides,
  };
}

/**
 * Suppression probe: employment 50k funds 30k spends with surplus, so savings steps
 * execute in planned-draw years and the RRSP-circularity guard is observable.
 */
function suppressionPlan(policy: Plan["savingsPolicy"]): Plan {
  const p = makePlan();
  p.profile = { birthYear: 1981, currentAge: 60, province: "ON", endAge: 90 };
  p.accounts = [
    { id: "rrsp-1", type: "rrsp", balance: 2_000_000, assetMix: { equity: 1, bond: 0, cash: 0 } },
    { id: "tfsa-1", type: "tfsa", balance: 200_000, assetMix: { equity: 1, bond: 0, cash: 0 } },
  ];
  p.incomes = [{ id: "salary", kind: "employment", annualAmount: 50_000, startAge: 60, endAge: 69, raiseRate: 0 }];
  p.expenses = [{ id: "living", annualAmount: 30_000, startAge: 60, endAge: 90, inflationRate: 0 }];
  p.savingsPolicy = policy;
  p.debts = [];
  p.assets = [];
  return p;
}

function simulateRun(plan: Plan, s: Scenario): SimulationResult {
  return realSimulate(plan, s, buildDeterministicReturns(ZERO, plan.profile.currentAge, plan.profile.endAge), tables);
}

/** Delegates to the real stepper while recording every planned-arg pass-through. */
function recordingSimulate() {
  const plannedArgs: (PlannedWithdrawals | undefined)[] = [];
  const stub: SimulateFn = (plan, scenario, returns, tables, planned) => {
    plannedArgs.push(planned);
    return realSimulate(plan, scenario, returns, tables, planned);
  };
  return { stub, plannedArgs };
}

describe("tax-minimizing withdrawal strategy — real efficacy", () => {
  it("strictly lowers total tax by smoothing pre-71 draws (not merely <= baseline)", () => {
    const plan = smoothingPlan(40_000);
    const optimized = simulateRun(plan, { ...scenario(), withdrawalStrategy: "tax-minimizing" });

    expect(optimized.withdrawalPlan).toBeDefined();
    const meta = optimized.withdrawalPlan!;
    expect(meta.status).toBe("optimized");
    expect(meta.comparison.manualSuccess).toBe(true);
    expect(meta.comparison.optimizedSuccess).toBe(true);
    // Real efficacy: a strictly lower tax bill, and a material one (~21% here).
    expect(meta.comparison.optimizedTotalTax).toBeLessThan(meta.comparison.manualTotalTax);
    expect(meta.comparison.optimizedTotalTax).toBeLessThan(meta.comparison.manualTotalTax * 0.9);
    // Invariant: manual-feasible => chosen feasible AND total tax <= manual's.
    expect(meta.comparison.optimizedTotalTax).toBeLessThanOrEqual(meta.comparison.manualTotalTax);
    // Deterministic mode result == the planner's chosen candidate evaluation exactly.
    expect(
      optimized.years.reduce((s, y) => s + y.tax.total, 0),
    ).toBeCloseTo(meta.comparison.optimizedTotalTax, 6);
    // The executed plan: proactive draws pre-71, above the RRIF minimum, all positive.
    const plannedAges = meta.plannedWithdrawals.map((w) => w.age);
    expect(plannedAges.length).toBeGreaterThan(0);
    expect(Math.max(...plannedAges)).toBeLessThanOrEqual(70);
    expect(meta.plannedWithdrawals.every((w) => w.netRrspDraw > 0)).toBe(true);
    // Per-year plannedRrspDraw matches the metadata schedule exactly.
    for (const w of meta.plannedWithdrawals) {
      const y = optimized.years.find((yy) => yy.age === w.age)!;
      expect(y.plannedRrspDraw).toBe(w.netRrspDraw);
    }
    // Smoothing property: every planned year's taxable income lands on the same target.
    const taxables = new Set(
      meta.plannedWithdrawals.map((w) => optimized.years.find((yy) => yy.age === w.age)!.taxableIncome),
    );
    expect(taxables.size).toBe(1);
    // Years without a planned draw do not carry the field.
    for (const y of optimized.years) {
      if (!plannedAges.includes(y.age)) expect(y.plannedRrspDraw).toBeUndefined();
    }
    // Disclosed tradeoffs: final wealth and GIS totals are reported, not hidden.
    expect(typeof meta.comparison.optimizedFinalNetWorth).toBe("number");
    expect(meta.comparison.optimizedGisTotal).toBe(0); // benefits off
    expect(meta.planningBasis).toMatch(/no per-path lookahead/);
  });

  it("suppresses only employee rrsp savings steps in planned-draw years; tfsa continues", () => {
    const plan = suppressionPlan([
      { id: "rrsp-s", priority: 1, target: "rrsp", perYearCap: 10_000 },
      { id: "tfsa-s", priority: 2, target: "tfsa", perYearCap: 7_000 },
    ]);
    const manual = simulateRun(plan, { ...scenario(), withdrawalStrategy: "manual" });
    const optimized = simulateRun(plan, { ...scenario(), withdrawalStrategy: "tax-minimizing" });
    const meta = optimized.withdrawalPlan!;
    expect(meta.status).toBe("optimized");
    const plannedAges = new Set(meta.plannedWithdrawals.map((w) => w.age));
    const sample = optimized.years.find((y) => plannedAges.has(y.age) && y.shortfall === 0)!;
    const sampleManual = manual.years.find((y) => y.age === sample.age)!;
    // Circular re-deposit prevented: the same cash must not flow RRSP -> out -> RRSP.
    expect(sample.plannedRrspDraw!).toBeGreaterThan(0);
    expect(sample.contributions.rrsp).toBe(0);
    expect(sampleManual.contributions.rrsp).toBeGreaterThan(0); // manual keeps contributing
    // Other savings steps are untouched: TFSA reinvestment continues.
    expect(sample.contributions.tfsa).toBeGreaterThan(0);
  });

  it("rrsp-match (employer) steps are NOT suppressed by the circularity guard", () => {
    const plan = suppressionPlan([
      { id: "match-s", priority: 1, target: "rrsp-match", matchRate: 0.5 },
      { id: "tfsa-s", priority: 2, target: "tfsa", perYearCap: 7_000 },
    ]);
    const optimized = simulateRun(plan, { ...scenario(), withdrawalStrategy: "tax-minimizing" });
    const meta = optimized.withdrawalPlan!;
    expect(meta.status).toBe("optimized");
    const plannedAges = new Set(meta.plannedWithdrawals.map((w) => w.age));
    const sample = optimized.years.find((y) => plannedAges.has(y.age) && y.shortfall === 0)!;
    expect(sample.plannedRrspDraw!).toBeGreaterThan(0);
    expect(sample.contributions.rrsp).toBeGreaterThan(0); // employer match still lands
  });

  it("manual and legacy (absent strategy) are byte-identical, with no optimizer fields", () => {
    const plan = smoothingPlan(40_000);
    const legacy = simulateRun(plan, { ...scenario(), benefits: undefined }); // absent = legacy
    const manual = simulateRun(plan, { ...scenario(), benefits: undefined, withdrawalStrategy: "manual" });
    const explicitBenefits = simulateRun(plan, {
      ...scenario(),
      benefits: { cpp: true, oas: true, gis: true },
      withdrawalStrategy: "manual",
    });
    expect(legacy).toEqual(manual);
    expect(manual).toEqual(explicitBenefits);
    expect(manual.withdrawalPlan).toBeUndefined();
    expect(manual.years.every((y) => y.plannedRrspDraw === undefined)).toBe(true);
  });
});

describe("planning happens once and is replayed without lookahead", () => {
  it("montecarlo: every path receives the SAME policy object (planning never repeated per path)", () => {
    const plan = smoothingPlan(40_000);
    const scenarioMc: Scenario = {
      ...scenario({ withdrawalStrategy: "tax-minimizing" }),
      mcConfig: { runs: 3, stdDev: { equity: 0.18, bond: 0.05, cash: 0.01 }, seed: 42 },
    };
    const { stub, plannedArgs } = recordingSimulate();
    const summary = runMonteCarlo(plan, scenarioMc, tables, stub);

    // Per-path simulates go through the injected stub (the planner's own candidate
    // evaluation uses the real stepper directly): exactly `runs` calls, every one
    // receiving the SAME fixed policy object — planning is not repeated per path.
    expect(plannedArgs.length).toBe(3);
    const runArgs = plannedArgs;
    expect(runArgs.every((a) => a !== undefined)).toBe(true);
    // Non-anticipativity: every path replays the SAME fixed policy object.
    expect(runArgs.every((a) => a === runArgs[0])).toBe(true);
    // Metadata attached exactly once, to the representative copy and the summary.
    expect(summary.withdrawalPlan).toBeDefined();
    expect(summary.representativeResult.withdrawalPlan).toBe(summary.withdrawalPlan);
    expect(summary.withdrawalPlan!.plannedWithdrawals.length).toBeGreaterThan(0);
  });

  it("historical: plan computed once, the SAME policy replayed on every window", () => {
    const plan = smoothingPlan(40_000);
    const scenarioHist: Scenario = {
      ...scenario({ withdrawalStrategy: "tax-minimizing" }),
      historicalConfig: { startYear: 1980 }, // 11 fitting windows of the 31-year horizon
    };
    const { stub, plannedArgs } = recordingSimulate();
    const summary = runHistorical(plan, scenarioHist, undefined, tables, stub);

    // One simulate per window through the stub, every one with the SAME policy
    // object — the plan is computed once and replayed, never re-derived per window.
    expect(plannedArgs.length).toBe(11);
    const runArgs = plannedArgs;
    expect(runArgs.every((a) => a !== undefined && a === runArgs[0])).toBe(true);
    expect(summary.withdrawalPlan).toBeDefined();
    expect(summary.representativeResult.withdrawalPlan).toBe(summary.withdrawalPlan);
  });

  it("benchmark: 50-run montecarlo replays the SAME policy object on every path (bounded one-time planning)", () => {
    const plan = smoothingPlan(40_000);
    const scenarioMc: Scenario = {
      ...scenario({ withdrawalStrategy: "tax-minimizing" }),
      mcConfig: { runs: 50, stdDev: { equity: 0.18, bond: 0.05, cash: 0.01 }, seed: 7 },
    };
    const { stub, plannedArgs } = recordingSimulate();
    const summary = runMonteCarlo(plan, scenarioMc, tables, stub);
    // The bound is structural: one simulate per run through the stub (the planner's
    // own candidate evaluation uses the real stepper directly), every call receiving
    // the SAME policy object — planning is bounded to a one-time cost, never
    // per-path replanning.
    expect(plannedArgs.length).toBe(50);
    const runArgs = plannedArgs;
    expect(runArgs.every((a) => a !== undefined && a === runArgs[0])).toBe(true);
    expect(summary.withdrawalPlan).toBeDefined();
  });
});
