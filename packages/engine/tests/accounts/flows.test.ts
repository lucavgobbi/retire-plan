import { describe, expect, it } from "vitest";
import {
  allocateSurplus,
  fundDeficit,
} from "../../src/accounts/flows";
import type { AccountType, SavingsPolicyStep } from "../../src/types";

const empties = {
  contributions: { tfsa: 0, rrsp: 0, nonreg: 0 },
};
void empties;

describe("allocateSurplus", () => {
  it("walks policy steps by ascending priority", () => {
    const policy: SavingsPolicyStep[] = [
      { id: "b", priority: 2, target: "nonreg" },
      { id: "a", priority: 1, target: "tfsa" },
    ];
    const out = allocateSurplus(
      10_000,
      policy,
      { tfsa: 10_000, rrsp: 0 },
      { tfsa: 0, rrsp: 0, nonreg: 0, debt: 0 },
      undefined,
      45,
    );
    out.contributions = {
      tfsa: out.contributions.tfsa,
      rrsp: out.contributions.rrsp,
      nonreg: out.contributions.nonreg,
    };
    expect(out.contributions).toEqual(
      expect.objectContaining({ tfsa: 10_000, rrsp: 0, nonreg: 0 }),
    );
    expect(out.newRooms).toEqual({ tfsa: 0, rrsp: 0 });
  });

  it("stops at the annual perYearCap", () => {
    const policy: SavingsPolicyStep[] = [
      { id: "s", priority: 1, target: "tfsa", perYearCap: 7_000 },
    ];
    const out = allocateSurplus(
      12_000,
      policy,
      { tfsa: 20_000, rrsp: 0 },
      { tfsa: 0, rrsp: 0, nonreg: 0, debt: 0 },
    );
    expect(out.contributions.tfsa).toBe(7_000);
    // Room reflects only what was contributed.
    expect(out.newRooms.tfsa).toBe(20_000 - 7_000);
  });

  it("does not return cash a second time after sweeping surplus to non-reg", () => {
    const out = allocateSurplus(
      5_000,
      [],
      { tfsa: 0, rrsp: 0 },
      { tfsa: 0, rrsp: 0, nonreg: 0, debt: 0 },
    );
    expect(out.contributions.nonreg).toBe(5_000);
    expect(out.sweptToNonreg).toBe(5_000);
    expect(out.cash).toBe(0);
  });

  it("never exceeds available TFSA room (room-stop)", () => {
    const policy: SavingsPolicyStep[] = [
      { id: "s", priority: 1, target: "tfsa", perYearCap: 7_000 },
    ];
    const out = allocateSurplus(
      12_000,
      policy,
      { tfsa: 3_000, rrsp: 0 },
      { tfsa: 0, rrsp: 0, nonreg: 0, debt: 0 },
    );
    expect(out.contributions.tfsa).toBe(3_000);
    expect(out.newRooms.tfsa).toBe(0);
  });

  it("caps RRSP contributions at treaty room", () => {
    const policy: SavingsPolicyStep[] = [{ id: "s", priority: 1, target: "rrsp" }];
    const out = allocateSurplus(
      10_000,
      policy,
      { tfsa: 0, rrsp: 6_000 },
      { tfsa: 0, rrsp: 0, nonreg: 0, debt: 0 },
    );
    expect(out.contributions.rrsp).toBe(6_000);
    expect(out.newRooms.rrsp).toBe(0);
  });

  it("rrsp-match adds matchRate x contributed as employer match; the match is not surplus", () => {
    const policy: SavingsPolicyStep[] = [
      { id: "s", priority: 1, target: "rrsp-match", matchRate: 0.05 },
    ];
    const out = allocateSurplus(
      10_000,
      policy,
      { tfsa: 0, rrsp: 20_000 },
      { tfsa: 0, rrsp: 0, nonreg: 0, debt: 0 },
    );
    // 10,000 employee + 500 employer = 10,500 landed; room consumed by both (PA).
    expect(out.contributions.rrsp).toBeCloseTo(10_500, 2);
    expect(out.newRooms.rrsp).toBeCloseTo(20_000 - 10_500, 2);
    // The whole 10,000 surplus was the employee part; the 500 came from the employer.
    expect(out.contributions.rrsp - 10_000).toBeCloseTo(500, 2);
  });

  it("skips steps whose untilAge has passed and skips unknown/expired targets", () => {
    const policy: SavingsPolicyStep[] = [
      { id: "old", priority: 1, target: "tfsa", untilAge: 60 },
      { id: "live", priority: 2, target: "nonreg" },
    ];
    const out = allocateSurplus(
      5_000,
      policy,
      { tfsa: 10_000, rrsp: 0 },
      { tfsa: 0, rrsp: 0, nonreg: 0, debt: 0 },
      undefined,
      65, // untilAge 60 has passed
    );
    expect(out.contributions.tfsa).toBe(0);
    expect(out.contributions.nonreg).toBe(5_000);
    // Without an age argument, untilAge steps execute (documented contract).
    const outNoAge = allocateSurplus(
      5_000,
      policy,
      { tfsa: 10_000, rrsp: 0 },
      { tfsa: 0, rrsp: 0, nonreg: 0, debt: 0 },
    );
    expect(outNoAge.contributions.tfsa).toBe(5_000);
  });

  it("routes mortgage-prepay into savings.mortgage, capped at the remaining balance", () => {
    const policy: SavingsPolicyStep[] = [
      { id: "p", priority: 1, target: "mortgage-prepay" },
    ];
    const debt = {
      id: "m",
      kind: "mortgage" as const,
      rate: 0.045,
      termYears: 25,
      amortizationYears: 20,
      balance: 2_500,
      monthlyPayment: 1_930,
    };
    const big = allocateSurplus(
      10_000,
      policy,
      { tfsa: 0, rrsp: 0 },
      { tfsa: 0, rrsp: 0, nonreg: 0, debt: 2_500 },
      debt,
    );
    expect(big.amounts.mortgage).toBe(2_500); // capped at the balance
    expect(big.cash).toBe(7_500); // excess remains conserved as cash after terminal prepay

    const small = allocateSurplus(
      10_000,
      policy,
      { tfsa: 0, rrsp: 0 },
      { tfsa: 0, rrsp: 0, nonreg: 0, debt: 50_000 },
      debt,
    );
    expect(small.amounts.mortgage).toBe(10_000); // plain surplus, no cap binding
    expect(small.cash).toBe(0);

    expect(big.contributions).toEqual({ tfsa: 0, rrsp: 0, nonreg: 0 });
  });

  it("keeps an untilAge step active through the boundary age", () => {
    const out = allocateSurplus(
      5_000,
      [{ id: "tfsa-through-45", priority: 1, target: "tfsa", untilAge: 45 }],
      { tfsa: 10_000, rrsp: 0 },
      { tfsa: 0, rrsp: 0, nonreg: 0, debt: 0 },
      undefined,
      45,
    );
    expect(out.contributions.tfsa).toBe(5_000);
  });

  it("skips policy targets whose account types are absent and preserves the surplus", () => {
    const out = allocateSurplus(
      5_000,
      [
        { id: "tfsa", priority: 1, target: "tfsa" },
        { id: "match", priority: 2, target: "rrsp-match", matchRate: 0.05 },
        { id: "nonreg", priority: 3, target: "nonreg" },
      ],
      { tfsa: 10_000, rrsp: 20_000 },
      { tfsa: 0, rrsp: 0, nonreg: 0, debt: 0 },
      undefined,
      45,
      { tfsa: false, rrsp: false, nonreg: false },
    );
    expect(out.contributions).toEqual({ tfsa: 0, rrsp: 0, nonreg: 0 });
    expect(out.employerMatch).toBe(0);
    expect(out.cash).toBe(5_000);
  });
});

