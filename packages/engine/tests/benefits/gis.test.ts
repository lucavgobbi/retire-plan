import { describe, expect, it } from "vitest";
import tablesJson from "../../data/tax/ca-2026.json";
import { loadTables, type TaxYearTables } from "../../src/tax/tables";
import { gisAnnual, type GisIncomeSources } from "../../src/benefits/gis";

const tables: TaxYearTables = loadTables(tablesJson);

// Reference constants (2026, verified in data/tax/SOURCES.md):
//   gis.annualMaxSingle = 13,304.88 ($1,108.74/mo Jan-Mar 2026 quarter, single senior)
//   gis.taperRate = 0.5 (50 cents per dollar of GIS income)
//   gis.exclusionEmployment = 5,000 (first $5,000 of employment income excluded in v1;
//   the 50% band between $5,000 and $15,000 is a documented fast-follow)
//   GIS income = cpp + rrspRrifWithdrawals + otherTaxableIncome
//                + max(0, employmentIncome - 5,000); TFSA withdrawals are NEVER counted.
//   GIS = max(0, annualMaxSingle - taperRate x gisIncome), only for age >= 65.

function sources(overrides: Partial<GisIncomeSources> = {}): GisIncomeSources {
  return {
    cpp: 0,
    rrspRrifWithdrawals: 0,
    employmentIncome: 0,
    otherTaxableIncome: 0,
    tfsaWithdrawals: 0,
    ...overrides,
  };
}

describe("gisAnnual — hand-computed cases", () => {
  it("no other income at 65+ returns the full maximum", () => {
    expect(gisAnnual(66, sources(), tables)).toBeCloseTo(13_304.88, 4);
    expect(gisAnnual(85, sources(), tables)).toBeCloseTo(13_304.88, 4);
  });

  it("an RRSP withdrawal eats 50 cents per dollar", () => {
    // 10,000 RRIF withdrawal -> GIS income 10,000 -> reduction 5,000
    expect(gisAnnual(70, sources({ rrspRrifWithdrawals: 10_000 }), tables)).toBeCloseTo(
      13_304.88 - 5_000,
      4,
    );
  });

  it("a TFSA withdrawal leaves GIS untouched (Review Focus #1)", () => {
    // TFSA money is invisible to the GIS income test.
    expect(gisAnnual(70, sources({ tfsaWithdrawals: 10_000 }), tables)).toBeCloseTo(
      13_304.88,
      4,
    );
  });

  it("employment income uses the first $5,000 exemption", () => {
    // At or under the exemption: full GIS.
    expect(gisAnnual(66, sources({ employmentIncome: 5_000 }), tables)).toBeCloseTo(13_304.88, 4);
    expect(gisAnnual(66, sources({ employmentIncome: 4_000 }), tables)).toBeCloseTo(13_304.88, 4);
    // 25,000 employment -> taxable-for-GIS 20,000 -> reduction 10,000 -> 3,304.88
    expect(gisAnnual(66, sources({ employmentIncome: 25_000 }), tables)).toBeCloseTo(3_304.88, 4);
  });

  it("under 65 returns zero regardless of income", () => {
    expect(gisAnnual(64, sources(), tables)).toBe(0);
    expect(gisAnnual(64, sources({ rrspRrifWithdrawals: 10_000 }), tables)).toBe(0);
  });

  it("zeroes out (floors) once counted income covers the maximum", () => {
    // 40,000 other taxable -> reduction = 0.5 x 40,000 = 20,000 > 13,304.88 -> floor 0
    expect(gisAnnual(66, sources({ otherTaxableIncome: 40_000 }), tables)).toBe(0);
  });

  it("combines taxable sources before tapering", () => {
    // cpp 8,000 + RRIF 6,000 + other 2,000 = 16,000 -> reduction 8,000 -> 5,304.88
    expect(
      gisAnnual(
        68,
        sources({ cpp: 8_000, rrspRrifWithdrawals: 6_000, otherTaxableIncome: 2_000 }),
        tables,
      ),
    ).toBeCloseTo(5_304.88, 4);
  });

  it("the taper stays exactly 50 cents per dollar near the top of the range", () => {
    const a = gisAnnual(70, sources({ rrspRrifWithdrawals: 1_000 }), tables);
    const b = gisAnnual(70, sources({ rrspRrifWithdrawals: 1_001 }), tables);
    expect(a - b).toBeCloseTo(0.5, 8);
  });

  it("GIS at exactly age 65 is payable", () => {
    expect(gisAnnual(65, sources(), tables)).toBeCloseTo(13_304.88, 4);
  });
});
