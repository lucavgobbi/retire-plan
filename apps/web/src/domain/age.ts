import type { Workspace } from "./types";

/** With only a birth year, this is the age reached during the calendar year. */
export function calculateCurrentAge(birthYear: number, calendarYear: number): number {
  return calendarYear - birthYear;
}

export function withCurrentAge(workspace: Workspace, calendarYear: number): Workspace {
  return {
    ...workspace,
    plan: { ...workspace.plan, profile: { ...workspace.plan.profile, currentAge: calculateCurrentAge(workspace.plan.profile.birthYear, calendarYear) } },
  };
}
