import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SimulationRunner } from "../../../store/simulationWorkerProtocol";
import { StoreProvider } from "../../../store/StoreProvider";
import { DEFAULT_SCENARIO_BASE } from "../../../domain/defaults";
import { makeRunOutPlan, makeSamplePlan, makeWorkspace } from "../testFixtures";
import { DashboardSection } from "../DashboardSection";
import { NetWorthChart } from "./NetWorthChart";
import { IncomeSpendChart } from "./IncomeSpendChart";
import { TaxStackChart } from "./TaxStackChart";
import { DrawDownChart } from "./DrawDownChart";
import { incomeSpendSeries } from "./adapters";
import { yScale } from "./svg";
import type { YearResult } from "@retire-plan/engine";

function renderView(workspace = makeWorkspace(), simulationRunner?: SimulationRunner) {
  return render(
    <StoreProvider initialWorkspace={workspace} initialBaseScenario={DEFAULT_SCENARIO_BASE} simulationRunner={simulationRunner}>
      <DashboardSection />
    </StoreProvider>,
  );
}

const CHART_TITLES = [/net worth/i, /income vs spending/i, /tax by component/i, /account drawdown/i];

describe("DashboardSection (integration: plan → run → charts)", () => {
  it("shows shared busy state and disables its standalone run control", () => {
    const simulationRunner: SimulationRunner = () => new Promise(() => {});
    renderView(makeWorkspace(), simulationRunner);
    const runButton = screen.getByRole("button", { name: /run projection/i }) as HTMLButtonElement;
    fireEvent.click(runButton);
    expect(runButton.disabled).toBe(true);
    expect(screen.getByText("Projection running in the background…")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel projection" }));
  });

  it("renders nothing meaningful before a run exists", () => {
    renderView();
    expect(screen.queryByRole("figure")).toBeNull();
    expect(screen.getByText(/run the projection/i)).toBeTruthy();
  });

  it("renders all four chart titles after a run", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(screen.getAllByRole("figure")).toHaveLength(4));
    for (const title of CHART_TITLES) {
      // Title + hint may both mention the metric (e.g. "Net worth"); at least one card each.
      expect(screen.getAllByText(title).length).toBeGreaterThanOrEqual(1);
    }
    // Every chart is an accessible figure with a labeled SVG.
    const svgs = screen.getAllByRole("figure").map((figure) => figure.querySelector("svg"));
    for (const svg of svgs) expect(svg?.getAttribute("aria-label")).toBeTruthy();
  });

  it("run-out plan still renders charts without NaN anywhere", async () => {
    renderView(makeWorkspace(makeRunOutPlan()));
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(screen.getAllByRole("figure")).toHaveLength(4));
    expect(screen.getAllByText(/net worth/i).length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toContain("NaN");
  });
});

describe("individual charts render as SVG", () => {
  it("includes separately recorded cash interest in projected total income", () => {
    const year = {
      age: 70,
      income: { employment: 0, cpp: 0, oas: 0, gis: 0, other: 100 },
      cashInterest: 25,
      expenses: 0,
      shortfall: 0,
    } as YearResult;
    expect(incomeSpendSeries([year])[0]?.income).toBe(125);
  });

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

  it("drawdown bands occlude nothing: with two positive series the top band never reaches the baseline", () => {
    const draw = render(
      <DrawDownChart
        points={[
          { x: 70, tfsa: 100, rrsp: 50, nonreg: 0, cash: 25 },
          { x: 71, tfsa: 100, rrsp: 50, nonreg: 0, cash: 25 },
        ]}
      />,
    );
    const bandPaths = draw.container.querySelectorAll("path[data-series]");
    expect(bandPaths.length).toBeGreaterThanOrEqual(4);
    const baseline = yScale(0, [0, 175]).toFixed(1);
    for (const path of bandPaths) {
      const d = path.getAttribute("d") ?? "";
      const series = path.getAttribute("data-series") ?? "";
      if (series === "TFSA") expect(d).toContain(baseline); // bottom band owns the baseline
      else if (series === "RRSP" || series === "Cash accounts + reserve") {
        expect(d).not.toContain(`,${baseline}`); // upper bands stay on their lower boundary
      }
    }
  });

  it("IncomeSpendChart draws income and spending bands", () => {
    const { container } = render(
      <IncomeSpendChart points={[{ x: 45, income: 3, expenses: 2, shortfall: 0 }]} />,
    );
    expect(container.querySelectorAll("path, polyline").length).toBeGreaterThanOrEqual(2);
  });

  it("charts render with the sample plan after a full run (smoke via view)", async () => {
    renderView(makeWorkspace(makeSamplePlan()));
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(screen.getAllByRole("figure")).toHaveLength(4));
  });
});
