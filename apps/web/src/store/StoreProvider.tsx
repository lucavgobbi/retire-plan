import { createContext, useCallback, useMemo, useReducer, useState, type Dispatch, type ReactNode } from "react";
import { validatePlan } from "@budgettool/engine";
import type { Action } from "../domain/actions";
import { createEmptyWorkspace, DEFAULT_SCENARIO_BASE } from "../domain/defaults";
import { runDeterministic, runFingerprint } from "../domain/run";
import { resolveScenario } from "../domain/scenario";
import type { RunRecord, ScenarioBase, ScenarioDelta, Workspace } from "../domain/types";
import { deepFreeze, reducer } from "./reducer";
import { withCurrentAge } from "../domain/age";

export interface WorkspaceApi {
  workspace: Workspace;
  dispatch: Dispatch<Action>;
  baseScenario: ScenarioBase;
  setBaseScenario: (patch: Partial<ScenarioBase>) => void;
  validationErrors: string[];
  runProjection: (delta?: ScenarioDelta | null) => RunRecord | null;
  runError: string | null;
  calendarYear: number;
  activeRunId: string | null;
  editNotice: string | null;
  clearEditNotice: () => void;
}
export const StoreContext = createContext<(WorkspaceApi & { runs: RunRecord[] }) | null>(null);
export interface StoreProviderProps {
  children: ReactNode;
  initialWorkspace?: Workspace;
  initialBaseScenario?: ScenarioBase;
  makeId?: () => string;
  now?: () => string;
}
const makeRandomId = () => crypto.randomUUID();
const isoNow = () => new Date().toISOString();
export function StoreProvider({ children, initialWorkspace, initialBaseScenario, makeId = makeRandomId, now = isoNow }: StoreProviderProps) {
  const calendarYear = new Date(now()).getFullYear();
  const [state, rawDispatch] = useReducer(reducer, undefined, () => {
    const workspace = withCurrentAge(structuredClone(initialWorkspace ?? createEmptyWorkspace()), calendarYear);
    workspace.baseScenario = structuredClone(initialBaseScenario ?? workspace.baseScenario ?? DEFAULT_SCENARIO_BASE);
    return { workspace, runs: [] };
  });
  const baseScenario = state.workspace.baseScenario ?? DEFAULT_SCENARIO_BASE;
  const [runError, setRunError] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [editNotice, setEditNotice] = useState<string | null>(null);
  const clearEditNotice = useCallback(() => setEditNotice(null), []);
  const dispatch = useCallback<Dispatch<Action>>((action) => {
    if (action.type === "workspace/loaded") {
      rawDispatch({ ...action, workspace: withCurrentAge(action.workspace, calendarYear) });
      setActiveRunId(null);
      setEditNotice(null);
      setRunError(null);
      return;
    }
    if (action.type === "plan/setProfile") {
      rawDispatch({ ...action, calendarYear });
    } else rawDispatch(action);
    const messages: Partial<Record<Action["type"], string>> = {
      "plan/setProfile": "Profile changes applied.",
      "plan/addItem": "Item added to the plan.",
      "plan/updateItem": "Changes applied to the plan.",
      "plan/removeItem": "Item removed from the plan.",
      "scenario/setBase": "Projection settings applied.",
      "scenario/add": "Scenario added.",
      "scenario/update": "Scenario changes applied.",
      "scenario/remove": "Scenario removed.",
    };
    const message = messages[action.type];
    if (message) setEditNotice(message);
  }, [calendarYear]);
  const validationErrors = useMemo(() => {
    const plan = state.workspace.plan;
    const errors = validatePlan(plan);
    const ages = [plan.profile.birthYear, plan.profile.currentAge, plan.profile.endAge,
      ...plan.incomes.flatMap(item => [item.startAge, item.endAge]),
      ...plan.expenses.flatMap(item => [item.startAge, item.endAge]),
      ...plan.assets.map(item => item.sellEvent?.age), ...plan.savingsPolicy.map(item => item.untilAge)];
    if (ages.some(value => value !== undefined && (!Number.isInteger(value) || value <= 0))) errors.push("Years and ages must be positive whole numbers.");
    function hasNonFinite(value: unknown): boolean {
      if (typeof value === "number") return !Number.isFinite(value);
      return !!value && typeof value === "object" && Object.values(value).some(hasNonFinite);
    }
    if (hasNonFinite(plan)) errors.push("Plan amounts and rates must be finite numbers.");
    return errors;
  }, [state.workspace.plan]);
  const setBaseScenario = useCallback((patch: Partial<ScenarioBase>) => dispatch({ type: "scenario/setBase", patch }), [dispatch]);
  const runProjection = useCallback((delta: ScenarioDelta | null = null): RunRecord | null => {
    try {
      if (validationErrors.length) throw new Error(validationErrors.join(" "));
      const scenario = resolveScenario(delta, baseScenario);
      if (delta && delta.basePlanId !== (state.workspace.meta?.id ?? "unsaved")) throw new Error("This scenario belongs to a different plan.");
      if (!Number.isInteger(scenario.retirementAge) || scenario.retirementAge <= 0) throw new Error("Retirement age must be a positive whole number.");
      if (!["equity", "bond", "cash"].every(key => Number.isFinite(scenario.returnAssumptions[key as keyof typeof scenario.returnAssumptions]))) throw new Error("Return assumptions require finite equity, bond, and cash numbers.");
      if (new Set(scenario.withdrawalOrder).size !== 3 || scenario.withdrawalOrder.length !== 3 || !scenario.withdrawalOrder.every(type => ["tfsa", "nonreg", "rrsp"].includes(type))) throw new Error("Choose each withdrawal account type exactly once.");
      const record: RunRecord = deepFreeze({
        id: makeId(), planId: state.workspace.meta?.id ?? "unsaved", scenarioId: delta?.id ?? null,
        scenario, result: runDeterministic(state.workspace.plan, scenario), createdAt: now(),
        birthYear: state.workspace.plan.profile.birthYear,
        inputFingerprint: runFingerprint(state.workspace.plan, scenario),
      });
      dispatch({ type: "run/store", record });
      setActiveRunId(record.id);
      setRunError(null);
      return record;
    } catch (error) { setRunError(error instanceof Error ? error.message : "The projection could not run."); return null; }
  }, [state.workspace, baseScenario, validationErrors, makeId, now, dispatch]);
  const value = useMemo(() => ({ ...state, dispatch, baseScenario, setBaseScenario, validationErrors, runProjection, runError, calendarYear, activeRunId, editNotice, clearEditNotice }), [state, dispatch, baseScenario, setBaseScenario, validationErrors, runProjection, runError, calendarYear, activeRunId, editNotice, clearEditNotice]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
