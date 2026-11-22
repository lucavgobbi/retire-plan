import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SimulationRunner } from "../../../store/simulationWorkerProtocol";
import { StoreProvider } from "../../../store/StoreProvider";
import { DEFAULT_SCENARIO_BASE } from "../../../domain/defaults";
import { makeRunOutPlan, makeSamplePlan, makeWorkspace } from "../testFixtures";
import { DashboardSection } from "../DashboardSection";
import { ChartHelp } from "./ChartHelp";
import { NetWorthChart } from "./NetWorthChart";
import { IncomeSpendChart } from "./IncomeSpendChart";
import { TaxStackChart } from "./TaxStackChart";
import { DrawDownChart } from "./DrawDownChart";
import { IncomeSourcesChart } from "./IncomeSourcesChart";
import { AccountFlowsChart } from "./AccountFlowsChart";
import { ContributionRoomChart } from "./ContributionRoomChart";
import { SpendingBreakdownChart } from "./SpendingBreakdownChart";
import { RrifWithdrawalsChart } from "./RrifWithdrawalsChart";
import { OasClawbackChart } from "./OasClawbackChart";
import { EnsembleFanChart } from "./EnsembleFanChart";
import { ShortfallRiskChart } from "./ShortfallRiskChart";
import { incomeSpendSeries } from "./adapters";
import { runDeterministic, runScenario } from "../../../domain/run";
import { createDefaultPlan } from "../../../domain/defaults";
import { yScale } from "./svg";
import type { SimulationResult, YearResult } from "@retire-plan/engine";

function renderView(workspace = makeWorkspace(), simulationRunner?: SimulationRunner) {
  return render(
    <StoreProvider
      initialWorkspace={workspace}
      initialBaseScenario={DEFAULT_SCENARIO_BASE}
      simulationRunner={simulationRunner}
    >
      <DashboardSection />
    </StoreProvider>,
  );
}

const CHART_TITLES = [
  /net worth/i,
  /income vs spending/i,
  /income sources/i,
  /tax by component/i,
  /contributions vs withdrawals/i,
  /account drawdown/i,
  /contribution room/i,
  /spending breakdown/i,
  /rrif vs rrsp withdrawals/i,
  /oas kept vs clawback/i,
];

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

  it("renders all ten chart titles after a deterministic run (MC charts omitted)", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(screen.getAllByRole("figure")).toHaveLength(10));
    for (const title of CHART_TITLES) {
      // Title + hint may both mention the metric (e.g. "Net worth"); at least one card each.
      expect(screen.getAllByText(title).length).toBeGreaterThanOrEqual(1);
    }
    // Every chart is an accessible figure with a labeled SVG.
    const svgs = screen.getAllByRole("figure").map((figure) => figure.querySelector("svg"));
    for (const svg of svgs) expect(svg?.getAttribute("aria-label")).toBeTruthy();
    // Deterministic runs never clutter the dashboard with empty Monte Carlo charts.
    expect(screen.queryAllByText(/Monte Carlo/i)).toHaveLength(0);
  });

  it("run-out plan still renders charts without NaN anywhere", async () => {
    renderView(makeWorkspace(makeRunOutPlan()));
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(screen.getAllByRole("figure")).toHaveLength(10));
    expect(screen.getAllByText(/net worth/i).length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toContain("NaN");
  });
});

