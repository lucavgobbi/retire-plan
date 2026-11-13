import { buildDeterministicReturns } from "../returns/deterministic";
import { simulate } from "../simulate";
import type { TaxYearTables } from "../tax/tables";
import type {
  PlannedWithdrawals,
  Plan,
  Scenario,
  SimulationResult,
  WithdrawalPlanMetadata,
} from "../types";

/**
 * Tax-minimizing withdrawal planner (bounded heuristic).
 *
 * Plans ONCE from deterministic known assumptions (the scenario's own return
 * assumptions, no market noise): the chosen fill target is a fixed execution rule
 * that is then replayed on every path — deterministic, Monte Carlo or historical —
 * by `simulate` using current-year state only (no lookahead). The comparison
 * metadata describes the planning-time deterministic evaluation, never a per-path
 * guarantee.
 *
 * Candidates (bounded, reproducible order): proactively draw the RRSP above the
 * mandatory RRIF minimum until the year's taxable income reaches one of —
 *   0 (defer), federal basic personal amount, first federal bracket top,
 *   second federal bracket top, OAS recovery threshold minus $1 —
 * each evaluated by a FULL `simulate` so GIS taper, OAS clawback and the real
 * brackets price in through the existing tax/benefit functions.
 *
 * Selection: candidates must pass the stepper's retirement-success semantics AND
 * have finite, zero shortfall in every modeled year, including pre-retirement years.
 * Once fully
 * funded, lower total income tax through endAge is preferred.
 * If the manual order is feasible, only a feasible candidate with strictly lower total
 * tax is selected. If manual is infeasible, only fully funded successful candidates
 * are eligible; the lowest-tax eligible candidate wins, even if its tax exceeds the
 * failed manual baseline. If none is feasible, manual is retained and the metadata
 * reports that no feasible tested policy was found.
 *
 * No arbitrary wealth floor; final net worth is reported, not optimized. The
 * objective covers the projection horizon only (estate/future tax excluded).
 */
export interface PlannerOutput {
  /** Chosen execution rule for the runners (null = manual retained, no proactive draws). */
  planned: PlannedWithdrawals | null;
  /** Planning-time comparison metadata for UI disclosure. */
  metadata: WithdrawalPlanMetadata;
}

const SELECTION_RULE =
  "Feasibility first (retirement success plus finite zero shortfall in every modeled year), then lower total income tax through endAge; " +
  "only fully funded candidates are eligible, bounded candidate grid, reproducible tie-breaks, no guaranteed global optimum.";

const PLANNING_BASIS =
  "Policy planned once from deterministic known assumptions (the scenario's return assumptions), " +
  "then replayed on every path by the same fixed rule using current-year information only — no per-path lookahead.";

/** Bounded candidate grid resolved per year from the indexed federal tables. */
const CANDIDATE_TARGETS = ["none", "federal-bpa", "federal-bracket-1", "federal-bracket-2", "clawback-threshold"] as const;
type CandidateTarget = (typeof CANDIDATE_TARGETS)[number];

function resolveTarget(target: CandidateTarget, tables: TaxYearTables): number {
  const brackets = tables.federal.brackets;
  switch (target) {
    case "none": return 0;
    case "federal-bpa": return tables.federal.basicPersonalAmount;
    case "federal-bracket-1": return brackets[1]?.threshold ?? brackets[brackets.length - 1]!.threshold;
    case "federal-bracket-2": return brackets[2]?.threshold ?? brackets[brackets.length - 1]!.threshold;
    case "clawback-threshold": return Math.max(0, tables.oas.clawbackThreshold - 1);
  }
}

function totals(result: SimulationResult): { totalTax: number; gisTotal: number } {
  let totalTax = 0;
  let gisTotal = 0;
  for (const y of result.years) {
    totalTax += y.tax.total;
    gisTotal += y.income.gis;
  }
  return { totalTax, gisTotal };
}

/** Planner feasibility is stricter than summary.success: no modeled year may be unfunded. */
function isFullyFunded(result: SimulationResult): boolean {
  return result.summary.success && result.years.every(
    (year) => Number.isFinite(year.shortfall) && year.shortfall <= 0,
  );
}

