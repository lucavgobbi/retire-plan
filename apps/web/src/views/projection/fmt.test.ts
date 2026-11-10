import { describe, expect, it } from "vitest";
import { fmtMoney, fmtMoneyDetail, fmtPercent, yearForAge } from "./fmt";

describe("fmtMoney — never-NaN rule", () => {
  it("formats finite money with thousands separators, symbol, no decimals", () => {
    expect(fmtMoney(1_234_567.89)).toMatch(/1,234,568/);
    expect(fmtMoney(0)).toMatch(/\$/);
    expect(fmtMoney(-4500.2)).toMatch(/-?\(?\$?4,500/);
  });

  it("renders an em dash for non-finite values instead of NaN/Inf", () => {
    expect(fmtMoney(NaN)).toBe("—");
    expect(fmtMoney(Infinity)).toBe("—");
    expect(fmtMoney(-Infinity)).toBe("—");
    expect(fmtMoney(undefined)).toBe("—");
  });

  it("detail formatting keeps two decimals for expansion views", () => {
    expect(fmtMoneyDetail(1234.561)).toMatch(/1,234\.56/);
    expect(fmtMoneyDetail(NaN)).toBe("—");
  });
});

describe("fmtPercent", () => {
  it("renders fractions as percentages", () => {
    expect(fmtPercent(0.4358)).toBe("43.6%");
    expect(fmtPercent(0)).toBe("0.0%");
  });
  it("renders em dashes for non-finite fractions", () => {
    expect(fmtPercent(NaN)).toBe("—");
    expect(fmtPercent(Infinity)).toBe("—");
  });
});

describe("yearForAge", () => {
  it("derives the calendar year from birthYear + age (YearResult has no year field)", () => {
    expect(yearForAge(1981, 45)).toBe(2026);
    expect(yearForAge(1981, 65)).toBe(2046);
  });
});
