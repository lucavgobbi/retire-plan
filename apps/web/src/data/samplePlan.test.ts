import { describe, expect, it } from "vitest";
import { validatePlan } from "@retire-plan/engine";
import { makeSamplePlan, makeSampleWorkspace } from "./samplePlan";
import { validateWorkspace } from "../storage/schema";
import { parsePlanFile, workspaceToText } from "../storage/exportImport";

describe("built-in sample plan", () => {
  it("passes the engine's validatePlan gate", () => {
    expect(validatePlan(makeSamplePlan())).toEqual([]);
  });

  it("uses the golden fixture's profile and starting accounts", () => {
    const plan = makeSamplePlan();
    expect(plan.profile).toEqual({ birthYear: 1981, currentAge: 45, province: "ON", endAge: 95 });
    expect(plan.accounts.map((a) => [a.id, a.type, a.balance])).toEqual([
      ["rrsp", "rrsp", 180_000],
      ["tfsa", "tfsa", 60_000],
      ["nonreg", "nonreg", 40_000],
    ]);
    const nonreg = plan.accounts.find((a) => a.type === "nonreg")!;
    // The golden fixture omits bookValue — the sample mirrors it (Task 10 pin faithfulness).
    expect("bookValue" in nonreg).toBe(false);
    expect(plan.accounts.every((a) => a.assetMix)).toBe(true);
  });

  it("links the sample salary to retirement and preserves the other income, debt and policy settings", () => {
    const plan = makeSamplePlan();
    expect(plan.incomes.map((i) => i.id)).toEqual(["salary", "cpp", "oas"]);
    expect(plan.incomes[0]!.endAtRetirement).toBe(true);
    expect("endAge" in plan.incomes[0]!).toBe(false);
    expect(plan.incomes.find((i) => i.kind === "oas")?.annualAmount).toBe(8_907.72);
    expect(plan.debts[0]).toMatchObject({
      id: "mortgage", rate: 0.045, balance: 350_000, monthlyPayment: 1_930,
    });
    expect(plan.savingsPolicy.map((s) => [s.id, s.priority])).toEqual([["tfsa", 1], ["rrsp", 2]]);
    expect(plan.assets[0]).toMatchObject({ id: "home", value: 700_000, appreciationRate: 0.02 });
  });
});

describe("makeSampleWorkspace", () => {
  it("builds a workspace that passes the structural gate (recovery-ladder ready)", () => {
    const ws = makeSampleWorkspace();
    expect(validateWorkspace(ws)).toEqual([]);
    expect(ws.meta?.name).toBe("Sample plan");
    expect(ws.plan.profile.currentAge).toBe(45);
  });

  it("carries a deterministic scenario that inherits the base settings", () => {
    const ws = makeSampleWorkspace();
    expect(ws.scenarios[0]).toMatchObject({
      id: "sample",
      name: "Golden sample",
      simMode: "deterministic",
      overrides: {},
    });
    expect(ws.scenarios[0]!.basePlanId).toBe(ws.meta?.id);
  });

  it("round-trips linked, fixed and ongoing employment schedules through plan JSON", () => {
    const ws = makeSampleWorkspace();
    const salary = ws.plan.incomes[0]!;
    const { endAtRetirement: _link, ...legacy } = salary;
    ws.plan.incomes.push({ ...legacy, id: "fixed", endAge: 67 }, { ...legacy, id: "ongoing" });
    const parsed = parsePlanFile(JSON.parse(workspaceToText(ws)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.workspace.plan.incomes).toEqual(ws.plan.incomes);
  });

  it("accepts meta overrides for the recovery 'start with sample plan' flow", () => {
    const ws = makeSampleWorkspace({ id: "fixed-id", name: "Sampler", updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(ws.meta).toEqual({ id: "fixed-id", name: "Sampler", updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(ws.scenarios[0]!.basePlanId).toBe("fixed-id");
  });
});
