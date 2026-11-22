import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildDeterministicReturns, simulate, type Plan, type Scenario, type YearResult } from "@retire-plan/engine";
import { YearDetailRow } from "./YearDetailRow";
import { fmtMoneyDetail } from "./fmt";

const noGrowth = { equity: 0, bond: 0, cash: 0 };
const scenario: Scenario = {
  id: "named", name: "Named items", simMode: "deterministic", retirementAge: 71,
  returnAssumptions: noGrowth, withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
};

function makePlan(): Plan {
  return {
    profile: { birthYear: 1955, currentAge: 71, endAge: 72, province: "ON" },
    accounts: [], assets: [], debts: [], incomes: [], expenses: [], savingsPolicy: [],
  };
}

function show(year: YearResult) {
  render(<table><tbody><YearDetailRow age={year.age} year={year} expanded colSpan={10} /></tbody></table>);
}

describe("expanded year account and item details", () => {
  it("distinguishes duplicate names, repeated IDs and fallback collisions while listing empty accounts", () => {
    const plan = makePlan();
    plan.accounts = ["Retirement", "Retirement", undefined, "RRSP 3", "Retirement (RRSP 1)"].map((name, index) => ({
      id: "repeated-raw-id", name, type: "rrsp", balance: index === 0 ? 1_000 : 0, assetMix: { ...noGrowth, cash: 1 },
    }));
    plan.incomes = [{ id: "rent", name: "Basement rent", kind: "other", startAge: 71, annualAmount: 100, raiseRate: 0 }];
    plan.expenses = [
      { id: "repeated", name: "Food", startAge: 71, annualAmount: 100.005, inflationRate: 0 },
      { id: "repeated", name: "Travel", startAge: 71, annualAmount: 100.005, inflationRate: 0 },
    ];
    plan.assets = [{ id: "cabin", name: "Lake cabin", kind: "other", value: 100, appreciationRate: 0, sellEvent: { age: 71, costsPct: 0 } }];
    plan.debts = [{ id: "mortgage", kind: "mortgage", balance: 100, rate: 0, monthlyPayment: 10, termYears: 1, amortizationYears: 1 }];
    const year = simulate(plan, scenario, buildDeterministicReturns(noGrowth, 71, 72)).years[0]!;
    plan.incomes[0]!.name = "Replacement name";
    show(year);

    const accountList = within(screen.getByRole("list", { name: "Account details" }));
    const accounts = accountList.getAllByRole("listitem");
    expect(accounts.map((item) => item.querySelector("strong")?.textContent)).toEqual([
      "Retirement (RRSP 1, 2)", "Retirement (RRSP 2)", "RRSP 3 (unnamed)", "RRSP 3 (RRSP 4)", "Retirement (RRSP 1)",
    ]);
    expect(within(accounts[1]!).getAllByText("$0.00")).toHaveLength(4);
    expect(accountList.queryByText(/repeated-raw-id/)).toBeNull();
    const income = within(screen.getByRole("region", { name: "Income" }));
    expect(income.getByText("Basement rent")).toBeTruthy();
    expect(income.queryByText("Replacement name")).toBeNull();
    const expenses = within(screen.getByRole("region", { name: "Expenses" }));
    expect(expenses.getByText("Food").parentElement?.textContent).toContain("$100.01");
    expect(expenses.getByText("Travel").parentElement?.textContent).toContain("$100.00");
    const balances = within(screen.getByRole("region", { name: "Net worth breakdown" }));
    expect(balances.getByText("Lake cabin sale proceeds to idle cash")).toBeTruthy();
    expect(balances.getByText("Mortgage scheduled payments").nextElementSibling?.textContent).toBe("$100.00");
  });

  it("shows the category-level difference when a named withdrawal was capped", () => {
    const plan = makePlan();
    plan.accounts = [{ id: "rrsp", name: "Small RRSP", type: "rrsp", balance: 1.044, assetMix: { ...noGrowth, cash: 1 } }];
    const year = simulate(plan, { ...scenario, withdrawalStrategy: "tax-minimizing" }, buildDeterministicReturns(noGrowth, 71, 72), undefined,
      { strategy: "tax-minimizing", fillTargetTaxable: 50_000, byAge: [] }).years[0]!;
    show(year);
    const account = within(screen.getByRole("list", { name: "Account details" }));
    expect(account.getByText("Withdrawals").nextElementSibling?.textContent).toBe("$1.04");
    expect(screen.getByText("RRSP withdrawal reconciliation").nextElementSibling?.textContent).toBe("$0.01");
  });

  it("includes both named RRSP closing balances and the total in the net worth breakdown", () => {
    const plan = makePlan();
    plan.profile.currentAge = 70;
    const assetMix = { equity: 1, bond: 0, cash: 0 };
    plan.accounts = [
      { id: "first", name: "Work RRSP", type: "rrsp", balance: 1_000, assetMix },
      { id: "second", name: "Personal RRSP", type: "rrsp", balance: 2_000, assetMix },
    ];
    plan.incomes = [{ id: "income", kind: "other", annualAmount: 25, startAge: 70, raiseRate: 0 }];
    const growth = { ...noGrowth, equity: 0.1 };
    const year = simulate(plan, { ...scenario, benefits: { cpp: false, oas: false, gis: false } },
      buildDeterministicReturns(growth, 70, 72)).years[0]!;
    show(year);

    const balances = within(screen.getByRole("region", { name: "Net worth breakdown" }));
    expect(balances.getByText("Work RRSP").nextElementSibling?.textContent).toBe("$1,100.00");
    expect(balances.getByText("Personal RRSP").nextElementSibling?.textContent).toBe("$2,200.00");
    expect(balances.getByText("Idle cash reserve").nextElementSibling?.textContent).toBe("$25.00");
    expect(balances.getByText("Net worth").nextElementSibling?.textContent).toBe("$3,325.00");
  });

  it("keeps the modeled GIS label distinct from configured income names", () => {
    const plan = makePlan();
    plan.incomes = [
      { id: "first", name: "GIS", kind: "other", startAge: 71, annualAmount: 100, raiseRate: 0 },
      { id: "second", name: "GIS (Other income 1)", kind: "other", startAge: 71, annualAmount: 200, raiseRate: 0 },
    ];
    const year = simulate(plan, scenario, buildDeterministicReturns(noGrowth, 71, 72)).years[0]!;
    expect(year.income.gis).toBeGreaterThan(0);
    show(year);

    const income = within(screen.getByRole("region", { name: "Income" }));
    expect(income.getByText("GIS").nextElementSibling?.textContent).toBe(fmtMoneyDetail(year.income.gis));
    expect(income.getByText("GIS (Other income 1, 2)").nextElementSibling?.textContent).toBe("$100.00");
    expect(income.getByText("GIS (Other income 1)").nextElementSibling?.textContent).toBe("$200.00");
  });

  it("keeps saved categories and available cash names for legacy runs with a rerun note", () => {
    const year = simulate(makePlan(), scenario, buildDeterministicReturns(noGrowth, 71, 72)).years[0]!;
    delete year.accountBreakdown;
    delete year.assetBreakdown;
    delete year.incomeBreakdown;
    delete year.expenseBreakdown;
    year.savings.rrsp = 123;
    year.cashAccounts = [{ id: "savings", name: "Saved cash name", balance: 200 }];
    show(year);
    const savings = within(screen.getByRole("region", { name: "Savings flows" }));
    expect(savings.getByText("RRSP").nextElementSibling?.textContent).toBe("$123.00");
    expect(screen.getByText(/Saved cash name/)).toBeTruthy();
    expect(screen.getByText(/run the projection again to see the full account and item breakdown/i)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Account details" })).toBeNull();
  });
});
