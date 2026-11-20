import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildDeterministicReturns, simulate, type SimulationResult } from "@retire-plan/engine";
import { createEmptyWorkspace, DEFAULT_SCENARIO_BASE } from "../../domain/defaults";
import type { SimulationRunner } from "../../store/simulationWorkerProtocol";
import { useWorkspace, StoreProvider } from "../../store/api";
import { PlanView } from "./PlanView";

function WorkspaceProbe() {
  const { workspace } = useWorkspace();
  return <>
    <output data-testid="workspace-json">{JSON.stringify(workspace.plan)}</output>
    <output data-testid="saved-retirement-age">{workspace.baseScenario?.retirementAge}</output>
  </>;
}

function renderPlan(simulationRunner?: SimulationRunner, initialWorkspace = createEmptyWorkspace()) {
  return render(<StoreProvider now={() => "2026-11-10T12:00:00Z"} initialWorkspace={initialWorkspace} simulationRunner={simulationRunner}>
    <PlanView /><WorkspaceProbe />
  </StoreProvider>);
}

function planState() {
  return JSON.parse(screen.getByTestId("workspace-json").textContent ?? "{}") as ReturnType<typeof createEmptyWorkspace>["plan"];
}

describe("PlanView", () => {
  it("summarizes saved items and replaces each card with its in-place editor", async () => {
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
    expect(screen.queryByRole("region", { name: "Emergency fund summary" })).toBeNull();
    const accountEntry = document.querySelector(".plan-item-entry") as HTMLElement;
    const firstEditorField = within(accountEntry).getByLabelText(/^Name/);
    expect(within(accountEntry).getByLabelText("Annual interest rate (%)")).toBeTruthy();
    expect(document.activeElement).toBe(firstEditorField);
    fireEvent.click(within(accountEntry).getByRole("button", { name: "Close editor" }));
    expect(screen.getByRole("region", { name: "Emergency fund summary" })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(within(accountEntry).getByRole("button", { name: "Edit" })));

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

  it("unchecking Plan a sale event removes the planned sale from the plan and restores it from retained fields on re-check", () => {
    const workspace = createEmptyWorkspace();
    workspace.plan.assets = [{ id: "home", kind: "primary-home", name: "Home", value: 500_000, appreciationRate: 0.02, sellEvent: { age: 70, costsPct: 0.05 } }];
    renderPlan(undefined, workspace);
    fireEvent.click(screen.getByRole("tab", { name: "Assets & debts" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Home summary" })).getByRole("button", { name: "Edit" }));
    const checkbox = () => screen.getByLabelText("Plan a sale event") as HTMLInputElement;
    expect(checkbox().checked).toBe(true);
    expect(screen.getByLabelText("Sale age")).toBeTruthy();
    expect(screen.getByLabelText("Sale costs (%)")).toBeTruthy();

    // Unchecking must actually REMOVE the planned sale from the stored plan —
    // the checkbox must not snap back to checked.
    fireEvent.click(checkbox());
    expect(checkbox().checked).toBe(false);
    expect(planState().assets[0]).not.toHaveProperty("sellEvent");
    // The sale fields are hidden while unchecked...
    expect(screen.queryByLabelText("Sale age")).toBeNull();
    expect(screen.queryByLabelText("Sale costs (%)")).toBeNull();

    // ...and re-checking restores the planned sale from the RETAINED draft
    // values (no re-entry, no data loss).
    fireEvent.click(checkbox());
    expect(checkbox().checked).toBe(true);
    expect((screen.getByLabelText("Sale age") as HTMLInputElement).value).toBe("70");
    expect((screen.getByLabelText("Sale costs (%)") as HTMLInputElement).value).toBe("5");
    expect(planState().assets[0]).toMatchObject({ sellEvent: { age: 70, costsPct: 0.05 } });
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
    expect(planState().incomes[0]).toMatchObject({ kind: "employment", annualAmount: 0, startAge: 45, endAtRetirement: true });
    expect(planState().incomes[0]).not.toHaveProperty("endAge");
    expect((screen.getByRole("checkbox", { name: "Until retirement" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.change(screen.getByLabelText("Annual amount ($)"), { target: { value: "95000" } });
    expect(planState().incomes[0]).toMatchObject({ kind: "employment", annualAmount: 95_000, startAge: 45, endAtRetirement: true, raiseRate: 0.02 });

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

  it("uses CPP and OAS guides to apply one gross annual amount at the configured start age", () => {
    const workspace = createEmptyWorkspace();
    workspace.plan.incomes = [
      { id: "cpp", kind: "cpp", annualAmount: 0, startAge: 60, raiseRate: 0.02 },
      { id: "oas", kind: "oas", annualAmount: 0, startAge: 70, raiseRate: 0 },
    ];
    renderPlan(undefined, workspace);
    fireEvent.click(screen.getByRole("tab", { name: "Income" }));

    const cppCard = screen.getByRole("region", { name: "CPP summary" });
    fireEvent.click(within(cppCard).getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByText("Help estimate your CPP amount"));
    expect(screen.getByText(/if you expect to stop or reduce work before CPP starts, use an estimate that reflects that expectation/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Personal CPP monthly estimate at age 65 ($)"), { target: { value: "1000" } });
    expect(screen.getByText(/Preview: \$640\.00 per month, or \$7,680\.00 per year/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use age-65 CPP estimate × 12" }));
    expect(planState().incomes[0]).toMatchObject({ annualAmount: 7_680, startAge: 60, raiseRate: 0.02 });
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));

    const oasCard = screen.getByRole("region", { name: "OAS summary" });
    fireEvent.click(within(oasCard).getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByText("Help estimate your OAS amount"));
    fireEvent.change(screen.getByLabelText("Full OAS monthly amount at ages 65 to 74 before residence adjustment ($)"), { target: { value: "800" } });
    fireEvent.change(screen.getByLabelText("Eligible years lived in Canada after age 18"), { target: { value: "20" } });
    expect(screen.getByText(/Rough preview: \$544\.00 per month, or \$6,528\.00 per year/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use rough OAS preview × 12" }));
    expect(planState().incomes[1]).toMatchObject({ annualAmount: 6_528, startAge: 70, raiseRate: 0 });
    expect(screen.getByRole("link", { name: "official OAS amount page" }).getAttribute("href")).toBe("https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/benefit-amount.html");
    expect(screen.getByRole("link", { name: "official OAS Benefits Estimator" }).getAttribute("href")).toBe("https://estimateursv-oasestimator.service.canada.ca/en");
    expect(screen.getByText(/at least 10 years of residence if you live in Canada when you apply, or 20 years if you live outside Canada/i)).toBeTruthy();
    expect(screen.getByText(/you cannot receive GIS during the delay, and GIS does not increase.*model may still show GIS from age 65.*cost of deferring OAS is not fully modeled/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "official OAS start guidance" }).getAttribute("href")).toBe("https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/when-start.html");
    expect(screen.getByText(/does not add the separate 10% increase at 75/i)).toBeTruthy();
  });

  it("uses already-adjusted CPP and OAS amounts at post-70 ages without applying another factor", () => {
    const workspace = createEmptyWorkspace();
    workspace.plan.incomes = [
      { id: "cpp", kind: "cpp", annualAmount: 0, startAge: 75, raiseRate: 0 },
      { id: "oas", kind: "oas", annualAmount: 0, startAge: 75, raiseRate: 0 },
    ];
    renderPlan(undefined, workspace);
    fireEvent.click(screen.getByRole("tab", { name: "Income" }));
    const cppCard = screen.getByRole("region", { name: "CPP summary" });
    fireEvent.click(within(cppCard).getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByText("Help estimate your CPP amount"));
    fireEvent.change(screen.getByLabelText("Personal CPP monthly estimate at age 65 ($)"), { target: { value: "1000" } });
    expect((screen.getByRole("button", { name: "Use age-65 CPP estimate × 12" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/use the already-adjusted amount method above/i)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Current or personal CPP monthly amount for this Start age ($)"), { target: { value: "1200" } });
    const cppDirectApply = screen.getByRole("button", { name: "Use adjusted CPP amount × 12" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Start age"), { target: { value: "59" } });
    expect(cppDirectApply.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Start age"), { target: { value: "60" } });
    expect(cppDirectApply.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Start age"), { target: { value: "75" } });
    fireEvent.click(cppDirectApply);
    expect(planState().incomes[0]).toMatchObject({ annualAmount: 14_400, startAge: 75 });
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));

    const oasCard = screen.getByRole("region", { name: "OAS summary" });
    fireEvent.click(within(oasCard).getByRole("button", { name: "Edit" }));
    fireEvent.click(screen.getByText("Help estimate your OAS amount"));
    fireEvent.change(screen.getByLabelText("Full OAS monthly amount at ages 65 to 74 before residence adjustment ($)"), { target: { value: "800" } });
    fireEvent.change(screen.getByLabelText("Eligible years lived in Canada after age 18"), { target: { value: "40" } });
    expect((screen.getByRole("button", { name: "Use rough OAS preview × 12" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Current or personal OAS monthly amount for this Start age ($)"), { target: { value: "600" } });
    const oasDirectApply = screen.getByRole("button", { name: "Use adjusted OAS amount × 12" }) as HTMLButtonElement;
    fireEvent.change(screen.getByLabelText("Start age"), { target: { value: "64" } });
    expect(oasDirectApply.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Start age"), { target: { value: "65" } });
    expect(oasDirectApply.disabled).toBe(false);
    fireEvent.change(screen.getByLabelText("Start age"), { target: { value: "75" } });
    fireEvent.click(oasDirectApply);
    expect(planState().incomes[1]).toMatchObject({ annualAmount: 7_200, startAge: 75 });
    expect(screen.getByText(/If you enter a current payment at 75 or older, it will not add another age adjustment/i)).toBeTruthy();
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

  it("edits the saved base age from the Plan and passes it to a new projection", async () => {
    const workspace = createEmptyWorkspace();
    workspace.baseScenario = { ...DEFAULT_SCENARIO_BASE, retirementAge: 67, withdrawalStrategy: "tax-minimizing" };
    workspace.plan.incomes = [
      { id: "linked", name: "Main salary", kind: "employment", annualAmount: 50_000, startAge: 45, endAtRetirement: true, raiseRate: 0 },
      { id: "fixed", name: "Part-time salary", kind: "employment", annualAmount: 5_000, startAge: 45, endAge: 67, raiseRate: 0 },
    ];
    let result: SimulationResult | undefined;
    const run: SimulationRunner = async (plan, scenario) => {
      const { currentAge, endAge } = plan.profile;
      result = simulate(plan, scenario, buildDeterministicReturns(scenario.returnAssumptions, currentAge, endAge));
      return { result };
    };
    renderPlan(run, workspace);
    expect(screen.getByText("Tax-minimizing planning")).toBeTruthy();
    const retirementAge = screen.getByLabelText("Retirement age") as HTMLInputElement;
    expect(retirementAge.value).toBe("67");
    fireEvent.change(retirementAge, { target: { value: "62" } });
    expect(screen.getByTestId("saved-retirement-age").textContent).toBe("62");
    expect(planState().profile).not.toHaveProperty("retirementAge");
    fireEvent.change(retirementAge, { target: { value: "62.5" } });
    expect(screen.getByRole("alert").textContent).toContain("Retirement age must be a whole number.");
    expect(screen.getByTestId("saved-retirement-age").textContent).toBe("62");
    fireEvent.click(screen.getByRole("button", { name: "Run projection" }));
    await waitFor(() => expect(result?.years.find(year => year.events.includes("retirement"))?.age).toBe(62));
    expect(result?.years.find(year => year.age === 61)?.income.employment).toBe(55_000);
    expect(result?.years.find(year => year.age === 62)?.income.employment).toBe(5_000);

    fireEvent.click(screen.getByRole("tab", { name: "Income" }));
    const linked = screen.getByRole("region", { name: "Main salary summary" });
    expect(linked.textContent).toContain("Until retirement");
    expect(linked.textContent).toContain("45–61");
    const fixed = screen.getByRole("region", { name: "Part-time salary summary" });
    expect(fixed.textContent).toContain("Fixed end age");
    expect(fixed.textContent).toContain("45–67");
  });

  it("switches between fixed and linked salary, clearing each incompatible stored field", () => {
    const workspace = createEmptyWorkspace();
    workspace.plan.incomes = [{ id: "salary", kind: "employment", annualAmount: 50_000, startAge: 45, endAge: 67, raiseRate: 0 }];
    renderPlan(undefined, workspace);
    expect(screen.getByText("Manual account order")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Income" }));
    fireEvent.click(within(screen.getByRole("region", { name: "Employment summary" })).getByRole("button", { name: "Edit" }));
    const untilRetirement = screen.getByRole("checkbox", { name: "Until retirement" }) as HTMLInputElement;
    expect(untilRetirement.checked).toBe(false);
    fireEvent.click(untilRetirement);
    expect(planState().incomes[0]).toMatchObject({ endAtRetirement: true });
    expect(planState().incomes[0]).not.toHaveProperty("endAge");
    expect(screen.queryByLabelText(/End age/)).toBeNull();
    fireEvent.click(untilRetirement);
    expect((screen.getByLabelText(/End age/) as HTMLInputElement).value).toBe("67");
    expect(planState().incomes[0]).toMatchObject({ endAge: 67 });
    expect(planState().incomes[0]).not.toHaveProperty("endAtRetirement");
    fireEvent.click(untilRetirement);
    fireEvent.change(screen.getByLabelText("Income type"), { target: { value: "cpp" } });
    expect(screen.queryByRole("checkbox", { name: "Until retirement" })).toBeNull();
    expect(planState().incomes[0]).toMatchObject({ kind: "cpp" });
    expect(planState().incomes[0]).not.toHaveProperty("endAtRetirement");
    expect(planState().incomes[0]).not.toHaveProperty("endAge");
  });

  describe("employment bonus percentage", () => {
    function salaryWorkspace() {
      const workspace = createEmptyWorkspace();
      workspace.plan.incomes = [
        { id: "salary", name: "Day job", kind: "employment", annualAmount: 95_000, startAge: 45, endAge: 64, raiseRate: 0.02 },
      ];
      return workspace;
    }

    function openSalaryEditor() {
      fireEvent.click(screen.getByRole("tab", { name: "Income" }));
      const card = screen.getByRole("region", { name: "Day job summary" });
      fireEvent.click(within(card).getByRole("button", { name: "Edit" }));
    }

    it("applies a typed percentage while typing, with no arbitrary 100% cap", () => {
      renderPlan(undefined, salaryWorkspace());
      openSalaryEditor();
      fireEvent.change(screen.getByLabelText(/Annual bonus/), { target: { value: "1" } });
      expect(planState().incomes[0]?.bonusRate).toBe(0.01);
      fireEvent.change(screen.getByLabelText(/Annual bonus/), { target: { value: "10" } });
      expect(planState().incomes[0]?.bonusRate).toBe(0.1);
      fireEvent.change(screen.getByLabelText(/Annual bonus/), { target: { value: "150" } });
      expect(planState().incomes[0]?.bonusRate).toBe(1.5);
    });

    it("previews the starting annual pay while editing and on the read card", () => {
      renderPlan(undefined, salaryWorkspace());
      openSalaryEditor();
      fireEvent.change(screen.getByLabelText(/Annual bonus/), { target: { value: "10" } });
      const preview = screen.getByText(/Starting annual pay/i);
      expect(preview.textContent).toMatch(/\$9,500/);
      expect(preview.textContent).toMatch(/\$104,500/);
      fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
      const card = screen.getByRole("region", { name: "Day job summary" });
      expect(card.textContent).toContain("Annual bonus");
      expect(card.textContent).toContain("10.0%");
      expect(card.textContent).toContain("Starting annual pay");
      expect(card.textContent).toContain("$104,500");
    });

    it("reopens a stored fraction as clean percent text (0.07 shows 7, not float noise)", () => {
      const workspace = salaryWorkspace();
      workspace.plan.incomes = [{ ...workspace.plan.incomes[0]!, bonusRate: 0.07 }];
      renderPlan(undefined, workspace);
      openSalaryEditor();
      expect((screen.getByLabelText(/Annual bonus/) as HTMLInputElement).value).toBe("7");
      fireEvent.change(screen.getByLabelText(/Annual bonus/), { target: { value: "7" } });
      expect(planState().incomes[0]?.bonusRate).toBe(0.07);
    });

    it("rejects negative bonus values without touching the store", () => {
      renderPlan(undefined, salaryWorkspace());
      openSalaryEditor();
      fireEvent.change(screen.getByLabelText(/Annual bonus/), { target: { value: "10" } });
      expect(planState().incomes[0]?.bonusRate).toBe(0.1);
      fireEvent.change(screen.getByLabelText(/Annual bonus/), { target: { value: "-5" } });
      expect(screen.getByText(/not applied/i)).toBeTruthy();
      expect(planState().incomes[0]?.bonusRate).toBe(0.1);
    });

    it("treats pasted non-numeric text as invalid, never as an intentional blank", () => {
      // NumberTextInput's cleaning strips letters, so pasting "NaN" must reach the
      // field as raw invalid text (opt-in) instead of collapsing to "" — otherwise
      // a garbage paste would silently wipe the stored bonus. A deliberate blank
      // still clears it via the explicit unset.
      const workspace = salaryWorkspace();
      workspace.plan.incomes = [{ ...workspace.plan.incomes[0]!, bonusRate: 0.1 }];
      renderPlan(undefined, workspace);
      openSalaryEditor();
      fireEvent.change(screen.getByLabelText(/Annual bonus/), { target: { value: "NaN" } });
      expect((screen.getByLabelText(/Annual bonus/) as HTMLInputElement).value).toBe("NaN");
      expect(screen.getByText(/not applied/i)).toBeTruthy();
      expect(planState().incomes[0]?.bonusRate).toBe(0.1);
      fireEvent.change(screen.getByLabelText(/Annual bonus/), { target: { value: "" } });
      expect("bonusRate" in planState().incomes[0]!).toBe(false);
    });

    it("clears the stored bonus when the field is blanked (explicit unset, not retained)", () => {
      const workspace = salaryWorkspace();
      workspace.plan.incomes = [{ ...workspace.plan.incomes[0]!, bonusRate: 0.1 }];
      renderPlan(undefined, workspace);
      openSalaryEditor();
      expect((screen.getByLabelText(/Annual bonus/) as HTMLInputElement).value).toBe("10");
      fireEvent.change(screen.getByLabelText(/Annual bonus/), { target: { value: "" } });
      expect("bonusRate" in planState().incomes[0]!).toBe(false);
    });

    it("clears the stored bonus when the kind changes away from employment and shows no bonus field for other kinds", () => {
      const workspace = salaryWorkspace();
      workspace.plan.incomes = [{ ...workspace.plan.incomes[0]!, bonusRate: 0.1 }];
      renderPlan(undefined, workspace);
      openSalaryEditor();
      fireEvent.change(screen.getByLabelText("Income type"), { target: { value: "other" } });
      expect(screen.queryByLabelText(/Annual bonus/)).toBeNull();
      const stored = planState().incomes[0]!;
      expect(stored.kind).toBe("other");
      expect("bonusRate" in stored).toBe(false);
      // The plan stays valid after the switch — no stale salary-only field lingers.
      expect(screen.queryByText(/not applied/i)).toBeNull();
      fireEvent.change(screen.getByLabelText("Income type"), { target: { value: "employment" } });
      expect((screen.getByLabelText(/Annual bonus/) as HTMLInputElement).value).toBe("");
      expect(planState().incomes[0]?.bonusRate).toBeUndefined();
    });

    it("leaves legacy employment incomes without a bonus untouched and adds none by default", () => {
      renderPlan(undefined, salaryWorkspace());
      openSalaryEditor();
      const bonusInput = screen.getByLabelText(/Annual bonus/) as HTMLInputElement;
      expect(bonusInput.value).toBe("");
      fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
      expect("bonusRate" in planState().incomes[0]!).toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "Add employment" }));
      expect("bonusRate" in planState().incomes[1]!).toBe(false);
      expect(planState().incomes[1]).toMatchObject({ kind: "employment", raiseRate: 0.02 });
    });
  });
});
