import { buildDeterministicReturns, runHistorical, runMonteCarlo, simulate, type Plan, type Scenario, type SimulationResult } from "@retire-plan/engine";
export { resolveScenario } from "./scenario";

export interface MonteCarloAnalysis {
  mode: "montecarlo";
  successRate: number;
  percentileNetWorth: { p10: number; p50: number; p90: number };
  representativeRun: number;
}

export interface HistoricalAnalysis {
  mode: "historical";
  windowCount: number;
  firstWindowStartYear: number;
  latestWindowStartYear: number;
  successRate: number;
  percentileNetWorth: { p10: number; p50: number; p90: number };
  representativeStartYear: number;
  representativeEndYear: number;
}

export type RunAnalysis = MonteCarloAnalysis | HistoricalAnalysis;

export interface RunOutcome {
  result: SimulationResult;
  analysis?: RunAnalysis;
}

export function runFingerprint(plan: Plan, scenario: Scenario): string {
  return JSON.stringify({ plan, scenario });
}

export function runDeterministic(plan: Plan, scenario: Scenario): SimulationResult {
  if (scenario.simMode !== "deterministic") throw new Error("runDeterministic requires deterministic mode.");
  return structuredClone(simulate(plan, scenario, buildDeterministicReturns(
    scenario.returnAssumptions, plan.profile.currentAge, plan.profile.endAge,
  )));
}

export function runScenario(plan: Plan, scenario: Scenario): RunOutcome {
  if (scenario.simMode === "deterministic") return { result: runDeterministic(plan, scenario) };
  if (scenario.simMode === "montecarlo") {
    const summary = runMonteCarlo(plan, scenario);
    return {
      result: structuredClone(summary.representativeResult),
      analysis: {
        mode: "montecarlo",
        successRate: summary.successRate,
        percentileNetWorth: summary.percentileNetWorth,
        representativeRun: summary.representativeRun,
      },
    };
  }
  if (scenario.simMode === "historical") {
    const summary = runHistorical(plan, scenario);
    return {
      result: structuredClone(summary.representativeResult),
      analysis: {
        mode: "historical",
        windowCount: summary.windowStartYears.length,
        firstWindowStartYear: summary.windowStartYears[0]!,
        latestWindowStartYear: summary.windowStartYears.at(-1)!,
        successRate: summary.successRate,
        percentileNetWorth: summary.percentileNetWorth,
        representativeStartYear: summary.representativeStartYear,
        representativeEndYear: summary.representativeEndYear,
      },
    };
  }
  throw new Error("runScenario: simMode must be deterministic, montecarlo, or historical.");
}
