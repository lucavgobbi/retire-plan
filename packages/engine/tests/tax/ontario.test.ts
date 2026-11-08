import { describe, expect, it } from "vitest";
import tablesJson from "../../data/tax/ca-2026.json";
import { applyIndexation, loadTables, type TaxYearTables } from "../../src/tax/tables";
import { federalTax, type IncomeForTax } from "../../src/tax/federal";
import { ontarioSurtax, ontarioTax } from "../../src/tax/ontario";

const tables: TaxYearTables = loadTables(tablesJson);

// Reference constants (2026, verified in data/tax/SOURCES.md):
//   ON brackets: 0 @ 5.05%; 53,891 @ 9.15%; 107,785 @ 11.16%; 150,000 @ 12.16%; 220,000 @ 13.16%
//   ON BPA = 12,989 -> constant credit = 12,989 x 0.0505 = 655.9445
//   Surtax on basic ON tax (after non-refundable credits, before dividends): 20% of tax > $5,818,
//   plus 36% of tax > $7,446 (T4032-ON). The stored ladder thresholds are tax dollars.
//
// All expected values are hand-computed; the implementation is never used as the oracle.

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

describe("ontarioTax — hand-computed zones", () => {
  it("zero income pays nothing", () => {
    const r = ontarioTax(income(), tables);
    expect(r.taxable).toBe(0);
    expect(r.tax).toBe(0);
    expect(r.surtax).toBe(0);
    expect(r.total).toBe(0);
  });

  it("low income is fully offset by the ON BPA credit", () => {
    // gross = 10,000 x 0.0505 = 505 < credits 655.9445 -> tax floor 0
    const r = ontarioTax(income({ employmentIncome: 10_000 }), tables);
    expect(r.tax).toBe(0);
    expect(r.surtax).toBe(0);
  });

  it("first zone: 60,000 — no surtax", () => {
    // gross = 53,891 x 0.0505 + 6,109 x 0.0915 = 2,721.4955 + 558.9735 = 3,280.469
    // basic tax (after credits) = 3,280.469 - 655.9445 = 2,624.5245 < 5,818 -> surtax 0
    const r = ontarioTax(income({ employmentIncome: 60_000 }), tables);
    expect(r.taxable).toBe(60_000);
    expect(r.tax).toBeCloseTo(2_624.5245, 4);
    expect(r.surtax).toBe(0);
    expect(r.total).toBeCloseTo(2_624.5245, 4);
  });

  it("mid zone: 100,000 — 20% ladder engaged, 36% ladder not", () => {
    // gross = 53,891 x 0.0505 + 46,109 x 0.0915 = 2,721.4955 + 4,218.9735 = 6,940.469
    // basic tax = 6,940.469 - 655.9445 = 6,284.5245
    // surtax = 0.20 x (6,284.5245 - 5,818) = 0.20 x 466.5245 = 93.3049  (tier B not engaged)
    const r = ontarioTax(income({ employmentIncome: 100_000 }), tables);
    expect(r.tax).toBeCloseTo(6_284.5245, 4);
    expect(r.surtax).toBeCloseTo(93.3049, 4);
    expect(r.total).toBeCloseTo(6_377.8294, 4);
  });

  it("high zone: 200,000 — 36% ladder engaged", () => {
    // gross = 2,721.4955 + 53,894 x 0.0915 + 42,215 x 0.1116 + 50,000 x 0.1216
    //       = 2,721.4955 + 4,931.301 + 4,711.194 + 6,080 = 18,443.9905
    // basic tax = 18,443.9905 - 655.9445 = 17,788.046
    // surtax = 0.20 x (17,788.046 - 5,818) + 0.36 x (17,788.046 - 7,446)
    //        = 2,394.0092 + 3,723.13656 = 6,117.14576
    // total = 23,905.19176
    const r = ontarioTax(income({ employmentIncome: 200_000 }), tables);
    expect(r.tax).toBeCloseTo(17_788.046, 4);
    expect(r.surtax).toBeCloseTo(6_117.14576, 4);
    expect(r.total).toBeCloseTo(23_905.19176, 4);
  });

  it("top bracket 300,000 — full 13.16% marginal with both surtax ladders wide open", () => {
    // gross = 2,721.4955 + 4,931.301 + 4,711.194 + 70,000 x 0.1216 + 80,000 x 0.1316
    //       = 2,721.4955 + 4,931.301 + 4,711.194 + 8,512 + 10,528 = 31,403.9905
    // basic tax = 31,403.9905 - 655.9445 = 30,748.046
    // surtax = 0.20 x (30,748.046 - 5,818) + 0.36 x (30,748.046 - 7,446)
    //        = 4,986.0092 + 8,388.73656 = 13,374.74576
    // total = 44,122.79176
    const r = ontarioTax(income({ employmentIncome: 300_000 }), tables);
    expect(r.surtax).toBeCloseTo(13_374.74576, 4);
    expect(r.total).toBeCloseTo(44_122.79176, 4);
  });
});

