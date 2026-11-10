import { describe, expect, it } from "vitest";
import { createDefaultPlan, DEFAULT_SCENARIO_BASE } from "./defaults";
import { runDeterministic } from "./run";
import { resolveScenario } from "./scenario";

describe("deterministic domain runner", () => {
  it("returns reproducible age rows without changing the plan or exposing shared output", () => {
    const plan = createDefaultPlan();
    plan.profile.endAge = 47;
    plan.accounts = [{ id: "tfsa", type: "tfsa", balance: 100, assetMix: { equity: 1, bond: 0, cash: 0 } }];
    const before = structuredClone(plan);
    const scenario = resolveScenario(null, DEFAULT_SCENARIO_BASE);
    const first = runDeterministic(plan, scenario);
    const second = runDeterministic(plan, scenario);
    expect(first).toEqual(second);
    expect(first.years.map(year => year.age)).toEqual([45, 46, 47]);
    expect(first.years[0]?.balances.tfsa).toBe(105);
    expect(plan).toEqual(before);
    first.years[0]!.events.push("edited");
    expect(second.years[0]?.events).not.toContain("edited");
  });
  it("surfaces invalid plans and rejects unavailable simulation modes", () => {
    const plan = createDefaultPlan();
    plan.profile.endAge = 20;
    const scenario = resolveScenario(null, DEFAULT_SCENARIO_BASE);
    expect(() => runDeterministic(plan, scenario)).toThrow();
    expect(() => runDeterministic(createDefaultPlan(), { ...scenario, simMode: "montecarlo" })).toThrow("Only deterministic");
  });
});
