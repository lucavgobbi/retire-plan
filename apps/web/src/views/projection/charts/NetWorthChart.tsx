/**
 * Projected net worth — stacked BARS by account/asset type (user item 4).
 *
 * Truthful arithmetic: the stacked positive segments are what the household OWNS
 * (financial account balances + home + other assets, exactly the engine's
 * `balances` fields); DEBT is drawn as a segment BELOW zero (owed money is never
 * stacked as owned); the short marker on each bar is the year's true NET worth —
 * the engine's `netWorth`, which equals the owned stack minus debt. Nothing is
 * recomputed differently from the engine results.
 */
import type { NetWorthBarPoint } from "./adapters";
import { H, PAD, W, domainOf, fmtTick, ticks, xScale, yScale } from "./svg";
import { PALETTE, STACK_COLORS } from "./palette";

const OWNED_SERIES = ["TFSA", "RRSP", "Non-registered", "Cash", "Home", "Other assets"] as const;

function ownedValues(p: NetWorthBarPoint): number[] {
  return [
    Number.isFinite(p.tfsa) ? p.tfsa : 0,
    Number.isFinite(p.rrsp) ? p.rrsp : 0,
    Number.isFinite(p.nonreg) ? p.nonreg : 0,
    Number.isFinite(p.cash) ? p.cash : 0,
    Number.isFinite(p.home) ? p.home : 0,
    Number.isFinite(p.otherAssets) ? p.otherAssets : 0,
  ];
}

export function NetWorthChart({ points }: { points: NetWorthBarPoint[] }) {
  const xs = points.map((p) => p.x);
  const firstX = xs[0];
  const lastX = xs[xs.length - 1];
  if (xs.length === 0 || firstX === undefined || lastX === undefined) {
    return <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="No data" role="img" />;
  }
  const xDomain: [number, number] = [firstX, lastX];
  const stacks = points.map(ownedValues);
  const stackTotals = stacks.map((s) => s.reduce((a, b) => a + b, 0));
  const debts = points.map((p) => (Number.isFinite(p.debt) ? Math.max(0, p.debt) : 0));
  const yDomain = domainOf([...stackTotals, ...debts.map((d) => -d)]);
  const yTicks = ticks(yDomain[0], yDomain[1]);

  // Bar geometry: centred on each age, width = 62% of the smallest age step.
  const steps = xs.slice(1).map((x, i) => x - (xs[i] ?? x)).filter((s) => s > 0);
  const step = steps.length > 0 ? Math.min(...steps) : 1;
  const plotWidth = W - PAD.left - PAD.right;
  const barWidth = Math.min(48, Math.max(4, (step / Math.max(1, xDomain[1] - xDomain[0])) * plotWidth * 0.62));
  const zeroY = yScale(0, yDomain);

  return (
    <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label={`Stacked net-worth components by age: owned accounts and assets above zero, debt below zero, with the net worth marker`} role="img">
      <title>Projected net worth by account type over age</title>
      <desc>Stacked bars of owned balances (TFSA, RRSP, non-registered, cash, home, other assets) above zero and debt below zero; the marker on each bar is net worth, the owned stack minus debt.</desc>
      {yTicks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={yScale(t, yDomain)} y2={yScale(t, yDomain)} className="chart-gridline" />
          <text x={PAD.left - 6} y={yScale(t, yDomain) + 3} textAnchor="end" className="chart-tick">
            {fmtTick(t)}
          </text>
        </g>
      ))}
      {ticks(xDomain[0], xDomain[1]).map((t) => (
        <text key={t} x={xScale(t, xDomain)} y={H - 6} textAnchor="middle" className="chart-tick">
          {Math.round(t)}
        </text>
      ))}
      {points.map((p, i) => {
        const cx = xScale(p.x, xDomain);
        const left = cx - barWidth / 2;
        const owned = stacks[i] ?? [];
        const cum: number[] = [];
        let acc = 0;
        for (const v of owned) {
          acc += Math.max(0, v);
          cum.push(acc);
        }
        const debt = debts[i] ?? 0;
        return (
          <g key={p.x} data-bar-age={p.x}>
            {owned.map((v, s) =>
              v > 0 ? (
                <rect
                  key={OWNED_SERIES[s]}
                  x={left}
                  width={barWidth}
                  y={yScale(cum[s] ?? 0, yDomain)}
                  height={Math.max(0, yScale(cum[s - 1] ?? 0, yDomain) - yScale(cum[s] ?? 0, yDomain))}
                  fill={STACK_COLORS[s % STACK_COLORS.length]}
                  data-series={OWNED_SERIES[s]}
                >
                  <title>{`${OWNED_SERIES[s]}: ${fmtTick(v)}`}</title>
                </rect>
              ) : null,
            )}
            {debt > 0 && (
              <rect
                x={left}
                width={barWidth}
                y={zeroY}
                height={Math.max(0, yScale(-debt, yDomain) - zeroY)}
                fill={PALETTE.color5}
                fillOpacity="0.55"
                data-series="Debt"
              >
                <title>{`Debt (owed): ${fmtTick(debt)}`}</title>
              </rect>
            )}
            {Number.isFinite(p.netWorth) && (
              <line
                x1={left - 2}
                x2={left + barWidth + 2}
                y1={yScale(p.netWorth, yDomain)}
                y2={yScale(p.netWorth, yDomain)}
                stroke={PALETTE.ink}
                strokeWidth="2"
                data-series="Net worth"
              >
                <title>{`Net worth: ${fmtTick(p.netWorth)}`}</title>
              </line>
            )}
          </g>
        );
      })}
    </svg>
  );
}
