import type { TaxYearTables } from "../tax/tables";

export interface TfsaRoomState {
  room: number;
  currentAge: number;
}

/**
 * TFSA contribution room available next year.
 *
 * `state.room` is the room available at the start of the year; contributions made this
 * year have consumed it but are not yet reflected — the caller passes `withdrawalsThisYear`
 * for the recharge and reports usage through the year's stepper. A withdrawal made this
 * year never recharges in the same year; CRA rules make it available January 1 of the
 * following year, which is exactly what this returns. Eligibility (18+ and a Canadian
 * resident) adds the annual limit.
 */
export function tfsaRoomNextYear(
  state: TfsaRoomState,
  withdrawalsThisYear: number,
  tables: TaxYearTables,
  eligibleAge: boolean,
): number {
  return Math.max(
    0,
    state.room + (eligibleAge ? tables.tfsa.annualLimit : 0) + withdrawalsThisYear,
  );
}

/**
 * RRSP deduction room earned this year (the year's "added room" notice):
 * 18% of earned income net of employer contributions, capped by the annual limit,
 * stacked on any unused carry-forward.
 */
export function rrspRoomEarn(
  currentAge: number,
  earnedIncome: number,
  carryforward: number,
  tables: TaxYearTables,
  employerContributions: number,
): number {
  void currentAge; // reserved for future age-gated rules; the room formula has none
  const earned = Math.min(
    tables.rrsp.incomeRate * Math.max(0, earnedIncome - employerContributions),
    tables.rrsp.annualLimit,
  );
  return Math.min(carryforward + earned, tables.rrsp.annualLimit + carryforward);
}
