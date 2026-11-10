import { describe, expect, it } from "vitest";
import { calculateCurrentAge, withCurrentAge } from "./age";
import { createEmptyWorkspace } from "./defaults";

describe("year-based current age", () => {
  it("uses the current calendar year and advances when the year changes", () => {
    expect(calculateCurrentAge(1981, 2026)).toBe(45);
    expect(calculateCurrentAge(1981, 2027)).toBe(46);
  });
  it("replaces a stale imported age without changing the original workspace", () => {
    const workspace = createEmptyWorkspace();
    workspace.plan.profile.currentAge = 99;
    expect(withCurrentAge(workspace, 2026).plan.profile.currentAge).toBe(45);
    expect(workspace.plan.profile.currentAge).toBe(99);
  });
});
