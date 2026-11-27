import { useId, useMemo, useState } from "react";
import type { YearResult } from "@retire-plan/engine";
import { PALETTE } from "../charts/palette";
import { fmtMoneyDetail } from "../fmt";
import {
  aggregateCashflow,
  cashflowYears,
  type CashflowAmount,
  type CashflowRange,
  type FlowKind,
} from "./cashflowData";
import "./cashflowSankey.css";

export type { CashflowRange } from "./cashflowData";

interface CashflowSankeyProps {
  years: YearResult[];
  birthYear: number;
  range: CashflowRange;
  onRangeChange: (range: CashflowRange) => void;
  showAccounts: boolean;
  onShowAccountsChange: (showAccounts: boolean) => void;
}

const nodeWidth = 14;
const bandHeight = 208;
const labelGap = 38;
const labelLineOffset = 9;
const pool = "Cashflow pool";
const colors: Record<FlowKind, string> = {
  income: PALETTE.color1,
  transfer: PALETTE.color4,
  expense: PALETTE.color2,
  tax: PALETTE.color3,
  debt: "#9f3459",
  cash: "#3f7187",
  adjustment: "#64748b",
};
const money = (cents: number) => fmtMoneyDetail(cents / 100);

function groupSmall(items: CashflowAmount[], total: number, side: "sources" | "uses"): CashflowAmount[] {
  const ranked = [...items].sort((a, b) => b.cents - a.cents);
  const firstSmall = ranked.findIndex((item, index) => index >= 6 || item.cents < total * 0.015);
  if (firstSmall < 0 || ranked.length - firstSmall < 2) return ranked;
  return [
    ...ranked.slice(0, firstSmall),
    {
      id: `small-${side}`,
      label: `Other ${side}`,
      kind: "adjustment",
      cents: ranked.slice(firstSmall).reduce((sum, item) => sum + item.cents, 0),
    },
  ];
}

function labelColumnWidth(items: CashflowAmount[]) {
  // Allow room for wide glyphs, bold focus labels, and the node gap.
  return items.reduce((width, item) => {
    const characters = Math.max(Array.from(item.label).length, money(item.cents).length);
    return Math.max(width, characters * 17 + 20);
  }, 242);
}

