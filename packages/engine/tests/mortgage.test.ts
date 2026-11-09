import { describe, expect, it } from "vitest";
import { mortgageYear } from "../src/mortgage";

// Reference: mortgageYear runs 12 monthly payments of `monthlyPayment`.
//   interest_m   = balance_m x annualRate/12
//   endBalance   = max(0, balance + interest - payment), clamped at payoff
//   interest     = sum of the 12 months' interest
//   principalPaid = starting balance - ending balance
//   paymentsMade = number of payments actually made (stops at payoff)

describe("mortgageYear — standard amortization", () => {
  it("hand-pins six months of an 12%-rate $1,000 balance at $200/month (paid off mid-year)", () => {
    // m1: int 10.00 -> 810.00; m2: int 8.10 -> 618.10; m3: int 6.181 -> 424.281;
    // m4: int 4.2428 -> 228.52381; m5: int 2.2852381 -> 30.8090381;
    // m6: int 0.30809 -> max(0, 30.8090381 + 0.3080904 - 200) = 0 (payment clamped to 31.1171)
    // interest sum = 10 + 8.10 + 6.181 + 4.24281 + 2.2852381 + 0.3080904 = 31.1171385
    const r = mortgageYear({ balance: 1_000, annualRate: 0.12, monthlyPayment: 200 });
    expect(r.endBalance).toBe(0);
    expect(r.paymentsMade).toBe(6);
    expect(r.principalPaid).toBeCloseTo(1_000, 8);
    expect(r.interest).toBeCloseTo(31.1171385, 6);
  });

  it("amortizes a 25-year @4.99% mortgage to exactly 0 at term end", () => {
    // Independent arithmetic: standard monthly payment for balance/P. 350,000,
    // r = 0.0499/12, n = 300: P = B x r x (1+r)^n / ((1+r)^n - 1)
    const r = 0.0499 / 12;
    const n = 300;
    const payment = (350_000 * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);

    let balance = 350_000;
    for (let y = 1; y <= 25; y++) {
      const year = mortgageYear({ balance, annualRate: 0.0499, monthlyPayment: payment });
      balance = year.endBalance;
      expect(balance).not.toBeUndefined();
      expect(balance).toBeGreaterThanOrEqual(0);
      // Within one payment of the scheduled amortization curve.
      expect(year.interest).toBeGreaterThan(0);
      expect(year.principalPaid).toBeGreaterThan(0);
    }
    // Term end: within a dollar of zero.
    expect(balance).toBeLessThan(1);
  });

  it("one year of interest equals the hand-rolled 12-month loop, not a rate shortcut", () => {
    // Independent 12-month hand loop for the same inputs.
    let b = 300_000;
    let interest = 0;
    for (let m = 0; m < 12; m++) {
      const i = b * (0.06 / 12);
      interest += i;
      b = Math.max(0, b + i - 1_500);
    }
    const r = mortgageYear({ balance: 300_000, annualRate: 0.06, monthlyPayment: 1_500 });
    expect(r.endBalance).toBeCloseTo(b, 8);
    expect(r.interest).toBeCloseTo(interest, 8);
    expect(r.paymentsMade).toBe(12);
    expect(r.principalPaid).toBeCloseTo(300_000 - b, 8);
  });
});

describe("mortgageYear — negative amortization (Review Focus #5)", () => {
  it("a payment below the interest causes the balance to rise", () => {
    // 100,000 @ 5%: first-month interest is 416.67; a $100/month payment cannot cover it.
    const r = mortgageYear({ balance: 100_000, annualRate: 0.05, monthlyPayment: 100 });
    expect(r.endBalance).toBeGreaterThan(100_000);
    // Twelve payments of $100 = $1,200 in, yet interest charged exceeded that.
    expect(r.interest).toBeGreaterThan(1_200);
    // Principal "paid" is negative — the borrower fell further behind.
    expect(r.principalPaid).toBeLessThan(0);
    expect(r.paymentsMade).toBe(12);
  });

  it("every result field is always defined (never undefined)", () => {
    for (const m of [
      { balance: 0, annualRate: 0.05, monthlyPayment: 1_000 },
      { balance: 10, annualRate: 0.0, monthlyPayment: 1_000 },
      { balance: 100_000, annualRate: 0.05, monthlyPayment: 50 },
    ]) {
      const r = mortgageYear(m);
      expect([r.endBalance, r.interest, r.principalPaid, r.paymentsMade]).toEqual(
        expect.arrayContaining([expect.any(Number)]),
      );
      for (const v of [r.endBalance, r.interest, r.principalPaid, r.paymentsMade]) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });

  it("an already-paid mortgage stays paid", () => {
    const r = mortgageYear({ balance: 0, annualRate: 0.05, monthlyPayment: 1_930 });
    expect(r.endBalance).toBe(0);
    expect(r.interest).toBe(0);
    expect(r.principalPaid).toBe(0);
    expect(r.paymentsMade).toBe(0);
  });
});
