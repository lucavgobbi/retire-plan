import type { Plan } from "@retire-plan/engine";
import type { RunRecord, ScenarioBase, ScenarioDelta, SectionKey, Workspace } from "./types";

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
  | { type: "workspace/loaded"; workspace: Workspace }
  | { type: "projection/setHiddenColumns"; /** Hidden data-column ids; null removes the field = default (all columns visible). */ hiddenColumnIds: string[] | null }
  | { type: "projection/setHiddenCharts"; /** Hidden dashboard-chart ids; null removes the field = default (all charts visible). */ hiddenChartIds: string[] | null };
