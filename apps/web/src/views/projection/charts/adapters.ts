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

export interface NetWorthBarPoint {
  x: number;
  tfsa: number;
  rrsp: number;
  nonreg: number;
  cash: number;
  home: number;
  otherAssets: number;
  /** Debt is owed money: rendered as a below-zero segment, never stacked as owned. */
  debt: number;
  /** Engine net worth for the year: the stacked owned total minus debt (marker). */
  netWorth: number;
}

/**
 * Net-worth bar components, straight off the year's balances — the chart's stacked
 * total minus debt must equal `netWorth` (the engine arithmetic is only displayed,
 * never recomputed differently). Optional fields normalize to 0 for stacking.
 */
export function netWorthBarSeries(years: YearResult[]): NetWorthBarPoint[] {
  return years.map((y) => ({
    x: y.age,
    tfsa: y.balances.tfsa,
    rrsp: y.balances.rrsp,
    nonreg: y.balances.nonreg,
    cash: y.balances.cash,
    home: y.balances.home,
    otherAssets: y.balances.otherAssets ?? 0,
    debt: y.balances.debt,
    netWorth: y.netWorth,
  }));
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

/**
 * Annual income split by source. Cash interest is the TOP-LEVEL `cashInterest`
 * earned by cash accounts — deliberately NOT merged into `income.other` (which
 * carries other taxable income), so the sources never double-count.
 */
export function incomeSourcesSeries(years: YearResult[]): { x: number; employment: number; other: number; cashInterest: number; cpp: number; oas: number; gis: number }[] {
  return years.map((y) => ({
    x: y.age,
    employment: y.income.employment,
    other: y.income.other,
    cashInterest: y.cashInterest ?? 0,
    cpp: y.income.cpp,
    oas: y.income.oas,
    gis: y.income.gis,
  }));
}

export interface AccountFlowPoint {
  x: number;
  /** Money put INTO each account this year (positive magnitudes). */
  contributions: { tfsa: number; rrsp: number; nonreg: number; cash: number };
  /** Money drawn OUT of each account this year (positive magnitudes; the chart renders them below zero). */
  withdrawals: { tfsa: number; rrsp: number; nonreg: number; cash: number };
}

/** Per-account contributions and withdrawals; optional cash fields normalize to 0. */
export function accountFlowsSeries(years: YearResult[]): AccountFlowPoint[] {
  return years.map((y) => ({
    x: y.age,
    contributions: { tfsa: y.contributions.tfsa, rrsp: y.contributions.rrsp, nonreg: y.contributions.nonreg, cash: y.contributions.cash ?? 0 },
    withdrawals: { tfsa: y.withdrawals.tfsa, rrsp: y.withdrawals.rrsp, nonreg: y.withdrawals.nonreg, cash: y.withdrawals.cash ?? 0 },
  }));
}

/** Remaining TFSA/RRSP contribution headroom; 0 means the room is used up. */
export function contributionRoomSeries(years: YearResult[]): { x: number; tfsaRoom: number; rrspRoom: number }[] {
  return years.map((y) => ({ x: y.age, tfsaRoom: y.tfsaRoom, rrspRoom: y.rrspRoom }));
}

// ---- Spending breakdown (per expense item) ----

export interface ExpenseBreakdownSeries {
  /** Expense items in first-seen (plan) order; stable per-item colours key off this list. */
  items: { id: string; name: string }[];
  /**
   * One point per age; amounts[i] is that year's amount for items[i] (NaN = gap,
  /**
   * One point per age; amounts[i] is that year's amount for items[i] (an item
   * absent from a year is genuinely $0 — the engine only emits active expenses;
   * a present-but-non-finite amount is a NaN gap). `total` is the engine's
   * authoritative rounded spending total — item parts are pre-rounding and may
   * differ by cents.
   */
  points: { x: number; total: number; amounts: number[] }[];
}

/**
 * Spending per expense item, from the engine's per-item capture. Returns null
 * ONLY when the breakdown is truly missing in any year (stored legacy runs) —
 * the dashboard then shows an honest "run again" note instead of a fabricated
 * split. A recorded-but-EMPTY breakdown is real data (a fresh run of a plan
 * with no expenses) and yields an empty series, displayed as "no expenses".
 */
export function expenseBreakdownSeries(years: YearResult[]): ExpenseBreakdownSeries | null {
  if (years.length === 0 || years.some((y) => !Array.isArray(y.expenseBreakdown))) return null;
  const items: { id: string; name: string }[] = [];
  const index = new Map<string, number>();
  for (const y of years) {
    for (const entry of y.expenseBreakdown ?? []) {
      if (!index.has(entry.id)) {
        index.set(entry.id, items.length);
        items.push({ id: entry.id, name: entry.name ?? entry.id });
      }
    }
  }
  const points = years.map((y) => ({
    x: y.age,
    total: Number.isFinite(y.expenses) ? y.expenses : NaN,
    amounts: items.map((item) => {
      const entry = (y.expenseBreakdown ?? []).find((e) => e.id === item.id);
      // An item absent from a year is genuinely $0 that year (the engine only
      // emits active expenses). A present-but-non-finite amount stays a gap (NaN).
      return entry !== undefined && Number.isFinite(entry.amount) ? entry.amount : entry !== undefined ? NaN : 0;
    }),
  }));
  return { items, points };
}

// ---- RRIF minimum vs actual RRSP withdrawals ----

export interface RrifPoint {
  x: number;
  /** Mandatory RRIF minimum included in this year's RRSP withdrawals; null = RRIF minimums not active yet (or legacy capture). */
  minimum: number | null;
  /** Actual RRSP withdrawals this year (the minimum plus any proactive draw). */
  actual: number;
  /** Proactive tax-strategy RRSP draw above the minimum; 0 when the strategy ran none. */
  planned: number;
}

export function rrifWithdrawalSeries(years: YearResult[]): RrifPoint[] {
  return years.map((y) => ({
    x: y.age,
    minimum: y.rrifMinimumWithdrawal !== undefined && Number.isFinite(y.rrifMinimumWithdrawal) ? y.rrifMinimumWithdrawal : null,
    actual: Number.isFinite(y.withdrawals.rrsp) ? y.withdrawals.rrsp : NaN,
    planned: y.plannedRrspDraw !== undefined && Number.isFinite(y.plannedRrspDraw) ? y.plannedRrspDraw : 0,
  }));
}

/** True when the run captured RRIF minimums at all (fresh runs do; stored legacy runs do not). */
export function runCapturesRrifMinimum(years: YearResult[]): boolean {
  return years.some((y) => y.rrifMinimumWithdrawal !== undefined);
}

// ---- OAS kept vs recovery tax ----

export interface OasPoint {
  x: number;
  /** OAS as received, before the recovery tax is charged. */
  gross: number;
  /** OAS recovery tax ("clawback"); the engine caps it at the OAS received, so kept ≥ 0. */
  clawback: number;
  /** gross − clawback, exactly. GIS is NOT part of this chart (a GIS charge-back is not recorded). */
  kept: number;
}

/** Gross / kept / clawback mapping from income.oas and tax.oasClawback. */
export function oasKeptSeries(years: YearResult[]): OasPoint[] {
  return years.map((y) => {
    const gross = y.income.oas;
    const clawback = y.tax.oasClawback;
    const ok = Number.isFinite(gross) && Number.isFinite(clawback);
    return { x: y.age, gross: ok ? gross : NaN, kept: ok ? gross - clawback : NaN, clawback: ok ? clawback : NaN };
  });
}

// ---- Monte Carlo ensemble annual stats (fan + shortfall-risk charts) ----

/** One age's ensemble statistics, aggregated from actual simulated paths. */
export interface EnsembleStatPoint {
  age: number;
  netWorth: { p10: number; p50: number; p90: number };
  /** Cumulative fraction (0–1) of paths with any positive shortfall year through this age. */
  shortfallRate: number;
  /** Actual simulated paths that returned a row for this age. */
  sampleCount: number;
}

/** Structural subset of the MC analysis the ensemble charts read (the engine's full type may add fields). */
export interface MonteCarloAnalysisLike {
  mode?: string;
  annualStats?: { age: number; netWorth: { p10: number; p50: number; p90: number }; shortfallRate: number; sampleCount: number }[];
}

/**
 * Per-age ensemble statistics from `MonteCarloAnalysis.annualStats`. Returns
 * null when the analysis is absent, not Monte Carlo, or predates the per-age
 * capture (legacy run) — the dashboard then shows an honest rerun note and
 * NEVER synthesizes a fan from the representative path or terminal quantiles.
 */
export function ensembleStatPoints(analysis: MonteCarloAnalysisLike | undefined): EnsembleStatPoint[] | null {
  const stats = analysis?.annualStats;
  if (!analysis || analysis.mode !== "montecarlo" || !Array.isArray(stats) || stats.length === 0) return null;
  return stats.map((s) => ({
    age: Number.isFinite(s?.age) ? s.age : NaN,
    netWorth: {
      p10: Number.isFinite(s?.netWorth?.p10) ? s.netWorth.p10 : NaN,
      p50: Number.isFinite(s?.netWorth?.p50) ? s.netWorth.p50 : NaN,
      p90: Number.isFinite(s?.netWorth?.p90) ? s.netWorth.p90 : NaN,
    },
    shortfallRate: Number.isFinite(s?.shortfallRate) ? s.shortfallRate : NaN,
    sampleCount: Number.isFinite(s?.sampleCount) ? s.sampleCount : 0,
  }));
}
