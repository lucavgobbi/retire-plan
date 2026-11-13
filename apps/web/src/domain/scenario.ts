import type { Scenario } from "@retire-plan/engine";
import { DEFAULT_SCENARIO_BASE } from "./defaults";
import type { ScenarioBase, ScenarioDelta } from "./types";

export type { ScenarioDelta } from "./types";
export function resolveScenario(delta: ScenarioDelta | null, base: ScenarioBase): Scenario {
  const overrides = delta?.overrides;
  return {
    id: delta?.id ?? "base",
    name: delta?.name ?? "Base scenario",
    simMode: delta?.simMode ?? base.simMode ?? "deterministic",
    retirementAge: overrides?.retirementAge ?? base.retirementAge ?? DEFAULT_SCENARIO_BASE.retirementAge,
    returnAssumptions: { ...(overrides?.returnAssumptions ?? base.returnAssumptions ?? DEFAULT_SCENARIO_BASE.returnAssumptions) },
    withdrawalOrder: [...(overrides?.withdrawalOrder ?? base.withdrawalOrder ?? DEFAULT_SCENARIO_BASE.withdrawalOrder)],
    benefits: structuredClone(delta?.benefits ?? base.benefits ?? DEFAULT_SCENARIO_BASE.benefits!),
    withdrawalStrategy: delta?.withdrawalStrategy ?? base.withdrawalStrategy ?? "manual",
    ...((delta?.mcConfig ?? base.mcConfig) ? { mcConfig: structuredClone(delta?.mcConfig ?? base.mcConfig) } : {}),
    ...((delta?.historicalConfig ?? base.historicalConfig) ? { historicalConfig: structuredClone(delta?.historicalConfig ?? base.historicalConfig) } : {}),
  };
}