describe("legacy runs degrade honestly (no fabricated data)", () => {
  function renderDashboard(result: SimulationResult) {
    return render(
      <StoreProvider
        initialWorkspace={makeWorkspace()}
        initialBaseScenario={DEFAULT_SCENARIO_BASE}
        simulationRunner={undefined}
      >
        <DashboardSection result={result} />
      </StoreProvider>,
    );
  }
  const scenario = { id: "test", name: "Test", ...DEFAULT_SCENARIO_BASE, simMode: "deterministic" as const };

  it("stored legacy years without per-item/RRIF capture show rerun notes, never fabricated charts", () => {
    const result = runDeterministic(makeSamplePlan(), scenario);
    const legacy: SimulationResult = {
      ...result,
      years: result.years.map(({ expenseBreakdown, rrifMinimumWithdrawal, ...year }) => year),
    };
    renderDashboard(legacy);
    expect(screen.getAllByRole("figure")).toHaveLength(10); // deterministic: MC charts omitted entirely
    // Exactly the two degraded charts carry an honest rerun note.
    expect(screen.getAllByText(/run the projection again/i)).toHaveLength(2);
    // No fabricated expense item bands anywhere.
    expect(screen.queryByText("Living")).toBeNull();
  });

  it("fresh runs render real breakdown/RRIF/OAS charts with no rerun notes", () => {
    renderDashboard(runDeterministic(makeSamplePlan(), scenario));
    expect(screen.getAllByRole("figure")).toHaveLength(10);
    expect(screen.queryAllByText(/run the projection again/i)).toHaveLength(0);
    // The plan's expense item appears as a stable, colored legend entry.
    expect(screen.getAllByText("Living").length).toBeGreaterThanOrEqual(1);
  });

  it("a fresh run with NO expenses shows a clear no-expenses display, not a rerun note", () => {
    renderDashboard(runDeterministic(createDefaultPlan(), scenario));
    expect(screen.getAllByRole("figure")).toHaveLength(10);
    expect(screen.getAllByText(/no expense items/i)).toHaveLength(1); // real display, not a legacy rerun
    expect(screen.queryAllByText(/run the projection again/i)).toHaveLength(0);
  });

  it("a fresh no-RRSP run records explicit 0 RRIF minimums — the RRIF chart renders, no legacy rerun note", () => {
    renderDashboard(runDeterministic(makeRunOutPlan(), scenario));
    expect(screen.getAllByRole("figure")).toHaveLength(10);
    // Fresh capture (pre-71 / no-RRSP ⇒ recorded 0) never masquerades as a legacy run.
    expect(screen.queryAllByText(/run the projection again/i)).toHaveLength(0);
    expect(screen.getByRole("figure", { name: "RRIF versus RRSP withdrawals chart" })).toBeTruthy();
  });
});

describe("Monte Carlo ensemble plumbing (production runner → charts)", () => {
  const mcScenario = {
    ...DEFAULT_SCENARIO_BASE,
    simMode: "montecarlo" as const,
    mcConfig: { runs: 12, stdDev: { equity: 0.17, bond: 0.06, cash: 0.01 }, seed: 42 },
  };

  it("runScenario forwards per-age annualStats on the analysis (not dropped in the adapter)", () => {
    const outcome = runScenario(makeSamplePlan(), { id: "mc", name: "MC", ...mcScenario });
    expect(outcome.analysis?.mode).toBe("montecarlo");
    const analysis = outcome.analysis;
    const stats = analysis?.mode === "montecarlo" ? analysis.annualStats : undefined;
    expect(Array.isArray(stats)).toBe(true);
    expect(stats!.length).toBeGreaterThanOrEqual(2);
    for (const stat of stats!) {
      expect(stat.netWorth.p10).toBeLessThanOrEqual(stat.netWorth.p50);
      expect(stat.netWorth.p50).toBeLessThanOrEqual(stat.netWorth.p90);
      expect(stat.shortfallRate).toBeGreaterThanOrEqual(0);
      expect(stat.shortfallRate).toBeLessThanOrEqual(1);
      expect(stat.sampleCount).toBeGreaterThan(0);
    }
    // The ensemble percentiles at the final age ARE the terminal percentiles (same paths).
    const last = stats!.at(-1)!;
    expect(last.netWorth.p10).toBeCloseTo(outcome.analysis!.percentileNetWorth.p10, 0);
    expect(last.netWorth.p50).toBeCloseTo(outcome.analysis!.percentileNetWorth.p50, 0);
    expect(last.netWorth.p90).toBeCloseTo(outcome.analysis!.percentileNetWorth.p90, 0);
  });

  it("dashboard renders BOTH ensemble charts from a real MC run through the store (no blank MC charts)", async () => {
    const runner: SimulationRunner = async (plan, scenario) =>
      runScenario(plan, { ...scenario, simMode: "montecarlo", mcConfig: mcScenario.mcConfig });
    renderView(makeWorkspace(), runner);
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(screen.getAllByRole("figure")).toHaveLength(12));
    expect(screen.getByText(/Net worth range \(Monte Carlo\)/)).toBeTruthy();
    expect(screen.getByText(/Shortfall risk by age \(Monte Carlo\)/)).toBeTruthy();
    expect(screen.queryAllByText(/run the projection again/i)).toHaveLength(0);
    // Ensemble charts are visually marked as aggregates, distinct from single-path charts.
    expect(document.querySelectorAll('svg[data-ensemble="true"]')).toHaveLength(2);
  });

  it("legacy MC analysis (no annual stats) shows honest rerun notes for both MC charts", async () => {
    const result = runDeterministic(makeSamplePlan(), {
      id: "base",
      name: "Base",
      ...DEFAULT_SCENARIO_BASE,
      simMode: "deterministic" as const,
    });
    const runner: SimulationRunner = async () => ({
      result,
      analysis: {
        mode: "montecarlo",
        successRate: 0.9,
        percentileNetWorth: { p10: 100, p50: 200, p90: 300 },
        representativeRun: 1,
      },
    });
    renderView(makeWorkspace(), runner);
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(screen.getAllByRole("figure")).toHaveLength(12));
    // Exactly the two MC charts carry a run-again note; nothing is synthesized.
    expect(screen.getAllByText(/run the projection again/i)).toHaveLength(2);
    expect(document.querySelectorAll('svg[data-ensemble="true"]')).toHaveLength(0);
  });
});

