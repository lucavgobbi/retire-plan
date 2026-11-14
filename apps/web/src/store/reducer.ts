import type { Action } from "../domain/actions";
import type { RunRecord, SectionKey, Workspace } from "../domain/types";
import { DEFAULT_SCENARIO_BASE } from "../domain/defaults";
import { calculateCurrentAge } from "../domain/age";

export interface StoreState { workspace: Workspace; runs: RunRecord[] }
export function assertNever(value: never): never { throw new Error(`Unknown action: ${JSON.stringify(value)}`); }
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function updateSection<K extends SectionKey>(workspace: Workspace, section: K, action: Action): Workspace {
  const items = workspace.plan[section];
  let next: typeof items;
  switch (action.type) {
    case "plan/addItem": next = [...items, structuredClone(action.item)] as typeof items; break;
    case "plan/updateItem": next = items.map(item => item.id === action.id
      ? { ...item, ...structuredClone(action.patch), id: item.id } : item) as typeof items; break;
    case "plan/removeItem": next = items.filter(item => item.id !== action.id) as typeof items; break;
    default: return workspace;
  }
  return { ...workspace, plan: { ...workspace.plan, [section]: next } };
}

export function reducer(state: StoreState, action: Action): StoreState {
  const workspace = state.workspace;
  switch (action.type) {
    case "plan/setProfile": {
      const profile = { ...workspace.plan.profile, ...action.patch };
      if (action.calendarYear !== undefined) profile.currentAge = calculateCurrentAge(profile.birthYear, action.calendarYear);
      return { ...state, workspace: { ...workspace, plan: { ...workspace.plan, profile } } };
    }
    case "plan/addItem":
    case "plan/updateItem":
    case "plan/removeItem": {
      // Exhaustive section dispatch: an added Plan collection must be handled here.
      const section = action.section;
      switch (section) {
        case "accounts": case "assets": case "debts": case "incomes": case "expenses": case "savingsPolicy":
          return { ...state, workspace: updateSection(workspace, action.section, action) };
        default: return assertNever(section);
      }
    }
    case "scenario/add": return { ...state, workspace: { ...workspace, scenarios: [...workspace.scenarios, structuredClone(action.delta)] } };
    case "scenario/update": return { ...state, workspace: { ...workspace, scenarios: workspace.scenarios.map(delta => delta.id === action.delta.id ? structuredClone(action.delta) : delta) } };
    case "scenario/remove": return { ...state, workspace: { ...workspace, scenarios: workspace.scenarios.filter(delta => delta.id !== action.delta.id) } };
    case "scenario/setBase": return { ...state, workspace: { ...workspace, baseScenario: { ...(workspace.baseScenario ?? DEFAULT_SCENARIO_BASE), ...structuredClone(action.patch) } } };
    case "workspace/loaded": return { workspace: structuredClone(action.workspace), runs: [] };
    case "projection/setHiddenColumns": {
      if (action.hiddenColumnIds === null) {
        // Default = the field's absence; strip the key so autosave/export stop carrying it.
        const { hiddenProjectionColumns: _removed, ...rest } = workspace;
        return { ...state, workspace: rest };
      }
      return { ...state, workspace: { ...workspace, hiddenProjectionColumns: [...action.hiddenColumnIds] } };
    }
    case "run/store": return { ...state, runs: [...state.runs.filter(run => run.id !== action.record.id), deepFreeze(structuredClone(action.record))].slice(-20) };
    default: return assertNever(action);
  }
}
