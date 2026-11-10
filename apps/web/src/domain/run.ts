import { buildDeterministicReturns, simulate, type Plan, type Scenario, type SimulationResult } from "@retire-plan/engine";
export { resolveScenario } from "./scenario";

export function runFingerprint(plan: Plan, scenario: Scenario): string {
  return JSON.stringify({ plan, scenario });
}

export function runDeterministic(plan: Plan, scenario: Scenario): SimulationResult {
  if (scenario.simMode !== "deterministic") throw new Error("Only deterministic projections are available in Phase 2.");
  return structuredClone(simulate(plan, scenario, buildDeterministicReturns(
    scenario.returnAssumptions, plan.profile.currentAge, plan.profile.endAge,
  )));
}
