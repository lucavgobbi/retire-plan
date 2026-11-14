import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RunOutcome } from "../../domain/run";
import type { SimulationRunner } from "../../store/simulationWorkerProtocol";
import type { Scenario } from "@retire-plan/engine";
import { StoreProvider, useWorkspace } from "../../store/api";
import { DEFAULT_SCENARIO_BASE } from "../../domain/defaults";
import { makeRunOutPlan, makeSamplePlan, makeWorkspace } from "./testFixtures";
import { ProjectionView } from "./ProjectionView";

function renderView(workspace = makeWorkspace(), simulationRunner?: SimulationRunner, baseScenario = DEFAULT_SCENARIO_BASE) {
  return render(
    <StoreProvider initialWorkspace={workspace} initialBaseScenario={baseScenario} simulationRunner={simulationRunner}>
      <ProjectionView />
    </StoreProvider>,
  );
}

const emptyOutcome = { result: { years: [], summary: { success: true, finalNetWorth: 0 } } } as RunOutcome;

function makeWorkspaceWithScenario(): ReturnType<typeof makeWorkspace> {
  const workspace = makeWorkspace();
  workspace.scenarios.push({ id: "scen-a", name: "Scenario A", basePlanId: "plan-test", simMode: "deterministic", overrides: {} });
  workspace.scenarios.push({ id: "scen-b", name: "Scenario B", basePlanId: "plan-test", simMode: "deterministic", overrides: {} });
  return workspace;
}

function selectScenario(name: string) {
  fireEvent.change(screen.getByRole("combobox", { name: /scenario to run/i }), { target: { value: name } });
}

