import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SimulationResult, YearResult } from "@retire-plan/engine";
import { fmtMoney, fmtPercent, yearForAge } from "./fmt";
import { EventsCell, YearDetailRow } from "./YearDetailRow";

type SummaryKind = "flow" | "stock" | "rate" | "year";
interface Column {
  /** Stable identifier persisted in workspace.projectionColumns / exported JSON. */
  id: string;
  group: string | null;
  label: string;
  value: (year: YearResult) => number;
  summary: SummaryKind;
  percent?: boolean;
}

/** First column: always visible, never selectable (like the Audit column). */
export const CALENDAR_YEAR_COLUMN_ID = "calendarYear";

/** Columns mirror YearResult; flow summaries sum while stocks show period end. */
export function columns(): Column[] {
  const flow = (id: string, group: string | null, label: string, value: (y: YearResult) => number): Column => ({ id, group, label, value, summary: "flow" });
  const stock = (id: string, group: string | null, label: string, value: (y: YearResult) => number): Column => ({ id, group, label, value, summary: "stock" });
  return [
    { id: CALENDAR_YEAR_COLUMN_ID, group: null, label: "Household calendar year", value: (y) => y.age, summary: "year" },
    flow("income.employment", "Income", "Employment", (y) => y.income.employment), flow("income.cpp", "Income", "CPP", (y) => y.income.cpp),
    flow("income.oas", "Income", "OAS", (y) => y.income.oas), flow("income.gis", "Income", "GIS", (y) => y.income.gis), flow("income.other", "Income", "Other", (y) => y.income.other),
    flow("cash.interest", "Cash accounts", "Interest", (y) => y.cashInterest ?? 0),
    flow("tax.taxableIncome", null, "Taxable", (y) => y.taxableIncome), flow("tax.federal", "Tax", "Federal", (y) => y.tax.federal),
    flow("tax.provincial", "Tax", "Provincial", (y) => y.tax.provincial), flow("tax.surtax", "Tax", "Surtax", (y) => y.tax.surtax),
    flow("tax.oasClawback", "Tax", "OAS claw", (y) => y.tax.oasClawback), flow("tax.total", "Tax", "Total", (y) => y.tax.total),
    { id: "tax.marginalRate", group: "Tax", label: "Marginal", value: (y) => y.tax.marginalRate, summary: "rate", percent: true },
    flow("withdrawals.tfsa", "Withdrawals", "TFSA", (y) => y.withdrawals.tfsa), flow("withdrawals.rrsp", "Withdrawals", "RRSP", (y) => y.withdrawals.rrsp),
    flow("withdrawals.nonreg", "Withdrawals", "Non-reg", (y) => y.withdrawals.nonreg), flow("withdrawals.cash", "Withdrawals", "Cash", (y) => y.withdrawals.cash ?? 0), flow("contributions.tfsa", "Contributions", "TFSA", (y) => y.contributions.tfsa),
    flow("contributions.rrsp", "Contributions", "RRSP", (y) => y.contributions.rrsp), flow("contributions.nonreg", "Contributions", "Non-reg", (y) => y.contributions.nonreg), flow("contributions.cash", "Contributions", "Cash", (y) => y.contributions.cash ?? 0),
    flow("expenses", null, "Expenses", (y) => y.expenses), flow("shortfall", null, "Shortfall", (y) => y.shortfall),
    stock("balances.tfsa", "Balances", "TFSA", (y) => y.balances.tfsa), stock("balances.rrsp", "Balances", "RRSP", (y) => y.balances.rrsp),
    stock("balances.nonreg", "Balances", "Non-reg", (y) => y.balances.nonreg), stock("balances.cash", "Balances", "Cash", (y) => y.balances.cash),
    stock("balances.otherAssets", "Balances", "Other assets", (y) => y.balances.otherAssets ?? 0), stock("balances.home", "Balances", "Home", (y) => y.balances.home),
    stock("balances.debt", "Balances", "Debt", (y) => y.balances.debt), stock("netWorth", null, "Net worth", (y) => y.netWorth),
    stock("tfsaRoom", null, "TFSA room", (y) => y.tfsaRoom), stock("rrspRoom", null, "RRSP room", (y) => y.rrspRoom),
  ];
}

