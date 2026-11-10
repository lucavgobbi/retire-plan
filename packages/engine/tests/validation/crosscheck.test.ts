import { describe, expect, it } from "vitest";
import tablesJson from "../../data/tax/ca-2026.json";
import { loadTables, type TaxYearTables } from "../../src/tax/tables";
import { simulate } from "../../src/simulate";
import type { Plan, ReturnSeries, Scenario, YearResult } from "../../src/types";
import { makeSamplePlan, makeSampleScenario } from "../golden/samplePlan";
import { rrifMinimum } from "../../src/benefits/rrif";

/**
 * External cross-check (plan Task 16).
 *
 * IMPORTANT — what "external" means here, stated up front (full detail in
 * docs/validation/cross-check.md):
 *
 * 1. NO interactive government calculator output is used anywhere. The official
 *    calculators (CRA PDOC, the ESDC Retirement Income Calculator) are interactive web
 *    apps that cannot be scripted, so no figure in this file comes from operating one.
 * 2. Every constant below is verbatim from OFFICIAL Government of Canada pages fetched
 *    LIVE on 2026-11-10 (URLs inline as comments; full citations in cross-check.md).
 * 3. The "reference" figures computed here are an INDEPENDENT REIMPLEMENTATION of the
 *    official tax formulas (ITA bracket math + non-refundable credits + Ontario surtax +
 *    OAS recovery), written from those official constants — not the engine's code.
 *
 * Sources (official canada.ca pages, fetched 2026-11-10):
 *  - CRA "Indexation adjustment for personal income tax and benefit amounts":
 *      https://www.canada.ca/en/revenue-agency/services/tax/individuals/frequently-asked-questions-individuals/adjustment-personal-income-tax-benefit-amounts.html
 *      → 2026 indexation 2.0%; federal thresholds; BPA $16,452; age amount $9,208
 *        (threshold $46,432); Canada employment amount $1,501; OAS repayment threshold
 *        $95,323; TFSA 2026 limit $7,000.
 *  - CRA "Income tax rates and income thresholds" (T4127 payroll, 2026):
 *      https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/payroll-deductions-contributions/income-tax/reducing-remuneration-subject-income-tax.html
 *      → federal & Ontario 2026 bracket tables; federal indexing 2.0%; ON indexing 1.9%;
 *        lowest federal rate 14% for 2026.
 *  - CRA T4032-ON (January 2026 edition, general information):
 *      https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4032-payroll-deductions-tables/t4032on-jan/t4032on-january-general-information.html
 *      → Ontario surtax (20% of basic ON tax over $5,818, plus 36% over $7,446);
 *        Ontario BPA $12,989; Ontario health premium schedule.
 *  - ESDC "Maximum Benefit Amounts and Related Figures — CPP (2026) / OAS (Jan–Mar 2026)":
 *      https://www.canada.ca/en/employment-social-development/programs/pensions/pension/statistics/2026-quarterly-january-march.html
 *      → OAS max $742.31/mo (65–74) ⇒ $8,907.72/yr; GIS single max $1,108.74/mo
 *        ⇒ $13,304.88/yr; footnote 7: "The OAS pension repayment range in 2026 is for
 *        net world income from $95,323 …"; footnote 6: GIS cut-offs exclude the OAS
 *        pension and the first $5,000 of employment income (+50% band to $15,000).
 *  - CRA "Old Age Security pension recovery tax":
 *      https://www.canada.ca/en/services/benefits/publicpensions/old-age-security/recovery-tax.html
 *      → repay 15% of the excess over the threshold; 2026 threshold $95,323.
 *  - CRA "Chart – Prescribed factors" (RRIF minimums, "All other RRIFs" column):
 *      https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/completing-slips-summaries/t4rsp-t4rif-information-returns/payments/chart-prescribed-factors.html
 *  - CRA "Minimum amount from a RRIF" (method: FMV at start of year × prescribed factor):
 *      https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/completing-slips-summaries/t4rsp-t4rif-information-returns/payments/minimum-amount-a-rrif.html
 *  - CRA "MP, DB, RRSP, DPSP, ALDA, TFSA limits, YMPE and the YAMPE":
 *      https://www.canada.ca/en/revenue-agency/services/tax/registered-plans-administrators/pspa/mp-rrsp-dpsp-tfsa-limits-ympe.html
 *      → RRSP dollar limit $33,810 (2026); TFSA annual limits 2009–2026 history.
 */

