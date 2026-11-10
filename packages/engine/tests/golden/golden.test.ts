import { describe, expect, it } from "vitest";
import { simulate } from "../../src/simulate";
import { makeSamplePlan, makeSampleScenario, sampleTables } from "./samplePlan";
import { referenceGoldenYears } from "./reference";

/**
 * Golden projection (plan Task 15).
 *
 * Year-1 hand-derivation (from `ca-2026.json`, shown for auditability):
 *
 * Employment income (age 45): 95,000 (start year, no raises).
 * FEDERAL: 58,523 x 0.14 = 8,193.22; (95,000 - 58,523) x 0.205 = 7,477.785 -> gross 15,671.005
 *          credits at the lowest rate: 0.14 x (16,452 + 1,501) = 2,513.42
 *          -> federal tax 15,671.005 - 2,513.42 = 13,157.59 (rounded cent)
 * ONTARIO: 53,891 x 0.0505 = 2,721.4955; (95,000 - 53,891) x 0.0915 = 3,761.4735 -> gross 6,482.969
 *          credits: 0.0505 x 12,989 = 655.9445 -> basic ON tax 5,827.02
 *          surtax tier 1: 0.20 x (5,827.02 - 5,818) = 1.80 ; tier 2: not engaged (< 7,446)
 *          -> Ontario total 5,827.02 + 1.80 = 5,828.82
 * OAS clawback: 0 (no OAS yet). TOTAL TAX = 13,157.59 + 5,828.82 = 18,986.41
 *
 * MORTGAGE (350k @ 4.5% nominal-monthly, $1,930): factor (1 + 0.045/12)^12 = 1.04594054
 *          end balance = 350,000 x 1.04594054 - 1,930 x ((1.04594054 - 1)/0.00375)
 *                      = 366,079.19 - 23,644.06 = 342,435.13
 *
 * CASH FLOW: obligation = 55,000 (expenses) + 18,986.41 (tax) + 23,160 (mortgage) = 97,146.41
 *          deficit = 97,146.41 - 95,000 = 2,146.41 -> drawn from TFSA (default order).
 *
 * GROWTH at blended 4% (0.7 x 5% + 0.25 x 2% + 0.05 x 0%):
 *          TFSA (60,000 - 2,146.41) x 1.04 = 60,167.73
 *          RRSP 180,000 x 1.04 = 187,200.00 ; non-reg 40,000 x 1.04 = 41,600.00
 *          home 700,000 x 1.02 = 714,000.00
 * NET WORTH = 60,167.73 + 187,200.00 + 41,600.00 + 714,000.00 - 342,435.13 = 660,532.60
 */
describe("golden projection (sample plan)", () => {
  const plan = makeSamplePlan();
  const scenario = makeSampleScenario();
  const tables = sampleTables();
  const result = simulate(plan, scenario, {
    years: Array.from({ length: plan.profile.endAge - plan.profile.currentAge + 1 }, (_, k) => ({
      age: plan.profile.currentAge + k,
      equity: scenario.returnAssumptions.equity,
      bond: scenario.returnAssumptions.bond,
      cash: scenario.returnAssumptions.cash,
    })),
  });

  it("matches the independent reference calculator in the first three years", () => {
    const ref = referenceGoldenYears(plan, tables, plan.profile.currentAge, 3);
    for (let i = 0; i < 3; i++) {
      const y = result.years[i]!;
      const r = ref[i]!;
      expect(y.age).toBe(r.age);
      expect(y.income.employment).toBeCloseTo(r.employment, 1);
      expect(y.expenses).toBeCloseTo(r.expenses, 1);
      expect(y.tax.total).toBeCloseTo(r.taxTotal, 0); // within ~2c after component rounding
      expect(y.withdrawals.tfsa).toBeCloseTo(r.tfsaDraw, 1);
      expect(y.balances.tfsa).toBeCloseTo(r.tfsaEnd, 1);
      expect(y.balances.rrsp).toBeCloseTo(r.rrspEnd, 1);
      expect(y.balances.nonreg).toBeCloseTo(r.nonregEnd, 1);
      expect(y.balances.home).toBeCloseTo(r.homeEnd, 0);
      expect(y.balances.debt).toBeCloseTo(r.debtEnd, 0);
      expect(y.netWorth).toBeCloseTo(r.netWorth, 0);
    }
  });

  it("pins the hand-derived year-1 numbers exactly", () => {
    const y = result.years[0];
    // From the derivation comment above.
    expect(y.tax.federal).toBeCloseTo(13_157.59, 1);
    expect(y.tax.provincial).toBeCloseTo(5_827.02, 1);
    expect(y.tax.surtax).toBeCloseTo(1.8, 1);
    expect(y.tax.total).toBeCloseTo(18_986.41, 1);
    expect(y.balances.debt).toBeCloseTo(342_435.13, 0); // formula-derived
    expect(y.withdrawals.tfsa).toBeCloseTo(2_146.41, 1);
    expect(y.balances.tfsa).toBeCloseTo(60_167.73, 1);
    expect(y.balances.rrsp).toBeCloseTo(187_200.0, 1);
    expect(y.balances.nonreg).toBeCloseTo(41_600.0, 1);
    expect(y.balances.home).toBeCloseTo(714_000.0, 1);
    expect(y.netWorth).toBeCloseTo(660_532.6, 0);
    expect(y.tax.oasClawback).toBe(0);
  });

  it("survives to 95 with positive net worth and lifetime tax", () => {
    expect(result.summary.success).toBe(true);
    expect(result.summary.failureAge).toBeUndefined();
    const last = result.years[result.years.length - 1];
    expect(last.age).toBe(95);
    expect(last.netWorth).toBeGreaterThan(0);
    const lifetimeTax = result.years.reduce((s, y) => s + y.tax.total, 0);
    expect(lifetimeTax).toBeGreaterThan(0);
  });

  it("keeps conservation invariants in every year", () => {
    for (const y of result.years) {
      // Rounded result values never go negative where the engine forbids it.
      expect(y.balances.tfsa).toBeGreaterThanOrEqual(-0.001);
      expect(y.balances.rrsp).toBeGreaterThanOrEqual(-0.001);
      expect(y.balances.nonreg).toBeGreaterThanOrEqual(-0.001);
      expect(y.balances.debt).toBeGreaterThanOrEqual(-0.001);
    }
  });
});
