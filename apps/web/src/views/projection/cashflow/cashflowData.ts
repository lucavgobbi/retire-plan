import type { YearResult } from "@retire-plan/engine";
import { yearForAge } from "../fmt";

export interface CashflowRange {
  startYear: number;
  endYear: number;
}

type Side = "sources" | "uses";
export type FlowKind = "income" | "transfer" | "expense" | "tax" | "debt" | "cash" | "adjustment";
type FlowSpec = readonly [id: string, label: string, kind: FlowKind, amount: number];
type NamedYear = YearResult &
  Required<
    Pick<YearResult, "accountBreakdown" | "incomeBreakdown" | "assetBreakdown" | "expenseBreakdown" | "cashflow">
  >;

export interface CashflowAmount {
  id: string;
  label: string;
  kind: FlowKind;
  cents: number;
}

const toCents = (amount: number) => Math.round(amount * 100);
const sum = (flows: FlowSpec[]) => flows.reduce((total, [, , , amount]) => total + toCents(amount), 0);
const positive = (flows: FlowSpec[]) => flows.filter(([, , , amount]) => amount >= 0);
const reversals = (flows: FlowSpec[]) =>
  flows.flatMap(([id, label, kind, amount]): FlowSpec[] =>
    amount < 0 ? [[`${id}-reversal`, `${label} reversal`, kind, -amount]] : [],
  );
const noCapture: NonNullable<YearResult["cashflow"]> = {
  scheduledMortgagePayment: 0,
  openingIdleCash: 0,
  closingIdleCash: 0,
  assetSaleToIdleCash: 0,
  assetSaleToNonreg: 0,
  employerRrspMatch: 0,
  cashContributionsToIdleCash: 0,
};

const accountLabels = { tfsa: "TFSA", rrsp: "RRSP", nonreg: "Non-registered account", cash: "Cash account" };
const incomeLabels = { employment: "Employment", cpp: "CPP", oas: "OAS", other: "Other income" };

function hasNamedCashflow(row: YearResult): row is NamedYear {
  return (
    row.accountBreakdown !== undefined &&
    row.incomeBreakdown !== undefined &&
    row.assetBreakdown !== undefined &&
    row.expenseBreakdown !== undefined &&
    row.cashflow !== undefined
  );
}

function identifyItems<T extends { id: string; name?: string; sourceIndex?: number }>(
  items: T[],
  categoryOf: (item: T) => string,
) {
  const occurrences = new Map<string, number>();
  return items.map((item) => {
    if (item.sourceIndex !== undefined)
      return { ...item, flowId: `plan:${JSON.stringify([item.id, item.sourceIndex])}` };
    const identity = JSON.stringify([item.id, categoryOf(item), item.name?.trim()]);
    const occurrence = (occurrences.get(identity) ?? 0) + 1;
    occurrences.set(identity, occurrence);
    return { ...item, flowId: `${identity}:${occurrence}` };
  });
}

function itemFlow(category: string, item: { flowId: string }, label: string, kind: FlowKind, amount: number): FlowSpec {
  return [`named:${category}:${item.flowId}`, label, kind, amount];
}

function splitFlow(original: FlowSpec, items?: FlowSpec[]): FlowSpec[] {
  if (items === undefined) return [original];
  let sum = 0;
  let allocated = 0;
  const rounded = items.map(([id, label, kind, amount]): FlowSpec => {
    sum += amount;
    // Expenses are captured before rounding. Other items already report the
    // actual cents routed by the engine, so leave those amounts intact.
    const cents = original[0] === "expenses" ? toCents(sum) - allocated : toCents(amount);
    allocated += cents;
    return [id, label, kind, cents / 100];
  });
  const difference = toCents(original[3]) - allocated;
  if (difference !== 0) {
    const [id, label] = original;
    const detail = Math.abs(difference) === 1 ? "rounding" : "unattributed";
    rounded.push([`named-gap:${id}:${detail}`, `${label} (${detail} difference)`, "adjustment", difference / 100]);
  }
  return rounded;
}

