/**
 * TaxYearTables — the versioned CRA parameter set for one tax year (Ontario resident).
 * All rates/thresholds/limits live in JSON tables (data/tax/ca-*.json); none are hardcoded
 * in .ts. Sources for each value are recorded in data/tax/SOURCES.md.
 */
export interface TaxYearTables {
  year: number;
  province: "ON";
  federal: {
    brackets: { threshold: number; rate: number }[];
    basicPersonalAmount: number;
    indexationFactor: number;
    ageCredit: { amount: number; reductionThreshold: number; reductionRate: number };
    employmentCreditAmount: number;
    pensionIncomeCredit: { amount: number; incomeThreshold: number; reductionRate: number };
  };
  ontario: {
    brackets: { threshold: number; rate: number }[];
    surtax: { rate: number; onTaxOverPctOfTaxable: number }[];
    basicPersonalAmount: number;
    indexationFactor: number;
  };
  oas: { annualMax: number; clawbackThreshold: number; recoveryRate: number };
  gis: { annualMaxSingle: number; taperRate: number; exclusionEmployment: number };
  rrif: { minimumFactors: { age: number; factor: number }[] };
  tfsa: { annualLimit: number; cumulativeRoomAsOf2026: number; roomStartAge: number };
  rrsp: { incomeRate: number; annualLimit: number };
}

interface Bracket {
  threshold: number;
  rate: number;
}

function assertObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Tax tables: ${what} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertNumber(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Tax tables: ${what} must be a finite number.`);
  }
  return value;
}

function assertPositiveNumber(value: unknown, what: string): number {
  const n = assertNumber(value, what);
  if (n <= 0) {
    throw new Error(`Tax tables: ${what} must be positive (got ${n}).`);
  }
  return n;
}

function assertArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Tax tables: ${what} must be a non-empty array.`);
  }
  return value;
}

function assertBrackets(value: unknown, what: string): Bracket[] {
  return assertArray(value, what).map((entry, i) => {
    const b = assertObject(entry, `${what}[${i}]`);
    return {
      threshold: assertNumber(b.threshold, `${what}[${i}].threshold`),
      rate: assertNumber(b.rate, `${what}[${i}].rate`),
    };
  });
}

/**
 * Tier-order invariants: thresholds strictly ascending and rates strictly increasing —
 * protects against a transposed/law-changed table producing silently wrong tax math.
 */
function assertLadderSorted(brackets: Bracket[], what: string): Bracket[] {
  for (let i = 1; i < brackets.length; i++) {
    const prev = brackets[i - 1]!;
    const cur = brackets[i]!;
    if (cur.threshold <= prev.threshold) {
      throw new Error(
        `Tax tables: ${what}.bracket[${i}] threshold ${cur.threshold} must be above bracket[${i - 1}] threshold ${prev.threshold} (strictly ascending).`,
      );
    }
    if (cur.rate <= prev.rate) {
      throw new Error(
        `Tax tables: ${what}.bracket[${i}] rate ${cur.rate} must be strictly greater than bracket[${i - 1}] rate ${prev.rate}.`,
      );
    }
  }
  return brackets;
}

interface RrifFactor {
  age: number;
  factor: number;
}

/**
 * RRIF schedule invariants: ages strictly ascending, and factors non-decreasing with age
 * when comparing below the age-95 cap leg (where the factor jumps to and holds 20%).
 */
function assertRrifFactors(value: unknown, what: string): RrifFactor[] {
  return assertArray(value, what).map((entry, i) => {
    const f = assertObject(entry, `${what}[${i}]`);
    return {
      age: assertPositiveNumber(f.age, `${what}[${i}].age`),
      factor: assertNumber(f.factor, `${what}[${i}].factor`),
    };
  });
}

function assertRrifMonotonic(factors: RrifFactor[], what: string): RrifFactor[] {
  for (let i = 1; i < factors.length; i++) {
    const prev = factors[i - 1]!;
    const cur = factors[i]!;
    if (cur.age <= prev.age) {
      throw new Error(
        `Tax tables: ${what}[${i}] age ${cur.age} must be strictly greater than ${what}[${i - 1}] age ${prev.age} (ascending schedule).`,
      );
    }
    if (prev.age < 95 && cur.age < 95 && cur.factor < prev.factor) {
      throw new Error(
        `Tax tables: ${what} factors must be non-decreasing with age below the 95 cap: factor at age ${cur.age} (${cur.factor}) is below factor at age ${prev.age} (${prev.factor}).`,
      );
    }
  }
  return factors;
}

