import type {
  AccountType,
  BenefitSettings,
  PayrollSettings,
  Plan,
  Scenario,
  SimulationResult,
  WithdrawalStrategy,
} from "@retire-plan/engine";
import type { RunAnalysis } from "./run";
export type * from "@retire-plan/engine";

export interface PlanMeta {
  id: string;
  name: string;
  updatedAt: string;
}
export type ProjectionActiveTab = "charts" | "cashflow";
export interface ProjectionSankeyRange {
  startYear: number;
  endYear: number;
}
export type { BenefitSettings, PayrollSettings, WithdrawalStrategy };
export interface ScenarioBase {
  simMode?: Scenario["simMode"];
  retirementAge: number;
  returnAssumptions: Scenario["returnAssumptions"];
  withdrawalOrder: AccountType[];
  mcConfig?: Scenario["mcConfig"];
  historicalConfig?: Scenario["historicalConfig"];
  benefits?: BenefitSettings;
  payroll?: PayrollSettings;
  withdrawalStrategy?: WithdrawalStrategy;
}
export interface ScenarioDelta {
  id: string;
  name: string;
  basePlanId: string;
  simMode: Scenario["simMode"];
  mcConfig?: Scenario["mcConfig"];
  historicalConfig?: Scenario["historicalConfig"];
  benefits?: BenefitSettings;
  payroll?: PayrollSettings;
  withdrawalStrategy?: WithdrawalStrategy;
  overrides: Partial<Pick<ScenarioBase, "retirementAge" | "returnAssumptions" | "withdrawalOrder">>;
}
export interface Workspace {
  meta: PlanMeta | null;
  plan: Plan;
  scenarios: ScenarioDelta[];
  baseScenario?: ScenarioBase;
  /** Hidden projection-table data-column ids (stable); absent or empty = all visible, so columns added later default visible. */
  hiddenProjectionColumns?: string[];
  /** Hidden dashboard chart ids; absent or empty = all charts visible. */
  hiddenProjectionCharts?: string[];
  /** Selected projection scenario: "" is explicit baseline; absent is legacy/default baseline. */
  projectionScenarioId?: string;
  /** Run analysis disclosure preference; absent/false means expanded. */
  projectionRunSummaryCollapsed?: boolean;
  /** Active Projection subtab; absent means Charts. */
  projectionActiveTab?: ProjectionActiveTab;
  /** Saved Sankey calendar-year range; absent means the full current run. */
  projectionSankeyRange?: ProjectionSankeyRange;
  projectionSankeyShowAccounts?: boolean;
}
export interface PlanFile {
  schemaVersion: number;
  plans: { meta: PlanMeta; plan: Plan }[];
  scenarios: ScenarioDelta[];
  baseScenario?: ScenarioBase;
  hiddenProjectionColumns?: string[];
  hiddenProjectionCharts?: string[];
  projectionScenarioId?: string;
  projectionRunSummaryCollapsed?: boolean;
  projectionActiveTab?: ProjectionActiveTab;
  projectionSankeyRange?: ProjectionSankeyRange;
  projectionSankeyShowAccounts?: boolean;
}
export type RunId = string;
export interface RunRecord {
  id: RunId;
  planId: string;
  scenarioId: string | null;
  /** Resolved settings at run time, preserved when the working scenario changes. */
  scenario: Scenario;
  result: SimulationResult;
  /** Aggregate Monte Carlo / historical ensemble statistics; year rows stay one explicitly sampled coherent path. */
  analysis?: RunAnalysis;
  createdAt: string;
  birthYear?: number;
  inputFingerprint?: string;
}
export type SectionKey = "accounts" | "assets" | "debts" | "incomes" | "expenses" | "savingsPolicy";
