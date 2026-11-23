import { Fragment } from "react";
import type { YearResult } from "@retire-plan/engine";
import { fmtMoneyDetail } from "./fmt";
import { yearNotices } from "./yearNotices";

const accountLabels = { tfsa: "TFSA", rrsp: "RRSP", nonreg: "Non-registered account", cash: "Cash account" };
const incomeLabels = { employment: "Employment", cpp: "CPP", oas: "OAS", gis: "GIS", other: "Other income" };
type EmployerDeposits = Pick<NonNullable<YearResult["cashflow"]>, "employerRrspContribution"> & {
  employerRrspMatch?: number;
};

function withoutEmployerDeposits(amount: number, deposits: EmployerDeposits) {
  return (
    (Math.round(amount * 100) -
      Math.round((deposits.employerRrspContribution ?? 0) * 100) -
      Math.round((deposits.employerRrspMatch ?? 0) * 100)) /
    100
  );
}

function namedItems<T extends { id: string; name?: string; sourceIndex?: number }>(
  section: string,
  items: T[],
  categoryFor: (item: T) => string,
  reservedLabels: readonly string[] = [],
) {
  const occurrences = new Map<string, number>();
  const categoryCounts = new Map<string, number>();
  const labelCounts = new Map<string, number>(reservedLabels.map((label) => [label, 1]));
  const rows = items.map((item) => {
    const category = categoryFor(item);
    const identity = [section, item.id, item.sourceIndex];
    const identityKey = JSON.stringify(identity);
    const occurrence = (occurrences.get(identityKey) ?? 0) + 1;
    const ordinal = (categoryCounts.get(category) ?? 0) + 1;
    occurrences.set(identityKey, occurrence);
    categoryCounts.set(category, ordinal);
    const fallback = `${category} ${ordinal}`;
    const name = item.name?.trim();
    const label = name || fallback;
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
    return { item, key: JSON.stringify([...identity, occurrence]), label, qualifier: name ? fallback : "unnamed" };
  });
  const usedLabels = new Set(labelCounts.keys());
  return rows.map(({ item, key, label, qualifier }) => {
    if (labelCounts.get(label) === 1) return { item, key, label };
    let unique = `${label} (${qualifier})`;
    let suffix = 2;
    while (usedLabels.has(unique)) unique = `${label} (${qualifier}, ${suffix++})`;
    usedLabels.add(unique);
    return { item, key, label: unique };
  });
}

