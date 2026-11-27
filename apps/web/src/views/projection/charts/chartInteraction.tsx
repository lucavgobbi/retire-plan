/**
 * Shared chart interaction — ONE bounded mechanism reused by all seven
 * projection charts (no per-chart duplicated logic, no new engine/library).
 *
 * Pointer/tap/focus is mapped through the chart's RENDERED SVG rect into
 * viewBox units, then through the inverse of the chart's ACTUAL x-scale
 * domain (same PAD, so one-point charts match their centred scale) to the
 * nearest real age point. Keyboard (Arrow/Home/End, Escape) navigates the
 * same index; a live region announces values only for keyboard navigation.
 *
 * The tooltip is a bounded card inside the chart's plot box, clamped to the
 * measured container box (not a heuristic), pointer-events: none so it never
 * blocks the chart, its ⓘ help or toolbar controls. Labels say "Age N" — the
 * chart points carry age only; no calendar year is invented.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import { fmtMoney, fmtPercent } from "../fmt";
import { H, PAD, W } from "./svg";
import "./chartInteraction.css";

/** One tooltip row: the raw series value formatted per `format` — "money" (default;
 * accurate zeros, negatives and currency units), "percent" (0..1 fractions) or
 * "count" (plain integer, e.g. simulated path counts). */
export interface TooltipRow {
  label: string;
  value: number;
  format?: "money" | "percent" | "count";
}

const PLOT_WIDTH = W - PAD.left - PAD.right;

/** Cumulative stack tops (band upper edges) for marker dots — same NaN-gap rule
 * as `stackedBandPaths`: a non-finite sample makes this and every later top NaN,
 * and `ChartMarkers` omits non-finite coords rather than inventing a zero point. */
export function stackTops(values: number[]): number[] {
  const tops: number[] = [];
  let acc = 0;
  for (const v of values) {
    if (Number.isFinite(v)) acc = v > 0 ? acc + v : acc;
    else acc = NaN;
    tops.push(acc);
  }
  return tops;
}

function nearestIndex(xs: number[], dataX: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = Math.abs(xs[i]! - dataX);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export interface ChartInteraction {
  /** Index into the chart's `points` of the active (hovered/tapped/focused) age, or null. */
  active: number | null;
  /** True while the active point was reached via keyboard (drives the live region). */
  keyboard: boolean;
  /** Spread onto the chart's <svg>; the early "No data" return path spreads nothing. */
  svgProps: ComponentPropsWithoutRef<"svg">;
}

export function useChartInteraction(xs: number[], xDomain: readonly [number, number]): ChartInteraction {
  const [active, setActive] = useState<number | null>(null);
  const [keyboard, setKeyboard] = useState(false);
  const touching = useRef(false);

  // A new dataset (new run: shorter, longer, empty, or SAME LENGTH with different
  // ages) invalidates the stored index synchronously DURING RENDER — before any
  // consumer effect or `points[active]` access — so a stale index can never point
  // outside the current dataset or describe a point that no longer exists.
  const xsKey = xs.join(",");
  const [lastKey, setLastKey] = useState(xsKey);
  if (xsKey !== lastKey) {
    setLastKey(xsKey);
    setActive(null);
    setKeyboard(false);
  }
  // Clamp against the CURRENT dataset as well (defence in depth).
  const safeActive = active === null || xs.length === 0 ? null : Math.min(active, xs.length - 1);

  // Pointer (client px) → viewBox units → data x via the chart's own domain → nearest age.
  const locate = (clientX: number, el: Element) => {
    if (xs.length === 0) return;
    const rect = el.getBoundingClientRect();
    // jsdom/tests report a 0-size box: fall back to the viewBox so dispatched
    // coordinates remain meaningful (clientX is then a viewBox unit).
    const width = rect.width > 0 ? rect.width : W;
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / width));
    const localVB = t * W;
    const [lo, hi] = xDomain;
    const dataX = hi > lo ? lo + ((localVB - PAD.left) / PLOT_WIDTH) * (hi - lo) : (xs[0] ?? 0);
    setActive(nearestIndex(xs, dataX));
  };

  const move = (delta: number) => {
    if (xs.length === 0) return;
    setActive((current) => {
      const from =
        current === null ? (delta > 0 ? 0 : xs.length - 1) : Math.min(xs.length - 1, Math.max(0, current + delta));
      return from;
    });
  };

  const svgProps: ComponentPropsWithoutRef<"svg"> = {
    tabIndex: 0,
    onPointerMove: (event) => {
      if (event.pointerType === "touch" && !touching.current) return; // touch interacts on tap/drag only
      setKeyboard(false);
      locate(event.clientX, event.currentTarget);
    },
    onPointerDown: (event) => {
      touching.current = event.pointerType === "touch";
      setKeyboard(false);
      locate(event.clientX, event.currentTarget);
    },
    onPointerUp: () => {
      touching.current = false; // tap keeps the tooltip visible until the next tap / blur
    },
    onPointerLeave: (event) => {
      touching.current = false;
      // Touch fires pointerleave after pointerup — don't dismiss the tapped tooltip.
      if (event.pointerType !== "touch") setActive(null);
    },
    onKeyDown: (event) => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End")
        event.preventDefault();
      if (event.key === "ArrowLeft") {
        setKeyboard(true);
        move(-1);
      } else if (event.key === "ArrowRight") {
        setKeyboard(true);
        move(1);
      } else if (event.key === "Home") {
        setKeyboard(true);
        setActive(xs.length > 0 ? 0 : null);
      } else if (event.key === "End") {
        setKeyboard(true);
        setActive(xs.length > 0 ? xs.length - 1 : null);
      } else if (event.key === "Escape") {
        setActive(null);
      } // dismiss, keep focus
    },
    onFocus: () => {
      if (active === null) {
        setKeyboard(true);
        setActive(xs.length > 0 ? 0 : null);
      }
    },
    onBlur: () => {
      setKeyboard(false);
      setActive(null);
    },
  };

  return { active: safeActive, keyboard, svgProps };
}

