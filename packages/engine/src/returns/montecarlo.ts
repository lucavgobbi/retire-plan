import type { Plan, ReturnSeries, Scenario, SimulationResult } from "../types";
import type { TaxYearTables } from "../tax/tables";
import { seededRandom, type Rand } from "./seededRandom";

/** Box–Muller: two uniform draws -> one standard-normal draw. */
function gaussian(rand: Rand): number {
  const u1 = Math.max(rand(), Number.EPSILON); // log(0) guard
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * One Monte Carlo year-per-age return series: each annual return is drawn as
 * `assumption x (1 + stdDev x gaussian)` — multiplicative deviation around the
 * assumption, so drawn returns scale with asset class size. Consumer: pass a
 * `seededRandom(seed)` stream.
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
      equity: assumptions.equity * (1 + stdDev.equity * gaussian(rand)),
      bond: assumptions.bond * (1 + stdDev.bond * gaussian(rand)),
      cash: assumptions.cash * (1 + stdDev.cash * gaussian(rand)),
    });
  }
  return { years };
}

export type SimulateFn = (plan: Plan, scenario: Scenario, returns: ReturnSeries) => SimulationResult;

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
};

/**
 * Drives the year stepper `mcConfig.runs` times, each with a fresh seeded series
 * (seed + runIndex). `success` per run = final net worth >= 0 AND no shortfall
 * after retirement — exactly `SimulationResult.summary.success`, which the
 * stepper owns (Review Focus #3 semantics); this function only aggregates.
 *
 * `simulate` is a required parameter in this task: the real stepper arrives with
 * Task 12, and until then tests inject a stub. `tables` is carried now because the
 * real stepper needs it; it is otherwise unused here.
 */
export function runMonteCarlo(
  plan: Plan,
  scenario: Scenario,
  tables: TaxYearTables,
  simulate: SimulateFn,
): MonteCarloSummary {
  void tables; // forwarded contract with the (Task 12) default stepper wiring
  const cfg = scenario.mcConfig;
  if (!cfg) {
    throw new Error("runMonteCarlo: scenario.mcConfig (runs, stdDev, seed) must be set.");
  }

  const results: SimulationResult[] = [];
  for (let run = 0; run < cfg.runs; run++) {
    const series = generateMonteCarloRun(
      seededRandom(cfg.seed + run),
      scenario.returnAssumptions,
      cfg.stdDev,
      plan.profile.currentAge,
      plan.profile.endAge,
    );
    results.push(simulate(plan, scenario, series));
  }

  const finals = results.map((r) => r.summary.finalNetWorth).sort((a, b) => a - b);
  const successCount = results.filter((r) => r.summary.success).length;
  return {
    successRate: successCount / results.length,
    percentileNetWorth: {
      p10: percentile(finals, 0.1),
      p50: percentile(finals, 0.5),
      p90: percentile(finals, 0.9),
    },
    sampleFailureAge: results.find((r) => !r.summary.success)?.summary.failureAge ?? null,
  };
}
