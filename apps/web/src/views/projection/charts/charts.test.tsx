import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StoreProvider } from "../../../store/StoreProvider";
import { DEFAULT_SCENARIO_BASE } from "../../../domain/defaults";
import { makeRunOutPlan, makeSamplePlan, makeWorkspace } from "../testFixtures";
import { DashboardSection } from "../DashboardSection";
import { NetWorthChart } from "./NetWorthChart";
import { IncomeSpendChart } from "./IncomeSpendChart";
import { TaxStackChart } from "./TaxStackChart";
import { DrawDownChart } from "./DrawDownChart";

function renderView(workspace = makeWorkspace()) {
  return render(
    <StoreProvider initialWorkspace={workspace} initialBaseScenario={DEFAULT_SCENARIO_BASE}>
      <DashboardSection />
    </StoreProvider>,
  );
}

const CHART_TITLES = [/net worth/i, /income vs spending/i, /tax by component/i, /account drawdown/i];

describe("DashboardSection (integration: plan → run → charts)", () => {
  it("renders nothing meaningful before a run exists", () => {
    renderView();
    expect(screen.queryByRole("figure")).toBeNull();
    expect(screen.getByText(/run the projection/i)).toBeTruthy();
  });

  it("renders all four chart titles after a run", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    for (const title of CHART_TITLES) {
      // Title + hint may both mention the metric (e.g. "Net worth"); at least one card each.
      expect(screen.getAllByText(title).length).toBeGreaterThanOrEqual(1);
    }
    // Every chart is an accessible figure with a labeled SVG.
    const svgs = screen.getAllByRole("figure").map((figure) => figure.querySelector("svg"));
    for (const svg of svgs) expect(svg?.getAttribute("aria-label")).toBeTruthy();
  });

  it("run-out plan still renders charts without NaN anywhere", () => {
    renderView(makeWorkspace(makeRunOutPlan()));
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    expect(screen.getAllByText(/net worth/i).length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toContain("NaN");
  });
});

describe("individual charts render as SVG", () => {
  it("NetWorthChart draws a polyline over age", () => {
    const { container } = render(<NetWorthChart points={[{ x: 45, y: 100 }, { x: 46, y: 200 }]} />);
    expect(container.querySelector("polyline")).toBeTruthy();
  });

  it("stacked charts draw one area per series", () => {
    const tax = render(
      <TaxStackChart
        points={[
          { x: 66, federal: 1, provincial: 1, surtax: 1, oasClawback: 1, total: 4 },
          { x: 67, federal: 2, provincial: 2, surtax: 2, oasClawback: 2, total: 8 },
        ]}
      />,
    );
    expect(tax.container.querySelectorAll("path").length).toBeGreaterThanOrEqual(4);

    const draw = render(
      <DrawDownChart points={[{ x: 70, tfsa: 1, rrsp: 1, nonreg: 1, cash: 1 }]} />,
    );
    expect(draw.container.querySelectorAll("path").length).toBeGreaterThanOrEqual(4);
  });

  it("IncomeSpendChart draws income and spending bands", () => {
    const { container } = render(
      <IncomeSpendChart points={[{ x: 45, income: 3, expenses: 2, shortfall: 0 }]} />,
    );
    expect(container.querySelectorAll("path, polyline").length).toBeGreaterThanOrEqual(2);
  });

  it("charts render with the sample plan after a full run (smoke via view)", () => {
    renderView(makeWorkspace(makeSamplePlan()));
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    expect(screen.getAllByRole("figure")).toHaveLength(4);
  });
});
