import { useContext } from "react";
import { StoreContext, type WorkspaceApi } from "./StoreProvider";
import type { RunRecord } from "../domain/types";
import { runFingerprint } from "../domain/run";
import { resolveScenario } from "../domain/scenario";

export function useStore() {
  const store = useContext(StoreContext);
  if (!store) throw new Error("BudgetTool views require StoreProvider.");
  return store;
}
export function useWorkspace(): WorkspaceApi { return useStore(); }
export function useRuns(): RunRecord[] { return useStore().runs; }
export function useProjectionRun(activePlanId?: string | null, scenarioId?: string | null) {
  const store = useStore();
  const planId = activePlanId ?? store.workspace.meta?.id ?? "unsaved";
  const selected = scenarioId === undefined ? store.runs.find(record => record.id === store.activeRunId && record.planId === planId) : undefined;
  const selectedScenarioId = scenarioId === undefined ? selected?.scenarioId ?? null : scenarioId;
  const run = selected ?? [...store.runs].reverse().find(record => record.planId === planId && record.scenarioId === selectedScenarioId) ?? null;
  const delta = selectedScenarioId === null ? null : store.workspace.scenarios.find(item => item.id === selectedScenarioId) ?? null;
  const stale = !!run?.inputFingerprint && run.inputFingerprint !== runFingerprint(store.workspace.plan, resolveScenario(delta, store.baseScenario));
  return {
    run,
    stale,
    runProjection: () => {
      const delta = selectedScenarioId === null ? null : store.workspace.scenarios.find(item => item.id === selectedScenarioId);
      if (selectedScenarioId !== null && !delta) return null;
      return store.runProjection(delta ?? null);
    },
    error: store.runError,
  };
}
