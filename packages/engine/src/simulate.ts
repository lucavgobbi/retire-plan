import tablesJson from "../data/tax/ca-2026.json";
import { applyIndexation, loadTables, type TaxYearTables } from "./tax/tables";
import {
  validatePlan,
  type AccountPlan,
  type Plan,
  type ReturnSeries,
  type Scenario,
  type SimulationResult,
  type YearResult,
} from "./types";
import { federalTax, taxableIncome, type IncomeForTax } from "./tax/federal";
import { ontarioTax } from "./tax/ontario";
import { oasClawback } from "./tax/oasClawback";
import { gisAnnual } from "./benefits/gis";
import { rrifMinimum } from "./benefits/rrif";
import { tfsaRoomNextYear, rrspRoomEarn } from "./accounts/rooms";
import { mortgageYear } from "./mortgage";
import { allocateSurplus } from "./accounts/flows";

/** Storage-boundary rounding: money leaves the engine as whole cents. */
function roundCent(x: number): number {
  return Math.round(x * 100) / 100;
}

function roundCent4(x: number): number {
  return Math.round(x * 1_000_000) / 1_000_000;
}

interface AccountState {
  id: string;
  type: AccountPlan["type"];
  balance: number;
  mix: AccountPlan["assetMix"];
}

interface AssetState {
  id: string;
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
 * Employer RRSP match is recognized as an income-side inflow (compensation) that lands
 * in the RRSP tax-free in v1 and consumes RRSP room via the pension adjustment.
 */
export function simulate(
  plan: Plan,
  scenario: Scenario,
  returns: ReturnSeries,
  tables: TaxYearTables = loadTables(tablesJson),
): SimulationResult {
  const errors = validatePlan(plan);
  if (errors.length > 0) {
    throw new Error(`validatePlan: ${errors.join(" ")}`);
  }

  const startAge = plan.profile.currentAge;
  const endAge = plan.profile.endAge;

  const accounts: AccountState[] = plan.accounts.map((a) => ({
    id: a.id,
    type: a.type,
    balance: a.balance,
    mix: a.assetMix,
  }));
  const assetStates: AssetState[] = plan.assets.map((h) => ({
      id: h.id,
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

  // Aggregate non-reg basis (ACB), plan Task 14 — tracked in aggregate because
  // applyFlows distributes proportional to balance, which makes the aggregate
  // ratio math exact (Sum(basis_i)/Sum(market) arithmetic collapses cleanly).
  let nonregBook = plan.accounts.reduce(
    (sum, a) => sum + (a.type === "nonreg" ? a.bookValue ?? a.balance : 0),
    0,
  );
  let prevNonregGains = 0; // prior year's realized gains count as GIS income (with the taper)

  let failureAge: number | undefined;
  let worstShortfallAge: number | undefined;
  let worstShortfall = 0;
  let postRetirementShortfall = false;

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

    // ---- 1. Retirement event
    if (age === scenario.retirementAge) events.push("retirement");

    // ---- 2. Income (streams grow at their own raiseRate; CG streams are event-driven)
    const isActive = (s: { startAge: number; endAge?: number }) =>
      age >= s.startAge && (s.endAge === undefined || age <= s.endAge);
    const grown = (s: { annualAmount: number; startAge: number; raiseRate: number }) =>
      roundCent(s.annualAmount * Math.pow(1 + s.raiseRate, age - s.startAge));

    let employment = 0;
    let cpp = 0;
    let oas = 0;
    let otherPlan = 0;
    for (const s of plan.incomes) {
      if (!isActive(s)) continue;
      const amount = grown(s);
      if (s.kind === "employment") employment += amount;
      else if (s.kind === "cpp") cpp += amount;
      else if (s.kind === "oas") oas += amount;
      else otherPlan += amount;
      if (s.startAge === age && (s.kind === "cpp" || s.kind === "oas")) {
        events.push(`${s.kind}-start`);
      }
    }

    const taxForYear = (income: IncomeForTax) => taxOf(income, yearTables, oas);

    const gis =
      age >= 65
        ? gisAnnual(
            age,
            {
              cpp,
              rrspRrifWithdrawals: prevWithdrawals.rrsp,
              employmentIncome: employment,
              otherTaxableIncome: otherPlan + Math.max(0, prevNonregGains), // positive gains count; losses are not GIS deductions
              tfsaWithdrawals: prevWithdrawals.tfsa,
            },
            yearTables,
          )
        : 0;

    let expenses = 0;
    for (const e of plan.expenses) {
      if (!isActive(e)) continue;
      expenses += e.annualAmount * Math.pow(1 + e.inflationRate, age - e.startAge);
    }

    // ---- 1b. Asset sales (value grown through prior years; sold assets never grow again).
    // Initial value is the v1 cost-base proxy; gain = net proceeds − initial value.
    let capitalGains = 0;
    let saleProceeds = 0;
    const soldAssetIds = new Set<string>();
    for (const asset of assetStates) {
      if (asset.sellEvent && age === asset.sellEvent.age) {
        const netProceeds = asset.value * (1 - asset.sellEvent.costsPct);
        saleProceeds += netProceeds;
        capitalGains += Math.max(0, netProceeds - asset.originalValue);
        soldAssetIds.add(asset.id);
        events.push(asset.kind === "primary-home" ? "home-sold" : "other-asset-sold");
      }
    }

    // ---- 1c. Asset-sale proceeds land in non-registered BEFORE this year's funding,
    // so the freed-up cash can pay the same year's obligations.
    if (soldAssetIds.size > 0 && saleProceeds > 0) {
      injectCash(accounts, "nonreg", saleProceeds);
      if (accounts.some((a) => a.type === "nonreg")) {
        nonregBook += saleProceeds; // fresh cash: basis = its value (asset gain taxed separately)
      } else {
        cashBalance += saleProceeds;
      }
    }

    // ---- 3. Mortgage (Task 10); negative-amortization detection is the stepper's job
    const mortgageStart = debtBalance;
    const mres =
      debt && debtBalance > 0
        ? mortgageYear({ balance: debtBalance, annualRate: debt.rate, monthlyPayment: debt.monthlyPayment })
        : { endBalance: debtBalance, interest: 0, principalPaid: 0, paymentsMade: 0 };
    if (debt && debt.monthlyPayment > 0 && mres.endBalance > mortgageStart + 0.005) {
      warnings.push(
        `negative amortization: mortgage payment ($${debt.monthlyPayment}/mo) does not cover interest at age ${age}; balance grows`,
      );
    }
    const mortgageCash =
      debt && debtBalance > 0
        ? // A partial final mortgage year takes at most the balance plus its interest —
          // `paymentsMade x payment` would otherwise bill payments that were never due.
          Math.min(mres.paymentsMade * debt.monthlyPayment, mortgageStart + mres.interest)
        : 0;

    // ---- 7-pre. Income base for every tax shape this year. CPP, OAS and 'other'
    // streams are fully taxable and live in otherTaxableIncome; withdrawals are
    // layered on top per branch (tax0 is the floor, taxWithDue adds the RRIF minimum).
    const incomeBase: IncomeForTax = {
      employmentIncome: employment,
      otherTaxableIncome: cpp + oas + otherPlan,
      rrspWithdrawals: 0,
      pensionEligibleIncome: 0,
      capitalGains,
      dividendsEligible: 0,
      age,
    };

    // ---- 5a. Mandatory RRIF minimum, first and always (Task 8)
    const rrspAtStart = sumType(accounts, "rrsp");
    let rrifDue = 0;
    if (age >= 71 && rrspAtStart > 0) {
      const due = rrifMinimum(age, rrspAtStart, yearTables);
      if (due) rrifDue = Math.min(due.minimum, rrspAtStart);
    }

    // The obligation prices the mandatory minimum's OWN tax in: a year whose only
    // funding is the RRIF minimum must land in the deficit branch when minimum plus
    // streams cannot cover expenses plus its tax (otherwise the surplus branch would
    // silently swallow the gap with its Math.max(0, ...) clamp).
    const taxWithDue = taxForYear(
      { ...incomeBase, rrspWithdrawals: rrifDue, pensionEligibleIncome: age >= 65 ? rrifDue : 0 },
    );
    const cash = employment + cpp + oas + otherPlan + gis + rrifDue + cashBalance;
    const obligation = expenses + taxWithDue.total + mortgageCash;

    const withdrawals: YearResult["withdrawals"] = { tfsa: 0, rrsp: 0, nonreg: 0 };
    const contributions: YearResult["contributions"] = { tfsa: 0, rrsp: 0, nonreg: 0 };
    let employerMatch = 0;
    let mortgagePrepay = 0;
    let shortfall = 0;
    let finalTax = taxWithDue;

    // Non-reg realized-gain accounting (plan Task 14): gains are taxed as each
    // non-reg draw happens, and the charged tax folds into the reported tax
    // exactly as cash is charged, keeping the year ledger conserved.
    let nonregGains = 0;
    const nonregGainsTax = { federal: 0, provincial: 0, surtax: 0, oasClawback: 0, total: 0 };

    let roomTf = tfsaRoom; // this year's room available to the allocator
    // RRSP room available IN-YEAR: carry-forward plus the room earned this year
    // (capped at the annual limit). Documented v1 simplification — CRA formally
    // makes a year's earned room contributable the following year. The employer
    // pension adjustment is applied once, at the year-end roll below.
    let roomRr = rrspRoom + Math.min(
      tables.rrsp.incomeRate * Math.max(0, employment),
      tables.rrsp.annualLimit,
    );

    if (cash >= obligation) {
      // ---- Surplus branch: the year funds everything including the RRIF minimum's tax.
      // Mandatory RRIF minimum is taken even in surplus years (counted as withdrawal,
      // returned to cash inside `cash`).
      finalTax = taxWithDue;
      withdrawals.rrsp = rrifDue;
      const allocation = allocateSurplus(
        Math.max(0, cash - expenses - finalTax.total - mortgageCash),
        plan.savingsPolicy,
        { tfsa: roomTf, rrsp: roomRr },
        {
          tfsa: sumType(accounts, "tfsa"),
          rrsp: sumType(accounts, "rrsp"),
          nonreg: sumType(accounts, "nonreg"),
          debt: mres.endBalance,
        },
        debt,
        age,
        {
          tfsa: accounts.some((a) => a.type === "tfsa"),
          rrsp: accounts.some((a) => a.type === "rrsp"),
          nonreg: accounts.some((a) => a.type === "nonreg"),
        },
      );
      contributions.tfsa = roundCent(allocation.contributions.tfsa);
      contributions.rrsp = roundCent(allocation.contributions.rrsp);
      contributions.nonreg = roundCent(allocation.contributions.nonreg);
      roomTf = allocation.newRooms.tfsa;
      roomRr = allocation.newRooms.rrsp;
      mortgagePrepay = roundCent(allocation.amounts.mortgage);
      employerMatch = roundCent(allocation.employerMatch);
      cashBalance = roundCent(allocation.cash);
    } else {
      // ---- Deficit branch: withdraw in `withdrawalOrder`, grossing RRSP draws for tax
      let need = obligation - cash;
      // The opening cash balance is fungible with this year's income and is fully
      // consumed whenever total cash is below the year's obligation.
      cashBalance = 0;
      for (const type of scenario.withdrawalOrder) {
        const available = Math.max(0, sumType(accounts, type) - withdrawals[type]);
        if (type === "rrsp") {
          // RRIF due is already earmarked against this balance: new draws may only
          // consume what is left of it.
          const drawable = Math.max(0, sumType(accounts, type) - rrifDue);
          const shape = (amount: number): IncomeForTax => ({
            ...incomeBase,
            rrspWithdrawals: rrifDue + amount,
            pensionEligibleIncome: age >= 65 ? rrifDue + amount : 0,
          });
          // Iterate to a SELF-CONSISTENT grossed-up draw: the draw must deliver `need`
          // net of the marginal tax the new draw itself creates (the mandatory
          // minimum's own tax is already priced inside `obligation`/`taxWithDue`).
          // Each pass contracts the error by the marginal rate, so this reaches cents fast.
          let draw = Math.min(drawable, Math.max(0, need));
          let extra = 0;
          for (let iter = 0; iter < 24; iter++) {
            extra = Math.max(0, taxForYear(shape(draw)).total - taxWithDue.total);
            const next = Math.min(drawable, Math.max(0, need + extra));
            if (Math.abs(next - draw) < 0.005) {
              draw = next;
              break;
            }
            draw = next;
          }
          // Re-derive the tax from the FINAL draw so `extra` and the recorded tax
          // describe the same shape — otherwise the ledger leaks the difference.
          extra = Math.max(0, taxForYear(shape(draw)).total - taxWithDue.total);
          withdrawals.rrsp = rrifDue + draw;
          finalTax = taxForYear(shape(draw));
          need -= Math.max(0, draw - extra); // net cash actually delivered after its tax
        } else if (type === "nonreg") {
          // Plan Task 14: non-reg draws now carry their realized-gain tax. The chunk is
          // taxed marginally on the year's income-so-far shape; the household receives
          // `take - chunkTax` net, and the charged tax folds into the reported tax.
          const take = Math.min(Math.max(0, available), Math.max(0, need));
          if (take > 0) {
            const marketNow = Math.max(0, sumType(accounts, "nonreg") - withdrawals.nonreg);
            const ratio = marketNow > 0 ? Math.max(0, nonregBook / marketNow) : 0;
            let draw = Math.min(take, marketNow);
            const taxShape = (): IncomeForTax => ({
              ...incomeBase,
              rrspWithdrawals: withdrawals.rrsp,
              pensionEligibleIncome: age >= 65 ? withdrawals.rrsp : 0,
              capitalGains: capitalGains + nonregGains,
            });
            let beforeShape = taxShape();
            let t0 = taxForYear(beforeShape);
            let chunkGain = draw >= marketNow ? marketNow - nonregBook : draw * (1 - ratio);
            let t1 = taxForYear({ ...beforeShape, capitalGains: capitalGains + nonregGains + chunkGain });
            let delta = t1.total - t0.total;
            // Solve gross proceeds against the tax change from this draw. Capital
            // losses may offset this year's gains; taxOf floors the tax itself.
            for (let iter = 0; iter < 24; iter++) {
              const next = Math.min(marketNow, Math.max(0, take + delta));
              if (Math.abs(next - draw) < 0.005) { draw = next; break; }
              draw = next;
              chunkGain = draw >= marketNow ? marketNow - nonregBook : draw * (1 - ratio);
              beforeShape = taxShape();
              t0 = taxForYear(beforeShape);
              t1 = taxForYear({ ...beforeShape, capitalGains: capitalGains + nonregGains + chunkGain });
              delta = t1.total - t0.total;
            }
            chunkGain = draw >= marketNow ? marketNow - nonregBook : draw * (1 - ratio);
            beforeShape = taxShape();
            t0 = taxForYear(beforeShape);
            t1 = taxForYear({ ...beforeShape, capitalGains: capitalGains + nonregGains + chunkGain });
            delta = t1.total - t0.total;
            nonregGainsTax.federal += t1.federal - t0.federal;
            nonregGainsTax.provincial += t1.provincial - t0.provincial;
            nonregGainsTax.surtax += t1.surtax - t0.surtax;
            nonregGainsTax.oasClawback += t1.oasClawback - t0.oasClawback;
            nonregGainsTax.total += delta;
            nonregGains += chunkGain;
            const basisConsumed = draw >= marketNow ? nonregBook : draw * ratio;
            nonregBook = Math.max(0, nonregBook - basisConsumed);
            withdrawals[type] += draw;
            need -= draw - delta;
          } else {
            withdrawals[type] += take;
          }
        } else {
          const take = Math.min(Math.max(0, available), Math.max(0, need));
          withdrawals[type] += take;
          need -= take; // withdrawal accounts (tfsa) carry no extra tax in v1
        }
      }
      shortfall = Math.max(0, roundCent(need));
      // Expenses absorb the shortfall: the household simply cannot fund the rest.
    }
    // ---- 5c. Fold the charged gains tax into the reported tax and book contributions
    // at par (ACB grows with every fresh dollar that lands in non-reg).
    finalTax = {
      federal: finalTax.federal + nonregGainsTax.federal,
      provincial: finalTax.provincial + nonregGainsTax.provincial,
      surtax: finalTax.surtax + nonregGainsTax.surtax,
      oasClawback: finalTax.oasClawback + nonregGainsTax.oasClawback,
      total: finalTax.total + nonregGainsTax.total,
      taxable: finalTax.taxable + nonregGains,
    };
    nonregBook += contributions.nonreg;

    // ---- 5b. Flows into the accounts (proportional among same-type accounts)
    applyFlows(accounts, withdrawals, contributions);

    // ---- 6. Growth on post-flow balances, each account at its own mix.
    // Non-reg basis grows with the market (Task 14 convention: ACB absorbs the
    // year's growth — book += market x weightedBlended, computed on the
    // value-weighted mix across non-reg accounts).
    const nonregMarketPre = sumType(accounts, "nonreg");
    for (const a of accounts) {
      a.balance = roundCent(
        Math.max(0, a.balance * (1 + a.mix.equity * r.equity + a.mix.bond * r.bond + a.mix.cash * r.cash)),
      );
    }
    const nonregMarketPost = sumType(accounts, "nonreg");
    nonregBook =
      nonregMarketPost === 0
        ? 0
        : roundCent(Math.max(0, nonregBook + nonregMarketPost - nonregMarketPre));

    // Assets: sold this year -> zero; otherwise they appreciate at year end.
    let homeValue = 0;
    let otherAssetValue = 0;
    for (const asset of assetStates) {
      if (soldAssetIds.has(asset.id)) {
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
    rrspRoom = roundCent(
      Math.max(
        0,
        rrspRoomEarn(age, employment, rrspRoom - contributions.rrsp, tables, employerMatch),
      ),
    );

    // ---- 7. Final tax figures + marginal rate (numeric derivative per $100)
    const taxNow = taxForYear(
      {
        employmentIncome: employment,
        otherTaxableIncome: cpp + oas + otherPlan,
        rrspWithdrawals: withdrawals.rrsp,
        pensionEligibleIncome: age >= 65 ? withdrawals.rrsp : 0,
        capitalGains: capitalGains + nonregGains,
        dividendsEligible: 0,
        age,
      },
    );
    const taxPlus = taxForYear(
      {
        employmentIncome: employment,
        otherTaxableIncome: cpp + oas + otherPlan,
        rrspWithdrawals: withdrawals.rrsp + 100,
        pensionEligibleIncome: age >= 65 ? withdrawals.rrsp + 100 : 0,
        capitalGains: capitalGains + nonregGains,
        dividendsEligible: 0,
        age,
      },
    );
    const marginalRate = roundCent4((taxPlus.total - taxNow.total) / 100);

    const netWorth = roundCent(
      sumType(accounts, "tfsa") +
        sumType(accounts, "rrsp") +
        sumType(accounts, "nonreg") +
        cashBalance +
        homeValue -
        debtEnd +
        otherAssetValue,
    );

    const year: YearResult = {
      age,
      income: {
        employment: roundCent(employment),
        cpp: roundCent(cpp),
        oas: roundCent(oas),
        gis: roundCent(gis),
        other: roundCent(otherPlan + employerMatch),
      },
      taxableIncome: roundCent(taxNow.taxable),
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
      },
      contributions: {
        tfsa: roundCent(contributions.tfsa),
        rrsp: roundCent(contributions.rrsp),
        nonreg: roundCent(contributions.nonreg),
      },
      savings: {
        tfsa: roundCent(contributions.tfsa),
        rrsp: roundCent(contributions.rrsp),
        nonreg: roundCent(contributions.nonreg),
        mortgage: roundCent(mortgagePrepay),
      },
      expenses: roundCent(expenses),
      shortfall: roundCent(shortfall),
      balances: {
        tfsa: roundBal(accounts, "tfsa"),
        rrsp: roundBal(accounts, "rrsp"),
        nonreg: roundBal(accounts, "nonreg"),
        cash: roundCent(cashBalance),
        home: roundCent(homeValue),
        otherAssets: roundCent(otherAssetValue),
        debt: roundCent(debtEnd),
      },
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
  };
}

/**
 * Applies the year's withdrawals and contributions across same-type accounts
 * proportionally to their starting balances; fresh contributions (and asset-sale
 * proceeds) land on the first account of the type when the type holds no balance yet.
 */
function applyFlows(
  accounts: AccountState[],
  withdrawals: YearResult["withdrawals"],
  contributions: YearResult["contributions"],
): void {
  const distribute = (total: number, type: AccountPlan["type"], sign: number): void => {
    if (total === 0) return;
    const list = accounts.filter((a) => a.type === type);
    if (list.length === 0) return; // flows toward a non-existent account vanish (v1)
    const sum = list.reduce((s, a) => s + a.balance, 0);
    if (sum <= 0) {
      if (sign > 0) list[0]!.balance += total;
      return;
    }
    for (const a of list) {
      const share = (a.balance / sum) * total;
      a.balance += sign > 0 ? share : -Math.min(share, a.balance);
    }
  };

  distribute(withdrawals.tfsa, "tfsa", -1);
  distribute(contributions.tfsa, "tfsa", 1);
  distribute(withdrawals.rrsp, "rrsp", -1);
  distribute(contributions.rrsp, "rrsp", 1);
  distribute(withdrawals.nonreg, "nonreg", -1);
  distribute(contributions.nonreg, "nonreg", 1);
}

/** Adds external cash (e.g. asset-sale proceeds) to accounts of one type. */
function injectCash(accounts: AccountState[], type: AccountPlan["type"], amount: number): void {
  const list = accounts.filter((a) => a.type === type);
  if (list.length === 0) return;
  const sum = list.reduce((s, a) => s + a.balance, 0);
  if (sum <= 0) {
    list[0]!.balance += amount;
    return;
  }
  for (const a of list) a.balance += (a.balance / sum) * amount;
}
