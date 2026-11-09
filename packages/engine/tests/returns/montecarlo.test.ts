import { describe, expect, it } from "vitest";
import type { TaxYearTables } from "../../src/tax/tables";
import { generateMonteCarloRun, runMonteCarlo, type SimulateFn } from "../../src/returns/montecarlo";
import { seededRandom } from "../../src/returns/seededRandom";
import type { ReturnSeries, Scenario } from "../../src/types";
import { makePlan } from "../fixtures";

const assumptions: Scenario["returnAssumptions"] = { equity: 0.06, bond: 0.03, cash: 0.02 };
const stdDev = { equity: 0.05, bond: 0.03, cash: 0.01 };

// simulate() is Task 12; its absence must not block testing the MC aggregation logic.
// runMonteCarlo accepts any SimulateFn, so a canned stub verifies aggregation without
// the real stepper. (The default simulate wiring lands with Task 12.)

const stubTables = (): TaxYearTables => ({}) as unknown as TaxYearTables;

describe("generateMonteCarloRun", () => {
  it("the same seed reproduces an identical run", () => {
    const a = generateMonteCarloRun(seededRandom(99), assumptions, stdDev, 60, 65);
    const b = generateMonteCarloRun(seededRandom(99), assumptions, stdDev, 60, 65);
    expect(b.years).toEqual(a.years);
  });

  it("emits one year per age from startAge to endAge inclusive", () => {
    const s = generateMonteCarloRun(seededRandom(1), assumptions, stdDev, 60, 65);
    expect(s.years.map((y) => y.age)).toEqual([60, 61, 62, 63, 64, 65]);
  });

  it("deviates from the assumptions (not a constant series)", () => {
    const s = generateMonteCarloRun(seededRandom(5), assumptions, stdDev, 60, 90);
    const equities = new Set(s.years.map((y) => y.equity));
    expect(equities.size).toBeGreaterThan(1);
  });

  it("across 200 seeded runs the mean equity recovers the assumption", () => {
    let total = 0;
    let count = 0;
    for (let seed = 0; seed < 200; seed++) {
      for (const y of generateMonteCarloRun(seededRandom(seed), assumptions, stdDev, 60, 90).years) {
        total += y.equity;
        count++;
      }
    }
    // stdErr of the 6,000-sample mean is ~0.00065; 0.005 tolerance is ~7 sigma.
    expect(total / count).toBeCloseTo(0.06, 2);
  });
});

describe("runMonteCarlo — aggregation over an injected (stub) simulate", () => {
  function stubSimulate(
    outcomes: boolean[],
    failureAge = 80,
  ): { fn: SimulateFn; series: ReturnSeries[] } {
    const series: ReturnSeries[] = [];
    let call = 0;
    const fn: SimulateFn = (_plan, _scenario, s) => {
      series.push(s);
      const ok = outcomes[Math.min(call, outcomes.length - 1)]!;
      call++;
      return {
        years: [],
        summary: {
          success: ok,
          failureAge: ok ? undefined : failureAge,
          finalNetWorth: ok ? 500_000 : -20_000,
        },
      };
    };
    return { fn, series };
  }

  function mcScenario(runs: number, seed = 123): Scenario {
    return {
      id: "mc",
      name: "MC scenario",
      simMode: "montecarlo",
      retirementAge: 65,
      returnAssumptions: assumptions,
      withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
      mcConfig: { runs, stdDev, seed },
    };
  }

  it("aggregates successRate, percentiles, and the first sampleFailureAge", () => {
    // 10 runs, 3 failures -> successRate 0.7; finals: 7 x 500k, 3 x -20k
    const { fn, series } = stubSimulate([true, false, true, false, true, false, true, true, true, true]);
    const out = runMonteCarlo(makePlan(), mcScenario(10), stubTables(), fn);
    expect(series).toHaveLength(10); // simulate ran once per configured run
    expect(out.successRate).toBeCloseTo(0.7, 10);
    // sorted finals: -20,000 x3 then 500,000 x7; nearest-rank idx floor(0.1 * 9) = 0
    expect(out.percentileNetWorth.p10).toBe(-20_000);
    expect(out.percentileNetWorth.p50).toBe(500_000);
    expect(out.percentileNetWorth.p90).toBe(500_000);
    expect(out.sampleFailureAge).toBe(80);
  });

  it("an all-success portfolio yields successRate 1 and sampleFailureAge null", () => {
    const { fn } = stubSimulate([true], 77);
    const out = runMonteCarlo(makePlan(), mcScenario(4), stubTables(), fn);
    expect(out.successRate).toBe(1);
    expect(out.sampleFailureAge).toBeNull();
    for (const p of ["p10", "p50", "p90"] as const) {
      expect(out.percentileNetWorth[p]).toBe(500_000);
    }
  });

  it("each run receives a fresh seeded series (same ages, different draws)", () => {
    const captured: ReturnSeries[] = [];
    const fn: SimulateFn = (_plan, _scenario, s) => {
      captured.push(s);
      return { years: [], summary: { success: true, finalNetWorth: s.years.length * 1_000 } };
    };
    runMonteCarlo(makePlan(), mcScenario(3), stubTables(), fn);
    expect(captured).toHaveLength(3);
    expect(captured[0]!.years.map((y) => y.age)).toEqual(captured[1]!.years.map((y) => y.age));
    // Runs are seeded seed+runIndex, so distinct runs must differ in draw values.
    expect(captured[0]!.years[0]!.equity).not.toBe(captured[1]!.years[0]!.equity);
  });
});
