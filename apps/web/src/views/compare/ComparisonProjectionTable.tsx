import { Fragment, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import type { YearResult } from "@retire-plan/engine";
import type { RunRecord } from "../../domain/types";
import { fmtMoney, fmtPercent, yearForAge } from "../projection/fmt";
import { CALENDAR_YEAR_COLUMN_ID, columns, groupProjectionYears, summarize } from "../projection/ProjectionTable";
import { YearDetailRow } from "../projection/YearDetailRow";
import "../projection/projection.css";
import "./ComparisonProjectionTable.css";

type Metric = ReturnType<typeof columns>[number];

interface ScenarioColumn {
  run: RunRecord;
  label: string;
  style: CSSProperties;
  years: Map<number, YearResult>;
}

interface ScenarioPeriod {
  scenario: ScenarioColumn;
  years: YearResult[];
  hasClosingYear: boolean;
}

function metricValue(metric: Metric, { years, hasClosingYear }: ScenarioPeriod) {
  if (
    !years.length ||
    (metric.summary === "stock" && !hasClosingYear) ||
    (metric.group === "Payroll" && years.some((year) => year.payroll === undefined))
  )
    return "—";
  const value = summarize(metric, years);
  return metric.percent ? fmtPercent(value) : fmtMoney(value);
}

function auditValue({ scenario, years }: ScenarioPeriod, periodLength: number) {
  if (!years.length) return "—";
  const { summary } = scenario.run.result;
  const events = years.reduce((total, year) => total + year.events.length, 0);
  const warnings = years.reduce((total, year) => total + year.warnings.length, 0);
  const failed = !summary.success && years.some((year) => year.age === summary.failureAge);
  return (
    [
      events ? `${events} events` : "",
      warnings ? `${warnings} warnings` : "",
      failed ? "Shortfall" : "",
      years.length < periodLength ? `${years.length} of ${periodLength} years` : "",
    ]
      .filter(Boolean)
      .join(" · ") || "—"
  );
}

function Disclosure({
  open,
  controls,
  label,
  onClick,
  children,
}: {
  open: boolean;
  controls?: string;
  label: string;
  onClick: () => void;
  children: string;
}) {
  return (
    <button type="button" aria-expanded={open} aria-controls={controls} aria-label={label} onClick={onClick}>
      <span className={`projection-disclosure-chevron${open ? " is-expanded" : ""}`} aria-hidden="true">
        ›
      </span>
      <span>{children}</span>
    </button>
  );
}

function ScenarioDetails({
  periods,
  calendarYear,
  id,
}: {
  periods: ScenarioPeriod[];
  calendarYear: number;
  id: string;
}) {
  return (
    <div className="comparison-year-details" style={{ "--comparison-scenarios": periods.length } as CSSProperties}>
      {periods.map(({ scenario, years }, index) => {
        const year = years[0];
        const { run } = scenario;
        const { benefits, withdrawalStrategy } = run.scenario;
        const enabledBenefits = [
          benefits?.cpp !== false ? "CPP" : "",
          benefits?.oas !== false ? "OAS" : "",
          benefits?.oas !== false && benefits?.gis !== false ? "GIS" : "",
        ]
          .filter(Boolean)
          .join(", ");
        const historicalReturnYear =
          year && run.analysis?.mode === "historical"
            ? run.analysis.representativeStartYear + year.age - run.result.years[0]!.age
            : undefined;
        const headingId = `${id}-scenario-${index}`;
        return (
          <section
            key={run.id}
            className="comparison-scenario-detail"
            style={scenario.style}
            aria-labelledby={headingId}
          >
            <h4 id={headingId}>
              {scenario.label}
              {year ? ` · Age ${year.age}` : ""}
            </h4>
            {year ? (
              <>
                <p>
                  Benefits enabled: {enabledBenefits || "None"} · Withdrawals:{" "}
                  {withdrawalStrategy === "tax-minimizing" ? "Tax-minimizing planning" : "Manual account order"}
                  {historicalReturnYear !== undefined && ` · Return source: ${historicalReturnYear}`}
                </p>
                <table role="presentation">
                  <tbody>
                    <YearDetailRow
                      rowId={`${headingId}-detail`}
                      age={year.age}
                      year={year}
                      expanded
                      colSpan={1}
                      householdCalendarYear={calendarYear}
                      historicalReturnYear={historicalReturnYear}
                    />
                  </tbody>
                </table>
              </>
            ) : (
              <p>— No projection for {calendarYear}.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function ComparisonProjectionTable({
  runs,
  labels,
  colors,
  birthYear,
  hiddenColumnIds,
}: {
  runs: readonly RunRecord[];
  labels: readonly string[];
  colors: readonly string[];
  birthYear: number;
  hiddenColumnIds?: ReadonlySet<string>;
}) {
  const id = useId();
  const tableRef = useRef<HTMLTableElement>(null);
  const groupHeaderRef = useRef<HTMLTableRowElement>(null);
  const metricHeaderRef = useRef<HTMLTableRowElement>(null);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<number>>(new Set());
  const [expandedYears, setExpandedYears] = useState<ReadonlySet<number>>(new Set());
  const scenarios: ScenarioColumn[] = runs.map((run, index) => ({
    run,
    label: labels[index] ?? run.scenario.name,
    style: { "--comparison-scenario-color": colors[index] } as CSSProperties,
    years: new Map(run.result.years.map((year) => [yearForAge(run.birthYear ?? birthYear, year.age), year])),
  }));
  const ageBirthYear = runs[0]?.birthYear ?? birthYear;
  const calendarYears = [...new Set(scenarios.flatMap(({ years }) => [...years.keys()]))].sort((a, b) => a - b);
  const groups = groupProjectionYears(calendarYears);
  const hasYears = groups.length > 0;
  const differentBirthYears = runs.some((run) => (run.birthYear ?? birthYear) !== ageBirthYear);
  const metrics = columns().filter((col) => col.id !== CALENDAR_YEAR_COLUMN_ID && !hiddenColumnIds?.has(col.id));
  const displayMetrics = [...metrics, null];
  const sections = new Map<string, { label: string | null; metrics: Metric[]; parity?: "even" | "odd" }>();
  let sectionIndex = 0;
  for (const metric of metrics) {
    const key = metric.group ?? metric.id;
    const section = sections.get(key);
    if (section) {
      section.metrics.push(metric);
    } else {
      sections.set(key, {
        label: metric.group,
        metrics: [metric],
        parity: metric.group ? (sectionIndex++ % 2 ? "odd" : "even") : undefined,
      });
    }
  }
  const groupedMetrics = [...sections];
  const span = 2 + displayMetrics.length * scenarios.length;

  useLayoutEffect(() => {
    const [table, groupHeader, metricHeader] = [tableRef.current, groupHeaderRef.current, metricHeaderRef.current];
    if (!table || !groupHeader || !metricHeader) return;
    const updateOffsets = () => {
      const groupHeight = groupHeader.getBoundingClientRect().height;
      table.style.setProperty("--comparison-metric-top", `${groupHeight}px`);
      table.style.setProperty(
        "--comparison-scenario-top",
        `${groupHeight + metricHeader.getBoundingClientRect().height}px`,
      );
    };
    updateOffsets();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(updateOffsets);
    observer?.observe(groupHeader);
    observer?.observe(metricHeader);
    window.addEventListener("resize", updateOffsets);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateOffsets);
    };
  }, [hasYears]);

  if (!hasYears) return <p className="hint">No projection years are available to compare.</p>;

  const toggle = (current: ReadonlySet<number>, year: number) => {
    const next = new Set(current);
    if (!next.delete(year)) next.add(year);
    return next;
  };
  const periodsFor = (years: number[]): ScenarioPeriod[] =>
    scenarios.map((scenario) => ({
      scenario,
      hasClosingYear: scenario.years.has(years.at(-1)!),
      years: years.flatMap((year) => {
        const result = scenario.years.get(year);
        return result ? [result] : [];
      }),
    }));
  const cellId = (metricId: string, index: number) => `${id}-${metricId}-scenario-${index}`;
  const scenarioCells = (periods: ScenarioPeriod[], rowId: string, periodLength: number) =>
    displayMetrics.flatMap((metric) => {
      const metricId = metric?.id ?? "audit";
      const groupHeader = metric?.group ? ` ${id}-group-${encodeURIComponent(metric.group)}` : "";
      return periods.map((period, index) => (
        <td
          key={cellId(metricId, index)}
          headers={`${rowId}${groupHeader} ${id}-metric-${metricId} ${cellId(metricId, index)}`}
          className="comparison-value"
          style={period.scenario.style}
          data-metric-start={index === 0 ? "" : undefined}
          data-total={metric?.total ? "" : undefined}
        >
          {metric ? metricValue(metric, period) : auditValue(period, periodLength)}
        </td>
      ));
    });
  const periods = groups.map((years) => {
    const first = years[0]!;
    const last = years.at(-1)!;
    const groupOpen = expandedGroups.has(first);
    return {
      first,
      groupOpen,
      ageLabel: first === last ? `Age ${first - ageBirthYear}` : `Ages ${first - ageBirthYear}–${last - ageBirthYear}`,
      yearLabel: first === last ? String(first) : `${first}–${last}`,
      length: years.length,
      groupPeriods: periodsFor(years),
      yearRows: groupOpen
        ? years.map((year) => ({ year, periods: periodsFor([year]), open: expandedYears.has(year) }))
        : [],
    };
  });

  return (
    <>
      <div
        className="comparison-projection-scroll"
        role="region"
        aria-label="Cashflow projection comparison"
        tabIndex={0}
      >
        <table className="comparison-projection" ref={tableRef}>
          <caption className="comparison-visually-hidden">Scenario results aligned by household calendar year.</caption>
          <colgroup span={2} />
          {groupedMetrics.map(([key, section]) => (
            <colgroup key={key} span={section.metrics.length * scenarios.length} data-parity={section.parity} />
          ))}
          <colgroup span={scenarios.length} />
          <thead>
            <tr ref={groupHeaderRef}>
              <th className="comparison-age" rowSpan={3} scope="col">
                {differentBirthYears ? `Age (${scenarios[0]!.label})` : "Age"}
              </th>
              <th className="comparison-year" rowSpan={3} scope="col">
                Household calendar year
              </th>
              {groupedMetrics.map(([key, section]) => (
                <th
                  key={key}
                  id={`${id}-group-${encodeURIComponent(key)}`}
                  scope={section.label ? "colgroup" : undefined}
                  colSpan={section.metrics.length * scenarios.length}
                  data-parity={section.parity}
                >
                  {section.label}
                </th>
              ))}
              <th colSpan={scenarios.length} />
            </tr>
            <tr ref={metricHeaderRef}>
              {groupedMetrics.flatMap(([key, section]) =>
                section.metrics.map((metric) => (
                  <th
                    key={metric.id}
                    id={`${id}-metric-${metric.id}`}
                    headers={section.label ? `${id}-group-${encodeURIComponent(key)}` : undefined}
                    colSpan={scenarios.length}
                    data-parity={section.parity}
                    data-total={metric.total ? "" : undefined}
                    aria-label={metric.note ? metric.label : undefined}
                    aria-describedby={metric.note ? `${id}-note-${metric.id}` : undefined}
                  >
                    {metric.label}
                    {metric.note && (
                      <span className="comparison-visually-hidden" id={`${id}-note-${metric.id}`}>
                        {metric.note}
                      </span>
                    )}
                  </th>
                )),
              )}
              <th id={`${id}-metric-audit`} colSpan={scenarios.length}>
                Audit
              </th>
            </tr>
            <tr>
              {displayMetrics.flatMap((metric) => {
                const metricId = metric?.id ?? "audit";
                return scenarios.map((scenario, index) => (
                  <th
                    key={cellId(metricId, index)}
                    id={cellId(metricId, index)}
                    headers={`${id}-metric-${metricId}`}
                    scope="col"
                    className="comparison-scenario-header"
                    style={scenario.style}
                    data-metric-start={index === 0 ? "" : undefined}
                  >
                    {scenario.label}
                  </th>
                ));
              })}
            </tr>
          </thead>
          {periods.map(({ first, groupOpen, ageLabel, yearLabel, length, groupPeriods, yearRows }) => (
            <tbody key={first}>
              <tr className="comparison-decade">
                <th className="comparison-age" id={`${id}-group-age-${first}`} scope="row">
                  <Disclosure
                    open={groupOpen}
                    controls={groupOpen ? yearRows.map(({ year }) => `${id}-year-${year}`).join(" ") : undefined}
                    label={`${groupOpen ? "Collapse" : "Expand"} ${ageLabel}`}
                    onClick={() => setExpandedGroups((current) => toggle(current, first))}
                  >
                    {ageLabel}
                  </Disclosure>
                </th>
                <td className="comparison-year">{yearLabel}</td>
                {scenarioCells(groupPeriods, `${id}-group-age-${first}`, length)}
              </tr>
              {yearRows.map(({ year, periods: yearPeriods, open }) => {
                const detailsId = `${id}-details-${year}`;
                return (
                  <Fragment key={year}>
                    <tr id={`${id}-year-${year}`}>
                      <th className="comparison-age" id={`${id}-age-${year}`} scope="row">
                        <Disclosure
                          open={open}
                          controls={open ? detailsId : undefined}
                          label={`${open ? "Hide" : "Show"} details for ${year} (age ${year - ageBirthYear})`}
                          onClick={() => setExpandedYears((current) => toggle(current, year))}
                        >
                          {String(year - ageBirthYear)}
                        </Disclosure>
                      </th>
                      <td className="comparison-year">{year}</td>
                      {scenarioCells(yearPeriods, `${id}-age-${year}`, 1)}
                    </tr>
                    {open && (
                      <tr id={detailsId}>
                        <td className="comparison-detail-cell" colSpan={span}>
                          <ScenarioDetails periods={yearPeriods} calendarYear={year} id={detailsId} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      <div className="comparison-projection-print">
        {periods
          .flatMap(({ first, ageLabel, yearLabel, groupPeriods, length, yearRows }) => [
            {
              key: `group-${first}`,
              label: `${ageLabel} · ${yearLabel}`,
              periods: groupPeriods,
              length,
              detailYear: undefined,
            },
            ...yearRows.map(({ year, periods, open }) => ({
              key: String(year),
              label: `Age ${year - ageBirthYear} · ${year}`,
              periods,
              length: 1,
              detailYear: open ? year : undefined,
            })),
          ])
          .map(({ key, label, periods: printPeriods, length, detailYear }) => (
            <div key={key}>
              <table>
                <caption>{label}</caption>
                <thead>
                  <tr>
                    <th scope="col">Metric</th>
                    {scenarios.map((scenario) => (
                      <th scope="col" key={scenario.run.id} style={scenario.style}>
                        {scenario.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((metric) => (
                    <tr key={metric.id}>
                      <th scope="row">
                        {metric.group ? `${metric.group} · ` : ""}
                        {metric.label}
                      </th>
                      {printPeriods.map((period) => (
                        <td key={period.scenario.run.id}>{metricValue(metric, period)}</td>
                      ))}
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">Audit</th>
                    {printPeriods.map((period) => (
                      <td key={period.scenario.run.id}>{auditValue(period, length)}</td>
                    ))}
                  </tr>
                </tbody>
              </table>
              {detailYear !== undefined && (
                <ScenarioDetails periods={printPeriods} calendarYear={detailYear} id={`${id}-print-${key}`} />
              )}
            </div>
          ))}
      </div>
    </>
  );
}
