import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO_BASE } from "./defaults";
import { resolveScenario } from "./scenario";
import type { ScenarioDelta } from "./types";

describe("scenario resolution", () => {
  it("inherits working settings, applies every explicit override, and isolates mutable inputs", () => {
    const base = structuredClone(DEFAULT_SCENARIO_BASE);
    base.retirementAge = 67;
    const delta: ScenarioDelta = { id: "early", name: "Early", basePlanId: "plan", simMode: "deterministic", overrides: {} };
    expect(resolveScenario(delta, base).retirementAge).toBe(67);
    delta.overrides = { retirementAge: 60, returnAssumptions: { equity: 0, bond: -0.01, cash: 0.02 }, withdrawalOrder: ["rrsp", "tfsa", "nonreg"] };
    const resolved = resolveScenario(delta, base);
    expect(resolved).toMatchObject({ id: "early", name: "Early", simMode: "deterministic", ...delta.overrides });
    resolved.withdrawalOrder.reverse();
    resolved.returnAssumptions.equity = 1;
    expect(delta.overrides.withdrawalOrder).toEqual(["rrsp", "tfsa", "nonreg"]);
    expect(delta.overrides.returnAssumptions?.equity).toBe(0);
    expect(resolveScenario(null, base)).toMatchObject({ id: "base", retirementAge: 67 });
  });
});
