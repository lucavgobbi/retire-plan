import type { RunRecord } from "../../domain/types";
import { netWorthSeries, type XyPoint } from "../projection/charts/adapters";

/** One side-by-side row: resolved settings, summary, and Δ vs the picked baseline. */
export interface ComparisonRow {
  runId: string;
  scenarioId: string | null;
  label: string;
  success: boolean;
  failureAge: number | null;
  worstShortfallAge: number | null;
  finalNetWorth: number | null;
  retirementAge: number | null;
  returnAssumptions: { equity: number; bond: number; cash: number } | null;
  withdrawalOrder: string[] | null;
  withdrawalStrategy: string;
  benefits: string;
  netWorthAtAges: XyPoint[];
  monteCarlo: RunRecord["analysis"];
  absDelta: number | null;
  pctDelta: number | null;
}

/**
 * Pure client-side comparison (plan Task 8): rows per selected run plus Δ columns
 * (absolute + %) against the baseline run, when the baseline is among the selection.
 * Percent only "where meaningful": only computed on final net worth.
 */
export function computeComparison(runs: RunRecord[], baselineId: string | null): ComparisonRow[] {
  const baseline = baselineId === null ? undefined : runs.find((run) => run.id === baselineId);

  const rows = runs.map<ComparisonRow>((run) => {
    const scenario = run.scenario;
    const summary = run.result.summary;
    return {
      runId: run.id,
      scenarioId: run.scenarioId,
      label: run.scenario.name || run.scenarioId || "Base scenario",
      success: summary.success,
      failureAge: summary.failureAge ?? null,
      worstShortfallAge: summary.worstShortfallAge ?? null,
      finalNetWorth: Number.isFinite(summary.finalNetWorth) ? summary.finalNetWorth : null,
      retirementAge: Number.isFinite(scenario.retirementAge) ? scenario.retirementAge : null,
      returnAssumptions: {
        equity: scenario.returnAssumptions.equity,
        bond: scenario.returnAssumptions.bond,
        cash: scenario.returnAssumptions.cash,
      },
      withdrawalOrder: [...scenario.withdrawalOrder],
      withdrawalStrategy: scenario.withdrawalStrategy ?? "manual",
      benefits: (() => {
        const benefits = scenario.benefits ?? { cpp: true, oas: true, gis: true };
        return [benefits.cpp && "CPP", benefits.oas && "OAS", benefits.oas && benefits.gis && "GIS"].filter(Boolean).join(", ") || "None";
      })(),
      netWorthAtAges: netWorthSeries(run.result.years),
      monteCarlo: run.analysis,
      absDelta: null,
      pctDelta: null,
    };
  });

  if (!baseline) return rows;

  const baseRow = rows.find((row) => row.runId === baseline.id);
  const baseNet = baseRow?.finalNetWorth;
  for (const row of rows) {
    if (row === baseRow) continue;
    if (baseNet === null || baseNet === undefined || row.finalNetWorth === null) continue;
    row.absDelta = row.finalNetWorth - baseNet;
    row.pctDelta = baseNet !== 0 ? (row.absDelta / Math.abs(baseNet)) * 100 : null;
  }
  return rows;
}
