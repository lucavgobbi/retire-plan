import type { TaxYearTables } from "../tax/tables";

export interface TfsaRoomState {
  room: number;
  currentAge: number;
}

/**
 * TFSA contribution room available NEXT year.
 *
 * CONTRACT: `state.room` is room ALREADY NET of this year's contributions — the caller
 * subtracts what was contributed during the year BEFORE calling. This function adds
 * exactly two things: `withdrawalsThisYear` (a withdrawal this year recharges room only
 * for next year, never in-year, per CRA rules) and, when eligible, one annual limit for
 * the year the returned room applies to. Result is floored at 0.
 *
 * SEEDING: a resident eligible since roomStartAge starts a 2026-based projection with
 * room == cumulativeRoomAsOf2026 (the 2009–2026 sum, which ALREADY includes the 2026
 * limit). From 2027 on, each subsequent call adds one more annualLimit — seeding
 * therefore avoids both double-counting (2026 limit applied twice) and under-counting
 * (a year's limit skipped).
 *
 * `eligibleAge` is caller-supplied and must be (age >= roomStartAge) evaluated for the
 * year the returned room applies to — i.e. the state age + 1. When omitted it defaults
 * to exactly that derivation from `state.currentAge`.
 */
export function tfsaRoomNextYear(
  state: TfsaRoomState,
  withdrawalsThisYear: number,
  tables: TaxYearTables,
  eligibleAge: boolean = state.currentAge + 1 >= tables.tfsa.roomStartAge,
): number {
  return Math.max(
    0,
    state.room + (eligibleAge ? tables.tfsa.annualLimit : 0) + withdrawalsThisYear,
  );
}

/**
 * RRSP deduction room earned this year (the year's "added room" notice):
 * 18% of earned income net of employer contributions, capped by the annual limit,
 * stacked on any unused carry-forward. The cap binds by construction inside the min(),
 * so no second overall cap check is needed.
 */
export function rrspRoomEarn(
  currentAge: number,
  earnedIncome: number,
  carryforward: number,
  tables: TaxYearTables,
  employerContributions: number,
): number {
  void currentAge; // reserved for future age-gated rules; the room formula has none
  return (
    carryforward +
    Math.min(
      tables.rrsp.incomeRate * Math.max(0, earnedIncome - employerContributions),
      tables.rrsp.annualLimit,
    )
  );
}
