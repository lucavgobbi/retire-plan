import { describe, expect, it } from "vitest";
import { createDefaultPlan, DEFAULT_SCENARIO_BASE } from "./defaults";
import { runDeterministic, runScenario, type RunAnalysis as RunScenarioAnalysis } from "./run";
import { resolveScenario } from "./scenario";

describe("deterministic domain runner", () => {
  it("returns reproducible age rows without changing the plan or exposing shared output", () => {
    const plan = createDefaultPlan();
    plan.profile.endAge = 47;
    plan.accounts = [{ id: "tfsa", type: "tfsa", balance: 100, assetMix: { equity: 1, bond: 0, cash: 0 } }];
    const before = structuredClone(plan);
    const scenario = resolveScenario(null, DEFAULT_SCENARIO_BASE);
    const first = runDeterministic(plan, scenario);
    const second = runDeterministic(plan, scenario);
    expect(first).toEqual(second);
    expect(first.years.map(year => year.age)).toEqual([45, 46, 47]);
    expect(first.years[0]?.balances.tfsa).toBe(105);
    expect(plan).toEqual(before);
    first.years[0]!.events.push("edited");
    expect(second.years[0]?.events).not.toContain("edited");
  });
  it("surfaces invalid plans and rejects unavailable simulation modes", () => {
    const plan = createDefaultPlan();
    plan.profile.endAge = 20;
    const scenario = resolveScenario(null, DEFAULT_SCENARIO_BASE);
    expect(() => runDeterministic(plan, scenario)).toThrow();
    expect(() => runDeterministic(createDefaultPlan(), { ...scenario, simMode: "montecarlo" })).toThrow("requires deterministic");
  });

  it("runs a reproducible Monte Carlo ensemble and returns one coherent median-near path separately", () => {
    const plan = createDefaultPlan();
    plan.profile.endAge = 47;
    plan.accounts = [{ id: "tfsa", type: "tfsa", balance: 100_000, assetMix: { equity: 1, bond: 0, cash: 0 } }];
    const scenario = { ...resolveScenario(null, DEFAULT_SCENARIO_BASE), simMode: "montecarlo" as const,
      mcConfig: { runs: 7, seed: 45, stdDev: { equity: 0.18, bond: 0.06, cash: 0.02 } } };
    const first = runScenario(plan, scenario);
    const second = runScenario(plan, scenario);
    expect(first.analysis?.mode).toBe("montecarlo");
    expect(first.analysis).toEqual(second.analysis);
    expect(first.result).toEqual(second.result);
    expect(first.result.years.map(year => year.age)).toEqual([45, 46, 47]);
    const mcAnalysis = first.analysis as Extract<RunScenarioAnalysis, { mode: "montecarlo" }>;
    expect(mcAnalysis.representativeRun).toBeGreaterThanOrEqual(1);
    expect(mcAnalysis.representativeRun).toBeLessThanOrEqual(7);
  });

  it("runs a historical rolling-window ensemble with a coherent median window path and window provenance", () => {
    const plan = createDefaultPlan();
    plan.profile.endAge = 47; // 3-year horizon → windows 1872..2018
    plan.accounts = [{ id: "tfsa", type: "tfsa", balance: 100_000, assetMix: { equity: 1, bond: 0, cash: 0 } }];
    const scenario = { ...resolveScenario(null, DEFAULT_SCENARIO_BASE), simMode: "historical" as const,
      historicalConfig: { startYear: 1872 } };
    const first = runScenario(plan, scenario);
    const second = runScenario(plan, scenario);
    expect(first.analysis?.mode).toBe("historical");
    expect(first.analysis).toEqual(second.analysis);
    expect(first.result).toEqual(second.result);
    expect(first.result.years.map(year => year.age)).toEqual([45, 46, 47]);
    const analysis = first.analysis as Extract<RunScenarioAnalysis, { mode: "historical" }>;
    expect(analysis.windowCount).toBe(2018 - 1872 + 1);
    expect(analysis.firstWindowStartYear).toBe(1872);
    expect(analysis.latestWindowStartYear).toBe(2018);
    expect(analysis.successRate).toBeGreaterThanOrEqual(0);
    expect(analysis.successRate).toBeLessThanOrEqual(1);
    expect(analysis.representativeStartYear).toBeGreaterThanOrEqual(1872);
    expect(analysis.representativeEndYear).toBe(analysis.representativeStartYear + 2);
  });

  it("rejects historical start years that leave no fitting window", () => {
    const plan = createDefaultPlan();
    plan.profile.endAge = 47;
    const scenario = { ...resolveScenario(null, DEFAULT_SCENARIO_BASE), simMode: "historical" as const, historicalConfig: { startYear: 2019 } };
    expect(() => runScenario(plan, scenario)).toThrow(/latest feasible start year is 2018/);
  });

  it("rejects historical start years before dataset coverage", () => {
    const plan = createDefaultPlan();
    plan.profile.endAge = 47;
    const scenario = { ...resolveScenario(null, DEFAULT_SCENARIO_BASE), simMode: "historical" as const, historicalConfig: { startYear: 1871 } };
    expect(() => runScenario(plan, scenario)).toThrow(/precedes dataset coverage/);
  });
});
