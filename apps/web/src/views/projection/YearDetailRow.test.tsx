import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { YearResult } from "@retire-plan/engine";
import { YearDetailRow } from "./YearDetailRow";
import { yearNotices } from "./yearNotices";

const baseYear = (): YearResult => ({
  age: 65,
  income: { employment: 0, cpp: 0, oas: 0, gis: 0, other: 0 },
  taxableIncome: 0,
  tax: { federal: 0, provincial: 0, surtax: 0, oasClawback: 0, total: 0, marginalRate: 0 },
  withdrawals: { tfsa: 0, rrsp: 0, nonreg: 0 },
  contributions: { tfsa: 0, rrsp: 0, nonreg: 0 },
  savings: { tfsa: 0, rrsp: 0, nonreg: 0, mortgage: 0 },
  expenses: 0,
  shortfall: 0,
  balances: { tfsa: 0, rrsp: 0, nonreg: 0, cash: 0, home: 0, debt: 0 },
  netWorth: 0,
  tfsaRoom: 0,
  rrspRoom: 0,
  events: [],
  warnings: [],
});

describe("YearDetailRow legacy RRIF results", () => {
  it("does not infer a mandatory minimum from legacy total withdrawals", () => {
    // Older saved results have RRSP withdrawals but no actual-minimum metadata.
    const year: YearResult = {
      age: 71,
      income: { employment: 0, cpp: 0, oas: 0, gis: 0, other: 0 },
      taxableIncome: 80_000,
      tax: { federal: 0, provincial: 0, surtax: 0, oasClawback: 0, total: 0, marginalRate: 0 },
      withdrawals: { tfsa: 0, rrsp: 80_000, nonreg: 0 },
      contributions: { tfsa: 7_000, rrsp: 0, nonreg: 6_000 },
      savings: { tfsa: 7_000, rrsp: 0, nonreg: 6_000, mortgage: 0 },
      expenses: 60_000,
      shortfall: 0,
      balances: { tfsa: 7_000, rrsp: 0, nonreg: 6_000, cash: 0, home: 0, debt: 0 },
      netWorth: 13_000,
      tfsaRoom: 0,
      rrspRoom: 0,
      events: [],
      warnings: [],
    };
    const { container } = render(
      <table>
        <tbody>
          <YearDetailRow age={71} year={year} expanded groupExpanded colSpan={10} />
        </tbody>
      </table>,
    );

    const warnings = container.querySelector('[aria-label="Warnings"]')!;
    expect(warnings.textContent).toContain("No warnings");
    expect(warnings.querySelector(".detail-notices")?.textContent).toContain("surplus cash was reinvested");
    expect(warnings.textContent).not.toContain("Required RRIF minimum");
    expect(warnings.textContent).not.toContain("Ordinary personal RRSP savings steps are skipped");
  });

  it("explains required minimum separately from additional RRSP/RRIF withdrawals", () => {
    const year = { ...baseYear(), age: 72, rrifMinimumWithdrawal: 10_000 };
    year.withdrawals.rrsp = 25_000;
    const notices = yearNotices(year).join(" ");
    expect(notices).toContain("Required RRIF minimum: $10,000.00");
    expect(notices).toContain("Additional RRSP/RRIF withdrawal above the required minimum: $15,000.00");
    expect(notices).not.toContain("total RRSP withdrawal equals");
  });

  it("explains a planned proactive RRSP draw without confusing it with the mandatory minimum", () => {
    const year = { ...baseYear(), rrifMinimumWithdrawal: 10_000, plannedRrspDraw: 15_000 };
    year.withdrawals.rrsp = 30_000;
    const notices = yearNotices(year).join(" ");
    expect(notices).toContain("Required RRIF minimum: $10,000.00");
    expect(notices).toContain("Additional RRSP/RRIF withdrawal above the required minimum: $20,000.00");
    expect(notices).toContain("Planned voluntary RRSP draw under the tax-minimizing strategy: $15,000.00");
    expect(notices).toContain("included in total RRSP withdrawals");
    expect(notices).toContain("Ordinary personal RRSP savings steps are skipped");
    expect(notices).toContain(
      "earn an employer match using after-tax household surplus calculated before the planned draw",
    );
    expect(notices).toContain("Independent company RRSP contributions continue");
  });

  it("explains surplus allocation without attributing all deposits to RRIF withdrawals", () => {
    const year = baseYear();
    year.income.employment = 0;
    year.withdrawals.rrsp = 40_000;
    year.contributions.tfsa = 7_000;
    year.contributions.nonreg = 5_000;
    const notices = yearNotices(year).join(" ");
    expect(notices).toContain("After spending, tax, and scheduled mortgage payments, surplus cash was reinvested:");
    expect(notices).toContain("This year had no employment income.");
    expect(notices).toContain("does not track each dollar's source");
    expect(notices).not.toContain("all from RRIF");
  });

  it("shows company deposits and match inside named account contributions and outside surplus savings", () => {
    const year = baseYear();
    year.income = { ...year.income, employment: 45_000, other: 1_030 };
    year.contributions.rrsp = 1_000;
    year.payroll = { cppBase: 100, cppAdditional: 0, cpp2: 0, ei: 0, eiRefund: 0, enhancedCppDeduction: 0, total: 100 };
    year.cashflow = {
      scheduledMortgagePayment: 0,
      openingIdleCash: 0,
      closingIdleCash: 0,
      assetSaleToIdleCash: 0,
      assetSaleToNonreg: 0,
      employerRrspMatch: 100,
      employerRrspContribution: 700,
      blockedEmployerRrspContribution: 50,
      cashContributionsToIdleCash: 0,
    };
    year.accountBreakdown = [
      {
        id: "work",
        name: "Work RRSP",
        type: "rrsp",
        openingBalance: 0,
        closingBalance: 1_000,
        withdrawals: 0,
        contributions: 1_000,
        employerRrspContribution: 700,
        employerRrspMatch: 100,
      },
    ];
    render(
      <table>
        <tbody>
          <YearDetailRow age={65} year={year} expanded colSpan={10} />
        </tbody>
      </table>,
    );
    const account = within(screen.getByRole("list", { name: "Account details" }));
    expect(account.getByText("Work RRSP")).toBeTruthy();
    expect(account.getByText("Contributions").nextElementSibling?.textContent).toBe("$1,000.00");
    expect(account.getByText("Personal RRSP deposits within contributions").nextElementSibling?.textContent).toBe(
      "$200.00",
    );
    expect(account.getByText("Company RRSP contribution within contributions").nextElementSibling?.textContent).toBe(
      "$700.00",
    );
    expect(account.getByText("Employer match within contributions").nextElementSibling?.textContent).toBe("$100.00");
    const income = within(screen.getByRole("region", { name: "Income" }));
    expect(income.getByText("Other income").nextElementSibling?.textContent).toBe("$230.00");
    const payroll = within(screen.getByRole("region", { name: "Payroll deductions" }));
    expect(payroll.getByText("Cash employment income").nextElementSibling?.textContent).toBe("$45,000.00");
    expect(payroll.getByText(/In new projections, company RRSP contributions and employer matches count/)).toBeTruthy();
    const notices = screen.getByRole("note", { name: "Year cashflow explanations" });
    expect(notices.textContent).toContain("personal RRSP $200.00");
    expect(notices.textContent).toContain("$50.00 of the company RRSP contribution could not be deposited");

    year.contributions.rrsp = 800;
    expect(yearNotices(year).join(" ")).not.toContain("surplus cash");
  });

  it("splits aggregate RRSP deposits with cashflow capture and reconciles Other income to zero cents", () => {
    const year = baseYear();
    year.income.other = 0.3;
    year.savings.rrsp = 0.35;
    year.contributions.rrsp = 0.35;
    year.cashflow = {
      scheduledMortgagePayment: 0,
      openingIdleCash: 0,
      closingIdleCash: 0,
      assetSaleToIdleCash: 0,
      assetSaleToNonreg: 0,
      employerRrspMatch: 0.2,
      employerRrspContribution: 0.1,
      cashContributionsToIdleCash: 0,
    };
    render(
      <table>
        <tbody>
          <YearDetailRow age={65} year={year} expanded colSpan={10} />
        </tbody>
      </table>,
    );
    const savings = within(screen.getByRole("region", { name: "Savings flows" }));
    expect(savings.getByText("RRSP").nextElementSibling?.textContent).toBe("$0.35");
    expect(savings.getByText("Personal RRSP deposits within contributions").nextElementSibling?.textContent).toBe(
      "$0.05",
    );
    expect(savings.getByText("Company RRSP contribution within contributions").nextElementSibling?.textContent).toBe(
      "$0.10",
    );
    expect(savings.getByText("Employer match within contributions").nextElementSibling?.textContent).toBe("$0.20");
    const income = within(screen.getByRole("region", { name: "Income" }));
    expect(income.getByText("Other income").nextElementSibling?.textContent).toBe("$0.00");
  });

  it("explains recorded transitions, sales, non-registered draws, retained cash and depletion", () => {
    const year = baseYear();
    year.events = ["retirement", "cpp-start", "oas-start", "home-sold", "other-asset-sold"];
    year.income.cpp = 9_000;
    year.income.oas = 8_000;
    year.withdrawals.nonreg = 12_000;
    year.balances.cash = 2_000;
    const notices = yearNotices(year).join(" ");
    expect(notices).toContain("configured retirement age is reached");
    expect(notices).toContain("CPP income starts this year: $9,000.00");
    expect(notices).toContain("OAS income starts this year: $8,000.00");
    expect(notices).toContain("A home sale is recorded");
    expect(notices).toContain("An asset sale is recorded");
    expect(notices).toContain("though its tax effect is included");
    expect(notices).toContain("only the realized-gain portion, if any");
    expect(notices).toContain("Cash remaining at year end");
  });

  it("explains mortgage payoff, shortfall, negative amortization and depleted accounts", () => {
    const year = baseYear();
    year.savings.mortgage = 3_000;
    year.balances.debt = 0;
    year.withdrawals.tfsa = 4_000;
    year.withdrawals.rrsp = 2_000;
    year.withdrawals.nonreg = 1_000;
    year.shortfall = 500;
    year.warnings = ["negative amortization: mortgage payment does not cover interest; balance grows"];
    const { container } = render(
      <table>
        <tbody>
          <YearDetailRow age={65} year={year} expanded groupExpanded colSpan={10} />
        </tbody>
      </table>,
    );
    const warnings = container.querySelector('[aria-label="Warnings"]')!;
    expect(warnings.textContent).toContain("mortgage prepayment of $3,000.00 left no mortgage debt");
    expect(warnings.textContent).toContain("Unfunded shortfall");
    expect(warnings.textContent).toContain("TFSA, RRSP/RRIF, non-registered balances were depleted");
    expect(warnings.textContent).toContain("negative amortization: mortgage payment");
    expect(warnings.querySelectorAll("li")).toHaveLength(1); // notices do not change engine warning counts
  });
});
