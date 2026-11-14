/**
 * Account flows: per-year bars with contributions stacked ABOVE zero and
 * withdrawals stacked BELOW zero. The YearResult magnitudes are all positive;
 * the below-zero placement is the chart's presentation of the outflow — it is
 * not negative wealth and must not be read as balances.
 */
import { domainOf, fmtTick, H, PAD, W, ticks, xScale, yScale } from "./svg";
import { STACK_COLORS } from "./palette";
import type { AccountFlowPoint } from "./adapters";

/** Explicit adapter-key → display-label mapping (labels are not object keys). */
const FLOWS: { key: "tfsa" | "rrsp" | "nonreg" | "cash"; label: string }[] = [
  { key: "tfsa", label: "TFSA" },
  { key: "rrsp", label: "RRSP" },
  { key: "nonreg", label: "Non-registered" },
  { key: "cash", label: "Cash" },
];

export function AccountFlowsChart({ points }: { points: AccountFlowPoint[] }) {
  const xs = points.map((p) => p.x);
  const firstX = xs[0];
  const lastX = xs[xs.length - 1];
  if (xs.length === 0 || firstX === undefined || lastX === undefined) return <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label="No data" role="img" />;
  const xDomain: [number, number] = [firstX, lastX];
  const parts = (p: AccountFlowPoint) => [...FLOWS.map((f) => p.contributions[f.key]), ...FLOWS.map((f) => p.withdrawals[f.key])];
  const totals = points.map((p) => {
    const values = parts(p);
    return values.every(Number.isFinite)
      ? { in: FLOWS.reduce((sum, f) => sum + p.contributions[f.key], 0), out: FLOWS.reduce((sum, f) => sum + p.withdrawals[f.key], 0) }
      : null;
  });
  const yDomain = domainOf([...totals.map((t) => (t ? t.in : NaN)), ...totals.map((t) => (t ? -t.out : NaN)), 0]);
  const yTicks = ticks(yDomain[0], yDomain[1]);

  // Bar geometry: centred on each age, width = 62% of the smallest age step.
  const steps = xs.slice(1).map((x, i) => x - (xs[i] ?? x)).filter((s) => s > 0);
  const step = steps.length > 0 ? Math.min(...steps) : 1;
  const plotWidth = W - PAD.left - PAD.right;
  const barWidth = Math.min(48, Math.max(4, (step / Math.max(1, xDomain[1] - xDomain[0])) * plotWidth * 0.62));
  const zeroY = yScale(0, yDomain);

  return (
    <svg className="financial-chart" width="100%" viewBox={`0 0 ${W} ${H}`} aria-label={`Annual account flows by age: contributions above zero (${FLOWS.map((f) => f.label).join(", ")}), withdrawals below zero`} role="img">
      <title>Contributions vs withdrawals by account over age</title>
      <desc>Bars per age: money contributed into TFSA, RRSP, non-registered and cash accounts stacked above zero; money withdrawn stacked below zero. Withdrawal bars show actual outflows, not negative wealth.</desc>
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
      {points.map((p, pointIndex) => {
        const cx = xScale(p.x, xDomain);
        const left = cx - barWidth / 2;
        if (!totals[pointIndex]) return null;
        // Contributions stack upward from zero: segment s spans (cum − v) → cum.
        const up: number[] = [];
        let acc = 0;
        for (const flow of FLOWS) {
          acc += Math.max(0, p.contributions[flow.key]);
          up.push(acc);
        }
        // Withdrawals stack downward from zero: segment s spans −down[s−1] → −down[s]
        // (consecutive, non-overlapping below-zero segments sharing boundaries).
        const down: number[] = [];
        acc = 0;
        for (const flow of FLOWS) {
          acc += Math.max(0, p.withdrawals[flow.key]);
          down.push(acc);
        }
        return (
          <g key={p.x} data-bar-age={p.x}>
            {up.map((cum, s) => {
              const v = p.contributions[FLOWS[s]!.key];
              return v > 0 ? (
                <rect key={FLOWS[s]!.key} x={left} width={barWidth} y={yScale(cum, yDomain)} height={Math.max(0, yScale(cum - v, yDomain) - yScale(cum, yDomain))} fill={STACK_COLORS[s % STACK_COLORS.length]} data-series={`${FLOWS[s]!.label} contributions`}>
                  <title>{`${FLOWS[s]!.label} contributions: ${fmtTick(v)}`}</title>
                </rect>
              ) : null;
            })}
            {down.map((cum, s) => {
              const v = p.withdrawals[FLOWS[s]!.key];
              if (!(v > 0)) return null;
              const prev = s === 0 ? 0 : down[s - 1]!;
              return (
                <rect key={FLOWS[s]!.key} x={left} width={barWidth} y={yScale(-prev, yDomain)} height={Math.max(0, yScale(-cum, yDomain) - yScale(-prev, yDomain))} fill={STACK_COLORS[s % STACK_COLORS.length]} fillOpacity="0.35" data-series={`${FLOWS[s]!.label} withdrawals`}>
                  <title>{`${FLOWS[s]!.label} withdrawals: ${fmtTick(v)}`}</title>
                </rect>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
