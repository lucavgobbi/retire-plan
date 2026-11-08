import { describe, expect, it } from "vitest";
import tablesJson from "../../data/tax/ca-2026.json";
import { applyIndexation, loadTables, type TaxYearTables } from "../../src/tax/tables";
import { federalTax, taxableIncome, type IncomeForTax } from "../../src/tax/federal";

const tables: TaxYearTables = loadTables(tablesJson);

// Reference arithmetic constants from data/tax/ca-2026.json (2026, verified in SOURCES.md):
//   brackets: 58,523 @ 14%; 117,045 @ 20.5%; 181,440 @ 26%; 258,482 @ 29%; then 33%
//   BPA = 16,452; employment amount max = 1,501; lowest credit rate = 14%
//   age amount = 9,208, reduced 15% of income over 46,432 (age >= 65 only)
//   pension income amount = 2,000 (capped at eligible pension income; no phase-out)
//
// All expected values below are hand-computed from these constants, never by calling
// federalTax as the oracle.

function income(overrides: Partial<IncomeForTax> = {}): IncomeForTax {
  return {
    employmentIncome: 0,
    otherTaxableIncome: 0,
    rrspWithdrawals: 0,
    pensionEligibleIncome: 0,
    capitalGains: 0,
    dividendsEligible: 0,
    age: 45,
    ...overrides,
  };
}

describe("taxableIncome", () => {
  it("sums taxable sources with capital gains at 50% inclusion", () => {
    // 20,000 + 5,000 + 10,000 + 100,000 x 0.5 = 85,000
    expect(
      taxableIncome(
        income({
          employmentIncome: 20_000,
          otherTaxableIncome: 5_000,
          rrspWithdrawals: 10_000,
          capitalGains: 100_000,
        }),
      ),
    ).toBe(85_000);
  });

  it("treats pensionEligibleIncome as an annotation, not an extra source (subset rule)", () => {
    // A 60k RRIF withdrawal flagged as pension-credit-eligible is taxable only once.
    expect(
      taxableIncome(income({ rrspWithdrawals: 60_000, pensionEligibleIncome: 60_000 })),
    ).toBe(60_000);
  });

  it("rejects eligible dividends (v1 models them off)", () => {
    expect(() => taxableIncome(income({ dividendsEligible: 1_000 }))).toThrow(/dividend/i);
  });
});

describe("federalTax — hand-computed zones", () => {
  it("zero income pays nothing", () => {
    const r = federalTax(income(), tables);
    expect(r.taxable).toBe(0);
    expect(r.grossTax).toBe(0);
    expect(r.tax).toBe(0);
  });

  it("income under the basic personal amount is fully offset to $0", () => {
    // gross = 10,000 x 0.14 = 1,400
    // credits = 0.14 x (16,452 + 1,501) = 0.14 x 17,953 = 2,513.42 > gross
    const r = federalTax(income({ employmentIncome: 10_000 }), tables);
    expect(r.taxable).toBe(10_000);
    expect(r.grossTax).toBeCloseTo(1_400, 4);
    expect(r.credits).toBeCloseTo(2_513.42, 4);
    expect(r.tax).toBe(0);
  });

  it("first bracket: 80,000 employment", () => {
    // gross = 58,523 x 0.14 + 21,477 x 0.205 = 8,193.22 + 4,402.785 = 12,596.005
    // credits = 2,513.42
    const r = federalTax(income({ employmentIncome: 80_000 }), tables);
    expect(r.grossTax).toBeCloseTo(12_596.005, 4);
    expect(r.tax).toBeCloseTo(10_082.585, 4);
  });

  it("middle bracket: 120,000 employment (crosses into the 26% bracket; age credit reduced out)", () => {
    // gross = 8,193.22 (first bracket) + 58,522 x 0.205 (to 117,045) + 2,955 x 0.26
    //       = 8,193.22 + 11,997.01 + 768.30 = 20,958.53
    // age amount = max(0, 9,208 - 0.15 x (120,000 - 46,432)) = max(0, 9,208 - 11,035.2) = 0
    // credits = 0.14 x (16,452 + 1,501) = 2,513.42
    const r = federalTax(income({ employmentIncome: 120_000 }), tables);
    expect(r.grossTax).toBeCloseTo(20_958.53, 3);
    expect(r.tax).toBeCloseTo(18_445.11, 3);
  });

  it("top bracket: 300,000 employment", () => {
    // gross = 8,193.22
    //       + 58,522 x 0.205 = 11,997.01
    //       + 64,395 x 0.26  = 16,742.70
    //       + 77,042 x 0.29  = 22,342.18
    //       + 41,518 x 0.33  = 13,700.94
    //       = 72,976.05
    // credits = 2,513.42 -> tax = 70,462.63
    const r = federalTax(income({ employmentIncome: 300_000 }), tables);
    expect(r.grossTax).toBeCloseTo(72_976.05, 3);
    expect(r.tax).toBeCloseTo(70_462.63, 3);
  });

  it("capital gains get the 50% haircut", () => {
    // taxable = 100,000 x 0.5 = 50,000
    // gross = 50,000 x 0.14 = 7,000
    // credits = 0.14 x 16,452 = 2,303.28 -> tax = 4,696.72
    const r = federalTax(income({ capitalGains: 100_000 }), tables);
    expect(r.taxable).toBe(50_000);
    expect(r.grossTax).toBeCloseTo(7_000, 4);
    expect(r.tax).toBeCloseTo(4_696.72, 4);
  });
});

