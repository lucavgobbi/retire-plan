import type { YearResult } from "@budgettool/engine";
import { fmtMoneyDetail } from "./fmt";

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
  colSpan,
}: {
  age: number;
  year: YearResult;
  expanded: boolean;
  colSpan: number;
}) {
  if (!expanded) return null;
  return (
    <tr className="detail-row" data-detail-for={age}>
      <td colSpan={colSpan}>
        <dl className="detail-list">
          <dt>Events</dt>
          <dd>
            {year.events.length === 0
              ? "—"
              : year.events.map((event, index) => <div key={`e${index}`}>{event}</div>)}
          </dd>
          <dt>Warnings</dt>
          <dd>
            {year.warnings.length === 0
              ? "—"
              : year.warnings.map((warning, index) => <div key={`w${index}`}>{warning}</div>)}
          </dd>
          <dt>Savings flows</dt>
          <dd>
            <div>{`TFSA ${fmtMoneyDetail(year.savings.tfsa)} · RRSP ${fmtMoneyDetail(year.savings.rrsp)} · Non-registered ${fmtMoneyDetail(year.savings.nonreg)} · Mortgage ${fmtMoneyDetail(year.savings.mortgage)}`}</div>
          </dd>
          <dt>Net worth breakdown</dt>
          <dd>
            <div>{`TFSA ${fmtMoneyDetail(year.balances.tfsa)} · RRSP ${fmtMoneyDetail(year.balances.rrsp)} · Non-registered ${fmtMoneyDetail(year.balances.nonreg)} · Cash ${fmtMoneyDetail(year.balances.cash)} · Other assets ${fmtMoneyDetail(year.balances.otherAssets ?? 0)} · Home ${fmtMoneyDetail(year.balances.home)} · Debt ${fmtMoneyDetail(year.balances.debt)}`}</div>
            <div className="hint">{`Total ${fmtMoneyDetail(year.netWorth)} (accounts + other assets + home − debt)`}</div>
          </dd>
        </dl>
      </td>
    </tr>
  );
}
