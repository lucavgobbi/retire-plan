import { describe, expect, it } from "vitest";
import { cppClaimAgeFactor, estimateCppMonthlyAtStart, estimateOasMonthlyAtStart, monthlyToAnnual } from "./benefitAmounts";

describe("benefit amount previews", () => {
  it("applies official CPP claim-age factors to a personal age-65 estimate", () => {
    expect(cppClaimAgeFactor(60)).toBeCloseTo(0.64);
    expect(cppClaimAgeFactor(65)).toBe(1);
    expect(cppClaimAgeFactor(70)).toBeCloseTo(1.42);
    expect(estimateCppMonthlyAtStart(1_000, 60)).toBe(640);
    expect(estimateCppMonthlyAtStart(1_000, 67)).toBe(1_168);
    expect(estimateCppMonthlyAtStart(1_000, 71)).toBeNull();
  });

  it("applies the OAS residence fraction once, then the age-65-to-70 deferral increase", () => {
    expect(estimateOasMonthlyAtStart(800, 20, 65)).toBe(400);
    expect(estimateOasMonthlyAtStart(800, 20, 70)).toBe(544);
    expect(monthlyToAnnual(544)).toBe(6_528);
    expect(estimateOasMonthlyAtStart(800, 41, 70)).toBeNull();
    expect(estimateOasMonthlyAtStart(800, 20, 75)).toBeNull();
  });

  it("converts monthly gross amounts to annual values rounded to cents", () => {
    expect(monthlyToAnnual(123.45)).toBe(1_481.4);
    expect(monthlyToAnnual(-1)).toBeNull();
  });
});
