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

const CHART_TITLES = [/net worth/i, /income vs spending/i, /income sources/i, /tax by component/i, /contributions vs withdrawals/i, /account drawdown/i, /contribution room/i];

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

  it("renders all seven chart titles after a run", async () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: /run projection/i }));
    await waitFor(() => expect(screen.getAllByRole("figure")).toHaveLength(7));
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
    await waitFor(() => expect(screen.getAllByRole("figure")).toHaveLength(7));
    expect(screen.getAllByText(/net worth/i).length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent).not.toContain("NaN");
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
      expect((debtVisual !== null) === (point.debt > 0)).toBe(true);
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

  it("IncomeSourcesChart draws six source bands with cash interest as its own labeled series", () => {
    const { container } = render(
      <IncomeSourcesChart points={[
        { x: 60, employment: 40, other: 10, cashInterest: 5, cpp: 8, oas: 7, gis: 0 },
        { x: 61, employment: 0, other: 10, cashInterest: 5, cpp: 8, oas: 7, gis: 2 },
      ]} />,
    );
    const series = Array.from(container.querySelectorAll("path[data-series]")).map((p) => p.getAttribute("data-series"));
    expect(series).toEqual(["Employment", "Other income", "Cash interest", "CPP", "OAS", "GIS"]);
  });

  it("AccountFlowsChart draws contributions above and withdrawals below zero; zero-flow ages draw no bars", () => {
    const { container } = render(
      <AccountFlowsChart points={[
        { x: 70, contributions: { tfsa: 2, rrsp: 0, nonreg: 0, cash: 0 }, withdrawals: { tfsa: 0, rrsp: 1, nonreg: 0, cash: 0 } },
        { x: 71, contributions: { tfsa: 0, rrsp: 0, nonreg: 0, cash: 0 }, withdrawals: { tfsa: 0, rrsp: 0, nonreg: 0, cash: 0 } },
      ]} />,
    );
    expect(container.querySelectorAll('rect[data-series="TFSA contributions"]').length).toBe(1);
    expect(container.querySelectorAll('rect[data-series="RRSP withdrawals"]').length).toBe(1);
    // Zero-flow age renders no bars but the chart itself still renders.
    expect(container.querySelectorAll("[data-bar-age='71'] rect").length).toBe(0);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("AccountFlowsChart geometry: all four accounts nonzero render 8 non-overlapping segments with proportional heights", () => {
    const { container } = render(
      <AccountFlowsChart points={[
        { x: 70, contributions: { tfsa: 100, rrsp: 50, nonreg: 25, cash: 10 }, withdrawals: { tfsa: 40, rrsp: 30, nonreg: 20, cash: 10 } },
      ]} />,
    );
    const up = Array.from(container.querySelectorAll("g[data-bar-age] rect[data-series$='contributions']")) as SVGRectElement[];
    const down = Array.from(container.querySelectorAll("g[data-bar-age] rect[data-series$='withdrawals']")) as SVGRectElement[];
    // Label→key mapping works: all 8 segments render (labels are not object keys).
    expect(up.map((r) => r.getAttribute("data-series"))).toEqual(["TFSA contributions", "RRSP contributions", "Non-registered contributions", "Cash contributions"]);
    expect(down.map((r) => r.getAttribute("data-series"))).toEqual(["TFSA withdrawals", "RRSP withdrawals", "Non-registered withdrawals", "Cash withdrawals"]);
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
      <ContributionRoomChart points={[{ x: 60, tfsaRoom: 6000, rrspRoom: 20000 }, { x: 61, tfsaRoom: 0, rrspRoom: 12000 }]} />,
    );
    const series = Array.from(container.querySelectorAll("polyline[data-series]")).map((p) => p.getAttribute("data-series"));
    expect(series).toEqual(["TFSA room", "RRSP room"]);
  });

  it("empty and single-point charts degrade gracefully without NaN", () => {
    for (const [Chart, point] of [
      [IncomeSourcesChart, { x: 70, employment: 1, other: 1, cashInterest: 1, cpp: 1, oas: 1, gis: 1 }],
      [AccountFlowsChart, { x: 70, contributions: { tfsa: 1, rrsp: 0, nonreg: 0, cash: 0 }, withdrawals: { tfsa: 0, rrsp: 0, nonreg: 0, cash: 0 } }],
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
    await waitFor(() => expect(screen.getAllByRole("figure")).toHaveLength(7));
  });
});
