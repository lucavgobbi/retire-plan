import { describe, expect, it } from "vitest";
import type { RunRecord } from "../../domain/types";
import type { Scenario, SimulationResult } from "@retire-plan/engine";
import { computeComparison } from "./compare";

const result = (finalNetWorth: number, success = true, failureAge?: number, worstShortfallAge?: number): SimulationResult => ({
  years: [
    {
      age: 45,
      income: { employment: 95_000, cpp: 0, oas: 0, gis: 0, other: 0 },
      taxableIncome: 95_000,
      tax: { federal: 13_157.59, provincial: 5_827.02, surtax: 0, oasClawback: 0, total: 18_984.61, marginalRate: 0 },
      withdrawals: { tfsa: 0, rrsp: 0, nonreg: 0 },
      contributions: { tfsa: 0, rrsp: 0, nonreg: 0 },
      savings: { tfsa: 0, rrsp: 0, nonreg: 0, mortgage: 0 },
      expenses: 50_000,
      shortfall: 0,
      balances: { tfsa: 60_000, rrsp: 240_000, nonreg: 90_000, cash: 0, home: 0, debt: 0 },
      netWorth: 390_000,
      tfsaRoom: 7_000,
      rrspRoom: 0,
      events: [],
      warnings: [],
    },
  ],
  summary: { success, failureAge, finalNetWorth, worstShortfallAge },
});

const scenario = (id: string, overrides: Partial<Scenario> = {}): Scenario => ({
  id,
  name: id,
  simMode: "deterministic",
  retirementAge: 65,
  returnAssumptions: { equity: 0.05, bond: 0.02, cash: 0 },
  withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
  ...overrides,
});

const run = (id: string, scenarioId: string | null, summary: SimulationResult, scenarioName = "Base scenario"): RunRecord => ({
  id,
  planId: "plan-test",
  scenarioId,
  scenario: scenario("base", { name: scenarioName }),
  result: summary,
  createdAt: "2026-01-01T00:00:00.000Z",
});

export const baseRun = run("run-1", null, result(660_000));
export const deltaRun = run("run-2", "delta-1", result(590_000, false, 78, 78), "Retire 3 years earlier");

describe("computeComparison", () => {
  it("returns per-run rows with resolved settings and summary", () => {
    const rows = computeComparison([baseRun, deltaRun], null);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.finalNetWorth).toBe(660_000);
    expect(rows[1]?.success).toBe(false);
    expect(rows[1]?.retirementAge).toBe(65); // resolved scenario default
  });

  it("with a baseline, delta columns are absolute and percentage (— for the baseline row)", () => {
    const [b, d] = computeComparison([baseRun, deltaRun], "run-1");
    expect(b?.absDelta).toBeNull(); // baseline vs itself renders —
    expect(d?.absDelta).toBeCloseTo(-70_000, 6);
    expect(d?.pctDelta).toBeCloseTo(100 * (-70_000 / 660_000), 6);
  });

  it("baseline not in selection → no delta value columns (plain table only)", () => {
    const rows = computeComparison([baseRun], "missing");
    expect(rows[0]?.absDelta).toBeNull();
  });

  it("net worth series preserved per row for the overlay chart", () => {
    const rows = computeComparison([baseRun], null);
    expect(rows[0]?.netWorthAtAges).toEqual([{ x: 45, y: 390_000 }]);
  });

  it("keeps ensemble metrics distinct from the representative result path", () => {
    const monteCarlo: RunRecord = {
      ...baseRun,
      scenario: scenario("mc", { simMode: "montecarlo", mcConfig: { runs: 1_000, seed: 1, stdDev: { equity: 0.18, bond: 0.06, cash: 0.02 } } }),
      analysis: { mode: "montecarlo", successRate: 0.72, percentileNetWorth: { p10: 10, p50: 20, p90: 30 }, representativeRun: 500 },
    };
    const row = computeComparison([monteCarlo], null)[0]!;
    expect(row.finalNetWorth).toBe(660_000); // the coherent representative path's result
    expect(row.monteCarlo).toEqual(monteCarlo.analysis); // ensemble summaries remain separate
  });
});
