import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Scenario, ScenarioDelta } from "../../domain/types";
import type { RunOutcome } from "../../domain/run";
import type { SimulationRunner } from "../../store/simulationWorkerProtocol";
import { useWorkspace } from "../../store/api";
import { StoreProvider } from "../../store/StoreProvider";
import { DEFAULT_SCENARIO_BASE } from "../../domain/defaults";
import { makeSamplePlan, makeWorkspace } from "../projection/testFixtures";
import { ScenariosView } from "./ScenariosView";
import { describeOverrides, duplicateScenario } from "./ScenarioList";
import { BaseScenarioSettings } from "../../components/BaseScenarioSettings";

const delta: ScenarioDelta = {
  id: "delta-1",
  name: "Retire 3 years earlier",
  basePlanId: "plan-test",
  simMode: "deterministic",
  overrides: { retirementAge: 62 },
};
const emptyOutcome = { result: { years: [], summary: { success: true, finalNetWorth: 0 } } } as RunOutcome;

function renderView(workspace = makeWorkspace(), simulationRunner?: SimulationRunner) {
  return render(
    <StoreProvider
      initialWorkspace={workspace}
      initialBaseScenario={DEFAULT_SCENARIO_BASE}
      simulationRunner={simulationRunner}
    >
      <ScenariosView />
    </StoreProvider>,
  );
}

function ScenariosProbe() {
  const { workspace } = useWorkspace();
  return <output data-testid="scenario-state">{JSON.stringify(workspace.scenarios)}</output>;
}

describe("describeOverrides", () => {
  it("summarizes explicit payroll overrides, including an all-off override, and only claims inheritance when payroll is absent", () => {
    expect(describeOverrides({ ...delta, overrides: {} })).toBe("inherits the working scenario (no overrides)");
    expect(
      describeOverrides({ ...delta, overrides: {}, payroll: { cpp: true, ei: true, cppOptOut65to69: false } }),
    ).toBe("payroll CPP + EI");
    expect(
      describeOverrides({ ...delta, overrides: {}, payroll: { cpp: true, ei: false, cppOptOut65to69: true } }),
    ).toBe("payroll CPP · opt-out 65–69");
    // Explicit all-off settings ARE an override: they differ from absent inheritance.
    expect(
      describeOverrides({ ...delta, overrides: {}, payroll: { cpp: false, ei: false, cppOptOut65to69: false } }),
    ).toBe("payroll none");
    expect(
      describeOverrides({ ...delta, overrides: {}, payroll: { cpp: false, ei: false, cppOptOut65to69: true } }),
    ).toBe("payroll none · opt-out 65–69");
    // Payroll shows alongside other overrides.
    expect(describeOverrides(delta)).toBe("retirement age 62");
  });
});

