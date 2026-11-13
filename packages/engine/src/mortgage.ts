/**
 * Mortgage amortization — one year of payments at the given frequency.
 *
 * Rate convention (v1, docs/assumptions.md): `annualRate` is a NOMINAL rate compounded
 * at the payment frequency (`rate / paymentsPerYear` each period). Monthly (12) is the
 * default; biweekly (26) and weekly (52) use the same convention. Canadian mortgages
 * normally compound semi-annually; nominal-periodic is the documented v1 approximation
 * — a real Canadian quoted rate fed in directly is fine, but future callers must not
 * annualize differently.
 *
 * Period loop: interest_p = balance_p x annualRate / paymentsPerYear; the payment is
 * applied after interest, clamped so the final payment never overshoots the payoff.
 * If the payment cannot cover a period's interest the balance rises (negative
 * amortization) — the caller decides whether that is a warning; this function
 * simply reports the larger positive end balance (Review Focus #5).
 */

export interface MortgageYearResult {
  endBalance: number;
  interest: number;
  principalPaid: number;
  paymentsMade: number;
}

export function mortgageYear(m: {
  balance: number;
  annualRate: number;
  monthlyPayment: number;
  /** Payments per year: 12 monthly (default), 26 biweekly, 52 weekly. */
  paymentsPerYear?: number;
}): MortgageYearResult {
  const periods = Math.max(1, Math.floor(m.paymentsPerYear ?? 12));
  const start = Math.max(0, m.balance);
  let balance = start;
  let interest = 0;
  let paymentsMade = 0;

  for (let period = 0; period < periods && balance > 0; period++) {
    const periodInterest = balance * (m.annualRate / periods);
    interest += periodInterest;
    const payment = Math.min(m.monthlyPayment, balance + periodInterest);
    balance = Math.max(0, balance + periodInterest - payment);
    paymentsMade++;
  }

  return { endBalance: balance, interest, principalPaid: start - balance, paymentsMade };
}
