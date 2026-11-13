import type { PlannedWithdrawals, Plan, ReturnSeries, Scenario, SimulationResult, WithdrawalPlanMetadata } from "../types";
import type { TaxYearTables } from "../tax/tables";
import { seededRandom, type Rand } from "./seededRandom";
import { simulate as realSimulate } from "../simulate";
import { planWithdrawalPolicy } from "../strategy/withdrawalPlanner";
import tablesJson from "../../data/tax/ca-2026.json";
import { loadTables } from "../tax/tables";

/** Box–Muller: two uniform draws -> one standard-normal draw. */
function gaussian(rand: Rand): number {
  const u1 = Math.max(rand(), Number.EPSILON); // log(0) guard
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * One Monte Carlo year-per-age return series: each annual return is drawn as
 * `assumption + stdDev x gaussian` — stdDev is an absolute annual return
 * deviation (for example, 0.18 means 18 percentage points). Returns are floored
 * at -100%, the maximum possible one-year loss. Consumer: pass a seeded stream.
 */
export function generateMonteCarloRun(
  rand: Rand,
  assumptions: Scenario["returnAssumptions"],
  stdDev: NonNullable<Scenario["mcConfig"]>["stdDev"],
  startAge: number,
  endAge: number,
): ReturnSeries {
  const years: ReturnSeries["years"] = [];
  for (let age = startAge; age <= endAge; age++) {
    years.push({
      age,
      equity: Math.max(-1, assumptions.equity + stdDev.equity * gaussian(rand)),
      bond: Math.max(-1, assumptions.bond + stdDev.bond * gaussian(rand)),
      cash: Math.max(-1, assumptions.cash + stdDev.cash * gaussian(rand)),
    });
  }
  return { years };
}

export type SimulateFn = (
  plan: Plan,
  scenario: Scenario,
  returns: ReturnSeries,
  tables?: TaxYearTables,
  planned?: PlannedWithdrawals,
) => SimulationResult;

/**
 * The fixed withdrawal policy passed to every run: the planner's chosen rule, or an
 * explicit no-op plan (target 0 = no proactive draws) when the planner retained
 * manual — either way every path executes the SAME rule and never replans.
 */
function noopPolicy(): PlannedWithdrawals {
  return { strategy: "tax-minimizing", fillTargetTaxable: 0, byAge: [] };
}

/** Nearest-rank quantile of a SORTED array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) {
    throw new Error("runMonteCarlo: percentile of an empty run set (mcConfig.runs must be >= 1).");
  }
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))));
  return sorted[idx]!;
}

export type MonteCarloSummary = {
  successRate: number;
  percentileNetWorth: { p10: number; p50: number; p90: number };
  sampleFailureAge: number | null;
  /** One actual simulated result nearest the median final net worth; never a percentile path. */
  representativeResult: SimulationResult;
  representativeRun: number;
  /** Planning-time withdrawal-plan metadata, present only for the tax-minimizing strategy. */
  withdrawalPlan?: WithdrawalPlanMetadata;
};

/**
 * Drives the year stepper `mcConfig.runs` times, each with a fresh seeded series
 * (seed + runIndex). `success` per run = final net worth >= 0 AND no shortfall
 * after retirement — exactly `SimulationResult.summary.success`, which the
 * stepper owns (Review Focus #3 semantics); this function only aggregates.
 *
 * `simulate` defaults to the real year stepper (wired in Task 12); tests may still
 * inject a stub via the optional fourth parameter. `tables` is forwarded so the
 * default stepper runs on the caller's table set.
 */
export function runMonteCarlo(
  plan: Plan,
  scenario: Scenario,
  tables: TaxYearTables = loadTables(tablesJson),
  simulate: SimulateFn = realSimulate,
): MonteCarloSummary {
  const cfg = scenario.mcConfig;
  if (!cfg) {
    throw new Error("runMonteCarlo: scenario.mcConfig (runs, stdDev, seed) must be set.");
  }
  if (!Number.isInteger(cfg.runs) || cfg.runs < 1 || cfg.runs > 10_000) {
    throw new Error("runMonteCarlo: mcConfig.runs must be a whole number from 1 to 10,000.");
  }
  if (!Number.isInteger(cfg.seed) || cfg.seed < 0 || cfg.seed > 0xffff_ffff) {
    throw new Error("runMonteCarlo: mcConfig.seed must be an unsigned 32-bit integer.");
  }
  if (!cfg.stdDev || !(Object.values({
    equity: cfg.stdDev.equity, bond: cfg.stdDev.bond, cash: cfg.stdDev.cash,
  }).every((value) => Number.isFinite(value) && value >= 0 && value <= 1))) {
    throw new Error("runMonteCarlo: mcConfig.stdDev values must be finite numbers from 0 to 1.");
  }
  if (!Object.values(scenario.returnAssumptions).every(Number.isFinite)) {
    throw new Error("runMonteCarlo: return assumptions must be finite numbers.");
  }

  // Plan ONCE from deterministic known assumptions, then replay the SAME fixed
  // policy on every path (non-anticipative: no per-path lookahead, one planning
  // cost per run). Manual-retained runs pass an explicit no-op plan so no path
  // replans internally.
  let policy: PlannedWithdrawals | null = null;
  let withdrawalPlan: WithdrawalPlanMetadata | undefined;
  if (scenario.withdrawalStrategy === "tax-minimizing") {
    const plannerOutput = planWithdrawalPolicy(plan, scenario, tables);
    policy = plannerOutput.planned;
    withdrawalPlan = plannerOutput.metadata;
  }
  const plannedArg = policy ?? noopPolicy();

  const results: { run: number; result: SimulationResult }[] = [];
  for (let run = 0; run < cfg.runs; run++) {
    const series = generateMonteCarloRun(
      seededRandom(cfg.seed + run),
      scenario.returnAssumptions,
      cfg.stdDev,
      plan.profile.currentAge,
      plan.profile.endAge,
    );
    results.push({ run, result: simulate(plan, scenario, series, tables, plannedArg) });
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
    sampleFailureAge: results.find((item) => !item.result.summary.success)?.result.summary.failureAge ?? null,
    representativeResult: withdrawalPlan
      ? { ...median.result, withdrawalPlan } // the SAME planning metadata, attached once
      : median.result,
    representativeRun: median.run + 1,
    ...(withdrawalPlan ? { withdrawalPlan } : {}),
  };
}
