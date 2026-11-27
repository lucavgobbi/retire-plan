import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Action } from "../../domain/actions";
import { createEmptyWorkspace } from "../../domain/defaults";
import { runScenario } from "../../domain/run";
import { StoreProvider, useWorkspace } from "../../store/api";
import type { SimulationRunner } from "../../store/simulationWorkerProtocol";
import { ProjectionView } from "../projection/ProjectionView";
import { makeSamplePlan, makeWorkspace } from "../projection/testFixtures";

const NOW = () => "2026-01-01T00:00:00Z";

function fixture() {
  const plan = makeSamplePlan();
  plan.profile.endAge = 67;
  delete plan.incomes[0]!.endAge;
  plan.incomes[0]!.endAtRetirement = true;
  const workspace = makeWorkspace(plan);
  workspace.projectionActiveTab = "compare";
  workspace.scenarios = [
    {
      id: "early",
      name: "Earlier retirement",
      basePlanId: "plan-test",
      simMode: "deterministic",
      overrides: { retirementAge: 62 },
      benefits: { cpp: false, oas: true, gis: true },
    },
    { id: "base", name: "Base scenario", basePlanId: "plan-test", simMode: "deterministic", overrides: {} },
    { id: "another", name: "Foreign scenario", basePlanId: "different-plan", simMode: "deterministic", overrides: {} },
  ];
  return workspace;
}

function mount(workspace = fixture(), runner?: SimulationRunner, edit?: Action) {
  function Edit() {
    const { dispatch } = useWorkspace();
    return edit ? <button onClick={() => dispatch(edit)}>Edit workspace</button> : null;
  }
  return render(
    <StoreProvider initialWorkspace={workspace} now={NOW} simulationRunner={runner}>
      <ProjectionView />
      <Edit />
    </StoreProvider>,
  );
}

const run = () => fireEvent.click(screen.getByRole("button", { name: "Run comparison" }));
async function outcomes() {
  const summary = await screen.findByText("Outcomes and assumptions");
  if (!summary.closest("details")?.open) fireEvent.click(summary);
  return screen.getByRole("region", { name: "Side-by-side scenario outcomes" });
}
const projectionTabs = () => within(screen.getByRole("tablist", { name: "Projection view" }));
const comparisonTabs = () => within(screen.getByRole("tablist", { name: "Comparison view" }));
const cells = (region: HTMLElement, row: RegExp) =>
  within(within(region).getByRole("rowheader", { name: row }).closest("tr")!)
    .getAllByRole("cell")
    .map((cell) => cell.textContent);

