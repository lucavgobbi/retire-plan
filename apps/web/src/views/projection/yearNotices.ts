import type { YearResult } from "@retire-plan/engine";
import { fmtMoneyDetail } from "./fmt";

/** Informational explanations derived only from fields saved on this year result. */
export function yearNotices(
  year: YearResult,
  historicalContext?: { householdCalendarYear: number; returnSourceYear: number },
): string[] {
  const notices: string[] = [];
  const minimum = year.rrifMinimumWithdrawal;

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
    notices.push(`Planned voluntary RRSP draw under the tax-minimizing strategy: ${fmtMoneyDetail(year.plannedRrspDraw!)}. It is separate from any required RRIF minimum and is included in total RRSP withdrawals.`);
    notices.push("In this planned-draw year, employee RRSP savings-policy steps are skipped to avoid withdrawing and redepositing the same funds. Employer-match RRSP deposits and other savings rules remain available; remaining surplus follows those rules or is retained as cash.");
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
  if (contributions.tfsa > 0 || contributions.rrsp > 0 || contributions.nonreg > 0 || (contributions.cash ?? 0) > 0) {
    if (year.income.employment === 0) {
      notices.push(
        `After spending, tax, and scheduled mortgage payments, surplus cash was reinvested: TFSA ${fmtMoneyDetail(contributions.tfsa)}; RRSP ${fmtMoneyDetail(contributions.rrsp)}; non-registered ${fmtMoneyDetail(contributions.nonreg)}; cash accounts ${fmtMoneyDetail(contributions.cash ?? 0)}. These are reinvested contributions, not new employment savings. The result does not track each dollar's source.`,
      );
    } else {
      notices.push(
        `After spending, tax, and scheduled mortgage payments, surplus cash was allocated to savings: TFSA ${fmtMoneyDetail(contributions.tfsa)}; RRSP ${fmtMoneyDetail(contributions.rrsp)}; non-registered ${fmtMoneyDetail(contributions.nonreg)}; cash accounts ${fmtMoneyDetail(contributions.cash ?? 0)}. The result does not track each dollar's source.`,
      );
    }
  }

  if (year.balances.cash > 0.005) {
    notices.push(year.cashAccounts === undefined
      ? `Cash remaining at year end: ${fmtMoneyDetail(year.balances.cash)}.`
      : `Total cash at year end across named accounts and the idle cash reserve: ${fmtMoneyDetail(year.balances.cash)}.`);
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
    notices.push(`Household calendar year ${historicalContext.householdCalendarYear} uses historical return source year ${historicalContext.returnSourceYear}.`);
  }

  if (year.events.includes("retirement")) {
    notices.push("The plan's configured retirement age is reached this year. Income streams and savings rules continue according to their own settings.");
  }
  if (year.events.includes("cpp-start")) {
    notices.push(`CPP income starts this year: ${fmtMoneyDetail(year.income.cpp)}.`);
  }
  if (year.events.includes("oas-start")) {
    notices.push(`OAS income starts this year: ${fmtMoneyDetail(year.income.oas)}.`);
  }
  if (year.events.includes("home-sold")) {
    notices.push("A home sale is recorded this year. Any net sale proceeds were added to available assets or cash; sale proceeds, costs, and the gain amount are not itemized here, though its tax effect is included.");
  }
  if (year.events.includes("other-asset-sold")) {
    notices.push("An asset sale is recorded this year. Any net sale proceeds were added to available assets or cash; sale proceeds, costs, and the gain amount are not itemized here, though its tax effect is included.");
  }

  if (year.withdrawals.nonreg > 0.005) {
    notices.push("Non-registered withdrawals show the full cash drawn. Under the model, only the realized-gain portion, if any, affects taxable income; that portion is not shown in this year detail.");
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
    notices.push("Negative amortization means the mortgage balance grew because payments did not cover accruing interest.");
  }

  return notices;
}
