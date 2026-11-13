/** Shared UI contract. Lanes import hooks, actions, domain and engine types here. */
export * from "@retire-plan/engine";
export type * from "../domain/types";
export type { Action } from "../domain/actions";
export { DEFAULT_SCENARIO_BASE, createDefaultPlan, createEmptyWorkspace } from "../domain/defaults";
export { resolveScenario } from "../domain/scenario";
export { runDeterministic, runScenario, runFingerprint } from "../domain/run";
export { calculateCurrentAge } from "../domain/age";
export { StoreProvider, type StoreProviderProps, type WorkspaceApi } from "./StoreProvider";
export { useStore, useWorkspace, useRuns, useProjectionRun } from "./hooks";