// ---------------------------------------------------------------------------
// Official constants (verbatim, from the sources above)
// ---------------------------------------------------------------------------

const OFFICIAL = {
  year: 2026,
  // T4127 + indexation page: [threshold taxable-income floor, rate]
  fedBrackets: [
    [0, 0.14],
    [58_523, 0.205],
    [117_045, 0.26],
    [181_440, 0.29],
    [258_482, 0.33],
  ] as [number, number][],
  fedBpa: 16_452,
  fedIndexFactor: 0.02, // "The federal indexing factor for January 1, 2026 is 2.0%"
  ageAmount: 9_208,
  ageAmountThreshold: 46_432,
  ageAmountReductionRate: 0.15,
  employmentCredit: 1_501,
  pensionCredit: 2_000, // fixed $2,000 by statute (ITA 118(3)) — not indexed
  // T4127 Ontario chart
  onBrackets: [
    [0, 0.0505],
    [53_891, 0.0915],
    [107_785, 0.1116],
    [150_000, 0.1216],
    [220_000, 0.1316],
  ] as [number, number][],
  onBpa: 12_989,
  onIndexFactor: 0.019, // ON T4127: "1.9%"
  // T4032-ON: surtax = 20% of basic ON tax over $5,818, PLUS 36% over $7,446
  onSurtax: [
    [0.2, 5_818],
    [0.36, 7_446],
  ] as [number, number][],
  oasAnnualMax: 8_907.72, // ESDC: $742.31/mo (65–74, Jan–Mar 2026) × 12
  oasRecoveryThreshold: 95_323, // ESDC footnote 7 + CRA recovery-tax page + indexation page
  oasRecoveryRate: 0.15, // CRA recovery-tax page: "You must repay 15% of that amount"
  gisAnnualMaxSingle: 13_304.88, // ESDC: $1,108.74/mo single × 12
  gisTaperRate: 0.5,
  gisEmploymentExclusion: 5_000, // ESDC footnote 6 (first tier; 50% band to $15,000 follows)
  rrifFactors: [
    // "All other RRIFs" column of the official prescribed-factors chart.
    [71, 0.0528],
    [72, 0.054],
    [73, 0.0553],
    [74, 0.0567],
    [75, 0.0582],
    [76, 0.0598],
    [77, 0.0617],
    [78, 0.0636],
    [79, 0.0658],
    [80, 0.0682],
    [81, 0.0708],
    [82, 0.0738],
    [83, 0.0771],
    [84, 0.0808],
    [85, 0.0851],
    [86, 0.0899],
    [87, 0.0955],
    [88, 0.1021],
    [89, 0.1099],
    [90, 0.1192],
    [91, 0.1306],
    [92, 0.1449],
    [93, 0.1634],
    [94, 0.1879],
    [95, 0.2],
  ] as [number, number][],
  // CRA PSPA limits page — TFSA dollar limits by year (2009–2026)
  tfsaHistory: [
    [2009, 5_000],
    [2010, 5_000],
    [2011, 5_000],
    [2012, 5_000],
    [2013, 5_500],
    [2014, 5_500],
    [2015, 10_000],
    [2016, 5_500],
    [2017, 5_500],
    [2018, 5_500],
    [2019, 6_000],
    [2020, 6_000],
    [2021, 6_000],
    [2022, 6_000],
    [2023, 6_500],
    [2024, 7_000],
    [2025, 7_000],
    [2026, 7_000],
  ] as [number, number][],
  tfsa2026: 7_000,
  tfasCumulativeRoom2026: 109_000,
  rrspRate: 0.18, // 18% of prior-year earned income
  rrspLimit2026: 33_810,
};

// ---------------------------------------------------------------------------
// Independent official-formula calculator (no engine imports below this point)
// ---------------------------------------------------------------------------

const roundCent = (x: number): number => Math.round(x * 100) / 100;

interface RefShape {
  employmentIncome: number;
  otherTaxableIncome: number; // CPP + OAS + any other fully-taxable income
  rrspWithdrawals: number;
  /** RRIF/annuity portion eligible for the pension income amount (subset annotation). */
  pensionIncome: number;
  capitalGains: number;
  age: number;
}

