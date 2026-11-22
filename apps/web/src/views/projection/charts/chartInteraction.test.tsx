import { fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChartCard } from "./ChartCard";
import { IncomeSpendChart } from "./IncomeSpendChart";
import { NetWorthChart } from "./NetWorthChart";
import { TaxStackChart } from "./TaxStackChart";
import { W, xScale } from "./svg";

type IncomePoint = { x: number; income: number; expenses: number; shortfall: number };
type SvgRect = { left: number; top: number; width: number; height: number };

const rect: SvgRect = { left: 37, top: 19, width: 1120, height: 480 };

function chartWith(child: ReactNode) {
  return (
    <ChartCard title="Test chart" ariaLabel="Test chart" help="Test help">
      {child}
    </ChartCard>
  );
}

function setSvgRect(svg: SVGSVGElement, box = rect) {
  vi.spyOn(svg, "getBoundingClientRect").mockReturnValue({
    ...box,
    right: box.left + box.width,
    bottom: box.top + box.height,
    x: box.left,
    y: box.top,
    toJSON: () => ({}),
  } as DOMRect);
}

function pointer(
  svg: SVGSVGElement,
  type: "pointermove" | "pointerdown" | "pointerup" | "pointerout",
  pointerType: string,
  clientX: number,
) {
  // jsdom currently lacks PointerEvent. A bubbling Event with the relevant
  // PointerEvent fields exercises React's real pointer handlers without a
  // global polyfill that could mask unsupported event behavior.
  const event = new Event(type, { bubbles: true });
  Object.defineProperties(event, {
    pointerType: { value: pointerType },
    clientX: { value: clientX },
  });
  fireEvent(svg, event);
}

function clientXForAge(age: number, domain: [number, number], box = rect) {
  return box.left + (xScale(age, domain) / W) * box.width;
}

function tooltipText(container: HTMLElement) {
  return container.querySelector(".chart-interaction-tooltip")?.textContent ?? "";
}

