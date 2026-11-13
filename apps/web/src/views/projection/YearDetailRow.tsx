import type { YearResult } from "@retire-plan/engine";
import { fmtMoneyDetail } from "./fmt";
import { yearNotices } from "./yearNotices";

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
  const notices = yearNotices(year, householdCalendarYear !== undefined && historicalReturnYear !== undefined
    ? { householdCalendarYear, returnSourceYear: historicalReturnYear }
    : undefined);
  return (
    <tr className="detail-row" data-detail-for={age} data-expanded={expanded ? "true" : "false"} data-group-collapsed={!groupExpanded ? "true" : undefined}>
      <td colSpan={colSpan}>
        {/* Bounded, compact card container: the td still spans the table, but the
          detail cards form a width-bounded responsive cluster instead of a full-width
          many-column table (user item 2). */}
        <div className="detail-wrap">
          <div className="detail-grid">
            <section className="detail-section" aria-label="Events"><h4>Events</h4>
            {year.events.length === 0
              ? <p className="hint">No events</p>
              : <ul>{year.events.map((event, index) => <li key={`e${index}`}>{event}</li>)}</ul>}
          </section>
          <section className="detail-section" aria-label="Warnings"><h4>Warnings</h4>
            {year.warnings.length === 0
              ? <p className="hint">No warnings</p>
              : <ul>{year.warnings.map((warning, index) => <li key={`w${index}`}>{warning}</li>)}</ul>}
            {notices.length > 0 && <div className="detail-notices" role="note" aria-label="Year cashflow explanations">
              {notices.map((notice, index) => <p key={`n${index}`}>{notice}</p>)}
            </div>}
          </section>
          <section className="detail-section" aria-label="Expenses"><h4>Expenses</h4>
            {year.expenseBreakdown === undefined
              ? <p className="hint">Per-expense details were not recorded for this saved result.</p>
              : year.expenseBreakdown.length === 0
                ? <p className="hint">No expenses in this year.</p>
                : <ul className="expense-list">{year.expenseBreakdown.map((expense) => <li key={expense.id}><span>{expense.name?.trim() || expense.id}</span><span>{fmtMoneyDetail(expense.amount)}</span></li>)}</ul>}
            <p className="detail-expense-total"><strong>Modelled annual total</strong><strong>{fmtMoneyDetail(year.expenses)}</strong></p>
            {year.expenseBreakdown?.length ? <p className="hint expense-rounding-note">Per-item amounts are shown rounded to cents; the total is the engine result.</p> : null}
          </section>
          <section className="detail-section" aria-label="Savings flows"><h4>Savings flows</h4>
            <dl className="detail-values">
              <dt>TFSA</dt><dd>{fmtMoneyDetail(year.savings.tfsa)}</dd><dt>RRSP</dt><dd>{fmtMoneyDetail(year.savings.rrsp)}</dd>
              <dt>Non-registered</dt><dd>{fmtMoneyDetail(year.savings.nonreg)}</dd><dt>Cash accounts</dt><dd>{fmtMoneyDetail(year.savings.cash ?? 0)}</dd><dt>Mortgage</dt><dd>{fmtMoneyDetail(year.savings.mortgage)}</dd>
            </dl>
          </section>
          <section className="detail-section" aria-label="Net worth breakdown"><h4>Net worth breakdown</h4>
            <dl className="detail-values">
              <dt>TFSA</dt><dd>{fmtMoneyDetail(year.balances.tfsa)}</dd><dt>RRSP</dt><dd>{fmtMoneyDetail(year.balances.rrsp)}</dd>
              <dt>Non-registered</dt><dd>{fmtMoneyDetail(year.balances.nonreg)}</dd><dt>{year.cashAccounts === undefined ? "Cash reserve" : "Total cash (accounts + reserve)"}</dt><dd>{fmtMoneyDetail(year.balances.cash)}</dd>
              <dt>Other assets</dt><dd>{fmtMoneyDetail(year.balances.otherAssets ?? 0)}</dd><dt>Home</dt><dd>{fmtMoneyDetail(year.balances.home)}</dd>
              <dt>Debt</dt><dd>{fmtMoneyDetail(year.balances.debt)}</dd><dt className="detail-total-label">Net worth</dt><dd className="detail-total">{fmtMoneyDetail(year.netWorth)}</dd>
            </dl>
            {year.cashAccounts?.length ? <><p className="hint">Named account balances are included in total cash above.</p><ul className="cash-account-balances" aria-label="Named cash account balances">
              {year.cashAccounts.map(account => <li key={account.id}>{account.name?.trim() || account.id}: {fmtMoneyDetail(account.balance)}</li>)}
            </ul></> : null}
          </section>
          </div>
        </div>
      </td>
    </tr>
  );
}