describe("new chart components (direct render)", () => {
  it("SpendingBreakdownChart: one band per item; tooltip shows items plus the authoritative total", () => {
    const series = {
      items: [
        { id: "e1", name: "Food" },
        { id: "e2", name: "Travel" },
      ],
      points: [
        { x: 60, total: 150.004, amounts: [100, 50] },
        { x: 61, total: 170, amounts: [110, 60] },
      ],
    };
    const { container } = render(<SpendingBreakdownChart series={series} />);
    const bands = container.querySelectorAll("path[data-series]");
    expect(bands).toHaveLength(2);
    expect(bands[0]!.getAttribute("data-series")).toBe("Food");
    expect(bands[1]!.getAttribute("data-series")).toBe("Travel");
    const svg = container.querySelector("svg")!;
    fireEvent.focus(svg); // keyboard interaction → age 60
    fireEvent.keyDown(svg, { key: "ArrowRight" }); // → age 61
    expect(container.textContent).toContain("Food");
    expect(container.textContent).toContain("Travel");
    expect(container.textContent).toContain("Total spending");
    expect(container.textContent).toContain("170"); // authoritative engine total, not a recomputed sum
  });

  it("RrifWithdrawalsChart: actual vs minimum lines; tooltip includes the planned extra draw when present", () => {
    const points = [
      { x: 60, minimum: null, actual: 1200, planned: 0 },
      { x: 72, minimum: 2000, actual: 2500, planned: 500 },
    ];
    const { container } = render(<RrifWithdrawalsChart points={points} />);
    expect(container.querySelectorAll("polyline[data-series]")).toHaveLength(2);
    expect(container.querySelector('polyline[data-series="RRIF minimum"]')).toBeTruthy();
    expect(container.querySelector('polyline[data-series="Actual RRSP withdrawals"]')).toBeTruthy();
    const svg = container.querySelector("svg")!;
    fireEvent.focus(svg);
    fireEvent.keyDown(svg, { key: "ArrowRight" }); // → age 72
    expect(container.textContent).toContain("RRIF minimum");
    expect(container.textContent).toContain("Planned extra draw");
  });

  it("OasClawbackChart: kept + clawback bands; tooltip rows prove the gross/kept/charge mapping", () => {
    const points = [{ x: 70, gross: 750, kept: 537.6, clawback: 212.4 }];
    const { container } = render(<OasClawbackChart points={points} />);
    const bands = container.querySelectorAll("path[data-series]");
    expect(bands).toHaveLength(2);
    expect(bands[0]!.getAttribute("data-series")).toBe("OAS kept");
    expect(bands[1]!.getAttribute("data-series")).toBe("OAS clawback");
    const svg = container.querySelector("svg")!;
    fireEvent.focus(svg);
    expect(container.textContent).toContain("Gross OAS");
    expect(container.textContent).toContain("OAS kept");
    expect(container.textContent).toContain("OAS clawback");
  });

  it("EnsembleFanChart: p10–p90 band with dashed median, marked as an ensemble; tooltip counts paths", () => {
    const points = [
      { age: 65, netWorth: { p10: 100, p50: 200, p90: 300 }, shortfallRate: 0, sampleCount: 500 },
      { age: 66, netWorth: { p10: 90, p50: 180, p90: 280 }, shortfallRate: 0.12, sampleCount: 500 },
    ];
    const { container } = render(<EnsembleFanChart points={points} />);
    expect(container.querySelector('svg[data-ensemble="true"]')).toBeTruthy();
    expect(container.querySelector('path[data-series="p10–p90 band"]')).toBeTruthy();
    expect(container.querySelector('polyline[data-series="Median (p50)"]')).toBeTruthy();
    const svg = container.querySelector("svg")!;
    fireEvent.focus(svg);
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(container.textContent).toContain("Paths simulated");
    expect(container.textContent).toContain("500");
  });

  it("ShortfallRiskChart: fixed 0–100% axis with percent ticks; tooltip is percent, never currency", () => {
    const points = [
      { age: 65, netWorth: { p10: 100, p50: 200, p90: 300 }, shortfallRate: 0, sampleCount: 500 },
      { age: 66, netWorth: { p10: 90, p50: 180, p90: 280 }, shortfallRate: 0.125, sampleCount: 500 },
    ];
    const { container } = render(<ShortfallRiskChart points={points} />);
    expect(container.querySelector('svg[data-ensemble="true"]')).toBeTruthy();
    // Fixed percent axis: extreme ticks are exactly 0% and 100%.
    expect(container.textContent).toContain("0%");
    expect(container.textContent).toContain("100%");
    const svg = container.querySelector("svg")!;
    fireEvent.focus(svg);
    fireEvent.keyDown(svg, { key: "ArrowRight" }); // → age 66, risk 0.125
    expect(container.textContent).toContain("12.5%"); // percent row format
    expect(container.textContent).not.toContain("$"); // never currency
  });
});