function namedFlows(row: NamedYear) {
  const income = identifyItems(row.incomeBreakdown, (item) => item.kind);
  const accounts = identifyItems(row.accountBreakdown, (item) => item.type);
  const accountNames = accounts.map((item) => ({
    id: item.flowId,
    label: item.name?.trim() || accountLabels[item.type],
  }));
  const distinctAccountNames = disambiguatedLabels(accountNames);
  const accountName = (item: (typeof accounts)[number]) =>
    distinctAccountNames.get(item.flowId) ?? (item.name?.trim() || accountLabels[item.type]);
  const expenses = identifyItems(row.expenseBreakdown, () => "expense").map((item) =>
    itemFlow("expense", item, item.name?.trim() || "Expense", "expense", item.amount),
  );
  const sales = identifyItems(row.assetBreakdown, (item) => item.kind).filter((item) => item.sale !== undefined);
  const saleFlow = (item: (typeof sales)[number]): FlowSpec =>
    itemFlow(
      "asset-sale",
      item,
      `${item.name?.trim() || (item.kind === "primary-home" ? "Primary home" : "Asset")} sale`,
      "cash",
      item.sale?.proceeds ?? 0,
    );
  const mortgage = row.mortgageBreakdown && {
    ...row.mortgageBreakdown,
    flowId: JSON.stringify(row.mortgageBreakdown.id),
  };

  return {
    sources: new Map<string, FlowSpec[]>([
      ...Object.keys(incomeLabels).map((kind): [string, FlowSpec[]] => [
        kind,
        income
          .filter((item) => item.kind === kind)
          .map((item) => itemFlow("income", item, item.name?.trim() || incomeLabels[item.kind], "income", item.amount)),
      ]),
      ...Object.keys(accountLabels).map((type): [string, FlowSpec[]] => [
        `${type}-withdrawal`,
        accounts
          .filter((item) => item.type === type)
          .map((item) =>
            itemFlow("withdrawal", item, `${accountName(item)} withdrawals`, "transfer", item.withdrawals),
          ),
      ]),
      ["asset-sales", sales.filter((item) => item.sale?.destination === "idleCash").map(saleFlow)],
    ]),
    bills: new Map<string, FlowSpec[]>([
      ["expenses", expenses],
      [
        "scheduled-mortgage",
        mortgage
          ? [itemFlow("mortgage-payment", mortgage, "Mortgage payments", "debt", mortgage.scheduledPayment)]
          : [],
      ],
    ]),
    uses: new Map<string, FlowSpec[]>([
      ...Object.keys(accountLabels).map((type): [string, FlowSpec[]] => [
        `${type}-contribution`,
        accounts
          .filter((item) => item.type === type)
          .map((item) =>
            itemFlow(
              "contribution",
              item,
              `${accountName(item)} contributions`,
              "transfer",
              item.contributions -
                (item.employerRrspMatch ?? 0) -
                (item.employerRrspContribution ?? 0) -
                (item.employmentRrspPersonal ?? 0),
            ),
          ),
      ]),
      [
        "employment-rrsp-personal",
        accounts.flatMap((item) =>
          item.employmentRrspPersonal
            ? [
                itemFlow(
                  "employment-rrsp-personal",
                  item,
                  `Personal employment deposit → ${accountName(item)}`,
                  "transfer",
                  item.employmentRrspPersonal,
                ),
              ]
            : [],
        ),
      ],
      [
        "mortgage-prepay",
        mortgage
          ? [itemFlow("mortgage-prepayment", mortgage, "Mortgage prepayments", "debt", mortgage.prepayment)]
          : [],
      ],
    ]),
    matches: accounts
      .filter((item) => item.employerRrspMatch)
      .map((item) =>
        itemFlow("match", item, `Employer match → ${accountName(item)}`, "transfer", item.employerRrspMatch ?? 0),
      ),
    employerContributions: accounts
      .filter((item) => item.employerRrspContribution)
      .map((item) =>
        itemFlow(
          "employer-contribution",
          item,
          `Company RRSP contribution → ${accountName(item)}`,
          "transfer",
          item.employerRrspContribution ?? 0,
        ),
      ),
    directSales: sales.filter((item) => item.sale?.destination === "nonreg").map(saleFlow),
    saleDeposits: accounts
      .filter((item) => item.assetSaleDeposit)
      .map((item) => itemFlow("asset-sale-deposit", item, accountName(item), "transfer", item.assetSaleDeposit ?? 0)),
  };
}