describe("ProjectionView scenario dropdown (user item 7)", () => {
  it("defaults to baseline: the run is stamped as the base scenario", async () => {
    renderView(makeWorkspaceWithScenario());
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(document.querySelector(".run-stamp")).toBeTruthy());
    const stamp = document.querySelector(".run-stamp")!.textContent;
    expect(stamp).toContain("Base scenario");
    expect(stamp).toContain("(baseline)");
  });

  it("selecting a saved scenario runs THAT scenario and stamps its name", async () => {
    renderView(makeWorkspaceWithScenario());
    selectScenario("scen-a");
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(document.querySelector(".run-stamp")).toBeTruthy());
    const stamp = document.querySelector(".run-stamp")!.textContent;
    expect(stamp).toContain("Scenario A");
    expect(stamp).not.toContain("Base scenario");
  });

  it("locks the dropdown for the whole run window; cancel means cancelling the running projection", async () => {
    let finish: (() => void) | undefined;
    const started: string[] = [];
    const simulationRunner: SimulationRunner = () => {
      started.push("run");
      return new Promise((resolve) => { finish = () => resolve(emptyOutcome); });
    };
    renderView(makeWorkspaceWithScenario(), simulationRunner);
    selectScenario("scen-a");
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    expect(screen.getByText("Projection running in the background…")).toBeTruthy();
    // Locked for the entire run window: no selection switch, no second run.
    expect((screen.getByRole("combobox", { name: /scenario to run/i }) as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /run projection/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(started).toHaveLength(1);
    expect(document.querySelector(".run-stamp")).toBeNull();
    // Cancel targets the running projection; the late result is discarded.
    fireEvent.click(screen.getByRole("button", { name: /cancel projection/i }));
    expect(screen.getByText("Projection cancelled.")).toBeTruthy();
    finish?.();
    await waitFor(() => expect((screen.getByRole("combobox", { name: /scenario to run/i }) as HTMLSelectElement).disabled).toBe(false));
    expect(document.querySelector(".run-stamp")).toBeNull();
    expect(started).toHaveLength(1);
  });

  it("a completed baseline run is not displayed as the result of a newly selected scenario", async () => {
    renderView(makeWorkspaceWithScenario());
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(document.querySelector(".run-stamp")).toBeTruthy());
    // Switch to Scenario B: the baseline run stays hidden — no stale wrong-scenario display.
    selectScenario("scen-b");
    expect(document.querySelector(".run-stamp")).toBeNull();
    expect(screen.getByText(/run the projection/i)).toBeTruthy();
    // Switching back re-shows the (still matching) baseline run.
    selectScenario("");
    expect(document.querySelector(".run-stamp")?.textContent).toContain("Base scenario");
  });

  it("falls back to baseline with BASE assumptions when the selected scenario is deleted while mounted", async () => {
    const workspace = makeWorkspace();
    workspace.scenarios.push({
      id: "scen-a",
      name: "Scenario A",
      basePlanId: "plan-test",
      simMode: "montecarlo",
      overrides: { retirementAge: 70 },
    });
    const received: Scenario[] = [];
    const simulationRunner: SimulationRunner = (_plan, scenario) => {
      received.push(scenario);
      return Promise.resolve(emptyOutcome);
    };
    let dispatchRef: ((action: Parameters<ReturnType<typeof useWorkspace>["dispatch"]>[0]) => void) | undefined;
    function DispatchProbe() {
      const ws = useWorkspace();
      dispatchRef = ws.dispatch;
      return null;
    }
    const view = render(
      <StoreProvider initialWorkspace={workspace} initialBaseScenario={DEFAULT_SCENARIO_BASE} simulationRunner={simulationRunner}>
        <DispatchProbe />
        <ProjectionView />
      </StoreProvider>,
    );
    selectScenario("scen-a");
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(document.querySelector(".run-stamp")?.textContent).toContain("Scenario A"));
    // The run carried the scenario's actual assumptions, not the base's.
    expect(received).toHaveLength(1);
    expect(received[0]!.simMode).toBe("montecarlo");
    expect(received[0]!.retirementAge).toBe(70);

    // Delete the selected scenario while the view is mounted (same path as ScenarioList).
    act(() => { dispatchRef?.({ type: "scenario/remove", delta: workspace.scenarios[0]! }); });
    // Selection falls back to BASE: the dropdown shows baseline and the Scenario A
    // run is filtered out (no wrong-scenario display).
    expect((screen.getByRole("combobox", { name: /scenario to run/i }) as HTMLSelectElement).value).toBe("");
    expect(document.querySelector(".run-stamp")).toBeNull();
    // Running again must dispatch the BASE scenario's assumptions.
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(document.querySelector(".run-stamp")?.textContent).toContain("Base scenario"));
    expect(received).toHaveLength(2);
    expect(received[1]!.simMode).toBe(DEFAULT_SCENARIO_BASE.simMode);
    expect(received[1]!.retirementAge).toBe(DEFAULT_SCENARIO_BASE.retirementAge);
    // Restoring the SAME scenario id later must NOT auto-reselect (the stale
    // selection state was actually reset): the dropdown stays on baseline.
    act(() => { dispatchRef?.({ type: "scenario/add", delta: workspace.scenarios[0]! }); });
    expect((screen.getByRole("combobox", { name: /scenario to run/i }) as HTMLSelectElement).value).toBe("");
    // Manual reselection after restore works and dispatches the scenario's assumptions.
    selectScenario("scen-a");
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(document.querySelector(".run-stamp")?.textContent).toContain("Scenario A"));
    expect(received).toHaveLength(3);
    expect(received[2]!.simMode).toBe("montecarlo");
    expect(received[2]!.retirementAge).toBe(70);
    view.unmount();
  });

  it("falls back to baseline when a workspace import drops the selected scenario while mounted", async () => {
    const workspace = makeWorkspace();
    workspace.scenarios.push({
      id: "scen-a",
      name: "Scenario A",
      basePlanId: "plan-test",
      simMode: "montecarlo",
      overrides: { retirementAge: 70 },
    });
    const received: Scenario[] = [];
    const simulationRunner: SimulationRunner = (_plan, scenario) => {
      received.push(scenario);
      return Promise.resolve(emptyOutcome);
    };
    let dispatchRef: ((action: Parameters<ReturnType<typeof useWorkspace>["dispatch"]>[0]) => void) | undefined;
    function DispatchProbe() {
      const ws = useWorkspace();
      dispatchRef = ws.dispatch;
      return null;
    }
    const view = render(
      <StoreProvider initialWorkspace={workspace} initialBaseScenario={DEFAULT_SCENARIO_BASE} simulationRunner={simulationRunner}>
        <DispatchProbe />
        <ProjectionView />
      </StoreProvider>,
    );
    selectScenario("scen-a");
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(document.querySelector(".run-stamp")?.textContent).toContain("Scenario A"));
    expect(received[0]!.simMode).toBe("montecarlo");

    // Import a workspace without Scenario A (different plan id, no scenarios).
    const imported = makeWorkspace();
    imported.meta = { id: "plan-imported", name: "Imported plan", updatedAt: "2026-02-01T00:00:00.000Z" };
    act(() => { dispatchRef?.({ type: "workspace/loaded", workspace: imported }); });
    // Selection falls back to baseline and binds the imported plan's id: no stale
    // display, and Run dispatches the base scenario's assumptions.
    expect((screen.getByRole("combobox", { name: /scenario to run/i }) as HTMLSelectElement).value).toBe("");
    expect(document.querySelector(".run-stamp")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(document.querySelector(".run-stamp")?.textContent).toContain("Base scenario"));
    expect(received).toHaveLength(2);
    expect(received[1]!.simMode).toBe(DEFAULT_SCENARIO_BASE.simMode);
    expect(received[1]!.retirementAge).toBe(DEFAULT_SCENARIO_BASE.retirementAge);
    view.unmount();
  });
});

