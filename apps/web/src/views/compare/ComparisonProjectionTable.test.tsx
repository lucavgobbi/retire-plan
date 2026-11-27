import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO_BASE } from "../../domain/defaults";
import { runScenario } from "../../domain/run";
import { resolveScenario } from "../../domain/scenario";
import type { RunRecord } from "../../domain/types";
import { fmtMoney } from "../projection/fmt";
import { columns } from "../projection/ProjectionTable";
import { makeSamplePlan } from "../projection/testFixtures";
import { ComparisonProjectionTable } from "./ComparisonProjectionTable";

const labels = ["Baseline", "Alternative", "Legacy"];
const colors = ["#2159a0", "#a44222", "#564597"];

function makeRun(id: string, { salary = 95_000, birthYear = 1981, endAge = 47 } = {}): RunRecord {
  const plan = makeSamplePlan();
  Object.assign(plan.profile, { birthYear, endAge });
  plan.incomes[0]!.annualAmount = salary;
  plan.incomes[0]!.raiseRate = 0;
  for (const account of plan.accounts) account.name = `${id} ${account.type.toUpperCase()}`;
  const scenario = resolveScenario(null, DEFAULT_SCENARIO_BASE);
  return {
    id,
    planId: "plan-test",
    scenarioId: id,
    scenario,
    result: runScenario(plan, scenario).result,
    birthYear,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function show(runs: RunRecord[], visible: string[]) {
  const hiddenColumnIds = new Set(
    columns()
      .map(({ id }) => id)
      .filter((id) => !visible.includes(id)),
  );
  const { container } = render(
    <ComparisonProjectionTable
      runs={runs}
      birthYear={1981}
      labels={labels}
      colors={colors}
      hiddenColumnIds={hiddenColumnIds}
    />,
  );
  const region = within(screen.getByRole("region", { name: "Cashflow projection comparison" }));
  return { region, container };
}

function buttonRow(region: ReturnType<typeof within>, name: string | RegExp) {
  return region.getByRole("button", { name }).closest("tr")!;
}

function metricCells(region: ReturnType<typeof within>, row: HTMLTableRowElement, name: string) {
  const header = region.getByRole("columnheader", { name });
  const cells = Array.from(row.cells).filter((cell) => cell.headers.split(" ").includes(header.id));
  expect(cells.length).toBeGreaterThan(0);
  return cells;
}

function values(cells: HTMLTableCellElement[]) {
  return cells.map((cell) => cell.textContent);
}

describe("comparison projection table", () => {
  it("pairs scenario values in metric order, sums flows and uses the closing stock and weighted rate", () => {
    const baseline = makeRun("Base", { salary: 90_000, endAge: 55 });
    const alternative = makeRun("Alt", { salary: 110_000, endAge: 54 });
    const firstGroup = baseline.result.years.slice(0, 10);
    const last = firstGroup.at(-1)!;
    for (const [index, year] of firstGroup.entries()) {
      year.taxableIncome = index === 9 ? 300 : 100;
      year.tax.marginalRate = index === 9 ? 0.5 : 0.1;
    }
    alternative.result.years.pop();
    const { region } = show(
      [baseline, alternative],
      ["income.employment", "income.total", "tax.marginalRate", "netWorth"],
    );
    const summary = buttonRow(region, "Expand Ages 45–54");
    expect(region.getByRole("button", { name: "Expand Age 55" })).toBeTruthy();
    expect(values(metricCells(region, summary, "Employment"))).toEqual(["$900,000", "$990,000"]);
    expect(values(metricCells(region, summary, "Total income"))).toEqual(["$900,000", "$990,000"]);
    expect(values(metricCells(region, summary, "Net worth"))).toEqual([fmtMoney(last.netWorth), "—"]);
    expect(values(metricCells(region, summary, "Marginal"))[0]).toBe("20.0%");
    expect(values(metricCells(region, summary, "Audit"))[1]).toContain("9 of 10 years");

    fireEvent.click(region.getByRole("button", { name: "Expand Ages 45–54" }));
    const firstYear = buttonRow(region, /Show details for 2026/);
    expect(values(metricCells(region, firstYear, "Employment"))).toEqual(["$90,000", "$110,000"]);
    expect(values(metricCells(region, firstYear, "Marginal"))[0]).toBe("10.0%");
    expect(values(metricCells(region, buttonRow(region, /Show details for 2035/), "Employment"))).toEqual([
      "$90,000",
      "—",
    ]);
  });

  it("aligns rows by calendar year using saved birth years", () => {
    const baseline = makeRun("Base", { salary: 90_000 });
    const alternative = makeRun("Alt", { salary: 110_000, birthYear: 1982 });
    const { region } = show([baseline, alternative], ["income.employment"]);
    expect(region.getByRole("columnheader", { name: "Age (Baseline)" })).toBeTruthy();
    fireEvent.click(region.getByRole("button", { name: "Expand Ages 45–48" }));
    expect(values(metricCells(region, buttonRow(region, /Show details for 2026/), "Employment"))).toEqual([
      "$90,000",
      "—",
    ]);
    expect(values(metricCells(region, buttonRow(region, /Show details for 2027/), "Employment"))).toEqual([
      "$90,000",
      "$110,000",
    ]);
    expect(values(metricCells(region, buttonRow(region, /Show details for 2029/), "Employment"))).toEqual([
      "—",
      "$110,000",
    ]);
    fireEvent.click(region.getByRole("button", { name: /Show details for 2026/ }));
    expect(
      within(region.getByRole("region", { name: "Alternative" })).getByText("— No projection for 2026."),
    ).toBeTruthy();
  });

  it("keeps age, calendar year and paired audit columns when every selectable metric is hidden", () => {
    const { region } = show([makeRun("Base"), makeRun("Alt")], []);
    expect(region.getAllByRole("columnheader", { name: "Household calendar year" })).toHaveLength(1);
    expect(region.getByRole("columnheader", { name: "Age" })).toBeTruthy();
    expect(region.getByRole("columnheader", { name: "Audit" })).toBeTruthy();
    expect(region.getAllByRole("columnheader", { name: /^(Baseline|Alternative)$/ })).toHaveLength(2);
    expect(region.queryByRole("columnheader", { name: "Employment" })).toBeNull();
  });

  it("labels and colors all three scenarios and resolves every cell header to its metric and scenario", () => {
    const baseline = makeRun("Base");
    const alternative = makeRun("Alt");
    const legacy = makeRun("Old");
    delete legacy.birthYear;
    for (const year of legacy.result.years) {
      delete year.payroll;
      delete year.accountBreakdown;
      delete year.expenseBreakdown;
    }
    const { region } = show(
      [baseline, alternative, legacy],
      ["income.employment", "income.total", "payroll.total", "cash.total"],
    );
    const summary = buttonRow(region, "Expand Ages 45–47");
    const cells = metricCells(region, summary, "Total interest");
    expect(region.getByRole("columnheader", { name: "Total interest" }).getAttribute("colspan")).toBe("3");
    cells.forEach((cell, index) => {
      const headers = cell.headers.split(" ").map((id) => document.getElementById(id));
      expect(headers.slice(1).map((header) => header?.getAttribute("aria-label") ?? header?.textContent)).toEqual([
        "Cash accounts",
        "Total interest",
        labels[index],
      ]);
      const scenarioHeader = headers.at(-1)!;
      expect(scenarioHeader.style.getPropertyValue("--comparison-scenario-color")).toBe(colors[index]);
      expect(cell.style.getPropertyValue("--comparison-scenario-color")).toBe(colors[index]);
    });
    expect(values(metricCells(region, summary, "Total withheld"))).toEqual(["$0", "$0", "—"]);
    expect(region.getByRole("columnheader", { name: "Employment" }).nextElementSibling).toBe(
      region.getByRole("columnheader", { name: "Total income" }),
    );

    fireEvent.click(region.getByRole("button", { name: "Expand Ages 45–47" }));
    fireEvent.click(region.getByRole("button", { name: /Show details for 2026/ }));
    const legacyDetail = within(region.getByRole("region", { name: "Legacy · Age 45" }));
    expect(legacyDetail.getByText(/Per-expense details were not recorded/)).toBeTruthy();
    expect(legacyDetail.getByText(/No payroll breakdown was recorded/)).toBeTruthy();
    expect(legacyDetail.getByRole("region", { name: "Savings flows" })).toBeTruthy();
  });

  it("opens the full year audit for each scenario with distinct IDs and saved settings", () => {
    const baseline = makeRun("Base");
    const alternative = makeRun("Alt");
    alternative.scenario.simMode = "historical";
    alternative.scenario.withdrawalStrategy = "tax-minimizing";
    alternative.scenario.benefits = { cpp: true, oas: false, gis: true };
    alternative.analysis = {
      mode: "historical",
      windowCount: 1,
      firstWindowStartYear: 1989,
      latestWindowStartYear: 1989,
      successRate: 1,
      percentileNetWorth: { p10: 0, p50: 0, p90: 0 },
      representativeStartYear: 1989,
      representativeEndYear: 1991,
    };
    const { region, container } = show([baseline, alternative], ["netWorth"]);
    fireEvent.click(region.getByRole("button", { name: "Expand Ages 45–47" }));
    const toggle = region.getByRole("button", { name: /Show details for 2027/ });
    fireEvent.click(toggle);
    const details = document.getElementById(toggle.getAttribute("aria-controls")!)!;
    const base = within(region.getByRole("region", { name: "Baseline · Age 46" }));
    const alt = within(region.getByRole("region", { name: "Alternative · Age 46" }));
    expect(within(base.getByRole("list", { name: "Account details" })).getByText("Base TFSA")).toBeTruthy();
    expect(within(alt.getByRole("list", { name: "Account details" })).getByText("Alt TFSA")).toBeTruthy();
    expect(base.getByText(/CPP, OAS, GIS .* Manual account order/)).toBeTruthy();
    expect(alt.getByText(/CPP .* Tax-minimizing planning .* Return source: 1990/)).toBeTruthy();
    expect(alt.getByText(/Household calendar year 2027 uses historical return source year 1990/)).toBeTruthy();

    const detailRows = details.querySelectorAll("tr.detail-row");
    expect(detailRows).toHaveLength(2);
    expect(Array.from(detailRows, (row) => row.id).every(Boolean)).toBe(true);
    const ids = Array.from(container.querySelectorAll("[id]"), (node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    fireEvent.click(toggle);
    expect(document.getElementById(details.id)).toBeNull();
  });
});
