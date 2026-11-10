import type { Scenario } from "@budgettool/engine";
import { DEFAULT_SCENARIO_BASE } from "./defaults";
import type { ScenarioBase, ScenarioDelta } from "./types";

export type { ScenarioDelta } from "./types";
export function resolveScenario(delta: ScenarioDelta | null, base: ScenarioBase): Scenario {
  const overrides = delta?.overrides;
  return {
    id: delta?.id ?? "base",
    name: delta?.name ?? "Base scenario",
    simMode: "deterministic",
    retirementAge: overrides?.retirementAge ?? base.retirementAge ?? DEFAULT_SCENARIO_BASE.retirementAge,
    returnAssumptions: { ...(overrides?.returnAssumptions ?? base.returnAssumptions ?? DEFAULT_SCENARIO_BASE.returnAssumptions) },
    withdrawalOrder: [...(overrides?.withdrawalOrder ?? base.withdrawalOrder ?? DEFAULT_SCENARIO_BASE.withdrawalOrder)],
    ...(delta?.mcConfig ? { mcConfig: structuredClone(delta.mcConfig) } : {}),
  };
}
