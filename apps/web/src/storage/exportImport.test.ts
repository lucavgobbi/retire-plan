import { describe, expect, it } from "vitest";
import type { Workspace } from "../domain/types";
import { SCHEMA_VERSION, validateWorkspace } from "./schema";
import {
  buildPlanFile,
  parsePlanFile,
  planFileToText,
  workspaceToText,
} from "./exportImport";
import { makeSampleWorkspace } from "../data/samplePlan";

describe("buildPlanFile / export text", () => {
  it("mirrors the live workspace into the current-schema envelope", () => {
    const ws = makeSampleWorkspace({ id: "p-fixed", name: "My plan", updatedAt: "2026-01-01T00:00:00.000Z" });
    const file = buildPlanFile(ws);
    expect(file.schemaVersion).toBe(SCHEMA_VERSION);
    expect(file.plans[0]?.meta).toEqual(ws.meta);
    expect(file.plans[0]?.plan.profile.currentAge).toBe(45);
    expect(file.scenarios[0]?.id).toBe("sample");
  });

  it("synthesizes meta for a never-saved workspace WITHOUT mutating it", () => {
    const ws: Workspace = { meta: null, plan: makeSampleWorkspace().plan, scenarios: [] };
    const file = buildPlanFile(ws, { makeId: () => "synthetic-1", now: () => "2026-02-03T04:05:06.000Z" });
    expect(ws.meta).toBeNull();
    expect(file.plans[0]?.meta).toEqual({
      id: "synthetic-1",
      name: "Untitled plan",
      updatedAt: "2026-02-03T04:05:06.000Z",
    });
  });

  it("serializes to pretty JSON text", () => {
    const ws = makeSampleWorkspace();
    expect(JSON.parse(workspaceToText(ws)).schemaVersion).toBe(SCHEMA_VERSION);
    expect(planFileToText(buildPlanFile(ws))).toContain("Sample plan");
  });
});

