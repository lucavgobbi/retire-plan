import { describe, expect, it } from "vitest";
import {
  blendedReturn,
  nonregGrow,
  nonregWithdrawal,
} from "../../src/accounts/nonreg";

describe("blendedReturn", () => {
  it("weights the year's asset-class returns by the account mix", () => {
    expect(
      blendedReturn({ equity: 0.08, bond: 0.02, cash: 0 }, { equity: 0.5, bond: 0.5, cash: 0 }),
    ).toBeCloseTo(0.05, 10);
  });
});

describe("nonregGrow", () => {
  it("market and book both grow by the same dollar amount (ACB absorbs the year's growth)", () => {
    // market 100, book 60, 5% growth -> market 105, book 65
    const out = nonregGrow(
      { market: 100, book: 60 },
      { equity: 0.05, bond: 0, cash: 0 },
      { equity: 1, bond: 0, cash: 0 },
    );
    expect(out.market).toBeCloseTo(105, 6);
    expect(out.book).toBeCloseTo(65, 6);
    // The unrealized-gain fraction shrinks; the realized fraction at a future
    // withdrawal is now 1 - 65/105.
  });
});

describe("nonregWithdrawal", () => {
  it("realizes gains at the book/market ratio (the plan's pinned example)", () => {
    // $10k market / $6k book, 25% withdrawal
    const out = nonregWithdrawal({ market: 10_000, book: 6_000 }, 10_000, 2_500);
    expect(out.realizedGain).toBeCloseTo(1_000, 6); // 2,500 x (1 - 0.6)
    expect(out.newBook).toBeCloseTo(4_500, 6); // 6,000 - 2,500 x 0.6
    expect(out.newMarket).toBeCloseTo(7_500, 6);
  });

  it("spends basis first when book equals market (no gain on fresh cash)", () => {
    const out = nonregWithdrawal({ market: 10_000, book: 10_000 }, 10_000, 4_000);
    expect(out.realizedGain).toBeCloseTo(0, 6);
    expect(out.newBook).toBeCloseTo(6_000, 6);
  });

  it("caps an oversized withdrawal at market: gain = whole market minus whole book", () => {
    const out = nonregWithdrawal({ market: 5_000, book: 4_000 }, 5_000, 8_000);
    // Only 5,000 can actually be sold; 5,000 x 0.8 = 4,000 of basis is consumed.
    expect(out.realizedGain).toBeCloseTo(1_000, 6);
    expect(out.newBook).toBeCloseTo(0, 6);
    expect(out.newMarket).toBe(0);
  });

  it("recognizes a capital loss when book exceeds market and consumes basis on liquidation", () => {
    const partial = nonregWithdrawal({ market: 100, book: 150 }, 100, 50);
    expect(partial.realizedGain).toBe(-25);
    expect(partial.newMarket).toBe(50);
    expect(partial.newBook).toBe(75);

    const full = nonregWithdrawal({ market: 100, book: 150 }, 100, 100);
    expect(full.realizedGain).toBe(-50);
    expect(full.newMarket).toBe(0);
    expect(full.newBook).toBe(0);
  });

  it("clips a return below -100% at a total wipeout", () => {
    const out = nonregGrow(
      { market: 100, book: 80 },
      { equity: -1.5, bond: 0, cash: 0 },
      { equity: 1, bond: 0, cash: 0 },
    );
    expect(out).toEqual({ market: 0, book: 0 });
  });

  it("consumption across multiple years keeps the ratio consistent", () => {
    let state = { market: 100, book: 60 };
    state = nonregGrow(state, { equity: 0.1, bond: 0, cash: 0 }, { equity: 1, bond: 0, cash: 0 });
    // market 110, book 70
    const w1 = nonregWithdrawal(state, state.market, 22); // 20% of 110
    expect(w1.realizedGain).toBeCloseTo(22 * (1 - 70 / 110), 6);
    state = nonregGrow({ market: w1.newMarket, book: w1.newBook }, { equity: 0.1, bond: 0, cash: 0 }, { equity: 1, bond: 0, cash: 0 });
    expect(state.market).toBeCloseTo(88 * 1.1, 6);
    expect(state.book).toBeCloseTo(70 - 22 * (70 / 110) + 88 * 0.1, 6);
  });
});
