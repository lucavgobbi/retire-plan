import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import { validatePlan, type AccountType } from "@retire-plan/engine";
import type { Action } from "../domain/actions";
import { comparisonScenarios, comparisonSelection, normalizeComparisonPreference } from "../domain/comparisonSelection";
import { createEmptyWorkspace, DEFAULT_SCENARIO_BASE } from "../domain/defaults";
import { runFingerprint } from "../domain/run";
import { resolveScenario } from "../domain/scenario";
import type { RunRecord, Scenario, ScenarioBase, ScenarioDelta, Workspace } from "../domain/types";
import { deepFreeze, reducer } from "./reducer";
import { withCurrentAge } from "../domain/age";
import { runScenarioInWorker } from "./runInWorker";
import type { SimulationRunner } from "./simulationWorkerProtocol";

type ComparisonRun =
  | { status: "running"; current: number; total: number; label: string }
  | { status: "ready"; records: RunRecord[] }
  | { status: "error"; message: string }
  | { status: "cancelled" | "changed" };

function validateScenarioForRun(scenario: Scenario) {
  if (!Number.isInteger(scenario.retirementAge) || scenario.retirementAge <= 0)
    throw new Error("Retirement age must be a positive whole number.");
  const { equity, bond, cash } = scenario.returnAssumptions;
  if (![equity, bond, cash].every(Number.isFinite))
    throw new Error("Return assumptions require finite equity, bond, and cash numbers.");
  if (
    (scenario.withdrawalOrder.length !== 3 && scenario.withdrawalOrder.length !== 4) ||
    new Set(scenario.withdrawalOrder).size !== scenario.withdrawalOrder.length ||
    !["tfsa", "nonreg", "rrsp"].every((type) => scenario.withdrawalOrder.includes(type as AccountType)) ||
    !scenario.withdrawalOrder.every((type) => ["tfsa", "nonreg", "rrsp", "cash"].includes(type))
  ) {
    throw new Error("Choose each investment withdrawal account exactly once, with optional cash.");
  }
}

