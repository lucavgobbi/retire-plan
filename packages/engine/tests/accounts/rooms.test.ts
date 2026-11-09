import { describe, expect, it } from "vitest";
import tablesJson from "../../data/tax/ca-2026.json";
import { loadTables, type TaxYearTables } from "../../src/tax/tables";
import { tfsaRoomNextYear, rrspRoomEarn, type TfsaRoomState } from "../../src/accounts/rooms";

const tables: TaxYearTables = loadTables(tablesJson);

// Reference constants (2026, verified in data/tax/SOURCES.md):
//   tfsa.annualLimit = 7,000; tfsa.cumulativeRoomAsOf2026 = 109,000; tfsa.roomStartAge = 18
//   rrsp.incomeRate = 0.18; rrsp.annualLimit = 33,810
//   TFSA CONTRACT: state.room is ALREADY NET of this year's contributions; the function
//   adds the next year's annual limit (when eligible) plus withdrawalsThisYear, floor 0.
//   SEEDING: an eligible resident starts a 2026-based projection with room ==
//   cumulativeRoomAsOf2026, which ALREADY includes the 2026 limit.
//   RRSP new room = carryforward
//                   + min(0.18 x max(0, earnedIncome - employerContributions), annualLimit).

const noHistory: TfsaRoomState = { room: 0, currentAge: 18 };

describe("tfsaRoomNextYear", () => {
  it("ramps room by the annual limit in eligible years, starting from zero", () => {
    // Three consecutive eligible years from no history: 7,000 -> 14,000 -> 21,000
    expect(tfsaRoomNextYear(noHistory, 0, tables, true)).toBe(7_000);
    const afterOne: TfsaRoomState = { room: 7_000, currentAge: 19 };
    expect(tfsaRoomNextYear(afterOne, 0, tables, true)).toBe(14_000);
    const afterTwo: TfsaRoomState = { room: 14_000, currentAge: 20 };
    expect(tfsaRoomNextYear(afterTwo, 0, tables, true)).toBe(21_000);
  });

  it("adds no room in years the person is not eligible (below roomStartAge)", () => {
    const young: TfsaRoomState = { room: 5_000, currentAge: 17 };
    expect(tfsaRoomNextYear(young, 0, tables, false)).toBe(5_000);
    expect(tfsaRoomNextYear(noHistory, 0, tables, false)).toBe(0);
  });

  it("both contributed room and withdrawal recharge apply to reach next year", () => {
    // Start-of-year room 20,000; contributed 8,000 (room is now net 12,000), withdrew 3,000.
    // Eligible: next = 12,000 - (already-netted 8,000) + 7,000 + 3,000 = 22,000
    const state: TfsaRoomState = { room: 12_000, currentAge: 40 };
    expect(tfsaRoomNextYear(state, 3_000, tables, true)).toBe(22_000);
  });

  it("withdrawals recharged next year do not count as contributions", () => {
    // room 0 at start; withdrawal of 5,000 this year recharges next year's room to 5,000
    // (not eligible for new limits in that year: stays 5,000)
    const state: TfsaRoomState = { room: 0, currentAge: 30 };
    expect(tfsaRoomNextYear(state, 5_000, tables, false)).toBe(5_000);
  });

  it("floors at zero when contributions overdrew the room", () => {
    // Contributions exceeded room: the year ends at -3,000; not eligible, no recharge ->
    // raw -3,000 -> floor 0
    const state: TfsaRoomState = { room: -3_000, currentAge: 30 };
    expect(tfsaRoomNextYear(state, 0, tables, false)).toBe(0);
  });

  it("a fully-eligible resident since 2009 holds the verified 2026 cumulative room", () => {
    // The pinned cumulative constant (109,000) is what adding every annual limit since
    // 2009 produces; the table is the source of truth for that build-up.
    expect(tables.tfsa.cumulativeRoomAsOf2026).toBe(109_000);
    expect(tables.tfsa.cumulativeRoomAsOf2026).toBeGreaterThan(tables.tfsa.annualLimit);
  });

  it("passing room NET of contributions is the only correct usage (negative path)", () => {
    // Start-of-year room 20,000; contributed 8,000 during the year; withdrew 3,000.
    // CORRECT: pass 12,000 (net) -> next-year room 12,000 + 7,000 + 3,000 = 22,000.
    const net: TfsaRoomState = { room: 12_000, currentAge: 40 };
    expect(tfsaRoomNextYear(net, 3_000, tables, true)).toBe(22_000);
    // WRONG: passing the start-of-year room 20,000 un-netted yields 30,000 — the 8,000
    // contributed this year would be double-counted next year. The contract makes this
    // the caller's responsibility; this test pins the canonical arithmetic.
    const unNetted: TfsaRoomState = { room: 20_000, currentAge: 40 };
    expect(tfsaRoomNextYear(unNetted, 3_000, tables, true)).not.toBe(22_000);
  });

  describe("seeding convention (2026-based projection)", () => {
    it("seeds room == cumulativeRoomAsOf2026, which already includes the 2026 limit", () => {
      const seeded: TfsaRoomState = {
        room: tables.tfsa.cumulativeRoomAsOf2026,
        currentAge: 50,
      };
      // A 7,000 contribution in 2026 nets the seed to 102,000; the next call adds ONE
      // annual limit (2027) -> back to exactly the 109,000 initial seed. 116,000 would
      // be double-count (2026 limit applied twice); 102,000 would be under-count
      // (2027 limit skipped).
      const net = seeded.room - tables.tfsa.annualLimit;
      expect(tfsaRoomNextYear({ room: net, currentAge: 50 }, 0, tables, true)).toBe(
        tables.tfsa.cumulativeRoomAsOf2026,
      );
    });

    it("with no 2026 contributions the first call adds exactly one more limit", () => {
      const seeded: TfsaRoomState = {
        room: tables.tfsa.cumulativeRoomAsOf2026,
        currentAge: 50,
      };
      expect(tfsaRoomNextYear(seeded, 0, tables, true)).toBe(
        tables.tfsa.cumulativeRoomAsOf2026 + tables.tfsa.annualLimit,
      );
    });

    it("eligibility defaults from currentAge + 1 (the year the new room applies to)", () => {
      // 17 now -> 18 next year: the first annual limit applies -> 7,000
      expect(tfsaRoomNextYear({ room: 0, currentAge: 17 }, 0, tables)).toBe(7_000);
      // 30 now -> 31 next year: always eligible since 18
      const adult: TfsaRoomState = { room: 2_000, currentAge: 30 };
      expect(tfsaRoomNextYear(adult, 0, tables)).toBe(9_000);
      // 16 now -> 17 next year: still under roomStartAge -> no limit added
      const child: TfsaRoomState = { room: 0, currentAge: 16 };
      expect(tfsaRoomNextYear(child, 0, tables)).toBe(0);
      // explicit flag still overrides the default
      expect(tfsaRoomNextYear({ room: 0, currentAge: 16 }, 0, tables, true)).toBe(7_000);
    });
  });
});