/**
 * Parses and shape-validates a loaded JSON table. Throws a descriptive error on malformed
 * data — fail fast; a bad table must never silently produce garbage tax numbers.
 */
export function loadTables(json: unknown): TaxYearTables {
  const root = assertObject(json, "tax tables");

  const year = assertPositiveNumber(root.year, "year");
  if (root.province !== "ON") {
    throw new Error(`Tax tables: province must be "ON" (got ${String(root.province)}).`);
  }

  const federal = assertObject(root.federal, "federal");
  const ontario = assertObject(root.ontario, "ontario");

  const federalBrackets = assertLadderSorted(
    assertBrackets(federal.brackets, "federal.brackets"),
    "federal.brackets",
  );
  if (federalBrackets[0]!.threshold !== 0) {
    throw new Error("Tax tables: federal.brackets must start at threshold 0.");
  }
  const ontarioBrackets = assertLadderSorted(
    assertBrackets(ontario.brackets, "ontario.brackets"),
    "ontario.brackets",
  );
  if (ontarioBrackets[0]!.threshold !== 0) {
    throw new Error("Tax tables: ontario.brackets must start at threshold 0.");
  }

  const surtax = assertArray(ontario.surtax, "ontario.surtax").map((entry, i) => {
    const s = assertObject(entry, `ontario.surtax[${i}]`);
    return {
      rate: assertNumber(s.rate, `ontario.surtax[${i}].rate`),
      onTaxOverPctOfTaxable: assertNumber(
        s.onTaxOverPctOfTaxable,
        `ontario.surtax[${i}].onTaxOverPctOfTaxable`,
      ),
    };
  });

  const ageCredit = assertObject(federal.ageCredit, "federal.ageCredit");
  const pensionIncomeCredit = assertObject(
    federal.pensionIncomeCredit,
    "federal.pensionIncomeCredit",
  );

  const oas = assertObject(root.oas, "oas");
  const gis = assertObject(root.gis, "gis");
  const rrif = assertObject(root.rrif, "rrif");
  const tfsa = assertObject(root.tfsa, "tfsa");
  const rrsp = assertObject(root.rrsp, "rrsp");

  return {
    year,
    province: "ON",
    federal: {
      brackets: federalBrackets,
      basicPersonalAmount: assertNumber(federal.basicPersonalAmount, "federal.basicPersonalAmount"),
      indexationFactor: assertPositiveNumber(federal.indexationFactor, "federal.indexationFactor"),
      ageCredit: {
        amount: assertNumber(ageCredit.amount, "federal.ageCredit.amount"),
        reductionThreshold: assertNumber(
          ageCredit.reductionThreshold,
          "federal.ageCredit.reductionThreshold",
        ),
        reductionRate: assertNumber(ageCredit.reductionRate, "federal.ageCredit.reductionRate"),
      },
      employmentCreditAmount: assertNumber(
        federal.employmentCreditAmount,
        "federal.employmentCreditAmount",
      ),
      pensionIncomeCredit: {
        amount: assertNumber(pensionIncomeCredit.amount, "federal.pensionIncomeCredit.amount"),
        incomeThreshold: assertNumber(
          pensionIncomeCredit.incomeThreshold,
          "federal.pensionIncomeCredit.incomeThreshold",
        ),
        reductionRate: assertNumber(
          pensionIncomeCredit.reductionRate,
          "federal.pensionIncomeCredit.reductionRate",
        ),
      },
    },
    ontario: {
      brackets: ontarioBrackets,
      surtax,
      basicPersonalAmount: assertNumber(ontario.basicPersonalAmount, "ontario.basicPersonalAmount"),
      indexationFactor: assertPositiveNumber(ontario.indexationFactor, "ontario.indexationFactor"),
    },
    oas: {
      annualMax: assertNumber(oas.annualMax, "oas.annualMax"),
      clawbackThreshold: assertNumber(oas.clawbackThreshold, "oas.clawbackThreshold"),
      recoveryRate: assertNumber(oas.recoveryRate, "oas.recoveryRate"),
    },
    gis: {
      annualMaxSingle: assertNumber(gis.annualMaxSingle, "gis.annualMaxSingle"),
      taperRate: assertNumber(gis.taperRate, "gis.taperRate"),
      exclusionEmployment: assertNumber(gis.exclusionEmployment, "gis.exclusionEmployment"),
    },
    rrif: {
      minimumFactors: assertRrifMonotonic(assertRrifFactors(rrif.minimumFactors, "rrif.minimumFactors"), "rrif.minimumFactors"),
    },
    tfsa: {
      annualLimit: assertNumber(tfsa.annualLimit, "tfsa.annualLimit"),
      cumulativeRoomAsOf2026: assertNumber(
        tfsa.cumulativeRoomAsOf2026,
        "tfsa.cumulativeRoomAsOf2026",
      ),
      roomStartAge: assertPositiveNumber(tfsa.roomStartAge, "tfsa.roomStartAge"),
    },
    rrsp: {
      incomeRate: assertNumber(rrsp.incomeRate, "rrsp.incomeRate"),
      annualLimit: assertNumber(rrsp.annualLimit, "rrsp.annualLimit"),
    },
  };
}

