import type { PlannedWithdrawals, Plan, ReturnSeries, Scenario, SimulationResult, WithdrawalPlanMetadata } from "../types";
import type { TaxYearTables } from "../tax/tables";
import { simulate as realSimulate } from "../simulate";
import { planWithdrawalPolicy } from "../strategy/withdrawalPlanner";
import type { SimulateFn } from "./montecarlo";
import { HISTORICAL_OBSERVATIONS } from "./historicalDataset";
import { loadTables } from "../tax/tables";
import tablesJson from "../../data/tax/ca-2026.json";

/** One observed annual total-return row from a documented historical data source. */
export interface HistoricalReturnObservation {
  year: number;
  equity: number;
  bond: number;
  cash: number;
}

/**
 * Selects a contiguous historical window and maps it to plan ages. This function
 * never creates or fills observations: absent years, duplicate years, invalid
 * returns, or insufficient coverage are errors rather than synthetic history.
 */
export function buildHistoricalReturns(
  observations: readonly HistoricalReturnObservation[],
  startYear: number,
  startAge: number,
  endAge: number,
): ReturnSeries {
  if (!Number.isInteger(startYear)) throw new Error("buildHistoricalReturns: startYear must be a whole calendar year.");
  if (!Number.isInteger(startAge) || !Number.isInteger(endAge) || startAge <= 0 || endAge < startAge) {
    throw new Error("buildHistoricalReturns: require positive whole ages and endAge >= startAge.");
  }
  const byYear = new Map<number, HistoricalReturnObservation>();
  for (const observation of observations) {
    if (!Number.isInteger(observation.year)) throw new Error("buildHistoricalReturns: observation years must be whole calendar years.");
    if (byYear.has(observation.year)) throw new Error(`buildHistoricalReturns: duplicate observation for ${observation.year}.`);
    for (const key of ["equity", "bond", "cash"] as const) {
      const value = observation[key];
      if (!Number.isFinite(value) || value < -1) throw new Error(`buildHistoricalReturns: ${observation.year} ${key} must be finite and at least -100%.`);
    }
    byYear.set(observation.year, observation);
  }
  const years: ReturnSeries["years"] = [];
  for (let age = startAge; age <= endAge; age++) {
    const calendarYear = startYear + (age - startAge);
    const observation = byYear.get(calendarYear);
    if (!observation) throw new Error(`buildHistoricalReturns: no observation for ${calendarYear}; choose a fully covered window.`);
    years.push({ age, equity: observation.equity, bond: observation.bond, cash: observation.cash });
  }
  return { years };
}

/** Aggregate outcome of one rolling-window historical ensemble. */
export type HistoricalSummary = {
  /** Fraction of windows whose simulated plan stayed solvent (stepper-owned success semantics). */
  successRate: number;
  /** Nearest-rank percentiles of each window's final net worth — separate paths, never blended. */
  percentileNetWorth: { p10: number; p50: number; p90: number };
  /** Calendar year each simulated window started on (provenance for every run in the ensemble). */
  windowStartYears: number[];
  /** First failure age across windows (first window in start-year order that failed), null when all succeed. */
  sampleFailureAge: number | null;
  /** One actual window simulation nearest the median final net worth — never a percentile path. */
  representativeResult: SimulationResult;
  /** The representative window's calendar-year span. */
  representativeStartYear: number;
  representativeEndYear: number;
  /** 1-based position of the representative window within `windowStartYears`. */
  representativeWindow: number;
  /** Planning-time withdrawal-plan metadata, present only for the tax-minimizing strategy. */
  withdrawalPlan?: WithdrawalPlanMetadata;
};

/**
 * Historical rolling-window ensemble: every eligible window — `startYear` through
 * the last year whose span fits inside dataset coverage (inclusive) — is simulated
 * as one coherent path. Strict bounds: a `startYear` before dataset coverage, a
 * horizon longer than coverage, or a request with no fitting window are errors;
 * windows never wrap past the end of the series. Same inputs reproduce the same
 * ensemble; the representative run is an actual window, never a percentile blend.
 */
