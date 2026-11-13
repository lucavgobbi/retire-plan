import type { Plan } from "@retire-plan/engine";
import type { ScenarioBase, Workspace } from "./types";

export const DEFAULT_SCENARIO_BASE: ScenarioBase = {
  simMode: "deterministic",
  retirementAge: 65,
  returnAssumptions: { equity: 0.05, bond: 0.02, cash: 0 },
  withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
  benefits: { cpp: true, oas: true, gis: true },
  withdrawalStrategy: "manual",
};

/** Empty editing state, distinct from the golden sample loaded at first launch. */
export function createDefaultPlan(): Plan {
  return {
    profile: { birthYear: 1981, currentAge: 45, province: "ON", endAge: 100 },
    accounts: [], assets: [], debts: [], incomes: [], expenses: [], savingsPolicy: [],
  };
}
export function createEmptyWorkspace(): Workspace {
  return { meta: null, plan: createDefaultPlan(), scenarios: [], baseScenario: structuredClone(DEFAULT_SCENARIO_BASE) };
}
