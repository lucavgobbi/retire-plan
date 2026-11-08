import { describe, expect, it } from "vitest";
import tablesJson from "../../data/tax/ca-2026.json";
import { applyIndexation, loadTables, type TaxYearTables } from "../../src/tax/tables";

const tables = loadTables(tablesJson);

/** Minimal fixture with distinct per-province factors so federal/ON scaling can be told apart. */
function fixtureTables(federalFactor: number, onFactor: number): TaxYearTables {
  return {
    year: 2026,
    province: "ON",
    federal: {
      brackets: [
        { threshold: 0, rate: 0.14 },
        { threshold: 50_000, rate: 0.2 },
        { threshold: 100_000, rate: 0.3 },
      ],
      basicPersonalAmount: 40_000,
      indexationFactor: federalFactor,
      ageCredit: { amount: 8_000, reductionThreshold: 45_000, reductionRate: 0.15 },
      employmentCreditAmount: 1_500,
      pensionIncomeCredit: { amount: 2_000, incomeThreshold: 90_000, reductionRate: 0.15 },
    },
    ontario: {
      brackets: [
        { threshold: 0, rate: 0.05 },
        { threshold: 50_000, rate: 0.09 },
      ],
      surtax: [
        { rate: 0.2, onTaxOverPctOfTaxable: 80_000 },
        { rate: 0.2, onTaxOverPctOfTaxable: 110_000 },
      ],
      basicPersonalAmount: 12_000,
      indexationFactor: onFactor,
    },
    oas: { annualMax: 8_000, clawbackThreshold: 90_000, recoveryRate: 0.15 },
    gis: { annualMaxSingle: 10_000, taperRate: 0.5, exclusionEmployment: 5_000 },
    rrif: {
      minimumFactors: [
        { age: 71, factor: 0.0528 },
        { age: 72, factor: 0.054 },
        { age: 73, factor: 0.0553 },
      ],
    },
    tfsa: { annualLimit: 7_000, cumulativeRoomAsOf2026: 102_000, roomStartAge: 18 },
    rrsp: { incomeRate: 0.18, annualLimit: 33_000 },
  };
}

