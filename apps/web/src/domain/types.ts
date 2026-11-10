import type { AccountType, Plan, Scenario, SimulationResult } from "@budgettool/engine";
export type * from "@budgettool/engine";

export interface PlanMeta { id: string; name: string; updatedAt: string }
export interface ScenarioBase {
  retirementAge: number;
  returnAssumptions: Scenario["returnAssumptions"];
  withdrawalOrder: AccountType[];
}
export interface ScenarioDelta {
  id: string;
  name: string;
  basePlanId: string;
  simMode: "deterministic";
  mcConfig?: Scenario["mcConfig"];
  overrides: Partial<ScenarioBase>;
}
export interface Workspace { meta: PlanMeta | null; plan: Plan; scenarios: ScenarioDelta[]; baseScenario?: ScenarioBase }
export interface PlanFile {
  schemaVersion: number;
  plans: { meta: PlanMeta; plan: Plan }[];
  scenarios: ScenarioDelta[];
  baseScenario?: ScenarioBase;
}
export type RunId = string;
export interface RunRecord {
  id: RunId;
  planId: string;
  scenarioId: string | null;
  /** Resolved settings at run time, preserved when the working scenario changes. */
  scenario: Scenario;
  result: SimulationResult;
  createdAt: string;
  birthYear?: number;
  inputFingerprint?: string;
}
export type SectionKey = "accounts" | "assets" | "debts" | "incomes" | "expenses" | "savingsPolicy";
