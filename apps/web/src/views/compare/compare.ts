import type { RunRecord, YearResult } from "../../domain/types";
import { yearForAge } from "../projection/fmt";

export const COMPARISON_COLORS = ["#2563eb", "#0f766e", "#b45309"];

export interface ComparisonColumn {
  run: RunRecord;
  label: string;
  retirementIncome: number | null;
  retirementWithdrawals: number | null;
  lifetimeTax: number | null;
  finalNetWorth: number | null;
  actualEnd: number | undefined;
  depletion: YearResult | undefined;
  hasRetirementYear: boolean;
  shortfall: YearResult | undefined;
}

function cashIncome(row: YearResult): number {
  const { employment, cpp, oas, gis, other } = row.income;
  if (row.cashflow) {
    return (
      employment +
      cpp +
      oas +
      gis +
      other -
      row.cashflow.employerRrspMatch -
      (row.cashflow.employerRrspContribution ?? 0)
    );
  }
  // Named streams capture plan income independently of employer deposits.
  if (row.incomeBreakdown) return row.incomeBreakdown.reduce((sum, item) => sum + item.amount, gis);
  return NaN;
}

function withdrawals({ withdrawals: { tfsa, rrsp, nonreg, cash } }: YearResult): number {
  return tfsa + rrsp + nonreg + (cash ?? 0);
}

function sum(rows: YearResult[], value: (row: YearResult) => number): number | null {
  const total = rows.reduce((result, row) => result + value(row), 0);
  return rows.length && Number.isFinite(total) ? total : null;
}

function average(rows: YearResult[], value: (row: YearResult) => number): number | null {
  const total = sum(rows, value);
  return total === null ? null : total / rows.length;
}

export function computeComparison(records: RunRecord[], birthYear: number, labels = new Map<string, string>()) {
  const series = records.map(
    (run) => new Map(run.result.years.map((row) => [yearForAge(run.birthYear ?? birthYear, row.age), row])),
  );
  const years = [...(series[0]?.keys() ?? [])]
    .filter((year) => series.every((path) => path.has(year)))
    .sort((a, b) => a - b);
  const start = years[0];
  const end = years.at(-1);
  const retirementStart = Math.max(
    ...records.map((run) => yearForAge(run.birthYear ?? birthYear, run.scenario.retirementAge)),
  );
  const retirementYears = years.filter((year) => year >= retirementStart);

  const columns = records.map<ComparisonColumn>((run, index) => {
    const path = series[index]!;
    const common = years.map((year) => path.get(year)!);
    const retired = retirementYears.map((year) => path.get(year)!);
    const retirement = common.filter((row) => row.age >= run.scenario.retirementAge);
    return {
      run,
      label: labels.get(run.scenarioId ?? "") ?? run.scenario.name,
      retirementIncome: average(retired, cashIncome),
      retirementWithdrawals: average(retired, withdrawals),
      lifetimeTax: sum(common, (row) => row.tax.total),
      finalNetWorth: common.at(-1)?.netWorth ?? null,
      actualEnd: [...path.keys()].at(-1),
      hasRetirementYear: retirement.length > 0,
      depletion: retirement.find(
        ({ balances }) => balances.cash + balances.tfsa + balances.rrsp + balances.nonreg <= 0,
      ),
      shortfall: common.find((row) => row.shortfall > 0),
    };
  });

  return {
    columns,
    years,
    start,
    end,
    retirementStart: retirementYears[0],
    differentHorizons: series.some((path) => path.size !== years.length),
  };
}

export type Comparison = ReturnType<typeof computeComparison>;