export interface WorkspaceApi {
  workspace: Workspace;
  dispatch: Dispatch<Action>;
  baseScenario: ScenarioBase;
  setBaseScenario: (patch: Partial<ScenarioBase>) => void;
  validationErrors: string[];
  runProjection: (delta?: ScenarioDelta | null) => Promise<RunRecord | null>;
  runComparison: () => Promise<void>;
  comparisonRun: ComparisonRun | null;
  cancelComparison: () => void;
  isRunning: boolean;
  runCancelled: boolean;
  cancelRun: () => void;
  /** Clears generated run history; never mutates the plan, scenarios, base settings or preferences. */
  resetRuns: () => void;
  runError: string | null;
  calendarYear: number;
  activeRunId: string | null;
}
export const StoreContext = createContext<(WorkspaceApi & { runs: RunRecord[] }) | null>(null);
export interface StoreProviderProps {
  children: ReactNode;
  initialWorkspace?: Workspace;
  initialBaseScenario?: ScenarioBase;
  makeId?: () => string;
  now?: () => string;
  simulationRunner?: SimulationRunner;
}
const makeRandomId = () => crypto.randomUUID();
const isoNow = () => new Date().toISOString();
export function StoreProvider({
  children,
  initialWorkspace,
  initialBaseScenario,
  makeId = makeRandomId,
  now = isoNow,
  simulationRunner = runScenarioInWorker,
}: StoreProviderProps) {
  const calendarYear = new Date(now()).getFullYear();
  const [state, rawDispatch] = useReducer(reducer, undefined, () => {
    const workspace = withCurrentAge(structuredClone(initialWorkspace ?? createEmptyWorkspace()), calendarYear);
    workspace.baseScenario = structuredClone(initialBaseScenario ?? workspace.baseScenario ?? DEFAULT_SCENARIO_BASE);
    return { workspace: normalizeComparisonPreference(workspace), runs: [] };
  });
  const baseScenario = state.workspace.baseScenario ?? DEFAULT_SCENARIO_BASE;
  const [runError, setRunError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runCancelled, setRunCancelled] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [comparisonRun, setComparisonRun] = useState<ComparisonRun | null>(null);
  const currentRun = useRef<{ kind: "projection" | "comparison"; controller: AbortController } | null>(null);
  const cancelCurrentRun = useCallback(() => {
    const run = currentRun.current;
    currentRun.current = null;
    run?.controller.abort();
  }, []);
  const cancelComparison = useCallback(() => {
    if (currentRun.current?.kind !== "comparison") return;
    cancelCurrentRun();
    setComparisonRun({ status: "cancelled" });
  }, [cancelCurrentRun]);
  const cancelRun = useCallback(() => {
    if (currentRun.current?.kind !== "projection") return;
    cancelCurrentRun();
    setIsRunning(false);
    setRunCancelled(true);
    setRunError(null);
  }, [cancelCurrentRun]);
  useEffect(
    () => () => {
      cancelCurrentRun();
    },
    [cancelCurrentRun],
  );
  const dispatch = useCallback<Dispatch<Action>>(
    (action) => {
      setRunCancelled(false);
      if (
        action.type.startsWith("plan/") ||
        action.type.startsWith("scenario/") ||
        action.type === "projection/setComparison"
      ) {
        if (currentRun.current?.kind === "comparison") cancelCurrentRun();
        setComparisonRun((previous) => (previous ? { status: "changed" } : null));
      }
      if (action.type === "projection/setActiveTab" && action.tab !== "compare") cancelComparison();
      if (action.type === "workspace/loaded" || action.type === "run/reset") {
        setComparisonRun(null);
        cancelCurrentRun();
        setIsRunning(false);
        rawDispatch(
          action.type === "workspace/loaded"
            ? { ...action, workspace: withCurrentAge(action.workspace, calendarYear) }
            : action,
        );
        setActiveRunId(null);
        setRunError(null);
        return;
      }
      if (action.type === "plan/setProfile") {
        rawDispatch({ ...action, calendarYear });
      } else rawDispatch(action);
    },
    [calendarYear, cancelCurrentRun, cancelComparison],
  );
  const validationErrors = useMemo(() => {
    const plan = state.workspace.plan;
    const errors = validatePlan(plan);
    const ages = [
      plan.profile.birthYear,
      plan.profile.currentAge,
      plan.profile.endAge,
      ...plan.incomes.flatMap((item) => [item.startAge, item.endAge]),
      ...plan.expenses.flatMap((item) => [item.startAge, item.endAge]),
      ...plan.assets.map((item) => item.sellEvent?.age),
      ...plan.savingsPolicy.map((item) => item.untilAge),
    ];
    if (ages.some((value) => value !== undefined && (!Number.isInteger(value) || value <= 0)))
      errors.push("Years and ages must be positive whole numbers.");
    function hasNonFinite(value: unknown): boolean {
      if (typeof value === "number") return !Number.isFinite(value);
      return !!value && typeof value === "object" && Object.values(value).some(hasNonFinite);
    }
    if (hasNonFinite(plan)) errors.push("Plan amounts and rates must be finite numbers.");
    return errors;
  }, [state.workspace.plan]);
  const setBaseScenario = useCallback(
    (patch: Partial<ScenarioBase>) => dispatch({ type: "scenario/setBase", patch }),
    [dispatch],
  );
  const resetRuns = useCallback(() => dispatch({ type: "run/reset" }), [dispatch]);
  const executeScenario = useCallback(
    async (
      plan: Workspace["plan"],
      planId: string,
      scenarioId: string | null,
      scenario: Scenario,
      signal: AbortSignal,
    ) => {
      const outcome = await simulationRunner(plan, scenario, signal);
      if (signal.aborted) return null;
      return deepFreeze({
        id: makeId(),
        planId,
        scenarioId,
        scenario,
        result: outcome.result,
        ...(outcome.analysis ? { analysis: outcome.analysis } : {}),
        createdAt: now(),
        birthYear: plan.profile.birthYear,
        inputFingerprint: runFingerprint(plan, scenario),
      } satisfies RunRecord);
    },
    [makeId, now, simulationRunner],
  );
  const runProjection = useCallback(
    async (delta: ScenarioDelta | null = null): Promise<RunRecord | null> => {
      if (currentRun.current) return null;
      const controller = new AbortController();
      const planId = state.workspace.meta?.id ?? "unsaved";
      try {
        if (validationErrors.length) throw new Error(validationErrors.join(" "));
        if (delta && delta.basePlanId !== planId) throw new Error("This scenario belongs to a different plan.");
        const scenario = resolveScenario(delta, baseScenario);
        validateScenarioForRun(scenario);
        dispatch({ type: "projection/setScenarioId", scenarioId: delta?.id ?? "" });
        if (state.workspace.projectionActiveTab === "compare")
          dispatch({ type: "projection/setActiveTab", tab: "charts" });
        currentRun.current = { kind: "projection", controller };
        setIsRunning(true);
        setRunCancelled(false);
        setRunError(null);
        const record = await executeScenario(
          structuredClone(state.workspace.plan),
          planId,
          delta?.id ?? null,
          scenario,
          controller.signal,
        );
        if (!record || controller.signal.aborted) return null;
        dispatch({ type: "run/store", record });
        setActiveRunId(record.id);
        return record;
      } catch (error) {
        if (!controller.signal.aborted && !(error instanceof Error && error.name === "AbortError"))
          setRunError(error instanceof Error ? error.message : "The projection could not run.");
        return null;
      } finally {
        if (currentRun.current?.controller === controller) {
          currentRun.current = null;
          setIsRunning(false);
        }
      }
    },
    [state.workspace, baseScenario, validationErrors, dispatch, executeScenario],
  );
  const runComparison = useCallback(async () => {
    if (currentRun.current || validationErrors.length) return;
    const workspace = state.workspace;
    const scenarios = comparisonScenarios(workspace);
    const { baselineId, alternativeIds } = comparisonSelection(workspace, scenarios);
    if (!alternativeIds.length) return;

    const ids = [baselineId, ...alternativeIds];
    const planId = workspace.meta?.id ?? "unsaved";
    const plan = structuredClone(workspace.plan);
    const controller = new AbortController();
    currentRun.current = { kind: "comparison", controller };
    const records: RunRecord[] = [];
    const recentRuns = [...state.runs].reverse();
    let label = "";
    try {
      for (const [index, id] of ids.entries()) {
        const delta = scenarios.find((item) => item.id === id) ?? null;
        const scenario = resolveScenario(delta, baseScenario);
        label = scenario.name || id;
        setComparisonRun({ status: "running", current: index + 1, total: ids.length, label });
        validateScenarioForRun(scenario);

        const fingerprint = runFingerprint(plan, scenario);
        const cached = recentRuns.find(
          (run) => run.planId === planId && run.scenarioId === (id || null) && run.inputFingerprint === fingerprint,
        );
        const record = cached ?? (await executeScenario(plan, planId, id || null, scenario, controller.signal));
        if (!record || controller.signal.aborted) return;
        records.push(record);
      }
      setComparisonRun({ status: "ready", records });
    } catch (error) {
      if (!controller.signal.aborted) {
        const detail = error instanceof Error ? error.message : "The simulation failed.";
        setComparisonRun({ status: "error", message: `${label} — ${detail}` });
      }
    } finally {
      if (currentRun.current?.controller === controller) currentRun.current = null;
    }
  }, [state.workspace, state.runs, baseScenario, validationErrors, executeScenario]);
  const value = useMemo(
    () => ({
      ...state,
      dispatch,
      baseScenario,
      setBaseScenario,
      validationErrors,
      runProjection,
      runComparison,
      comparisonRun,
      cancelComparison,
      isRunning,
      runCancelled,
      cancelRun,
      resetRuns,
      runError,
      calendarYear,
      activeRunId,
    }),
    [
      state,
      dispatch,
      baseScenario,
      setBaseScenario,
      validationErrors,
      runProjection,
      runComparison,
      comparisonRun,
      cancelComparison,
      isRunning,
      runCancelled,
      cancelRun,
      resetRuns,
      runError,
      calendarYear,
      activeRunId,
    ],
  );
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