describe("federalTax — credits", () => {
  it("age credit appears at 65 and is not reduced at this income", () => {
    // Same 60,000 RRIF income (crosses the 58,523 threshold), age 64 vs 65.
    // gross = 58,523 x 0.14 + 1,477 x 0.205 = 8,193.22 + 302.785 = 8,496.005
    // age 64: credits = 0.14 x 16,452 = 2,303.28 -> tax 6,192.725
    // age 65: age amount = 9,208 - 0.15 x (60,000 - 46,432) = 9,208 - 2,035.2 = 7,172.8
    //         credits = 0.14 x (16,452 + 7,172.8) = 0.14 x 23,624.8 = 3,307.472 -> tax 5,188.533
    const r64 = federalTax(income({ rrspWithdrawals: 60_000, age: 64 }), tables);
    const r65 = federalTax(income({ rrspWithdrawals: 60_000, age: 65 }), tables);
    expect(r64.tax).toBeCloseTo(6_192.725, 4);
    expect(r65.tax).toBeCloseTo(5_188.533, 4);
    expect(r65.tax).toBeLessThan(r64.tax);
  });

  it("age credit is reduced to zero at high income", () => {
    // 120,000 employment at 65: age amount = 9,208 - 0.15 x (120,000 - 46,432) < 0 -> 0
    // identical to the age-45 result: 18,445.11
    const r = federalTax(income({ employmentIncome: 120_000, age: 65 }), tables);
    expect(r.tax).toBeCloseTo(18_445.11, 3);
  });

  it("pension income credit applies up to the eligible pension income (no phase-out in v1 law)", () => {
    // 60,000 RRIF withdrawal fully pension-eligible at age 70 (crosses 58,523):
    // gross = 8,193.22 + 1,477 x 0.205 = 8,496.005
    // age amount = 7,172.8 (see above)
    // pension credit = min(2,000, 60,000) = 2,000
    // credits = 0.14 x (16,452 + 7,172.8 + 2,000) = 0.14 x 25,624.8 = 3,587.472
    // tax = 4,908.533
    const r = federalTax(
      income({ rrspWithdrawals: 60_000, pensionEligibleIncome: 60_000, age: 70 }),
      tables,
    );
    expect(r.credits).toBeCloseTo(3_587.472, 4);
    expect(r.tax).toBeCloseTo(4_908.533, 4);
  });

  it("pension credit is capped by the eligible pension income, not the max", () => {
    // Only 1,000 pension-eligible: credit = min(2,000, 1,000) = 1,000.
    // employment 0, otherTaxableIncome 5,000 -> taxable 5,000, gross = 700.
    // credits = 0.14 x (16,452 + 1,000) = 2,443.28 -> tax 0
    const r = federalTax(
      income({ otherTaxableIncome: 5_000, pensionEligibleIncome: 1_000 }),
      tables,
    );
    expect(r.credits).toBeCloseTo(2_443.28, 4);
    expect(r.tax).toBe(0);
  });

  it("employment credit amount is capped at actual employment income", () => {
    // employment 8,000: employment amount = min(1,501, 8,000) = 1,501 -> credits 2,513.42
    // employment 1,000: employment amount = min(1,501, 1,000) = 1,000 -> credits 0.14 x 17,452
    const rBig = federalTax(income({ employmentIncome: 8_000 }), tables);
    expect(rBig.credits).toBeCloseTo(2_513.42, 4);
    const rSmall = federalTax(income({ employmentIncome: 1_000 }), tables);
    // gross = 140; credits = 0.14 x (16,452 + 1,000) = 2,443.28 -> tax 0
    expect(rSmall.tax).toBe(0);
    expect(rSmall.credits).toBeCloseTo(2_443.28, 4);
  });
});

