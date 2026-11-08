import { describe, expect, it } from "vitest";
import tablesJson from "../../data/tax/ca-2026.json";
import { applyIndexation, loadTables, type TaxYearTables } from "../../src/tax/tables";
import { oasClawback } from "../../src/tax/oasClawback";

const tables: TaxYearTables = loadTables(tablesJson);

// Reference constants (2026, verified in data/tax/SOURCES.md):
//   oas.clawbackThreshold = 95,323 ; oas.recoveryRate = 0.15 (15 cents per dollar over).
// The recovery threshold scales with the federal indexation factor under applyIndexation.

describe("oasClawback — hand-computed", () => {
  it("is zero below the threshold", () => {
    expect(oasClawback(95_000, tables)).toBe(0);
  });

  it("is exactly zero at the threshold", () => {
    expect(oasClawback(95_323, tables)).toBe(0);
  });

  it("is linear just above the threshold", () => {
    // 96,323 - 95,323 = 1,000 -> 0.15 x 1,000 = 150
    expect(oasClawback(96_323, tables)).toBeCloseTo(150, 8);
  });

  it("high income: 15% of the entire excess", () => {
    // 200,000 - 95,323 = 104,677 -> 0.15 x 104,677 = 15,701.55
    expect(oasClawback(200_000, tables)).toBeCloseTo(15_701.55, 8);
  });

  it("marginal rate on the excess is invariantly 15%", () => {
    const a = oasClawback(120_000, tables);
    const b = oasClawback(120_001, tables);
    expect(b - a).toBeCloseTo(0.15, 8);
  });

  it("scales with the federal indexation factor in future projection years", () => {
    // applyIndexation(tables, 1): threshold = 95,323 x 1.02 = 97,229.46
    // 100,000 -> 0.15 x (100,000 - 97,229.46) = 0.15 x 2,770.54 = 415.581
    const next = applyIndexation(tables, 1);
    expect(oasClawback(100_000, next)).toBeCloseTo(415.581, 6);
    // same income pays less (not more) under indexation
    expect(oasClawback(100_000, next)).toBeLessThan(oasClawback(100_000, tables));
  });

  it("never returns negative for income below the threshold", () => {
    expect(oasClawback(10_000, tables)).toBe(0);
  });
});