/** Projection-year parameters following the engine's documented indexation convention
 * (docs/assumptions + src/tax/tables.ts): base year 2026 ⇔ age 45 of the golden plan;
 * yearOffset n scales federal amounts by 1.02^n and Ontario amounts by 1.019^n.
 * This convention is a DOCUMENTED engine extrapolation — no official future-year values
 * exist (the CRA publishes each factor every fall). The OFFICIAL BASE-YEAR (n=0) values
 * above are exact. */
function refYear(yearOffset: number) {
  const f = Math.pow(1 + OFFICIAL.fedIndexFactor, yearOffset);
  const o = Math.pow(1 + OFFICIAL.onIndexFactor, yearOffset);
  return {
    fedBpa: OFFICIAL.fedBpa * f,
    ageAmount: OFFICIAL.ageAmount * f,
    ageAmountThreshold: OFFICIAL.ageAmountThreshold * f,
    employmentCredit: OFFICIAL.employmentCredit * f,
    pensionCredit: OFFICIAL.pensionCredit, // fixed $2,000 by statute (ITA 118(3)) — not indexed
    fedBrackets: OFFICIAL.fedBrackets.map(([t, r]) => ({ threshold: t * f, rate: r })),
    onBpa: OFFICIAL.onBpa * o,
    onBrackets: OFFICIAL.onBrackets.map(([t, r]) => ({ threshold: t * o, rate: r })),
    onSurtax: OFFICIAL.onSurtax.map(([r, t]) => ({ rate: r, threshold: t * o })),
    oasThreshold: OFFICIAL.oasRecoveryThreshold * f,
  };
}

function progressive(taxable: number, brackets: { threshold: number; rate: number }[]): number {
  let gross = 0;
  for (let i = 0; i < brackets.length; i++) {
    const lower = brackets[i]!.threshold;
    const upper = i + 1 < brackets.length ? brackets[i + 1]!.threshold : Number.POSITIVE_INFINITY;
    if (taxable <= lower) break;
    const inBracket = Math.min(taxable, upper) - lower;
    if (inBracket > 0) gross += inBracket * brackets[i]!.rate;
  }
  return gross;
}

export interface RefTax {
  federal: number;
  provincial: number;
  surtax: number;
  oasClawback: number;
  total: number;
  taxable: number;
}

const LOWEST_FED_RATE = 0.14; // T4127: lowest federal rate is 14% for 2026
const LOWEST_ON_RATE = 0.0505; // T4127 ON chart

/** Official-formula tax return for one year (Ontario resident). Independent of the engine. */
export function refTax(shape: RefShape, yearOffset: number): RefTax {
  const cy = refYear(yearOffset);
  const taxable =
    shape.employmentIncome +
    shape.otherTaxableIncome +
    shape.rrspWithdrawals +
    shape.capitalGains * 0.5; // ITA s.38 inclusion rate

  // Federal: progressive tax − non-refundable credits × lowest rate (ITA s.117(2)/(3)).
  const empAmt = Math.min(shape.employmentIncome, cy.employmentCredit);
  let ageAmt = 0;
  if (shape.age >= 65) {
    ageAmt = Math.max(
      0,
      cy.ageAmount - OFFICIAL.ageAmountReductionRate * Math.max(0, taxable - cy.ageAmountThreshold),
    );
  }
  const pensAmt = Math.min(cy.pensionCredit, Math.max(0, shape.pensionIncome));
  const creditable = Math.max(0, cy.fedBpa + empAmt + ageAmt + pensAmt);
  const fed = Math.max(0, progressive(taxable, cy.fedBrackets) - LOWEST_FED_RATE * creditable);

  // Ontario: progressive tax − BPA credit → "basic provincial tax payable"; the surtax
  // then applies to that basic tax (T4032-ON): 20% over $5,818 plus 36% over $7,446.
  const onBase = Math.max(0, progressive(taxable, cy.onBrackets) - LOWEST_ON_RATE * cy.onBpa);
  let surtax = 0;
  for (const ladder of cy.onSurtax) surtax += ladder.rate * Math.max(0, onBase - ladder.threshold);
  const on = onBase + surtax;

  // OAS recovery tax: 15% of net-income excess over the threshold (once OAS is in pay).
  const claw = shape.age >= 65 ? OFFICIAL.oasRecoveryRate * Math.max(0, taxable - cy.oasThreshold) : 0;

  return { federal: fed, provincial: onBase, surtax, oasClawback: claw, total: fed + on + claw, taxable };
}

