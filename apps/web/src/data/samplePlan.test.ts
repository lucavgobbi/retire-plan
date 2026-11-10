import { describe, expect, it } from "vitest";
import { validatePlan } from "@retire-plan/engine";
import { makeSamplePlan, makeSampleWorkspace } from "./samplePlan";
import { validateWorkspace } from "../storage/schema";

describe("sample plan (golden fixture mirror)", () => {
  it("passes the engine's validatePlan gate", () => {
    expect(validatePlan(makeSamplePlan())).toEqual([]);
  });

  it("mirrors the golden fixture shape exactly (origin: packages/engine/tests/golden/samplePlan.ts, copied 2026-11-10)", () => {
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

  it("matches the golden incomes/debts/policies verbatim", () => {
    const plan = makeSamplePlan();
    expect(plan.incomes.map((i) => i.id)).toEqual(["salary", "cpp", "oas"]);
    // No endAge on salary: the golden fixture omits it (its intent is Task 16-B3's
    // open question) — the mirror stays faithful rather than "fixing" it.
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

  it("carries a golden-equivalent deterministic scenario delta", () => {
    const ws = makeSampleWorkspace();
    expect(ws.scenarios[0]).toMatchObject({
      id: "sample",
      name: "Golden sample",
      simMode: "deterministic",
      overrides: {},
    });
    expect(ws.scenarios[0]!.basePlanId).toBe(ws.meta?.id);
  });

  it("accepts meta overrides for the recovery 'start with sample plan' flow", () => {
    const ws = makeSampleWorkspace({ id: "fixed-id", name: "Sampler", updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(ws.meta).toEqual({ id: "fixed-id", name: "Sampler", updatedAt: "2026-01-01T00:00:00.000Z" });
    expect(ws.scenarios[0]!.basePlanId).toBe("fixed-id");
  });
});
