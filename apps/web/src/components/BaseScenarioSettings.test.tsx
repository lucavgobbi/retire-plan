import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BaseScenarioSettings } from "./BaseScenarioSettings";
import { DEFAULT_SCENARIO_BASE, StoreProvider, useWorkspace, type ScenarioBase } from "../store/api";

function Probe() {
  const { baseScenario } = useWorkspace();
  return <output data-testid="base-settings">{JSON.stringify(baseScenario)}</output>;
}

function renderSettings(base: ScenarioBase) {
  return render(<StoreProvider initialBaseScenario={base}><BaseScenarioSettings /><Probe /></StoreProvider>);
}

function storedBase() {
  return JSON.parse(screen.getByTestId("base-settings").textContent ?? "{}") as ScenarioBase;
}

describe("base projection return inputs", () => {
  it("removes binary display noise while preserving untouched stored precision", () => {
    const base: ScenarioBase = { ...DEFAULT_SCENARIO_BASE, returnAssumptions: { equity: 0.07, bond: 0.123456789012345, cash: 0 } };
    renderSettings(base);
    fireEvent.click(screen.getByText("Base projection settings"));
    expect((screen.getByLabelText("Base equity return (%)") as HTMLInputElement).value).toBe("7");
    // No save button: valid changes apply on edit.
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    expect(storedBase().returnAssumptions).toEqual(base.returnAssumptions);
    fireEvent.change(screen.getByLabelText("Base equity return (%)"), { target: { value: "7.25" } });
    const edited = storedBase();
    expect(edited.returnAssumptions.equity).toBe(0.0725);
    expect(edited.returnAssumptions.bond).toBe(base.returnAssumptions.bond);
  });

  it("reverts retired settings to the stored value and keeps invalid drafts unapplied", () => {
    const base: ScenarioBase = { ...DEFAULT_SCENARIO_BASE, returnAssumptions: { equity: 0.07, bond: 0.05, cash: 0.02 } };
    renderSettings(base);
    fireEvent.click(screen.getByText("Base projection settings"));
    // Clearing the retirement age is an invalid draft: stored settings survive.
    fireEvent.change(screen.getByLabelText("Base retirement age"), { target: { value: "" } });
    expect(screen.getByRole("alert").textContent).toMatch(/positive whole retirement age/i);
    expect(storedBase().retirementAge).toBe(base.retirementAge);
    expect(storedBase().returnAssumptions).toEqual(base.returnAssumptions);
    // Duplicate withdrawal accounts are also blocked from applying.
    fireEvent.change(screen.getByLabelText("Base retirement age"), { target: { value: "61" } });
    const first = screen.getAllByLabelText(/Base withdrawal priority/)[0]!;
    fireEvent.change(first, { target: { value: "nonreg" } });
    fireEvent.change(screen.getAllByLabelText(/Base withdrawal priority/)[1]!, { target: { value: "nonreg" } });
    expect(screen.getByRole("alert").textContent).toMatch(/exactly once/i);
    expect(storedBase().withdrawalOrder).not.toEqual(["nonreg", "nonreg", "rrsp"]);
  });
});
