import type { AccountType, DebtPlan, SavingsPolicyStep, YearResult } from "../types";

export interface AllocateSurplusInput {
  amount: number;
  policy: SavingsPolicyStep[];
  rooms: { tfsa: number; rrsp: number };
  balances: { tfsa: number; rrsp: number; nonreg: number; debt: number };
  mortgage?: DebtPlan;
  /** Current age, used only to evaluate `untilAge` steps. When omitted, all steps execute. */
  age?: number;
}

export interface AllocateSurplusResult {
  contributions: YearResult["contributions"];
  amounts: YearResult["savings"];
  newRooms: { tfsa: number; rrsp: number };
  /** Surplus swept to non-reg because no policy step consumed it. */
  sweptToNonreg: number;
}

export interface FundDeficitInput {
  deficit: number;
  order: AccountType[];
  balances: Record<AccountType, number>;
  rrifMinimumDue: number;
}

export interface FundDeficitResult {
  withdrawals: YearResult["withdrawals"];
  /** The mandatory RRIF minimum actually withdrawn (bounded by the RRSP balance). */
  rrifMinimumTaken: number;
  remainingShortfall: number;
}

const zeroContributions = (): YearResult["contributions"] => ({ tfsa: 0, rrsp: 0, nonreg: 0 });
const zeroAmounts = (): YearResult["savings"] => ({ tfsa: 0, rrsp: 0, nonreg: 0, mortgage: 0 });
const zeroWithdrawals = (): YearResult["withdrawals"] => ({ tfsa: 0, rrsp: 0, nonreg: 0 });

function capFor(step: SavingsPolicyStep): number {
  return step.perYearCap ?? Number.POSITIVE_INFINITY;
}

function isActive(step: SavingsPolicyStep, age: number | undefined): boolean {
  if (age === undefined) return true; // documented contract: no age argument -> untilAge steps execute
  return !(step.untilAge !== undefined && age > step.untilAge);
}

/**
 * Walks savings policy steps by ascending priority, allocating `amount` of
 * after-tax surplus.
 *
 * - `rrsp-match`: the employer match (`matchRate` x what lands) does NOT come out of
 *   the surplus, but both employee and employer parts consume RRSP room.
 * - `tfsa`/`rrsp` are gated by available room (`perYearCap` applies before room).
 * - `mortgage-prepay` is capped at the outstanding mortgage balance.
 * - Any surplus no step consumed is swept to non-reg so cash-flow conservation holds.
 * - `rooms`/`balances` are read-only inputs; the caller replays mutated balances.
 */
export function allocateSurplus(
  amount: number,
  policy: SavingsPolicyStep[],
  rooms: { tfsa: number; rrsp: number },
  balances: { tfsa: number; rrsp: number; nonreg: number; debt: number },
  mortgage?: DebtPlan,
  age?: number,
): AllocateSurplusResult {
  const contributions = zeroContributions();
  const amountsOut = zeroAmounts();
  const newRooms = { tfsa: rooms.tfsa, rrsp: rooms.rrsp };
  let remaining = amount;

  const steps = [...policy].sort((a, b) => a.priority - b.priority);
  let reachedPrepay = false;

  for (const step of steps) {
    if (remaining <= 0) break;
    if (!isActive(step, age)) continue;

    switch (step.target) {
      case "tfsa": {
        const take = Math.min(remaining, capFor(step), Math.max(0, newRooms.tfsa));
        contributions.tfsa += take;
        amountsOut.tfsa += take;
        newRooms.tfsa -= take;
        remaining -= take;
        break;
      }
      case "rrsp": {
        const take = Math.min(remaining, capFor(step), Math.max(0, newRooms.rrsp));
        contributions.rrsp += take;
        amountsOut.rrsp += take;
        newRooms.rrsp -= take;
        remaining -= take;
        break;
      }
      case "rrsp-match": {
        const rate = step.matchRate ?? 0;
        const employee = Math.min(remaining, capFor(step), Math.max(0, newRooms.rrsp));
        const employer = Math.min(rate * employee, Math.max(0, newRooms.rrsp - employee));
        const landed = employee + employer;
        contributions.rrsp += landed;
        amountsOut.rrsp += landed;
        newRooms.rrsp -= landed;
        remaining -= employee; // the employer match is additive, not surplus
        break;
      }
      case "nonreg": {
        const take = Math.min(remaining, capFor(step));
        contributions.nonreg += take;
        amountsOut.nonreg += take;
        remaining -= take;
        break;
      }
      case "mortgage-prepay": {
        if (!mortgage || balances.debt <= 0) break; // nothing to prepay
        reachedPrepay = true; // terminal: leftover after a prepay rests as cash
        const take = Math.min(remaining, Math.max(0, balances.debt), capFor(step));
        amountsOut.mortgage += take;
        remaining -= take;
        break;
      }
    }
  }

  // Sweep any surplus no policy step consumed into non-reg so the cash-flow
  // identity (net worth change = income - spending - taxes) stays exact —
  // unless a mortgage-prepay step ran, in which case the leftover rests as
  // cash by design (prepay is terminal; the stepper books it as cash).
  let swept = 0;
  if (remaining > 0 && !reachedPrepay) {
    contributions.nonreg += remaining;
    amountsOut.nonreg += remaining;
    swept = remaining;
    remaining = 0;
  }

  return {
    contributions,
    amounts: amountsOut,
    newRooms,
    sweptToNonreg: swept,
  };
}

/**
 * Funds a cash-flow deficit by withdrawing from accounts in the given order.
 *
 * - The mandatory RRIF minimum (`rrifMinimumDue`) is withdrawn FIRST and ALWAYS
 *   (bounded by the RRSP balance), counted inside `withdrawals.rrsp`.
 * - Any surplus minimum above the deficit returns to cash flow implicitly:
 *   callers net the withdrawals against the deficit when computing the year's
 *   cash flow.
 * - Never overdraws an account; each account contributes `min(balance, need)`
 *   in `order` sequence.
 * - `remainingShortfall` is what could not be raised across all accounts.
 */
export function fundDeficit(
  deficit: number,
  order: AccountType[],
  balances: Record<AccountType, number>,
  rrifMinimumDue: number,
): FundDeficitResult {
  const withdrawals = zeroWithdrawals();
  if (deficit < 0) {
    return { withdrawals, rrifMinimumTaken: 0, remainingShortfall: 0 };
  }

  let cash = deficit;

  // 1) Mandatory minimum first — it is owed regardless of the deficit.
  const rrifMinimumTaken = Math.min(Math.max(0, rrifMinimumDue), Math.max(0, balances.rrsp));
  withdrawals.rrsp += rrifMinimumTaken;
  cash = Math.max(0, deficit - rrifMinimumTaken);

  // 2) Walk the order for the remainder, skipping what the minimum
  //    already took out of the RRSP.
  const taken: Record<AccountType, number> = {
    tfsa: withdrawals.tfsa,
    nonreg: withdrawals.nonreg,
    rrsp: withdrawals.rrsp,
  };
  let remainingShortfall = cash;
  for (const type of order) {
    if (remainingShortfall <= 0) break;
    const available = Math.max(0, (balances[type] ?? 0) - taken[type]);
    const take = Math.min(remainingShortfall, available);
    if (take > 0) {
      taken[type] += take;
      withdrawals[type] += take;
      remainingShortfall -= take;
    }
  }

  return { withdrawals, rrifMinimumTaken, remainingShortfall };
}
