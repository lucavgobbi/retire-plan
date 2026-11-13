import { fireEvent, render, screen, within } from "@testing-library/react";
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
    // Clearing the retirement age is an invalid draft: stored settings survive.
    fireEvent.change(screen.getByLabelText("Base retirement age"), { target: { value: "" } });
    expect(screen.getByRole("alert").textContent).toMatch(/positive whole retirement age/i);
    expect(storedBase().retirementAge).toBe(base.retirementAge);
    expect(storedBase().returnAssumptions).toEqual(base.returnAssumptions);
    // Correcting the other valid field still leaves an invalid order untouched only until an account is chosen.
    fireEvent.change(screen.getByLabelText("Base retirement age"), { target: { value: "61" } });
    const first = screen.getAllByLabelText(/Base withdrawal priority/)[0]!;
    expect(within(first).getAllByRole("option").map(option => option.textContent)).toEqual(["TFSA", "Non-registered", "RRSP/RRIF"]);
    fireEvent.change(first, { target: { value: "rrsp" } });
    expect(storedBase().withdrawalOrder).toEqual(["rrsp", "nonreg", "tfsa"]);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.change(screen.getByLabelText("Base cash withdrawal order"), { target: { value: "2" } });
    expect(storedBase().withdrawalOrder).toEqual(["rrsp", "nonreg", "cash", "tfsa"]);
    fireEvent.change(screen.getByLabelText("Base cash withdrawal order"), { target: { value: "automatic" } });
    expect(storedBase().withdrawalOrder).toEqual(["rrsp", "nonreg", "tfsa"]);
  });

  it("stores base Monte Carlo mode and reproducible run settings", () => {
    renderSettings(DEFAULT_SCENARIO_BASE);
    fireEvent.change(screen.getByLabelText("Base simulation mode"), { target: { value: "montecarlo" } });
    fireEvent.change(screen.getByLabelText("Base Monte Carlo runs"), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText("Base Monte Carlo seed"), { target: { value: "42" } });
    expect(storedBase().simMode).toBe("montecarlo");
    expect(storedBase().mcConfig).toEqual({ runs: 250, seed: 42, stdDev: { equity: 0.18, bond: 0.07, cash: 0.02 } });
  });

  it("enables historical mode and saves the earliest rolling-window year", () => {
    renderSettings(DEFAULT_SCENARIO_BASE);
    fireEvent.change(screen.getByLabelText("Base simulation mode"), { target: { value: "historical" } });
    expect(storedBase().simMode).toBe("historical");
    expect(storedBase().historicalConfig).toEqual({ startYear: 1872 });
    expect(document.body.textContent).toContain("USA annual nominal USD returns · non-Canadian proxy · no FX conversion");
    expect(screen.queryByLabelText("Base equity return (%)")).toBeNull();
    fireEvent.change(screen.getByLabelText("Base historical start year"), { target: { value: "1950" } });
    expect(storedBase().historicalConfig).toEqual({ startYear: 1950 });
  });

  it("saves benefit choices and the withdrawal strategy, disabling GIS when OAS is off", () => {
    renderSettings(DEFAULT_SCENARIO_BASE);
    expect(screen.getByText(/no CPP income stream is configured/i)).toBeTruthy();
    expect(screen.getByText(/no OAS income stream is configured/i)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Base include CPP"));
    expect(storedBase().benefits).toEqual({ cpp: false, oas: true, gis: true });
    fireEvent.click(screen.getByLabelText("Base include OAS"));
    expect(storedBase().benefits).toEqual({ cpp: false, oas: false, gis: false });
    expect((screen.getByLabelText("Base include GIS") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Base withdrawal strategy"), { target: { value: "tax-minimizing" } });
    expect(storedBase().withdrawalStrategy).toBe("tax-minimizing");
    expect(screen.getByText(/bounded planning heuristic/i)).toBeTruthy();
  });
});
