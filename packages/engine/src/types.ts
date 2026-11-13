// Core domain types for the RetirePlan simulation engine.
// These names/fields are the contract every later module depends on — change with care.

export type AccountType = "cash" | "tfsa" | "rrsp" | "nonreg";

export interface AccountPlan {
  id: string;
  /** Optional display name; falls back to the account type in the UI. */
  name?: string;
  type: AccountType;
  balance: number;
  /** Current adjusted cost base for non-registered holdings; omitted defaults to market value. */
  bookValue?: number;
  /** Annual investment mix for tfsa/rrsp/nonreg accounts; cash accounts omit it (no market exposure). */
  assetMix?: { equity: number; bond: number; cash: number };
  /** Fixed nominal annual interest for cash accounts only; omitted defaults to 0%. */
  interestRate?: number;
}

export interface AssetPlan {
  id: string;
  kind: "primary-home" | "other";
  /** Optional display name. */
  name?: string;
  value: number;
  appreciationRate: number;
  sellEvent?: { age: number; costsPct: number };
}

export type PaymentFrequency = "monthly" | "biweekly" | "weekly";

export interface DebtPlan {
  id: string;
  kind: "mortgage";
  rate: number;
  termYears: number;
  amortizationYears: number;
  balance: number;
  /** Payment amount per period; the period length is set by paymentFrequency. */
  monthlyPayment: number;
  /** Payments per year: monthly (12, default), biweekly (26), weekly (52). */
  paymentFrequency?: PaymentFrequency;
}

export interface IncomePlan {
  id: string;
  kind: "employment" | "cpp" | "oas" | "other";
  /** Optional display name. */
  name?: string;
  annualAmount: number;
  startAge: number;
  endAge?: number;
  raiseRate: number;
}

export interface ExpensePlan {
  id: string;
  /** Optional display name. */
  name?: string;
  annualAmount: number;
  startAge: number;
  endAge?: number;
  inflationRate: number;
}

export type SavingsTarget = "rrsp-match" | "rrsp" | "tfsa" | "nonreg" | "cash" | "mortgage-prepay";

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

/** Benefit receipt toggles; absent means every configured benefit is received (legacy). */
export interface BenefitSettings {
  cpp: boolean;
  oas: boolean;
  gis: boolean;
}

export type WithdrawalStrategy = "manual" | "tax-minimizing";

export interface Scenario {
  id: string;
  name: string;
  simMode: "deterministic" | "montecarlo" | "historical";
  retirementAge: number;
  returnAssumptions: { equity: number; bond: number; cash: number };
  withdrawalOrder: AccountType[];
  /** Optional benefit receipt toggles; absent = all configured benefits received (legacy). */
  benefits?: BenefitSettings;
  /** Optional withdrawal strategy; absent = manual (the configured withdrawalOrder, legacy). */
  withdrawalStrategy?: WithdrawalStrategy;
  mcConfig?: {
    runs: number;
    stdDev: { equity: number; bond: number; cash: number };
    seed: number;
  };
  historicalConfig?: { startYear: number };
}

export interface YearResult {
  age: number;
  income: { employment: number; cpp: number; oas: number; gis: number; other: number };
  /** Taxable interest credited to named cash accounts this year; optional for legacy runs. Ordinary income, never capital gains. */
  cashInterest?: number;
  /** Proactive tax-strategy RRSP draw executed this year (above the mandatory RRIF minimum); optional for manual/legacy runs. */
  plannedRrspDraw?: number;
  taxableIncome: number;
  tax: {
    federal: number;
    provincial: number;
    surtax: number;
    oasClawback: number;
    total: number;
    marginalRate: number;
  };
  withdrawals: { tfsa: number; rrsp: number; nonreg: number; cash?: number };
  contributions: { tfsa: number; rrsp: number; nonreg: number; cash?: number };
  savings: { tfsa: number; rrsp: number; nonreg: number; cash?: number; mortgage: number };
  expenses: number;
  /** Actual required minimum included in RRSP withdrawals; optional for legacy runs and pre-RRIF ages. */
  rrifMinimumWithdrawal?: number;
  /** Per-item expense amounts before the annual total is rounded; optional for stored legacy runs. */
  expenseBreakdown?: { id: string; name?: string; amount: number }[];
  shortfall: number;
  balances: { tfsa: number; rrsp: number; nonreg: number; cash: number; home: number; debt: number; otherAssets?: number };
  /** Per-named-cash-account year-end balances; optional for legacy runs and plans without cash accounts. */
  cashAccounts?: { id: string; name?: string; balance: number }[];
  netWorth: number;
  tfsaRoom: number;
  rrspRoom: number;
  events: string[];
  warnings: string[];
}

