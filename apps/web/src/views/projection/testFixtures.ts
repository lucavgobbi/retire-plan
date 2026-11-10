import type { Plan, YearResult } from "@budgettool/engine";
import { createDefaultPlan } from "../../domain/defaults";
import type { Workspace } from "../../domain/types";

/**
 * In-file plan fixtures for view tests. Deliberately independent of lane B's
 * samplePlan.ts (not present at lane DE start); each fixture passes validatePlan
 * inside the tests that use it.
 */

export function makeSamplePlan(): Plan {
  const plan = createDefaultPlan();
  plan.accounts.push({ id: "tfsa-1", type: "tfsa", balance: 60_000, assetMix: { equity: 0.4, bond: 0.3, cash: 0.3 } });
  plan.accounts.push({ id: "rrsp-1", type: "rrsp", balance: 240_000, assetMix: { equity: 0.6, bond: 0.4, cash: 0 } });
  plan.accounts.push({ id: "nonreg-1", type: "nonreg", balance: 90_000, assetMix: { equity: 0.5, bond: 0.2, cash: 0.3 } });
  plan.incomes.push({ id: "salary", kind: "employment", annualAmount: 95_000, startAge: 45, endAge: 64, raiseRate: 0.02 });
  plan.incomes.push({ id: "cpp", kind: "cpp", annualAmount: 8_000, startAge: 65, raiseRate: 0 });
  plan.incomes.push({ id: "oas", kind: "oas", annualAmount: 8_907.72, startAge: 65, raiseRate: 0 });
  plan.expenses.push({ id: "living", name: "Living", annualAmount: 50_000, startAge: 45, inflationRate: 0.02 });
  return plan;
}

/** Spendthrift: no income streams, one small TFSA, fat spending — guaranteed run-out. */
export function makeRunOutPlan(): Plan {
  const plan = createDefaultPlan();
  plan.accounts.push({ id: "tfsa-1", type: "tfsa", balance: 25_000, assetMix: { equity: 0.3, bond: 0.3, cash: 0.4 } });
  plan.expenses.push({ id: "spend", name: "Spending", annualAmount: 120_000, startAge: 45, inflationRate: 0.1 });
  return plan;
}

export function makeWorkspace(plan: Plan = makeSamplePlan()): Workspace {
  return { meta: { id: "plan-test", name: "Test plan", updatedAt: "2026-01-01T00:00:00.000Z" }, plan, scenarios: [] };
}

/** Pulls the first year whose run-out (shortfall) is active — used to pin the banner target. */
export function firstShortfallYear(years: YearResult[]): YearResult | undefined {
  return years.find((year) => year.shortfall > 0);
}
