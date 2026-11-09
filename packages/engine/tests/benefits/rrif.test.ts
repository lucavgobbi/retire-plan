import { describe, expect, it } from "vitest";
import tablesJson from "../../data/tax/ca-2026.json";
import { loadTables, type TaxYearTables } from "../../src/tax/tables";
import { rrifMinimum } from "../../src/benefits/rrif";

const tables: TaxYearTables = loadTables(tablesJson);

// Reference constants (2026, verified in data/tax/SOURCES.md):
//   rrif.minimumFactors: age 71 -> 5.28%, 80 -> 6.79%, 94 -> 12.34%, 95+ -> 20% (cap).
//   RRIF minimum withdrawal = minimumFactor(age) x opening balance.
//   A person has no RRIF before age 71 (the year after the RRSP matures):
//   rrifMinimum returns null for age < 71 — pulling a minimum earlier is a caller error.

describe("rrifMinimum — hand-computed schedule cases", () => {
  it("rejects a fractional age as invalid input — never a silent null", () => {
    // null means "no RRIF exists yet"; a fractional age is a caller bug and must throw
    // rather than masquerade as the not-yet-a-holder null.
    expect(() => rrifMinimum(71.5, 100_000, tables)).toThrow(/integer/i);
    expect(() => rrifMinimum(94.999, 100_000, tables)).toThrow(/integer/i);
    expect(() => rrifMinimum(85.5, 0, tables)).toThrow(/integer/i);
  });

  it("returns null below age 71 (no RRIF exists yet)", () => {
    expect(rrifMinimum(65, 100_000, tables)).toBeNull();
    expect(rrifMinimum(70, 100_000, tables)).toBeNull();
    expect(rrifMinimum(0, 100_000, tables)).toBeNull();
  });

  it("pins the age-71 factor at 5.28%", () => {
    // 5.28% x 400,000 = 21,120
    expect(rrifMinimum(71, 400_000, tables)).toEqual({ minimum: 21_120, factor: 0.0528 });
  });

  it("pins the age-80 factor at 6.79%", () => {
    // 6.79% x 250,000 = 16,975
    expect(rrifMinimum(80, 250_000, tables)).toEqual({ minimum: 16_975, factor: 0.0679 });
  });

  it("pins the age-94 factor at 12.34%", () => {
    // 12.34% x 300,000 = 37,020
    expect(rrifMinimum(94, 300_000, tables)).toEqual({ minimum: 37_020, factor: 0.1234 });
  });

  it("pins the age-95 cap at 20%", () => {
    // 20% x 200,000 = 40,000
    expect(rrifMinimum(95, 200_000, tables)).toEqual({ minimum: 40_000, factor: 0.2 });
  });

  it("ages above 95 stay capped at 20%", () => {
    expect(rrifMinimum(96, 100_000, tables)).toEqual({ minimum: 20_000, factor: 0.2 });
    expect(rrifMinimum(104, 100_000, tables)).toEqual({ minimum: 20_000, factor: 0.2 });
  });

  it("minimum is exactly factor times balance, on unexpected ages between pins too", () => {
    // age 85 -> 8.11% x 123,456.78
    const r = rrifMinimum(85, 123_456.78, tables);
    expect(r).not.toBeNull();
    expect(r!.factor).toBe(0.0811);
    expect(r!.minimum).toBeCloseTo(0.0811 * 123_456.78, 8);
  });

  it("zero balance yields a zero minimum but still the table factor", () => {
    expect(rrifMinimum(75, 0, tables)).toEqual({ minimum: 0, factor: 0.0582 });
  });

  it("the minimum is monotonically non-decreasing in age for a fixed balance", () => {
    let prev = 0;
    for (let age = 71; age <= 95; age++) {
      const r = rrifMinimum(age, 100_000, tables);
      expect(r).not.toBeNull();
      if (age < 95) expect(r!.minimum).toBeGreaterThanOrEqual(prev);
      prev = r!.minimum;
    }
  });
});
