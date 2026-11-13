import { describe, expect, it } from "vitest";
import type { YearResult } from "@retire-plan/engine";
import {
  netWorthSeries,
  incomeSpendSeries,
  taxStackSeries,
  drawdownSeries,
  dropNonFinite,
} from "./adapters";

const year = (age: number, partial: Partial<YearResult> = {}): YearResult => ({
  age,
  income: { employment: 0, cpp: 0, oas: 0, gis: 0, other: 0 },
  taxableIncome: 0,
  tax: { federal: 0, provincial: 0, surtax: 0, oasClawback: 0, total: 0, marginalRate: 0 },
  withdrawals: { tfsa: 0, rrsp: 0, nonreg: 0 },
  contributions: { tfsa: 0, rrsp: 0, nonreg: 0 },
  savings: { tfsa: 0, rrsp: 0, nonreg: 0, mortgage: 0 },
  expenses: 0,
  shortfall: 0,
  balances: { tfsa: 0, rrsp: 0, nonreg: 0, cash: 0, home: 0, debt: 0 },
  netWorth: 0,
  tfsaRoom: 0,
  rrspRoom: 0,
  events: [],
  warnings: [],
  ...partial,
});

describe("chart adapters", () => {
  it("netWorthSeries: one point per year, x = age", () => {
    const points = netWorthSeries([year(45, { netWorth: 1_000 }), year(46, { netWorth: 1_200 })]);
    expect(points).toHaveLength(2);
    expect(points[0]).toEqual({ x: 45, y: 1_000 });
    expect(points[1]).toEqual({ x: 46, y: 1_200 });
  });

  it("dropNonFinite replaces non-finite values with null (charts never see NaN)", () => {
    const points = dropNonFinite([
      { x: 1, y: 5 },
      { x: 2, y: NaN },
      { x: 3, y: Infinity },
    ]);
    expect(points[1]?.y).toBeNull();
    expect(points[2]?.y).toBeNull();
    expect(points[0]?.y).toBe(5);
  });

  it("incomeSpendSeries carries income, expenses and shortfall bands", () => {
    const [p] = incomeSpendSeries([
      year(45, { income: { employment: 90_000, cpp: 0, oas: 0, gis: 0, other: 0 }, expenses: 50_000, shortfall: 1_000 }),
    ]);
    expect(p).toEqual({ x: 45, income: 90_000, expenses: 50_000, shortfall: 1_000 });
  });

  it("taxStackSeries carries the four tax components plus the total", () => {
    const [p] = taxStackSeries([
      year(66, { tax: { federal: 3, provincial: 2, surtax: 1, oasClawback: 4, total: 10, marginalRate: 0 } }),
    ]);
    expect(p).toEqual({ x: 66, federal: 3, provincial: 2, surtax: 1, oasClawback: 4, total: 10 });
  });

  it("drawdownSeries carries the three account balances, cash and other assets", () => {
    const [withOther] = drawdownSeries([
      year(70, { balances: { tfsa: 1, rrsp: 2, nonreg: 3, cash: 4, home: 0, debt: 0, otherAssets: 9 } }),
    ]);
    expect(withOther).toEqual({ x: 70, tfsa: 1, rrsp: 2, nonreg: 3, cash: 4, otherAssets: 9 });
    // Legacy results without the optional field normalize to 0.
    const [legacy] = drawdownSeries([
      year(70, { balances: { tfsa: 1, rrsp: 2, nonreg: 3, cash: 4, home: 0, debt: 0 } }),
    ]);
    expect(legacy).toEqual({ x: 70, tfsa: 1, rrsp: 2, nonreg: 3, cash: 4, otherAssets: 0 });
  });

  it("drawdownSeries aggregates investment types; cash is pool + named accounts (chart shows categories, not per-named accounts)", () => {
    // A plan with two tfsa accounts and two named cash accounts: results carry
    // per-type aggregates plus the cashAccounts breakdown; the adapter maps
    // balances.cash (pool + Σnamed, counted once) to the single cash category.
    const [p] = drawdownSeries([
      year(70, {
        balances: { tfsa: 3000, rrsp: 0, nonreg: 500, cash: 1600, home: 0, debt: 0 },
        cashAccounts: [
          { id: "cash-1", name: "Chequing", balance: 1000 },
          { id: "cash-2", balance: 600 },
        ],
      }),
    ]);
    expect(p).toEqual({ x: 70, tfsa: 3000, rrsp: 0, nonreg: 500, cash: 1600, otherAssets: 0 });
    expect(p!.cash).toBe(1000 + 600); // named balances included once, no double count
  });
});
