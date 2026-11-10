// Lane B (Task 3). Sample plan — VERBATIM mirror of the golden fixture.
// Origin: packages/engine/tests/golden/samplePlan.ts (post-Task-15 remediation),
// copied 2026-11-10. The fixture is the single source of truth: do NOT "improve"
// it here — if the fixture omits `bookValue`, so does this copy, so Task 10's
// golden pin stays faithful to what tests actually run.
// NOTE: makeSampleScenario / sampleTables stay in the golden test module — they
// are engine-test plumbing, not part of the UI sample contract.
import type { Plan } from "@budgettool/engine";
import type { PlanMeta, Workspace } from "../domain/types";

/**
 * Golden sample plan (plan Task 15): a realistic 45-year-old Ontarian.
 * home $700k @2%; mortgage $350k @4.5%/25yr/$1930 monthly; RRSP $180k;
 * TFSA $60k; non-reg $40k; salary $95k @2% raises; expenses $55k @2%;
 * policy TFSA cap $7k -> RRSP; CPP $8k @65; OAS @65 (btable annual max);
 * retire 65; project to 95. All mixes 70/25/05.
 */
export function makeSamplePlan(): Plan {
  const mix = { equity: 0.7, bond: 0.25, cash: 0.05 };
  return {
    profile: { birthYear: 1981, currentAge: 45, province: "ON", endAge: 95 },
    accounts: [
      { id: "rrsp", type: "rrsp", balance: 180_000, assetMix: mix },
      { id: "tfsa", type: "tfsa", balance: 60_000, assetMix: mix },
      { id: "nonreg", type: "nonreg", balance: 40_000, assetMix: mix },
    ],
    assets: [
      { id: "home", kind: "primary-home", name: "Home", value: 700_000, appreciationRate: 0.02 },
    ],
    debts: [
      {
        id: "mortgage",
        kind: "mortgage",
        rate: 0.045,
        termYears: 25,
        amortizationYears: 25,
        balance: 350_000,
        monthlyPayment: 1_930,
      },
    ],
    incomes: [
      { id: "salary", kind: "employment", annualAmount: 95_000, startAge: 45, raiseRate: 0.02 },
      { id: "cpp", kind: "cpp", annualAmount: 8_000, startAge: 65, raiseRate: 0 },
      { id: "oas", kind: "oas", annualAmount: 8_907.72, startAge: 65, raiseRate: 0 },
    ],
    expenses: [
      { id: "living", name: "Living", annualAmount: 55_000, startAge: 45, inflationRate: 0.02 },
    ],
    savingsPolicy: [
      { id: "tfsa", priority: 1, target: "tfsa", perYearCap: 7_000 },
      { id: "rrsp", priority: 2, target: "rrsp" },
    ],
  };
}

/**
 * Convenience for recovery flows ("start with the sample plan"): the golden plan
 * wrapped as a usable workspace (named meta + a golden-equivalent deterministic
 * scenario delta). `makeSampleScenario` is deliberately NOT re-exported from the
 * engine test — the delta here carries the same settings as overrides:{} under
 * the DEFAULT_SCENARIO_BASE layering, which resolves identically.
 */
export function makeSampleWorkspace(meta: Partial<PlanMeta> = {}): Workspace {
  const id = meta.id ?? tempId();
  return {
    meta: {
      id,
      name: meta.name ?? "Sample plan",
      updatedAt: meta.updatedAt ?? new Date().toISOString(),
    },
    plan: makeSamplePlan(),
    scenarios: [
      {
        id: "sample",
        name: "Golden sample",
        basePlanId: id,
        simMode: "deterministic",
        overrides: {},
      },
    ],
  };
}

function tempId(): string {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  return `sample-${Date.now().toString(36)}`;
}
