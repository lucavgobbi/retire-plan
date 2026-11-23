import type { YearResult } from "@retire-plan/engine";
import { fmtMoneyDetail } from "./fmt";

/** Informational explanations derived only from fields saved on this year result. */
export function yearNotices(
  year: YearResult,
  historicalContext?: { householdCalendarYear: number; returnSourceYear: number },
): string[] {
  const notices: string[] = [];
  const minimum = year.rrifMinimumWithdrawal;
  const employerContribution = year.cashflow?.employerRrspContribution ?? 0;
  const employmentPersonal = year.cashflow?.employmentRrspPersonal ?? 0;
  const employerMatch = year.cashflow?.employerRrspMatch ?? 0;
  const blockedEmployerContribution = year.cashflow?.blockedEmployerRrspContribution ?? 0;

  if (minimum !== undefined && minimum > 0) {
    notices.push(
      `Required RRIF minimum: ${fmtMoneyDetail(minimum)}. This draw is required even when spending needs are lower.`,
    );
    const extraRrspWithdrawal = Math.max(0, year.withdrawals.rrsp - minimum);
    if (extraRrspWithdrawal > 0.005) {
      notices.push(
        `Additional RRSP/RRIF withdrawal above the required minimum: ${fmtMoneyDetail(extraRrspWithdrawal)}.`,
      );
    }
  }
  if ((year.plannedRrspDraw ?? 0) > 0.005) {
    notices.push(
      `Planned voluntary RRSP draw under the tax-minimizing strategy: ${fmtMoneyDetail(year.plannedRrspDraw!)}. It is separate from any required RRIF minimum and is included in total RRSP withdrawals.`,
    );
    notices.push(
      "Ordinary personal RRSP savings steps are skipped in a planned-draw year. Employment deposits use net wages calculated before withdrawals. A legacy savings match can use after-tax surplus available before the planned draw when no company deposit from an employment RRSP setup overlaps.",
    );
  }

  if (Math.abs(year.cashInterest ?? 0) > 0.005) {
    notices.push(
      `Named cash-account interest for the year: ${fmtMoneyDetail(year.cashInterest!)}. This is shown separately from other income, its tax effect is included in the tax totals, and the fixed rate applies to opening balances before annual cash flows. It is independent of the selected market-return mode.`,
    );
  }

  if ((year.withdrawals.cash ?? 0) > 0.005) {
    notices.push(`Cash-account withdrawals: ${fmtMoneyDetail(year.withdrawals.cash!)}.`);
  }

  const contributions = year.contributions;
  const personalRrsp =
    Math.round((contributions.rrsp - employmentPersonal - employerContribution - employerMatch) * 100) / 100;
  if (contributions.tfsa > 0 || personalRrsp > 0 || contributions.nonreg > 0 || (contributions.cash ?? 0) > 0) {
    const action = year.income.employment === 0 ? "reinvested" : "allocated to savings";
    notices.push(
      `After spending, tax, and scheduled mortgage payments, surplus cash was ${action}: TFSA ${fmtMoneyDetail(contributions.tfsa)}, personal RRSP ${fmtMoneyDetail(personalRrsp)}, non-registered ${fmtMoneyDetail(contributions.nonreg)}, cash accounts ${fmtMoneyDetail(contributions.cash ?? 0)}. The result does not track each dollar's source.`,
    );
    if (year.income.employment === 0) notices.push("This year had no employment income.");
  }

  if (employmentPersonal > 0) {
    notices.push(
      `Your employment RRSP deposit of ${fmtMoneyDetail(employmentPersonal)} came from net wages before household expenses and reduced taxable income.`,
    );
  }
  if (employerContribution > 0) {
    notices.push(
      `The company deposited ${fmtMoneyDetail(employerContribution)} directly into the RRSP. The amount is included in total RRSP contributions.`,
    );
  }
  if (employerMatch > 0) {
    notices.push(
      `The employer deposited a ${fmtMoneyDetail(employerMatch)} match directly into the RRSP based on personal deposits. The amount is included in total RRSP contributions.`,
    );
  }
  if (blockedEmployerContribution > 0) {
    notices.push(
      `${fmtMoneyDetail(blockedEmployerContribution)} of the company RRSP contribution could not be deposited. Deposits are subject to RRSP age eligibility, available room and a valid RRSP destination.`,
    );
  }

  if (year.balances.cash > 0.005) {
    notices.push(
      year.cashAccounts === undefined
        ? `Cash remaining at year end: ${fmtMoneyDetail(year.balances.cash)}.`
        : `Total cash at year end across named accounts and the idle cash reserve: ${fmtMoneyDetail(year.balances.cash)}.`,
    );
  }

  if (year.savings.mortgage > 0.005) {
    notices.push(
      year.balances.debt <= 0.005
        ? `A mortgage prepayment of ${fmtMoneyDetail(year.savings.mortgage)} left no mortgage debt at year end.`
        : `Mortgage prepayment recorded: ${fmtMoneyDetail(year.savings.mortgage)}.`,
    );
  }

  if (year.shortfall > 0.005) {
    notices.push(
      `Unfunded shortfall after the model's available income, cash, and withdrawals: ${fmtMoneyDetail(year.shortfall)}.`,
    );
  }

  if (historicalContext) {
    notices.push(
      `Household calendar year ${historicalContext.householdCalendarYear} uses historical return source year ${historicalContext.returnSourceYear}.`,
    );
  }

  if (year.events.includes("retirement")) {
    notices.push(
      "The plan's configured retirement age is reached this year. Employment RRSP deposits follow the employment schedule. Other income streams and savings rules follow their own schedules.",
    );
  }
  if (year.events.includes("cpp-start")) {
    notices.push(`CPP income starts this year: ${fmtMoneyDetail(year.income.cpp)}.`);
  }
  if (year.events.includes("oas-start")) {
    notices.push(`OAS income starts this year: ${fmtMoneyDetail(year.income.oas)}.`);
  }
  if (year.events.includes("home-sold")) {
    notices.push(
      "A home sale is recorded this year. Any net sale proceeds were added to available assets or cash; sale proceeds, costs, and the gain amount are not itemized here, though its tax effect is included.",
    );
  }
  if (year.events.includes("other-asset-sold")) {
    notices.push(
      "An asset sale is recorded this year. Any net sale proceeds were added to available assets or cash; sale proceeds, costs, and the gain amount are not itemized here, though its tax effect is included.",
    );
  }

  if (year.withdrawals.nonreg > 0.005) {
    notices.push(
      "Non-registered withdrawals show the full cash drawn. Under the model, only the realized-gain portion, if any, affects taxable income; that portion is not shown in this year detail.",
    );
  }

  const depleted: string[] = [];
  if (year.withdrawals.tfsa > 0.005 && year.balances.tfsa <= 0.005) depleted.push("TFSA");
  if (year.withdrawals.rrsp > 0.005 && year.balances.rrsp <= 0.005) depleted.push("RRSP/RRIF");
  if (year.withdrawals.nonreg > 0.005 && year.balances.nonreg <= 0.005) depleted.push("non-registered");
  if (depleted.length > 0) {
    notices.push(
      `${depleted.join(", ")} balance${depleted.length === 1 ? " was" : "s were"} depleted to $0 by year end after withdrawals.`,
    );
  }

  if (year.warnings.some((warning) => warning.toLowerCase().includes("negative amortization"))) {
    notices.push(
      "Negative amortization means the mortgage balance grew because payments did not cover accruing interest.",
    );
  }

  return notices;
}