/** Official-formula GIS for a single senior, following BOTH the official GIS income rule
 * (ESDC footnote 6: the income test excludes the OAS pension itself and the first $5,000
 * of employment income; TFSA withdrawals are not GIS income) and the engine's actual
 * call-site convention, independently verified: simulate passes cpp / prior-year RRSP·RRIF
 * withdrawals / employment income / (other streams + prior-year realized non-reg gains),
 * holds OAS separately, and never passes it — GisIncomeSources has no OAS field.
 * Known divergence from official law (documented, unchanged): the engine omits the 50%
 * band on employment income between $5,000 and $15,000 (v1 counts everything above
 * $5,000) — flagged in cross-check.md. */
export function refGis(
  cpp: number,
  employment: number,
  rrspRrifWithdrawals: number,
  otherTaxable: number,
): number {
  const income =
    cpp +
    rrspRrifWithdrawals +
    otherTaxable +
    Math.max(0, employment - OFFICIAL.gisEmploymentExclusion);
  return Math.max(0, OFFICIAL.gisAnnualMaxSingle - OFFICIAL.gisTaperRate * Math.max(0, income));
}

// ---------------------------------------------------------------------------
// Test data: the plan-first-three-years fixture shared with the golden test
// ---------------------------------------------------------------------------

const tables: TaxYearTables = loadTables(tablesJson);

function goldenRun(plan: Plan = makeSamplePlan()): ReturnType<typeof simulate> {
  const scenario: Scenario = makeSampleScenario();
  const returns: ReturnSeries = {
    years: Array.from({ length: plan.profile.endAge - plan.profile.currentAge + 1 }, (_, k) => ({
      age: plan.profile.currentAge + k,
      equity: scenario.returnAssumptions.equity,
      bond: scenario.returnAssumptions.bond,
      cash: scenario.returnAssumptions.cash,
    })),
  };
  return simulate(plan, scenario, returns, tables);
}

// ---------------------------------------------------------------------------
// A. Engine status: output of the CURRENT tree is compared, never trusted as truth.
//    (The engine is under independent audit/fix; figures may move with it.)
// ---------------------------------------------------------------------------