describe("ca-2026 tax tables schema and invariants", () => {
  it("loads as the 2026 Ontario year tables", () => {
    expect(tables.year).toBe(2026);
    expect(tables.province).toBe("ON");
  });

  it("federal brackets: sorted ascending, strictly-increasing rates, starting at 0", () => {
    expect(tables.federal.brackets[0]!.threshold).toBe(0);
    for (let i = 1; i < tables.federal.brackets.length; i++) {
      const prev = tables.federal.brackets[i - 1]!;
      const cur = tables.federal.brackets[i]!;
      expect(cur.threshold).toBeGreaterThan(prev.threshold);
      expect(cur.rate).toBeGreaterThan(prev.rate);
    }
  });

  it("ontario brackets: sorted ascending, strictly-increasing rates, starting at 0", () => {
    expect(tables.ontario.brackets[0]!.threshold).toBe(0);
    for (let i = 1; i < tables.ontario.brackets.length; i++) {
      const prev = tables.ontario.brackets[i - 1]!;
      const cur = tables.ontario.brackets[i]!;
      expect(cur.threshold).toBeGreaterThan(prev.threshold);
      expect(cur.rate).toBeGreaterThan(prev.rate);
    }
  });

  it("pins the stable benefit and room rates", () => {
    expect(tables.gis.taperRate).toBe(0.5);
    expect(tables.oas.recoveryRate).toBe(0.15);
    expect(tables.rrsp.incomeRate).toBe(0.18);
  });

  it("pins the RRIF minimum factor schedule exactly (published values, stored as decimals)", () => {
    const expectFactor = (age: number, factor: number) => {
      const entry = tables.rrif.minimumFactors.find((f) => f.age === age);
      expect(entry).toBeDefined();
      expect(entry!.factor).toBeCloseTo(factor, 5);
    };
    expectFactor(71, 0.0528);
    expectFactor(72, 0.054);
    expectFactor(73, 0.0553);
    expectFactor(74, 0.0567);
    expectFactor(75, 0.0582);
    expectFactor(76, 0.0599);
    expectFactor(77, 0.0617);
    expectFactor(78, 0.0636);
    expectFactor(79, 0.0657);
    expectFactor(80, 0.0679);
    expectFactor(81, 0.0704);
    expectFactor(82, 0.0728);
    expectFactor(83, 0.0755);
    expectFactor(84, 0.0783);
    expectFactor(85, 0.0811);
    expectFactor(86, 0.0842);
    expectFactor(87, 0.0875);
    expectFactor(88, 0.0909);
    expectFactor(89, 0.0955);
    expectFactor(90, 0.1001);
    expectFactor(91, 0.1054);
    expectFactor(92, 0.1111);
    expectFactor(93, 0.117);
    expectFactor(94, 0.1234);
    expectFactor(95, 0.2);
    expect(tables.rrif.minimumFactors).toHaveLength(25); // 71..95, 95 is the cap
  });

  it("RRIF factors are non-decreasing with age below the 95 cap", () => {
    const belowCap = tables.rrif.minimumFactors.filter((f) => f.age < 95);
    for (let i = 1; i < belowCap.length; i++) {
      expect(belowCap[i]!.factor).toBeGreaterThanOrEqual(belowCap[i - 1]!.factor);
    }
  });

  it("TFSA cumulative room as of 2026 is $109,000 with a $7,000 annual limit", () => {
    expect(tables.tfsa.annualLimit).toBe(7_000);
    expect(tables.tfsa.cumulativeRoomAsOf2026).toBe(109_000);
    expect(tables.tfsa.roomStartAge).toBe(18);
  });

  it("indexation factors for both jurisdictions are at least 1 (2026 table vs 2025)", () => {
    expect(tables.federal.indexationFactor).toBeGreaterThanOrEqual(1);
    expect(tables.ontario.indexationFactor).toBeGreaterThanOrEqual(1);
  });
});