describe("chart interactions through rendered charts", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows exact formatted line and spending-area values for the nearest age", () => {
    const points: IncomePoint[] = [
      { x: 40, income: 81_000, expenses: 72_000, shortfall: 0 },
      { x: 50, income: 123_456, expenses: 98_765, shortfall: 0 },
      { x: 60, income: 105_000, expenses: 112_000, shortfall: 7_000 },
    ];
    const view = render(chartWith(<IncomeSpendChart points={points} />));
    const svg = view.container.querySelector("svg.chart-interactive") as SVGSVGElement;
    setSvgRect(svg);
    pointer(svg, "pointermove", "mouse", clientXForAge(50, [40, 60]));

    expect(tooltipText(view.container)).toContain("Age 50");
    expect(tooltipText(view.container)).toContain("Income$123,456");
    expect(tooltipText(view.container)).toContain("Spending$98,765");
    expect(tooltipText(view.container)).toContain("Shortfall$0");
    expect(svg.querySelector("polyline")?.getAttribute("points")).toContain(",");
    expect(svg.querySelector("path")?.getAttribute("d")).toContain("Z");
  });

  it("shows each stacked-area tax value and total at the selected age", () => {
    const view = render(
      chartWith(
        <TaxStackChart
          points={[
            { x: 65, federal: 10_000, provincial: 5_000, surtax: 1_000, oasClawback: 0, total: 16_000 },
            { x: 66, federal: 12_345, provincial: 6_789, surtax: 1_234, oasClawback: 2_000, total: 22_368 },
          ]}
        />,
      ),
    );
    const svg = view.container.querySelector("svg.chart-interactive") as SVGSVGElement;
    setSvgRect(svg);
    pointer(svg, "pointermove", "mouse", clientXForAge(66, [65, 66]));

    const text = tooltipText(view.container);
    expect(text).toContain("Age 66");
    expect(text).toContain("Federal$12,345");
    expect(text).toContain("Provincial$6,789");
    expect(text).toContain("Surtax$1,234");
    expect(text).toContain("OAS clawback$2,000");
    expect(text).toContain("Total tax$22,368");
    expect(svg.querySelectorAll("path[data-series]")).toHaveLength(4);
  });

  it("shows account-by-account bar values, debt sign, and net worth", () => {
    const view = render(
      chartWith(
        <NetWorthChart
          points={[
            {
              x: 70,
              tfsa: 120_000,
              rrsp: 340_000,
              nonreg: 45_000,
              cash: 15_000,
              home: 700_000,
              otherAssets: 8_000,
              debt: 180_000,
              netWorth: 1_048_000,
            },
            {
              x: 71,
              tfsa: 125_000,
              rrsp: 350_000,
              nonreg: 50_000,
              cash: 18_000,
              home: 710_000,
              otherAssets: 9_000,
              debt: 175_000,
              netWorth: 1_087_000,
            },
          ]}
        />,
      ),
    );
    const svg = view.container.querySelector("svg.chart-interactive") as SVGSVGElement;
    setSvgRect(svg);
    pointer(svg, "pointermove", "mouse", clientXForAge(71, [70, 71]));

    const text = tooltipText(view.container);
    expect(text).toContain("Age 71");
    expect(text).toContain("TFSA$125,000");
    expect(text).toContain("RRSP$350,000");
    expect(text).toContain("Cash$18,000");
    expect(text).toContain("Debt (owed)-$175,000");
    expect(text).toContain("Net worth$1,087,000");
    expect(svg.querySelector('[data-bar-age="71"]')).toBeTruthy();
  });

  it("supports focus, arrows, Home, End, and Escape without dropping SVG focus", () => {
    const points: IncomePoint[] = [
      { x: 45, income: 10_000, expenses: 8_000, shortfall: 0 },
      { x: 55, income: 20_000, expenses: 15_000, shortfall: 0 },
      { x: 65, income: 30_000, expenses: 28_000, shortfall: 0 },
    ];
    const view = render(chartWith(<IncomeSpendChart points={points} />));
    const svg = view.container.querySelector("svg.chart-interactive") as SVGSVGElement;

    fireEvent.focus(svg);
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("Age 45");
    fireEvent.keyDown(svg, { key: "ArrowRight" });
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("Age 55");
    fireEvent.keyDown(svg, { key: "End" });
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("Age 65");
    fireEvent.keyDown(svg, { key: "ArrowLeft" });
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("Age 55");
    fireEvent.keyDown(svg, { key: "Home" });
    expect(view.container.querySelector('[role="status"]')?.textContent).toContain("Age 45");
    fireEvent.keyDown(svg, { key: "Escape" });
    expect(view.container.querySelector(".chart-interaction-tooltip")).toBeNull();
  });

  it("keeps a tap tooltip after touch pointerleave, then dismisses it for mouse leave", () => {
    const view = render(
      chartWith(
        <IncomeSpendChart
          points={[
            { x: 45, income: 10_000, expenses: 8_000, shortfall: 0 },
            { x: 55, income: 20_000, expenses: 15_000, shortfall: 0 },
          ]}
        />,
      ),
    );
    const svg = view.container.querySelector("svg.chart-interactive") as SVGSVGElement;
    setSvgRect(svg);
    const targetX = clientXForAge(55, [45, 55]);
    pointer(svg, "pointerdown", "touch", targetX);
    pointer(svg, "pointerup", "touch", targetX);
    pointer(svg, "pointerout", "touch", targetX);
    expect(tooltipText(view.container)).toContain("Age 55");

    pointer(svg, "pointerout", "mouse", targetX);
    expect(view.container.querySelector(".chart-interaction-tooltip")).toBeNull();
  });

  it("clears active ages across long, short, empty, and changed datasets", () => {
    const long: IncomePoint[] = [
      { x: 45, income: 10_000, expenses: 8_000, shortfall: 0 },
      { x: 55, income: 20_000, expenses: 15_000, shortfall: 0 },
      { x: 65, income: 30_000, expenses: 28_000, shortfall: 0 },
    ];
    const short = long.slice(0, 2);
    const view = render(chartWith(<IncomeSpendChart points={long} />));
    let svg = view.container.querySelector("svg.chart-interactive") as SVGSVGElement;
    setSvgRect(svg);
    svg.focus();
    fireEvent.keyDown(svg, { key: "End" });
    expect(tooltipText(view.container)).toContain("Age 65");

    view.rerender(chartWith(<IncomeSpendChart points={short} />));
    expect(view.container.querySelector(".chart-interaction-tooltip")).toBeNull();
    expect(view.container.textContent).not.toContain("Age 65");

    view.rerender(chartWith(<IncomeSpendChart points={[]} />));
    expect(view.container.querySelector("svg[aria-label='No data']")).toBeTruthy();
    expect(view.container.querySelector(".chart-interaction-tooltip")).toBeNull();

    const changed: IncomePoint[] = [
      { x: 70, income: 70_000, expenses: 60_000, shortfall: 0 },
      { x: 80, income: 80_000, expenses: 70_000, shortfall: 0 },
    ];
    view.rerender(chartWith(<IncomeSpendChart points={changed} />));
    expect(view.container.querySelector(".chart-interaction-tooltip")).toBeNull();
    svg = view.container.querySelector("svg.chart-interactive") as SVGSVGElement;
    setSvgRect(svg);
    fireEvent.focus(svg);
    expect(tooltipText(view.container)).toContain("Age 70");
    expect(tooltipText(view.container)).not.toContain("Age 45");
  });

  it("reclamps a wide tooltip after the plot container resizes", () => {
    let notifyResize: (() => void) | undefined;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: ResizeObserverCallback) {
          notifyResize = () => callback([], this as unknown as ResizeObserver);
        }
        observe() {}
        disconnect() {}
      },
    );
    const view = render(
      chartWith(
        <IncomeSpendChart
          points={[
            { x: 45, income: 10_000, expenses: 8_000, shortfall: 0 },
            { x: 55, income: 20_000, expenses: 15_000, shortfall: 0 },
          ]}
        />,
      ),
    );
    const plot = view.container.querySelector(".chart-plot") as HTMLElement;
    Object.defineProperty(plot, "clientWidth", { configurable: true, value: 220 });
    const svg = view.container.querySelector("svg.chart-interactive") as SVGSVGElement;
    setSvgRect(svg);
    pointer(svg, "pointermove", "mouse", clientXForAge(55, [45, 55]));

    const tooltip = view.container.querySelector(".chart-interaction-tooltip") as HTMLElement;
    Object.defineProperty(tooltip, "offsetWidth", { configurable: true, value: 160 });
    notifyResize?.();
    expect(tooltip.style.left).toBe("54px");
    expect(Number.parseFloat(tooltip.style.left) + tooltip.offsetWidth).toBeLessThanOrEqual(plot.clientWidth - 6);
  });
});
