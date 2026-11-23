import tablesJson from "../data/tax/ca-2026.json";
import { applyIndexation, loadTables, type TaxYearTables } from "./tax/tables";
import {
  validatePlan,
  validateScenarioSettings,
  type AccountPlan,
  type AccountType,
  type Plan,
  type PlannedWithdrawals,
  type ReturnSeries,
  type Scenario,
  type SimulationResult,
  type WithdrawalPlanMetadata,
  type YearResult,
} from "./types";
import { planWithdrawalPolicy } from "./strategy/withdrawalPlanner";
import { federalTax, taxableIncome, type IncomeForTax } from "./tax/federal";
import { ontarioTax } from "./tax/ontario";
import { annualPayroll } from "./tax/payroll";
import { oasClawback } from "./tax/oasClawback";
import { gisAnnual } from "./benefits/gis";
import { rrifMinimum } from "./benefits/rrif";
import { tfsaRoomNextYear, rrspRoomEarn } from "./accounts/rooms";
import { mortgageYear } from "./mortgage";
import { allocateSurplus, type AllocateSurplusResult } from "./accounts/flows";

/** Storage-boundary rounding: money leaves the engine as whole cents. */
function roundCent(x: number): number {
  return Math.round(x * 100) / 100;
}

function roundCent4(x: number): number {
  return Math.round(x * 1_000_000) / 1_000_000;
}

/** Round recorded shares together, in plan order, without changing the underlying operations. */
function reportCents(shares: number[], total: number, caps?: number[]): number[] {
  let last = shares.length - 1;
  while (last >= 0 && shares[last] === 0) last--;
  const totalCents = Math.round(total * 100);
  let remainingCapacity = caps?.reduce((sum, cap) => sum + Math.round(cap * 100), 0) ?? 0;
  let applied = 0;
  let reportedCents = 0;
  return shares.map((share, index) => {
    if (share === 0) return 0;
    applied += share;
    let nextCents = index === last ? totalCents : Math.round(applied * 100);
    if (caps) {
      const cap = Math.round(caps[index]! * 100);
      remainingCapacity -= cap;
      // Keep this share within its deposit while reserving enough capacity to finish allocating the match.
      nextCents = Math.max(totalCents - remainingCapacity, Math.min(nextCents, reportedCents + cap));
    }
    const amount = (nextCents - reportedCents) / 100;
    reportedCents = nextCents;
    return amount;
  });
}

type AccountDetail = NonNullable<YearResult["accountBreakdown"]>[number];
const accountTypes = ["tfsa", "rrsp", "nonreg", "cash"] as const;

interface AccountState {
  id: string;
  name?: string;
  type: AccountPlan["type"];
  balance: number;
  mix: AccountPlan["assetMix"];
  interestRate?: number; // cash accounts only
  depositPriority?: number;
  annualDepositLimit?: number;
}

interface AssetState {
  id: string;
  name?: string;
  kind: "primary-home" | "other";
  value: number;
  originalValue: number; // ACB = value at projection start
  appreciationRate: number;
  sellEvent: { age: number; costsPct: number } | undefined;
}

function sumType(accounts: AccountState[], type: AccountPlan["type"]): number {
  return accounts.reduce((s, a) => (a.type === type ? s + a.balance : s), 0);
}

function roundBal(accounts: AccountState[], type: AccountPlan["type"]): number {
  return roundCent(sumType(accounts, type));
}

function reportBalances(
  accounts: AccountState[],
  details: Map<AccountState, AccountDetail>,
  key: "openingBalance" | "closingBalance",
): void {
  for (const type of accountTypes) {
    const group = accounts.filter((account) => account.type === type);
    const balances = group.map((account) => account.balance);
    const rounded = reportCents(
      balances,
      balances.reduce((sum, balance) => sum + balance, 0),
    );
    group.forEach((account, index) => {
      details.get(account)![key] = rounded[index]!;
    });
  }
}

/** Full-year tax (federal + Ontario incl. surtax + OAS recovery) on an income shape. */
function taxOf(
  income: IncomeForTax,
  tables: TaxYearTables,
  oasReceived: number,
): {
  federal: number;
  provincial: number;
  surtax: number;
  oasClawback: number;
  total: number;
  taxable: number;
} {
  const fed = federalTax(income, tables);
  const ont = ontarioTax(income, tables);
  const taxable = taxableIncome(income);
  // OAS recovery tax exists only once OAS is received (age >= 65).
  const claw = income.age >= 65 ? Math.min(Math.max(0, oasReceived), oasClawback(taxable, tables)) : 0;
  return {
    federal: fed.tax,
    provincial: ont.tax,
    surtax: ont.surtax,
    oasClawback: claw,
    total: fed.tax + ont.total + claw,
    taxable,
  };
}

/**
 * Deterministic year stepper — the contract the UI and the Monte Carlo runner use.
 *
 * Per-year order (plan Task 12):
 *  1. lifecycle events: retirement at `retirementAge`; CPP/OAS start events; asset sale
 *     per sellEvent.age — proceeds net of costs go to non-registered and half the gain
 *     (ACB = value at projection start) enters this year's taxable income;
 *  2. income: each stream grows at its own raiseRate from startAge; GIS per Task 7,
 *     evaluated on this year's income streams plus the PRIOR year's RRSP/TFSA
 *     withdrawals (documented sequencing simplification);
 *  3. mortgage per Task 10 — `mortgageYear` returns fields only, so the STEPPER detects
 *     negative amortization (end balance above start balance while payment > 0) and
 *     emits the warning itself;
 *  4. net cash flow = after-tax income − expenses − mortgage payment;
 *  5. surplus -> savings policy by priority via `allocateSurplus`; or deficit ->
 *     withdrawals in `withdrawalOrder` with RRSP/non-reg draws grossed up for their tax.
 *     The mandatory RRIF minimum (Task 8, age >= 71) is
 *     withdrawn first and always, counted in rrsp withdrawals, and returns to cash.
 *     TFSA room follows the Task 9 contract: `tfsaRoomNextYear` receives room NET of
 *     this year's contributions; the seed is cumulativeRoomAsOf2026 for residents
 *     eligible at projection start (it already includes the 2026 limit).
 *  6. account growth on post-flow balances, each account at its own asset mix;
 *  7. final tax including RRSP withdrawals; marginalRate recorded numerically;
 *  8. shortfall = unfunded need; expenses absorb it — successive years stay runnable
 *     (Review Focus #3): never NaN, never negative balances.
 *
 * Employer-funded RRSP amounts are direct deposits and taxable employment
 * benefits offset by a deduction, subject to available room and capacity.
 */