describe("ProjectionView", () => {
  it("shows rolling-window outcomes and separates source years from household calendar years", async () => {
    const plan = makeSamplePlan();
    plan.profile.endAge = plan.profile.currentAge + 1;
    const base = { ...DEFAULT_SCENARIO_BASE, simMode: "historical" as const, historicalConfig: { startYear: 1872 } };
    renderView(makeWorkspace(plan), undefined, base);
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    const summary = await screen.findByRole("complementary", { name: "Historical results" });
    expect(summary.textContent).toContain("148 complete rolling windows");
    expect(summary.textContent).toContain("1872 through 2019");
    const representativeSpan = Array.from(summary.querySelectorAll("dd")).at(-1)!.textContent!;
    const representativeStart = Number(representativeSpan.split("–")[0]);
    const yearRow = document.querySelector('[data-age="45"]')!;
    expect(yearRow.querySelectorAll("td")[1]?.textContent).toContain("2026");
    expect(yearRow.querySelectorAll("td")[1]?.textContent).toContain(`Return source: ${representativeStart}`);
    fireEvent.click(screen.getByRole("button", { name: /expand ages 45–46/i }));
    fireEvent.click(screen.getByRole("button", { name: "Age 45" }));
    const warnings = document.querySelector('[data-detail-for="45"] [aria-label="Warnings"]')!;
    expect(warnings.textContent).toContain(`Household calendar year 2026 uses historical return source year ${representativeStart}`);
  });

  it("shows busy and cancel state, and ignores a late result after cancellation", async () => {
    let finish: (() => void) | undefined;
    const simulationRunner: SimulationRunner = () => new Promise((resolve) => { finish = () => resolve(emptyOutcome); });
    renderView(makeWorkspace(), simulationRunner);
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    expect(screen.getByText("Projection running in the background…")).toBeTruthy();
    expect((screen.getByRole("button", { name: /run projection/i }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /cancel projection/i }));
    expect(screen.getByText("Projection cancelled.")).toBeTruthy();
    finish?.();
    await waitFor(() => expect(document.querySelector(".run-stamp")).toBeNull());
  });

  it("prompts to run before any projection exists, and runs on demand", async () => {
    renderView();
    expect(screen.getByText(/run the projection/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(document.querySelectorAll(".decade-row")).toHaveLength(6));
    // Results begin as six consecutive decade summaries (the final group is partial).
    expect(document.querySelectorAll(".decade-row")).toHaveLength(6);
    expect(document.querySelectorAll(".yearly-row[data-group-collapsed='true']")).toHaveLength(56);
    expect(screen.getByRole("button", { name: /expand ages 95–100/i })).toBeTruthy();
    expect(document.querySelector(".run-stamp")?.textContent).toContain("Results for Base scenario");
    const results = screen.getByRole("region", { name: "Year-by-year projection results" });
    expect(results.id).toBe("projection-year-table");
    expect(results.querySelectorAll("thead > tr")).toHaveLength(2);
    expect(results.querySelectorAll('thead th[scope="col"]')).toHaveLength(36);
    expect(Array.from(results.querySelectorAll("thead tr:last-child th")).filter((cell) => cell.textContent === "Expenses")).toHaveLength(1);
    expect(results.querySelector('thead tr:first-child th[rowspan="2"]')?.textContent).toBe("Audit");
    results.focus();
    expect(document.activeElement).toBe(results);
  });

  it("renders one row per year with derived calendar year and net worth", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    // First year: age 45, calendar year derived from birthYear 1981 + 45 = 2026.
    await waitFor(() => expect(document.querySelector('[data-age="45"]')).toBeTruthy());
    const firstRow = document.querySelector('[data-age="45"]')!;
    expect(document.querySelector(".decade-row")?.textContent).toContain("2026–2035");
    expect(document.querySelector(".decade-row")?.textContent).toContain("$"); // summary money columns render
    // Run-out plan sanity never leaks NaN:
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("run-out plan: fail banner appears, rows still render, no NaN anywhere", async () => {
    renderView(makeWorkspace(makeRunOutPlan()));
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(document.querySelector(".fail-banner")).toBeTruthy());
    const banner = document.querySelector(".fail-banner")!;
    expect(banner.textContent).toMatch(/fails at age \d+/i);
    expect(banner.textContent).toMatch(/worst shortfall/i);
    // Rows continue rendering after the failure age.
    expect(document.querySelectorAll(".decade-row")).toHaveLength(6);
    expect(document.body.textContent).not.toContain("NaN");
    // The banner anchors to the failing year's row.
    fireEvent.click(banner);
    expect(screen.getByRole("button", { name: /collapse ages 45–54/i }).getAttribute("aria-expanded")).toBe("true");
    const failingRow = document.querySelector('[data-failed="true"]');
    expect(failingRow).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /collapse ages 45–54/i }));
    fireEvent.click(banner);
    expect(screen.getByRole("button", { name: /collapse ages 45–54/i }).getAttribute("aria-expanded")).toBe("true");
  });

  it("expanding a year shows its events and warnings audit trail", async () => {
    renderView(makeWorkspace(makeRunOutPlan()));
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await screen.findByRole("button", { name: /expand ages 45–54/i });
    fireEvent.click(screen.getByRole("button", { name: /expand ages 45–54/i }));
    fireEvent.click(screen.getByRole("button", { name: /^age 47$/i }));
    const detail = document.querySelector('[data-detail-for="47"]');
    expect(detail).toBeTruthy();
    // The run-out plan produces shortfall warnings in the audit trail.
    expect(detail!.textContent!.length).toBeGreaterThan(0);
    expect(detail!.querySelector('[aria-label="Savings flows"] h4')?.textContent).toBe("Savings flows");
    expect(detail!.querySelector('[aria-label="Net worth breakdown"] h4')?.textContent).toBe("Net worth breakdown");
    const expenses = detail!.querySelector('[aria-label="Expenses"]');
    expect(expenses?.textContent).toContain("Spending");
    expect(expenses?.textContent).toContain("Modelled annual total");
  });

  it("shows the actual RRIF minimum and allocated surplus as informational detail", async () => {
    const plan = makeSamplePlan();
    plan.profile.currentAge = 71;
    plan.profile.endAge = 71;
    plan.accounts = [
      { id: "rrsp", type: "rrsp", balance: 1_000_000, assetMix: { equity: 0, bond: 0, cash: 1 } },
      { id: "tfsa", type: "tfsa", balance: 0, assetMix: { equity: 0, bond: 0, cash: 1 } },
      { id: "nonreg", type: "nonreg", balance: 0, assetMix: { equity: 0, bond: 0, cash: 1 } },
    ];
    plan.incomes = [];
    plan.expenses = [{ id: "life", name: "Life", annualAmount: 12_000, startAge: 71, inflationRate: 0 }];
    plan.savingsPolicy = [
      { id: "tfsa", priority: 1, target: "tfsa", perYearCap: 7_000 },
      { id: "nonreg", priority: 2, target: "nonreg" },
    ];
    renderView(makeWorkspace(plan));
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(document.querySelector('[data-age="71"]')).toBeTruthy());
    const yearRow = document.querySelector('[data-age="71"]');
    expect(yearRow).toBeTruthy();
    const group = yearRow!.closest("tbody")!.querySelector('[data-group-start-age="65"]');
    expect(group).toBeTruthy();
    fireEvent.click(group!.querySelector("button")!);
    fireEvent.click(screen.getByRole("button", { name: /^age 71$/i }));

    const detail = document.querySelector('[data-detail-for="71"]')!;
    const warnings = detail.querySelector('[aria-label="Warnings"]')!;
    expect(warnings.textContent).toContain("Required RRIF minimum:");
    expect(warnings.textContent).toContain("This draw is required even when spending needs are lower.");
    expect(warnings.textContent).toContain("After spending, tax, and scheduled mortgage payments, surplus cash was reinvested:");
    expect(warnings.textContent).toContain("TFSA $7,000.00");
    expect(warnings.textContent).toContain("non-registered");
    expect(warnings.textContent).toContain("not new employment savings");
    expect(warnings.querySelectorAll("li")).toHaveLength(0);
  });

  it("disables the run when the plan is invalid (engine must not be invoked)", async () => {
    const broken = makeWorkspace();
    broken.plan.profile.endAge = 10; // validatePlan errors
    renderView(broken);
    const button = screen.getByRole("button", { name: /run projection/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText(/fix \d+ plan validation error/i)).toBeTruthy();
  });
});

