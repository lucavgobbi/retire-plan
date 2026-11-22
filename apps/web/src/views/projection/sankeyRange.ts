import type { YearResult } from "@retire-plan/engine";
import { yearForAge } from "./fmt";

export interface ProjectionYearRange {
  startYear: number;
  endYear: number;
}

/** Inclusive household calendar-year span of the actual run years shown by the table. */
export function runYearRange(years: YearResult[], birthYear: number): ProjectionYearRange | null {
  const calendarYears = years.map(({ age }) => yearForAge(birthYear, age)).filter((year) => Number.isSafeInteger(year));
  if (calendarYears.length === 0) return null;
  return { startYear: Math.min(...calendarYears), endYear: Math.max(...calendarYears) };
}

/**
 * Resolves the persisted Sankey range against the CURRENT run span. A valid
 * preference is preserved exactly; a preference outside the run is clamped to
 * the run's inclusive bounds for display. The stored preference is never
 * rewritten here — mounting a new run must not mutate workspace preferences.
 */
export function resolveSankeyRange(
  stored: { startYear?: unknown; endYear?: unknown } | undefined,
  runRange: ProjectionYearRange | null,
): ProjectionYearRange | null {
  if (runRange === null) return null;
  if (stored === undefined || !Number.isSafeInteger(stored.startYear) || !Number.isSafeInteger(stored.endYear)) {
    return runRange;
  }
  const startYear = Math.min(stored.startYear as number, stored.endYear as number);
  const endYear = Math.max(stored.startYear as number, stored.endYear as number);
  return {
    startYear: Math.min(runRange.endYear, Math.max(runRange.startYear, startYear)),
    endYear: Math.min(runRange.endYear, Math.max(runRange.startYear, endYear)),
  };
}
