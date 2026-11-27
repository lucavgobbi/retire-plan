import type { ProjectionComparison, ScenarioDelta, Workspace } from "./types";

export function comparisonScenarios(workspace: Workspace): ScenarioDelta[] {
  const planId = workspace.meta?.id ?? "unsaved";
  const seen = new Set([""]);
  return workspace.scenarios.filter((scenario) => {
    if (scenario.basePlanId !== planId || seen.has(scenario.id)) return false;
    seen.add(scenario.id);
    return true;
  });
}

function resolveSelection(ids: string[], selection?: ProjectionComparison): ProjectionComparison {
  if (!selection) return { baselineId: "", alternativeIds: ids.slice(1, 2) };
  const baselineId = ids.includes(selection.baselineId) ? selection.baselineId : "";
  const alternativeIds = [...new Set(selection.alternativeIds)]
    .filter((id) => id !== baselineId && ids.includes(id))
    .slice(0, 2);
  return { baselineId, alternativeIds };
}

export function comparisonSelection(workspace: Workspace, scenarios = comparisonScenarios(workspace)) {
  return resolveSelection(["", ...scenarios.map((scenario) => scenario.id)], workspace.projectionComparison);
}

export function normalizeComparisonPreference(workspace: Workspace): Workspace {
  return workspace.projectionComparison
    ? { ...workspace, projectionComparison: comparisonSelection(workspace) }
    : workspace;
}