function indexBrackets(brackets: Bracket[], factor: number): Bracket[] {
  return brackets.map((b) => ({ threshold: b.threshold * factor, rate: b.rate }));
}

/**
 * Projects the tables forward `yearOffset` years: thresholds/limits are multiplied by each
 * jurisdiction's own indexationFactor^yearOffset (never a shared number), so federal and
 * Ontario tables drift apart independently over decades. The factors themselves do NOT
 * compound on each other and rates are untouched.
 *
 * What scales:
 *  - federal: bracket thresholds, BPA, age-credit amount + reduction threshold, employment
 *    amount, pension-credit amount + income threshold, OAS recovery threshold.
 *  - ontario: bracket thresholds, surtax tax thresholds, BPA.
 *
 * What does not scale (fixed by annual announcement or legislation): TFSA/RRSP limits, GIS
 * maximum, OAS annual maximum, RRIF factors, all rates, and the factors themselves.
 *
 * Ontario's $150,000 and $220,000 brackets are legislatively unindexed in reality (see
 * SOURCES.md); uniform ON indexing is a documented simplification.
 */
export function applyIndexation(tables: TaxYearTables, yearOffset: number): TaxYearTables {
  const federalFactor = tables.federal.indexationFactor ** yearOffset;
  const ontarioFactor = tables.ontario.indexationFactor ** yearOffset;

  const fed = tables.federal;
  return {
    ...tables,
    federal: {
      ...fed,
      brackets: indexBrackets(fed.brackets, federalFactor),
      basicPersonalAmount: fed.basicPersonalAmount * federalFactor,
      ageCredit: {
        amount: fed.ageCredit.amount * federalFactor,
        reductionThreshold: fed.ageCredit.reductionThreshold * federalFactor,
        reductionRate: fed.ageCredit.reductionRate,
      },
      employmentCreditAmount: fed.employmentCreditAmount * federalFactor,
      pensionIncomeCredit: {
        amount: fed.pensionIncomeCredit.amount * federalFactor,
        incomeThreshold: fed.pensionIncomeCredit.incomeThreshold * federalFactor,
        reductionRate: fed.pensionIncomeCredit.reductionRate,
      },
    },
    ontario: {
      ...tables.ontario,
      brackets: indexBrackets(tables.ontario.brackets, ontarioFactor),
      surtax: tables.ontario.surtax.map((s) => ({
        rate: s.rate,
        onTaxOverPctOfTaxable: s.onTaxOverPctOfTaxable * ontarioFactor,
      })),
      basicPersonalAmount: tables.ontario.basicPersonalAmount * ontarioFactor,
    },
    oas: {
      ...tables.oas,
      clawbackThreshold: tables.oas.clawbackThreshold * federalFactor,
    },
  };
}
