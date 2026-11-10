// Core domain types for the BudgetTool simulation engine.
// These names/fields are the contract every later module depends on — change with care.

export type AccountType = "tfsa" | "rrsp" | "nonreg";

export interface AccountPlan {
  id: string;
  type: AccountType;
  balance: number;
  /** Current adjusted cost base for non-registered holdings; omitted defaults to market value. */
  bookValue?: number;
  assetMix: { equity: number; bond: number; cash: number };
}

export interface AssetPlan {
  id: string;
  kind: "primary-home" | "other";
  name: string;
  value: number;
  appreciationRate: number;
  sellEvent?: { age: number; costsPct: number };
}

export interface DebtPlan {
  id: string;
  kind: "mortgage";
  rate: number;
  termYears: number;
  amortizationYears: number;
  balance: number;
  monthlyPayment: number;
}

export interface IncomePlan {
  id: string;
  kind: "employment" | "cpp" | "oas" | "other";
  annualAmount: number;
  startAge: number;
  endAge?: number;
  raiseRate: number;
}

export interface ExpensePlan {
  id: string;
  name: string;
  annualAmount: number;
  startAge: number;
  endAge?: number;
  inflationRate: number;
}

export type SavingsTarget = "rrsp-match" | "rrsp" | "tfsa" | "nonreg" | "mortgage-prepay";

export interface SavingsPolicyStep {
  id: string;
  priority: number;
  target: SavingsTarget;
  perYearCap?: number;
  untilAge?: number;
  matchRate?: number;
}

export interface Plan {
  profile: { birthYear: number; currentAge: number; province: "ON"; endAge: number };
  accounts: AccountPlan[];
  assets: AssetPlan[];
  debts: DebtPlan[];
  incomes: IncomePlan[];
  expenses: ExpensePlan[];
  savingsPolicy: SavingsPolicyStep[];
}

export interface ReturnSeries {
  years: { age: number; equity: number; bond: number; cash: number }[];
}

export interface Scenario {
  id: string;
  name: string;
  simMode: "deterministic" | "montecarlo" | "historical";
  retirementAge: number;
  returnAssumptions: { equity: number; bond: number; cash: number };
  withdrawalOrder: AccountType[];
  mcConfig?: {
    runs: number;
    stdDev: { equity: number; bond: number; cash: number };
    seed: number;
  };
}

export interface YearResult {
  age: number;
  income: { employment: number; cpp: number; oas: number; gis: number; other: number };
  taxableIncome: number;
  tax: {
    federal: number;
    provincial: number;
    surtax: number;
    oasClawback: number;
    total: number;
    marginalRate: number;
  };
  withdrawals: { tfsa: number; rrsp: number; nonreg: number };
  contributions: { tfsa: number; rrsp: number; nonreg: number };
  savings: { tfsa: number; rrsp: number; nonreg: number; mortgage: number };
  expenses: number;
  shortfall: number;
  balances: { tfsa: number; rrsp: number; nonreg: number; cash: number; home: number; debt: number; otherAssets?: number };
  netWorth: number;
  tfsaRoom: number;
  rrspRoom: number;
  events: string[];
  warnings: string[];
}

export interface SimulationResult {
  years: YearResult[];
  summary: { success: boolean; failureAge?: number; finalNetWorth: number; worstShortfallAge?: number };
}

/**
 * Validates a plan and returns plain-language error messages.
 * An empty array means the plan is valid.
 */
export function validatePlan(plan: Plan): string[] {
  const errors: string[] = [];
  const { profile } = plan;

  // Non-positive ages / years in the profile.
  if (profile.birthYear <= 0) {
    errors.push(`profile.birthYear must be a positive year (got ${profile.birthYear}).`);
  }
  if (profile.currentAge <= 0) {
    errors.push(`profile.currentAge must be a positive age (got ${profile.currentAge}).`);
  }
  if (profile.endAge <= 0) {
    errors.push(`profile.endAge must be a positive age (got ${profile.endAge}).`);
  }
  // Projection horizon must extend beyond the current age.
  if (profile.endAge <= profile.currentAge) {
    errors.push(
      `profile.endAge (${profile.endAge}) must be greater than profile.currentAge (${profile.currentAge}).`,
    );
  }

  for (const account of plan.accounts) {
    if (account.balance < 0) {
      errors.push(
        `Account "${account.id}" has a negative balance (${account.balance}); balances cannot be negative.`,
      );
    }
    if (
      account.bookValue !== undefined &&
      (account.type !== "nonreg" || !Number.isFinite(account.bookValue) || account.bookValue < 0)
    ) {
      errors.push(
        `Account "${account.id}" bookValue is only valid as a non-negative non-registered ACB (got ${account.bookValue}).`,
      );
    }
    const { equity, bond, cash } = account.assetMix;
    for (const [component, value] of [
      ["equity", equity],
      ["bond", bond],
      ["cash", cash],
    ] as const) {
      if (value < 0) {
        errors.push(
          `Account "${account.id}" assetMix.${component} is negative (${value}); each component must be >= 0.`,
        );
      }
    }
    const sum = equity + bond + cash;
    if (Math.abs(sum - 1) > 0.001) {
      errors.push(
        `Account "${account.id}" assetMix components sum to ${sum} but must sum to 1 (within 0.001).`,
      );
    }
  }

  for (const asset of plan.assets) {
    if (asset.value < 0) {
      errors.push(`Asset "${asset.id}" has a negative value (${asset.value}); values cannot be negative.`);
    }
  }

  for (const debt of plan.debts) {
    if (debt.balance <= 0) {
      errors.push(`Debt "${debt.id}" balance must be greater than 0 (got ${debt.balance}).`);
    }
    if (debt.monthlyPayment <= 0) {
      errors.push(
        `Debt "${debt.id}" monthlyPayment must be greater than 0 (got ${debt.monthlyPayment}).`,
      );
    }
  }

  for (const income of plan.incomes) {
    if (income.startAge <= 0) {
      errors.push(`Income "${income.id}" startAge must be a positive age (got ${income.startAge}).`);
    }
    if (income.endAge !== undefined && income.endAge < income.startAge) {
      errors.push(
        `Income "${income.id}" endAge (${income.endAge}) is before its startAge (${income.startAge}); it must end at or after when it starts.`,
      );
    }
  }

  for (const expense of plan.expenses) {
    if (expense.startAge <= 0) {
      errors.push(`Expense "${expense.id}" startAge must be a positive age (got ${expense.startAge}).`);
    }
    if (expense.endAge !== undefined && expense.endAge < expense.startAge) {
      errors.push(
        `Expense "${expense.id}" endAge (${expense.endAge}) is before its startAge (${expense.startAge}); it must end at or after when it starts.`,
      );
    }
  }

  for (const step of plan.savingsPolicy) {
    if (step.perYearCap !== undefined && step.perYearCap < 0) {
      errors.push(
        `Savings step "${step.id}" perYearCap must be >= 0 (got ${step.perYearCap}); negative savings targets are inconsistent.`,
      );
    }
    if (step.matchRate !== undefined && (step.matchRate < 0 || step.matchRate > 1)) {
      errors.push(
        `Savings step "${step.id}" matchRate must be between 0 and 1 (got ${step.matchRate}).`,
      );
    }
    if (step.untilAge !== undefined && step.untilAge <= 0) {
      errors.push(`Savings step "${step.id}" untilAge must be a positive age (got ${step.untilAge}).`);
    }
  }

  return errors;
}
