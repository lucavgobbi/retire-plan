import { describe, expect, it } from "vitest";
import { buildHistoricalReturns, type HistoricalReturnObservation } from "../../src/returns/historical";

const observations: HistoricalReturnObservation[] = [
  { year: 2000, equity: -0.1, bond: 0.04, cash: 0.05 },
  { year: 2001, equity: 0.08, bond: -0.02, cash: 0.03 },
  { year: 2002, equity: 0.12, bond: 0.06, cash: 0.02 },
];

describe("buildHistoricalReturns", () => {
  it("maps observed years to consecutive ages without changing historical returns", () => {
    expect(buildHistoricalReturns(observations, 2001, 65, 66)).toEqual({ years: [
      { age: 65, equity: 0.08, bond: -0.02, cash: 0.03 },
      { age: 66, equity: 0.12, bond: 0.06, cash: 0.02 },
    ] });
  });
  it("rejects incomplete, duplicate, malformed, and impossible windows", () => {
    expect(() => buildHistoricalReturns(observations, 2002, 65, 66)).toThrow(/no observation for 2003/);
    expect(() => buildHistoricalReturns([...observations, observations[0]!], 2000, 65, 65)).toThrow(/duplicate/);
    expect(() => buildHistoricalReturns([{ ...observations[0]!, equity: Number.NaN }], 2000, 65, 65)).toThrow(/finite/);
    expect(() => buildHistoricalReturns([{ ...observations[0]!, bond: -1.01 }], 2000, 65, 65)).toThrow(/-100%/);
    expect(() => buildHistoricalReturns(observations, 2000, 65.5, 66)).toThrow(/whole ages/);
  });
});
