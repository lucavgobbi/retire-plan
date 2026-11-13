// Lane B (Task 3/4). Structural validation of persisted/exported shapes.
//
// The engine's `validatePlan` is the SEMANTIC check and stays the final gate, but it
// assumes shape-valid inputs (`plan.accounts.map(...)` would throw on garbage JSON).
// This module is the plain-language STRUCTURAL check that makes persistence and import
// safe before anything semantic runs. All functions take `unknown` and return error
// strings; an empty array means "shape-valid for this SCHEMA_VERSION".
//
// Layers (checked in order where layered):
//   SC taupe checks (this module)  →  migrations (schema version)  →  plan semantics
//   (engine validatePlan)  →  import/parse result  {ok:false, errors:[...]}  when any
//   layer objects. Nothing here ever mutates or wipes data (see db.ts recovery flow).
import type {
  Plan,
  PlanMeta,
  PlanFile,
  ScenarioDelta,
  Workspace,
} from "../domain/types";
import { HISTORICAL_DATASET, validatePlan } from "@retire-plan/engine";

/** Current PlanFile JSON payload version (NOT the IndexedDB layout version; see db.ts). */
export const SCHEMA_VERSION = 1;

// --- tiny shape helpers (no deps; keep in sync with domain/types.ts by review) ---

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function isString(value: unknown): value is string {
  return typeof value === "string";
}
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
export function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}
export function isIsoDateString(value: unknown): value is string {
  return isString(value) && !Number.isNaN(Date.parse(value));
}
function isEnum<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return isString(value) && (allowed as readonly string[]).includes(value);
}

// --- enum registries (structural gate; mirror the engine types in packages/
// engine/src/types.ts — the engine's validatePlan does NOT reject unknown
// enum values, and numbered/typed stats silently drop unsupported rows) ---

export const ACCOUNT_TYPES = ["tfsa", "rrsp", "nonreg", "cash"] as const;
export const ASSET_KINDS = ["primary-home", "other"] as const;
export const DEBT_KINDS = ["mortgage"] as const;
export const INCOME_KINDS = ["employment", "cpp", "oas", "other"] as const;
export const SAVINGS_TARGETS = ["rrsp-match", "rrsp", "tfsa", "nonreg", "cash", "mortgage-prepay"] as const;
/** The tax tables ship Ontario-only today; the engine profile type is literally "ON". */
export const SUPPORTED_PROVINCES = ["ON"] as const;
export const WITHDRAWAL_STRATEGIES = ["manual", "tax-minimizing"] as const;

function validateScenarioOptions(value: Record<string, unknown>, label: string): string[] {
  const errors: string[] = [];
  const benefits = value.benefits;
  if (benefits !== undefined) {
    if (!isRecord(benefits) || Object.keys(benefits).length !== 3 || !["cpp", "oas", "gis"].every(key => typeof benefits[key] === "boolean")) {
      errors.push(`${label} benefits must contain boolean cpp, oas, and gis options.`);
    } else if (benefits.oas === false && benefits.gis === true) {
      errors.push(`${label} benefits cannot enable GIS when OAS is disabled.`);
    }
  }
  if (value.withdrawalStrategy !== undefined && !isEnum(value.withdrawalStrategy, WITHDRAWAL_STRATEGIES)) {
    errors.push(`${label} withdrawalStrategy must be manual or tax-minimizing.`);
  }
  return errors;
}

function isAssetMix(value: unknown, label: string, errors: string[]): boolean {
  if (!isRecord(value)) {
    errors.push(`${label} assetMix must be an object with equity/bond/cash numbers.`);
    return false;
  }
  let ok = true;
  for (const key of ["equity", "bond", "cash"] as const) {
    const share = value[key];
    if (!isFiniteNumber(share) || share < 0 || share > 1) {
      errors.push(`${label} assetMix.${key} must be a number between 0 and 1.`);
      ok = false;
    }
  }
  if (ok) {
    const total =
      (value.equity as number) + (value.bond as number) + (value.cash as number);
    if (Math.abs(total - 1) > 1e-6) {
      errors.push(`${label} assetMix shares must total 100% (got ${Math.round(total * 100)}%).`);
      ok = false;
    }
  }
  return ok;
}

// --- engine plan shape (strict structural pass BEFORE engine semantics) ---

export interface PlanShapeCheck {
  plan: Plan;
  errors: string[];
}

/**
 * Verifies a JSON value IS an engine `Plan` (shape), then runs the engine's own
 * `validatePlan` for full error reporting in one pass. Returns every error found.
 */