describe("parsePlanFile", () => {
  it("is a full round-trip incl. optional non-reg bookValue", () => {
    const ws = makeSampleWorkspace();
    ws.baseScenario = { retirementAge: 61, returnAssumptions: { equity: 0.04, bond: 0.015, cash: 0.01 }, withdrawalOrder: ["cash", "rrsp", "nonreg", "tfsa"] };
    const withAcb = JSON.parse(JSON.stringify(ws)) as Workspace;
    const nonreg = withAcb.plan.accounts.find((a) => a.type === "nonreg");
    if (nonreg) (nonreg as { bookValue?: number }).bookValue = 21_500;
    withAcb.plan.accounts.push({ id: "savings", name: "Savings", type: "cash", balance: 12_000, interestRate: 0.035 });
    const text = workspaceToText(withAcb);
    const parsed = parsePlanFile(JSON.parse(text));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      const rebuilt = buildPlanFile(parsed.workspace);
      expect(rebuilt).toEqual(buildPlanFile(withAcb));
      expect((parsed.workspace.plan.accounts.find((a) => a.type === "nonreg") as { bookValue?: number }).bookValue).toBe(21_500);
      expect(parsed.workspace.plan.accounts.find((a) => a.type === "cash")).toMatchObject({ id: "savings", name: "Savings", balance: 12_000, interestRate: 0.035 });
      expect(parsed.workspace.plan.accounts.find((a) => a.type === "cash")?.assetMix).toBeUndefined();
    }
  });

  it("round-trips scenario benefit choices and withdrawal strategy", () => {
    const ws = makeSampleWorkspace();
    ws.baseScenario = {
      retirementAge: 65, returnAssumptions: { equity: 0.05, bond: 0.02, cash: 0 }, withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
      benefits: { cpp: true, oas: true, gis: false }, withdrawalStrategy: "tax-minimizing",
    };
    const scenario = ws.scenarios[0]!;
    scenario.benefits = { cpp: false, oas: true, gis: true };
    scenario.withdrawalStrategy = "tax-minimizing";
    const parsed = parsePlanFile(JSON.parse(workspaceToText(ws)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.workspace.scenarios[0]).toMatchObject({ benefits: scenario.benefits, withdrawalStrategy: "tax-minimizing" });
      expect(parsed.workspace.baseScenario).toMatchObject({ benefits: ws.baseScenario.benefits, withdrawalStrategy: "tax-minimizing" });
    }
  });

  it("round-trips payroll settings on the base scenario and a scenario delta; legacy files stay absent", () => {
    const ws = makeSampleWorkspace();
    ws.baseScenario = {
      retirementAge: 65, returnAssumptions: { equity: 0.05, bond: 0.02, cash: 0 }, withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
      payroll: { cpp: true, ei: true, cppOptOut65to69: false },
    };
    const scenario = ws.scenarios[0]!;
    scenario.payroll = { cpp: false, ei: false, cppOptOut65to69: true };
    const parsed = parsePlanFile(JSON.parse(workspaceToText(ws)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.workspace.baseScenario).toMatchObject({ payroll: { cpp: true, ei: true, cppOptOut65to69: false } });
      expect(parsed.workspace.scenarios[0]).toMatchObject({ payroll: { cpp: false, ei: false, cppOptOut65to69: true } });
      expect(buildPlanFile(parsed.workspace)).toEqual(buildPlanFile(ws));
    }
    // Legacy file: no payroll keys anywhere — loads with the fields absent.
    const legacy = makeSampleWorkspace();
    const legacyParsed = parsePlanFile(JSON.parse(workspaceToText(legacy)));
    expect(legacyParsed.ok).toBe(true);
    if (legacyParsed.ok) {
      expect(legacyParsed.workspace.baseScenario === undefined || !("payroll" in legacyParsed.workspace.baseScenario)).toBe(true);
      expect("payroll" in legacyParsed.workspace.scenarios[0]!).toBe(false);
    }
  });

  it("round-trips projection preferences; legacy JSON without them keeps defaults", () => {
    const ws = makeSampleWorkspace();
    ws.hiddenProjectionColumns = ["income.employment", "stale.id"];
    ws.hiddenProjectionCharts = ["tax", "stale.chart"];
    ws.projectionScenarioId = "sample";
    ws.projectionRunSummaryCollapsed = true;
    const parsed = parsePlanFile(JSON.parse(workspaceToText(ws)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // Both fields round-trip verbatim; stale ids are filtered only at display time.
      expect(parsed.workspace.hiddenProjectionColumns).toEqual(["income.employment", "stale.id"]);
      expect(parsed.workspace.hiddenProjectionCharts).toEqual(["tax", "stale.chart"]);
      expect(parsed.workspace.projectionScenarioId).toBe("sample");
      expect(parsed.workspace.projectionRunSummaryCollapsed).toBe(true);
    }
    // Backward compatibility: a legacy file without the fields loads with them absent.
    const legacy = parsePlanFile(JSON.parse(workspaceToText(makeSampleWorkspace())));
    expect(legacy.ok).toBe(true);
    if (legacy.ok) {
      expect(legacy.workspace.hiddenProjectionColumns).toBeUndefined();
      expect(legacy.workspace.hiddenProjectionCharts).toBeUndefined();
      expect(legacy.workspace.projectionScenarioId).toBeUndefined();
      expect(legacy.workspace.projectionRunSummaryCollapsed).toBeUndefined();
    }
    const baseSelectionFile = buildPlanFile(makeSampleWorkspace());
    baseSelectionFile.projectionScenarioId = "";
    const baseSelection = parsePlanFile(baseSelectionFile);
    expect(baseSelection.ok).toBe(true);
    if (baseSelection.ok) expect(baseSelection.workspace.projectionScenarioId).toBe("");

    const collisionFile = buildPlanFile(makeSampleWorkspace());
    collisionFile.scenarios.push({ id: "base", name: "Scenario named base", basePlanId: collisionFile.plans[0]!.meta.id, simMode: "deterministic", overrides: {} });
    collisionFile.projectionScenarioId = "base";
    const collision = parsePlanFile(collisionFile);
    expect(collision.ok).toBe(true);
    if (collision.ok) expect(collision.workspace.projectionScenarioId).toBe("base");

    const expandedWorkspace = makeSampleWorkspace();
    expandedWorkspace.projectionRunSummaryCollapsed = false;
    const expandedFile = buildPlanFile(expandedWorkspace);
    expect(expandedFile.projectionRunSummaryCollapsed).toBe(false);
    const expanded = parsePlanFile(expandedFile);
    expect(expanded.ok).toBe(true);
    if (expanded.ok) expect(expanded.workspace.projectionRunSummaryCollapsed).toBe(false);
  });

  it("round-trips the active projection tab and Sankey range; legacy JSON without them keeps defaults", () => {
    const ws = makeSampleWorkspace();
    ws.projectionActiveTab = "cashflow";
    ws.projectionSankeyRange = { startYear: 2030, endYear: 2038 };
    const file = buildPlanFile(ws);
    expect(file.projectionActiveTab).toBe("cashflow");
    expect(file.projectionSankeyRange).toEqual({ startYear: 2030, endYear: 2038 });
    const parsed = parsePlanFile(JSON.parse(planFileToText(file)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.workspace.projectionActiveTab).toBe("cashflow");
      expect(parsed.workspace.projectionSankeyRange).toEqual({ startYear: 2030, endYear: 2038 });
      expect(parsed.planFile.projectionActiveTab).toBe("cashflow");
      expect(parsed.planFile.projectionSankeyRange).toEqual({ startYear: 2030, endYear: 2038 });
    }
    const legacy = parsePlanFile(JSON.parse(workspaceToText(makeSampleWorkspace())));
    expect(legacy.ok).toBe(true);
    if (legacy.ok) {
      expect(legacy.workspace.projectionActiveTab).toBeUndefined();
      expect(legacy.workspace.projectionSankeyRange).toBeUndefined();
      expect("projectionActiveTab" in buildPlanFile(legacy.workspace)).toBe(false);
      expect("projectionSankeyRange" in buildPlanFile(legacy.workspace)).toBe(false);
    }
  });

  it("maps a stale imported projection scenario id to explicit baseline", () => {
    const file = buildPlanFile(makeSampleWorkspace());
    file.projectionScenarioId = "removed-scenario";
    const parsed = parsePlanFile(file);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workspace.projectionScenarioId).toBe("");
  });

  it.each([true, false, undefined])("round-trips the Sankey account preference %s through JSON", (showAccounts) => {
    const workspace = makeSampleWorkspace();
    if (showAccounts !== undefined) workspace.projectionSankeyShowAccounts = showAccounts;
    const json = JSON.parse(workspaceToText(workspace));
    expect(json.projectionSankeyShowAccounts).toBe(showAccounts);
    const restored = parsePlanFile(json);
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.workspace.projectionSankeyShowAccounts).toBe(showAccounts);
  });

  it("exports valid plan, account, base, scenario, mode and projection configuration together", () => {
    const ws = makeSampleWorkspace({ id: "prefs-plan" });
    const nonreg = ws.plan.accounts.find(account => account.type === "nonreg")!;
    nonreg.name = "Joint investments";
    nonreg.bookValue = 21_500;
    nonreg.assetMix = { equity: 0.55, bond: 0.35, cash: 0.1 };
    ws.plan.accounts.push({ id: "cash-savings", name: "Savings", type: "cash", balance: 12_500, interestRate: 0.035 });
    ws.plan.assets[0]!.sellEvent = { age: 72, costsPct: 0.025 };
    ws.plan.debts[0]!.paymentFrequency = "biweekly";
    const employment = ws.plan.incomes.find(income => income.kind === "employment")!;
    employment.name = "Work income";
    delete employment.endAtRetirement;
    employment.endAge = 64;
    ws.plan.expenses[0]!.endAge = 94;
    ws.plan.savingsPolicy[0]!.untilAge = 64;
    ws.baseScenario = {
      simMode: "montecarlo", retirementAge: 62,
      returnAssumptions: { equity: 0.045, bond: 0.018, cash: 0.005 },
      withdrawalOrder: ["cash", "tfsa", "nonreg", "rrsp"],
      mcConfig: { runs: 250, stdDev: { equity: 0.16, bond: 0.05, cash: 0.01 }, seed: 1872 },
      benefits: { cpp: false, oas: true, gis: false }, withdrawalStrategy: "tax-minimizing",
    };
    ws.scenarios[0] = {
      ...ws.scenarios[0]!, simMode: "montecarlo", mcConfig: { runs: 500, stdDev: { equity: 0.18, bond: 0.06, cash: 0.01 }, seed: 91_827 },
      benefits: { cpp: true, oas: true, gis: true }, withdrawalStrategy: "manual",
      overrides: { retirementAge: 64, withdrawalOrder: ["tfsa", "cash", "nonreg", "rrsp"] },
    };
    ws.scenarios.push({
      id: "history", name: "Historical windows", basePlanId: "prefs-plan", simMode: "historical",
      historicalConfig: { startYear: 1929 }, benefits: { cpp: false, oas: true, gis: false },
      withdrawalStrategy: "tax-minimizing", overrides: { returnAssumptions: { equity: 0.04, bond: 0.015, cash: 0 } },
    });
    ws.projectionScenarioId = "sample";
    ws.projectionRunSummaryCollapsed = true;
    ws.hiddenProjectionColumns = ["tax.total"];
    ws.hiddenProjectionCharts = ["net-worth"];

    const text = workspaceToText(ws);
    const parsed = parsePlanFile(JSON.parse(text));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(buildPlanFile(parsed.workspace)).toEqual(buildPlanFile(ws));
      expect(parsed.workspace.plan.accounts.find(account => account.type === "cash")).toMatchObject({ balance: 12_500, interestRate: 0.035 });
      expect(parsed.workspace.plan.accounts.find(account => account.type === "nonreg")).toMatchObject({ bookValue: 21_500, assetMix: { equity: 0.55, bond: 0.35, cash: 0.1 } });
    }
  });

  it("round-trips an employment bonus rate; legacy files without it (or with an explicit 0) load unchanged", () => {
    const ws = makeSampleWorkspace();
    const salary = ws.plan.incomes.find(income => income.kind === "employment")!;
    salary.bonusRate = 0.1;
    const parsed = parsePlanFile(JSON.parse(workspaceToText(ws)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.workspace.plan.incomes.find(income => income.kind === "employment")?.bonusRate).toBe(0.1);
      expect(buildPlanFile(parsed.workspace)).toEqual(buildPlanFile(ws));
    }
    // Legacy file: no bonusRate key anywhere — loads with the field absent.
    const legacy = parsePlanFile(JSON.parse(workspaceToText(makeSampleWorkspace())));
    expect(legacy.ok).toBe(true);
    if (legacy.ok) {
      const legacySalary = legacy.workspace.plan.incomes.find(income => income.kind === "employment")!;
      expect("bonusRate" in legacySalary).toBe(false);
    }
    // Explicit zero is a valid stored value and survives the round trip.
    const zero = makeSampleWorkspace();
    (zero.plan.incomes.find(income => income.kind === "employment") as { bonusRate?: number }).bonusRate = 0;
    const zeroParsed = parsePlanFile(JSON.parse(workspaceToText(zero)));
    expect(zeroParsed.ok).toBe(true);
    if (zeroParsed.ok) {
      expect(zeroParsed.workspace.plan.incomes.find(income => income.kind === "employment")?.bonusRate).toBe(0);
    }
  });

  it("records migratedFrom for pre-versioning files", () => {
    const raw = JSON.parse(JSON.stringify(buildPlanFile(makeSampleWorkspace()))) as Record<string, unknown>;
    delete raw.schemaVersion;
    const parsed = parsePlanFile(raw);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.migratedFrom).toBe(0);
  });

  it("hard-blocks future schema versions with a named-window error", () => {
    const raw = { ...JSON.parse(JSON.stringify(buildPlanFile(makeSampleWorkspace()))), schemaVersion: 99 };
    const parsed = parsePlanFile(raw);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.errors.join(" ")).toMatch(/newer version of RetirePlan/);
    }
  });

  it("returns a usable errors array for garbage payloads", () => {
    expect(parsePlanFile("a string, not an object").ok).toBe(false);
    expect(parsePlanFile({}).ok).toBe(false);
    expect(parsePlanFile({ schemaVersion: SCHEMA_VERSION, plans: [], scenarios: [] }).ok).toBe(false);
  });

  it("rejects semantically invalid plans through the engine gate", () => {
    const ws = makeSampleWorkspace();
    const broken = JSON.parse(JSON.stringify(ws)) as Workspace;
    broken.plan.accounts[0]!.balance = -3;
    const text = JSON.stringify(buildPlanFile(broken));
    const parsed = parsePlanFile(JSON.parse(text));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.length).toBeGreaterThan(0);
  });

  it("produces a workspace that satisfies validateWorkspace", () => {
    const parsed = parsePlanFile(JSON.parse(workspaceToText(makeSampleWorkspace())));
    if (parsed.ok) expect(validateWorkspace(parsed.workspace)).toEqual([]);
  });

  it("treats scenarios of a single-plan file as loadable even with stray basePlanId", () => {
    const file = buildPlanFile(makeSampleWorkspace());
    file.scenarios.push({
      id: "extra", name: "Extra", basePlanId: "whatever", simMode: "deterministic", overrides: {},
    });
    const parsed = parsePlanFile(JSON.parse(JSON.stringify(file)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workspace.scenarios).toHaveLength(2);
  });
});

it("rejects multi-plan imports instead of silently discarding plans", () => {
  const file = buildPlanFile(makeSampleWorkspace());
  file.plans.push({ ...file.plans[0]!, meta: { ...file.plans[0]!.meta, id: "second" } });
  const parsed = parsePlanFile(file);
  expect(parsed.ok).toBe(false);
  if (!parsed.ok) expect(parsed.errors.join(" ")).toMatch(/exactly one plan/);
});
