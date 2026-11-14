import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SimulationResult, YearResult } from "@retire-plan/engine";
import { fmtMoney, fmtPercent, yearForAge } from "./fmt";
import { EventsCell, YearDetailRow } from "./YearDetailRow";

type SummaryKind = "flow" | "stock" | "rate" | "year";
interface Column {
  group: string | null;
  label: string;
  value: (year: YearResult) => number;
  summary: SummaryKind;
  percent?: boolean;
}

/** Columns mirror YearResult; flow summaries sum while stocks show period end. */
function columns(): Column[] {
  const flow = (group: string | null, label: string, value: (y: YearResult) => number): Column => ({ group, label, value, summary: "flow" });
  const stock = (group: string | null, label: string, value: (y: YearResult) => number): Column => ({ group, label, value, summary: "stock" });
  return [
    { group: null, label: "Household calendar year", value: (y) => y.age, summary: "year" },
    flow("Income", "Employment", (y) => y.income.employment), flow("Income", "CPP", (y) => y.income.cpp),
    flow("Income", "OAS", (y) => y.income.oas), flow("Income", "GIS", (y) => y.income.gis), flow("Income", "Other", (y) => y.income.other),
    flow("Cash accounts", "Interest", (y) => y.cashInterest ?? 0),
    flow(null, "Taxable", (y) => y.taxableIncome), flow("Tax", "Federal", (y) => y.tax.federal),
    flow("Tax", "Provincial", (y) => y.tax.provincial), flow("Tax", "Surtax", (y) => y.tax.surtax),
    flow("Tax", "OAS claw", (y) => y.tax.oasClawback), flow("Tax", "Total", (y) => y.tax.total),
    { group: "Tax", label: "Marginal", value: (y) => y.tax.marginalRate, summary: "rate", percent: true },
    flow("Withdrawals", "TFSA", (y) => y.withdrawals.tfsa), flow("Withdrawals", "RRSP", (y) => y.withdrawals.rrsp),
    flow("Withdrawals", "Non-reg", (y) => y.withdrawals.nonreg), flow("Withdrawals", "Cash", (y) => y.withdrawals.cash ?? 0), flow("Contributions", "TFSA", (y) => y.contributions.tfsa),
    flow("Contributions", "RRSP", (y) => y.contributions.rrsp), flow("Contributions", "Non-reg", (y) => y.contributions.nonreg), flow("Contributions", "Cash", (y) => y.contributions.cash ?? 0),
    flow(null, "Expenses", (y) => y.expenses), flow(null, "Shortfall", (y) => y.shortfall),
    stock("Balances", "TFSA", (y) => y.balances.tfsa), stock("Balances", "RRSP", (y) => y.balances.rrsp),
    stock("Balances", "Non-reg", (y) => y.balances.nonreg), stock("Balances", "Cash", (y) => y.balances.cash),
    stock("Balances", "Other assets", (y) => y.balances.otherAssets ?? 0), stock("Balances", "Home", (y) => y.balances.home),
    stock("Balances", "Debt", (y) => y.balances.debt), stock(null, "Net worth", (y) => y.netWorth),
    stock(null, "TFSA room", (y) => y.tfsaRoom), stock(null, "RRSP room", (y) => y.rrspRoom),
  ];
}

function summarize(col: Column, years: YearResult[]): number {
  if (col.summary === "stock") return col.value(years[years.length - 1]!);
  if (col.summary === "rate") {
    const taxable = years.reduce((sum, year) => sum + Math.max(0, year.taxableIncome), 0);
    return taxable > 0 ? years.reduce((sum, year) => sum + col.value(year) * Math.max(0, year.taxableIncome), 0) / taxable
      : years.reduce((sum, year) => sum + col.value(year), 0) / years.length;
  }
  return years.reduce((sum, year) => sum + col.value(year), 0);
}