export function planWithdrawalPolicy(
  plan: Plan,
  scenario: Scenario,
  tables: TaxYearTables,
): PlannerOutput {
  const startAge = plan.profile.currentAge;
  const endAge = plan.profile.endAge;
  const returns = buildDeterministicReturns(scenario.returnAssumptions, startAge, endAge);
  const strategyScenario: Scenario = { ...scenario, withdrawalStrategy: "tax-minimizing" };
  const manualScenario: Scenario = { ...scenario, withdrawalStrategy: "manual" };

  const manual = simulate(plan, manualScenario, returns, tables);
  const manualTotals = totals(manual);
  const manualFullyFunded = isFullyFunded(manual);

  const candidates = CANDIDATE_TARGETS.map((target) => {
    const planned: PlannedWithdrawals = { strategy: "tax-minimizing", fillTargetTaxable: resolveTarget(target, tables), byAge: [] };
    const result = simulate(plan, strategyScenario, returns, tables, planned);
    return { target, planned, result, fullyFunded: isFullyFunded(result), ...totals(result) };
  });

  let chosen: (typeof candidates)[number] | null;
  if (manualFullyFunded) {
    // Safety contract: chosen must be feasible AND total tax strictly below manual's
    // (a candidate that merely matches manual is not an improvement — manual is
    // retained with planned = null and an honestly empty planned schedule).
    const improving = candidates.filter(
      (c) => c.fullyFunded && c.totalTax < manualTotals.totalTax - 0.005,
    );
    if (improving.length === 0) {
      chosen = null;
    } else {
      // Fixed order is ascending ambition; the first (lowest target) that achieves
      // the minimum tax wins — reproducible without a tie-break parameter.
      const minTax = Math.min(...improving.map((c) => c.totalTax));
      chosen = improving.find((c) => c.totalTax === minTax) ?? null;
    }
  } else {
    // Manual infeasible: ONLY fully funded successful candidates may be chosen — a
    // failed plan is never preferred for an earlier tax drop or a smaller recorded
    // shortfall. If no candidate is feasible, manual is retained as-is and the
    // metadata reports status "no-feasible-policy" with an empty planned schedule.
    // A feasible candidate may cost MORE tax than the failed manual baseline; the
    // comparison fields disclose that honestly.
    const feasible = candidates.filter((c) => c.fullyFunded);
    if (feasible.length === 0) {
      chosen = null;
    } else {
      // Fixed order is ascending ambition; the first (lowest target) that achieves
      // the minimum tax among feasible candidates wins — reproducible tie-break.
      const minTax = Math.min(...feasible.map((c) => c.totalTax));
      chosen = feasible.find((c) => c.totalTax === minTax) ?? null;
    }
  }

  const planned = chosen === null
    ? null
    : {
        ...chosen.planned,
        byAge: chosen.result.years
          .filter((y) => (y.plannedRrspDraw ?? 0) > 0)
          .map((y) => ({ age: y.age, netRrspDraw: y.plannedRrspDraw! })),
      };

  const optimized = chosen === null ? manual : chosen.result;
  const optimizedTotals = chosen === null ? manualTotals : totals(chosen.result);

  const metadata: WithdrawalPlanMetadata = {
    strategy: "tax-minimizing",
    planningBasis: PLANNING_BASIS,
    status: chosen !== null
      ? "optimized"
      : manualFullyFunded
        ? "manual-retained"
        : "no-feasible-policy",
    plannedWithdrawals: planned?.byAge ?? [],
    comparison: {
      manualTotalTax: manualTotals.totalTax,
      optimizedTotalTax: optimizedTotals.totalTax,
      manualFinalNetWorth: manual.summary.finalNetWorth,
      optimizedFinalNetWorth: optimized.summary.finalNetWorth,
      manualSuccess: manualFullyFunded,
      optimizedSuccess: isFullyFunded(optimized),
      manualGisTotal: manualTotals.gisTotal,
      optimizedGisTotal: optimizedTotals.gisTotal,
      selectionRule: SELECTION_RULE,
    },
  };

  return { planned, metadata };
}