describe("ScenariosView", () => {
  it("creates a deep copy with a new ID and collision-safe name", () => {
    const source: ScenarioDelta = {
      ...delta,
      simMode: "montecarlo",
      mcConfig: { runs: 37, seed: 91, stdDev: { equity: 0.2, bond: 0.08, cash: 0.03 } },
      historicalConfig: { startYear: 1900 },
      benefits: { cpp: false, oas: true, gis: true },
      payroll: { cpp: true, ei: false, cppOptOut65to69: true },
      withdrawalStrategy: "tax-minimizing",
      overrides: {
        retirementAge: 61,
        returnAssumptions: { equity: 0.055, bond: 0.025, cash: 0.01 },
        withdrawalOrder: ["nonreg", "tfsa", "rrsp"],
      },
    };
    const copy = duplicateScenario(source, [source.name, "Copy of Retire 3 years earlier"]);
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe("Copy of Retire 3 years earlier (2)");
    expect(copy).toMatchObject({
      simMode: "montecarlo",
      mcConfig: source.mcConfig,
      historicalConfig: source.historicalConfig,
      benefits: source.benefits,
      payroll: source.payroll,
      withdrawalStrategy: "tax-minimizing",
      overrides: source.overrides,
    });
    expect(copy.mcConfig).not.toBe(source.mcConfig);
    expect(copy.mcConfig!.stdDev).not.toBe(source.mcConfig!.stdDev);
    expect(copy.overrides.withdrawalOrder).not.toBe(source.overrides.withdrawalOrder);
    expect(copy.payroll).not.toBe(source.payroll);
  });

  it("disables scenario run buttons while the shared run is active and offers cancellation", () => {
    const ws = makeWorkspace();
    ws.scenarios.push(delta);
    const simulationRunner: SimulationRunner = () => new Promise(() => {});
    renderView(ws, simulationRunner);
    const runButton = screen.getByRole("button", { name: /run retire 3 years earlier/i }) as HTMLButtonElement;
    fireEvent.click(runButton);
    expect(runButton.disabled).toBe(true);
    expect(screen.getByRole("button", { name: "Cancel projection" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel projection" }));
  });

  it("empty state offers creating the first scenario", () => {
    renderView();
    expect(screen.getByText(/no scenarios yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /new scenario/i })).toBeTruthy();
  });

  it("duplicates a scenario into a uniquely named independent editable copy", () => {
    const ws = makeWorkspace();
    const source: ScenarioDelta = {
      ...delta,
      simMode: "historical",
      mcConfig: { runs: 37, seed: 91, stdDev: { equity: 0.2, bond: 0.08, cash: 0.03 } },
      historicalConfig: { startYear: 1900 },
      benefits: { cpp: false, oas: true, gis: true },
      withdrawalStrategy: "tax-minimizing",
      overrides: {
        retirementAge: 61,
        returnAssumptions: { equity: 0.055, bond: 0.025, cash: 0.01 },
        withdrawalOrder: ["nonreg", "tfsa", "rrsp"],
      },
    };
    ws.scenarios.push(source, { ...delta, id: "existing-copy", name: "Copy of Retire 3 years earlier" });
    render(
      <StoreProvider initialWorkspace={ws} initialBaseScenario={DEFAULT_SCENARIO_BASE}>
        <ScenariosView />
        <ScenariosProbe />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Duplicate Retire 3 years earlier" }));
    const copiedName = screen.getByLabelText("Name") as HTMLInputElement;
    expect(copiedName.value).toBe("Copy of Retire 3 years earlier (2)");
    expect((screen.getByLabelText("Simulation mode") as HTMLSelectElement).value).toBe("historical");
    expect((screen.getByLabelText("Historical start year") as HTMLInputElement).value).toBe("1,900");

    fireEvent.change(screen.getByLabelText("Retirement age override"), { target: { value: "63" } });
    const editor = screen.getByRole("region", { name: "Edit scenario" });
    const copyItem = editor.closest("li")!;
    expect(copyItem.textContent).toContain("Copy of Retire 3 years earlier (2)");
    expect(within(editor).getByLabelText("Retirement age override")).toHaveProperty("value", "63");
    expect(within(copyItem).queryByText(/retirement age 63/i)).toBeNull();
    const originalItem = screen.getByText("Retire 3 years earlier").closest("li")!;
    expect(originalItem.textContent).toContain("retirement age 61");
    expect(originalItem.textContent).toContain("1900");
    const persistedScenarios = JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];
    const copiedDelta = persistedScenarios.find((item) => item.name === copiedName.value);
    expect(copiedDelta).toMatchObject({
      simMode: "historical",
      mcConfig: source.mcConfig,
      historicalConfig: { startYear: 1900 },
      benefits: source.benefits,
      withdrawalStrategy: "tax-minimizing",
      overrides: {
        retirementAge: 63,
        returnAssumptions: source.overrides.returnAssumptions,
        withdrawalOrder: source.overrides.withdrawalOrder,
      },
    });
    expect(persistedScenarios.find((item) => item.id === source.id)).toMatchObject({
      name: source.name,
      simMode: "historical",
      historicalConfig: { startYear: 1900 },
      benefits: source.benefits,
      withdrawalStrategy: "tax-minimizing",
      overrides: source.overrides,
    });
  });

  it("create saves on edit, without a Save button, and later edits update the same delta", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /new scenario/i }));
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    const nameBox = screen.getByLabelText(/^name$/i);
    fireEvent.change(nameBox, { target: { value: "Retire 3y earlier" } });
    const item = screen.getByText(/retire 3y earlier/i);
    // A fresh scenario inherits the base retirement age: naming it alone must not
    // pin today's value into the delta.
    expect(item.closest("li")!.textContent).not.toMatch(/retirement age/i);

    fireEvent.change(screen.getByLabelText(/retirement age override/i), { target: { value: "62" } });
    expect(screen.getAllByText(/retire 3y earlier/i)).toHaveLength(1);
    expect(screen.getAllByText(/retire 3y earlier/i)[0]!.closest("li")!.textContent).toMatch(/retirement age 62/i);
  });

  it("existing delta lists its overrides and can run, showing a summary strip", async () => {
    const ws = makeWorkspace(makeSamplePlan());
    ws.scenarios.push(delta);
    renderView(ws);
    fireEvent.click(screen.getByRole("button", { name: /run retire 3 years earlier/i }));
    const item = screen.getByText(/retire 3 years earlier/i);
    await waitFor(() => expect(within(item.closest("li")!).getByText(/final net worth/i)).toBeTruthy());
    const scenarioRow = item.closest("li")!;
    fireEvent.click(within(scenarioRow).getByRole("button", { name: "Edit" }));
    expect(within(scenarioRow).getByText(/Last run/)).toBeTruthy();
    expect(within(scenarioRow).queryByText(/final net worth/i)).toBeNull();
    expect(within(scenarioRow).getByRole("region", { name: "Edit scenario" })).toBeTruthy();
  });

  it("keeps an actionable run error visible while the scenario editor is open", async () => {
    const ws = makeWorkspace();
    ws.scenarios.push(delta);
    const simulationRunner: SimulationRunner = async () => {
      throw new Error("worker crashed");
    };
    renderView(ws, simulationRunner);
    const row = screen.getByRole("button", { name: "Run Retire 3 years earlier" }).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Run Retire 3 years earlier" }));
    expect((await within(row).findByRole("alert")).textContent).toContain("worker crashed");
    fireEvent.click(within(row).getByRole("button", { name: "Edit" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Name"));
    expect(within(row).getByRole("alert").textContent).toContain("worker crashed");
  });

  it("lets TFSA move across scenario priorities without a duplicate intermediate and keeps cash placement", async () => {
    const ws = makeWorkspace();
    ws.scenarios.push(delta);
    renderView(ws);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.click(screen.getByText("Account withdrawal order"));
    const first = screen.getByLabelText(/1st drawn/i) as HTMLSelectElement;
    expect(first.value).toBe("tfsa");
    expect(Array.from(first.options).map((option) => option.textContent)).toEqual([
      "TFSA",
      "Non-registered",
      "RRSP/RRIF",
    ]);
    const second = screen.getByLabelText(/2nd drawn/i) as HTMLSelectElement;
    fireEvent.change(second, { target: { value: "tfsa" } });
    expect(first.value).toBe("nonreg");
    expect(second.value).toBe("tfsa");
    expect((screen.getByLabelText(/3rd drawn/i) as HTMLSelectElement).value).toBe("rrsp");
    expect(screen.queryByText(/choose each investment withdrawal account exactly once/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("Cash withdrawal order"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Cash withdrawal order"), { target: { value: "automatic" } });
    const scenarioRow = screen.getByRole("region", { name: "Edit scenario" }).closest("li")!;
    fireEvent.click(within(scenarioRow).getByRole("button", { name: "Close editor" }));
    await waitFor(() => expect(document.activeElement).toBe(within(scenarioRow).getByRole("button", { name: "Edit" })));
    expect(screen.getByText(/withdrawal order Non-registered → TFSA → RRSP\/RRIF/)).toBeTruthy();
  });

  it("Monte Carlo mode exposes seed and ensemble settings", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /new scenario/i }));
    fireEvent.change(screen.getByLabelText("Simulation mode"), { target: { value: "montecarlo" } });
    expect(screen.getByLabelText("Monte Carlo runs")).toBeTruthy();
    expect(screen.getByLabelText("Monte Carlo seed")).toBeTruthy();
    expect(screen.getByLabelText("Equity standard deviation (%)")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Monte Carlo runs"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "MC forecast" } });
    fireEvent.click(screen.getByRole("button", { name: /run mc forecast/i }));
    expect(await screen.findByText(/% success/i)).toBeTruthy();
    expect(screen.getByText(/final net worth p10/i)).toBeTruthy();
  });

  it("enables historical scenarios with a validated earliest rolling-window year", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /new scenario/i }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "JST historical" } });
    fireEvent.change(screen.getByLabelText("Simulation mode"), { target: { value: "historical" } });
    expect(screen.getByLabelText("Historical start year")).toBeTruthy();
    expect(document.body.textContent).toContain("Jordà-Schularick-Taylor Macrohistory Database");
    const item = screen.getByText("JST historical").closest("li")!;
    expect(item.textContent).toContain("Historical");
    expect(item.textContent).toContain("JST historical windows from 1872");
    expect(screen.queryByLabelText("Equity %")).toBeNull();
  });

  it("saves benefit and tax strategy overrides with clear configured-stream and GIS dependency copy", () => {
    const workspace = makeWorkspace();
    workspace.plan.incomes = workspace.plan.incomes.filter((income) => income.kind !== "cpp" && income.kind !== "oas");
    render(
      <StoreProvider initialWorkspace={workspace} initialBaseScenario={DEFAULT_SCENARIO_BASE}>
        <ScenariosView />
        <ScenariosProbe />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /new scenario/i }));
    expect(screen.getByText(/no CPP income stream is configured/i)).toBeTruthy();
    expect(screen.getByText(/no OAS income stream is configured/i)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Scenario include CPP"));
    fireEvent.click(screen.getByLabelText("Scenario include OAS"));
    expect((screen.getByLabelText("Scenario include GIS") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Withdrawal strategy"), { target: { value: "tax-minimizing" } });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Tax plan" } });
    const saved = JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];
    expect(saved[0]).toMatchObject({
      benefits: { cpp: false, oas: false, gis: false },
      withdrawalStrategy: "tax-minimizing",
    });
  });

  it("saves a payroll override on the scenario and removes the key when reset to base", () => {
    const workspace = makeWorkspace();
    workspace.scenarios.push({ ...delta, overrides: {} });
    render(
      <StoreProvider initialWorkspace={workspace} initialBaseScenario={DEFAULT_SCENARIO_BASE}>
        <BaseScenarioSettings />
        <ScenariosView />
        <ScenariosProbe />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    // Inherited state: the delta carries no payroll key and follows the base choices.
    let stored = JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];
    expect(stored[0]).not.toHaveProperty("payroll");
    expect(screen.getByText(/using the base scenario payroll choices/i)).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Scenario employee CPP"));
    stored = JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];
    expect(stored[0]).toHaveProperty("payroll", { cpp: true, ei: false, cppOptOut65to69: false });
    expect(screen.getByRole("button", { name: "Use base payroll settings" })).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Scenario employee EI"));
    fireEvent.click(screen.getByLabelText("Scenario CPP opt-out ages 65–69"));
    stored = JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];
    expect(stored[0]).toHaveProperty("payroll", { cpp: true, ei: true, cppOptOut65to69: true });

    fireEvent.click(screen.getByRole("button", { name: "Use base payroll settings" }));
    stored = JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];
    expect(stored[0]).not.toHaveProperty("payroll");
    expect((screen.getByLabelText("Scenario employee CPP") as HTMLInputElement).checked).toBe(false);
  });

  it("keeps scenario benefit and strategy choices inherited when only the name changes, and refreshes them from base", () => {
    const workspace = makeWorkspace();
    workspace.scenarios.push({ ...delta, overrides: {} });
    render(
      <StoreProvider initialWorkspace={workspace} initialBaseScenario={DEFAULT_SCENARIO_BASE}>
        <BaseScenarioSettings />
        <ScenariosView />
        <ScenariosProbe />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed inherited scenario" } });
    let stored = JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];
    expect(stored[0]).not.toHaveProperty("benefits");
    expect(stored[0]).not.toHaveProperty("withdrawalStrategy");

    fireEvent.click(screen.getByLabelText("Scenario include CPP"));
    expect(screen.getByRole("button", { name: "Use base benefit choices" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use base benefit choices" }));
    stored = JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];
    expect(stored[0]).not.toHaveProperty("benefits");

    fireEvent.click(screen.getByLabelText("Base include CPP"));
    expect((screen.getByLabelText("Scenario include CPP") as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getByLabelText("Base withdrawal strategy"), { target: { value: "tax-minimizing" } });
    const scenarioEditor = screen.getByRole("region", { name: "Edit scenario" });
    expect((within(scenarioEditor).getByLabelText("Withdrawal strategy") as HTMLSelectElement).value).toBe("inherit");
    stored = JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];
    expect(stored[0]).not.toHaveProperty("withdrawalStrategy");
    fireEvent.change(within(scenarioEditor).getByLabelText("Withdrawal strategy"), { target: { value: "manual" } });
    stored = JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];
    expect(stored[0]).toHaveProperty("withdrawalStrategy", "manual");
    fireEvent.change(within(scenarioEditor).getByLabelText("Withdrawal strategy"), { target: { value: "inherit" } });
    stored = JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];
    expect(stored[0]).not.toHaveProperty("withdrawalStrategy");
  });

  it("shows the withdrawal mode inherited from the base scenario on the current card", () => {
    const workspace = makeWorkspace();
    workspace.scenarios.push({ ...delta, overrides: {} });
    const base = { ...DEFAULT_SCENARIO_BASE, withdrawalStrategy: "tax-minimizing" as const };
    render(
      <StoreProvider initialWorkspace={workspace} initialBaseScenario={base}>
        <ScenariosView />
      </StoreProvider>,
    );
    const card = screen.getByText(/retire 3 years earlier/i).closest("li")!;
    // The delta has no strategy key, so the card must resolve the base mode the
    // scenario will actually run with rather than claim it is undecided.
    expect(within(card).getByText(/withdrawal mode/i).textContent).toBe("Withdrawal mode Tax-minimizing planning");
    expect(card.textContent).not.toMatch(/Manual account order/);

    fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
    expect(screen.getByText(/salary set to “Until retirement” ends the year before this age/i)).toBeTruthy();
  });

  it("shows an explicit manual override on the card even when the base is tax-minimizing", () => {
    const workspace = makeWorkspace();
    workspace.scenarios.push({ ...delta, withdrawalStrategy: "manual", overrides: {} });
    const base = { ...DEFAULT_SCENARIO_BASE, withdrawalStrategy: "tax-minimizing" as const };
    render(
      <StoreProvider initialWorkspace={workspace} initialBaseScenario={base}>
        <ScenariosView />
      </StoreProvider>,
    );
    const card = screen.getByText(/retire 3 years earlier/i).closest("li")!;
    // Explicit override wins over the tax-minimizing base.
    expect(within(card).getByText(/withdrawal mode/i).textContent).toBe("Withdrawal mode Manual account order");
    expect(card.textContent).not.toMatch(/Tax-minimizing planning/);
  });

  it("tax-minimizing strategy hides order controls, keeps the saved order, and restores it when manual returns", () => {
    const ws = makeWorkspace();
    ws.scenarios.push({ ...delta, overrides: { retirementAge: 62, withdrawalOrder: ["nonreg", "tfsa", "rrsp"] } });
    render(
      <StoreProvider initialWorkspace={ws} initialBaseScenario={DEFAULT_SCENARIO_BASE}>
        <ScenariosView />
        <ScenariosProbe />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.click(screen.getByText("Account withdrawal order"));
    expect(screen.getByLabelText(/1st drawn/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Withdrawal strategy"), { target: { value: "tax-minimizing" } });
    expect(screen.queryByLabelText(/1st drawn/i)).toBeNull();
    expect(screen.queryByLabelText("Cash withdrawal order")).toBeNull();
    expect(screen.getByText("Your saved account order is retained as the optimizer fallback.")).toBeTruthy();
    // Edits made while the controls are hidden must not lose the stored order override.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed under optimizer" } });
    const stored = JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];
    expect(stored[0]!.overrides.withdrawalOrder).toEqual(["nonreg", "tfsa", "rrsp"]);
    expect(stored[0]!.withdrawalStrategy).toBe("tax-minimizing");
    // Switching back to manual shows the unchanged order again.
    fireEvent.change(screen.getByLabelText("Withdrawal strategy"), { target: { value: "manual" } });
    fireEvent.click(screen.getByText("Account withdrawal order"));
    expect((screen.getByLabelText(/1st drawn/i) as HTMLSelectElement).value).toBe("nonreg");
    expect((screen.getByLabelText("Cash withdrawal order") as HTMLSelectElement).value).toBe("automatic");
  });

  it("keeps key scenario fields visible and opens invalid advanced sections without losing drafts", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /new scenario/i }));
    for (const name of ["Basics", "Benefits", "Simulation", "Withdrawals"]) {
      expect(screen.getByRole("region", { name })).toBeTruthy();
    }
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("Scenario include CPP")).toBeTruthy();
    expect(screen.getByLabelText(/retirement age override/i)).toBeTruthy();
    expect(screen.getByLabelText("Withdrawal strategy")).toBeTruthy();
    expect(screen.getByText("Account withdrawal order").closest("details")!.open).toBe(false);
    const returnDetails = screen.getByText("Return assumptions").closest("details")!;
    expect(returnDetails.open).toBe(false);
    fireEvent.click(screen.getByText("Return assumptions"));
    const equity = screen.getByLabelText("Equity %") as HTMLInputElement;
    fireEvent.change(equity, { target: { value: "-" } });
    expect(await screen.findByText(/return assumption \(capital equity\) must be a number/i)).toBeTruthy();
    expect(returnDetails.open).toBe(true);
    expect(equity.value).toBe("-");
    fireEvent.click(screen.getByText("Return assumptions"));
    await waitFor(() => expect(returnDetails.open).toBe(true));
    expect(screen.getByLabelText("Equity %")).toBe(equity);
  });

  it("delete removes the scenario after the plain confirm dialog", () => {
    const ws = makeWorkspace();
    ws.scenarios.push(delta);
    renderView(ws);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(confirm).toHaveBeenCalled();
    expect(screen.queryByText(/retire 3 years earlier/i)).toBeNull();
  });

  it("edit keeps untouched rates byte-identical; Close editor returns to the same summary row", async () => {
    const decimal = makeWorkspace();
    decimal.scenarios.push({
      ...delta,
      overrides: {
        retirementAge: 62,
        returnAssumptions: { equity: 0.055, bond: 0.035, cash: 0.01 },
        withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
      },
    });
    const Probe = () => {
      const workspace = useWorkspace();
      const stored = workspace.workspace.scenarios[0]?.overrides?.returnAssumptions;
      return (
        <p data-testid="stored-rates">
          {JSON.stringify(workspace.workspace.scenarios[0]?.overrides ?? {})}|
          {stored ? `${stored.equity}/${stored.bond}/${stored.cash}` : "none"}
        </p>
      );
    };
    render(
      <StoreProvider initialWorkspace={decimal} initialBaseScenario={DEFAULT_SCENARIO_BASE}>
        <ScenariosView />
        <Probe />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    const equity = screen.getByLabelText(/equity %/i) as HTMLInputElement;
    expect(equity.value).toBe("5.5");
    expect(screen.queryByRole("button", { name: /^save scenario$/i })).toBeNull();
    // Close WITHOUT touching any field — rates must survive byte-identical.
    const editor = screen.getByRole("region", { name: "Edit scenario" });
    expect(editor.closest("li")).toBeTruthy();
    expect(within(editor.closest("li")!).queryByText(/retirement age 62/i)).toBeNull();
    const closeEditor = screen.getByRole("button", { name: "Close editor" });
    const scenarioRow = closeEditor.closest("li")!;
    fireEvent.click(closeEditor);
    await waitFor(() => expect(document.activeElement).toBe(within(scenarioRow).getByRole("button", { name: "Edit" })));
    expect(screen.getByTestId("stored-rates").textContent).toBe(
      `{"retirementAge":62,"returnAssumptions":{"equity":0.055,"bond":0.035,"cash":0.01},"withdrawalOrder":["tfsa","nonreg","rrsp"]}|0.055/0.035/0.01`,
    );

    // Editing while open updates the same delta in place.
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText(/equity %/i), { target: { value: "6" } });
    expect(screen.getByTestId("stored-rates").textContent).toBe(
      `{"retirementAge":62,"returnAssumptions":{"equity":0.06,"bond":0.035,"cash":0.01},"withdrawalOrder":["tfsa","nonreg","rrsp"]}|0.06/0.035/0.01`,
    );
    expect(screen.getAllByText(/retire 3 years earlier/i)).toHaveLength(1);
  });

  it("retirement age validation still rejects fractional years", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /new scenario/i }));
    // An invalid draft blocks any name-only dispatch edge case: even a valid name
    // cannot apply while the age is fractional.
    fireEvent.change(screen.getByLabelText(/retirement age override/i), { target: { value: "65.5" } });
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Fractional" } });
    expect(screen.getByText(/retirement age must be a whole number of years/i)).toBeTruthy();
    expect(screen.queryByText(/fractional/i)).toBeNull();
  });
});

