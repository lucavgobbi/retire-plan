import { describe, expect, it } from "vitest";
import { HISTORICAL_DATASET, HISTORICAL_OBSERVATIONS } from "../../src/returns/historicalDataset";

/** Anchors verified directly against the official JSTdatasetR6.xlsx (SHA-256 in SOURCES.md). */
describe("bundled historical dataset (JST R.6 USA)", () => {
  it("contains exactly 149 continuous annual rows 1872–2020 with no gaps", () => {
    expect(HISTORICAL_OBSERVATIONS).toHaveLength(149);
    const years = HISTORICAL_OBSERVATIONS.map((o) => o.year);
    expect(years[0]).toBe(1872);
    expect(years.at(-1)).toBe(2020);
    expect(new Set(years).size).toBe(149);
    for (let i = 1; i < years.length; i++) expect(years[i]).toBe(years[i - 1]! + 1);
  });

  it("matches the official XLSX anchor values byte-exactly (first, last, and one mid row)", () => {
    expect(HISTORICAL_OBSERVATIONS[0]).toEqual({
      year: 1872, equity: 0.13291139900684357, bond: 0.061484627425670624, cash: 0.05999999865889549,
    });
    expect(HISTORICAL_OBSERVATIONS.at(-1)).toEqual({
      year: 2020, equity: 0.12535415589809418, bond: 0.11865632981061935, cash: 0.0038,
    });
    const second = HISTORICAL_OBSERVATIONS[1]!;
    expect(second).toEqual({
      year: 1873, equity: -0.06311637163162231, bond: 0.06627899408340454, cash: 0.05999999865889549,
    });
  });

  it("all returns are finite fractions within the legal bounds", () => {
    for (const o of HISTORICAL_OBSERVATIONS) {
      for (const value of [o.equity, o.bond, o.cash]) {
        expect(Number.isFinite(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(-1);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("carries complete provenance metadata for UI labeling", () => {
    expect(HISTORICAL_DATASET).toMatchObject({
      name: "Jordà-Schularick-Taylor Macrohistory Database",
      release: "R.6 (2022)",
      url: "https://www.macrohistory.net/app/download/9834512569/JSTdatasetR6.xlsx",
      sha256: "c1bb91fe56ea50d4f27af5c0fc897d481e89ae38ce41eaecab62134c9354981d",
      country: "USA",
      license: "CC BY-NC-SA 4.0",
      coverageStart: 1872,
      coverageEnd: 2020,
    });
  });
});
