import type { AccountType } from "@retire-plan/engine";

export const INVESTMENT_ACCOUNT_TYPES = ["tfsa", "nonreg", "rrsp"] as const;
export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  tfsa: "TFSA",
  nonreg: "Non-registered",
  rrsp: "RRSP/RRIF",
  cash: "Cash account",
};
export type CashOrderPosition = "automatic" | "0" | "1" | "2" | "3";

export function investmentOrder(order: readonly AccountType[]): AccountType[] {
  return order.filter((type) => type !== "cash");
}

export function cashOrderPosition(order: readonly AccountType[]): CashOrderPosition {
  const index = order.indexOf("cash");
  return index < 0 ? "automatic" : String(index) as CashOrderPosition;
}

/** Keep the legacy three-account order unless the user explicitly places cash. */
export function orderWithCashPosition(
  order: readonly AccountType[],
  position: CashOrderPosition,
): AccountType[] {
  const investments = investmentOrder(order);
  if (position === "automatic") return investments;
  const result = [...investments];
  result.splice(Number(position), 0, "cash");
  return result;
}

/** Selecting an already-placed account swaps priorities atomically, never duplicating it. */
export function swapOrderPosition<T extends string>(order: readonly T[], index: number, selected: T): T[] {
  const result = [...order];
  const selectedIndex = result.indexOf(selected);
  if (index < 0 || index >= result.length || selectedIndex < 0) return result;
  [result[index], result[selectedIndex]] = [result[selectedIndex]!, result[index]!];
  return result;
}

export function formatAccountOrder(order: readonly AccountType[]): string {
  return order.map(type => ACCOUNT_TYPE_LABELS[type]).join(" → ");
}
