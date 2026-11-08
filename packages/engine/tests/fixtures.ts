import type { Plan } from "../src/types";

/**
 * Minimal valid Plan fixture. Tests clone and mutate this to build invalid variants.
 */
export function makePlan(): Plan {
  return {
    profile: {
      birthYear: 1981,
      currentAge: 45,
      province: "ON",
      endAge: 95,
    },
    accounts: [
      {
        id: "rrsp-1",
        type: "rrsp",
        balance: 180_000,
        assetMix: { equity: 0.6, bond: 0.3, cash: 0.1 },
      },
      {
        id: "tfsa-1",
        type: "tfsa",
        balance: 60_000,
        assetMix: { equity: 0.7, bond: 0.2, cash: 0.1 },
      },
      {
        id: "nonreg-1",
        type: "nonreg",
        balance: 40_000,
        assetMix: { equity: 0.5, bond: 0.5, cash: 0 },
      },
    ],
    assets: [
      {
        id: "home",
        kind: "primary-home",
        name: "House",
        value: 700_000,
        appreciationRate: 0.02,
      },
    ],
    debts: [
      {
        id: "mortgage-1",
        kind: "mortgage",
        rate: 0.045,
        termYears: 25,
        amortizationYears: 20,
        balance: 350_000,
        monthlyPayment: 1_930,
      },
    ],
    incomes: [
      {
        id: "salary",
        kind: "employment",
        annualAmount: 95_000,
        startAge: 45,
        endAge: 65,
        raiseRate: 0.02,
      },
    ],
    expenses: [
      {
        id: "living",
        name: "Living expenses",
        annualAmount: 55_000,
        startAge: 45,
        endAge: 95,
        inflationRate: 0.02,
      },
    ],
    savingsPolicy: [
      {
        id: "save-tfsa",
        priority: 1,
        target: "tfsa",
        perYearCap: 7_000,
        untilAge: 65,
      },
      {
        id: "save-rrsp",
        priority: 2,
        target: "rrsp",
        matchRate: 0.05,
      },
    ],
  };
}
