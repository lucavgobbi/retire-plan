import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { RunOutcome } from "../../domain/run";
import type { SimulationRunner } from "../../store/simulationWorkerProtocol";
import { StoreProvider } from "../../store/StoreProvider";
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