describe("external cross-check — published government constants vs ca-2026.json", () => {
  it("federal 2026 brackets match the CRA T4127/table exactly", () => {
    expect(tables.year).toBe(OFFICIAL.year);
    expect(tables.federal.brackets).toHaveLength(OFFICIAL.fedBrackets.length);
    OFFICIAL.fedBrackets.forEach(([threshold, rate], i) => {
      expect(tables.federal.brackets[i]!.threshold).toBe(threshold);
      expect(tables.federal.brackets[i]!.rate).toBe(rate);
    });
  });

  it("federal credits and indexing factor match the CRA indexation page exactly", () => {
    expect(tables.federal.basicPersonalAmount).toBe(OFFICIAL.fedBpa);
    expect(tables.federal.indexationFactor).toBeCloseTo(1 + OFFICIAL.fedIndexFactor, 12);
    expect(tables.federal.ageCredit.amount).toBe(OFFICIAL.ageAmount);
    expect(tables.federal.ageCredit.reductionThreshold).toBe(OFFICIAL.ageAmountThreshold);
    expect(tables.federal.ageCredit.reductionRate).toBe(OFFICIAL.ageAmountReductionRate);
    expect(tables.federal.employmentCreditAmount).toBe(OFFICIAL.employmentCredit);
  });

  it("Ontario 2026 brackets and surtax ladders match the CRA T4127/T4032-ON exactly", () => {
    expect(tables.ontario.brackets).toHaveLength(OFFICIAL.onBrackets.length);
    OFFICIAL.onBrackets.forEach(([threshold, rate], i) => {
      expect(tables.ontario.brackets[i]!.threshold).toBe(threshold);
      expect(tables.ontario.brackets[i]!.rate).toBe(rate);
    });
    expect(tables.ontario.basicPersonalAmount).toBe(OFFICIAL.onBpa);
    expect(tables.ontario.indexationFactor).toBeCloseTo(1 + OFFICIAL.onIndexFactor, 12);
    expect(tables.ontario.surtax).toHaveLength(2);
    expect(tables.ontario.surtax[0]!.rate).toBe(OFFICIAL.onSurtax[0]![0]);
    expect(tables.ontario.surtax[0]!.onTaxOverPctOfTaxable).toBe(OFFICIAL.onSurtax[0]![1]);
    expect(tables.ontario.surtax[1]!.rate).toBe(OFFICIAL.onSurtax[1]![0]);
    expect(tables.ontario.surtax[1]!.onTaxOverPctOfTaxable).toBe(OFFICIAL.onSurtax[1]![1]);
  });

  it("OAS maximum, repayment threshold and recovery rate match ESDC/CRA exactly", () => {
    expect(tables.oas.annualMax).toBeCloseTo(OFFICIAL.oasAnnualMax, 2);
    expect(tables.oas.clawbackThreshold).toBe(OFFICIAL.oasRecoveryThreshold);
    expect(tables.oas.recoveryRate).toBe(OFFICIAL.oasRecoveryRate);
  });

  it("GIS maximum/taper/exclusion match ESDC exactly", () => {
    expect(tables.gis.annualMaxSingle).toBeCloseTo(OFFICIAL.gisAnnualMaxSingle, 2);
    expect(tables.gis.taperRate).toBe(OFFICIAL.gisTaperRate);
    expect(tables.gis.exclusionEmployment).toBe(OFFICIAL.gisEmploymentExclusion);
  });

  it("RRIF minimum factor at 72 equals the official 5.40% (handoff item b)", () => {
    const n = tables.rrif.minimumFactors.find((f) => f.age === 72)!;
    expect(n.factor).toBe(0.054);
    const due = rrifMinimum(72, 100_000, tables);
    expect(due!.factor).toBe(0.054);
    expect(due!.minimum).toBeCloseTo(5_400, 2);
  });

  it("FULL official RRIF prescribed-factor schedule (All other RRIFs) — encodes official truth", () => {
    // Fails wherever ca-2026.json still deviates from the official chart; the fix is a
    // data-only change, coordinated with the remediation builder. See cross-check.md.
    const divergences: string[] = [];
    for (const [age, factor] of OFFICIAL.rrifFactors) {
      const cam = tables.rrif.minimumFactors.find((f) => f.age === age);
      if (!cam || Math.abs(cam.factor - factor) > 1e-12) {
        divergences.push(`age ${age}: engine ${cam ? cam.factor : "missing"} vs official ${factor}`);
      }
    }
    if (divergences.length > 0) {
      throw new Error(
        `ca-2026.json RRIF factors diverge from the official CRA prescribed-factors chart ` +
          `(canada.ca, 'All other RRIFs' column,\n` +
          `https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/completing-slips-summaries/t4rsp-t4rif-information-returns/payments/chart-prescribed-factors.html):\n` +
          divergences.join("\n"),
      );
    }
  });

  it("TFSA 2026 limit and cumulative room match the official limit sum exactly", () => {
    expect(tables.tfsa.annualLimit).toBe(OFFICIAL.tfsa2026);
    const officialSum = OFFICIAL.tfsaHistory.reduce((s, [, limit]) => s + limit, 0);
    expect(officialSum).toBe(OFFICIAL.tfasCumulativeRoom2026); // the 109,000 itself re-summed
    expect(tables.tfsa.cumulativeRoomAsOf2026).toBe(OFFICIAL.tfasCumulativeRoom2026);
  });

  it("TFSA annual-limit history matches the CRA PSPA limits page year by year", () => {
    // The engine stores only the 2026 limit + the cumulative; this test holds the full
    // officially published history (used to re-derive the cumulative above) and pins its
    // most recent entry to the engine's stored limit.
    expect(OFFICIAL.tfsaHistory).toHaveLength(18); // 2009–2026 inclusive
    expect(OFFICIAL.tfsaHistory[OFFICIAL.tfsaHistory.length - 1]![0]).toBe(2026);
    expect(OFFICIAL.tfsaHistory[OFFICIAL.tfsaHistory.length - 1]![1]).toBe(OFFICIAL.tfsa2026);
    expect(OFFICIAL.tfsa2026).toBe(tables.tfsa.annualLimit);
  });

  it("RRSP 2026 rate and dollar limit match the CRA PSPA limits page exactly", () => {
    expect(tables.rrsp.incomeRate).toBe(OFFICIAL.rrspRate);
    expect(tables.rrsp.annualLimit).toBe(OFFICIAL.rrspLimit2026);
  });
});