function disambiguatedLabels(items: { id: string; label: string }[]) {
  const idsByLabel = new Map<string, Set<string>>();
  for (const { id, label } of items) {
    const ids = idsByLabel.get(label) ?? new Set();
    ids.add(id);
    idsByLabel.set(label, ids);
  }
  const used = new Set(idsByLabel.keys());
  const labels = new Map<string, string>();
  for (const [label, ids] of idsByLabel) {
    if (ids.size < 2) continue;
    let index = 1;
    for (const id of ids) {
      let candidate = `${label} (${index++})`;
      while (used.has(candidate)) candidate = `${label} (${index++})`;
      used.add(candidate);
      labels.set(id, candidate);
    }
  }
  return labels;
}

export function cashflowYears(years: YearResult[], birthYear: number): number[] {
  return [...new Set(years.map(({ age }) => yearForAge(birthYear, age)).filter(Number.isSafeInteger))].sort(
    (a, b) => a - b,
  );
}

/** Aggregate recorded transfers through one pool without assigning individual sources to uses. */
export function aggregateCashflow(years: YearResult[], birthYear: number, range: CashflowRange, showAccounts = false) {
  const rows = years
    .map((row) => ({ row, year: yearForAge(birthYear, row.age) }))
    .filter(({ year }) => year >= range.startYear && year <= range.endYear)
    .sort((a, b) => a.year - b.year);
  const sides = { sources: new Map<string, CashflowAmount>(), uses: new Map<string, CashflowAmount>() };
  const obligations = new Map<string, CashflowAmount>();
  const matches = new Map<string, CashflowAmount>();
  const employerContributions = new Map<string, CashflowAmount>();
  const directSales = new Map<string, CashflowAmount>();
  const saleDeposits = new Map<string, CashflowAmount>();
  const named = showAccounts && rows.every(({ row }) => hasNamedCashflow(row));
  let legacyYears = 0;
  let missingPayrollYears = 0;
  let unavailableYears = 0;
  let assetSaleToNonreg = 0;
  let cashContributionsToIdleCash = 0;
  let employerRrspMatch = 0;
  let employerRrspContribution = 0;
  let shortfallCents = 0;
  let unknownCoverageYears = 0;
  let categoryOffsetCents = 0;
  let unreconciledSourceCents = 0;
  let unreconciledUseCents = 0;

  function add(side: Side, [id, label, kind, amount]: FlowSpec, list?: Map<string, CashflowAmount>) {
    const cents = toCents(amount);
    if (cents === 0 && (!named || !id.startsWith("named:"))) return;
    const target = cents >= 0 ? side : side === "sources" ? "uses" : "sources";
    const key = cents >= 0 ? id : `${id}-reversal`;
    const items = list ?? sides[target];
    const previous = items.get(key)?.cents ?? 0;
    items.set(key, {
      id: key,
      label: cents >= 0 ? label : `${label} reversal`,
      kind,
      cents: previous + Math.abs(cents),
    });
  }

  const entries = rows.map(({ row, year }) => {
    const capture = row.cashflow;
    const captured = capture ?? noCapture;
    const employerDeposits = captured.employerRrspMatch + (captured.employerRrspContribution ?? 0);
    const { income, withdrawals, contributions, savings, payroll } = row;
    const recordedSources: FlowSpec[] = [
      ["employment", "Employment", "income", income.employment],
      ["cpp", "CPP", "income", income.cpp],
      ["oas", "OAS", "income", income.oas],
      ["gis", "GIS", "income", income.gis],
      [
        capture ? "other" : "legacy-other",
        capture ? "Other income" : "Other income (saved total)",
        "income",
        income.other - employerDeposits,
      ],
      ["tfsa-withdrawal", "TFSA withdrawals", "transfer", withdrawals.tfsa],
      ["rrsp-withdrawal", "RRSP / RRIF withdrawals", "transfer", withdrawals.rrsp],
      ["nonreg-withdrawal", "Non-registered withdrawals", "transfer", withdrawals.nonreg],
      ["cash-withdrawal", "Cash account withdrawals", "transfer", withdrawals.cash ?? 0],
      ["asset-sales", "Asset sales to idle cash", "cash", captured.assetSaleToIdleCash],
    ];
    const recordedBills: FlowSpec[] = [
      ["expenses", "Modeled expenses", "expense", row.expenses],
      ["income-tax", "Income tax", "tax", row.tax.total],
      ["payroll", "Net payroll deductions", "tax", payroll ? payroll.total - payroll.eiRefund : 0],
      ["scheduled-mortgage", "Scheduled mortgage payments", "debt", captured.scheduledMortgagePayment],
    ];
    const recordedUses: FlowSpec[] = [
      ["mortgage-prepay", "Mortgage prepayments", "debt", savings.mortgage],
      ["tfsa-contribution", "TFSA contributions", "transfer", contributions.tfsa],
      [
        capture ? "rrsp-contribution" : "legacy-rrsp-contribution",
        capture ? "RRSP contributions" : "RRSP deposits (saved total)",
        "transfer",
        contributions.rrsp - employerDeposits - (captured.employmentRrspPersonal ?? 0),
      ],
      [
        "employment-rrsp-personal",
        "Personal employment RRSP deposits",
        "transfer",
        captured.employmentRrspPersonal ?? 0,
      ],
      ["nonreg-contribution", "Non-registered contributions", "transfer", contributions.nonreg],
      [
        "cash-contribution",
        "Cash contributions",
        "transfer",
        (contributions.cash ?? 0) - captured.cashContributionsToIdleCash,
      ],
    ];
    const items = named && hasNamedCashflow(row) ? namedFlows(row) : undefined;
    const split = (flows: FlowSpec[], breakdown?: Map<string, FlowSpec[]>) =>
      flows.flatMap((flow) => splitFlow(flow, breakdown?.get(flow[0])));
    const sourceItems = split(recordedSources, items?.sources);
    const billItems = split(recordedBills, items?.bills);
    const uses = split(recordedUses, items?.uses);
    const sources = [...positive(sourceItems), ...reversals(billItems)];
    const bills = [...positive(billItems), ...reversals(sourceItems)];
    const shortfall = toCents(row.shortfall);
    // Categories net opposite-signed items before routing. Named ribbons show
    // both sides of those offsets, while the period summary retains the net.
    const categoryOffsets =
      items && (shortfall === 0 || payroll !== undefined)
        ? sum(sources) +
          sum(reversals(uses)) -
          sum(positive(recordedSources)) -
          sum(reversals(recordedBills)) -
          sum(reversals(recordedUses))
        : 0;
    const valid =
      Number.isSafeInteger(shortfall) &&
      shortfall >= 0 &&
      [
        ...recordedSources,
        ...recordedBills,
        ...recordedUses,
        ...sourceItems,
        ...billItems,
        ...uses,
        ...(items?.matches ?? []),
        ...(items?.employerContributions ?? []),
        ...(items?.directSales ?? []),
        ...(items?.saleDeposits ?? []),
      ].every(([, , , amount]) => Number.isSafeInteger(toCents(amount))) &&
      Object.values(captured).every((amount) => Number.isSafeInteger(toCents(amount)));
    return {
      year,
      capture,
      hasPayroll: payroll !== undefined,
      sources,
      bills,
      uses,
      shortfall,
      categoryOffsets,
      valid,
      items,
    };
  });

  entries.forEach(
    ({ year, capture, hasPayroll, sources, bills, uses, shortfall, categoryOffsets, valid, items }, index) => {
      if (!valid) {
        unavailableYears += 1;
        return;
      }
      sources.forEach((flow) => add("sources", flow));
      uses.forEach((flow) => add("uses", flow));
      const totalBills = sum(bills);
      shortfallCents += shortfall;
      categoryOffsetCents += categoryOffsets;
      bills.forEach((flow) => add("uses", flow, obligations));
      let coveredBills = totalBills;
      if (shortfall > 0) {
        // The annual gap is known. Preserve modeled bill totals in the text breakdown
        // and display their covered amount as a group so no bill gets a guessed allocation.
        if (capture && hasPayroll) {
          coveredBills = Math.max(0, totalBills - shortfall);
          add("uses", ["covered-bills", "Covered obligations", "expense", coveredBills / 100]);
        } else {
          unknownCoverageYears += 1;
          coveredBills = 0;
        }
      } else {
        bills.forEach((flow) => add("uses", flow));
      }
      if (!hasPayroll) missingPayrollYears += 1;

      if (capture) {
        assetSaleToNonreg += toCents(capture.assetSaleToNonreg);
        cashContributionsToIdleCash += toCents(capture.cashContributionsToIdleCash);
        employerRrspMatch += toCents(capture.employerRrspMatch);
        employerRrspContribution += toCents(capture.employerRrspContribution ?? 0);
        items?.matches.forEach((flow) => add("uses", flow, matches));
        items?.employerContributions.forEach((flow) => add("uses", flow, employerContributions));
        items?.directSales.forEach((flow) => add("sources", flow, directSales));
        items?.saleDeposits.forEach((flow) => add("uses", flow, saleDeposits));
        const previous = entries[index - 1];
        const next = entries[index + 1];
        // A carried balance counts only where the neighboring row cannot cancel it.
        if (
          !previous?.valid ||
          previous.year !== year - 1 ||
          previous.capture?.closingIdleCash !== capture.openingIdleCash
        ) {
          add("sources", ["opening-cash", "Idle cash brought forward", "cash", capture.openingIdleCash]);
        }
        if (!next?.valid || next.year !== year + 1 || next.capture?.openingIdleCash !== capture.closingIdleCash) {
          add("uses", ["closing-cash", "Idle cash carried forward", "cash", capture.closingIdleCash]);
        }
      } else {
        legacyYears += 1;
      }

      const difference =
        sum(sources) -
        sum(uses) -
        coveredBills +
        toCents(capture?.openingIdleCash ?? 0) -
        toCents(capture?.closingIdleCash ?? 0);
      if (difference === 0) return;
      if (capture && hasPayroll && Math.abs(difference) <= 5) {
        add(difference > 0 ? "uses" : "sources", [
          "rounding",
          "Rounding adjustment",
          "adjustment",
          Math.abs(difference) / 100,
        ]);
      } else if (difference > 0) {
        unreconciledSourceCents += difference;
      } else {
        unreconciledUseCents -= difference;
      }
    },
  );

  const sources = [...sides.sources.values()];
  const uses = [...sides.uses.values()];
  const obligationItems = [...obligations.values()];
  const matchItems: CashflowAmount[] =
    matches.size > 0
      ? [...matches.values()]
      : employerRrspMatch > 0
        ? [{ id: "employer-match", label: "Employer match → RRSP", kind: "transfer", cents: employerRrspMatch }]
        : [];
  const employerContributionItems: CashflowAmount[] =
    employerContributions.size > 0
      ? [...employerContributions.values()]
      : employerRrspContribution > 0
        ? [
            {
              id: "employer-contribution",
              label: "Company RRSP contribution → RRSP",
              kind: "transfer",
              cents: employerRrspContribution,
            },
          ]
        : [];
  const directSaleItems = [...directSales.values()];
  const saleDepositItems = [...saleDeposits.values()];
  const allItems = [
    ...sources,
    ...uses,
    ...obligationItems,
    ...matchItems,
    ...employerContributionItems,
    ...directSaleItems,
    ...saleDepositItems,
  ];
  if (named) {
    const labels = disambiguatedLabels(allItems);
    allItems.forEach((item) => {
      item.label = labels.get(item.id) ?? item.label;
    });
  }
  const sumItems = (items: CashflowAmount[]) => items.reduce((total, item) => total + item.cents, 0);
  return {
    sources,
    uses,
    obligations: obligationItems,
    named,
    namedUnavailable: showAccounts && !named,
    hasNamedGaps: allItems.some(({ id }) => id.startsWith("named-gap:")),
    categoryOffsetCents,
    matches: matchItems,
    employerContributions: employerContributionItems,
    directSales: directSaleItems,
    saleDeposits: saleDepositItems,
    sourceCents: sumItems(sources),
    useCents: sumItems(uses),
    shortfallCents,
    unknownCoverageYears,
    unreconciledSourceCents,
    unreconciledUseCents,
    legacyYears,
    missingPayrollYears,
    unavailableYears,
    assetSaleToNonreg,
    cashContributionsToIdleCash,
    employerRrspMatch,
  };
}
