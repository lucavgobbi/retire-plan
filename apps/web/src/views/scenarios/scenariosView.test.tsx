import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ScenarioDelta } from "../../domain/types";
import type { SimulationRunner } from "../../store/simulationWorkerProtocol";
import { useWorkspace } from "../../store/api";
import { StoreProvider } from "../../store/StoreProvider";
import { DEFAULT_SCENARIO_BASE } from "../../domain/defaults";
import { makeSamplePlan, makeWorkspace } from "../projection/testFixtures";
import { ScenariosView } from "./ScenariosView";
import { duplicateScenario } from "./ScenarioList";
import { BaseScenarioSettings } from "../../components/BaseScenarioSettings";

const delta: ScenarioDelta = {
  id: "delta-1",
  name: "Retire 3 years earlier",
  basePlanId: "plan-test",
  simMode: "deterministic",
  overrides: { retirementAge: 62 },
};

function renderView(workspace = makeWorkspace(), simulationRunner?: SimulationRunner) {
  return render(
    <StoreProvider initialWorkspace={workspace} initialBaseScenario={DEFAULT_SCENARIO_BASE} simulationRunner={simulationRunner}>
      <ScenariosView />
    </StoreProvider>,
  );
}

function ScenariosProbe() {
  const { workspace } = useWorkspace();
  return <output data-testid="scenario-state">{JSON.stringify(workspace.scenarios)}</output>;
}

