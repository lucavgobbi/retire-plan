import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createEmptyWorkspace, DEFAULT_SCENARIO_BASE } from "../../domain/defaults";
import type { SimulationRunner } from "../../store/simulationWorkerProtocol";
import { useWorkspace, StoreProvider } from "../../store/api";
import { PlanView } from "./PlanView";

function WorkspaceProbe() {
  const { workspace } = useWorkspace();
  return <output data-testid="workspace-json">{JSON.stringify(workspace.plan)}</output>;
}

function renderPlan(simulationRunner?: SimulationRunner, initialWorkspace = createEmptyWorkspace()) {
  return render(<StoreProvider now={() => "2026-11-10T12:00:00Z"} initialWorkspace={initialWorkspace} initialBaseScenario={DEFAULT_SCENARIO_BASE} simulationRunner={simulationRunner}>
    <PlanView /><WorkspaceProbe />
  </StoreProvider>);
}

function planState() {
  return JSON.parse(screen.getByTestId("workspace-json").textContent ?? "{}") as ReturnType<typeof createEmptyWorkspace>["plan"];
}

describe("PlanView", () => {
  it("summarizes saved items and opens each editor at its own card", () => {
    const workspace = createEmptyWorkspace();
    workspace.plan.accounts = [
      { id: "cash", name: "Emergency fund", type: "cash", balance: 12_500, interestRate: 0.0425 },
      { id: "cash-zero", name: "Zero rate account", type: "cash", balance: 0, interestRate: 0 },
      { id: "cash-missing", name: "Unconfigured rate account", type: "cash", balance: 0 },
      { id: "nonreg", name: "Brokerage", type: "nonreg", balance: 2_000, assetMix: { equity: 0.6, bond: 0.3, cash: 0.1 } },
    ];
    workspace.plan.assets = [{ id: "home", kind: "primary-home", name: "Home", value: 500_000, appreciationRate: 0.02, sellEvent: { age: 70, costsPct: 0.05 } }];
    workspace.plan.debts = [{ id: "mortgage", kind: "mortgage", rate: 0.045, termYears: 5, amortizationYears: 25, balance: 250_000, monthlyPayment: 1_800, paymentFrequency: "biweekly" }];
    workspace.plan.incomes = [{ id: "pension", name: "Pension", kind: "other", annualAmount: 24_000, startAge: 65, raiseRate: 0.02 }];
    workspace.plan.expenses = [{ id: "living", name: "Living costs", annualAmount: 48_000, startAge: 45, endAge: 90, inflationRate: 0.025 }];
    workspace.plan.savingsPolicy = [{ id: "match", priority: 1, target: "rrsp-match", perYearCap: 5_000, untilAge: 65, matchRate: 0.05 }];
    renderPlan(undefined, workspace);

    fireEvent.click(screen.getByRole("tab", { name: "Accounts" }));
    const accountCard = screen.getByRole("region", { name: "Emergency fund summary" });
    expect(accountCard.textContent).toContain("Cash account");
    expect(accountCard.textContent).toContain("$12,500");
    expect(accountCard.textContent).toContain("4.3%");
    expect(screen.getByRole("region", { name: "Zero rate account summary" }).textContent).toContain("0.0%");
    expect(screen.getByRole("region", { name: "Unconfigured rate account summary" }).textContent).toContain("Not set (defaults to 0%)");
    expect(screen.getByRole("region", { name: "Brokerage summary" }).textContent).toContain("Not set (defaults to market value)");
    fireEvent.click(within(accountCard).getByRole("button", { name: "Edit" }));
    const accountEntry = accountCard.closest(".plan-item-entry") as HTMLElement;
    expect(within(accountEntry).getByLabelText("Annual interest rate (%)")).toBeTruthy();
    const closeAccount = within(accountCard).getByRole("button", { name: "Close editor" });
    closeAccount.focus();
    fireEvent.click(closeAccount);
    expect(document.activeElement).toBe(closeAccount);

    fireEvent.click(screen.getByRole("tab", { name: "Assets & debts" }));
    const assetCard = screen.getByRole("region", { name: "Home summary" });
    expect(assetCard.textContent).toContain("$500,000");
    expect(assetCard.textContent).toContain("Age 70 · 5.0% costs");
    const debtCard = screen.getByRole("region", { name: "Mortgage summary" });
    expect(debtCard.textContent).toContain("Biweekly");
    expect(debtCard.textContent).toContain("$1,800");

    fireEvent.click(screen.getByRole("tab", { name: "Income" }));
    const incomeCard = screen.getByRole("region", { name: "Pension summary" });
    expect(incomeCard.textContent).toContain("$24,000");
    expect(incomeCard.textContent).toContain("65–ongoing");
    fireEvent.click(screen.getByRole("tab", { name: "Expenses" }));
    expect(screen.getByRole("region", { name: "Living costs summary" }).textContent).toContain("2.5%");
    fireEvent.click(screen.getByRole("tab", { name: "Savings" }));
    const savingsCard = screen.getByRole("region", { name: "Savings step 1 summary" });
    expect(savingsCard.textContent).toContain("RRSP (employer match)");
    expect(savingsCard.textContent).toContain("$5,000");
  });

  it("disables its run control and exposes cancellation while a shared run is active", () => {
    const simulationRunner: SimulationRunner = () => new Promise(() => {});
    renderPlan(simulationRunner);
    fireEvent.click(screen.getByRole("button", { name: "Run projection" }));
    expect(screen.getByText("Projection running in the background…")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Run projection" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel projection" }));
    expect(screen.getByText("Projection cancelled.")).toBeTruthy();
  });

  it("derives a read-only current age and applies valid profile edits without a save button", () => {
    renderPlan();
    expect((screen.getByLabelText("Current age") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
    fireEvent.change(screen.getByLabelText("Birth year"), { target: { value: "" } });
    expect(screen.getByRole("alert").textContent).toMatch(/birth year is required/i);
    expect(planState().profile.currentAge).toBe(45);

    fireEvent.change(screen.getByLabelText("Birth year"), { target: { value: "1980" } });
    expect((screen.getByLabelText("Current age") as HTMLInputElement).value).toBe("46");
    expect(planState().profile).toMatchObject({ birthYear: 1980, currentAge: 46 });
    expect(screen.getByText(/Age reached in 2026/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Projection end age"), { target: { value: "90" } });
    expect(planState().profile).toMatchObject({ currentAge: 46, endAge: 90 });
    expect(screen.getByLabelText("Province")).toBeTruthy();
  });

  it("rejects fractional years and ages without dispatching them", () => {
    renderPlan();
    fireEvent.change(screen.getByLabelText("Birth year"), { target: { value: "1981.5" } });
    expect(screen.getByRole("alert").textContent).toMatch(/birth year must be a whole number/i);
    expect(planState().profile.birthYear).toBe(1981);

    fireEvent.click(screen.getByRole("tab", { name: "Income" }));
    fireEvent.click(screen.getByRole("button", { name: "Add employment" }));
    expect(planState().incomes).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Start age"), { target: { value: "45.5" } });
    expect(screen.getByRole("alert").textContent).toMatch(/start age must be a whole number/i);
    expect(planState().incomes[0]?.startAge).toBe(45);
  });

  it("applies valid account edits immediately, keeps invalid mixes local, and clears optional ACB", () => {
    renderPlan();
    fireEvent.click(screen.getByRole("tab", { name: "Accounts" }));
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    fireEvent.change(screen.getByLabelText("Account type"), { target: { value: "nonreg" } });
    fireEvent.change(screen.getByLabelText("Current balance ($)"), { target: { value: "10000" } });
    fireEvent.change(screen.getByLabelText(/ACB \/ book value/), { target: { value: "6000" } });
    fireEvent.change(screen.getByLabelText("Equity (%)"), { target: { value: "80" } });
    expect(screen.getByRole("alert").textContent).toMatch(/asset mix must total 100%/i);
    expect(planState().accounts[0]?.assetMix).toEqual({ equity: 0.6, bond: 0.3, cash: 0.1 });
    fireEvent.change(screen.getByLabelText("Bonds (%)"), { target: { value: "10" } });
    expect(planState().accounts[0]).toMatchObject({ type: "nonreg", balance: 10_000, bookValue: 6_000, assetMix: { equity: 0.8, bond: 0.1, cash: 0.1 } });

    fireEvent.change(screen.getByLabelText(/ACB \/ book value/), { target: { value: "" } });
    expect(planState().accounts[0]!.bookValue).toBeUndefined();
    expect(screen.queryByRole("button", { name: /save|add item/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(planState().accounts).toHaveLength(0);
  });

  it("uses readable account type labels while retaining the engine's stored enum values", () => {
    renderPlan();
    fireEvent.click(screen.getByRole("tab", { name: "Accounts" }));
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    const select = screen.getByLabelText("Account type");
    expect(within(select).getAllByRole("option").map(option => [option.textContent, (option as HTMLOptionElement).value])).toEqual([
      ["TFSA", "tfsa"], ["RRSP", "rrsp"], ["Non-registered", "nonreg"], ["Cash account", "cash"],
    ]);
    fireEvent.change(select, { target: { value: "rrsp" } });
    expect(planState().accounts[0]?.type).toBe("rrsp");
    fireEvent.change(select, { target: { value: "nonreg" } });
    expect(planState().accounts[0]?.type).toBe("nonreg");
  });

  it("edits named cash accounts with a grouped balance and fixed rate, without a market mix or ACB", () => {
    renderPlan();
    fireEvent.click(screen.getByRole("tab", { name: "Accounts" }));
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    fireEvent.change(screen.getByLabelText("Account type"), { target: { value: "nonreg" } });
    fireEvent.change(screen.getByLabelText(/ACB \/ book value/), { target: { value: "8000" } });
    fireEvent.change(screen.getByLabelText("Account type"), { target: { value: "cash" } });
    expect(screen.getByLabelText("Annual interest rate (%)")).toBeTruthy();
    expect(screen.queryByLabelText("Equity (%)")).toBeNull();
    expect(screen.queryByLabelText("Bonds (%)")).toBeNull();
    expect(screen.queryByLabelText(/ACB \/ book value/)).toBeNull();
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Emergency savings" } });
    fireEvent.change(screen.getByLabelText("Current balance ($)"), { target: { value: "12500" } });
    fireEvent.change(screen.getByLabelText("Annual interest rate (%)"), { target: { value: "-1" } });
    expect(screen.getByRole("alert").textContent).toContain("Annual interest rate must be at least 0.");
    expect(planState().accounts[0]?.interestRate).toBe(0);
    fireEvent.change(screen.getByLabelText("Annual interest rate (%)"), { target: { value: "4.25" } });
    expect(planState().accounts[0]).toEqual({ id: expect.any(String), name: "Emergency savings", type: "cash", balance: 12_500, interestRate: 0.0425 });
  });

  it("creates plan items immediately on add and applies edits while typing", () => {
    renderPlan();
    fireEvent.click(screen.getByRole("tab", { name: "Assets & debts" }));
    fireEvent.click(screen.getByRole("button", { name: "Add asset" }));
    expect(planState().assets).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Home" } });
    fireEvent.change(screen.getByLabelText("Current value ($)"), { target: { value: "700000" } });
    fireEvent.click(screen.getByLabelText("Plan a sale event"));
    fireEvent.change(screen.getByLabelText("Sale age"), { target: { value: "65" } });
    fireEvent.change(screen.getByLabelText("Sale costs (%)"), { target: { value: "5" } });
    expect(planState().assets[0]).toMatchObject({ kind: "primary-home", name: "Home", value: 700_000, sellEvent: { age: 65, costsPct: 0.05 } });

    fireEvent.click(screen.getByRole("button", { name: "Add mortgage" }));
    expect(planState().debts).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Mortgage balance ($)"), { target: { value: "250000" } });
    fireEvent.change(screen.getByLabelText("Payment ($)"), { target: { value: "1600" } });
    expect(planState().debts[0]).toMatchObject({ kind: "mortgage", balance: 250_000, monthlyPayment: 1_600 });

    fireEvent.click(screen.getByRole("tab", { name: "Income" }));
    fireEvent.click(screen.getByRole("button", { name: "Add employment" }));
    expect(planState().incomes[0]).toMatchObject({ kind: "employment", annualAmount: 0, startAge: 45, endAge: 64 });
    fireEvent.change(screen.getByLabelText("Annual amount ($)"), { target: { value: "95000" } });
    expect(planState().incomes[0]).toMatchObject({ kind: "employment", annualAmount: 95_000, startAge: 45, endAge: 64, raiseRate: 0.02 });

    fireEvent.click(screen.getByRole("tab", { name: "Expenses" }));
    fireEvent.click(screen.getByRole("button", { name: "Add expense" }));
    expect(planState().expenses).toHaveLength(1);
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Living" } });
    fireEvent.change(screen.getByLabelText("Annual amount ($)"), { target: { value: "50000" } });
    expect(planState().expenses[0]).toMatchObject({ name: "Living", annualAmount: 50_000, inflationRate: 0.02 });

    fireEvent.click(screen.getByRole("tab", { name: "Savings" }));
    fireEvent.click(screen.getByRole("button", { name: "Add savings step" }));
    expect(planState().savingsPolicy).toHaveLength(1);
    fireEvent.change(screen.getByLabelText("Savings target"), { target: { value: "rrsp-match" } });
    expect(planState().savingsPolicy[0]).toMatchObject({ target: "rrsp-match", priority: 1, matchRate: 0.05 });
    expect(screen.queryByRole("button", { name: /save|add item/i })).toBeNull();
  });

  it("shows engine plan validation errors inline", () => {
    renderPlan();
    fireEvent.click(screen.getByRole("tab", { name: "Accounts" }));
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    fireEvent.change(screen.getByLabelText("Current balance ($)"), { target: { value: "-1,000" } });
    // The editor catches the invalid value before dispatching, so no invalid plan leaks into the workspace.
    expect(within(screen.getByRole("alert")).getByText(/balance must be at least 0/i)).toBeTruthy();
    expect(screen.getByText(/These edits are not applied/)).toBeTruthy();
    expect(planState().accounts[0]?.balance).toBe(0);
  });

  it("gives accounts and incomes an optional name used as the form title", () => {
    renderPlan();
    fireEvent.click(screen.getByRole("tab", { name: "Accounts" }));
    fireEvent.click(screen.getByRole("button", { name: "Add account" }));
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Cottage fund" } });
    expect(planState().accounts[0]).toMatchObject({ name: "Cottage fund" });
    expect(screen.getByRole("region", { name: "Cottage fund" })).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Income" }));
    fireEvent.click(screen.getByRole("button", { name: "Add employment" }));
    fireEvent.change(screen.getByLabelText(/Name/), { target: { value: "Side gig" } });
    expect(planState().incomes[0]).toMatchObject({ name: "Side gig" });
    expect(screen.getByRole("region", { name: "Side gig" })).toBeTruthy();
  });

  it("leaves an empty name off the stored item", () => {
    renderPlan();
    fireEvent.click(screen.getByRole("tab", { name: "Income" }));
    fireEvent.click(screen.getByRole("button", { name: "Add cpp" }));
    expect(planState().incomes[0]?.name).toBeUndefined();
  });

  it("supports weekly and biweekly mortgage payment frequencies", () => {
    renderPlan();
    fireEvent.click(screen.getByRole("tab", { name: "Assets & debts" }));
    fireEvent.click(screen.getByRole("button", { name: "Add mortgage" }));
    // Defaults to monthly with no stored frequency.
    expect(planState().debts[0]?.paymentFrequency).toBeUndefined();
    fireEvent.change(screen.getByLabelText("Payment frequency"), { target: { value: "biweekly" } });
    expect(planState().debts[0]).toMatchObject({ paymentFrequency: "biweekly" });
    fireEvent.change(screen.getByLabelText("Payment frequency"), { target: { value: "weekly" } });
    expect(planState().debts[0]).toMatchObject({ paymentFrequency: "weekly" });
    fireEvent.change(screen.getByLabelText("Payment frequency"), { target: { value: "monthly" } });
    expect(planState().debts[0]?.paymentFrequency).toBeUndefined();
  });
});
