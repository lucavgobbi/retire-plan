/**
 * Display formatting helpers for the projection views.
 *
 * The never-NaN rule (spec §6 / plan §2) lives here: every numeric value a table,
 * chart or detail panel renders goes through one of these formatters, and any
 * non-finite number renders an em dash instead of leaking NaN/Infinity into the UI.
 */

const moneyZero = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 0,
});

const moneyCents = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function fmtMoney(value: number | undefined | null): string {
  return typeof value === "number" && Number.isFinite(value) ? moneyZero.format(value) : "—";
}

/** Detail expansion / tooltips keep cents (plan §2 money display rule). */
export function fmtMoneyDetail(value: number | undefined | null): string {
  return typeof value === "number" && Number.isFinite(value) ? moneyCents.format(value) : "—";
}

/** Rates are stored as fractions by the engine (marginalRate per $100 ⇒ fraction). */
export function fmtPercent(fraction: number | undefined | null): string {
  return typeof fraction === "number" && Number.isFinite(fraction)
    ? `${(fraction * 100).toFixed(1)}%`
    : "—";
}

/** YearResult carries no calendar year: the engine derives it as birthYear + age. */
export function yearForAge(birthYear: number, age: number): number {
  return birthYear + age;
}
