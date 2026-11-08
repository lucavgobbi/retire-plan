import { describe, expect, it } from "vitest";
import { validatePlan } from "../src/types";
import { makePlan } from "./fixtures";

describe("validatePlan", () => {
  it("accepts the minimal valid plan fixture with no errors", () => {
    expect(validatePlan(makePlan())).toEqual([]);
  });

  it("rejects a non-positive currentAge", () => {
    const plan = makePlan();
    plan.profile.currentAge = 0;
    const errors = validatePlan(plan);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("currentAge"))).toBe(true);
  });

  it("rejects endAge <= currentAge", () => {
    const plan = makePlan();
    plan.profile.endAge = plan.profile.currentAge;
    const errors = validatePlan(plan);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("endAge"))).toBe(true);
  });

  it("rejects a negative account balance", () => {
    const plan = makePlan();
    plan.accounts[0]!.balance = -1;
    const errors = validatePlan(plan);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("balance") && e.includes("rrsp-1"))).toBe(true);
  });

  it("rejects an assetMix whose components do not each stay >= 0 and sum to 1 within 0.001", () => {
    const plan = makePlan();
    plan.accounts[0]!.assetMix = { equity: 0.9, bond: 0.3, cash: -0.2 };
    const errors = validatePlan(plan);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("assetMix") && e.includes("rrsp-1"))).toBe(true);
  });

  it("rejects a mortgage with non-positive balance or payment", () => {
    const plan = makePlan();
    plan.debts[0]!.monthlyPayment = 0;
    const errors = validatePlan(plan);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("monthlyPayment") && e.includes("mortgage-1"))).toBe(true);
  });

  it("rejects an income that ends before it starts", () => {
    const plan = makePlan();
    plan.incomes[0]!.endAge = plan.incomes[0]!.startAge - 1;
    const errors = validatePlan(plan);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("salary") && e.includes("endAge"))).toBe(true);
  });

  it("rejects an inconsistent savings/withdrawal target", () => {
    const plan = makePlan();
    // PerYearCap must not be negative on a policy step
    plan.savingsPolicy[0]!.perYearCap = -100;
    const errors = validatePlan(plan);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.includes("save-tfsa") && e.includes("perYearCap"))).toBe(true);
  });
});
