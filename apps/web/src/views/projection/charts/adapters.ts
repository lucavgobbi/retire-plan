import type { YearResult } from "@retire-plan/engine";

/** Chart adapters: charts never touch YearResult internals directly (plan Task 7). */

export interface XyPoint {
  x: number;
  y: number | null;
}

/** Drops non-finite values to null points (charts never see NaN). */
export function dropNonFinite(points: XyPoint[]): XyPoint[] {
  return points.map((p) => (Number.isFinite(p.y) ? p : { x: p.x, y: null }));
}

const totalIncome = (year: YearResult): number =>
  year.income.employment + year.income.cpp + year.income.oas + year.income.gis + year.income.other + (year.cashInterest ?? 0);

export function netWorthSeries(years: YearResult[]): XyPoint[] {
  return dropNonFinite(years.map((y) => ({ x: y.age, y: y.netWorth })));
}

export function incomeSpendSeries(years: YearResult[]): { x: number; income: number; expenses: number; shortfall: number }[] {
  return years.map((y) => ({
    x: y.age,
    income: totalIncome(y),
    expenses: y.expenses,
    shortfall: y.shortfall,
  }));
}

export function taxStackSeries(years: YearResult[]): { x: number; federal: number; provincial: number; surtax: number; oasClawback: number; total: number }[] {
  return years.map((y) => ({
    x: y.age,
    federal: y.tax.federal,
    provincial: y.tax.provincial,
    surtax: y.tax.surtax,
    oasClawback: y.tax.oasClawback,
    total: y.tax.total,
  }));
}

export function drawdownSeries(years: YearResult[]): { x: number; tfsa: number; rrsp: number; nonreg: number; cash: number; otherAssets: number }[] {
  return years.map((y) => ({
    x: y.age,
    tfsa: y.balances.tfsa,
    rrsp: y.balances.rrsp,
    nonreg: y.balances.nonreg,
    cash: y.balances.cash,
    /** `otherAssets` is an optional result field — normalize to 0 for stacking. */
    otherAssets: y.balances.otherAssets ?? 0,
  }));
}