export function validatePlanShape(value: unknown): string[] {
  if (!isRecord(value)) return ["The plan entry is missing or not an object."];
  if (!isRecord(value.profile)) return ["The plan is missing its profile section."];
  const errors: string[] = [];
  for (const [section, expected] of [
    ["accounts", ["id", "type", "balance"]],
    ["assets", ["id", "kind", "value", "appreciationRate"]],
    ["debts", ["id", "kind", "rate", "termYears", "amortizationYears", "balance", "monthlyPayment"]],
    ["incomes", ["id", "kind", "annualAmount", "startAge", "raiseRate"]],
    ["expenses", ["id", "annualAmount", "startAge", "inflationRate"]],
    ["savingsPolicy", ["id", "priority", "target"]],
  ] as const) {
    const list = value[section];
    if (list === undefined) {
      errors.push(`Plan section "${section}" is required (use an empty list).`);
      continue;
    }
    if (!Array.isArray(list)) {
      errors.push(`Plan section "${section}" must be a list.`);
      continue;
    }
    list.forEach((item, i) => {
      const label = `Plan section "${section}" entry ${i + 1}`;
      if (!isRecord(item)) {
        errors.push(`${label} is not an object.`);
        return;
      }
      for (const field of expected) {
        if (item[field] === undefined) {
          errors.push(`${label} is missing the field "${field}".`);
        }
      }
      if (!isNonEmptyString(item.id)) errors.push(`${label} needs a non-empty id.`);
      for (const field of ["startAge", "endAge", "untilAge"] as const) {
        if (item[field] !== undefined && (!isInteger(item[field]) || item[field] <= 0)) {
          errors.push(`${label} ${field} must be a positive whole number of years.`);
        }
      }
      switch (section) {
        case "accounts": {
          if (item.type !== undefined && !isEnum(item.type, ACCOUNT_TYPES)) {
            errors.push(
              `${label} account type "${String(item.type)}" is not supported ` +
                `(use ${ACCOUNT_TYPES.join(", ")}).`,
            );
          }
          if (item.name !== undefined && item.name !== "" && !isNonEmptyString(item.name)) {
            errors.push(`${label} needs a non-empty name.`);
          }
          if (item.type === "cash") {
            if (item.assetMix !== undefined) errors.push(`${label} cash accounts do not use an assetMix.`);
            if (item.bookValue !== undefined) errors.push(`${label} cash accounts do not use a bookValue.`);
            if (item.interestRate !== undefined && !isFiniteNumber(item.interestRate)) {
              errors.push(`${label} interestRate must be a finite number when present.`);
            }
          } else {
            isAssetMix(item.assetMix, label, errors);
            if (item.interestRate !== undefined) errors.push(`${label} interestRate is supported only for cash accounts.`);
          }
          if (item.balance !== undefined && !isFiniteNumber(item.balance)) {
            errors.push(`${label} balance must be a finite number.`);
          }
          if (item.bookValue !== undefined && (!isFiniteNumber(item.bookValue) || item.bookValue < 0)) {
            errors.push(`${label} bookValue must be a non-negative finite number.`);
          }
          break;
        }
        case "assets": {
          if (item.kind !== undefined && !isEnum(item.kind, ASSET_KINDS)) {
            errors.push(
              `${label} asset kind "${String(item.kind)}" is not supported ` +
                `(use ${ASSET_KINDS.join(", ")}).`,
            );
          }
          if (item.name !== undefined && item.name !== "" && !isNonEmptyString(item.name)) {
            errors.push(`${label} needs a non-empty name.`);
          }
          if (item.value !== undefined && !isFiniteNumber(item.value)) {
            errors.push(`${label} value must be a finite number.`);
          }
          if (item.appreciationRate !== undefined && !isFiniteNumber(item.appreciationRate)) {
            errors.push(`${label} appreciationRate must be a finite number.`);
          }
          if (item.sellEvent !== undefined) {
            if (!isRecord(item.sellEvent)) {
              errors.push(`${label} sellEvent must be an object.`);
            } else {
              if (!isInteger(item.sellEvent.age) || item.sellEvent.age <= 0) {
                errors.push(`${label} sellEvent.age must be a whole number of years.`);
              }
              if (
                (!isFiniteNumber(item.sellEvent.costsPct) || item.sellEvent.costsPct < 0 || item.sellEvent.costsPct > 1)
              ) {
                errors.push(`${label} sellEvent.costsPct must be a non-negative number.`);
              }
            }
          }
          break;
        }
        case "debts": {
          if (item.kind !== undefined && !isEnum(item.kind, DEBT_KINDS)) {
            errors.push(
              `${label} debt kind "${String(item.kind)}" is not supported ` +
                `(use ${DEBT_KINDS.join(", ")}).`,
            );
          }
          if (item.rate !== undefined && (!isFiniteNumber(item.rate) || (item.rate as number) < 0)) {
            errors.push(`${label} rate must be a non-negative number.`);
          }
          for (const years of ["termYears", "amortizationYears"] as const) {
            if (item[years] !== undefined && (!isInteger(item[years]) || (item[years] as number) <= 0)) {
              errors.push(`${label} ${years} must be a whole number of years.`);
            }
          }
          if (item.balance !== undefined && !isFiniteNumber(item.balance)) {
            errors.push(`${label} balance must be a finite number.`);
          }
          if (item.monthlyPayment !== undefined && !isFiniteNumber(item.monthlyPayment)) {
            errors.push(`${label} monthlyPayment must be a finite number.`);
          }
          if (
            item.paymentFrequency !== undefined &&
            !isEnum(item.paymentFrequency, ["monthly", "biweekly", "weekly"] as const)
          ) {
            errors.push(
              `${label} paymentFrequency "${String(item.paymentFrequency)}" is not supported ` +
                `(use monthly, biweekly, or weekly).`,
            );
          }
          break;
        }
        case "incomes": {
          if (item.kind !== undefined && !isEnum(item.kind, INCOME_KINDS)) {
            errors.push(
              `${label} income kind "${String(item.kind)}" is not supported ` +
                `(use ${INCOME_KINDS.join(", ")}).`,
            );
          }
          if (item.name !== undefined && item.name !== "" && !isNonEmptyString(item.name)) {
            errors.push(`${label} needs a non-empty name.`);
          }
          if (item.annualAmount !== undefined && !isFiniteNumber(item.annualAmount)) {
            errors.push(`${label} annualAmount must be a finite number.`);
          }
          if (item.startAge !== undefined && !isInteger(item.startAge)) {
            errors.push(`${label} startAge must be a whole number of years.`);
          }
          if (item.endAge !== undefined && !isInteger(item.endAge)) {
            errors.push(`${label} endAge must be a whole number of years.`);
          }
          if (item.raiseRate !== undefined && !isFiniteNumber(item.raiseRate)) {
            errors.push(`${label} raiseRate must be a finite number.`);
          }
          break;
        }
        case "expenses": {
          if (item.name !== undefined && item.name !== "" && !isNonEmptyString(item.name)) {
            errors.push(`${label} needs a non-empty name.`);
          }
          if (item.annualAmount !== undefined && !isFiniteNumber(item.annualAmount)) {
            errors.push(`${label} annualAmount must be a finite number.`);
          }
          if (item.startAge !== undefined && !isInteger(item.startAge)) {
            errors.push(`${label} startAge must be a whole number of years.`);
          }
          if (item.inflationRate !== undefined && !isFiniteNumber(item.inflationRate)) {
            errors.push(`${label} inflationRate must be a finite number.`);
          }
          break;
        }
        case "savingsPolicy": {
          if (item.target !== undefined && !isEnum(item.target, SAVINGS_TARGETS)) {
            errors.push(
              `${label} savings target "${String(item.target)}" is not supported ` +
                `(use ${SAVINGS_TARGETS.join(", ")}).`,
            );
          }
          if (item.priority !== undefined && !isFiniteNumber(item.priority)) {
            errors.push(`${label} priority must be a finite number.`);
          }
          if (item.matchRate !== undefined && (!isFiniteNumber(item.matchRate) || item.matchRate < 0 || item.matchRate > 1)) {
            errors.push(`${label} matchRate must be a finite number between 0 and 1.`);
          }
          if (item.perYearCap !== undefined && !isFiniteNumber(item.perYearCap)) {
            errors.push(`${label} perYearCap must be a finite number.`);
          }
          if (item.untilAge !== undefined && !isInteger(item.untilAge)) {
            errors.push(`${label} untilAge must be a whole number of years.`);
          }
          break;
        }
      }
    });
  }
  // Versioned field provenance: this schema version ships with the remediated engine
  // types (profile keys, optional bookValue etc.). Unknown/missing profile fields are
  // surfaced rather than silently coerced.
  const { profile } = value;
  if (!isInteger(profile.birthYear)) {
    errors.push('Plan profile "birthYear" must be a whole calendar year.');
  }
  if (!isInteger(profile.currentAge)) {
    errors.push('Plan profile "currentAge" must be a whole number of years.');
  }
  if (!isInteger(profile.endAge)) {
    errors.push('Plan profile "endAge" must be a whole number of years.');
  }
  if (!isEnum(profile.province, SUPPORTED_PROVINCES)) {
    errors.push(
      `Plan profile province "${String(profile.province)}" is not supported by this ` +
        `version (use ${SUPPORTED_PROVINCES.join(", ")}) — the shipped tax tables are Ontario-only.`,
    );
  }
  if (errors.length > 0) return errors;

  // Engine semantic validation — NEVER let it throw on weird-but-shaped input.
  try {
    errors.push(...validatePlan(value as unknown as Plan));
  } catch (error) {
    errors.push(
      `The plan could not be validated internally (${
        error instanceof Error ? error.message : "unknown error"
      }).`,
    );
  }
  return errors;
}

