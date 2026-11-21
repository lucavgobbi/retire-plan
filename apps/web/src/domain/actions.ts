import type { Plan } from "@retire-plan/engine";
import type { ProjectionActiveTab, ProjectionSankeyRange, RunRecord, ScenarioBase, ScenarioDelta, SectionKey, Workspace } from "./types";

type ItemAction = {
  [K in SectionKey]:
    | { type: "plan/addItem"; section: K; item: Plan[K][number] }
    | { type: "plan/updateItem"; section: K; id: string; patch: Partial<Plan[K][number]> }
}[SectionKey];

export type Action =
  | { type: "plan/setProfile"; patch: Partial<Plan["profile"]>; calendarYear?: number }
  | ItemAction
  | { type: "plan/removeItem"; section: SectionKey; id: string }
  | { type: "scenario/add" | "scenario/update" | "scenario/remove"; delta: ScenarioDelta }
  | { type: "scenario/setBase"; patch: Partial<ScenarioBase> }
  | { type: "run/store"; record: RunRecord }
  | { type: "run/reset" }
  | { type: "workspace/loaded"; workspace: Workspace }
  | { type: "projection/setHiddenColumns"; /** Hidden data-column ids; null removes the field = default (all columns visible). */ hiddenColumnIds: string[] | null }
  | { type: "projection/setHiddenCharts"; /** Hidden dashboard-chart ids; null removes the field = default (all charts visible). */ hiddenChartIds: string[] | null }
  | { type: "projection/setScenarioId"; /** null clears the preference to the legacy/default baseline. */ scenarioId: string | null }
  | { type: "projection/setRunSummaryCollapsed"; /** null clears the preference to default-open. */ collapsed: boolean | null }
  | { type: "projection/setActiveTab"; /** null clears the preference to the default Charts tab. */ tab: ProjectionActiveTab | null }
  | { type: "projection/setSankeyRange"; /** null clears the preference to the full current run. */ range: ProjectionSankeyRange | null };
