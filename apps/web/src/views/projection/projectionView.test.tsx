import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../../store/StoreProvider";
import { DEFAULT_SCENARIO_BASE } from "../../domain/defaults";
import { makeRunOutPlan, makeSamplePlan, makeWorkspace } from "./testFixtures";
import { ProjectionView } from "./ProjectionView";

function renderView(workspace = makeWorkspace()) {
  return render(
    <StoreProvider initialWorkspace={workspace} initialBaseScenario={DEFAULT_SCENARIO_BASE}>
      <ProjectionView />
    </StoreProvider>,
  );
}

describe("ProjectionView", () => {
  it("prompts to run before any projection exists, and runs on demand", async () => {
    renderView();
    expect(screen.getByText(/run the projection/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    // After running: the year table appears with one row per simulated year (ages 45..100).
    const ages = screen.getAllByRole("row").filter((row) => row.getAttribute("data-age") !== null).length;
    expect(ages).toBe(56); // endAge 100 − currentAge 45 + 1
    expect(document.querySelector(".run-stamp")?.textContent).toContain("Results for Base scenario");
    const results = screen.getByRole("region", { name: "Year-by-year projection results" });
    expect(results.id).toBe("projection-year-table");
    results.focus();
    expect(document.activeElement).toBe(results);
  });

  it("renders one row per year with derived calendar year and net worth", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    // First year: age 45, calendar year derived from birthYear 1981 + 45 = 2026.
    const firstRow = document.querySelector('[data-age="45"]')!;
    expect(firstRow.textContent).toContain("2026");
    expect(firstRow.textContent).toContain("$"); // money columns render
    // Run-out plan sanity never leaks NaN:
    expect(document.body.textContent).not.toContain("NaN");
  });

  it("run-out plan: fail banner appears, rows still render, no NaN anywhere", async () => {
    renderView(makeWorkspace(makeRunOutPlan()));
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    const banner = screen.getByRole("status");
    expect(banner.textContent).toMatch(/fails at age \d+/i);
    expect(banner.textContent).toMatch(/worst shortfall/i);
    // Rows continue rendering after the failure age.
    const ages = screen.getAllByRole("row").filter((row) => row.getAttribute("data-age") !== null).length;
    expect(ages).toBe(56);
    expect(document.body.textContent).not.toContain("NaN");
    // The banner anchors to the failing year's row.
    fireEvent.click(banner);
    const failingRow = document.querySelector('[data-failed="true"]');
    expect(failingRow).toBeTruthy();
  });

  it("expanding a year shows its events and warnings audit trail", async () => {
    renderView(makeWorkspace(makeRunOutPlan()));
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    fireEvent.click(screen.getByRole("button", { name: /^age 47$/i }));
    const detail = document.querySelector('[data-detail-for="47"]');
    expect(detail).toBeTruthy();
    // The run-out plan produces shortfall warnings in the audit trail.
    expect(detail!.textContent!.length).toBeGreaterThan(0);
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