describe("Compare tab", () => {
  it("runs real scenario changes explicitly, shows aligned metrics and keyboard chart points, and preserves single-run controls", async () => {
    const workspace = fixture();
    workspace.plan.savingsPolicy = [
      { id: "match", target: "rrsp-match", priority: 1, perYearCap: 500, matchRate: 0.5 },
    ];
    mount(workspace);
    expect(screen.queryByRole("button", { name: "Run projection" })).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("option", { name: "Foreign scenario" })).toBeNull();
    run();
    const region = await outcomes();
    // GIS offsets half the $8,000 of annual CPP income lost.
    expect(cells(region, /average retirement income/i)[1]).toMatch(/−\$4,000 vs baseline/);
    expect(cells(region, /lifetime taxes/i)[1]).toMatch(/−\$/);
    expect(cells(region, /net worth at shared end/i)[1]).toMatch(/−\$/);
    const assumptions = screen.getByRole("region", { name: "Resolved scenario assumptions" });
    expect(cells(assumptions, /retirement age/i)).toEqual(["Age 65", "Age 62Changed"]);
    expect(cells(assumptions, /benefits enabled/i)).toEqual(["CPP, OAS, GIS", "OAS, GISChanged"]);
    const charts = within(screen.getByRole("group", { name: "Income sources" }));
    const baselineChart = within(charts.getByRole("figure", { name: /Base scenario/ }));
    const alternativeChart = within(charts.getByRole("figure", { name: /Earlier retirement/ }));
    fireEvent.keyDown(baselineChart.getByRole("img"), { key: "End" });
    fireEvent.keyDown(alternativeChart.getByRole("img"), { key: "End" });
    expect(baselineChart.getByRole("status").textContent).toMatch(/Base scenario · 2048 \(age 67\).*CPP \$8,000/);
    expect(alternativeChart.getByRole("status").textContent).toMatch(/Earlier retirement · 2048 \(age 67\).*CPP \$0/);
    const yTicks = (chart: ReturnType<typeof within>) =>
      [...chart.getByRole("img").querySelectorAll('text[text-anchor="end"]')].map((row) => row.textContent);
    expect(yTicks(baselineChart)).toEqual(yTicks(alternativeChart));

    const chartSettings = within(screen.getByRole("tabpanel", { name: "Charts" })).getByLabelText("Chart settings");
    fireEvent.click(chartSettings);
    const chartToggle = within(chartSettings.parentElement!).getByRole("checkbox", { name: "Income sources" });
    fireEvent.click(chartToggle);
    expect(screen.queryByRole("group", { name: "Income sources" })).toBeNull();
    fireEvent.click(chartToggle);

    const chartsTab = comparisonTabs().getByRole("tab", { name: "Charts", selected: true });
    fireEvent.keyDown(chartsTab, { key: "ArrowRight" });
    const cashflowTab = comparisonTabs().getByRole("tab", { name: "Cashflow", selected: true });
    expect(document.activeElement).toBe(cashflowTab);
    expect(screen.queryByRole("group", { name: "Income sources" })).toBeNull();
    const cashflowPanel = within(screen.getByRole("tabpanel", { name: "Cashflow" }));
    expect(cashflowPanel.getByRole("region", { name: "Cashflow projection comparison" })).toBeTruthy();
    const baseline = within(cashflowPanel.getByRole("region", { name: "Base scenario" }));
    const alternative = within(cashflowPanel.getByRole("region", { name: "Earlier retirement" }));
    expect(baseline.getByRole("group", { name: "Cashflow Sankey diagram" })).toBeTruthy();
    expect(alternative.getByRole("group", { name: "Cashflow Sankey diagram" })).toBeTruthy();
    fireEvent.change(baseline.getByLabelText("Start year"), { target: { value: "2044" } });
    expect(alternative.getByLabelText<HTMLSelectElement>("Start year").value).toBe("2044");
    expect(baseline.getByText(/Employer match → RRSP/, { selector: "strong" })).toBeTruthy();
    expect(alternative.queryByText(/Employer match → RRSP/)).toBeNull();
    fireEvent.change(baseline.getByLabelText("Start year"), { target: { value: "2048" } });
    fireEvent.click(alternative.getByRole("checkbox", { name: "Show accounts" }));
    expect(baseline.getByRole<HTMLInputElement>("checkbox", { name: "Show accounts" }).checked).toBe(true);
    expect(baseline.getByRole("button", { name: /CPP to Cashflow pool, \$8,000/ })).toBeTruthy();
    const tableSettings = cashflowPanel.getByLabelText("Table settings");
    fireEvent.click(tableSettings);
    const tableToggle = within(tableSettings.parentElement!).getByRole("checkbox", { name: "Select all columns" });
    const comparisonTable = within(cashflowPanel.getByRole("region", { name: "Cashflow projection comparison" }));
    const fullColumnCount = comparisonTable.getAllByRole("columnheader").length;
    fireEvent.click(tableToggle);
    expect(comparisonTable.getAllByRole("columnheader").length).toBeLessThan(fullColumnCount);
    expect(baseline.getByLabelText<HTMLSelectElement>("Start year").value).toBe("2048");
    fireEvent.click(tableToggle);
    expect(alternative.queryByRole("button", { name: /CPP to Cashflow pool/ })).toBeNull();
    const ids = [...document.querySelectorAll("[id]")].map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    fireEvent.keyDown(cashflowTab, { key: "Home" });
    expect(comparisonTabs().getByRole("tab", { name: "Charts", selected: true })).toBe(document.activeElement);
    expect(await screen.findByRole("group", { name: "Income sources" })).toBeTruthy();
    fireEvent.click(comparisonTabs().getByRole("tab", { name: "Cashflow" }));
    fireEvent.click(projectionTabs().getByRole("tab", { name: "Charts" }));
    expect(screen.getByRole("button", { name: "Run projection" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reset runs" })).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Compare" }));
    expect(await outcomes()).toBeTruthy();
    expect(comparisonTabs().getByRole("tab", { name: "Cashflow", selected: true })).toBeTruthy();
  });

  it("can select a saved baseline and two alternatives, with distinguishable duplicate names", async () => {
    mount();
    const base = screen.getByRole<HTMLSelectElement>("combobox", { name: "Baseline" });
    const second = screen.getByRole("combobox", { name: /alternative 2/i });
    fireEvent.change(second, { target: { value: "scenario:base" } });
    fireEvent.change(base, { target: { value: "early" } });
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Alternative 1" }).value).toBe("scenario:");
    run();
    const region = await outcomes();
    expect(within(region).getByRole("columnheader", { name: /Earlier retirement.*Baseline/ })).toBeTruthy();
    expect(within(region).getByRole("columnheader", { name: "Base scenario (2)" })).toBeTruthy();
    expect(
      within(screen.getByRole("group", { name: "Net worth" })).getByRole("figure", { name: /Base scenario \(2\)/ }),
    ).toBeTruthy();
    fireEvent.change(base, { target: { value: "" } });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(/selections changed/i);
  });

  it("labels Monte Carlo paths and historical windows separately from ensemble outcomes", async () => {
    const workspace = fixture();
    workspace.scenarios[0]!.simMode = "montecarlo";
    workspace.scenarios[0]!.mcConfig = { runs: 3, seed: 4, stdDev: { equity: 0.12, bond: 0.04, cash: 0.01 } };
    workspace.scenarios[1]!.simMode = "historical";
    workspace.scenarios[1]!.historicalConfig = { startYear: 1990 };
    workspace.scenarios[1]!.withdrawalStrategy = "tax-minimizing";
    workspace.projectionComparison = { baselineId: "", alternativeIds: ["early", "base"] };
    mount(workspace);
    run();
    const region = await outcomes();
    expect(cells(region, /displayed path/i)).toEqual([
      "Deterministic projection",
      expect.stringMatching(/Representative Monte Carlo path \(run \d+\)/),
      expect.stringMatching(/Representative historical path \(returns from \d+–\d+; \d+ windows tested\)/),
    ]);
    expect(cells(region, /monte carlo success rate/i)).toEqual(["—", expect.stringMatching(/%$/), "—"]);
    expect(cells(region, /historical windows that succeeded/i)).toEqual(["—", "—", expect.stringMatching(/%$/)]);
    expect(cells(region, /median final net worth/i)).toEqual([
      "—",
      expect.stringMatching(/\$/),
      expect.stringMatching(/\$/),
    ]);
    const assumptions = screen.getByRole("region", { name: "Resolved scenario assumptions" });
    expect(cells(assumptions, /annual return assumptions/i)[2]).toMatch(
      /Historical returns · planning rates 5% equity/,
    );
  });

  it("reuses only matching single runs and resets results while keeping selections", async () => {
    const runner = vi.fn<SimulationRunner>(async (plan, scenario) => runScenario(plan, scenario));
    mount(fixture(), runner, { type: "plan/setProfile", patch: { endAge: 66 } });

    fireEvent.click(projectionTabs().getByRole("tab", { name: "Charts" }));
    fireEvent.click(screen.getByRole("button", { name: "Run projection" }));
    await screen.findByRole("figure", { name: "Net worth chart" });
    fireEvent.click(screen.getByRole("tab", { name: "Compare" }));
    run();
    expect(await outcomes()).toBeTruthy();
    expect(runner.mock.calls.map(([, scenario]) => scenario.id)).toEqual(["base", "early"]);

    fireEvent.click(screen.getByRole("button", { name: "Edit workspace" }));
    expect(screen.queryByRole("region", { name: "Side-by-side scenario outcomes" })).toBeNull();
    run();
    expect(await outcomes()).toBeTruthy();
    expect(runner.mock.calls.map(([, scenario]) => scenario.id)).toEqual(["base", "early", "base", "early"]);
    fireEvent.click(screen.getByRole("button", { name: "Reset runs" }));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Alternative 1" }).value).toBe("scenario:early");
    fireEvent.click(projectionTabs().getByRole("tab", { name: "Charts" }));
    expect(screen.queryByRole("figure", { name: "Net worth chart" })).toBeNull();
  });

  it("keeps the comparison running while switching its result tabs", async () => {
    let finish!: () => void;
    const runner = vi
      .fn<SimulationRunner>()
      .mockImplementationOnce(
        (plan, scenario) =>
          new Promise((resolve) => {
            finish = () => resolve(runScenario(plan, scenario));
          }),
      )
      .mockImplementation(async (plan, scenario) => runScenario(plan, scenario));
    mount(fixture(), runner);
    run();
    fireEvent.click(comparisonTabs().getByRole("tab", { name: "Cashflow" }));
    expect(runner.mock.calls[0]?.[2]?.aborted).toBe(false);
    await act(async () => finish());
    expect(screen.getByRole("region", { name: "Cashflow projection comparison" })).toBeTruthy();
    fireEvent.click(comparisonTabs().getByRole("tab", { name: "Charts" }));
    expect(screen.getByRole("group", { name: "Net worth" })).toBeTruthy();
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("runs sequentially and discards partial results on failure, then can retry", async () => {
    let finish!: () => void;
    const runner = vi
      .fn<SimulationRunner>()
      .mockImplementationOnce(
        (plan, scenario) =>
          new Promise((resolve) => {
            finish = () => resolve(runScenario(plan, scenario));
          }),
      )
      .mockRejectedValueOnce(new Error("Worker failed"))
      .mockImplementation(async (plan, scenario) => runScenario(plan, scenario));
    mount(fixture(), runner);
    run();
    expect(runner).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("table")).toBeNull();
    await act(async () => finish());
    expect(runner).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("alert").textContent).toBe("Earlier retirement — Worker failed");
    expect(screen.queryByRole("table")).toBeNull();
    run();
    expect(await outcomes()).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each(["cancel", "reset", "plan", "scenario", "delete", "switch plan", "leave tab", "unmount"] as const)(
    "aborts on %s, and ignores a late worker completion",
    async (reason) => {
      const workspace = fixture();
      workspace.projectionComparison = { baselineId: "", alternativeIds: ["early"] };
      const edits: Partial<Record<typeof reason, Action>> = {
        plan: { type: "plan/setProfile", patch: { endAge: 66 } },
        scenario: { type: "scenario/update", delta: { ...workspace.scenarios[0]!, name: "Edited" } },
        delete: { type: "scenario/remove", delta: workspace.scenarios[0]! },
        "switch plan": {
          type: "workspace/loaded",
          workspace: { ...createEmptyWorkspace(), projectionActiveTab: "compare" },
        },
      };
      let finish!: () => void;
      const runner = vi.fn<SimulationRunner>(
        (plan, scenario) =>
          new Promise((resolve) => {
            finish = () => resolve(runScenario(plan, scenario));
          }),
      );
      const view = mount(workspace, runner, edits[reason]);
      run();
      const signal = runner.mock.calls[0]?.[2];
      if (reason === "unmount") view.unmount();
      else if (reason === "leave tab") fireEvent.click(projectionTabs().getByRole("tab", { name: "Charts" }));
      else
        fireEvent.click(
          screen.getByRole("button", {
            name: reason === "cancel" ? "Cancel comparison" : reason === "reset" ? "Reset runs" : "Edit workspace",
          }),
        );
      expect(signal?.aborted).toBe(true);
      await act(async () => finish());
      expect(runner).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("region", { name: "Side-by-side scenario outcomes" })).toBeNull();
      if (reason === "delete") {
        expect(screen.queryByRole("option", { name: "Earlier retirement" })).toBeNull();
        expect(screen.getByRole<HTMLButtonElement>("button", { name: "Run comparison" }).disabled).toBe(true);
      }
      if (reason === "reset") {
        expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "Alternative 1" }).value).toBe("scenario:early");
        expect(screen.queryByRole("status")).toBeNull();
      }
    },
  );
});
