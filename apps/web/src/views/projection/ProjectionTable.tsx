import { Fragment, useState } from "react";
import type { SimulationResult, YearResult } from "@retire-plan/engine";
import { fmtMoney, fmtPercent, yearForAge } from "./fmt";
import { EventsCell, YearDetailRow } from "./YearDetailRow";

interface Column {
  group: string | null;
  label: string;
  value: (year: YearResult) => number;
  percent?: boolean;
}

/** Columns mirror YearResult verbatim (plan §1); group name doubles as header band. */
function columns(): Column[] {
  return [
    { group: null, label: "Year", value: (y) => yearForAge(0, y.age) }, // year filled at render with real birthYear
    { group: "Income", label: "Employment", value: (y) => y.income.employment },
    { group: "Income", label: "CPP", value: (y) => y.income.cpp },
    { group: "Income", label: "OAS", value: (y) => y.income.oas },
    { group: "Income", label: "GIS", value: (y) => y.income.gis },
    { group: "Income", label: "Other", value: (y) => y.income.other },
    { group: null, label: "Taxable", value: (y) => y.taxableIncome },
    { group: "Tax", label: "Federal", value: (y) => y.tax.federal },
    { group: "Tax", label: "Provincial", value: (y) => y.tax.provincial },
    { group: "Tax", label: "Surtax", value: (y) => y.tax.surtax },
    { group: "Tax", label: "OAS claw", value: (y) => y.tax.oasClawback },
    { group: "Tax", label: "Total", value: (y) => y.tax.total },
    { group: "Tax", label: "Marginal", value: (y) => y.tax.marginalRate, percent: true },
    { group: "Withdrawals", label: "TFSA", value: (y) => y.withdrawals.tfsa },
    { group: "Withdrawals", label: "RRSP", value: (y) => y.withdrawals.rrsp },
    { group: "Withdrawals", label: "Non-reg", value: (y) => y.withdrawals.nonreg },
    { group: "Contributions", label: "TFSA", value: (y) => y.contributions.tfsa },
    { group: "Contributions", label: "RRSP", value: (y) => y.contributions.rrsp },
    { group: "Contributions", label: "Non-reg", value: (y) => y.contributions.nonreg },
    { group: null, label: "Expenses", value: (y) => y.expenses },
    { group: null, label: "Shortfall", value: (y) => y.shortfall },
    { group: "Balances", label: "TFSA", value: (y) => y.balances.tfsa },
    { group: "Balances", label: "RRSP", value: (y) => y.balances.rrsp },
    { group: "Balances", label: "Non-reg", value: (y) => y.balances.nonreg },
    { group: "Balances", label: "Cash", value: (y) => y.balances.cash },
    { group: "Balances", label: "Other assets", value: (y) => y.balances.otherAssets ?? 0 },
    { group: "Balances", label: "Home", value: (y) => y.balances.home },
    { group: "Balances", label: "Debt", value: (y) => y.balances.debt },
    { group: null, label: "Net worth", value: (y) => y.netWorth },
    { group: null, label: "TFSA room", value: (y) => y.tfsaRoom },
    { group: null, label: "RRSP room", value: (y) => y.rrspRoom },
  ];
}

/**
 * The dense year table, one row per simulated year, columns verbatim from YearResult.
 * Grouped two-row header (sticky), zebra rows, money right-aligned; each row expands
 * into a full audit-trail row (events + warnings). Print CSS expands all detail rows.
 */
export function ProjectionTable({ result, birthYear }: { result: SimulationResult; birthYear: number }) {
  const cols = columns();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (age: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(age)) next.delete(age);
      else next.add(age);
      return next;
    });
  };

  const failureAge =
    result.summary.success || result.summary.failureAge === undefined ? null : result.summary.failureAge;

  const groupSpans: { label: string | null; span: number }[] = [];
  for (const col of cols) {
    const last = groupSpans[groupSpans.length - 1];
    if (last && last.label === col.group) last.span += 1;
    else groupSpans.push({ label: col.group, span: 1 });
  }

  return (
    <div id="projection-year-table" className="projection-table-wrap" role="region" aria-label="Year-by-year projection results" tabIndex={-1}>
      <table className="projection-table">
        <thead>
          <tr>
            <th key="age" className="empty-group-th" />
            {groupSpans.map((group, index) => (
              <th key={index} colSpan={group.span} className={group.label ? "group-th" : "empty-group-th"}>
                {group.label ?? ""}
              </th>
            ))}
            <th key="audit" rowSpan={2} scope="col">
              Audit
            </th>
          </tr>
          <tr>
            <th key="age-label" scope="col" className="col-age-year">
              Age
            </th>
            {cols.map((col, index) => (
              <th key={index} scope="col" className={col.label === "Year" ? "col-age-year" : undefined}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {result.years.map((year) => {
            const isExpanded = expanded.has(year.age);
            const isFailed = failureAge !== null && year.age === failureAge;
            return (
              <Fragment key={year.age}>
                <tr
                  data-age={year.age}
                  data-failed={isFailed ? "true" : undefined}
                  id={`projection-year-${year.age}`}
                  className={isFailed ? "failed-row" : undefined}
                >
                  <td className="col-age-year">
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-label={`Age ${year.age}`}
                      onClick={() => toggle(year.age)}
                    >
                      {year.age}
                    </button>
                  </td>
                  <td className="col-age-year">{yearForAge(birthYear, year.age)}</td>
                  {cols.slice(1).map((col, index) => (
                    <td key={index} className={col.percent ? "col-percent" : "col-money"}>
                      {col.percent ? fmtPercent(col.value(year)) : fmtMoney(col.value(year))}
                    </td>
                  ))}
                  <EventsCell year={year} />
                </tr>
                <YearDetailRow
                  age={year.age}
                  year={year}
                  expanded={isExpanded}
                  colSpan={cols.length + 2}
                />
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