export function runHistorical(
  plan: Plan,
  scenario: Scenario,
  observations: readonly HistoricalReturnObservation[] = HISTORICAL_OBSERVATIONS,
  tables: TaxYearTables = loadTables(tablesJson),
  simulate: SimulateFn = realSimulate,
): HistoricalSummary {
  const requested = scenario.historicalConfig?.startYear;
  if (requested === undefined || !Number.isInteger(requested)) {
    throw new Error("runHistorical: scenario.historicalConfig.startYear must be a whole calendar year.");
  }
  const startYear: number = requested;
  if (!Number.isInteger(plan.profile.currentAge) || !Number.isInteger(plan.profile.endAge) ||
    plan.profile.currentAge <= 0 || plan.profile.endAge < plan.profile.currentAge) {
    throw new Error("runHistorical: plan ages must be positive whole numbers with endAge >= currentAge.");
  }
  if (!Object.values(scenario.returnAssumptions).every(Number.isFinite)) {
    throw new Error("runHistorical: return assumptions must be finite numbers.");
  }

  const horizonYears = plan.profile.endAge - plan.profile.currentAge + 1;
  const coverage = [...observations].sort((a, b) => a.year - b.year);
  const firstYear = coverage[0]?.year;
  const lastYear = coverage[coverage.length - 1]?.year;
  if (firstYear === undefined || lastYear === undefined) {
    throw new Error("runHistorical: the historical dataset is empty.");
  }
  if (horizonYears > lastYear - firstYear + 1) {
    throw new Error(
      `runHistorical: the plan horizon (${horizonYears} years) is longer than dataset coverage ` +
        `(${firstYear}-${lastYear}); no window fits.`,
    );
  }
  if (startYear < firstYear) {
    throw new Error(
      `runHistorical: startYear ${startYear} precedes dataset coverage (earliest ${firstYear}).`,
    );
  }
  // Inclusive horizon: a window starting at Y covers years Y..Y+(horizonYears-1).
  const lastFittingStart = lastYear - (horizonYears - 1);
  if (startYear > lastFittingStart) {
    throw new Error(
      `runHistorical: startYear ${startYear} leaves no fitting window; the latest feasible start year is ${lastFittingStart}.`,
    );
  }

  // Plan ONCE from deterministic known assumptions, then replay the SAME fixed
  // policy on every window (non-anticipative, one planning cost per run).
  let policy: PlannedWithdrawals | null = null;
  let withdrawalPlan: WithdrawalPlanMetadata | undefined;
  if (scenario.withdrawalStrategy === "tax-minimizing") {
    const plannerOutput = planWithdrawalPolicy(plan, scenario, tables);
    policy = plannerOutput.planned;
    withdrawalPlan = plannerOutput.metadata;
  }
  const plannedArg: PlannedWithdrawals = policy ?? {
    strategy: "tax-minimizing",
    fillTargetTaxable: 0, // manual retained: explicit no-op plan, no path replans
    byAge: [],
  };

  const results: { startYear: number; result: SimulationResult }[] = [];
  for (let windowStart = startYear; windowStart <= lastFittingStart; windowStart++) {
    const series = buildHistoricalReturns(coverage, windowStart, plan.profile.currentAge, plan.profile.endAge);
    results.push({ startYear: windowStart, result: simulate(plan, scenario, series, tables, plannedArg) });
  }

  const sorted = [...results].sort((a, b) => a.result.summary.finalNetWorth - b.result.summary.finalNetWorth);
  const finals = sorted.map((item) => item.result.summary.finalNetWorth);
  const median = sorted[Math.floor(0.5 * (sorted.length - 1))]!;
  const successCount = results.filter((item) => item.result.summary.success).length;
  return {
    successRate: successCount / results.length,
    percentileNetWorth: {
      p10: percentile(finals, 0.1),
      p50: percentile(finals, 0.5),
      p90: percentile(finals, 0.9),
    },
    windowStartYears: results.map((item) => item.startYear),
    sampleFailureAge: results.find((item) => !item.result.summary.success)?.result.summary.failureAge ?? null,
    representativeResult: withdrawalPlan
      ? { ...median.result, withdrawalPlan } // the SAME planning metadata, attached once
      : median.result,
    representativeStartYear: median.startYear,
    representativeEndYear: median.startYear + horizonYears - 1,
    representativeWindow: results.indexOf(median) + 1,
    ...(withdrawalPlan ? { withdrawalPlan } : {}),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    throw new Error("runHistorical: percentile of an empty window set.");
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx]!;
}