// --- plan meta / scenario delta / workspace ---

export function validatePlanMeta(value: unknown): string[] {
  if (!isRecord(value)) return ["The plan metadata entry is missing or not an object."];
  const errors: string[] = [];
  if (!isNonEmptyString(value.id)) errors.push("Plan metadata needs a non-empty id.");
  if (!isNonEmptyString(value.name)) errors.push("Plan metadata needs a non-empty name.");
  if (!isIsoDateString(value.updatedAt)) {
    errors.push("Plan metadata needs a valid updatedAt timestamp.");
  }
  return errors;
}


export function validateScenarioDelta(value: unknown): string[] {
  if (!isRecord(value)) return ["A scenario entry is missing or not an object."];
  const errors: string[] = [];
  errors.push(...validateScenarioOptions(value, "Scenario"));
  if (!isNonEmptyString(value.id)) errors.push(`Scenario needs a non-empty id.`);
  if (!isNonEmptyString(value.name)) errors.push(`Scenario needs a non-empty name.`);
  if (!isNonEmptyString(value.basePlanId)) {
    errors.push(`Scenario needs a basePlanId naming the plan it adjusts.`);
  }
  if (!isEnum(value.simMode, ["deterministic", "montecarlo", "historical"] as const)) {
    errors.push(`Scenario simMode "${String(value.simMode)}" is not supported.`);
  } else if (value.simMode === "montecarlo" && value.mcConfig === undefined) {
    errors.push("Monte Carlo scenarios require mcConfig.");
  } else if (value.simMode === "historical" && value.historicalConfig === undefined) {
    errors.push("Historical scenarios require historicalConfig.");
  }
  if (value.mcConfig !== undefined) {
    if (!isRecord(value.mcConfig)) {
      errors.push(`Scenario mcConfig must be an object when present.`);
    } else {
      const { runs, seed, stdDev } = value.mcConfig;
      if (!isFiniteNumber(runs) || runs < 1 || runs > 10_000 || Math.round(runs) !== runs) {
        errors.push(`Scenario mcConfig.runs must be a whole number from 1 to 10,000.`);
      }
      if (!isInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
        errors.push(`Scenario mcConfig.seed must be an unsigned 32-bit integer.`);
      }
      if (
        !isRecord(stdDev) ||
        !["equity", "bond", "cash"].every((k) => {
          const value = (stdDev as Record<string, unknown>)[k];
          return isFiniteNumber(value) && value >= 0 && value <= 1;
        })
      ) {
        errors.push(`Scenario mcConfig.stdDev needs finite equity/bond/cash deviations from 0 to 1.`);
      }
    }
  }
  if (value.historicalConfig !== undefined) {
    if (!isRecord(value.historicalConfig) || !isInteger(value.historicalConfig.startYear) || value.historicalConfig.startYear < HISTORICAL_DATASET.coverageStart || value.historicalConfig.startYear > HISTORICAL_DATASET.coverageEnd) {
      errors.push(`Scenario historicalConfig.startYear must be a whole year from ${HISTORICAL_DATASET.coverageStart} through ${HISTORICAL_DATASET.coverageEnd}.`);
    }
  }
  if (value.overrides === undefined) {
    errors.push(`Scenario needs the "overrides" object (use {} when nothing is overridden).`);
  } else if (!isRecord(value.overrides)) {
    errors.push(`Scenario overrides must be an object.`);
  } else {
    const o = value.overrides;
    if (o.retirementAge !== undefined && (!isInteger(o.retirementAge) || o.retirementAge <= 0)) {
      errors.push(`Scenario override retirementAge must be a positive number.`);
    }
    if (o.returnAssumptions !== undefined) {
      if (
        !isRecord(o.returnAssumptions) ||
        !["equity", "bond", "cash"].every((k) =>
          isFiniteNumber((o.returnAssumptions as Record<string, unknown>)[k]),
        )
      ) {
        errors.push(`Scenario override returnAssumptions needs finite equity/bond/cash numbers.`);
      }
    }
    if (o.withdrawalOrder !== undefined) {
      const order = o.withdrawalOrder;
      if (!Array.isArray(order) || (order.length !== 3 && order.length !== 4)) {
        errors.push(`Scenario override withdrawalOrder must list the three investment account types and may include cash once.`);
      } else if (new Set(order).size !== order.length) {
        errors.push(`Scenario override withdrawalOrder cannot repeat an account type.`);
      } else if (!order.every((v) => v === "tfsa" || v === "rrsp" || v === "nonreg" || v === "cash") ||
        !["tfsa", "rrsp", "nonreg"].every(type => order.includes(type))) {
        errors.push(`Scenario override withdrawalOrder must include tfsa, rrsp, and nonreg, with optional cash.`);
      }
    }
  }
  return errors;
}

