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

  it("resolves Monte Carlo configuration into the engine scenario without sharing mutable values", () => {
    const base = { ...structuredClone(DEFAULT_SCENARIO_BASE), mcConfig: { runs: 500, seed: 7, stdDev: { equity: 0.18, bond: 0.06, cash: 0.02 } } };
    const delta: ScenarioDelta = { id: "mc", name: "Monte Carlo", basePlanId: "p", simMode: "montecarlo", overrides: {} };
    const inherited = resolveScenario(delta, base);
    expect(inherited.simMode).toBe("montecarlo");
    expect(inherited.mcConfig).toEqual(base.mcConfig);
    inherited.mcConfig!.stdDev.equity = 0.5;
    expect(base.mcConfig.stdDev.equity).toBe(0.18);
    delta.mcConfig = { runs: 20, seed: 9, stdDev: { equity: 0.2, bond: 0, cash: 0 } };
    expect(resolveScenario(delta, base).mcConfig).toEqual(delta.mcConfig);
  });

  it("defaults legacy benefit settings to enabled and manual withdrawal strategy", () => {
    const legacyBase = { ...DEFAULT_SCENARIO_BASE };
    delete (legacyBase as Partial<typeof legacyBase>).benefits;
    delete (legacyBase as Partial<typeof legacyBase>).withdrawalStrategy;
    const legacyDelta: ScenarioDelta = { id: "legacy", name: "Legacy", basePlanId: "p", simMode: "deterministic", overrides: {} };
    expect(resolveScenario(legacyDelta, legacyBase)).toMatchObject({
      benefits: { cpp: true, oas: true, gis: true }, withdrawalStrategy: "manual",
    });
  });

  it("applies scenario benefit and strategy overrides without mutating the base", () => {
    const delta: ScenarioDelta = {
      id: "tax", name: "Tax plan", basePlanId: "p", simMode: "deterministic", overrides: {},
      benefits: { cpp: true, oas: false, gis: false }, withdrawalStrategy: "tax-minimizing",
    };
    const resolved = resolveScenario(delta, DEFAULT_SCENARIO_BASE);
    expect(resolved.benefits).toEqual(delta.benefits);
    expect(resolved.withdrawalStrategy).toBe("tax-minimizing");
    expect(resolved.benefits).not.toBe(delta.benefits);
  });
});
