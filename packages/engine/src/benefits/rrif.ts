import type { TaxYearTables } from "../tax/tables";

/**
 * CRA RRIF minimum withdrawal: minimum = minimumFactor(age) x opening balance.
 *
 * A RRIF cannot exist before age 71, so younger ages return null — null means exactly
 * "no RRIF exists yet", never invalid input. A fractional age is a caller bug and
 * throws (CRA's schedule is per integer age at the start of the RRIF year), keeping the
 * null channel unambiguous.
 *
 * Factors come from the JSON tables; the schedule ends at age 95 where the factor caps
 * at 20% and stays there for every later age.
 */
export function rrifMinimum(
  age: number,
  balance: number,
  tables: TaxYearTables,
): { minimum: number; factor: number } | null {
  if (!Number.isInteger(age)) {
    throw new Error(
      `rrifMinimum: age must be an integer (per the CRA schedule), got ${age}. Fractional ages are caller errors — do not confuse them with "no RRIF yet" (null).`,
    );
  }
  if (age < 71) return null;

  const factors = tables.rrif.minimumFactors;
  if (age >= 95) {
    const cap = factors[factors.length - 1]!;
    return { minimum: cap.factor * balance, factor: cap.factor };
  }

  const entry = factors.find((f) => f.age === age);
  return entry ? { minimum: entry.factor * balance, factor: entry.factor } : null;
}
