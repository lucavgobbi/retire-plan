import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createEmptyWorkspace, DEFAULT_SCENARIO_BASE } from "../domain/defaults";
import type { RunOutcome } from "../domain/run";
import type { ScenarioBase } from "../domain/types";
import type { SimulationRunner } from "./simulationWorkerProtocol";
import { StoreProvider } from "./StoreProvider";
import { useProjectionRun, useRuns, useWorkspace } from "./hooks";

function Probe() {
  const { runProjection, runError, isRunning, runCancelled, cancelRun } = useWorkspace();
  const runs = useRuns();
  return <><button onClick={() => { void runProjection(); }}>Run</button><button onClick={cancelRun}>Cancel</button>
    <output>{runs.length}</output>{isRunning && <p>Running projection</p>}{runCancelled && <p>Projection cancelled.</p>}{runError && <p role="alert">{runError}</p>}</>;
}
const emptyOutcome = { result: { years: [], summary: { success: true, finalNetWorth: 0 } } } as RunOutcome;
describe("store run flow", () => {
  it("stores successful runs through the shared UI contract", async () => {
    render(<StoreProvider makeId={() => "run"} now={() => "2026-11-10T00:00:00Z"}><Probe /></StoreProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("1"));
  });
  it("shows worker errors and does not store a failed run", async () => {
    const simulationRunner: SimulationRunner = async () => { throw new Error("worker crashed"); };
    render(<StoreProvider simulationRunner={simulationRunner}><Probe /></StoreProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect((await screen.findByRole("alert")).textContent).toContain("worker crashed");
    expect(screen.getByRole("status").textContent).toBe("0");
  });
  it("does not store a late worker response after cancellation", async () => {
    let finish: (() => void) | undefined;
    const simulationRunner: SimulationRunner = () => new Promise((resolve) => { finish = () => resolve(emptyOutcome); });
    render(<StoreProvider simulationRunner={simulationRunner}><Probe /></StoreProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(screen.getByText("Running projection")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Projection cancelled.")).toBeTruthy();
    finish?.();
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("0"));
  });
  it("stores an ensemble summary with its representative coherent year path", async () => {
    const base: ScenarioBase = { ...DEFAULT_SCENARIO_BASE, simMode: "montecarlo", mcConfig: { runs: 2, seed: 1, stdDev: { equity: 0.18, bond: 0.06, cash: 0.02 } } };
    function MonteCarloProbe() {
      const { runProjection } = useWorkspace();
      const runs = useRuns();
      return <><button onClick={() => runProjection()}>Run MC</button><output>{JSON.stringify({ count: runs.length, analysis: runs[0]?.analysis, years: runs[0]?.result.years.map(y => y.age) })}</output></>;
    }
    render(<StoreProvider initialBaseScenario={base}><MonteCarloProbe /></StoreProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Run MC" }));
    await waitFor(() => expect(JSON.parse(screen.getByRole("status").textContent ?? "{}").count).toBe(1));
    const stored = JSON.parse(screen.getByRole("status").textContent ?? "{}");
    expect(stored.count).toBe(1);
    expect(stored.analysis.mode).toBe("montecarlo");
    expect(stored.analysis.successRate).toBeGreaterThanOrEqual(0);
    expect(stored.analysis.successRate).toBeLessThanOrEqual(1);
    expect(stored.years).toEqual(Array.from({ length: 56 }, (_, index) => 45 + index));
  });
  it("reports validation errors without storing a run or throwing into the UI", () => {
    const workspace = createEmptyWorkspace();
    workspace.plan.profile.endAge = 20;
    render(<StoreProvider initialWorkspace={workspace}><Probe /></StoreProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(screen.getByRole("status").textContent).toBe("0");
    expect(screen.getByRole("alert").textContent).toContain("endAge");
  });
  it.each([
    { ...DEFAULT_SCENARIO_BASE, retirementAge: 65.5 },
    { ...DEFAULT_SCENARIO_BASE, returnAssumptions: { equity: 0.05 } } as ScenarioBase,
    { ...DEFAULT_SCENARIO_BASE, withdrawalOrder: ["tfsa", "bogus", "rrsp"] } as unknown as ScenarioBase,
  ])("rejects malformed working scenario settings before simulating", base => {
    render(<StoreProvider initialBaseScenario={base}><Probe /></StoreProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(screen.getByRole("status").textContent).toBe("0");
    expect(screen.getByRole("alert")).toBeTruthy();
  });
  it("preserves run-time birth year and flags a historical run after plan inputs change", async () => {
    function SnapshotProbe() {
      const { dispatch } = useWorkspace();
      const { run, stale, runProjection } = useProjectionRun();
      return <><button onClick={() => runProjection()}>Project</button>
        <button onClick={() => dispatch({ type: "plan/setProfile", patch: { birthYear: 1982 } })}>Edit</button>
        <output>{JSON.stringify({ birthYear: run?.birthYear, stale })}</output></>;
    }
    render(<StoreProvider><SnapshotProbe /></StoreProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain('"birthYear":1981,"stale":false'));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("status").textContent).toContain('"birthYear":1981,"stale":true');
  });
  it("normalizes age on load and profile edits using its injected calendar year", () => {
    const imported = createEmptyWorkspace();
    imported.plan.profile.currentAge = 12;
    function AgeProbe() {
      const { workspace, dispatch } = useWorkspace();
      return <><output data-testid="age">{workspace.plan.profile.currentAge}</output>
        <button onClick={() => dispatch({ type: "plan/setProfile", patch: { birthYear: 1980, currentAge: 1 } })}>Edit birth year</button>
        <button onClick={() => dispatch({ type: "workspace/loaded", workspace: imported })}>Import</button></>;
    }
    render(<StoreProvider now={() => "2030-11-10T12:00:00Z"} initialWorkspace={imported}><AgeProbe /></StoreProvider>);
    expect(screen.getByTestId("age").textContent).toBe("49");
    fireEvent.click(screen.getByRole("button", { name: "Edit birth year" }));
    expect(screen.getByTestId("age").textContent).toBe("50");
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByTestId("age").textContent).toBe("49");
  });
});