/** Per-age proactive RRSP draws planned by the tax-minimizing strategy (net draws above the mandatory RRIF minimum). */
export interface PlannedWithdrawals {
  strategy: "tax-minimizing";
  /**
   * Execution RULE (fixed per run, applied pathwise with current-year state only —
   * no lookahead): proactively draw the RRSP above the mandatory RRIF minimum until
   * the year's taxable income reaches the resolved target. Target resolvers, from the
   * planner's candidate grid: 0 = defer (minimum/deficit draws only), a positive
   * number = federal bracket top for the year (indexed by the year tables).
   */
  fillTargetTaxable: number;
  /** Planning-time deterministic schedule; the rule reproduces it on the known assumptions. */
  byAge: { age: number; netRrspDraw: number }[];
}

/**
 * Planning-time comparison metadata for the tax-minimizing strategy. All figures come
 * from ONE deterministic evaluation under known assumptions — they are a bounded
 * heuristic's candidate comparison, clearly NOT per-path guarantees for stochastic or
 * historical modes (the same fixed policy is then replayed on every run without
 * lookahead).
 */
export interface WithdrawalPlanMetadata {
  strategy: "tax-minimizing";
  /** Fixed description of the planning basis and its non-anticipativity guarantee. */
  planningBasis: string;
  /**
   * Planning feasibility means summary.success plus finite, zero shortfall in every
   * modeled year (including pre-retirement years). Status: optimized = a fully funded
   * candidate was selected; manual-retained = the manual baseline was already fully
   * funded and no fully funded candidate strictly lowered its tax; no-feasible-policy
   * = manual was not fully funded and no candidate was fully funded, so manual is retained.
   * A selected fully funded candidate may cost more tax
   * than a failed manual baseline; the comparison fields disclose that.
   */
  status: "optimized" | "manual-retained" | "no-feasible-policy";
  /** Executed plan: ages with a planned proactive net RRSP draw. */
  plannedWithdrawals: { age: number; netRrspDraw: number }[];
  comparison: {
    manualTotalTax: number;
    optimizedTotalTax: number;
    manualFinalNetWorth: number;
    optimizedFinalNetWorth: number;
    /** Planner full-funding result: retirement success and no shortfall in any modeled year. */
    manualSuccess: boolean;
    /** Planner full-funding result: retirement success and no shortfall in any modeled year. */
    optimizedSuccess: boolean;
    manualGisTotal: number;
    optimizedGisTotal: number;
    /** Fixed selection-rule disclosure (feasibility-first, tax tiebreak, heuristic). */
    selectionRule: string;
  };
}

export interface SimulationResult {
  years: YearResult[];
  summary: { success: boolean; failureAge?: number; finalNetWorth: number; worstShortfallAge?: number };
  /** Present only when the tax-minimizing strategy produced and executed a plan. */
  withdrawalPlan?: WithdrawalPlanMetadata;
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
    const mix = account.assetMix;
    if (account.type === "cash") {
      if (mix !== undefined) {
        errors.push(`Account "${account.id}" is a cash account; cash accounts have no assetMix (remove the mix).`);
      }
      if (account.interestRate !== undefined && (!Number.isFinite(account.interestRate) || account.interestRate < 0)) {
        errors.push(`Account "${account.id}" interestRate must be a non-negative number (got ${account.interestRate}).`);
      }
    } else {
      if (mix === undefined) {
        errors.push(`Account "${account.id}" needs an assetMix with equity/bond/cash components summing to 1.`);
      } else {
        const { equity, bond, cash } = mix;
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
    if (debt.paymentFrequency !== undefined && !["monthly", "biweekly", "weekly"].includes(debt.paymentFrequency)) {
      errors.push(
        `Debt "${debt.id}" paymentFrequency "${debt.paymentFrequency}" is not supported (use monthly, biweekly, or weekly).`,
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

/**
 * Validates scenario-level benefit/strategy settings. An empty array means valid.
 * Absent `benefits`/`withdrawalStrategy` are always valid (legacy behavior).
 * Note: `benefits.oas === false` disables GIS at simulation time (GIS eligibility
 * requires qualifying for OAS — canada.ca GIS page), not a validation error.
 */
export function validateScenarioSettings(scenario: Pick<Scenario, "benefits" | "withdrawalStrategy">): string[] {
  const errors: string[] = [];
  const benefits = scenario.benefits;
  if (benefits !== undefined) {
    if (typeof benefits !== "object" || benefits === null ||
      Object.keys(benefits).length !== 3 ||
      !["cpp", "oas", "gis"].every((k) => typeof (benefits as unknown as Record<string, unknown>)[k] === "boolean")) {
      errors.push("benefits must be an object with exactly the boolean flags cpp, oas, gis.");
    }
  }
  if (scenario.withdrawalStrategy !== undefined && scenario.withdrawalStrategy !== "manual" && scenario.withdrawalStrategy !== "tax-minimizing") {
    errors.push(`withdrawalStrategy must be "manual" or "tax-minimizing" (got ${String(scenario.withdrawalStrategy)}).`);
  }
  return errors;
}