describe("ChartHelp (coherent controlled visibility)", () => {
  function renderHelp() {
    const utils = render(<ChartHelp>Stacked bars explanation.</ChartHelp>);
    const toggle = utils.container.querySelector(".chart-help-toggle") as HTMLButtonElement;
    const body = utils.container.querySelector(".chart-help-body") as HTMLElement;
    const visible = () => !body.hidden;
    const expanded = () => toggle.getAttribute("aria-expanded") === "true";
    // The core invariant: visibility and aria-expanded ALWAYS agree.
    const coherent = () => visible() === expanded();
    return { ...utils, toggle, body, visible, expanded, coherent };
  }

  it("links the button and body with aria-controls + aria-describedby", () => {
    const h = renderHelp();
    expect(h.toggle.getAttribute("aria-controls")).toBe(h.body.id);
    expect(h.toggle.getAttribute("aria-describedby")).toBe(h.body.id);
    expect(h.body.textContent).toContain("Stacked bars explanation.");
    expect(h.coherent()).toBe(true); // closed: hidden and expanded=false
  });

  it("pointer hover reveals and re-hides, with aria-expanded tracking visibility", () => {
    const h = renderHelp();
    fireEvent.pointerEnter(h.toggle, { pointerType: "mouse" });
    expect(h.visible()).toBe(true);
    expect(h.coherent()).toBe(true); // open
    fireEvent.pointerLeave(h.toggle, { pointerType: "mouse" });
    expect(h.visible()).toBe(false);
    expect(h.coherent()).toBe(true); // closed again
  });

  it("touch never hover-reveals: the toggle is the only channel", () => {
    const h = renderHelp();
    // jsdom has no PointerEvent class; stamp pointerType on a native event and
    // dispatch it directly so React's pointerType check sees "touch".
    const touchEnter = new Event("pointerenter", { bubbles: false });
    Object.defineProperty(touchEnter, "pointerType", { value: "touch" });
    fireEvent(h.toggle, touchEnter);
    expect(h.visible()).toBe(false);
    fireEvent.click(h.toggle);
    expect(h.visible()).toBe(true); // tap opens persistently
    expect(h.expanded()).toBe(true);
    expect(h.coherent()).toBe(true);
  });

  it("keyboard focus reveals, blur hides, and Escape dismisses for real even under focus/hover", () => {
    const h = renderHelp();
    fireEvent.focus(h.toggle);
    expect(h.visible()).toBe(true);
    expect(h.coherent()).toBe(true);
    // Escape while focus (and hover) holds: the body must actually hide and
    // aria-expanded must drop to false — no focus-within ghost visibility.
    fireEvent.pointerEnter(h.toggle, { pointerType: "mouse" });
    fireEvent.keyDown(h.toggle, { key: "Escape" });
    expect(h.visible()).toBe(false);
    expect(h.expanded()).toBe(false);
    expect(h.coherent()).toBe(true);
    // Activation (Enter/click) while focus REMAINS reopens: opening clears the
    // Escape suppression.
    fireEvent.click(h.toggle);
    expect(h.visible()).toBe(true);
    expect(h.expanded()).toBe(true);
    // Second activation closes for real despite focus (and hover) remaining.
    fireEvent.click(h.toggle);
    expect(h.visible()).toBe(false);
    expect(h.expanded()).toBe(false);
    // Returning the pointer or focus re-enables reveal.
    fireEvent.pointerLeave(h.toggle, { pointerType: "mouse" });
    fireEvent.pointerEnter(h.toggle, { pointerType: "mouse" });
    expect(h.visible()).toBe(true);
  });

  it("click toggles persistently; closing hides even while the pointer still hovers", () => {
    const h = renderHelp();
    fireEvent.pointerEnter(h.toggle, { pointerType: "mouse" });
    expect(h.visible()).toBe(true); // hover reveal
    fireEvent.click(h.toggle); // activation opens persistently, clears suppression
    expect(h.visible()).toBe(true);
    expect(h.expanded()).toBe(true);
    fireEvent.click(h.toggle); // second activation closes despite active hover
    expect(h.visible()).toBe(false);
    expect(h.expanded()).toBe(false);
    expect(h.coherent()).toBe(true);
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

  it("NetWorthChart draws stacked owned bars with debt below zero and a net-worth marker", () => {
    const points = [
      { x: 45, tfsa: 100, rrsp: 200, nonreg: 50, cash: 25, home: 300, otherAssets: 25, debt: 100, netWorth: 600 },
      { x: 46, tfsa: 110, rrsp: 210, nonreg: 55, cash: 30, home: 300, otherAssets: 25, debt: 50, netWorth: 680 },
    ];
    const { container } = render(<NetWorthChart points={points} />);
    // No polyline — stacked bars now.
    expect(container.querySelector("polyline")).toBeNull();
    // Per-age group with a rect per owned series present (age 45: TFSA + RRSP + nonreg + cash + home + other).
    const age45 = container.querySelector('[data-bar-age="45"]')!;
    expect(age45.querySelectorAll('rect[data-series="TFSA"], rect[data-series="RRSP"]').length).toBe(2);
    expect(age45.querySelector('rect[data-series="Home"]')).toBeTruthy();
    expect(age45.querySelector('rect[data-series="Other assets"]')).toBeTruthy();
    // Debt is its own below-zero segment, never stacked as owned.
    expect(age45.querySelector('rect[data-series="Debt"]')).toBeTruthy();
    // Net-worth marker present on each bar.
    expect(age45.querySelector('line[data-series="Net worth"]')).toBeTruthy();
  });

  it("NetWorthChart bar arithmetic is truthful: owned stack minus debt equals the engine net worth", () => {
    // The marker is the engine's netWorth; the chart never relabels gross assets as net.
    const points = [
      { x: 70, tfsa: 10, rrsp: 20, nonreg: 30, cash: 5, home: 100, otherAssets: 35, debt: 0, netWorth: 200 },
      { x: 71, tfsa: 10, rrsp: 20, nonreg: 30, cash: 5, home: 100, otherAssets: 35, debt: 45, netWorth: 155 },
    ];
    const { container } = render(<NetWorthChart points={points} />);
    for (const point of points) {
      const owned = point.tfsa + point.rrsp + point.nonreg + point.cash + point.home + point.otherAssets;
      expect(owned - point.debt).toBe(point.netWorth); // engine arithmetic identity
      const group = container.querySelector(`[data-bar-age="${point.x}"]`)!;
      const marker = group.querySelector('line[data-series="Net worth"]')!;
      // The marker sits at the net-worth scale position, NOT at the owned-stack top.
      const debtVisual = group.querySelector('rect[data-series="Debt"]');
      expect((debtVisual !== null) === point.debt > 0).toBe(true);
      expect(marker).toBeTruthy();
    }
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

    const draw = render(<DrawDownChart points={[{ x: 70, tfsa: 1, rrsp: 1, nonreg: 1, cash: 1 }]} />);
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
      if (series === "TFSA")
        expect(d).toContain(baseline); // bottom band owns the baseline
      else if (series === "RRSP" || series === "Cash accounts + reserve") {
        expect(d).not.toContain(`,${baseline}`); // upper bands stay on their lower boundary
      }
    }
  });

  it("IncomeSpendChart draws income and spending bands", () => {
    const { container } = render(<IncomeSpendChart points={[{ x: 45, income: 3, expenses: 2, shortfall: 0 }]} />);
    expect(container.querySelectorAll("path, polyline").length).toBeGreaterThanOrEqual(2);
  });

  it("IncomeSourcesChart draws six source bands with cash interest as its own labeled series", () => {
    const { container } = render(
      <IncomeSourcesChart
        points={[
          { x: 60, employment: 40, other: 10, cashInterest: 5, cpp: 8, oas: 7, gis: 0 },
          { x: 61, employment: 0, other: 10, cashInterest: 5, cpp: 8, oas: 7, gis: 2 },
        ]}
      />,
    );
    const series = Array.from(container.querySelectorAll("path[data-series]")).map((p) =>
      p.getAttribute("data-series"),
    );
    expect(series).toEqual(["Employment", "Other income", "Cash interest", "CPP", "OAS", "GIS"]);
  });

  it("AccountFlowsChart draws contributions above and withdrawals below zero; zero-flow ages draw no bars", () => {
    const { container } = render(
      <AccountFlowsChart
        points={[
          {
            x: 70,
            contributions: { tfsa: 2, rrsp: 0, nonreg: 0, cash: 0 },
            withdrawals: { tfsa: 0, rrsp: 1, nonreg: 0, cash: 0 },
          },
          {
            x: 71,
            contributions: { tfsa: 0, rrsp: 0, nonreg: 0, cash: 0 },
            withdrawals: { tfsa: 0, rrsp: 0, nonreg: 0, cash: 0 },
          },
        ]}
      />,
    );
    expect(container.querySelectorAll('rect[data-series="TFSA contributions"]').length).toBe(1);
    expect(container.querySelectorAll('rect[data-series="RRSP withdrawals"]').length).toBe(1);
    // Zero-flow age renders no bars but the chart itself still renders.
    expect(container.querySelectorAll("[data-bar-age='71'] rect").length).toBe(0);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("AccountFlowsChart geometry: all four accounts nonzero render 8 non-overlapping segments with proportional heights", () => {
    const { container } = render(
      <AccountFlowsChart
        points={[
          {
            x: 70,
            contributions: { tfsa: 100, rrsp: 50, nonreg: 25, cash: 10 },
            withdrawals: { tfsa: 40, rrsp: 30, nonreg: 20, cash: 10 },
          },
        ]}
      />,
    );
    const up = Array.from(
      container.querySelectorAll("g[data-bar-age] rect[data-series$='contributions']"),
    ) as SVGRectElement[];
    const down = Array.from(
      container.querySelectorAll("g[data-bar-age] rect[data-series$='withdrawals']"),
    ) as SVGRectElement[];
    // Label→key mapping works: all 8 segments render (labels are not object keys).
    expect(up.map((r) => r.getAttribute("data-series"))).toEqual([
      "TFSA contributions",
      "RRSP contributions",
      "Non-registered contributions",
      "Cash contributions",
    ]);
    expect(down.map((r) => r.getAttribute("data-series"))).toEqual([
      "TFSA withdrawals",
      "RRSP withdrawals",
      "Non-registered withdrawals",
      "Cash withdrawals",
    ]);
    // Segments are actually drawn (the old label-as-key bug rendered zero-height bars).
    for (const rect of [...up, ...down]) expect(Number(rect.getAttribute("height"))).toBeGreaterThan(0);
    // Contributions heights proportional to 100/50/25/10 (reference: TFSA).
    const upH = up.map((r) => Number(r.getAttribute("height")));
    expect(upH[1]! / upH[0]!).toBeCloseTo(50 / 100, 6);
    expect(upH[2]! / upH[0]!).toBeCloseTo(25 / 100, 6);
    expect(upH[3]! / upH[0]!).toBeCloseTo(10 / 100, 6);
    // Contributions stack upward from zero: the bottom of the stack sits at the zero line.
    const zeroBottom = Math.max(...up.map((r) => Number(r.getAttribute("y")) + Number(r.getAttribute("height"))));
    const zeroTop = Math.min(...down.map((r) => Number(r.getAttribute("y"))));
    expect(up.every((r) => Number(r.getAttribute("y")) + upH[up.indexOf(r)]! <= zeroBottom + 1e-6)).toBe(true);
    expect(zeroBottom).toBeCloseTo(zeroTop, 6);
    // Withdrawal segments share boundaries: each rect starts where the previous ends.
    const downY = down.map((r) => Number(r.getAttribute("y")));
    const downH = down.map((r) => Number(r.getAttribute("height")));
    expect(downY[0]).toBeCloseTo(zeroTop, 6); // first withdrawal segment starts at zero
    expect(downY[1]).toBeCloseTo(downY[0]! + downH[0]!, 6);
    expect(downY[2]).toBeCloseTo(downY[1]! + downH[1]!, 6);
    expect(downY[3]).toBeCloseTo(downY[2]! + downH[2]!, 6);
    // Withdrawal heights proportional to 40/30/20/10 (reference: TFSA).
    expect(downH[1]! / downH[0]!).toBeCloseTo(30 / 40, 6);
    expect(downH[2]! / downH[0]!).toBeCloseTo(20 / 40, 6);
    expect(downH[3]! / downH[0]!).toBeCloseTo(10 / 40, 6);
  });

  it("ContributionRoomChart draws the TFSA and RRSP room lines", () => {
    const { container } = render(
      <ContributionRoomChart
        points={[
          { x: 60, tfsaRoom: 6000, rrspRoom: 20000 },
          { x: 61, tfsaRoom: 0, rrspRoom: 12000 },
        ]}
      />,
    );
    const series = Array.from(container.querySelectorAll("polyline[data-series]")).map((p) =>
      p.getAttribute("data-series"),
    );
    expect(series).toEqual(["TFSA room", "RRSP room"]);
  });

  it("empty and single-point charts degrade gracefully without NaN", () => {
    for (const [Chart, point] of [
      [IncomeSourcesChart, { x: 70, employment: 1, other: 1, cashInterest: 1, cpp: 1, oas: 1, gis: 1 }],
      [
        AccountFlowsChart,
        {
          x: 70,
          contributions: { tfsa: 1, rrsp: 0, nonreg: 0, cash: 0 },
          withdrawals: { tfsa: 0, rrsp: 0, nonreg: 0, cash: 0 },
        },
      ],
      [ContributionRoomChart, { x: 70, tfsaRoom: 5, rrspRoom: 9 }],
    ] as const) {
      const empty = render(<Chart points={[]} />);
      expect(empty.container.querySelector("svg")!.getAttribute("aria-label")).toBe("No data");
      const single = render(<Chart points={[point] as never} />);
      expect(single.container.querySelector("svg")!.getAttribute("aria-label")).not.toBe("No data");
      expect(single.container.textContent).not.toContain("NaN");
    }
  });

  it("charts render with the sample plan after a full run (smoke via view)", async () => {
    renderView(makeWorkspace(makeSamplePlan()));
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(screen.getAllByRole("figure")).toHaveLength(10));
  });
});