describe("federalTax — bracket boundary invariance", () => {
  it("crossing the 58,523 threshold shifts tax by (0.14 + 0.205) x $1", () => {
    // Keep credits identical (employment held fixed), vary otherTaxableIncome to straddle:
    // taxable 58,522 vs 58,524, i.e. otherTaxable 38,522 vs 38,524 with employment 20,000.
    // tax(58,522) - tax(58,524) difference = 0.14 x 1 + 0.205 x 1 = 0.345
    const lo = federalTax(income({ employmentIncome: 20_000, otherTaxableIncome: 38_522 }), tables);
    const hi = federalTax(income({ employmentIncome: 20_000, otherTaxableIncome: 38_524 }), tables);
    expect(hi.grossTax - lo.grossTax).toBeCloseTo(0.345, 4);
    expect(hi.tax - lo.tax).toBeCloseTo(0.345, 4); // credits identical on both sides
  });

  it("crossing the 117,045 threshold shifts tax by (0.205 + 0.26) x $1", () => {
    // employment 20,000 + otherTaxableIncome 96,522 vs 96,524 -> taxable 116,522/116,524
    // ...use 117,045 boundary: employment 40,000, other 77,522 vs 77,524 => taxable 117,045-1 vs +1
    const lo = federalTax(income({ employmentIncome: 40_000, otherTaxableIncome: 77_044 }), tables); // taxable 117,044
    const hi = federalTax(income({ employmentIncome: 40_000, otherTaxableIncome: 77_046 }), tables); // taxable 117,046
    expect(hi.grossTax - lo.grossTax).toBeCloseTo(0.465, 4);
  });

  it("respects indexing: +2% indexing moves the first bracket start up", () => {
    // 2026 base: taxable 60,000 -> gross = 8,193.22 + 1,477 x 0.205 = 8,496.005
    const base = federalTax(income({ employmentIncome: 60_000 }), tables);
    expect(base.grossTax).toBeCloseTo(8_496.005, 3);
    // applyIndexation(tables, 1) raises the first threshold to 58,523 x 1.02 = 59,693.46:
    // gross = 59,693.46 x 0.14 + 306.54 x 0.205 = 8,357.0844 + 62.8407 = 8,419.9251
    const indexed = applyIndexation(tables, 1);
    const adj = federalTax(income({ employmentIncome: 60_000 }), indexed);
    expect(adj.grossTax).toBeCloseTo(8_419.9251, 3);
    expect(adj.grossTax).toBeLessThan(base.grossTax);
  });
});

describe("federalTax — floor and inputs", () => {
  it("never returns negative tax", () => {
    const r = federalTax(income({ employmentIncome: 100 }), tables);
    expect(r.tax).toBeGreaterThanOrEqual(0);
  });

  it("pension-eligible income earns the credit even with zero taxable income (tax floors at 0)", () => {
    // Eligible pension income 5,000 -> credit = min(2,000, 5,000) = 2,000.
    // credits = 0.14 x (16,452 + 2,000) = 2,583.28; taxable 0 -> grossTax 0 -> tax 0.
    const r = federalTax(income({ pensionEligibleIncome: 5_000 }), tables);
    expect(r.credits).toBeCloseTo(2_583.28, 4);
    expect(r.tax).toBe(0);
  });
});