describe("fundDeficit", () => {
  it("covers the deficit in the default order TFSA -> nonreg -> RRSP, never overdrawing", () => {
    const balances: Partial<Record<AccountType, number>> = {
      tfsa: 10_000,
      rrsp: 50_000,
      nonreg: 5_000,
    };
    const out = fundDeficit(30_000, ["tfsa", "nonreg", "rrsp"], balances, 0);
    expect(out.withdrawals).toEqual({ tfsa: 10_000, rrsp: 15_000, nonreg: 5_000 });
    expect(out.rrifMinimumTaken).toBe(0);
    expect(out.remainingShortfall).toBe(0);
  });

  it("the forced RRIF minimum is withdrawn first and always, counted in rrsp withdrawals", () => {
    const balances: Partial<Record<AccountType, number>> = {
      tfsa: 0,
      rrsp: 400_000,
      nonreg: 0,
    };
    // Deficit small, minimum large: it is withdrawn anyway (mandatory).
    const out = fundDeficit(1_000, ["tfsa", "nonreg", "rrsp"], balances, 21_120);
    expect(out.rrifMinimumTaken).toBe(21_120);
    expect(out.withdrawals.rrsp).toBe(21_120); // surplus minimum returns to cash flow
    expect(out.remainingShortfall).toBe(0);
  });

  it("draws the extra RRSP amount only after the minimum (order respected)", () => {
    const balances: Partial<Record<AccountType, number>> = { tfsa: 3_000, rrsp: 100_000, nonreg: 0 };
    // Deficit 20,000 + a 10,000 minimum: tfsa covers 3k; rrsp supplies 7k beyond minimum.
    const out = fundDeficit(20_000, ["tfsa", "nonreg", "rrsp"], balances, 10_000);
    expect(out.withdrawals).toEqual({ tfsa: 3_000, rrsp: 17_000, nonreg: 0 });
    expect(out.remainingShortfall).toBe(0);
  });

  it("records a shortfall when accounts run dry — and floors the mandatory minimum", () => {
    const balances: Partial<Record<AccountType, number>> = { tfsa: 1_000, rrsp: 500, nonreg: 0 };
    // Minimum 2,000 > rrsp 500: only 500 can be taken; it does not create shortfall
    // cash itself, and the deficit (1,000 with tfsa) is still covered first.
    const out = fundDeficit(1_000, ["tfsa", "nonreg", "rrsp"], balances, 2_000);
    expect(out.rrifMinimumTaken).toBe(500);
    expect(out.withdrawals.rrsp).toBe(500);
    expect(out.remainingShortfall).toBe(0);

    // A larger deficit than everything available shortfalls the rest.
    const broke: Partial<Record<AccountType, number>> = { tfsa: 0, rrsp: 0, nonreg: 0 };
    const dry = fundDeficit(30_000, ["tfsa", "nonreg", "rrsp"], broke, 0);
    expect(dry.remainingShortfall).toBe(30_000);
    expect(dry.withdrawals).toEqual({ tfsa: 0, rrsp: 0, nonreg: 0 });
  });

  it("follows a custom withdrawal order without overdrawing", () => {
    const balances: Partial<Record<AccountType, number>> = { tfsa: 4_000, rrsp: 0, nonreg: 2_000 };
    const out = fundDeficit(10_000, ["nonreg", "tfsa", "rrsp"], balances, 0);
    expect(out.withdrawals).toEqual({ tfsa: 4_000, nonreg: 2_000, rrsp: 0 });
    expect(out.remainingShortfall).toBe(4_000);
  });

  it("respects rooms exactly: rrsp room drop equals everything contributed", () => {
    const out = allocateSurplus(
      8_000,
      [{ id: "r", priority: 1, target: "rrsp" }],
      { tfsa: 0, rrsp: 15_000 },
      { tfsa: 0, rrsp: 0, nonreg: 0, debt: 0 },
    );
    expect(out.contributions.rrsp).toBe(8_000);
    expect(out.newRooms.rrsp).toBe(7_000);

    // With an employer match, the room drop covers employee + employer parts.
    const matched = allocateSurplus(
      8_000,
      [{ id: "r", priority: 1, target: "rrsp-match", matchRate: 0.05 }],
      { tfsa: 0, rrsp: 15_000 },
      { tfsa: 0, rrsp: 0, nonreg: 0, debt: 0 },
    );
    expect(matched.contributions.rrsp).toBeCloseTo(8_400, 2);
    expect(matched.newRooms.rrsp).toBeCloseTo(6_600, 2);
  });
});