/**
 * Normalizes a stored hidden-column selection against the selectable column
 * ids: unknown or stale ids are dropped, duplicates removed, canonical column
 * order enforced. Returns null when the value is absent/invalid — meaning the
 * default "all columns visible" (also the backward-compatible default for old
 * saved/exported JSON). An empty result means every selectable column is
 * hidden; the pinned Age/calendar-year/Audit columns still render.
 */
export function sanitizeHiddenColumns(value: unknown, selectableIds: readonly string[]): string[] | null {
  if (!Array.isArray(value)) return null;
  const wanted = new Set(value.filter((id): id is string => typeof id === "string" && selectableIds.includes(id)));
  return selectableIds.filter(id => wanted.has(id));
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
export function ProjectionTable({ result, birthYear, jumpAge, jumpKey, historicalSourceStartYear, hiddenColumnIds }: { result: SimulationResult; birthYear: number; jumpAge?: number | null; jumpKey?: number; historicalSourceStartYear?: number; hiddenColumnIds?: ReadonlySet<string> }) {
  // Visible columns only — the filter runs BEFORE group spans, colgroups, header
  // cells, body cells and detail-row colSpan are derived, so grouping metadata,
  // colspan mapping and column-group band parity all follow the visible set.
  // The Age-toggle and calendar-year columns are pinned; Audit is outside cols.
  const cols = columns().filter(col => col.id === CALENDAR_YEAR_COLUMN_ID || !hiddenColumnIds?.has(col.id));
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
  const groupSpans: { label: string | null; span: number; parity: "even" | "odd" | null }[] = [];
  const colParity: ("even" | "odd" | null)[] = [];
  let namedGroupIndex = 0;
  for (const col of cols) {
    const last = groupSpans[groupSpans.length - 1];
    if (last && last.label === col.group) {
      last.span += 1;
      colParity.push(last.parity);
    } else {
      // Parity advances on NAMED groups only (Income, Cash accounts, Tax, …);
      // null/standalone columns stay neutral and do not shift the alternation.
      const parity = col.group === null ? null : namedGroupIndex % 2 ? "odd" : "even";
      if (parity) namedGroupIndex += 1;
      groupSpans.push({ label: col.group, span: 1, parity });
      colParity.push(parity);
    }
  }

  return <div id="projection-year-table" className="projection-table-wrap" role="region" aria-label="Year-by-year projection results" tabIndex={-1}>
    <table ref={tableRef} className="projection-table">
      {/* Column-group bands: one leading colgroup for the Age-toggle column (neutral,
        like the Audit column), then one colgroup per consecutive column group with
        alternating parity. Colgroup backgrounds paint under transparent body cells,
        so year and decade-summary cells carry their column's band (projection.css). */}
      <colgroup />
      {groupSpans.map((group, index) => <colgroup key={index} span={group.span} data-group-parity={group.parity ?? undefined} />)}
      <thead>
        <tr ref={groupHeaderRef}><th className="empty-group-th" />{groupSpans.map((group, index) => <th key={index} colSpan={group.span} data-group-parity={group.parity ?? undefined} className={group.label ? "group-th" : "empty-group-th"}>{group.label ?? ""}</th>)}<th rowSpan={2} scope="col">Audit</th></tr>
        <tr><th scope="col" className="col-age-year">Age</th>{cols.map((col, index) => <th key={index} scope="col" data-group-parity={colParity[index] ?? undefined} className={col.label === "Year" ? "col-age-year" : undefined}>{col.label}</th>)}</tr>
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
            <tr className={`decade-row${failures ? " failed-row" : ""}`} data-group-start-age={first.age}>
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
