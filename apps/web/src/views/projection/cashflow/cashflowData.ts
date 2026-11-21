import type { YearResult } from "@retire-plan/engine";
import { yearForAge } from "../fmt";

export interface CashflowRange {
  startYear: number;
  endYear: number;
}

type Side = "sources" | "uses";
export type FlowKind = "income" | "transfer" | "expense" | "tax" | "debt" | "cash" | "adjustment";
type FlowSpec = readonly [id: string, label: string, kind: FlowKind, amount: number];

export interface CashflowAmount {
  id: string;
  label: string;
  kind: FlowKind;
  cents: number;
}

const toCents = (amount: number) => Math.round(amount * 100);
const reversals = (flows: FlowSpec[]) => flows.flatMap(([id, label, kind, amount]): FlowSpec[] =>
  amount < 0 ? [[`${id}-reversal`, `${label} reversal`, kind, -amount]] : []);
const noCapture: NonNullable<YearResult["cashflow"]> = {
  scheduledMortgagePayment: 0,
  openingIdleCash: 0,
  closingIdleCash: 0,
  assetSaleToIdleCash: 0,
  assetSaleToNonreg: 0,
  employerRrspMatch: 0,
  cashContributionsToIdleCash: 0,
};

export function cashflowYears(years: YearResult[], birthYear: number): number[] {
  return [...new Set(years.map(({ age }) => yearForAge(birthYear, age)).filter(Number.isSafeInteger))].sort((a, b) => a - b);
}

