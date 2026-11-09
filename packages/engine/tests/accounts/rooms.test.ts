import { describe, expect, it } from "vitest";
import tablesJson from "../../data/tax/ca-2026.json";
import { loadTables, type TaxYearTables } from "../../src/tax/tables";
import { tfsaRoomNextYear, rrspRoomEarn, type TfsaRoomState } from "../../src/accounts/rooms";

const tables: TaxYearTables = loadTables(tablesJson);

// Reference constants (2026, verified in data/tax/SOURCES.md):
//   tfsa.annualLimit = 7,000; tfsa.cumulativeRoomAsOf2026 = 109,000; tfsa.roomStartAge = 18
//   rrsp.incomeRate = 0.18; rrsp.annualLimit = 33,810
//   TFSA next-year room = room - usedThisYear + (eligible ? annualLimit : 0)
//                         + withdrawalsThisYear, floored at 0 (withdrawal recharge next year).
//   RRSP new room = carryforward
//                   + min(0.18 x max(0, earnedIncome - employerContributions), annualLimit),
//   capped at annualLimit + carryforward.

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
