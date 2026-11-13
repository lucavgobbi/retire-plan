import { describe, expect, it } from "vitest";
import { runHistorical, type HistoricalReturnObservation, type HistoricalSummary } from "../../src/returns/historical";
import { simulate } from "../../src/simulate";
import { loadTables } from "../../src/tax/tables";
import taxJson from "../../data/tax/ca-2026.json";
import type { Plan, Scenario, SimulationResult } from "../../src/types";
import { makePlan } from "../../tests/fixtures";

const tables = loadTables(taxJson);

const observations: HistoricalReturnObservation[] = Array.from({ length: 30 }, (_, index) => ({
  year: 1900 + index,
  equity: 0.04 + (index % 5) * 0.01,
  bond: 0.02,
  cash: 0.01,
}));

function historicalScenario(startYear: number): Scenario {
  return {
    id: "hist",
    name: "Historical scenario",
    simMode: "historical",
    retirementAge: 65,
    returnAssumptions: { equity: 0.05, bond: 0.02, cash: 0 },
    withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
    historicalConfig: { startYear },
  };
}

function shortPlan(): Plan {
  const plan = makePlan();
  plan.profile.currentAge = 45;
  plan.profile.endAge = 50; // 6-year inclusive horizon
  return plan;
}

/** Deterministic stub: one window per call (call order = start-year order), final worth keyed to the start year. */
function stubSimulate(finalFor: (startYear: number) => { success: boolean; finalNetWorth: number; failureAge?: number }) {
  let call = 0;
  const windows: number[] = [];
  const fn = (plan: Plan, _scenario: Scenario, series: { years: { age: number }[] }, _tables: unknown): SimulationResult => {
    void series;
    void _tables;
    const startYear = 1900 + call++;
    windows.push(startYear);
    const outcome = finalFor(startYear);
    return {
      years: [],
      summary: { success: outcome.success, failureAge: outcome.failureAge, finalNetWorth: outcome.finalNetWorth },
    };
  };
  return { fn: fn as unknown as Parameters<typeof runHistorical>[4], windows };
}

describe("runHistorical — rolling-window ensemble", () => {
  it("simulates every fitting window from startYear through the last inclusive fitting year", () => {
    // Horizon 6 years (ages 45..50): windows 1900..(1929-5)=1924 → 25 windows.
    const { fn, windows } = stubSimulate((startYear) => ({ success: true, finalNetWorth: startYear * 1000 }));
    const summary = runHistorical(shortPlan(), historicalScenario(1900), observations, tables, fn);
    expect(windows).toHaveLength(25);
    expect(summary.windowStartYears).toEqual(Array.from({ length: 25 }, (_, i) => 1900 + i));
    expect(summary.windowStartYears.at(-1)).toBe(1924);
    expect(summary.windowStartYears).toHaveLength(25);
  });

  it("percentiles are nearest-rank over per-window finals and successRate is exact", () => {
    const finals = new Map<number, number>([
      [1900, 100], [1901, 300], [1902, 200], [1903, 500], [1904, 400],
    ]);
    const successes = new Set([1900, 1901, 1902, 1903]);
    const { fn } = stubSimulate((startYear) => ({
      success: successes.has(startYear),
      finalNetWorth: finals.get(startYear) ?? 0,
      failureAge: successes.has(startYear) ? undefined : 80,
    }));
    const plan = makePlan();
    plan.profile.currentAge = 45;
    plan.profile.endAge = 45; // 1-year horizon over 5 covered years → 1900..1904 → 5 windows
    const summary = runHistorical(plan, historicalScenario(1900), observations.slice(0, 5), tables, fn);
    expect(summary.percentileNetWorth).toEqual({ p10: 100, p50: 300, p90: 400 }); // nearest-rank: floor(0.9·4)=3 → 400
    expect(summary.successRate).toBe(4 / 5);
    expect(summary.sampleFailureAge).toBe(80);
  });

  it("representative run is an actual median window with its calendar-year provenance", () => {
    const finals = new Map<number, number>([
      [1900, 100], [1901, 500], [1902, 200], [1903, 400], [1904, 300],
    ]);
    const { fn } = stubSimulate((startYear) => ({ success: true, finalNetWorth: finals.get(startYear) ?? 0 }));
    const plan = makePlan();
    plan.profile.currentAge = 45;
    plan.profile.endAge = 45;
    const summary = runHistorical(plan, historicalScenario(1900), observations.slice(0, 5), tables, fn);
    expect(summary.representativeStartYear).toBe(1904);
    expect(summary.representativeEndYear).toBe(1904);
    expect(summary.representativeWindow).toBe(5);
    expect(summary.representativeResult.summary.finalNetWorth).toBe(finals.get(1904));
  });

  it("the representative result is a full coherent simulation, not a stub blend", () => {
    const plan = shortPlan();
    const summary = runHistorical(plan, historicalScenario(1900), observations, tables, simulate);
    expect(summary.representativeResult.years).toHaveLength(6);
    expect(summary.representativeResult.years[0]!.age).toBe(45);
    expect(summary.representativeResult.summary).toBeDefined();
  });

  it("rejects start years outside coverage, over-long horizons, and non-fitting requests without wrapping", () => {
    expect(() => runHistorical(shortPlan(), historicalScenario(1899), observations, tables, simulate))
      .toThrow(/precedes dataset coverage/);
    const longPlan = makePlan();
    longPlan.profile.currentAge = 45;
    longPlan.profile.endAge = 100; // 56-year horizon > 30 covered years
    expect(() => runHistorical(longPlan, historicalScenario(1900), observations, tables, simulate))
      .toThrow(/longer than dataset coverage/);
    expect(() => runHistorical(shortPlan(), historicalScenario(1925), observations, tables, simulate))
      .toThrow(/latest feasible start year is 1924/);
  });

  it("is deterministic: identical inputs reproduce an identical ensemble", () => {
    const first = runHistorical(shortPlan(), historicalScenario(1872), undefined, tables, simulate) as HistoricalSummary;
    const second = runHistorical(shortPlan(), historicalScenario(1872), undefined, tables, simulate) as HistoricalSummary;
    expect(JSON.stringify(first.percentileNetWorth)).toBe(JSON.stringify(second.percentileNetWorth));
    expect(first.successRate).toBe(second.successRate);
    expect(first.representativeStartYear).toBe(second.representativeStartYear);
  });
});