/** Workspace = the live editing state (meta nullable; plan always present). */
export function validateWorkspace(value: unknown): string[] {
  if (!isRecord(value)) return ["The workspace entry is missing or not an object."];
  const errors: string[] = [];
  if (value.meta !== null && value.meta !== undefined) {
    errors.push(...validatePlanMeta(value.meta).map((e) => `Workspace meta: ${e}`));
  }
  if (value.meta === undefined) {
    errors.push("Workspace meta must be an object or null (undefined is not valid).");
  }
  if (value.baseScenario !== undefined) errors.push(...validateBaseScenario(value.baseScenario));
  errors.push(...validatePlanShape(value.plan).map((e) => `Workspace plan: ${e}`));
  if (!Array.isArray(value.scenarios)) {
    errors.push("Workspace scenarios must be a list.");
  } else {
    value.scenarios.forEach((s, i) => {
      validateScenarioDelta(s).forEach((e) => errors.push(`Scenario ${i + 1}: ${e}`));
    });
  }
  return errors;
}

/** PlanFile = the exported/imported JSON envelope (schemaVersion + plans[] + scenarios). */
export function validatePlanFile(value: unknown): string[] {
  if (!isRecord(value)) return ["The file content is not a JSON object."];
  if (!isFiniteNumber(value.schemaVersion)) {
    return ['The file is missing its "schemaVersion" number.'];
  }
  if (!Array.isArray(value.plans)) return ['The file is missing its "plans" list.'];
  if (!Array.isArray(value.scenarios)) return ['The file is missing its "scenarios" list.'];
  const errors: string[] = [];
  if (value.baseScenario !== undefined) errors.push(...validateBaseScenario(value.baseScenario));
  value.plans.forEach((p, i) => {
    if (!isRecord(p) || p.meta === undefined || p.plan === undefined) {
      errors.push(`File plan entry ${i + 1} needs both "meta" and "plan".`);
      return;
    }
    validatePlanMeta(p.meta).forEach((e) => errors.push(`File plan ${i + 1} meta: ${e}`));
    validatePlanShape(p.plan).forEach((e) => errors.push(`File plan ${i + 1}: ${e}`));
  });
  value.scenarios.forEach((s, i) => {
    validateScenarioDelta(s).forEach((e) => errors.push(`File scenario ${i + 1}: ${e}`));
  });
  return errors;
}

// Narrowed re-declarations for typed call sites (schema guarantees the shape above).
export function asPlanMeta(value: unknown): PlanMeta {
  return value as PlanMeta;
}
export function asScenarioDelta(value: unknown): ScenarioDelta {
  return value as ScenarioDelta;
}
export function asPlan(planJson: PlanFile["plans"][number] | undefined): Plan {
  return planJson!.plan as unknown as Plan;
}
export function asWorkspace(value: unknown): Workspace {
  return value as Workspace;
}

function validateBaseScenario(value: unknown): string[] {
  if (!isRecord(value)) return ["Working scenario settings must be an object."];
  const errors = validateScenarioDelta({
    id: "settings", name: "settings", basePlanId: "settings", simMode: value.simMode ?? "deterministic",
    mcConfig: value.mcConfig, historicalConfig: value.historicalConfig, benefits: value.benefits,
    withdrawalStrategy: value.withdrawalStrategy, overrides: value,
  });
  for (const key of ["retirementAge", "returnAssumptions", "withdrawalOrder"]) {
    if (value[key] === undefined) errors.push(`Working scenario settings require ${key}.`);
  }
  return errors;
}
