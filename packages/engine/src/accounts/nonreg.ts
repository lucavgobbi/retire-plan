/**
 * Non-registered account basis (ACB) tracking — plan Task 14.
 *
 * Simplified ACB model, documented as a v1 approximation in docs/assumptions.md:
 * - Growth: market and book both change by the market's dollar return, bounded at
 *   zero. A total wipeout also wipes out basis.
 * - Withdrawal: basis is removed pro rata to market value, including when book is
 *   above market. A full liquidation consumes all remaining basis and may realize
 *   a capital loss.
 */
import type { AccountPlan } from "../types";

export interface NonregState {
  market: number;
  book: number;
}

export type YearReturn = { equity: number; bond: number; cash: number };
export type AssetMix = NonNullable<AccountPlan["assetMix"]>;

/** The year's asset-class return weighted by the account's mix. */
export function blendedReturn(yearReturn: YearReturn, assetMix: AssetMix): number {
  return (
    assetMix.equity * yearReturn.equity +
    assetMix.bond * yearReturn.bond +
    assetMix.cash * yearReturn.cash
  );
}

/**
 * Grows a non-reg state for one year: market compounds; book gains the same
 * dollar amount the market gains (ACB absorbs the year's growth).
 */
export function nonregGrow(state: NonregState, yearReturn: YearReturn, assetMix: AssetMix): NonregState {
  const r = blendedReturn(yearReturn, assetMix);
  const gainAmount = state.market * r;
  const market = roundCent(Math.max(0, state.market + gainAmount));
  const book = market === 0 ? 0 : roundCent(Math.max(0, state.book + gainAmount));
  return { market, book };
}

export interface NonregWithdrawalResult {
  realizedGain: number;
  newBook: number;
  newMarket: number;
}

/**
 * Withdraws from a non-reg state whose market has already grown this year
 * (`marketAfterGrowth`). The withdrawal caps at market; gains or losses are
 * realized at the current book/market ratio. Full liquidation consumes all basis.
 */
export function nonregWithdrawal(
  state: NonregState,
  marketAfterGrowth: number,
  withdrawal: number,
): NonregWithdrawalResult {
  const market = Math.max(0, marketAfterGrowth);
  const effective = Math.min(Math.max(0, withdrawal), market);
  const ratio = market > 0 ? Math.max(0, state.book / market) : 0;
  const basisConsumed = effective >= market ? Math.max(0, state.book) : effective * ratio;
  const realizedGain = effective - basisConsumed;
  const newBook = roundCent(Math.max(0, state.book - basisConsumed));
  const newMarket = roundCent(Math.max(0, market - effective));
  return { realizedGain: roundCent(realizedGain), newBook, newMarket };
}

function roundCent(x: number): number {
  return Math.round(x * 100) / 100;
}
