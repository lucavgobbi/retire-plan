import type { ReturnSeries, Scenario } from "../types";

/**
 * The deterministic leg of the return series: every year returns exactly the
 * scenario's `returnAssumptions`. Ages run startAge..endAge inclusive — one
 * `years` entry per simulated year.
 */
export function buildDeterministicReturns(
  assumptions: Scenario["returnAssumptions"],
  startAge: number,
  endAge: number,
): ReturnSeries {
  const years: ReturnSeries["years"] = [];
  for (let age = startAge; age <= endAge; age++) {
    years.push({ age, equity: assumptions.equity, bond: assumptions.bond, cash: assumptions.cash });
  }
  return { years };
}
