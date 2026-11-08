import type { TaxYearTables } from "./tables";

/**
 * OAS recovery tax ("clawback") for the year: 15% of net income above the recovery
 * threshold.
 *
 *   clawback = recoveryRate x max(0, netIncome - clawbackThreshold)
 *
 * The stored threshold is the tax year's published value ($95,323 for 2026). When the
 * engine projects future years, applyIndexation(tables, n) scales the threshold by the
 * OAS recovery threshold's own factor — the federal indexationFactor — which is what the
 * engine uses here: the caller is expected to pass already-indexed tables, and this
 * function performs no additional scaling of its own (single source of truth).
 */
export function oasClawback(netIncome: number, tables: TaxYearTables): number {
  return tables.oas.recoveryRate * Math.max(0, netIncome - tables.oas.clawbackThreshold);
}