describe("scenario retirement-age inheritance", () => {
  const storedScenarios = () => JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];

  it("an unrelated edit does not pin the current base age, and later base age changes reach the scenario run", async () => {
    const received: Scenario[] = [];
    const simulationRunner: SimulationRunner = async (_plan, scenario) => {
      received.push(scenario);
      return emptyOutcome;
    };
    render(
      <StoreProvider
        initialWorkspace={makeWorkspace()}
        initialBaseScenario={DEFAULT_SCENARIO_BASE}
        simulationRunner={simulationRunner}
      >
        <BaseScenarioSettings />
        <ScenariosView />
        <ScenariosProbe />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /new scenario/i }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Inherited age" } });
    expect(storedScenarios()[0]!.overrides).not.toHaveProperty("retirementAge");
    expect((screen.getByLabelText("Retirement age override") as HTMLInputElement).value).toBe("65");
    expect(screen.queryByRole("button", { name: "Use base retirement age" })).toBeNull();

    // Change the BASE age: the inherited scenario editor follows it, and the run
    // resolves the new age rather than a value pinned by the name edit.
    fireEvent.change(screen.getByLabelText("Base retirement age"), { target: { value: "67" } });
    expect((screen.getByLabelText("Retirement age override") as HTMLInputElement).value).toBe("67");
    expect(storedScenarios()[0]!.overrides).not.toHaveProperty("retirementAge");

    fireEvent.click(screen.getByRole("button", { name: "Run Inherited age" }));
    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]!.retirementAge).toBe(67);
  });

  it("preserves an existing explicit age even when it equals the base, and resets only the age override", () => {
    const workspace = makeWorkspace();
    workspace.scenarios.push({
      ...delta,
      name: "Pinned age",
      overrides: {
        retirementAge: 65,
        returnAssumptions: { equity: 0.055, bond: 0.025, cash: 0.01 },
        withdrawalOrder: ["nonreg", "tfsa", "rrsp"],
      },
    });
    render(
      <StoreProvider initialWorkspace={workspace} initialBaseScenario={DEFAULT_SCENARIO_BASE}>
        <ScenariosView />
        <ScenariosProbe />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    // Explicit 65 equals the base 65 but is still an override: it must not be
    // silently converted to inheritance just because the values match.
    expect(screen.getByRole("button", { name: "Use base retirement age" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed pinned age" } });
    expect(storedScenarios()[0]!.overrides).toMatchObject({
      retirementAge: 65,
      returnAssumptions: { equity: 0.055, bond: 0.025, cash: 0.01 },
      withdrawalOrder: ["nonreg", "tfsa", "rrsp"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Use base retirement age" }));
    const cleared = storedScenarios()[0]!;
    expect(cleared.overrides).not.toHaveProperty("retirementAge");
    expect(cleared.overrides).toMatchObject({
      returnAssumptions: { equity: 0.055, bond: 0.025, cash: 0.01 },
      withdrawalOrder: ["nonreg", "tfsa", "rrsp"],
    });
    expect((screen.getByLabelText("Retirement age override") as HTMLInputElement).value).toBe("65");
    expect(screen.queryByRole("button", { name: "Use base retirement age" })).toBeNull();

    // Setting a new explicit age re-pins it; clearing again returns to inheritance.
    fireEvent.change(screen.getByLabelText("Retirement age override"), { target: { value: "63" } });
    expect(storedScenarios()[0]!.overrides.retirementAge).toBe(63);
    fireEvent.click(screen.getByRole("button", { name: "Use base retirement age" }));
    expect(storedScenarios()[0]!.overrides).not.toHaveProperty("retirementAge");
  });

  it("resetting an imported age-only override keeps return and withdrawal-order inheritance, then base changes flow to the run", async () => {
    const received: Scenario[] = [];
    const simulationRunner: SimulationRunner = async (_plan, scenario) => {
      received.push(scenario);
      return emptyOutcome;
    };
    const workspace = makeWorkspace();
    workspace.scenarios.push({
      id: "imported-age-only",
      name: "Imported age only",
      basePlanId: "plan-test",
      simMode: "deterministic",
      overrides: { retirementAge: 62 },
    });
    render(
      <StoreProvider
        initialWorkspace={workspace}
        initialBaseScenario={DEFAULT_SCENARIO_BASE}
        simulationRunner={simulationRunner}
      >
        <BaseScenarioSettings />
        <ScenariosView />
        <ScenariosProbe />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByRole("button", { name: "Use base retirement age" }));

    // The imported delta carried ONLY an age override. Clearing it must leave the
    // other override keys absent, not snapshot today's inherited values.
    let stored = storedScenarios()[0]!;
    expect(stored.overrides).toEqual({});
    expect(stored.overrides).not.toHaveProperty("returnAssumptions");
    expect(stored.overrides).not.toHaveProperty("withdrawalOrder");
    expect(screen.queryByRole("button", { name: "Use base retirement age" })).toBeNull();

    // Later base changes still reach the inherited scenario and its run.
    const baseRegion = screen.getByRole("region", { name: "Base projection settings" });
    fireEvent.click(within(baseRegion).getByText("Return assumptions"));
    fireEvent.change(within(baseRegion).getByLabelText("Base equity return (%)"), { target: { value: "6.5" } });
    fireEvent.click(within(baseRegion).getByText("Account withdrawal order"));
    fireEvent.change(within(baseRegion).getByLabelText("Base withdrawal priority 1"), { target: { value: "rrsp" } });

    stored = storedScenarios()[0]!;
    expect(stored.overrides).not.toHaveProperty("returnAssumptions");
    expect(stored.overrides).not.toHaveProperty("withdrawalOrder");

    fireEvent.click(screen.getByRole("button", { name: "Run Imported age only" }));
    await waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]!.retirementAge).toBe(DEFAULT_SCENARIO_BASE.retirementAge);
    expect(received[0]!.returnAssumptions.equity).toBeCloseTo(0.065);
    expect(received[0]!.withdrawalOrder[0]).toBe("rrsp");
  });
});