function HiddenColumnsProbe() {
  const { workspace } = useWorkspace();
  return (
    <>
      <output data-testid="hidden-columns-state">{JSON.stringify(workspace.hiddenProjectionColumns ?? null)}</output>
      <output data-testid="hidden-charts-state">{JSON.stringify(workspace.hiddenProjectionCharts ?? null)}</output>
    </>
  );
}

describe("projection table column selector", () => {
  it("restores persisted hidden columns on load: an entire hidden group drops its header, member headers and body cells; pinned columns stay", async () => {
    const ws = makeWorkspace();
    ws.hiddenProjectionColumns = ["income.employment", "income.cpp", "income.oas", "income.gis", "income.other", "stale.column"];
    render(
      <StoreProvider initialWorkspace={ws} initialBaseScenario={DEFAULT_SCENARIO_BASE}>
        <ProjectionView />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(document.querySelector(".projection-table")).toBeTruthy());
    // The whole Income group is hidden → its group header and member headers vanish;
    // a stale id from an older version is ignored without breaking anything.
    expect(screen.queryByRole("columnheader", { name: "Income" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Employment" })).toBeNull();
    expect(screen.getByRole("columnheader", { name: "Tax" })).toBeTruthy();
    // Pinned Age/calendar-year and the Audit column always remain.
    expect(screen.getByRole("columnheader", { name: "Household calendar year" })).toBeTruthy();
    expect(screen.getByRole("columnheader", { name: "Audit" })).toBeTruthy();
    // Every decade summary row drops exactly the five hidden cells (36 → 31 each).
    const decadeRows = document.querySelectorAll(".projection-table tbody tr.decade-row");
    expect(decadeRows.length).toBeGreaterThan(0);
    for (const row of decadeRows) expect(row.querySelectorAll("td").length).toBe(31);
  });

  it("picker toggles persist in workspace state across re-renders; Show everything restores the default", async () => {
    render(
      <StoreProvider initialWorkspace={makeWorkspace()} initialBaseScenario={DEFAULT_SCENARIO_BASE}>
        <ProjectionView />
        <HiddenColumnsProbe />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(document.querySelector(".projection-table")).toBeTruthy());
    // Default (no stored preference): every column visible, nothing persisted.
    expect(screen.getByRole("columnheader", { name: "Interest" })).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("hidden-columns-state").textContent ?? "null")).toBeNull();

    fireEvent.click(screen.getByRole("checkbox", { name: "Interest" }));
    expect(screen.queryByRole("columnheader", { name: "Interest" })).toBeNull();
    expect(JSON.parse(screen.getByTestId("hidden-columns-state").textContent ?? "null")).toEqual(["cash.interest"]);

    fireEvent.click(screen.getByRole("button", { name: "Show everything" }));
    expect(screen.getByRole("columnheader", { name: "Interest" })).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("hidden-columns-state").textContent ?? "null")).toBeNull();
  });

  it("projection settings gear opens with its accessible name; chart toggles persist and default to all visible", async () => {
    render(
      <StoreProvider initialWorkspace={makeWorkspace()} initialBaseScenario={DEFAULT_SCENARIO_BASE}>
        <ProjectionView />
        <HiddenColumnsProbe />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(document.querySelector(".projection-table")).toBeTruthy());
    // Default: all seven dashboard charts visible, nothing persisted.
    expect(screen.getAllByRole("figure").length).toBe(7);
    expect(JSON.parse(screen.getByTestId("hidden-columns-state").textContent ?? "null")).toBeNull();

    // The gear trigger is a native disclosure summary: keyboard-activatable with
    // the accessible name "Projection settings" (summary has an implicit button
    // role in browsers; jsdom needs the attribute assertions).
    const gear = document.querySelector(".projection-settings summary") as HTMLElement;
    expect(gear).toBeTruthy();
    expect(gear.getAttribute("aria-label")).toBe("Projection settings");
    expect(gear.querySelector("svg")).toBeTruthy();

    // Opening the menu shows both configuration groups in one place.
    fireEvent.click(gear);
    expect(document.querySelector(".projection-settings")!.hasAttribute("open")).toBe(true);
    expect(screen.getByRole("checkbox", { name: "Interest" })).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Tax by component" })).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "Tax by component" }));
    expect(screen.queryByRole("figure", { name: "Tax by component chart" })).toBeNull();
    expect(screen.getAllByRole("figure").length).toBe(6);
    expect(JSON.parse(screen.getByTestId("hidden-charts-state").textContent ?? "null")).toEqual(["tax"]);

    fireEvent.click(screen.getByRole("button", { name: "Show everything" }));
    expect(screen.getByRole("figure", { name: "Tax by component chart" })).toBeTruthy();
    expect(JSON.parse(screen.getByTestId("hidden-charts-state").textContent ?? "null")).toBeNull();
    // The "Show everything" button clears BOTH groups.
    expect(JSON.parse(screen.getByTestId("hidden-columns-state").textContent ?? "null")).toBeNull();
  });

  it("restores persisted hidden charts on load; stale chart ids are ignored", async () => {
    const ws = makeWorkspace();
    ws.hiddenProjectionCharts = ["income-spend", "stale.chart"];
    render(
      <StoreProvider initialWorkspace={ws} initialBaseScenario={DEFAULT_SCENARIO_BASE}>
        <ProjectionView />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(document.querySelector(".projection-table")).toBeTruthy());
    expect(screen.getAllByRole("figure").length).toBe(6);
    expect(screen.queryByRole("figure", { name: "Income versus spending chart" })).toBeNull();
    expect(screen.getByRole("figure", { name: "Tax by component chart" })).toBeTruthy();
  });
});