describe("rrspRoomEarn", () => {
  it("earns 18% of earned income from no carryforward", () => {
    expect(rrspRoomEarn(40, 100_000, 0, tables, 0)).toBe(18_000);
  });

  it("the annual limit caps the newly earned room", () => {
    // 0.18 x 300,000 = 54,000 > 33,810 -> capped at 33,810
    expect(rrspRoomEarn(55, 300_000, 0, tables, 0)).toBe(33_810);
    // Room is capped at annualLimit + carryforward (with 0 carryforward, at annualLimit)
    expect(rrspRoomEarn(55, 300_000, 0, tables, 0)).toBeLessThanOrEqual(tables.rrsp.annualLimit);
  });

  it("employer match reduces the pension-adjusted earned room", () => {
    // 0.18 x max(0, 100,000 - 6,000) = 16,920
    expect(rrspRoomEarn(40, 100_000, 0, tables, 6_000)).toBe(16_920);
  });

  it("employer contributions above income leave only the carryforward", () => {
    // max(0, 10,000 - 12,000) = 0 -> carryforward only
    expect(rrspRoomEarn(40, 10_000, 4_500, tables, 12_000)).toBe(4_500);
  });

  it("carryforward carries forward alongside newly earned room", () => {
    // carryforward 5,000 + 0.18 x 60,000 (10,800) = 15,800
    expect(rrspRoomEarn(40, 60_000, 5_000, tables, 0)).toBe(15_800);
  });

  it("zero or negative income earns nothing beyond the carryforward", () => {
    expect(rrspRoomEarn(40, 0, 2_000, tables, 0)).toBe(2_000);
    expect(rrspRoomEarn(40, -5_000, 2_000, tables, 0)).toBe(2_000);
  });
});
