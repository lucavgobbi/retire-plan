import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { createDefaultPlan, DEFAULT_SCENARIO_BASE } from "../../../domain/defaults";
import { runDeterministic } from "../../../domain/run";
import { CashflowSankey } from "./CashflowSankey";

const groupedView = { showAccounts: false, onShowAccountsChange: vi.fn() };

function testRun(withMatch = false) {
  const plan = createDefaultPlan();
  plan.profile = { birthYear: 1981, currentAge: 45, endAge: 47, province: "ON" };
  plan.incomes = [{ id: "employment", kind: "employment", annualAmount: 10_000, startAge: 45, raiseRate: 0 }];
  plan.expenses = [{ id: "living", annualAmount: 4_000, startAge: 45, inflationRate: 0 }];
  plan.savingsPolicy = [];
  if (withMatch) {
    plan.accounts = [{ id: "rrsp", type: "rrsp", balance: 0, assetMix: { equity: 0, bond: 0, cash: 1 } }];
    plan.savingsPolicy = [{ id: "match", target: "rrsp-match", priority: 1, perYearCap: 500, matchRate: 0.5 }];
  }
  return runDeterministic(plan, { ...DEFAULT_SCENARIO_BASE, id: "test", name: "Test", simMode: "deterministic" });
}

describe("CashflowSankey", () => {
  it("switches the diagram and its open breakdown between categories and every named flow", () => {
    const plan = createDefaultPlan();
    plan.profile = { birthYear: 1981, currentAge: 45, endAge: 46, province: "ON" };
    plan.incomes = [
      { id: "job", name: "Library", kind: "employment", annualAmount: 1_000, startAge: 45, raiseRate: 0 },
    ];
    const expenseNames = ["Rent", "Groceries", "Internet", "Power", "Phone", "Transit", "Books", "Insurance"];
    plan.expenses = [...expenseNames, "Zero planned expense"].map((name, index) => ({
      id: `expense-${index}`,
      name,
      annualAmount: index < expenseNames.length ? index + 1 : 0,
      startAge: 45,
      inflationRate: 0,
    }));
    plan.savingsPolicy = [];
    const { years } = runDeterministic(plan, {
      ...DEFAULT_SCENARIO_BASE,
      id: "test",
      name: "Test",
      simMode: "deterministic",
    });
    const onRangeChange = vi.fn();
    function ControlledDiagram() {
      const [showAccounts, setShowAccounts] = useState(false);
      return (
        <CashflowSankey
          years={years}
          birthYear={1981}
          range={{ startYear: 2026, endYear: 2026 }}
          onRangeChange={onRangeChange}
          showAccounts={showAccounts}
          onShowAccountsChange={setShowAccounts}
        />
      );
    }
    render(<ControlledDiagram />);
    const checkbox = screen.getByRole<HTMLInputElement>("checkbox", { name: "Show accounts" });
    const breakdown = screen.getByText("Cashflow breakdown").closest("details")!;
    const categoryDiagram = screen.getByRole("group", { name: "Cashflow Sankey diagram" });
    fireEvent.click(screen.getByText("Cashflow breakdown"));
    expect(checkbox.checked).toBe(false);
    expect(within(categoryDiagram).getByRole("button", { name: /to Modeled expenses/ })).toBeTruthy();
    expect(within(breakdown).getByText("Modeled expenses")).toBeTruthy();
    const periodTotal = screen.getByRole("status").textContent;

    fireEvent.click(checkbox);
    const namedDiagram = screen.getByRole("group", { name: "Cashflow Sankey diagram" });
    expect(breakdown.open).toBe(true);
    for (const name of expenseNames) {
      expect(within(namedDiagram).getByRole("button", { name: new RegExp(`to ${name},`) })).toBeTruthy();
      expect(within(breakdown).getByText(name)).toBeTruthy();
    }
    expect(within(namedDiagram).getByRole("button", { name: /Library to/ })).toBeTruthy();
    expect(within(breakdown).getByText("Library")).toBeTruthy();
    expect(within(breakdown).getByText("Zero planned expense").nextElementSibling?.textContent).toBe("$0.00");
    expect(within(namedDiagram).queryByRole("button", { name: /Other uses|Zero planned expense/ })).toBeNull();
    expect(screen.getByRole("status").textContent).toBe(periodTotal);
    expect(onRangeChange).not.toHaveBeenCalled();

    fireEvent.click(checkbox);
    expect(within(breakdown).getByText("Modeled expenses")).toBeTruthy();
    expect(within(breakdown).queryByText("Rent")).toBeNull();
  });

  it("retains category flows and explains how to get names when a saved run lacks the capture", () => {
    const { years } = testRun();
    const legacy = years.map(({ accountBreakdown, incomeBreakdown, assetBreakdown, ...row }) => row);
    render(
      <CashflowSankey
        years={legacy}
        birthYear={1981}
        range={{ startYear: 2026, endYear: 2026 }}
        onRangeChange={vi.fn()}
        showAccounts
        onShowAccountsChange={vi.fn()}
      />,
    );
    expect(screen.getByRole<HTMLInputElement>("checkbox", { name: "Show accounts" }).checked).toBe(true);
    expect(screen.getByText(/Run the projection again to show named flows/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Employment to Cashflow pool/ })).toBeTruthy();
  });

  it("offers inclusive calendar years, prevents crossed ranges and reports the valid changes", () => {
    const { years } = testRun();
    const onRangeChange = vi.fn();
    const { rerender } = render(
      <CashflowSankey
        years={years}
        birthYear={1981}
        range={{ startYear: 2026, endYear: 2028 }}
        onRangeChange={onRangeChange}
        {...groupedView}
      />,
    );
    expect(screen.getByText("2026–2028 · CAD")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("End year"), { target: { value: "2027" } });
    expect(onRangeChange).toHaveBeenCalledWith({ startYear: 2026, endYear: 2027 });
    rerender(
      <CashflowSankey
        years={years}
        birthYear={1981}
        range={{ startYear: 2027, endYear: 2027 }}
        onRangeChange={onRangeChange}
        {...groupedView}
      />,
    );
    expect(screen.getByText("2027 · CAD")).toBeTruthy();
    expect(
      (within(screen.getByLabelText("Start year")).getByRole("option", { name: "2028" }) as HTMLOptionElement).disabled,
    ).toBe(true);
    expect(
      (within(screen.getByLabelText("End year")).getByRole("option", { name: "2026" }) as HTMLOptionElement).disabled,
    ).toBe(true);
  });

  it("exposes the same source, destination and amount by mouse, keyboard and tap", () => {
    const { years } = testRun();
    render(
      <CashflowSankey
        years={years}
        birthYear={1981}
        range={{ startYear: 2026, endYear: 2026 }}
        onRangeChange={vi.fn()}
        {...groupedView}
      />,
    );
    const link = screen.getByRole("button", { name: "Employment to Cashflow pool, $10,000.00" });
    const status = screen.getByRole("status");
    fireEvent.pointerEnter(link, { pointerType: "mouse" });
    expect(status.textContent).toContain("Employment → Cashflow pool$10,000.00");
    fireEvent.pointerLeave(link, { pointerType: "mouse" });
    expect(status.textContent).toContain("Period flow");
    fireEvent.focus(link);
    expect(status.textContent).toContain("Employment → Cashflow pool$10,000.00");
    fireEvent.keyDown(link, { key: "Enter" });
    expect(link.getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(link, { key: "Escape" });
    expect(status.textContent).toContain("Period flow");
    fireEvent.pointerDown(link, { pointerType: "touch" });
    fireEvent.pointerUp(link, { pointerType: "touch" });
    fireEvent.click(link);
    expect(status.textContent).toContain("Employment → Cashflow pool$10,000.00");
  });

  it("shows employer match as a direct transfer apart from the employee RRSP contribution", () => {
    const { years } = testRun(true);
    render(
      <CashflowSankey
        years={years}
        birthYear={1981}
        range={{ startYear: 2026, endYear: 2026 }}
        onRangeChange={vi.fn()}
        {...groupedView}
      />,
    );
    const directTransfer = screen.getByText("Direct transfer outside the cashflow pool").closest("p");
    expect(directTransfer?.textContent).toContain("Employer match → RRSP");
    expect(directTransfer?.textContent).toContain("Direct transfer outside the cashflow pool");
    expect(directTransfer?.textContent).toContain("$250.00");
    expect(screen.getByRole("button", { name: "Cashflow pool to RRSP contributions, $500.00" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /employer match/i })).toBeNull();
  });

  it("shows independent company RRSP contributions separately from match and subtracts both from household cash", () => {
    const base = testRun(true).years[0]!;
    const account = base.accountBreakdown![0]!;
    const match = account.employerRrspMatch!;
    const company = 300;
    const employee = account.contributions - match;
    const years = [
      {
        ...base,
        income: { ...base.income, other: base.income.other + company },
        contributions: { ...base.contributions, rrsp: employee + match + company },
        accountBreakdown: [
          {
            ...account,
            name: "Work RRSP",
            contributions: employee + match + company,
            employerRrspContribution: company,
          },
        ],
        cashflow: { ...base.cashflow!, employerRrspContribution: company },
      },
    ];
    const props = {
      years,
      birthYear: 1981,
      range: { startYear: 2026, endYear: 2026 },
      onRangeChange: vi.fn(),
      onShowAccountsChange: vi.fn(),
    };
    const { rerender } = render(<CashflowSankey {...props} showAccounts={false} />);
    const summary = screen.getByText("Cashflow breakdown");
    fireEvent.click(summary);
    const breakdown = within(summary.closest("details")!);
    expect(breakdown.getByText("Company RRSP contribution → RRSP").nextElementSibling?.textContent).toBe("$300.00");
    expect(breakdown.getByText("Employer match → RRSP").nextElementSibling?.textContent).toBe("$250.00");
    expect(screen.getByRole("button", { name: "Cashflow pool to RRSP contributions, $500.00" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Other income to Cashflow pool/ })).toBeNull();

    rerender(<CashflowSankey {...props} showAccounts />);
    expect(breakdown.getByText("Company RRSP contribution → Work RRSP").nextElementSibling?.textContent).toBe(
      "$300.00",
    );
    expect(breakdown.getByText("Employer match → Work RRSP").nextElementSibling?.textContent).toBe("$250.00");
    expect(screen.getByRole("button", { name: "Cashflow pool to Work RRSP contributions, $500.00" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /company RRSP contribution|employer match/i })).toBeNull();
  });

  it("keeps a match-only breakdown available and names the recipient when checked", () => {
    const base = testRun(true).years[0]!;
    const account = base.accountBreakdown![0]!;
    const match = account.employerRrspMatch!;
    const years = [
      {
        ...base,
        income: { ...base.income, employment: 0 },
        incomeBreakdown: [],
        expenses: 0,
        expenseBreakdown: [],
        contributions: { ...base.contributions, rrsp: match },
        accountBreakdown: [{ ...account, name: "Work RRSP", contributions: match }],
        cashflow: { ...base.cashflow!, openingIdleCash: 0, closingIdleCash: 0 },
      },
    ];
    const props = {
      years,
      birthYear: 1981,
      range: { startYear: 2026, endYear: 2026 },
      onRangeChange: vi.fn(),
      onShowAccountsChange: vi.fn(),
    };
    const { rerender } = render(<CashflowSankey {...props} showAccounts={false} />);
    expect(screen.getByText(/No pooled cash movements/)).toBeTruthy();
    const summary = screen.getByText("Cashflow breakdown");
    fireEvent.click(summary);
    const breakdown = summary.closest("details")!;
    expect(breakdown.open).toBe(true);
    expect(within(breakdown).getByText("Employer match → RRSP").nextElementSibling?.textContent).toBe("$250.00");
    rerender(<CashflowSankey {...props} showAccounts />);
    expect(within(breakdown).getByText("Employer match → Work RRSP").nextElementSibling?.textContent).toBe("$250.00");
    expect(within(breakdown).getByRole("heading", { name: "Direct transfers outside the cashflow pool" })).toBeTruthy();
  });
});