export function simulate(
  plan: Plan,
  scenario: Scenario,
  returns: ReturnSeries,
  tables: TaxYearTables = loadTables(tablesJson),
  planned?: PlannedWithdrawals,
): SimulationResult {
  const errors = validatePlan(plan);
  const scenarioErrors = validateScenarioSettings(scenario);
  if (errors.length > 0 || scenarioErrors.length > 0) {
    throw new Error(`validatePlan: ${[...errors, ...scenarioErrors].join(" ")}`);
  }
  if ((scenario.payroll?.cpp || scenario.payroll?.ei) && tables.payroll === undefined) {
    throw new Error(
      "Tax tables: employee payroll parameters are required when CPP or EI payroll deductions are enabled.",
    );
  }

  // Tax-minimizing policy: injected `planned` (candidate evaluation, runners) is used
  // verbatim and NEVER replans or attaches metadata; only the top-level deterministic
  // path without an injected plan plans internally and attaches the planning metadata.
  let policy: PlannedWithdrawals | null = null;
  let withdrawalPlan: WithdrawalPlanMetadata | undefined;
  if (scenario.withdrawalStrategy === "tax-minimizing") {
    if (planned !== undefined) {
      policy = planned;
    } else {
      const plannerOutput = planWithdrawalPolicy(plan, scenario, tables);
      policy = plannerOutput.planned;
      withdrawalPlan = plannerOutput.metadata;
    }
  }

  // Withdrawal-order contract: tfsa/nonreg/rrsp exactly once each, cash at most
  // once (and only ever drawn when named cash accounts exist).
  const orderCounts = new Map<AccountType, number>();
  for (const t of scenario.withdrawalOrder) orderCounts.set(t, (orderCounts.get(t) ?? 0) + 1);
  for (const t of ["tfsa", "nonreg", "rrsp"] as const) {
    if (orderCounts.get(t) !== 1) {
      throw new Error(`withdrawalOrder must include "${t}" exactly once (got ${orderCounts.get(t) ?? 0}).`);
    }
  }
  if ((orderCounts.get("cash") ?? 0) > 1) {
    throw new Error('withdrawalOrder must include "cash" at most once.');
  }
  for (const t of orderCounts.keys()) {
    if (t !== "cash" && t !== "tfsa" && t !== "nonreg" && t !== "rrsp") {
      throw new Error(`withdrawalOrder contains unknown account type "${t}".`);
    }
  }

  const hasNamedCash = plan.accounts.some((a) => a.type === "cash");
  // Engine cash-first fallback: when named cash accounts exist but the stored
  // (legacy) order predates cash, cash is drawn first as the most liquid bucket.
  // An explicit order that already positions cash is respected verbatim.
  const withdrawalOrder =
    hasNamedCash && !orderCounts.has("cash")
      ? ["cash" as const, ...scenario.withdrawalOrder]
      : scenario.withdrawalOrder;

  const startAge = plan.profile.currentAge;
  const endAge = plan.profile.endAge;

  const accounts: AccountState[] = plan.accounts.map((a) => ({
    id: a.id,
    ...(a.name === undefined ? {} : { name: a.name }),
    type: a.type,
    balance: a.balance,
    mix: a.assetMix,
    ...(a.interestRate === undefined ? {} : { interestRate: a.interestRate }),
    depositPriority: a.depositPriority,
    annualDepositLimit: a.annualDepositLimit,
  }));
  const omittedPriority = Number.MAX_SAFE_INTEGER + 1;
  const depositOrders = new Map(
    accountTypes.flatMap((type) => {
      const group = accounts.filter((account) => account.type === type);
      if (!group.some((account) => account.depositPriority !== undefined || account.annualDepositLimit !== undefined)) {
        return [];
      }
      return [
        [
          type,
          group.sort((a, b) => (a.depositPriority ?? omittedPriority) - (b.depositPriority ?? omittedPriority)),
        ] as const,
      ];
    }),
  );
  const capacity: Partial<Record<AccountType, number>> = {};
  for (const [type, group] of depositOrders) {
    capacity[type] = roundCent(group.reduce((sum, account) => sum + (account.annualDepositLimit ?? Infinity), 0));
  }
  const availableSavingsAccounts = {
    tfsa: accounts.some((account) => account.type === "tfsa"),
    rrsp: accounts.some((account) => account.type === "rrsp"),
    nonreg: accounts.some((account) => account.type === "nonreg"),
  };
  const assetStates: AssetState[] = plan.assets.map((h) => ({
    id: h.id,
    ...(h.name === undefined ? {} : { name: h.name }),
    kind: h.kind,
    value: h.value,
    originalValue: h.value,
    appreciationRate: h.appreciationRate,
    sellEvent: h.sellEvent ? { ...h.sellEvent } : undefined,
  }));
  const debt = plan.debts.find((d) => d.kind === "mortgage");
  let debtBalance = debt?.balance ?? 0; // local: simulate must NEVER mutate the plan
  let cashBalance = 0;

  // TFSA room seeding (Task 9 contract): the 2026 cumulative for residents eligible
  // since roomStartAge — it already includes the 2026 limit, so the first roll adds the
  // NEXT year's limit. RRSP room starts at zero (Plan v1 has no carry-forward field).
  let tfsaRoom = startAge >= tables.tfsa.roomStartAge ? tables.tfsa.cumulativeRoomAsOf2026 : 0;
  let rrspRoom = 0;

  const returnByAge = new Map(returns.years.map((y) => [y.age, y]));

  let prevWithdrawals: YearResult["withdrawals"] = { tfsa: 0, rrsp: 0, nonreg: 0 }; // GIS uses the prior year's draws
  let prevCashInterest = 0; // prior year's cash-account interest counts as GIS income (principal never does)

  // Aggregate non-reg basis (ACB), plan Task 14 — tracked in aggregate because
  // Withdrawals are proportional by balance, so the aggregate basis ratio applies to every draw.
  let nonregBook = plan.accounts.reduce((sum, a) => sum + (a.type === "nonreg" ? (a.bookValue ?? a.balance) : 0), 0);
  let prevNonregGains = 0; // prior year's realized gains count as GIS income (with the taper)

  let failureAge: number | undefined;
  let worstShortfallAge: number | undefined;
  let worstShortfall = 0;
  let postRetirementShortfall = false;
  // A match step without eligible wages becomes an ordinary employee contribution,
  // including the guard against redepositing a proactive RRSP draw.
  const savingsWithoutEmployerMatch = plan.savingsPolicy.map((step) =>
    step.target === "rrsp-match" ? { ...step, target: "rrsp" as const, matchRate: undefined } : step,
  );

  const years: YearResult[] = [];

  for (let age = startAge; age <= endAge; age++) {
    // The loaded table is for its labelled calendar year. Tax parameters are
    // indexed from that year to each projected calendar year.
    const projectedYear = plan.profile.birthYear + age;
    const yearOffset = Math.max(0, projectedYear - tables.year);
    const yearTables = applyIndexation(tables, yearOffset);
    const r = returnByAge.get(age) ?? { age, equity: 0, bond: 0, cash: 0 };
    const events: string[] = [];
    const warnings: string[] = [];
    const accountDetails = new Map<AccountState, AccountDetail>(
      accounts.map((account) => [
        account,
        {
          id: account.id,
          ...(account.name === undefined ? {} : { name: account.name }),
          type: account.type,
          openingBalance: 0,
          closingBalance: 0,
          withdrawals: 0,
          contributions: 0,
        },
      ]),
    );
    reportBalances(accounts, accountDetails, "openingBalance");

    // ---- 0. Cash interest (documented timing): interest accrues on the OPENING
    // named-cash balances and is credited to the accounts BEFORE any flows, so the
    // same year's withdrawals can draw it. It is ordinary income taxed this year
    // (CRA Line 12100: interest "form[s] part of your total income"), counted once —
    // the credit lands in the balance and the taxable amount folds into
    // otherTaxableIncome; it is NOT added to the spendable `cash` line. Principal
    // is never taxed. Zero-rate accounts and legacy plans accrue nothing.
    let cashInterest = 0;
    for (const a of accounts) {
      if (a.type !== "cash") continue;
      const rate = a.interestRate ?? 0;
      if (rate === 0 || a.balance <= 0) continue;
      const interest = roundCent(a.balance * rate);
      a.balance = roundCent(a.balance + interest);
      cashInterest += interest;
      if (interest !== 0) accountDetails.get(a)!.cashInterest = interest;
    }
    // Per-account interest is cent-rounded; round the aggregate too so the
    // reported field carries no floating-point noise into JSON/tax inputs.
    cashInterest = roundCent(cashInterest);

    // ---- 1. Retirement event
    if (age === scenario.retirementAge) events.push("retirement");

    // ---- 2. Income (streams grow at their own raiseRate; CG streams are event-driven)
    // Benefit flags (absent = all received, legacy) only GATE the user's configured
    // streams — no entitlement income is ever invented. GIS additionally requires OAS
    // (canada.ca GIS: "available to Old Age Security pensioners", "To qualify for the
    // GIS, you must also qualify for OAS"), so oas:false forces GIS off.
    const benefits = scenario.benefits ?? { cpp: true, oas: true, gis: true };
    const isActive = (s: { startAge: number; endAge?: number }) =>
      age >= s.startAge && (s.endAge === undefined || age <= s.endAge);
    const grown = (s: { annualAmount: number; startAge: number; raiseRate: number }) =>
      roundCent(s.annualAmount * Math.pow(1 + s.raiseRate, age - s.startAge));

    let employment = 0;
    let requestedEmployerContribution = 0;
    let cpp = 0;
    let oas = 0;
    let otherPlan = 0;
    const incomeBreakdown: NonNullable<YearResult["incomeBreakdown"]> = [];
    for (const [sourceIndex, s] of plan.incomes.entries()) {
      if (!isActive(s)) continue;
      if (s.kind === "employment" && s.endAtRetirement && age >= scenario.retirementAge) continue;
      const amount = grown(s);
      let received = amount;
      if (s.kind === "employment") {
        // Annual bonus (optional fraction of the raised base, 10% = 0.1): paid the
        // same year as the raised base — no separate payout date — and counted ONCE
        // in this year's gross employment income, so the existing tax, GIS
        // employment-income test, RRSP room earned, and surplus/savings allocation
        // all see it through their normal paths. Absent/0 = no bonus (legacy).
        const bonusRate = s.bonusRate ?? 0;
        const bonus = bonusRate > 0 ? roundCent(amount * bonusRate) : 0;
        received = amount + bonus;
        employment += received;
        requestedEmployerContribution += Math.min(
          roundCent(Math.max(0, amount) * (s.employerContributionRate ?? 0)),
          s.employerContributionAnnualCap ?? Infinity,
        );
      } else if (s.kind === "cpp" && benefits.cpp) cpp += amount;
      else if (s.kind === "oas" && benefits.oas) oas += amount;
      else if (s.kind === "other") otherPlan += amount;
      else continue;
      incomeBreakdown.push({
        id: s.id,
        ...(s.name === undefined ? {} : { name: s.name }),
        kind: s.kind,
        amount: roundCent(received),
        sourceIndex,
      });
      // Gated-off CPP/OAS streams contribute nothing this year — they are not
      // reclassified as other income and no entitlement amount is invented.
      if (s.startAge === age && ((s.kind === "cpp" && benefits.cpp) || (s.kind === "oas" && benefits.oas))) {
        events.push(`${s.kind}-start`);
      }
    }

    // Normalize the sum before applying payroll cutoffs or using it in cash flow.
    employment = roundCent(employment);
    requestedEmployerContribution = roundCent(requestedEmployerContribution);
    const taxForYear = (income: IncomeForTax) => taxOf(income, yearTables, oas);

    let expenses = 0;
    const expenseBreakdown: NonNullable<YearResult["expenseBreakdown"]> = [];
    for (const [sourceIndex, e] of plan.expenses.entries()) {
      if (!isActive(e)) continue;
      const amount = e.annualAmount * Math.pow(1 + e.inflationRate, age - e.startAge);
      expenses += amount;
      expenseBreakdown.push({ id: e.id, ...(e.name === undefined ? {} : { name: e.name }), amount, sourceIndex });
    }

    // ---- 1b. Asset sales (value grown through prior years; sold assets never grow again).
    // Initial value is the v1 cost-base proxy; gain = net proceeds − initial value.
    const openingIdleCash = cashBalance;
    let assetSaleToIdleCash = 0;
    let assetSaleToNonreg = 0;
    let capitalGains = 0;
    let saleProceeds = 0;
    const assetSales = new Map<AssetState, number>();
    for (const asset of assetStates) {
      if (asset.sellEvent && age === asset.sellEvent.age) {
        const netProceeds = asset.value * (1 - asset.sellEvent.costsPct);
        saleProceeds += netProceeds;
        capitalGains += Math.max(0, netProceeds - asset.originalValue);
        assetSales.set(asset, netProceeds);
        events.push(asset.kind === "primary-home" ? "home-sold" : "other-asset-sold");
      }
    }

    // ---- 1c. Asset-sale proceeds land in non-registered BEFORE this year's funding,
    // so the freed-up cash can pay the same year's obligations.
    const saleDestination = accounts.some((a) => a.type === "nonreg") ? "nonreg" : "idleCash";
    if (assetSales.size > 0 && saleProceeds > 0) {
      if (saleDestination === "nonreg") {
        const deposits = distributeAccountFlow(accounts, "nonreg", saleProceeds, false);
        const amounts = reportCents(
          deposits.map(({ amount }) => amount),
          saleProceeds,
        );
        deposits.forEach(({ account }, index) => {
          if (amounts[index] !== 0) accountDetails.get(account)!.assetSaleDeposit = amounts[index]!;
        });
        assetSaleToNonreg = saleProceeds;
        nonregBook += saleProceeds; // fresh cash: basis = its value (asset gain taxed separately)
      } else {
        assetSaleToIdleCash = saleProceeds;
        cashBalance += saleProceeds;
      }
    }

    // ---- 3. Mortgage (Task 10); negative-amortization detection is the stepper's job
    const mortgageStart = debtBalance;
    const paymentsPerYear = debt?.paymentFrequency === "biweekly" ? 26 : debt?.paymentFrequency === "weekly" ? 52 : 12;
    const mres =
      debt && debtBalance > 0
        ? mortgageYear({
            balance: debtBalance,
            annualRate: debt.rate,
            monthlyPayment: debt.monthlyPayment,
            paymentsPerYear,
          })
        : { endBalance: debtBalance, interest: 0, principalPaid: 0, paymentsMade: 0 };
    if (debt && debt.monthlyPayment > 0 && mres.endBalance > mortgageStart + 0.005) {
      warnings.push(
        `negative amortization: mortgage payment ($${debt.monthlyPayment} x ${paymentsPerYear}/yr) does not cover interest at age ${age}; balance grows`,
      );
    }
    const mortgageCash =
      debt && debtBalance > 0
        ? // A partial final mortgage year takes at most the balance plus its interest —
          // `paymentsMade x payment` would otherwise bill payments that were never due.
          Math.min(mres.paymentsMade * debt.monthlyPayment, mortgageStart + mres.interest)
        : 0;

    // Employer money uses pre-benefit RRSP room and cannot create room for itself.
    const roomRr = age <= 71 ? rrspRoomEarn(age, employment, rrspRoom, tables) : 0;
    const rrspCapacity = availableSavingsAccounts.rrsp ? (capacity.rrsp ?? Infinity) : 0;
    const employerContribution = Math.min(
      requestedEmployerContribution,
      Math.floor(Math.min(roomRr, rrspCapacity) * 100 + 1e-8) / 100,
    );
    const blockedEmployerContribution = roundCent(requestedEmployerContribution - employerContribution);
    if (blockedEmployerContribution > 0) {
      warnings.push(
        `$${blockedEmployerContribution.toFixed(2)} of the independent employer RRSP contribution could not be deposited at age ${age} because eligible RRSP room or account capacity was unavailable.`,
      );
    }
    const remainingCapacity = { ...capacity, rrsp: rrspCapacity - employerContribution };
    const remainingRooms = { tfsa: tfsaRoom, rrsp: roomRr - employerContribution };

    // Mandatory RRIF and proactive draws use only the balance available before savings.
    const rrspAtStart = sumType(accounts, "rrsp");
    let rrifDue = 0;
    if (age >= 71 && rrspAtStart > 0) {
      const due = rrifMinimum(age, rrspAtStart, yearTables);
      if (due) rrifDue = Math.min(due.minimum, rrspAtStart);
    }
    const balances = {
      tfsa: sumType(accounts, "tfsa"),
      rrsp: rrspAtStart,
      nonreg: sumType(accounts, "nonreg"),
      debt: mres.endBalance,
    };
    const savingsPolicy = employment > 0 ? plan.savingsPolicy : savingsWithoutEmployerMatch;

    const quote = (match: number, matchLimit?: number) => {
      const payrollWarnings: string[] = [];
      const employerBenefit = roundCent(employerContribution + match);
      const grossEmployment = roundCent(employment + employerBenefit);
      const payroll = annualPayroll(grossEmployment, cpp, age, scenario.payroll, yearTables.payroll, payrollWarnings);
      const netPayrollCost = roundCent(payroll.total - payroll.eiRefund);
      const gis =
        age >= 65 && benefits.gis && benefits.oas
          ? gisAnnual(
              age,
              {
                cpp,
                rrspRrifWithdrawals: prevWithdrawals.rrsp,
                employmentIncome: employment - netPayrollCost,
                otherTaxableIncome: otherPlan + Math.max(0, prevNonregGains) + prevCashInterest,
                tfsaWithdrawals: prevWithdrawals.tfsa,
              },
              yearTables,
            )
          : 0;
      const incomeAfterWithdrawals = (rrspDraw: number, nonregGain: number): IncomeForTax => ({
        employmentIncome: grossEmployment,
        employerRrspDeduction: employerBenefit,
        payrollCreditAmount: roundCent(payroll.cppBase + payroll.ei - payroll.eiRefund),
        enhancedCppDeduction: payroll.enhancedCppDeduction,
        otherTaxableIncome: cpp + oas + otherPlan + cashInterest,
        rrspWithdrawals: rrspDraw,
        pensionEligibleIncome: age >= 65 ? rrspDraw : 0,
        capitalGains: capitalGains + nonregGain,
        dividendsEligible: 0,
        age,
      });
      const plannedRrspDraw =
        policy && policy.fillTargetTaxable > 0
          ? roundCent(
              Math.min(
                Math.max(0, rrspAtStart - rrifDue),
                Math.max(0, policy.fillTargetTaxable - taxableIncome(incomeAfterWithdrawals(rrifDue, 0))),
              ),
            )
          : 0;
      const fundedRrspDraw = rrifDue + plannedRrspDraw;
      // Include the draws' own tax before choosing between savings and deficit funding.
      const taxWithDue = taxForYear(incomeAfterWithdrawals(fundedRrspDraw, 0));
      const cash = employment + cpp + oas + otherPlan + gis + fundedRrspDraw + cashBalance - netPayrollCost;
      const obligation = expenses + taxWithDue.total + mortgageCash;
      const surplusWithoutProactiveDraw =
        plannedRrspDraw > 0
          ? cash - plannedRrspDraw - expenses - mortgageCash - taxForYear(incomeAfterWithdrawals(rrifDue, 0)).total
          : undefined;
      const allocation =
        cash >= obligation
          ? allocateSurplus(
              cash - obligation,
              savingsPolicy,
              remainingRooms,
              balances,
              debt,
              age,
              availableSavingsAccounts,
              plannedRrspDraw > 0,
              remainingCapacity,
              matchLimit,
              surplusWithoutProactiveDraw,
            )
          : undefined;
      return {
        payroll,
        payrollWarnings,
        gis,
        incomeAfterWithdrawals,
        plannedRrspDraw,
        fundedRrspDraw,
        taxWithDue,
        cash,
        obligation,
        allocation,
      };
    };

    let settled = quote(0);
    const initialMatch = settled.allocation?.employerMatch ?? 0;
    if (initialMatch > 0) {
      settled = quote(initialMatch);
      const observedMatch = roundCent(settled.allocation?.employerMatch ?? 0);
      if (observedMatch !== roundCent(initialMatch)) {
        // Across the EI refund cutoff, an unconstrained quote can oscillate.
        // Find the largest match whose own payroll cost the allocation can fund.
        // A match cannot exceed half the gross deposit, since the rate is at most 1.
        let low = 0;
        let high = Math.floor(Math.min(remainingRooms.rrsp, remainingCapacity.rrsp) * 50 + 1e-8);
        if (observedMatch < initialMatch) high = Math.round(initialMatch * 100) - 1;
        while (low < high) {
          const middle = low + Math.ceil((high - low) / 2);
          const trial = quote(middle / 100);
          if (Math.round((trial.allocation?.employerMatch ?? 0) * 100) >= middle) low = middle;
          else high = middle - 1;
        }
        settled = quote(low / 100, low / 100);
      }
    }
    const {
      payroll,
      payrollWarnings,
      gis,
      incomeAfterWithdrawals,
      plannedRrspDraw,
      fundedRrspDraw,
      taxWithDue,
      cash,
      obligation,
      allocation,
    } = settled;
    warnings.push(...payrollWarnings);

    const withdrawals: YearResult["withdrawals"] = { tfsa: 0, rrsp: fundedRrspDraw, nonreg: 0 };
    const contributions: YearResult["contributions"] = { tfsa: 0, rrsp: employerContribution, nonreg: 0 };
    let contributionsCash = 0;
    const employerMatch = roundCent(allocation?.employerMatch ?? 0);
    let mortgagePrepay = 0;
    let shortfall = 0;
    let finalTax = taxWithDue;
    let nonregGains = 0;

    if (allocation) {
      contributions.tfsa = roundCent(allocation.contributions.tfsa);
      contributions.rrsp = roundCent(employerContribution + allocation.contributions.rrsp);
      contributions.nonreg = roundCent(allocation.contributions.nonreg);
      contributionsCash = roundCent(allocation.contributions.cash ?? 0);
      mortgagePrepay = roundCent(allocation.amounts.mortgage);
      cashBalance = roundCent(allocation.cash);
      // A cash step without a named destination is reported as an idle-cash deposit.
      if (contributionsCash > 0 && !hasNamedCash) {
        cashBalance = roundCent(cashBalance + contributionsCash);
      }
    } else {
      // ---- Deficit branch: withdraw in `withdrawalOrder`, grossing RRSP draws for tax
      let need = obligation - cash;
      // The opening cash balance is fungible with this year's income and is fully
      // consumed whenever total cash is below the year's obligation.
      cashBalance = 0;
      for (const type of withdrawalOrder) {
        if (need <= 0) break;
        const available = Math.max(0, sumType(accounts, type) - (withdrawals[type] ?? 0));
        if (available === 0) continue;
        const taxBeforeDraw = finalTax.total;
        if (type === "rrsp") {
          // The tax baseline includes mandatory and proactive RRSP draws and
          // any gains already realized earlier in the withdrawal order.
          const taxAfterDraw = (draw: number) =>
            taxForYear(incomeAfterWithdrawals(withdrawals.rrsp + draw, nonregGains));
          let draw = Math.min(available, need);
          for (let iter = 0; iter < 24; iter++) {
            const extra = taxAfterDraw(draw).total - taxBeforeDraw;
            const next = Math.min(available, Math.max(0, need + extra));
            if (Math.abs(next - draw) < 0.005) {
              draw = next;
              break;
            }
            draw = next;
          }
          finalTax = taxAfterDraw(draw);
          withdrawals.rrsp += draw;
          need -= draw - (finalTax.total - taxBeforeDraw);
        } else if (type === "nonreg") {
          const gainOnDraw = (draw: number) =>
            draw >= available ? available - nonregBook : draw * (1 - nonregBook / available);
          const taxAfterDraw = (draw: number) =>
            taxForYear(incomeAfterWithdrawals(withdrawals.rrsp, nonregGains + gainOnDraw(draw)));
          const netProceeds = (draw: number) => draw - (taxAfterDraw(draw).total - taxBeforeDraw);
          let draw = available;
          if (netProceeds(available) > need) {
            // Net proceeds increase with the gross draw. A capital loss can
            // make them rise faster than the draw by reducing tax on prior gains.
            let low = 0;
            let high = available;
            for (let iter = 0; iter < 64 && high - low > 0.000001; iter++) {
              const middle = low + (high - low) / 2;
              if (netProceeds(middle) >= need) high = middle;
              else low = middle;
            }
            draw = high;
          }
          finalTax = taxAfterDraw(draw);
          const realizedGain = gainOnDraw(draw);
          nonregGains += realizedGain;
          nonregBook = Math.max(0, nonregBook - (draw - realizedGain));
          withdrawals.nonreg += draw;
          need -= draw - (finalTax.total - taxBeforeDraw);
        } else {
          // TFSA and named-cash draws: neither carries tax in v1 (cash principal is
          // never taxed; cash interest was already taxed at the year's opening).
          const take = Math.min(available, need);
          withdrawals[type] = (withdrawals[type] ?? 0) + take;
          need -= take;
        }
      }
      shortfall = Math.max(0, roundCent(need));
      // Expenses absorb the shortfall: the household simply cannot fund the rest.
    }
    // Book contributions at par (ACB grows with every fresh dollar that lands in non-reg).
    nonregBook += contributions.nonreg;
    if (contributionsCash > 0) contributions.cash = contributionsCash;

    // ---- 5b. Apply withdrawals, then the accepted savings deposits.
    applyFlows(accounts, withdrawals, contributions, accountDetails, depositOrders, {
      independent: employerContribution,
      match: employerMatch,
      deposits: allocation?.rrspDeposits ?? [],
    });

    // ---- 6. Growth on post-flow balances, each account at its own mix.
    // Non-reg basis grows with the market (Task 14 convention: ACB absorbs the
    // year's growth — book += market x weightedBlended, computed on the
    // value-weighted mix across non-reg accounts).
    // Cash accounts are skipped: they earn their fixed interestRate, credited at
    // the year's opening, and never follow the market return series (any mode).
    const nonregMarketPre = sumType(accounts, "nonreg");
    for (const a of accounts) {
      if (a.type === "cash" || a.mix === undefined) continue;
      a.balance = roundCent(
        Math.max(0, a.balance * (1 + a.mix.equity * r.equity + a.mix.bond * r.bond + a.mix.cash * r.cash)),
      );
    }
    const nonregMarketPost = sumType(accounts, "nonreg");
    nonregBook = nonregMarketPost === 0 ? 0 : roundCent(Math.max(0, nonregBook + nonregMarketPost - nonregMarketPre));

    // Assets: sold this year -> zero; otherwise they appreciate at year end.
    let homeValue = 0;
    let otherAssetValue = 0;
    for (const asset of assetStates) {
      if (assetSales.has(asset)) {
        asset.sellEvent = undefined;
        asset.value = 0;
      } else {
        asset.value = roundCent(asset.value * (1 + asset.appreciationRate));
      }
      if (asset.kind === "primary-home") homeValue += asset.value;
      else otherAssetValue += asset.value;
    }

    // Debt: month loop paydown, then voluntary prepay (local state only — the plan is never mutated).
    const debtEnd = Math.max(0, mres.endBalance - mortgagePrepay);
    debtBalance = debtEnd;

    // ---- Rooms roll to next year (Task 9 contract: room passed already net of contributions)
    tfsaRoom = roundCent(
      Math.max(
        0,
        tfsaRoomNextYear(
          { room: roundCent(tfsaRoom - contributions.tfsa), currentAge: age },
          withdrawals.tfsa,
          tables,
          age + 1 >= tables.tfsa.roomStartAge,
        ),
      ),
    );
    // The extra room earned on employer benefits first becomes available next year.
    rrspRoom = roundCent(
      Math.max(
        0,
        rrspRoomEarn(age, employment + employerContribution + employerMatch, rrspRoom - contributions.rrsp, tables),
      ),
    );

    // ---- 7. Final tax figures + marginal rate (numeric derivative per $100)
    const taxPlus = taxForYear(incomeAfterWithdrawals(withdrawals.rrsp + 100, nonregGains));
    const marginalRate = roundCent4((taxPlus.total - finalTax.total) / 100);

    const netWorth = roundCent(
      sumType(accounts, "tfsa") +
        sumType(accounts, "rrsp") +
        sumType(accounts, "nonreg") +
        sumType(accounts, "cash") +
        cashBalance +
        homeValue -
        debtEnd +
        otherAssetValue,
    );

    const namedCash = accounts.filter((a) => a.type === "cash");
    reportBalances(accounts, accountDetails, "closingBalance");
    const saleAmounts = reportCents([...assetSales.values()], saleProceeds);
    [...assetSales.keys()].forEach((asset, index) => assetSales.set(asset, saleAmounts[index]!));
    const assetBreakdown: NonNullable<YearResult["assetBreakdown"]> = assetStates.map((asset) => {
      const proceeds = assetSales.get(asset);
      return {
        id: asset.id,
        ...(asset.name === undefined ? {} : { name: asset.name }),
        kind: asset.kind,
        closingBalance: roundCent(asset.value),
        ...(proceeds === undefined ? {} : { sale: { proceeds, destination: saleDestination } }),
      };
    });
    const year: YearResult = {
      age,
      income: {
        employment,
        cpp: roundCent(cpp),
        oas: roundCent(oas),
        gis: roundCent(gis),
        other: roundCent(otherPlan + employerContribution + employerMatch),
      },
      // Optional cash fields are ABSENT (not 0) for plans without cash activity,
      // so legacy saved plans keep their exact result shapes.
      ...(cashInterest > 0 ? { cashInterest } : {}),
      ...(plannedRrspDraw > 0 ? { plannedRrspDraw: roundCent(plannedRrspDraw) } : {}),
      payroll,
      taxableIncome: roundCent(finalTax.taxable),
      tax: {
        federal: roundCent(finalTax.federal),
        provincial: roundCent(finalTax.provincial),
        surtax: roundCent(finalTax.surtax),
        oasClawback: roundCent(finalTax.oasClawback),
        total: roundCent(finalTax.total),
        marginalRate,
      },
      withdrawals: {
        tfsa: roundCent(withdrawals.tfsa),
        rrsp: roundCent(withdrawals.rrsp),
        nonreg: roundCent(withdrawals.nonreg),
        ...(withdrawals.cash ? { cash: roundCent(withdrawals.cash) } : {}),
      },
      contributions: {
        tfsa: roundCent(contributions.tfsa),
        rrsp: roundCent(contributions.rrsp),
        nonreg: roundCent(contributions.nonreg),
        ...(contributions.cash ? { cash: roundCent(contributions.cash) } : {}),
      },
      savings: {
        tfsa: roundCent(contributions.tfsa),
        rrsp: roundCent(contributions.rrsp),
        nonreg: roundCent(contributions.nonreg),
        ...(contributions.cash ? { cash: roundCent(contributions.cash) } : {}),
        mortgage: roundCent(mortgagePrepay),
      },
      expenses: roundCent(expenses),
      rrifMinimumWithdrawal: roundCent(rrifDue),
      expenseBreakdown,
      accountBreakdown: [...accountDetails.values()],
      incomeBreakdown,
      assetBreakdown,
      ...(debt
        ? {
            mortgageBreakdown: {
              id: debt.id,
              openingBalance: roundCent(mortgageStart),
              closingBalance: roundCent(debtEnd),
              scheduledPayment: roundCent(mortgageCash),
              prepayment: roundCent(mortgagePrepay),
            },
          }
        : {}),
      cashflow: {
        scheduledMortgagePayment: roundCent(mortgageCash),
        openingIdleCash: roundCent(openingIdleCash),
        closingIdleCash: roundCent(cashBalance),
        assetSaleToIdleCash: roundCent(assetSaleToIdleCash),
        assetSaleToNonreg: roundCent(assetSaleToNonreg),
        employerRrspMatch: employerMatch,
        ...(employerContribution > 0 ? { employerRrspContribution: employerContribution } : {}),
        ...(blockedEmployerContribution > 0 ? { blockedEmployerRrspContribution: blockedEmployerContribution } : {}),
        cashContributionsToIdleCash: hasNamedCash ? 0 : contributionsCash,
      },
      shortfall: roundCent(shortfall),
      balances: {
        tfsa: roundBal(accounts, "tfsa"),
        rrsp: roundBal(accounts, "rrsp"),
        nonreg: roundBal(accounts, "nonreg"),
        // The floating idle-cash pool plus every named cash account, counted once.
        cash: roundCent(cashBalance + roundBal(accounts, "cash")),
        home: roundCent(homeValue),
        otherAssets: roundCent(otherAssetValue),
        debt: roundCent(debtEnd),
      },
      ...(namedCash.length > 0
        ? {
            cashAccounts: namedCash.map((a) => ({
              id: a.id,
              ...(a.name === undefined ? {} : { name: a.name }),
              balance: accountDetails.get(a)!.closingBalance,
            })),
          }
        : {}),
      netWorth,
      tfsaRoom,
      rrspRoom,
      events,
      warnings,
    };

    if (shortfall > 0) {
      if (failureAge === undefined) failureAge = age;
      if (age >= scenario.retirementAge) postRetirementShortfall = true;
      if (shortfall > worstShortfall) {
        worstShortfall = shortfall;
        worstShortfallAge = age;
      }
    }
    years.push(year);
    prevWithdrawals = { tfsa: year.withdrawals.tfsa, rrsp: year.withdrawals.rrsp, nonreg: year.withdrawals.nonreg };
    prevNonregGains = nonregGains;
    prevCashInterest = cashInterest;
  }

  const finalNW = years[years.length - 1]?.netWorth ?? 0;
  return {
    years,
    summary: {
      success: finalNW >= 0 && !postRetirementShortfall,
      failureAge,
      finalNetWorth: finalNW,
      worstShortfallAge,
    },
    ...(withdrawalPlan ? { withdrawalPlan } : {}),
  };
}

