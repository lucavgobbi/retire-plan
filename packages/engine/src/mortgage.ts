/**
 * Mortgage amortization — one year of monthly payments.
 *
 * Rate convention (v1, docs/assumptions.md): `annualRate` is a NOMINAL rate compounded
 * monthly (rate/12 each month). Canadian mortgages normally compound semi-annually;
 * nominal-monthly is the documented v1 approximation — a real Canadian quoted rate fed
 * in directly is fine, but future callers must not annualize differently.
 *
 * Monthly loop: interest_m = balance_m x annualRate / 12; the payment is applied
 * after interest, clamped so the final payment never overshoots the payoff.
 * If the payment cannot cover a month's interest the balance rises (negative
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
}): MortgageYearResult {
  const start = Math.max(0, m.balance);
  let balance = start;
  let interest = 0;
  let paymentsMade = 0;

  for (let month = 0; month < 12 && balance > 0; month++) {
    const monthInterest = balance * (m.annualRate / 12);
    interest += monthInterest;
    const payment = Math.min(m.monthlyPayment, balance + monthInterest);
    balance = Math.max(0, balance + monthInterest - payment);
    paymentsMade++;
  }

  return { endBalance: balance, interest, principalPaid: start - balance, paymentsMade };
}