/** Vertical crosshair at the active age (aria-hidden — decorative reinforcement of the tooltip). */
export function ChartCrosshair({ x }: { x: number }) {
  return (
    <line x1={x} x2={x} y1={PAD.top} y2={H - PAD.bottom} className="chart-interaction-crosshair" aria-hidden="true" />
  );
}

/** Marker dots at series positions for the active age (coords supplied by each chart from its own scales).
 * Non-finite coords are omitted — never fabricated as zero points. */
export function ChartMarkers({ coords }: { coords: { cx: number; cy: number; color: string }[] }) {
  const finite = coords.filter((c) => Number.isFinite(c.cx) && Number.isFinite(c.cy));
  return (
    <>
      {finite.map((c, i) => (
        <circle
          key={i}
          cx={c.cx}
          cy={c.cy}
          r={3.5}
          fill={c.color}
          stroke="#fff"
          strokeWidth={1}
          className="chart-interaction-marker"
          aria-hidden="true"
        />
      ))}
    </>
  );
}

/**
 * Bounded tooltip card + keyboard live region. The card is clamped to the
 * measured plot box (real offsetWidth/clientWidth — no percentage heuristic),
 * so wide tooltips cannot leak out of the chart on mobile.
 */
export function ChartTooltip({
  age,
  calendarYear,
  rows,
  fraction,
  keyboard,
}: {
  /** Active age (points carry age only — never an invented calendar year). */
  age: number;
  calendarYear?: number;
  rows: TooltipRow[];
  /** Horizontal anchor as a fraction of the plot box width (0..1). */
  fraction: number;
  keyboard: boolean;
}) {
  const tipRef = useRef<HTMLDivElement | null>(null);
  const title = calendarYear === undefined ? `Age ${age}` : `${calendarYear} (age ${age})`;
  const text = (row: TooltipRow) =>
    row.format === "percent"
      ? fmtPercent(row.value)
      : row.format === "count"
        ? Number.isFinite(row.value)
          ? `${row.value}`
          : "—"
        : fmtMoney(row.value);

  useLayoutEffect(() => {
    const el = tipRef.current;
    const container = el?.parentElement;
    if (!el || !container) return;
    // Clamp the card inside the MEASURED plot box (real offsetWidth/clientWidth —
    // no percentage heuristic), re-measured on container resize (width changes
    // move the clamp; card text/font width is re-read on every apply).
    const apply = () => {
      const cw = container.clientWidth;
      const tw = el.offsetWidth;
      const raw = fraction * cw - tw / 2;
      const clamped = Math.min(Math.max(raw, 6), Math.max(6, cw - tw - 6));
      el.style.left = `${clamped}px`;
    };
    apply();
    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(apply);
      observer.observe(container);
    }
    return () => observer?.disconnect();
  }, [fraction, age, rows]);

  if (rows.length === 0) return null;

  return (
    <>
      {keyboard && (
        <span className="chart-interaction-live" role="status">
          {`${title}: ${rows.map((row) => `${row.label} ${text(row)}`).join(", ")}`}
        </span>
      )}
      {/* Visual-only card; the live region above carries the announced content. */}
      <div ref={tipRef} className="chart-interaction-tooltip" aria-hidden="true" style={{ left: `${fraction * 100}%` }}>
        <p className="chart-interaction-tooltip-title">{title}</p>
        <dl>
          {rows.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{text(row)}</dd>
            </div>
          ))}
        </dl>
      </div>
    </>
  );
}
