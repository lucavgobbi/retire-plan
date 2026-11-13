import { describe, expect, it, vi } from "vitest";
import tablesJson from "../../data/tax/ca-2026.json";
import type { SimulationResult } from "../../src/types";
const { simulateMock } = vi.hoisted(() => ({ simulateMock: vi.fn() }));
vi.mock("../../src/simulate", () => ({ simulate: simulateMock }));
import { planWithdrawalPolicy } from "../../src/strategy/withdrawalPlanner";
import { loadTables, type TaxYearTables } from "../../src/tax/tables";
import { makePlan } from "../fixtures";
import type { Plan, Scenario } from "../../src/types";

const tables: TaxYearTables = loadTables(tablesJson);

function scenario(): Scenario {
  return {
    id: "tax-plan", name: "Tax plan", simMode: "deterministic", retirementAge: 60,
    returnAssumptions: { equity: 0, bond: 0, cash: 0 },
    withdrawalOrder: ["tfsa", "nonreg", "rrsp"],
    benefits: { cpp: false, oas: false, gis: false },
    withdrawalStrategy: "tax-minimizing",
  };
}

function noAssetsPlan(expense: number): Plan {
  const plan = makePlan();
  plan.profile = { birthYear: 1966, currentAge: 60, province: "ON", endAge: 61 };
  plan.accounts = [];
  plan.assets = [];
  plan.debts = [];
  plan.incomes = [];
  plan.expenses = expense === 0 ? [] : [{ id: "living", annualAmount: expense, startAge: 60, endAge: 61, inflationRate: 0 }];
  plan.savingsPolicy = [];
  return plan;
}

describe("withdrawal planner safety", () => {
  function simResult(summarySuccess: boolean, shortfalls: number[], totalTax: number): SimulationResult {
    return {
      years: shortfalls.map((shortfall, index) => ({
        age: 60 + index,
        shortfall,
        tax: { total: totalTax / shortfalls.length },
        income: { gis: 0 },
      })),
      summary: { success: summarySuccess, finalNetWorth: 100_000 },
    } as unknown as SimulationResult;
  }

  function runWith(manual: SimulationResult, candidates: SimulationResult[]) {
    simulateMock.mockReset();
    simulateMock.mockReturnValueOnce(manual);
    candidates.forEach((candidate) => simulateMock.mockReturnValueOnce(candidate));
    return planWithdrawalPolicy(noAssetsPlan(0), scenario(), tables);
  }

  it("rejects a lower-tax candidate with a pre-retirement shortfall when manual is fully funded", () => {
    const output = runWith(
      simResult(true, [0, 0], 100),
      [simResult(true, [1, 0], 50), ...Array.from({ length: 4 }, () => simResult(true, [0, 0], 100))],
    );
    expect(output.metadata.status).toBe("manual-retained");
    expect(output.planned).toBeNull();
    expect(output.metadata.comparison.manualSuccess).toBe(true);
    expect(output.metadata.comparison.optimizedSuccess).toBe(true);
  });

  it("retains manual when all candidates have pre-retirement shortfalls despite summary success", () => {
    const output = runWith(
      simResult(true, [1, 0], 100),
      Array.from({ length: 5 }, (_, index) => simResult(true, [index + 1, 0], 50 + index)),
    );
    expect(output.metadata.status).toBe("no-feasible-policy");
    expect(output.planned).toBeNull();
    expect(output.metadata.comparison.manualSuccess).toBe(false);
    expect(output.metadata.comparison.optimizedSuccess).toBe(false);
    expect(output.metadata.comparison.optimizedTotalTax).toBe(output.metadata.comparison.manualTotalTax);
    expect(output.metadata.plannedWithdrawals).toEqual([]);
  });

  it("allows a fully funded candidate with higher tax than a failed manual baseline", () => {
    const output = runWith(
      simResult(false, [0, 1], 50),
      [simResult(true, [1, 0], 25), simResult(true, [0, 0], 75), ...Array.from({ length: 3 }, () => simResult(true, [1, 0], 10))],
    );
    expect(output.metadata.status).toBe("optimized");
    expect(output.planned).not.toBeNull();
    expect(output.metadata.comparison.manualSuccess).toBe(false);
    expect(output.metadata.comparison.optimizedSuccess).toBe(true);
    expect(output.metadata.comparison.optimizedTotalTax).toBeGreaterThan(output.metadata.comparison.manualTotalTax);
  });
});
