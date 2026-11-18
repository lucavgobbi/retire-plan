import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    fireEvent.click(screen.getByText("Return assumptions"));
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
    fireEvent.click(screen.getByText("Account withdrawal order"));
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
    fireEvent.click(screen.getByText("Return assumptions"));
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
    expect(screen.getByRole("region", { name: "Benefits" })).toBeTruthy();
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

  it("saves employee payroll choices, keeps CPP2 inside CPP, and shows the legacy default while off", () => {
    renderSettings(DEFAULT_SCENARIO_BASE);
    expect(screen.getByRole("region", { name: "Payroll" })).toBeTruthy();
    expect(screen.getByText(/payroll is off — the legacy default/i)).toBeTruthy();
    // Exactly three switches: CPP (which includes CPP2), EI and the 65–69 opt-out.
    const group = screen.getByRole("group", { name: "Base employee payroll deductions" });
    expect(within(group).getAllByRole("checkbox").length).toBe(3);
    expect(screen.getByText(/CPP2 follows CPP with no separate switch/i)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Base employee CPP"));
    expect(storedBase().payroll).toEqual({ cpp: true, ei: false, cppOptOut65to69: false });
    expect(screen.queryByText(/payroll is off — the legacy default/i)).toBeNull();
    expect(screen.getByText(/no employment income is configured/i)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Base employee EI"));
    expect(storedBase().payroll).toEqual({ cpp: true, ei: true, cppOptOut65to69: false });
    fireEvent.click(screen.getByLabelText("Base CPP opt-out ages 65–69"));
    expect(storedBase().payroll).toEqual({ cpp: true, ei: true, cppOptOut65to69: true });
    // Unchecking returns to an explicit all-off object (semantically the legacy default).
    fireEvent.click(screen.getByLabelText("Base employee CPP"));
    fireEvent.click(screen.getByLabelText("Base employee EI"));
    expect(storedBase().payroll).toEqual({ cpp: false, ei: false, cppOptOut65to69: true });
    expect(screen.getByText(/payroll is off — the legacy default/i)).toBeTruthy();
  });

  it("shows the legacy payroll note for an explicitly all-off stored base too", () => {
    renderSettings({ ...DEFAULT_SCENARIO_BASE, payroll: { cpp: false, ei: false, cppOptOut65to69: false } });
    expect(screen.getByText(/payroll is off — the legacy default/i)).toBeTruthy();
    expect((screen.getByLabelText("Base employee CPP") as HTMLInputElement).checked).toBe(false);
  });

  it("groups base controls into clear sections and keeps hidden invalid return fields discoverable", async () => {
    const invalid: ScenarioBase = { ...DEFAULT_SCENARIO_BASE, returnAssumptions: { equity: 0.07, bond: 0.05, cash: 0.02 } };
    renderSettings(invalid);
    for (const name of ["Basics", "Benefits", "Payroll", "Simulation", "Withdrawals"]) {
      expect(screen.getByRole("region", { name })).toBeTruthy();
    }
    const returns = screen.getByText("Return assumptions").closest("details")!;
    expect(returns.open).toBe(false);
    fireEvent.click(screen.getByText("Return assumptions"));
    fireEvent.change(screen.getByLabelText("Base equity return (%)"), { target: { value: "-" } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/Base equity return.*must be a number/i);
    expect(returns.open).toBe(true);
    fireEvent.click(screen.getByText("Return assumptions"));
    await waitFor(() => expect(returns.open).toBe(true));
  });
});