function IncomeDetails({ year }: { year: YearResult }) {
  const match = year.cashflow?.employerRrspMatch ?? 0;
  const companyContribution = year.cashflow?.employerRrspContribution ?? 0;
  const hasGis = year.income.gis !== 0;
  return (
    <section className="detail-section" aria-label="Income">
      <h4>Income</h4>
      {year.incomeBreakdown === undefined ? (
        <dl className="detail-values">
          {Object.entries(year.income).map(([kind, amount]) => (
            <Fragment key={kind}>
              <dt>{incomeLabels[kind as keyof typeof incomeLabels]}</dt>
              <dd>
                {fmtMoneyDetail(
                  kind === "other" && year.cashflow ? withoutEmployerDeposits(amount, year.cashflow) : amount,
                )}
              </dd>
            </Fragment>
          ))}
          {match !== 0 && (
            <>
              <dt>Employer RRSP match</dt>
              <dd>{fmtMoneyDetail(match)}</dd>
            </>
          )}
          {companyContribution !== 0 && (
            <>
              <dt>Company RRSP contribution</dt>
              <dd>{fmtMoneyDetail(companyContribution)}</dd>
            </>
          )}
        </dl>
      ) : (
        <>
          {year.incomeBreakdown.length === 0 && !hasGis && <p className="hint">No income streams in this year.</p>}
          <ul className="expense-list">
            {namedItems(
              "income",
              year.incomeBreakdown,
              (item) => incomeLabels[item.kind],
              hasGis ? [incomeLabels.gis] : [],
            ).map(({ item, key, label }) => (
              <li key={key}>
                <span>{label}</span>
                <span>{fmtMoneyDetail(item.amount)}</span>
              </li>
            ))}
            {hasGis && (
              <li>
                <span>{incomeLabels.gis}</span>
                <span>{fmtMoneyDetail(year.income.gis)}</span>
              </li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}

function ExpenseDetails({ year }: { year: YearResult }) {
  const items = year.expenseBreakdown;
  // Round the running total so the visible item amounts add up to the annual total.
  let total = 0;
  let rounded = 0;
  return (
    <section className="detail-section" aria-label="Expenses">
      <h4>Expenses</h4>
      {items === undefined ? (
        <p className="hint">Per-expense details were not recorded for this saved result.</p>
      ) : items.length === 0 ? (
        <p className="hint">No expenses in this year.</p>
      ) : (
        <ul className="expense-list">
          {namedItems("expense", items, () => "Expense").map(({ item, key, label }) => {
            total += item.amount;
            const cents = Math.round(total * 100);
            const amount = (cents - rounded) / 100;
            rounded = cents;
            return (
              <li key={key}>
                <span>{label}</span>
                <span>{fmtMoneyDetail(amount)}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="detail-expense-total">
        <strong>Modelled annual total</strong>
        <strong>{fmtMoneyDetail(year.expenses)}</strong>
      </p>
    </section>
  );
}

function RrspContributionDetails({ total, deposits }: { total: number; deposits: EmployerDeposits }) {
  return (
    <>
      <dt>Personal RRSP deposits within contributions</dt>
      <dd>{fmtMoneyDetail(withoutEmployerDeposits(total, deposits))}</dd>
      <dt>Company RRSP contribution within contributions</dt>
      <dd>{fmtMoneyDetail(deposits.employerRrspContribution ?? 0)}</dd>
      <dt>Employer match within contributions</dt>
      <dd>{fmtMoneyDetail(deposits.employerRrspMatch ?? 0)}</dd>
    </>
  );
}

function AccountDetails({ year }: { year: YearResult }) {
  const drawsByType = new Map<keyof typeof accountLabels, number>();
  for (const account of year.accountBreakdown ?? []) {
    drawsByType.set(account.type, (drawsByType.get(account.type) ?? 0) + Math.round(account.withdrawals * 100));
  }
  const adjustments = (Object.keys(accountLabels) as (keyof typeof accountLabels)[]).flatMap((type) => {
    const difference = Math.round((year.withdrawals[type] ?? 0) * 100) - (drawsByType.get(type) ?? 0);
    return difference === 0 ? [] : [{ type, amount: difference / 100 }];
  });
  return (
    <section className="detail-section" aria-label="Savings flows">
      <h4>Savings flows</h4>
      {year.accountBreakdown === undefined ? (
        <dl className="detail-values">
          <dt>TFSA</dt>
          <dd>{fmtMoneyDetail(year.savings.tfsa)}</dd>
          <dt>RRSP</dt>
          <dd>{fmtMoneyDetail(year.savings.rrsp)}</dd>
          {year.cashflow && year.savings.rrsp !== 0 && (
            <RrspContributionDetails total={year.savings.rrsp} deposits={year.cashflow} />
          )}
          <dt>Non-registered</dt>
          <dd>{fmtMoneyDetail(year.savings.nonreg)}</dd>
          <dt>Cash accounts</dt>
          <dd>{fmtMoneyDetail(year.savings.cash ?? 0)}</dd>
          <dt>Mortgage</dt>
          <dd>{fmtMoneyDetail(year.savings.mortgage)}</dd>
          {Object.entries(year.withdrawals)
            .filter(([, amount]) => amount !== 0)
            .map(([type, amount]) => (
              <Fragment key={type}>
                <dt>{accountLabels[type as keyof typeof accountLabels]} withdrawals</dt>
                <dd>{fmtMoneyDetail(amount)}</dd>
              </Fragment>
            ))}
        </dl>
      ) : (
        <>
          {year.accountBreakdown.length === 0 && <p className="hint">No accounts in this run.</p>}
          {year.accountBreakdown.length > 0 && (
            <ul aria-label="Account details">
              {namedItems("account", year.accountBreakdown, (item) => accountLabels[item.type]).map(
                ({ item, key, label }) => (
                  <li key={key}>
                    <strong>{label}</strong>
                    <dl className="detail-values">
                      <dt>Opening balance</dt>
                      <dd>{fmtMoneyDetail(item.openingBalance)}</dd>
                      <dt>Withdrawals</dt>
                      <dd>{fmtMoneyDetail(item.withdrawals)}</dd>
                      <dt>Contributions</dt>
                      <dd>{fmtMoneyDetail(item.contributions)}</dd>
                      {item.type === "rrsp" &&
                        item.contributions !== 0 &&
                        (year.cashflow ||
                          item.employerRrspContribution !== undefined ||
                          item.employerRrspMatch !== undefined) && (
                          <RrspContributionDetails total={item.contributions} deposits={item} />
                        )}
                      {item.assetSaleDeposit !== undefined && (
                        <>
                          <dt>Asset sale deposits</dt>
                          <dd>{fmtMoneyDetail(item.assetSaleDeposit)}</dd>
                        </>
                      )}
                      {item.cashInterest !== undefined && (
                        <>
                          <dt>Cash interest</dt>
                          <dd>{fmtMoneyDetail(item.cashInterest)}</dd>
                        </>
                      )}
                      <dt>Closing balance</dt>
                      <dd>{fmtMoneyDetail(item.closingBalance)}</dd>
                    </dl>
                  </li>
                ),
              )}
            </ul>
          )}
          {(!!year.cashflow?.cashContributionsToIdleCash || adjustments.length > 0) && (
            <dl className="detail-values">
              {!!year.cashflow?.cashContributionsToIdleCash && (
                <>
                  <dt>Idle cash contributions</dt>
                  <dd>{fmtMoneyDetail(year.cashflow.cashContributionsToIdleCash)}</dd>
                </>
              )}
              {adjustments.map(({ type, amount }) => (
                <Fragment key={type}>
                  <dt>{accountLabels[type]} withdrawal reconciliation</dt>
                  <dd>{fmtMoneyDetail(amount)}</dd>
                </Fragment>
              ))}
            </dl>
          )}
          {adjustments.length > 0 && (
            <p className="hint">Category withdrawals can differ from the total applied to accounts.</p>
          )}
        </>
      )}
    </section>
  );
}

function NetWorthDetails({ year }: { year: YearResult }) {
  const mortgage = year.mortgageBreakdown;
  return (
    <section className="detail-section" aria-label="Net worth breakdown">
      <h4>Net worth breakdown</h4>
      <dl className="detail-values">
        {year.accountBreakdown === undefined ? (
          <>
            <dt>TFSA</dt>
            <dd>{fmtMoneyDetail(year.balances.tfsa)}</dd>
            <dt>RRSP</dt>
            <dd>{fmtMoneyDetail(year.balances.rrsp)}</dd>
            <dt>Non-registered</dt>
            <dd>{fmtMoneyDetail(year.balances.nonreg)}</dd>
            <dt>{year.cashAccounts === undefined ? "Cash reserve" : "Total cash (accounts + reserve)"}</dt>
            <dd>{fmtMoneyDetail(year.balances.cash)}</dd>
          </>
        ) : (
          <>
            {namedItems("account", year.accountBreakdown, (item) => accountLabels[item.type]).map(
              ({ item, key, label }) => (
                <Fragment key={key}>
                  <dt>{label}</dt>
                  <dd>{fmtMoneyDetail(item.closingBalance)}</dd>
                </Fragment>
              ),
            )}
            {year.cashflow && (
              <>
                <dt>Idle cash reserve</dt>
                <dd>{fmtMoneyDetail(year.cashflow.closingIdleCash)}</dd>
              </>
            )}
          </>
        )}
        {year.assetBreakdown === undefined ? (
          <>
            <dt>Other assets</dt>
            <dd>{fmtMoneyDetail(year.balances.otherAssets ?? 0)}</dd>
            <dt>Home</dt>
            <dd>{fmtMoneyDetail(year.balances.home)}</dd>
          </>
        ) : (
          namedItems("asset", year.assetBreakdown, (item) =>
            item.kind === "primary-home" ? "Primary home" : "Asset",
          ).map(({ item, key, label }) => (
            <Fragment key={key}>
              <dt>{label}</dt>
              <dd>{fmtMoneyDetail(item.closingBalance)}</dd>
              {item.sale && (
                <>
                  <dt>
                    {label} sale proceeds to{" "}
                    {item.sale.destination === "idleCash" ? "idle cash" : "non-registered accounts"}
                  </dt>
                  <dd>{fmtMoneyDetail(item.sale.proceeds)}</dd>
                </>
              )}
            </Fragment>
          ))
        )}
        {mortgage ? (
          <>
            <dt>Mortgage opening balance</dt>
            <dd>{fmtMoneyDetail(mortgage.openingBalance)}</dd>
            <dt>Mortgage scheduled payments</dt>
            <dd>{fmtMoneyDetail(mortgage.scheduledPayment)}</dd>
            <dt>Mortgage prepayment</dt>
            <dd>{fmtMoneyDetail(mortgage.prepayment)}</dd>
            <dt>Mortgage closing balance</dt>
            <dd>{fmtMoneyDetail(mortgage.closingBalance)}</dd>
          </>
        ) : (
          year.accountBreakdown === undefined && (
            <>
              <dt>Debt</dt>
              <dd>{fmtMoneyDetail(year.balances.debt)}</dd>
            </>
          )
        )}
        <dt className="detail-total-label">Net worth</dt>
        <dd className="detail-total">{fmtMoneyDetail(year.netWorth)}</dd>
      </dl>
      {year.accountBreakdown === undefined && !!year.cashAccounts?.length && (
        <>
          <p className="hint">Named account balances are included in total cash above.</p>
          <ul className="cash-account-balances" aria-label="Named cash account balances">
            {namedItems("cash", year.cashAccounts, () => "Cash account").map(({ item, key, label }) => (
              <li key={key}>
                {label} {fmtMoneyDetail(item.balance)}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Bullet summary of a year's audit counts — cell inside the dense table. */
export function EventsCell({ year }: { year: YearResult }) {
  const events = year.events.length;
  const warnings = year.warnings.length;
  return (
    <td className="events-cell" title={`${events} events, ${warnings} warnings`}>
      {events > 0 && <span title={year.events.join(" · ")}>⚡{events} </span>}
      {warnings > 0 && <span title={year.warnings.join(" · ")}>⚠{warnings}</span>}
      {events === 0 && warnings === 0 && <span className="hint">—</span>}
    </td>
  );
}

/** Expandable audit-trail row: full events[], warnings[] and per-year flow components. */
export function YearDetailRow({
  age,
  year,
  expanded,
  groupExpanded = true,
  colSpan,
  householdCalendarYear,
  historicalReturnYear,
}: {
  age: number;
  year: YearResult;
  expanded: boolean;
  groupExpanded?: boolean;
  colSpan: number;
  householdCalendarYear?: number;
  historicalReturnYear?: number;
}) {
  const notices = yearNotices(
    year,
    householdCalendarYear !== undefined && historicalReturnYear !== undefined
      ? { householdCalendarYear, returnSourceYear: historicalReturnYear }
      : undefined,
  );
  return (
    <tr
      id={`projection-year-detail-${age}`}
      className="detail-row"
      data-detail-for={age}
      data-expanded={expanded ? "true" : "false"}
      data-group-collapsed={!groupExpanded ? "true" : undefined}
    >
      <td colSpan={colSpan}>
        {/* Bounded, compact card container: the td still spans the table, but the
          detail cards form a width-bounded responsive cluster instead of a full-width
          many-column table (user item 2). */}
        <div className="detail-wrap">
          <div className="detail-grid">
            <section className="detail-section" aria-label="Events">
              <h4>Events</h4>
              {year.events.length === 0 ? (
                <p className="hint">No events</p>
              ) : (
                <ul>
                  {year.events.map((event, index) => (
                    <li key={`e${index}`}>{event}</li>
                  ))}
                </ul>
              )}
            </section>
            <section className="detail-section" aria-label="Warnings">
              <h4>Warnings</h4>
              {year.warnings.length === 0 ? (
                <p className="hint">No warnings</p>
              ) : (
                <ul>
                  {year.warnings.map((warning, index) => (
                    <li key={`w${index}`}>{warning}</li>
                  ))}
                </ul>
              )}
              {notices.length > 0 && (
                <div className="detail-notices" role="note" aria-label="Year cashflow explanations">
                  {notices.map((notice, index) => (
                    <p key={`n${index}`}>{notice}</p>
                  ))}
                </div>
              )}
              {(year.accountBreakdown === undefined ||
                year.incomeBreakdown === undefined ||
                year.assetBreakdown === undefined ||
                year.expenseBreakdown === undefined) && (
                <p className="hint">Run the projection again to see the full account and item breakdown.</p>
              )}
            </section>
            <IncomeDetails year={year} />
            <ExpenseDetails year={year} />
            <AccountDetails year={year} />
            <section className="detail-section" aria-label="Payroll deductions">
              <h4>Payroll deductions</h4>
              {year.payroll === undefined ? (
                <p className="hint">
                  No payroll breakdown was recorded for this saved result. Re-run the projection to see payroll
                  deductions.
                </p>
              ) : year.payroll.total === 0 ? (
                <p className="hint">No employee payroll deductions were withheld this year.</p>
              ) : (
                <dl className="detail-values">
                  <dt>Cash employment income</dt>
                  <dd>{fmtMoneyDetail(year.income.employment)}</dd>
                  <dt>CPP base</dt>
                  <dd>{fmtMoneyDetail(year.payroll.cppBase)}</dd>
                  <dt>CPP additional</dt>
                  <dd>{fmtMoneyDetail(year.payroll.cppAdditional)}</dd>
                  <dt>CPP2</dt>
                  <dd>{fmtMoneyDetail(year.payroll.cpp2)}</dd>
                  <dt>EI</dt>
                  <dd>{fmtMoneyDetail(year.payroll.ei)}</dd>
                  <dt>EI refund</dt>
                  <dd>{fmtMoneyDetail(year.payroll.eiRefund)}</dd>
                  <dt className="detail-total-label">Total withheld</dt>
                  <dd className="detail-total">{fmtMoneyDetail(year.payroll.total)}</dd>
                </dl>
              )}
              {year.payroll !== undefined && year.payroll.total > 0 && (
                <p className="hint">
                  Base CPP contributions and eligible EI premiums earn non-refundable tax credits; the enhanced CPP
                  portion ({fmtMoneyDetail(year.payroll.enhancedCppDeduction)}) is deducted from taxable income.
                  Employee, single-employer annual approximation — EI benefits, CPP pension accrual and post-retirement
                  benefit (PRB) increases are not calculated.
                </p>
              )}
              {year.payroll && !!(year.cashflow?.employerRrspContribution || year.cashflow?.employerRrspMatch) && (
                <p className="hint">
                  In new projections, company RRSP contributions and employer matches count toward earnings for enabled
                  CPP and EI calculations. The model assumes the group RRSP permits withdrawals.
                </p>
              )}
            </section>
            <NetWorthDetails year={year} />
          </div>
        </div>
      </td>
    </tr>
  );
}
