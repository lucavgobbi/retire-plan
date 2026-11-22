import { describe, expect, it } from "vitest";
import {
  isFiniteNumber,
  isIsoDateString,
  validateBaseScenario,
  validatePlanFile,
  validatePlanMeta,
  validatePlanShape,
  validateScenarioDelta,
  validateWorkspace,
} from "./schema";
import { makeSamplePlan } from "../data/samplePlan";

const sample = (): unknown => JSON.parse(JSON.stringify(makeSamplePlan()));

describe("structural schema checks", () => {
  it("accepts the golden sample plan shape and semantics", () => {
    expect(validatePlanShape(sample())).toEqual([]);
  });

  it("rejects non-records and missing profile fields", () => {
    expect(validatePlanShape("nope")).not.toHaveLength(0);
    const plan = sample() as { profile: Record<string, unknown> };
    delete plan.profile.birthYear;
    delete plan.profile.endAge;
    const errors = validatePlanShape(plan);
    expect(errors.some((e) => e.includes("birthYear"))).toBe(true);
    expect(errors.some((e) => e.includes("endAge"))).toBe(true);
  });

  it("rejects section entries missing required fields", () => {
    const plan = sample() as { accounts: Record<string, unknown>[] };
    delete plan.accounts[0]!.balance;
    const errors = validatePlanShape(plan);
    expect(errors.some((e) => e.includes("accounts") && e.includes("balance"))).toBe(true);
  });

  it("keeps engine semantic errors flowing through the same gate", () => {
    const plan = sample() as { accounts: { balance: number }[] };
    plan.accounts[0]!.balance = -5;
    expect(validatePlanShape(plan).some((e) => e.toLowerCase().includes("balance"))).toBe(true);
  });

  it("guards a section that is not a list", () => {
    const plan = sample() as Record<string, unknown>;
    plan.accounts = "all my accounts";
    expect(validatePlanShape(plan).some((e) => e.includes('"accounts"'))).toBe(true);
  });

  it("validates plan meta strictly", () => {
    expect(validatePlanMeta({ id: "a", name: "b", updatedAt: new Date().toISOString() })).toEqual([]);
    expect(validatePlanMeta({ id: "", name: "b", updatedAt: "not-a-date" }).map(String)).toHaveLength(2);
  });

  it("validates scenario deltas (simMode, overrides, withdrawalOrder)", () => {
    const good = {
      id: "s1", name: "S", basePlanId: "p1", simMode: "deterministic", overrides: {},
    };
    expect(validateScenarioDelta(good)).toEqual([]);
    expect(validateScenarioDelta({ ...good, simMode: "mc" }).some((e) => e.includes("simMode"))).toBe(true);
    expect(validateScenarioDelta({ ...good, overrides: undefined }).some((e) => e.includes("overrides"))).toBe(true);
    expect(
      validateScenarioDelta({ ...good, overrides: { withdrawalOrder: ["tfsa", "tfsa", "rrsp"] } }).some((e) =>
        e.includes("withdrawalOrder"),
      ),
    ).toBe(true);
    expect(validateScenarioDelta({ ...good, overrides: { withdrawalOrder: ["cash", "tfsa", "nonreg", "rrsp"] } })).toEqual([]);
    expect(
      validateScenarioDelta({ ...good, overrides: { retirementAge: -1 } }).some((e) =>
        e.includes("retirementAge"),
      ),
    ).toBe(true);
    expect(
      validateScenarioDelta({ ...good, mcConfig: { runs: 0, seed: 1 } }).some((e) => e.includes("runs")),
    ).toBe(true);
  });

  it("accepts benefit and withdrawal strategy fields while rejecting malformed imported options", () => {
    const scenario = { id: "s", name: "S", basePlanId: "p", simMode: "deterministic", overrides: {} };
    expect(validateScenarioDelta({ ...scenario, benefits: { cpp: true, oas: false, gis: false }, withdrawalStrategy: "tax-minimizing" })).toEqual([]);
    expect(validateScenarioDelta({ ...scenario, benefits: { cpp: true, oas: false, gis: true } }).join(" ")).toMatch(/cannot enable GIS when OAS is disabled/);
    expect(validateScenarioDelta({ ...scenario, benefits: { cpp: true, oas: "no", gis: true } }).join(" ")).toMatch(/benefits must contain boolean/);
    expect(validateScenarioDelta({ ...scenario, withdrawalStrategy: "maximize-net-worth" }).join(" ")).toMatch(/withdrawalStrategy must be manual or tax-minimizing/);
    // Optional fields preserve pre-feature saved scenarios.
    expect(validateScenarioDelta(scenario)).toEqual([]);
  });

  it("accepts payroll settings and rejects malformed payroll options (exactly three booleans)", () => {
    const scenario = { id: "s", name: "S", basePlanId: "p", simMode: "deterministic", overrides: {} };
    expect(validateScenarioDelta({ ...scenario, payroll: { cpp: true, ei: false, cppOptOut65to69: false } })).toEqual([]);
    expect(validateScenarioDelta({ ...scenario, payroll: { cpp: false, ei: true, cppOptOut65to69: true } })).toEqual([]);
    // Legacy scenarios without payroll stay valid.
    expect(validateScenarioDelta(scenario)).toEqual([]);
    // Extra keys are surfaced, not silently coerced.
    expect(validateScenarioDelta({ ...scenario, payroll: { cpp: true, ei: true, cppOptOut65to69: false, cpp2: true } }).join(" ")).toMatch(/payroll must be an object with exactly the boolean flags/);
    expect(validateScenarioDelta({ ...scenario, payroll: { cpp: true, ei: false } }).join(" ")).toMatch(/payroll must be an object with exactly the boolean flags/);
    expect(validateScenarioDelta({ ...scenario, payroll: { cpp: "yes", ei: false, cppOptOut65to69: false } }).join(" ")).toMatch(/payroll must be an object with exactly the boolean flags/);
    expect(validateScenarioDelta({ ...scenario, payroll: "off" }).join(" ")).toMatch(/payroll must be an object with exactly the boolean flags/);
  });

  it("validates payroll on the working base scenario settings", () => {
    const base = {
      retirementAge: 65, returnAssumptions: { equity: 0.05, bond: 0.02, cash: 0 }, withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
      benefits: { cpp: true, oas: true, gis: true },
    };
    expect(validateBaseScenario({ ...base, payroll: { cpp: true, ei: true, cppOptOut65to69: false } })).toEqual([]);
    expect(validateBaseScenario(base)).toEqual([]);
    expect(validateBaseScenario({ ...base, payroll: { cpp: true, ei: false } }).join(" ")).toMatch(/payroll must be an object with exactly the boolean flags/);
  });

  it("accepts persisted Monte Carlo settings and rejects invalid seeds/deviations", () => {
    const monteCarlo = {
      id: "mc", name: "MC", basePlanId: "p", simMode: "montecarlo", overrides: {},
      mcConfig: { runs: 1000, seed: 12, stdDev: { equity: 0.18, bond: 0.06, cash: 0.02 } },
    };
    expect(validateScenarioDelta(monteCarlo)).toEqual([]);
    expect(validateScenarioDelta({ ...monteCarlo, mcConfig: { ...monteCarlo.mcConfig, seed: -1 } }).some((e) => e.includes("seed"))).toBe(true);
    expect(validateScenarioDelta({ ...monteCarlo, mcConfig: { ...monteCarlo.mcConfig, stdDev: { equity: 1.1, bond: 0.06, cash: 0.02 } } }).some((e) => e.includes("stdDev"))).toBe(true);
    expect(validateScenarioDelta({ ...monteCarlo, mcConfig: { ...monteCarlo.mcConfig, runs: 10_001 } }).some((e) => e.includes("runs"))).toBe(true);
  });

  it("accepts historical earliest-window years only within the JST proxy source span", () => {
    const historical = { id: "hist", name: "Historical", basePlanId: "p", simMode: "historical", overrides: {}, historicalConfig: { startYear: 1872 } };
    expect(validateScenarioDelta(historical)).toEqual([]);
    expect(validateScenarioDelta({ ...historical, historicalConfig: { startYear: 1871 } }).some((error) => error.includes("1872 through 2020"))).toBe(true);
    expect(validateScenarioDelta({ ...historical, historicalConfig: { startYear: 2021 } }).some((error) => error.includes("1872 through 2020"))).toBe(true);
  });

  it("validates the workspace envelope (meta null allowed, undefined rejected)", () => {
    expect(
      validateWorkspace({ meta: null, plan: makeSamplePlan(), scenarios: [] }),
    ).toEqual([]);
    expect(
      validateWorkspace({ plan: makeSamplePlan(), scenarios: [] }).some((e) => e.includes("meta")),
    ).toBe(true);
    expect(validateWorkspace({ meta: null, plan: makeSamplePlan(), scenarios: [], baseScenario: {
      retirementAge: 65, returnAssumptions: { equity: 0.05, bond: 0.02, cash: 0 }, withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
      benefits: { cpp: true, oas: false, gis: true },
    } }).join(" ")).toMatch(/cannot enable GIS when OAS is disabled/);
  });

  it("accepts optional hiddenProjectionColumns and hiddenProjectionCharts (absent = all visible) and rejects malformed values", () => {
    const base = { meta: null, plan: makeSamplePlan(), scenarios: [] };
    expect(validateWorkspace({ ...base, hiddenProjectionColumns: [], hiddenProjectionCharts: [] })).toEqual([]);
    expect(validateWorkspace({ ...base, hiddenProjectionColumns: ["income.employment", "stale.id"], hiddenProjectionCharts: ["tax", "stale.chart"] })).toEqual([]);
    expect(
      validateWorkspace({ ...base, hiddenProjectionColumns: "all" }).some((e) => e.includes("hiddenProjectionColumns")),
    ).toBe(true);
    expect(
      validateWorkspace({ ...base, hiddenProjectionColumns: [42] }).some((e) => e.includes("hiddenProjectionColumns")),
    ).toBe(true);
    expect(
      validateWorkspace({ ...base, hiddenProjectionCharts: "everything" }).some((e) => e.includes("hiddenProjectionCharts")),
    ).toBe(true);
    expect(
      validateWorkspace({ ...base, hiddenProjectionCharts: [7] }).some((e) => e.includes("hiddenProjectionCharts")),
    ).toBe(true);
    const file = {
      schemaVersion: 1,
      plans: [{ meta: { id: "p", name: "P", updatedAt: new Date().toISOString() }, plan: makeSamplePlan() }],
      scenarios: [],
    };
    expect(validatePlanFile({ ...file, hiddenProjectionColumns: ["balances.debt"], hiddenProjectionCharts: ["net-worth"] })).toEqual([]);
    expect(
      validatePlanFile({ ...file, hiddenProjectionColumns: { hidden: true } }).some((e) => e.includes("hiddenProjectionColumns")),
    ).toBe(true);
    expect(
      validatePlanFile({ ...file, hiddenProjectionCharts: [null] }).some((e) => e.includes("hiddenProjectionCharts")),
    ).toBe(true);
  });

  it("validates optional projection selection and summary preferences while allowing a stale id to fall back in the view", () => {
    const workspace = { meta: null, plan: makeSamplePlan(), scenarios: [] };
    expect(validateWorkspace({ ...workspace, projectionScenarioId: "removed-scenario", projectionRunSummaryCollapsed: false })).toEqual([]);
    expect(validateWorkspace({ ...workspace, projectionScenarioId: 42 }).join(" ")).toMatch(/projectionScenarioId/);
    expect(validateWorkspace({ ...workspace, projectionRunSummaryCollapsed: "closed" }).join(" ")).toMatch(/projectionRunSummaryCollapsed/);
    const file = {
      schemaVersion: 1,
      plans: [{ meta: { id: "p", name: "P", updatedAt: new Date().toISOString() }, plan: makeSamplePlan() }],
      scenarios: [],
    };
    expect(validatePlanFile({ ...file, projectionScenarioId: "removed-scenario", projectionRunSummaryCollapsed: true })).toEqual([]);
    expect(validatePlanFile({ ...file, projectionRunSummaryCollapsed: null }).join(" ")).toMatch(/projectionRunSummaryCollapsed/);
  });

  it("validates the optional active projection tab and Sankey range in workspaces and files", () => {
    const workspace = { meta: null, plan: makeSamplePlan(), scenarios: [] };
    expect(validateWorkspace({ ...workspace, projectionActiveTab: "charts", projectionSankeyRange: { startYear: 2026, endYear: 2035 } })).toEqual([]);
    expect(validateWorkspace({ ...workspace, projectionActiveTab: "cashflow" })).toEqual([]);
    expect(validateWorkspace({ ...workspace, projectionActiveTab: "table" }).join(" ")).toMatch(/projectionActiveTab/);
    expect(validateWorkspace({ ...workspace, projectionSankeyRange: { startYear: 2035, endYear: 2026 } }).join(" ")).toMatch(/projectionSankeyRange/);
    expect(validateWorkspace({ ...workspace, projectionSankeyRange: { startYear: 2026.5, endYear: 2035 } }).join(" ")).toMatch(/projectionSankeyRange/);
    expect(validateWorkspace({ ...workspace, projectionSankeyRange: "full" }).join(" ")).toMatch(/projectionSankeyRange/);
    expect(validateWorkspace({ ...workspace, projectionSankeyShowAccounts: false })).toEqual([]);
    expect(validateWorkspace({ ...workspace, projectionSankeyShowAccounts: "true" }).join(" ")).toMatch(/projectionSankeyShowAccounts/);

    const file = {
      schemaVersion: 1,
      plans: [{ meta: { id: "p", name: "P", updatedAt: new Date().toISOString() }, plan: makeSamplePlan() }],
      scenarios: [],
    };
    expect(validatePlanFile({ ...file, projectionActiveTab: "cashflow", projectionSankeyRange: { startYear: 2026, endYear: 2035 } })).toEqual([]);
    expect(validatePlanFile({ ...file, projectionActiveTab: "both" }).join(" ")).toMatch(/projectionActiveTab/);
    expect(validatePlanFile({ ...file, projectionSankeyRange: { startYear: 2035, endYear: 2026 } }).join(" ")).toMatch(/projectionSankeyRange/);
    expect(validatePlanFile({ ...file, projectionSankeyShowAccounts: true })).toEqual([]);
    expect(validatePlanFile({ ...file, projectionSankeyShowAccounts: null }).join(" ")).toMatch(/projectionSankeyShowAccounts/);
  });

  it("validates the whole PlanFile envelope", () => {
    const file = {
      schemaVersion: 1,
      plans: [{ meta: { id: "p", name: "P", updatedAt: new Date().toISOString() }, plan: makeSamplePlan() }],
      scenarios: [],
    };
    expect(validatePlanFile(file)).toEqual([]);
    expect(validatePlanFile({ ...file, schemaVersion: "one" }).some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("keeps tiny guards honest", () => {
    expect(isFiniteNumber(1.5)).toBe(true);
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber("1")).toBe(false);
    expect(isIsoDateString("2026-01-02T03:04:05.000Z")).toBe(true);
    expect(isIsoDateString("next tuesday")).toBe(false);
  });

  it("accepts named cash accounts without market allocations and validates their fixed rate", () => {
    const plan = sample() as any;
    plan.accounts[0] = { id: "savings", name: "Savings", type: "cash", balance: 12_000, interestRate: 0.035 };
    expect(validatePlanShape(plan)).toEqual([]);
    plan.accounts[0].interestRate = "3.5%";
    expect(validatePlanShape(plan).some(error => error.includes("interestRate"))).toBe(true);
    plan.accounts[0].interestRate = 0.035;
    plan.accounts[0].assetMix = { equity: 0, bond: 0, cash: 1 };
    expect(validatePlanShape(plan).some(error => error.includes("do not use an assetMix"))).toBe(true);
  });

  it("accepts optional names on accounts and incomes", () => {
    const plan = sample() as { accounts: Record<string, unknown>[]; incomes: Record<string, unknown>[] };
    plan.accounts[0]!.name = "Main TFSA";
    plan.incomes[0]!.name = "Day-job salary";
    expect(validatePlanShape(plan)).toEqual([]);
  });

  it("no longer requires an asset name", () => {
    const plan = sample() as { assets: Record<string, unknown>[] };
    plan.assets[0]!.name = "";
    expect(validatePlanShape(plan)).toEqual([]);
  });

  it("validates the mortgage payment frequency", () => {
    const plan = sample() as { debts: Record<string, unknown>[] };
    plan.debts[0]!.paymentFrequency = "weekly";
    expect(validatePlanShape(plan)).toEqual([]);
    plan.debts[0]!.paymentFrequency = "daily";
    expect(validatePlanShape(plan).some((e) => e.includes("paymentFrequency"))).toBe(true);
  });

  describe("income bonusRate", () => {
    it("accepts employment bonus fractions including 0 and above 100%", () => {
      const plan = sample() as { incomes: Record<string, unknown>[] };
      plan.incomes[0]!.bonusRate = 0.1;
      expect(validatePlanShape(plan)).toEqual([]);
      plan.incomes[0]!.bonusRate = 0;
      expect(validatePlanShape(plan)).toEqual([]);
      plan.incomes[0]!.bonusRate = 1.5;
      expect(validatePlanShape(plan)).toEqual([]);
    });

    it("rejects negative, non-finite, and non-employment bonus rates", () => {
      const plan = sample() as { incomes: Record<string, unknown>[] };
      plan.incomes[0]!.bonusRate = -0.1;
      expect(validatePlanShape(plan).some((e) => e.includes("bonusRate"))).toBe(true);
      plan.incomes[0]!.bonusRate = Number.POSITIVE_INFINITY;
      expect(validatePlanShape(plan).some((e) => e.includes("bonusRate"))).toBe(true);
      plan.incomes[0]!.bonusRate = 0.1;
      plan.incomes[0]!.kind = "cpp";
      expect(validatePlanShape(plan).some((e) => e.includes("bonusRate") && e.includes("employment"))).toBe(true);
    });

    it("loads legacy files whose incomes have no bonusRate at all", () => {
      // The golden sample carries no bonusRate — legacy files stay valid untouched.
      const plan = sample() as { incomes: Record<string, unknown>[] };
      expect("bonusRate" in plan.incomes[0]!).toBe(false);
      expect(validatePlanShape(plan)).toEqual([]);
    });
  });
});

it.each([
  ["account enum", (p: any) => { p.accounts[0].type = "crypto"; }],
  ["account id", (p: any) => { p.accounts[0].id = 3; }],
  ["assetMix", (p: any) => { p.accounts[0].assetMix.equity = NaN; }],
  ["asset rate", (p: any) => { p.assets[0].appreciationRate = Infinity; }],
  ["sell age", (p: any) => { p.assets[0].sellEvent = { age: 70.5, costsPct: 0.05 }; }],
  ["missing sell costs", (p: any) => { p.assets[0].sellEvent = { age: 70 }; }],
  ["debt term", (p: any) => { p.debts[0].termYears = 3.5; }],
  ["expense endAge", (p: any) => { p.expenses[0].endAge = 85.5; }],
  ["income raise", (p: any) => { p.incomes[0].raiseRate = "0.01"; }],
  ["match rate", (p: any) => { p.savingsPolicy[0].matchRate = Infinity; }],
  ["missing section", (p: any) => { delete p.accounts; }],
  ["missing province", (p: any) => { delete p.profile.province; }],
])("rejects malformed nested %s", (_, mutate) => {
  const plan = sample();
  mutate(plan);
  expect(validatePlanShape(plan).length).toBeGreaterThan(0);
});
