import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDefaultPlan, DEFAULT_SCENARIO_BASE } from "../../../domain/defaults";
import { runDeterministic } from "../../../domain/run";
import { CashflowSankey } from "./CashflowSankey";

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
  it("offers inclusive calendar years, prevents crossed ranges and reports the valid changes", () => {
    const { years } = testRun();
    const onRangeChange = vi.fn();
    const { rerender } = render(<CashflowSankey years={years} birthYear={1981} range={{ startYear: 2026, endYear: 2028 }} onRangeChange={onRangeChange} />);
    expect(screen.getByText("2026–2028 · CAD")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("End year"), { target: { value: "2027" } });
    expect(onRangeChange).toHaveBeenCalledWith({ startYear: 2026, endYear: 2027 });
    rerender(<CashflowSankey years={years} birthYear={1981} range={{ startYear: 2027, endYear: 2027 }} onRangeChange={onRangeChange} />);
    expect(screen.getByText("2027 · CAD")).toBeTruthy();
    expect((within(screen.getByLabelText("Start year")).getByRole("option", { name: "2028" }) as HTMLOptionElement).disabled).toBe(true);
    expect((within(screen.getByLabelText("End year")).getByRole("option", { name: "2026" }) as HTMLOptionElement).disabled).toBe(true);
  });

  it("exposes the same source, destination and amount by mouse, keyboard and tap", () => {
    const { years } = testRun();
    render(<CashflowSankey years={years} birthYear={1981} range={{ startYear: 2026, endYear: 2026 }} onRangeChange={vi.fn()} />);
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
    render(<CashflowSankey years={years} birthYear={1981} range={{ startYear: 2026, endYear: 2026 }} onRangeChange={vi.fn()} />);
    const directTransfer = screen.getByText("Employer match → RRSP").closest("p");
    expect(directTransfer?.textContent).toContain("Direct transfer outside the cashflow pool");
    expect(directTransfer?.textContent).toContain("$250.00");
    expect(screen.getByRole("button", { name: "Cashflow pool to RRSP contributions, $500.00" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /employer match/i })).toBeNull();
  });
});
