import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createEmptyWorkspace, DEFAULT_SCENARIO_BASE } from "../domain/defaults";
import type { ScenarioBase } from "../domain/types";
import { StoreProvider } from "./StoreProvider";
import { useProjectionRun, useRuns, useWorkspace } from "./hooks";

function Probe() {
  const { runProjection, runError } = useWorkspace();
  const runs = useRuns();
  return <><button onClick={() => runProjection()}>Run</button><output>{runs.length}</output>{runError && <p role="alert">{runError}</p>}</>;
}
describe("store run flow", () => {
  it("stores successful runs through the shared UI contract", () => {
    render(<StoreProvider makeId={() => "run"} now={() => "2026-11-10T00:00:00Z"}><Probe /></StoreProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Run" }));
    expect(screen.getByRole("status").textContent).toBe("1");
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
  it("preserves run-time birth year and flags a historical run after plan inputs change", () => {
    function SnapshotProbe() {
      const { dispatch } = useWorkspace();
      const { run, stale, runProjection } = useProjectionRun();
      return <><button onClick={() => runProjection()}>Project</button>
        <button onClick={() => dispatch({ type: "plan/setProfile", patch: { birthYear: 1982 } })}>Edit</button>
        <output>{JSON.stringify({ birthYear: run?.birthYear, stale })}</output></>;
    }
    render(<StoreProvider><SnapshotProbe /></StoreProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    expect(screen.getByRole("status").textContent).toContain('"birthYear":1981,"stale":false');
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