/**
 * Applies each flow using the original balance weights. Capture the applied dollars
 * and weights before growth and before the next flow changes account balances.
 */
function distributeAccountFlow(accounts: AccountState[], type: AccountType, total: number, withdraw: boolean) {
  if (total === 0) return [];
  const list = accounts.filter((a) => a.type === type);
  if (list.length === 0) return [];
  const sum = list.reduce((s, a) => s + a.balance, 0);
  if (sum <= 0) {
    if (withdraw) return [];
    const account = list[0]!;
    account.balance += total;
    return [{ account, amount: total, weight: 1 }];
  }
  return list.map((account) => {
    const weight = account.balance / sum;
    const share = weight * total;
    const amount = withdraw ? Math.min(share, account.balance) : share;
    account.balance += withdraw ? -amount : amount;
    return { account, amount, weight };
  });
}

function applyFlows(
  accounts: AccountState[],
  withdrawals: YearResult["withdrawals"],
  contributions: YearResult["contributions"],
  details: Map<AccountState, AccountDetail>,
  depositOrders: ReadonlyMap<AccountType, AccountState[]>,
  employer: { independent: number; match: number; deposits: AllocateSurplusResult["rrspDeposits"] },
): void {
  for (const type of accountTypes) {
    const withdrawal = withdrawals[type] ?? 0;
    const draws = distributeAccountFlow(accounts, type, withdrawal, true);
    // A capped draw can debit less than the requested aggregate after rounding.
    const appliedDraw = draws.reduce((sum, { amount }) => sum + amount, 0);
    const drawAmounts = reportCents(
      draws.map(({ amount }) => amount),
      appliedDraw,
    );
    draws.forEach(({ account }, index) => {
      details.get(account)!.withdrawals = drawAmounts[index]!;
    });

    const contribution = contributions[type] ?? 0;
    const ordered = depositOrders.get(type);
    if (ordered) {
      if (type === "rrsp") {
        applyOrderedDeposit(ordered, details, employer.independent, 0, true);
        for (const deposit of employer.deposits) {
          applyOrderedDeposit(ordered, details, deposit.amount, deposit.match);
        }
      } else {
        applyOrderedDeposit(ordered, details, contribution);
      }
      continue;
    }

    const deposits = distributeAccountFlow(accounts, type, contribution, false);
    const independent = type === "rrsp" ? employer.independent : 0;
    const match = type === "rrsp" ? employer.match : 0;
    const gross = reportCents(
      deposits.map(({ amount }) => amount),
      contribution,
    );
    const independentShares =
      independent === 0
        ? []
        : reportCents(
            deposits.map(({ weight }) => weight * independent),
            independent,
            gross,
          );
    // Both rounded employer shares together must fit the account's deposit.
    const matches =
      match === 0
        ? []
        : reportCents(
            deposits.map(({ weight }) => weight * match),
            match,
            gross.map((amount, index) => amount - (independentShares[index] ?? 0)),
          );
    deposits.forEach(({ account }, index) => {
      const detail = details.get(account)!;
      const accountMatch = matches[index] ?? 0;
      const accountIndependent = independentShares[index] ?? 0;
      detail.contributions = gross[index]!;
      if (accountMatch !== 0) detail.employerRrspMatch = accountMatch;
      if (accountIndependent !== 0) detail.employerRrspContribution = accountIndependent;
    });
  }
}

function applyOrderedDeposit(
  accounts: AccountState[],
  details: Map<AccountState, AccountDetail>,
  amount: number,
  match = 0,
  independent = false,
): void {
  let remaining = roundCent(amount);
  const shares: { detail: AccountDetail; amount: number }[] = [];
  for (const account of accounts) {
    if (remaining === 0) break;
    const detail = details.get(account)!;
    const capacity = (account.annualDepositLimit ?? Infinity) - detail.contributions;
    const take = roundCent(Math.min(remaining, capacity));
    if (take <= 0) continue;
    account.balance += take;
    detail.contributions = roundCent(detail.contributions + take);
    if (independent) detail.employerRrspContribution = take;
    shares.push({ detail, amount: take });
    remaining = roundCent(remaining - take);
  }
  if (match > 0) {
    const gross = shares.map((share) => share.amount);
    const matches = reportCents(
      gross.map((share) => (share / amount) * match),
      match,
      gross,
    );
    shares.forEach(({ detail }, index) => {
      const share = matches[index]!;
      if (share > 0) detail.employerRrspMatch = roundCent((detail.employerRrspMatch ?? 0) + share);
    });
  }
}