/** Ten consecutive result years per collapsed row; each can reveal its yearly audit trail. */
export function ProjectionTable({ result, birthYear, jumpAge, jumpKey, historicalSourceStartYear }: { result: SimulationResult; birthYear: number; jumpAge?: number | null; jumpKey?: number; historicalSourceStartYear?: number }) {
  const cols = columns();
  const [expandedGroups, setExpandedGroups] = useState<Set<number>>(() => new Set());
  const [expandedYears, setExpandedYears] = useState<Set<number>>(() => new Set());
  const tableRef = useRef<HTMLTableElement>(null);
  const groupHeaderRef = useRef<HTMLTableRowElement>(null);
  const groups: YearResult[][] = [];
  for (let index = 0; index < result.years.length; index += 10) groups.push(result.years.slice(index, index + 10));
  const firstAge = result.years[0]?.age;
  const returnSourceYear = (age: number) => historicalSourceStartYear === undefined || firstAge === undefined
    ? undefined
    : historicalSourceStartYear + age - firstAge;
  const toggle = (setValue: (updater: (current: Set<number>) => Set<number>) => void, key: number) => setValue((current) => {
    const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next;
  });

  useLayoutEffect(() => {
    const updateHeaderOffset = () => {
      const height = groupHeaderRef.current?.getBoundingClientRect().height;
      if (height !== undefined) tableRef.current?.style.setProperty("--projection-group-header-height", `${height}px`);
    };
    updateHeaderOffset();
    const observer = typeof ResizeObserver === "undefined" || !groupHeaderRef.current
      ? null
      : new ResizeObserver(updateHeaderOffset);
    if (observer && groupHeaderRef.current) observer.observe(groupHeaderRef.current);
    window.addEventListener("resize", updateHeaderOffset);
    return () => { observer?.disconnect(); window.removeEventListener("resize", updateHeaderOffset); };
  }, []);

  useEffect(() => {
    if (jumpAge == null) return;
    const groupIndex = result.years.findIndex((year) => year.age === jumpAge);
    if (groupIndex < 0) return;
    const decadeIndex = Math.floor(groupIndex / 10);
    setExpandedGroups((current) => new Set(current).add(decadeIndex));
    window.setTimeout(() => document.getElementById(`projection-year-${jumpAge}`)?.scrollIntoView?.({ behavior: "smooth", block: "center" }), 0);
  }, [jumpAge, jumpKey, result.years]);

  const failureAge = result.summary.success || result.summary.failureAge === undefined ? null : result.summary.failureAge;
  const groupSpans: { label: string | null; span: number }[] = [];
  for (const col of cols) {
    const last = groupSpans[groupSpans.length - 1];
    if (last && last.label === col.group) last.span += 1;
    else groupSpans.push({ label: col.group, span: 1 });
  }

  return <div id="projection-year-table" className="projection-table-wrap" role="region" aria-label="Year-by-year projection results" tabIndex={-1}>
    <table ref={tableRef} className="projection-table">
      <thead>
        <tr ref={groupHeaderRef}><th className="empty-group-th" />{groupSpans.map((group, index) => <th key={index} colSpan={group.span} className={group.label ? "group-th" : "empty-group-th"}>{group.label ?? ""}</th>)}<th rowSpan={2} scope="col">Audit</th></tr>
        <tr><th scope="col" className="col-age-year">Age</th>{cols.map((col, index) => <th key={index} scope="col" className={col.label === "Year" ? "col-age-year" : undefined}>{col.label}</th>)}</tr>
      </thead>
      <tbody>
        {groups.map((years, groupIndex) => {
          const expanded = expandedGroups.has(groupIndex);
          const first = years[0]!; const last = years[years.length - 1]!;
          const label = `Ages ${first.age}–${last.age}`;
          const failures = years.some((year) => failureAge === year.age);
          const events = years.reduce((sum, year) => sum + year.events.length, 0);
          const warnings = years.reduce((sum, year) => sum + year.warnings.length, 0);
          return <Fragment key={first.age}>
            <tr className={`decade-row${failures ? " failed-row" : ""}`} data-group-start-age={first.age} data-group-parity={groupIndex % 2 ? "odd" : "even"}>
              <td className="col-age-year"><button type="button" className="group-toggle" aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${label}`} onClick={() => toggle(setExpandedGroups, groupIndex)}>{expanded ? "▾" : "▸"} {label}</button></td>
              <td className="col-age-year decade-years" aria-label={`Household calendar years ${yearForAge(birthYear, first.age)} to ${yearForAge(birthYear, last.age)}${returnSourceYear(first.age) === undefined ? "" : `; historical return source years ${returnSourceYear(first.age)} to ${returnSourceYear(last.age)}`}`}>
                <span>{yearForAge(birthYear, first.age)}–{yearForAge(birthYear, last.age)}</span>
                {returnSourceYear(first.age) !== undefined && <small className="return-source-label">Return source: {returnSourceYear(first.age)}–{returnSourceYear(last.age)}</small>}
              </td>
              {cols.slice(1).map((col, index) => <td key={index} className={col.percent ? "col-percent" : "col-money"}>{col.percent ? fmtPercent(summarize(col, years)) : fmtMoney(summarize(col, years))}</td>)}
              <td className="events-cell" aria-label={`${events} events, ${warnings} warnings`}>{events ? `⚡${events} ` : ""}{warnings ? `⚠${warnings}` : events + warnings === 0 ? <span className="hint">—</span> : null}</td>
            </tr>
            {years.map((year) => {
              const isExpanded = expandedYears.has(year.age);
              const isFailed = failureAge === year.age;
              return <Fragment key={year.age}>
                <tr data-age={year.age} data-group-collapsed={!expanded ? "true" : undefined} data-failed={isFailed ? "true" : undefined} id={`projection-year-${year.age}`} className={isFailed ? "failed-row yearly-row" : "yearly-row"}>
                  <td className="col-age-year"><button type="button" aria-expanded={isExpanded} aria-label={`Age ${year.age}`} onClick={() => toggle(setExpandedYears, year.age)}>{year.age}</button></td>
                  <td className="col-age-year" aria-label={`Household calendar year ${yearForAge(birthYear, year.age)}${returnSourceYear(year.age) === undefined ? "" : `; historical return source year ${returnSourceYear(year.age)}`}`}>
                    <span>{yearForAge(birthYear, year.age)}</span>
                    {returnSourceYear(year.age) !== undefined && <small className="return-source-label">Return source: {returnSourceYear(year.age)}</small>}
                  </td>
                  {cols.slice(1).map((col, index) => <td key={index} className={col.percent ? "col-percent" : "col-money"}>{col.percent ? fmtPercent(col.value(year)) : fmtMoney(col.value(year))}</td>)}
                  <EventsCell year={year} />
                </tr>
                <YearDetailRow age={year.age} year={year} expanded={isExpanded} groupExpanded={expanded} colSpan={cols.length + 2}
                  householdCalendarYear={historicalSourceStartYear === undefined ? undefined : yearForAge(birthYear, year.age)}
                  historicalReturnYear={returnSourceYear(year.age)} />
              </Fragment>;
            })}
          </Fragment>;
        })}
      </tbody>
    </table>
  </div>;
}