function ribbon(x1: number, y1: number, x2: number, y2: number, height: number) {
  const mid = (x1 + x2) / 2;
  return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2} V${y2 + height} C${mid},${y2 + height} ${mid},${y1 + height} ${x1},${y1 + height} Z`;
}

type FlowDiagramProps = Pick<
  ReturnType<typeof aggregateCashflow>,
  "sources" | "uses" | "sourceCents" | "useCents" | "named" | "categoryOffsetCents"
>;

function FlowDiagram({ sources, uses, sourceCents, useCents, named, categoryOffsetCents }: FlowDiagramProps) {
  const titleId = useId();
  const [hovered, setHovered] = useState<string>();
  const [focused, setFocused] = useState<string>();
  const [pinned, setPinned] = useState<string>();
  const total = Math.max(sourceCents, useCents);
  const left = named ? sources.filter(({ cents }) => cents > 0) : groupSmall(sources, total, "sources");
  const right = named ? uses.filter(({ cents }) => cents > 0) : groupSmall(uses, total, "uses");
  const leftX = labelColumnWidth(left);
  const centerX = leftX + 241;
  const rightX = centerX + 241;
  const chartWidth = rightX + nodeWidth + labelColumnWidth(right);
  const plotHeight = bandHeight + labelGap * (Math.max(left.length, right.length) - 1);
  const chartHeight = plotHeight + 92;
  const poolY = 48 + (plotHeight - bandHeight) / 2;

  function place(items: CashflowAmount[], side: "source" | "use") {
    const sideCents = side === "source" ? sourceCents : useCents;
    const innerTop = poolY + ((1 - sideCents / total) * bandHeight) / 2;
    const startY = innerTop - (labelGap * (items.length - 1)) / 2;
    let stackY = innerTop;
    return items.map((item, index) => {
      const thickness = (item.cents / total) * bandHeight;
      const outerY = startY + (stackY - innerTop) + index * labelGap;
      const innerY = stackY;
      stackY += thickness;
      return {
        ...item,
        side,
        thickness,
        outerY,
        innerY,
        key: `${side}-${item.id}`,
        from: side === "source" ? item.label : pool,
        to: side === "source" ? pool : item.label,
      };
    });
  }

  const flows = [...place(left, "source"), ...place(right, "use")];
  const active = flows.find((flow) => flow.key === (hovered ?? focused ?? pinned));
  const activate = (key: string) => setPinned((current) => (current === key ? undefined : key));

  return (
    <figure className="cashflow-figure">
      <figcaption className="cashflow-tooltip" role="status" aria-atomic="true">
        {active ? (
          <>
            <span>
              {active.from} → {active.to}
            </span>
            <strong>{money(active.cents)}</strong>
          </>
        ) : sourceCents === useCents ? (
          <>
            <span>Period flow</span>
            <strong>{money(total - categoryOffsetCents)}</strong>
          </>
        ) : (
          <>
            <span>
              Sources <strong>{money(sourceCents - categoryOffsetCents)}</strong>
            </span>
            <span>
              Uses <strong>{money(useCents - categoryOffsetCents)}</strong>
            </span>
          </>
        )}
      </figcaption>
      <div className={`cashflow-plot${named ? " cashflow-plot-named" : ""}`}>
        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} width={chartWidth} role="group" aria-labelledby={titleId}>
          <title id={titleId}>Cashflow Sankey diagram</title>
          <g className="cashflow-svg-heading" aria-hidden="true">
            <text x={leftX} y="24" textAnchor="end">
              Sources
            </text>
            <text x={centerX + nodeWidth / 2} y="24" textAnchor="middle">
              {pool}
            </text>
            <text x={rightX + nodeWidth} y="24">
              Uses
            </text>
          </g>
          <rect
            x={centerX}
            y={poolY}
            width={nodeWidth}
            height={bandHeight}
            rx="2"
            fill={PALETTE.ink}
            aria-hidden="true"
          />
          {flows.map((flow) => {
            const source = flow.side === "source";
            const x = source ? leftX : rightX;
            const path = source
              ? ribbon(x + nodeWidth, flow.outerY, centerX, flow.innerY, flow.thickness)
              : ribbon(centerX + nodeWidth, flow.innerY, x, flow.outerY, flow.thickness);
            const labelY = flow.outerY + flow.thickness / 2;
            const labelX = source ? x - 10 : x + nodeWidth + 10;
            const amount = money(flow.cents);
            return (
              <g
                key={flow.key}
                role="button"
                tabIndex={0}
                aria-label={`${flow.from} to ${flow.to}, ${amount}`}
                aria-pressed={pinned === flow.key}
                className="cashflow-flow"
                data-active={active?.key === flow.key}
                style={{ color: colors[flow.kind] }}
                onPointerEnter={(event) => {
                  if (event.pointerType !== "touch") setHovered(flow.key);
                }}
                onPointerLeave={() => setHovered(undefined)}
                onFocus={() => setFocused(flow.key)}
                onBlur={() => setFocused(undefined)}
                onClick={() => activate(flow.key)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate(flow.key);
                  } else if (event.key === "Escape") {
                    setPinned(undefined);
                    setHovered(undefined);
                    setFocused(undefined);
                  }
                }}
              >
                <path className="cashflow-ribbon" d={path} />
                <rect x={x} y={flow.outerY} width={nodeWidth} height={flow.thickness} fill="currentColor" rx="2" />
                <text textAnchor={source ? "end" : "start"} dominantBaseline="central" aria-hidden="true">
                  <tspan x={labelX} y={labelY - labelLineOffset}>
                    {flow.label}
                  </tspan>
                  <tspan className="cashflow-flow-amount" x={labelX} y={labelY + labelLineOffset}>
                    {amount}
                  </tspan>
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}

function BreakdownList({ heading, items }: { heading: string; items: CashflowAmount[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h4>{heading}</h4>
      <dl>
        {items.map((item) => (
          <div key={item.id}>
            <dt>{item.label}</dt>
            <dd>{money(item.cents)}</dd>
          </div>
        ))}
        <div className="cashflow-breakdown-total">
          <dt>Total</dt>
          <dd>{money(items.reduce((total, item) => total + item.cents, 0))}</dd>
        </div>
      </dl>
    </div>
  );
}

export function CashflowSankey({
  years,
  birthYear,
  range,
  onRangeChange,
  showAccounts,
  onShowAccountsChange,
}: CashflowSankeyProps) {
  const id = useId();
  const options = useMemo(() => cashflowYears(years, birthYear), [years, birthYear]);
  const startYear = options.includes(range.startYear) ? range.startYear : options[0];
  const endYear =
    options.includes(range.endYear) && (startYear === undefined || range.endYear >= startYear)
      ? range.endYear
      : options.at(-1);
  const data = useMemo(
    () =>
      startYear === undefined || endYear === undefined
        ? undefined
        : aggregateCashflow(years, birthYear, { startYear, endYear }, showAccounts),
    [years, birthYear, startYear, endYear, showAccounts],
  );
  const employerTransfers = data ? [...data.matches, ...data.employerContributions] : [];

  return (
    <section className="cashflow-sankey" aria-labelledby={id}>
      <div className="cashflow-header">
        <h3 id={id}>Cashflow diagram</h3>
        <label className="cashflow-show-accounts no-print">
          <input
            type="checkbox"
            checked={showAccounts}
            onChange={(event) => onShowAccountsChange(event.currentTarget.checked)}
          />
          Show accounts
        </label>
        {startYear !== undefined && endYear !== undefined && (
          <fieldset className="cashflow-range no-print">
            <legend>Diagram years</legend>
            <label>
              Start year{" "}
              <select
                value={startYear}
                onChange={(event) => {
                  const year = Number(event.currentTarget.value);
                  if (options.includes(year) && year <= endYear) onRangeChange({ startYear: year, endYear });
                }}
              >
                {options.map((year) => (
                  <option value={year} key={year} disabled={year > endYear}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            <label>
              End year{" "}
              <select
                value={endYear}
                onChange={(event) => {
                  const year = Number(event.currentTarget.value);
                  if (options.includes(year) && year >= startYear) onRangeChange({ startYear, endYear: year });
                }}
              >
                {options.map((year) => (
                  <option value={year} key={year} disabled={year < startYear}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>
        )}
      </div>
      {data ? (
        <>
          <p className="cashflow-period">{startYear === endYear ? startYear : `${startYear}–${endYear}`} · CAD</p>
          {data.sourceCents > 0 || data.useCents > 0 ? (
            <FlowDiagram key={`${birthYear}-${startYear}-${endYear}-${data.named}`} {...data} />
          ) : (
            <p className="hint">No pooled cash movements to show for the selected years.</p>
          )}
          {employerTransfers.map(({ id, label, cents }) => (
            <p key={id} className="cashflow-direct-transfer">
              <span>
                <strong>{label}</strong> <span>Direct transfer outside the cashflow pool</span>
              </span>
              <strong>{money(cents)}</strong>
            </p>
          ))}
          <div className="cashflow-notes">
            {data.namedUnavailable && (
              <p>
                Account and item details are unavailable for some selected years. The diagram and breakdown show
                categories. Run the projection again to show named flows.
              </p>
            )}
            {data.hasNamedGaps && (
              <p>
                Difference rows reconcile the reported category totals with the amounts recorded for individual items.
              </p>
            )}
            {data.categoryOffsetCents > 0 && (
              <p>
                The diagram and breakdown include {money(data.categoryOffsetCents)} in offsetting items on each side.
                The period total nets those items.
              </p>
            )}
            {data.shortfallCents > 0 && (
              <p>
                <strong>Unmet obligations {money(data.shortfallCents)}</strong>. The diagram groups covered obligations
                where complete records are available. The breakdown shows the reported obligations
                {data.named ? " by item before any shortfall" : ""}.
              </p>
            )}
            {data.unknownCoverageYears > 0 && (
              <p>Some shortfall years lack the records needed to calculate covered obligations.</p>
            )}
            {data.legacyYears > 0 && (
              <p>
                Some saved years lack cashflow detail such as scheduled mortgage payments, idle cash and asset-sale
                routing. Their saved Other income and RRSP deposit totals can include employer match or other company
                RRSP contributions. Run the projection again for those details.
              </p>
            )}
            {data.missingPayrollYears > 0 && <p>Some saved years lack payroll deduction data.</p>}
            {(data.unreconciledSourceCents > 0 || data.unreconciledUseCents > 0) && (
              <div>
                <p>
                  Unreconciled differences are shown outside the diagram because the records do not establish their cash
                  movements.
                </p>
                {data.unreconciledSourceCents > 0 && (
                  <p>
                    Sources exceed identifiable uses by {money(data.unreconciledSourceCents)} across the affected years.
                  </p>
                )}
                {data.unreconciledUseCents > 0 && (
                  <p>
                    Uses exceed identifiable sources by {money(data.unreconciledUseCents)} across the affected years.
                  </p>
                )}
              </div>
            )}
            {data.unavailableYears > 0 && (
              <p>Some years contain unavailable amounts and are excluded from the diagram and breakdown.</p>
            )}
          </div>
          {(data.sources.length > 0 ||
            data.uses.length > 0 ||
            data.obligations.length > 0 ||
            employerTransfers.length > 0 ||
            data.assetSaleToNonreg > 0 ||
            data.cashContributionsToIdleCash > 0) && (
            <details className="cashflow-breakdown">
              <summary>Cashflow breakdown</summary>
              <div className="cashflow-breakdown-columns">
                <BreakdownList heading="Sources" items={data.sources} />
                <BreakdownList heading={data.named ? "Uses" : "Uses shown in the diagram"} items={data.uses} />
                {data.shortfallCents > 0 && (
                  <BreakdownList heading="Reported obligations before shortfalls" items={data.obligations} />
                )}
                <BreakdownList heading="Direct transfers outside the cashflow pool" items={employerTransfers} />
                <BreakdownList heading="Asset sales routed outside the pool" items={data.directSales} />
                <BreakdownList heading="Accounts credited with asset sales" items={data.saleDeposits} />
              </div>
              {data.assetSaleToNonreg > 0 && (
                <p>
                  Asset sales deposited into non-registered accounts totaled {money(data.assetSaleToNonreg)}. Any
                  amounts used for bills enter the diagram through withdrawals.
                </p>
              )}
              {data.cashContributionsToIdleCash > 0 && (
                <p>
                  Cash contributions allocated to idle cash totaled {money(data.cashContributionsToIdleCash)}. These
                  amounts stay in the idle cash pool until used or carried forward.
                </p>
              )}
            </details>
          )}
        </>
      ) : (
        <p className="hint">No projection years are available.</p>
      )}
    </section>
  );
}
