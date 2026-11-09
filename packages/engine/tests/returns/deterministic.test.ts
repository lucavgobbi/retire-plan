import { describe, expect, it } from "vitest";
import { buildDeterministicReturns } from "../../src/returns/deterministic";
import type { Scenario } from "../../src/types";

const assumptions: Scenario["returnAssumptions"] = { equity: 0.06, bond: 0.03, cash: 0.02 };

describe("buildDeterministicReturns", () => {
  it("emits one constant year per age, every year identical to the assumptions", () => {
    const series = buildDeterministicReturns(assumptions, 60, 63);
    expect(series.years.map((y) => y.age)).toEqual([60, 61, 62, 63]);
    for (const y of series.years) {
      expect(y.equity).toBe(0.06);
      expect(y.bond).toBe(0.03);
      expect(y.cash).toBe(0.02);
    }
  });

  it("a single-year horizon yields exactly one year", () => {
    const series = buildDeterministicReturns(assumptions, 70, 70);
    expect(series.years).toHaveLength(1);
  });

  it("an empty horizon (endAge before startAge) yields zero years", () => {
    const series = buildDeterministicReturns(assumptions, 65, 64);
    expect(series.years).toHaveLength(0);
  });
});