// ---------------------------------------------------------------------------
// B. Independent official-formula tax vs engine — same income shapes.
// ---------------------------------------------------------------------------

describe("external cross-check — golden plan vs official-formula independent reference", () => {
  const basePlan: Plan = makeSamplePlan();
  /** Review M3: the shipped golden fixture leaves the employment stream without an
   * endAge, and engine semantics keep an unended employment stream running into
   * retirement (flagged to the captain as a documented-vs-intent question). This
   * validation-only override ends employment at 64, so the three compared retirement
   * years (65–67) are genuinely post-employment years with analytically known inputs —
   * the convention stated in cross-check.md. */
  const retiredPlan: Plan = {
    ...basePlan,
    incomes: basePlan.incomes.map((s) =>
      s.kind === "employment" ? { ...s, endAge: 64 } : s,
    ),
  };
  const result = goldenRun(retiredPlan);
  const byAge = new Map(result.years.map((y) => [y.age, y]));

  /** Analytic salary for a year: 95,000 with 2% raises while the stream is active (through 64). */
  const analyticEmployment = (age: number): number =>
    age <= 64 ? roundCent(95_000 * Math.pow(1.02, age - 45)) : 0;

  /** Engine per-component incomes for one year, as the official formulas would consume
   * them. The income STREAM values are asserted against analytic expectations (M2);
   * the withdrawal/composition facts come from the engine ledger (engineering
   * consumption decisions, reviewed elsewhere); the independently computed reference is
   * the TAX on those shapes. */
  function shapeOf(age: number): { shape: RefShape; engineYear: YearResult; yearOffset: number } {
    const y = byAge.get(age);
    if (!y) throw new Error(`golden run has no year at age ${age}`);
    const yearOffset = age - 45; // age 45 ⇔ tax year 2026 (base tables)
    const employment = analyticEmployment(age);

    // M2: analytic income-stream expectations, asserted — not voided.
    expect(y.income.employment).toBe(employment);
    expect(y.income.cpp).toBe(8_000); // raiseRate 0 → plain 8,000.00
    expect(y.income.oas).toBe(OFFICIAL.oasAnnualMax); // raiseRate 0 → plain 8,907.72

    const rrsp = y.withdrawals.rrsp;
    const other = y.income.cpp + y.income.oas + y.income.other;
    // taxableIncome = employment + other + rrsp + 0.5×CG ⇒ recover gains for the shape.
    const halfCg = roundCent(y.taxableIncome - employment - other - rrsp);
    const capitalGains = Math.max(0, 2 * halfCg);
    const shape: RefShape = {
      employmentIncome: y.income.employment,
      otherTaxableIncome: other,
      rrspWithdrawals: rrsp,
      pensionIncome: age >= 65 ? rrsp : 0,
      capitalGains,
      age,
    };
    return { shape, engineYear: y, yearOffset };
  }

  it("year-1 employment-only tax equals the handoff pin 18,986.41 by independent computation", () => {
    // Official formulas on the year-1 shape (95,000 employment, age 45, no OAS yet).
    const ref = refTax({ employmentIncome: 95_000, otherTaxableIncome: 0, rrspWithdrawals: 0, pensionIncome: 0, capitalGains: 0, age: 45 }, 0);
    expect(roundCent(ref.federal)).toBeCloseTo(13_157.59, 2);
    expect(roundCent(ref.provincial)).toBeCloseTo(5_827.02, 2);
    expect(roundCent(ref.surtax)).toBeCloseTo(1.8, 2);
    expect(roundCent(ref.total)).toBeCloseTo(18_986.41, 2);
  });

  it("engine year-1 tax matches the independent official-formula figure to the cent", () => {
    const y = byAge.get(45)!;
    const ref = refTax({ employmentIncome: y.income.employment, otherTaxableIncome: 0, rrspWithdrawals: 0, pensionIncome: 0, capitalGains: 0, age: 45 }, 0);
    expect(y.income.employment).toBeCloseTo(95_000, 2);
    expect(y.tax.federal).toBeCloseTo(ref.federal, 1);
    expect(y.tax.provincial).toBeCloseTo(ref.provincial, 1);
    expect(y.tax.surtax).toBeCloseTo(ref.surtax, 1);
    expect(y.tax.total).toBeCloseTo(18_986.41, 1);
  });

  it("first three retirement years (65–67) without employment income: taxes and net income within 10% of the independent reference", () => {
    const rows: string[] = [];
    const failures: string[] = [];
    const tol = (a: number, b: number): number => Math.abs(a - b) / Math.max(1, Math.abs(b));
    for (const age of [65, 66, 67]) {
      const { shape, engineYear: y, yearOffset } = shapeOf(age);
      const ref = refTax(shape, yearOffset);

      // GIS: official-formula value under the official income rule (OAS excluded — the
      // engine's verified convention matches: OAS is held separately and never passed to
      // the GIS income test). Prior-year RRSP/RRIF withdrawals and prior-year realized
      // non-reg gains enter the income test per the engine's documented sequencing.
      const gisRef = refGis(
        y.income.cpp,
        y.income.employment,
        y.withdrawals.rrsp,
        y.income.other,
      );

      const netEngine =
        y.income.employment + y.income.cpp + y.income.oas + y.income.gis - y.tax.total;
      const netRef = y.income.employment + y.income.cpp + y.income.oas + gisRef - ref.total;

      // M2: the engine's reported GIS must equal the official-formula reference exactly
      // on these analytically known inputs.
      expect(y.income.gis).toBeCloseTo(gisRef, 2);

      rows.push(
        `age ${age}: tax engine ${y.tax.total.toFixed(2)} (f ${y.tax.federal.toFixed(2)}, p ${y.tax.provincial.toFixed(2)}, s ${y.tax.surtax.toFixed(2)}, c ${y.tax.oasClawback.toFixed(2)}) vs ref ${ref.total.toFixed(2)} (f ${ref.federal.toFixed(2)}, p ${ref.provincial.toFixed(2)}, s ${ref.surtax.toFixed(2)}, c ${ref.oasClawback.toFixed(2)})` +
          ` | net engine ${netEngine.toFixed(2)} vs ref ${netRef.toFixed(2)} | gis engine ${y.income.gis.toFixed(2)} vs ref ${gisRef.toFixed(2)}` +
          ` | taxable ${y.taxableIncome.toFixed(2)} | w t/r/n ${y.withdrawals.tfsa.toFixed(2)}/${y.withdrawals.rrsp.toFixed(2)}/${y.withdrawals.nonreg.toFixed(2)}`,
      );

      // Plan Task 16 documented tolerance: 10% on per-year taxes and net income.
      if (tol(y.tax.total, ref.total) > 0.1) {
        failures.push(`age ${age} tax: engine ${y.tax.total.toFixed(2)} vs ref ${ref.total.toFixed(2)} (${(100 * tol(y.tax.total, ref.total)).toFixed(1)}% off)`);
      }
      if (tol(netEngine, netRef) > 0.1) {
        failures.push(`age ${age} net income: engine ${netEngine.toFixed(2)} vs ref ${netRef.toFixed(2)} (${(100 * tol(netEngine, netRef)).toFixed(1)}% off)`);
      }

      // Tighter arithmetic sub-check (documented expectation, not the 10% contract):
      // with per-year indexation now wired into the stepper, the reported component tax
      // on the reported shape should track the reference to well under 1% whenever no
      // non-reg draw (chunk-tax fold) and no shortfall complicate the year.
      if (y.withdrawals.nonreg === 0 && y.shortfall === 0) {
        if (tol(y.tax.federal + y.tax.provincial + y.tax.surtax + y.tax.oasClawback, ref.total) > 0.02) {
          failures.push(`age ${age} component tax vs ref: >2% (${y.tax.total.toFixed(2)} vs ${ref.total.toFixed(2)})`);
        }
      }
    }
    if (failures.length > 0) {
      throw new Error(
        `retirement-year comparison exceeds the documented 10% tolerance:\n` +
          failures.join("\n") +
          `\n\nFull comparison rows (engine vs independent official-formula reference):\n  ${rows.join("\n  ")}`,
      );
    }
    expect(byAge.has(64)).toBe(true); // sanity: rows above consumed real engine years
  });
});