describe("ScenariosView", () => {
  it("creates a deep copy with a new ID and collision-safe name", () => {
    const source: ScenarioDelta = {
      ...delta,
      simMode: "montecarlo",
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
    const copy = duplicateScenario(source, [source.name, "Copy of Retire 3 years earlier"]);
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe("Copy of Retire 3 years earlier (2)");
    expect(copy).toMatchObject({ simMode: "montecarlo", mcConfig: source.mcConfig, historicalConfig: source.historicalConfig, benefits: source.benefits, withdrawalStrategy: "tax-minimizing", overrides: source.overrides });
    expect(copy.mcConfig).not.toBe(source.mcConfig);
    expect(copy.mcConfig!.stdDev).not.toBe(source.mcConfig!.stdDev);
    expect(copy.overrides.withdrawalOrder).not.toBe(source.overrides.withdrawalOrder);
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
    render(<StoreProvider initialWorkspace={ws} initialBaseScenario={DEFAULT_SCENARIO_BASE}><ScenariosView /><ScenariosProbe /></StoreProvider>);

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
    const copiedDelta = persistedScenarios.find(item => item.name === copiedName.value);
    expect(copiedDelta).toMatchObject({
      simMode: "historical", mcConfig: source.mcConfig, historicalConfig: { startYear: 1900 },
      benefits: source.benefits, withdrawalStrategy: "tax-minimizing",
      overrides: { retirementAge: 63, returnAssumptions: source.overrides.returnAssumptions, withdrawalOrder: source.overrides.withdrawalOrder },
    });
    expect(persistedScenarios.find(item => item.id === source.id)).toMatchObject({
      name: source.name, simMode: "historical", historicalConfig: { startYear: 1900 }, benefits: source.benefits, withdrawalStrategy: "tax-minimizing", overrides: source.overrides,
    });

  });

  it("create saves on edit, without a Save button, and later edits update the same delta", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /new scenario/i }));
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    const nameBox = screen.getByLabelText(/^name$/i);
    fireEvent.change(nameBox, { target: { value: "Retire 3y earlier" } });
    const item = screen.getByText(/retire 3y earlier/i);
    expect(item.closest("li")!.textContent).toMatch(/retirement age 65/i);

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
    const simulationRunner: SimulationRunner = async () => { throw new Error("worker crashed"); };
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
    const first = screen.getByLabelText(/1st drawn/i) as HTMLSelectElement;
    expect(first.value).toBe("tfsa");
    expect(Array.from(first.options).map(option => option.textContent)).toEqual(["TFSA", "Non-registered", "RRSP/RRIF"]);
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
    workspace.plan.incomes = workspace.plan.incomes.filter(income => income.kind !== "cpp" && income.kind !== "oas");
    render(<StoreProvider initialWorkspace={workspace} initialBaseScenario={DEFAULT_SCENARIO_BASE}><ScenariosView /><ScenariosProbe /></StoreProvider>);
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
      benefits: { cpp: false, oas: false, gis: false }, withdrawalStrategy: "tax-minimizing",
    });
  });

  it("keeps scenario benefit and strategy choices inherited when only the name changes, and refreshes them from base", () => {
    const workspace = makeWorkspace();
    workspace.scenarios.push({ ...delta, overrides: {} });
    render(<StoreProvider initialWorkspace={workspace} initialBaseScenario={DEFAULT_SCENARIO_BASE}><BaseScenarioSettings /><ScenariosView /><ScenariosProbe /></StoreProvider>);
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
    expect((screen.getByLabelText("Withdrawal strategy") as HTMLSelectElement).value).toBe("inherit");
    stored = JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];
    expect(stored[0]).not.toHaveProperty("withdrawalStrategy");
    fireEvent.change(screen.getByLabelText("Withdrawal strategy"), { target: { value: "manual" } });
    stored = JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];
    expect(stored[0]).toHaveProperty("withdrawalStrategy", "manual");
    fireEvent.change(screen.getByLabelText("Withdrawal strategy"), { target: { value: "inherit" } });
    stored = JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];
    expect(stored[0]).not.toHaveProperty("withdrawalStrategy");
  });

  it("tax-minimizing strategy hides order controls, keeps the saved order, and restores it when manual returns", () => {
    const ws = makeWorkspace();
    ws.scenarios.push({ ...delta, overrides: { retirementAge: 62, withdrawalOrder: ["nonreg", "tfsa", "rrsp"] } });
    render(<StoreProvider initialWorkspace={ws} initialBaseScenario={DEFAULT_SCENARIO_BASE}><ScenariosView /><ScenariosProbe /></StoreProvider>);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    expect(screen.getByLabelText(/1st drawn/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Withdrawal strategy"), { target: { value: "tax-minimizing" } });
    expect(screen.queryByLabelText(/1st drawn/i)).toBeNull();
    expect(screen.queryByLabelText("Cash withdrawal order")).toBeNull();
    expect(screen.getByText("Your saved order is retained as the optimizer fallback.")).toBeTruthy();
    // Edits made while the controls are hidden must not lose the stored order override.
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Renamed under optimizer" } });
    let stored = JSON.parse(screen.getByTestId("scenario-state").textContent ?? "[]") as ScenarioDelta[];
    expect(stored[0]!.overrides.withdrawalOrder).toEqual(["nonreg", "tfsa", "rrsp"]);
    expect(stored[0]!.withdrawalStrategy).toBe("tax-minimizing");
    // Switching back to manual shows the unchanged order again.
    fireEvent.change(screen.getByLabelText("Withdrawal strategy"), { target: { value: "manual" } });
    expect((screen.getByLabelText(/1st drawn/i) as HTMLSelectElement).value).toBe("nonreg");
    expect((screen.getByLabelText("Cash withdrawal order") as HTMLSelectElement).value).toBe("automatic");
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
      return <p data-testid="stored-rates">{JSON.stringify(workspace.workspace.scenarios[0]?.overrides ?? {})}|{stored ? `${stored.equity}/${stored.bond}/${stored.cash}` : "none"}</p>;
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
      `{"retirementAge":62,"returnAssumptions":{"equity":0.055,"bond":0.035,"cash":0.01},"withdrawalOrder":["tfsa","nonreg","rrsp"]}|0.055/0.035/0.01`);

    // Editing while open updates the same delta in place.
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText(/equity %/i), { target: { value: "6" } });
    expect(screen.getByTestId("stored-rates").textContent).toBe(
      `{"retirementAge":62,"returnAssumptions":{"equity":0.06,"bond":0.035,"cash":0.01},"withdrawalOrder":["tfsa","nonreg","rrsp"]}|0.06/0.035/0.01`);
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