describe("ontarioSurtax — unit behaviour on the raw ladders", () => {
  it("zero below tier A", () => {
    expect(ontarioSurtax(5_818, 100_000, tables)).toBe(0);
    expect(ontarioSurtax(5_000, 100_000, tables)).toBe(0);
  });

  it("20%-only between the tiers", () => {
    // onBase 6,818: 0.20 x 1,000 = 200
    expect(ontarioSurtax(6_818, 100_000, tables)).toBeCloseTo(200, 8);
  });

  it("between tiers + $1 does not engage tier B", () => {
    expect(ontarioSurtax(7_446, 100_000, tables)).toBeCloseTo(0.2 * (7_446 - 5_818), 8);
    expect(ontarioSurtax(7_447, 100_000, tables)).toBeCloseTo(
      0.2 * (7_447 - 5_818) + 0.36 * 1,
      8,
    );
  });

  it("above tier B both ladders apply to the excess base only", () => {
    // onBase 17,788.046: 0.20 x 11,970.046 + 0.36 x 10,342.046 = 6,117.14576
    expect(ontarioSurtax(17_788.046, 100_000, tables)).toBeCloseTo(6_117.14576, 8);
  });
});

describe("ontarioTax — $1-straddle comparability at the surtax tiers", () => {
  it("crossing tier B adds 1.56 x the ON marginal rate per extra dollar (official 20% + 36% stacking)", () => {
    // In the 150,000-220,000 bracket the ON marginal rate is 12.16%. Both surtax ladders are
    // already engaged, so each extra tax dollar grows the surtax by (0.20 + 0.36) x 0.1216
    // and the total tax by 1.56 x 0.1216 (T4032: 56% combined surtax above tier B).
    const lo = ontarioTax(income({ employmentIncome: 156_000 }), tables);
    const hi = ontarioTax(income({ employmentIncome: 156_001 }), tables);
    expect(hi.surtax - lo.surtax).toBeCloseTo(0.068096, 8);
    expect(hi.total - lo.total).toBeCloseTo(0.189696, 8);
  });

  it("no cliff artifacts: total is continuous around tier A", () => {
    // Find the engagement point and step across it — no discontinuity is allowed, only a
    // slope change of exactly (1 + 0.2) x marginal ON rate while below tier B.
    // onBase crosses 5,818 near taxable 94,904 (TaxTips: $94,907 for BPA-only filers);
    // with our credit model the crossing is at taxable t where
    //   2,721.4955 + 0.0915 x (t - 53,891) - 655.9445 = 5,818 -> t = 94,904.20
    // Step +$1 and -$1 around 94,904: at 94,905 basic tax is minutely above 5,818.
    const below = ontarioTax(income({ employmentIncome: 94_904 }), tables);
    const above = ontarioTax(income({ employmentIncome: 94_905 }), tables);
    const diff = above.total - below.total;
    // both sides' totals differ by the marginal-rate spring: basic tax 0.0915,
    // plus surtax engaged on the tick above: 0.2 x (tiny excess) -> total in
    // (0.0915, 0.0915 + 0.2 x 0.0915]
    expect(diff).toBeGreaterThan(0.0915);
    expect(diff).toBeLessThanOrEqual(0.0915 * 1.2 + 1e-9);
    expect(above.surtax).toBeGreaterThan(0);
  });
});

describe("ontarioTax — integration with the federal side", () => {
  it("keeps selectable fields consistent with federalTax on the same income", () => {
    const forTax = income({ employmentIncome: 90_000 });
    expect(ontarioTax(forTax, tables).taxable).toBe(federalTax(forTax, tables).taxable);
  });

  it("respects Ontario indexation independently: +1 year shifts surtax engagement later", () => {
    // 100,000 in 2026 pays surtax 93.3049; after one year of 1.9% ON indexation the
    // thresholds and BPA grow, so the same income pays less tax and less surtax.
    // Hand-computed for the indexed table:
    //   thresholds: 54,914.929 / 109,832.915; tiers: 5,928.542 / 7,587.474
    //   BPA 13,235.791 -> credits 668.4074455
    //   gross(100,000) = 2,773.20392 + 45,085.071 x 0.0915 = 6,898.48791
    //   onBase = 6,230.0804655; surtax = 0.2 x 301.5384655 = 60.3076931 (tier B not engaged)
    const r26 = ontarioTax(income({ employmentIncome: 100_000 }), tables);
    expect(r26.surtax).toBeCloseTo(93.3049, 4);
    const r27 = ontarioTax(income({ employmentIncome: 100_000 }), applyIndexation(tables, 1));
    expect(r27.surtax).toBeCloseTo(60.3076931, 4);
    expect(r27.surtax).toBeLessThan(r26.surtax);
  });
});
