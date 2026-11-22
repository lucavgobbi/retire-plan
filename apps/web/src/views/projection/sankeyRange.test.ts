import { describe, expect, it } from "vitest";
import type { YearResult } from "@retire-plan/engine";
import { resolveSankeyRange, runYearRange } from "./sankeyRange";

const years = (...ages: number[]) => ages.map((age) => ({ age }) as YearResult);

describe("runYearRange", () => {
  it("maps the actual run ages to inclusive household calendar years", () => {
    expect(runYearRange(years(45, 46, 47), 1981)).toEqual({ startYear: 2026, endYear: 2028 });
  });

  it("returns null when the run has no usable years", () => {
    expect(runYearRange([], 1981)).toBeNull();
  });
});

describe("resolveSankeyRange", () => {
  const run = { startYear: 2026, endYear: 2035 };

  it("defaults to the full current run when no preference is stored", () => {
    expect(resolveSankeyRange(undefined, run)).toEqual(run);
  });

  it("preserves a valid stored preference exactly", () => {
    expect(resolveSankeyRange({ startYear: 2028, endYear: 2032 }, run)).toEqual({ startYear: 2028, endYear: 2032 });
  });

  it("clamps a stored preference when the run span changes", () => {
    expect(resolveSankeyRange({ startYear: 2020, endYear: 2040 }, run)).toEqual({ startYear: 2026, endYear: 2035 });
    expect(resolveSankeyRange({ startYear: 2030, endYear: 2040 }, run)).toEqual({ startYear: 2030, endYear: 2035 });
  });

  it("orders a reversed stored preference before clamping", () => {
    expect(resolveSankeyRange({ startYear: 2032, endYear: 2028 }, run)).toEqual({ startYear: 2028, endYear: 2032 });
  });

  it("falls back to the full run for malformed or missing run years", () => {
    expect(resolveSankeyRange({ startYear: Number.NaN, endYear: 2030 }, run)).toEqual(run);
    expect(resolveSankeyRange({ startYear: 2028, endYear: 2030 }, null)).toBeNull();
  });
});