/** Aggregate recorded transfers through one pool without assigning individual sources to uses. */
export function aggregateCashflow(years: YearResult[], birthYear: number, range: CashflowRange) {
  const rows = years.map((row) => ({ row, year: yearForAge(birthYear, row.age) }))
    .filter(({ year }) => year >= range.startYear && year <= range.endYear)
    .sort((a, b) => a.year - b.year);
  const sides = { sources: new Map<string, CashflowAmount>(), uses: new Map<string, CashflowAmount>() };
  const obligations = new Map<string, CashflowAmount>();
  let legacyYears = 0;
  let missingPayrollYears = 0;
  let unavailableYears = 0;
  let assetSaleToNonreg = 0;
  let cashContributionsToIdleCash = 0;
  let employerRrspMatch = 0;
  let shortfallCents = 0;
  let unknownCoverageYears = 0;
  let unreconciledSourceCents = 0;
  let unreconciledUseCents = 0;

  function add(side: Side, [id, label, kind, amount]: FlowSpec, recordObligation = false) {
    const cents = toCents(amount);
    if (cents === 0) return;
    const target = cents > 0 ? side : side === "sources" ? "uses" : "sources";
    const key = cents > 0 ? id : `${id}-reversal`;
    const items = recordObligation ? obligations : sides[target];
    const previous = items.get(key)?.cents ?? 0;
    items.set(key, { id: key, label: cents > 0 ? label : `${label} reversal`, kind, cents: previous + Math.abs(cents) });
  }

  const entries = rows.map(({ row, year }) => {
    const capture = row.cashflow;
    const captured = capture ?? noCapture;
    const { income, withdrawals, contributions, savings, payroll } = row;
    const recordedSources: FlowSpec[] = [
      ["employment", "Employment", "income", income.employment],
      ["cpp", "CPP", "income", income.cpp],
      ["oas", "OAS", "income", income.oas],
      ["gis", "GIS", "income", income.gis],
      [capture ? "other" : "legacy-other", capture ? "Other income" : "Other income (saved total)", "income", income.other - captured.employerRrspMatch],
      ["tfsa-withdrawal", "TFSA withdrawals", "transfer", withdrawals.tfsa],
      ["rrsp-withdrawal", "RRSP / RRIF withdrawals", "transfer", withdrawals.rrsp],
      ["nonreg-withdrawal", "Non-registered withdrawals", "transfer", withdrawals.nonreg],
      ["cash-withdrawal", "Cash account withdrawals", "transfer", withdrawals.cash ?? 0],
      ["asset-sales", "Asset sales to idle cash", "cash", captured.assetSaleToIdleCash],
    ];
    const recordedBills: FlowSpec[] = [
      ["expenses", "Modeled expenses", "expense", row.expenses],
      ["income-tax", "Income tax", "tax", row.tax.total],
      ["payroll", "Net payroll deductions", "tax", payroll ? payroll.total - payroll.eiRefund : 0],
      ["scheduled-mortgage", "Scheduled mortgage payments", "debt", captured.scheduledMortgagePayment],
    ];
    const sources = [...recordedSources.filter(([, , , amount]) => amount >= 0), ...reversals(recordedBills)];
    const bills = [...recordedBills.filter(([, , , amount]) => amount >= 0), ...reversals(recordedSources)];
    const uses: FlowSpec[] = [
      ["mortgage-prepay", "Mortgage prepayments", "debt", savings.mortgage],
      ["tfsa-contribution", "TFSA contributions", "transfer", contributions.tfsa],
      [capture ? "rrsp-contribution" : "legacy-rrsp-contribution", capture ? "RRSP contributions" : "RRSP deposits (saved total)", "transfer", contributions.rrsp - captured.employerRrspMatch],
      ["nonreg-contribution", "Non-registered contributions", "transfer", contributions.nonreg],
      ["cash-contribution", "Cash contributions", "transfer", (contributions.cash ?? 0) - captured.cashContributionsToIdleCash],
    ];
    const shortfall = toCents(row.shortfall);
    const valid = Number.isSafeInteger(shortfall) && shortfall >= 0
      && [...recordedSources, ...recordedBills, ...uses].every(([, , , amount]) => Number.isSafeInteger(toCents(amount)))
      && Object.values(captured).every((amount) => Number.isSafeInteger(toCents(amount)));
    return { year, capture, hasPayroll: payroll !== undefined, sources, bills, uses, shortfall, valid };
  });

  const sum = (flows: FlowSpec[]) => flows.reduce((total, [, , , amount]) => total + toCents(amount), 0);

  entries.forEach(({ year, capture, hasPayroll, sources, bills, uses, shortfall, valid }, index) => {
    if (!valid) {
      unavailableYears += 1;
      return;
    }
    sources.forEach((flow) => add("sources", flow));
    uses.forEach((flow) => add("uses", flow));
    const totalBills = sum(bills);
    shortfallCents += shortfall;
    bills.forEach((flow) => add("uses", flow, true));
    let coveredBills = totalBills;
    if (shortfall > 0) {
      // The annual gap is known. Preserve modeled bill totals in the text breakdown
      // and display their covered amount as a group so no bill gets a guessed allocation.
      if (capture && hasPayroll) {
        coveredBills = Math.max(0, totalBills - shortfall);
        add("uses", ["covered-bills", "Covered obligations", "expense", coveredBills / 100]);
      } else {
        unknownCoverageYears += 1;
        coveredBills = 0;
      }
    } else {
      bills.forEach((flow) => add("uses", flow));
    }
    if (!hasPayroll) missingPayrollYears += 1;

    if (capture) {
      assetSaleToNonreg += toCents(capture.assetSaleToNonreg);
      cashContributionsToIdleCash += toCents(capture.cashContributionsToIdleCash);
      employerRrspMatch += toCents(capture.employerRrspMatch);
      const previous = entries[index - 1];
      const next = entries[index + 1];
      // A carried balance counts only where the neighboring row cannot cancel it.
      if (!previous?.valid || previous.year !== year - 1 || previous.capture?.closingIdleCash !== capture.openingIdleCash) {
        add("sources", ["opening-cash", "Idle cash brought forward", "cash", capture.openingIdleCash]);
      }
      if (!next?.valid || next.year !== year + 1 || next.capture?.openingIdleCash !== capture.closingIdleCash) {
        add("uses", ["closing-cash", "Idle cash carried forward", "cash", capture.closingIdleCash]);
      }
    } else {
      legacyYears += 1;
    }

    const difference = sum(sources) - sum(uses) - coveredBills
      + toCents(capture?.openingIdleCash ?? 0) - toCents(capture?.closingIdleCash ?? 0);
    if (difference === 0) return;
    if (capture && hasPayroll && Math.abs(difference) <= 5) {
      add(difference > 0 ? "uses" : "sources", ["rounding", "Rounding adjustment", "adjustment", Math.abs(difference) / 100]);
    } else if (difference > 0) {
      unreconciledSourceCents += difference;
    } else {
      unreconciledUseCents -= difference;
    }
  });

  const sources = [...sides.sources.values()];
  const uses = [...sides.uses.values()];
  const sumItems = (items: CashflowAmount[]) => items.reduce((total, item) => total + item.cents, 0);
  return {
    sources, uses, obligations: [...obligations.values()],
    sourceCents: sumItems(sources), useCents: sumItems(uses), shortfallCents,
    unknownCoverageYears, unreconciledSourceCents, unreconciledUseCents,
    legacyYears, missingPayrollYears, unavailableYears,
    assetSaleToNonreg, cashContributionsToIdleCash, employerRrspMatch,
  };
}