describe("applyIndexation", () => {
  it("scales each jurisdiction's thresholds by its own factor, yearOffset as a power", () => {
    const fixture = fixtureTables(1.02, 1.01);
    const out = applyIndexation(fixture, 3);
    expect(out.federal.brackets[1]!.threshold).toBeCloseTo(50_000 * 1.02 ** 3, 4);
    expect(out.ontario.brackets[1]!.threshold).toBeCloseTo(50_000 * 1.01 ** 3, 4);
    // federal-only values scale with the federal factor only
    expect(out.federal.basicPersonalAmount).toBeCloseTo(40_000 * 1.02 ** 3, 4);
    // ontario-only values scale with the Ontario factor only
    expect(out.ontario.basicPersonalAmount).toBeCloseTo(12_000 * 1.01 ** 3, 4);
  });

  it("federal and Ontario tables do not fuse under indexation (independent scaling)", () => {
    const fixture = fixtureTables(1.02, 1.01);
    const out = applyIndexation(fixture, 3);
    // If both used one shared number these would be equal; with per-table factors they differ.
    expect(out.federal.brackets[1]!.threshold).not.toBeCloseTo(out.ontario.brackets[1]!.threshold, 0);
  });

  it("leaves rates untouched and does not compound the indexation factors themselves", () => {
    const fixture = fixtureTables(1.02, 1.01);
    const out = applyIndexation(fixture, 2);
    expect(out.federal.brackets[1]!.rate).toBe(fixture.federal.brackets[1]!.rate);
    expect(out.ontario.surtax[0]!.rate).toBe(fixture.ontario.surtax[0]!.rate);
    expect(out.federal.indexationFactor).toBe(fixture.federal.indexationFactor);
    expect(out.ontario.indexationFactor).toBe(fixture.ontario.indexationFactor);
  });

  it("indexes federal age-credit and pension-credit amounts+thresholds, and the OAS recovery threshold (federal factor)", () => {
    const fixture = fixtureTables(1.02, 1.01);
    const out = applyIndexation(fixture, 2);
    expect(out.federal.ageCredit.amount).toBeCloseTo(8_000 * 1.02 ** 2, 4);
    expect(out.federal.ageCredit.reductionThreshold).toBeCloseTo(45_000 * 1.02 ** 2, 4);
    expect(out.federal.pensionIncomeCredit.amount).toBeCloseTo(2_000 * 1.02 ** 2, 4);
    expect(out.federal.pensionIncomeCredit.incomeThreshold).toBeCloseTo(90_000 * 1.02 ** 2, 4);
    expect(out.oas.clawbackThreshold).toBeCloseTo(90_000 * 1.02 ** 2, 4);
  });

  it("a +30-year shift is NOT identically behaved vs no shift (credit scaling compounds)", () => {
    const fixture = fixtureTables(1.02, 1.01);
    const shifted = applyIndexation(fixture, 30);
    const unshifted = applyIndexation(fixture, 0);
    // Age credit amount and threshold both drift over 30 years (1.02^30 ≈ 1.806).
    expect(shifted.federal.ageCredit.amount).toBeCloseTo(unshifted.federal.ageCredit.amount * 1.02 ** 30, 4);
    expect(shifted.federal.ageCredit.reductionThreshold).toBeCloseTo(
      unshifted.federal.ageCredit.reductionThreshold * 1.02 ** 30,
      4,
    );
    // Pension credit amount/threshold drift equally by the same federal factor.
    expect(shifted.federal.pensionIncomeCredit.amount).toBeCloseTo(
      unshifted.federal.pensionIncomeCredit.amount * 1.02 ** 30,
      4,
    );
    expect(shifted.federal.pensionIncomeCredit.incomeThreshold).toBeCloseTo(
      unshifted.federal.pensionIncomeCredit.incomeThreshold * 1.02 ** 30,
      4,
    );
    // And the two are genuinely different for the high-bracket case: +30y threshold pair
    // (age amount vs pension threshold) does not collapse onto the +0y values.
    expect(shifted.federal.ageCredit.reductionThreshold).not.toEqual(
      unshifted.federal.ageCredit.reductionThreshold,
    );
  });

  it("indexes Ontario surtax taxable-income thresholds by the Ontario factor", () => {
    const fixture = fixtureTables(1.02, 1.01);
    const out = applyIndexation(fixture, 2);
    expect(out.ontario.surtax[0]!.onTaxOverPctOfTaxable).toBeCloseTo(80_000 * 1.01 ** 2, 4);
  });

  it("does not index limits/amounts fixed by annual announcement or statute", () => {
    const fixture = fixtureTables(1.02, 1.01);
    const out = applyIndexation(fixture, 2);
    expect(out.tfsa.annualLimit).toBe(fixture.tfsa.annualLimit);
    expect(out.tfsa.cumulativeRoomAsOf2026).toBe(fixture.tfsa.cumulativeRoomAsOf2026);
    expect(out.rrsp.annualLimit).toBe(fixture.rrsp.annualLimit);
    expect(out.oas.annualMax).toBe(fixture.oas.annualMax);
    expect(out.gis.annualMaxSingle).toBe(fixture.gis.annualMaxSingle);
    expect(out.gis.exclusionEmployment).toBe(fixture.gis.exclusionEmployment);
    expect(out.rrif.minimumFactors).toEqual(fixture.rrif.minimumFactors);
  });

  it("is deterministic: offset 0 returns thresholds unchanged", () => {
    const out = applyIndexation(fixtureTables(1.02, 1.01), 0);
    expect(out.federal.basicPersonalAmount).toBe(40_000);
    expect(out.ontario.brackets[1]!.threshold).toBe(50_000);
  });
});
