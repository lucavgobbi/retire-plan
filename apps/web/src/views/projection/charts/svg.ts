/** Minimal SVG chart scaffolding — pure functions, no chart dependency. */

export interface Point {
  x: number;
  y: number | null;
}

export const W = 560;
export const H = 240;
export const PAD = { top: 18, right: 22, bottom: 28, left: 84 };

export function xScale(x: number, domain: [number, number]): number {
  const [lo, hi] = domain;
  if (hi === lo) return PAD.left + (W - PAD.left - PAD.right) / 2;
  return PAD.left + ((x - lo) / (hi - lo)) * (W - PAD.left - PAD.right);
}

export function yScale(y: number, domain: [number, number]): number {
  const [lo, hi] = domain;
  const height = H - PAD.top - PAD.bottom;
  if (hi === lo) return PAD.top + height / 2;
  return PAD.top + (1 - (y - lo) / (hi - lo)) * height;
}

export function domainOf(values: number[]): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) return [0, 1];
  const lo = Math.min(0, ...finite);
  const hi = Math.max(0, ...finite);
  return hi === lo ? [lo, lo + 1] : [lo, hi];
}

/** 5 friendly ticks across a domain. */
export function ticks(lo: number, hi: number, count = 5): number[] {
  const step = (hi - lo) / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, i) => lo + step * i);
}

/** Compact money tick label (k / M). */
export function fmtTick(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return `${value.toFixed(0)}`;
}

/** Polyline points string, skipping null y values (non-finite rule at render). */
export function polylinePoints(points: Point[], xDomain: [number, number], yDomain: [number, number]): string {
  return points
    .filter((p): p is { x: number; y: number } => p.y !== null && Number.isFinite(p.y))
    .map((p) => `${xScale(p.x, xDomain).toFixed(1)},${yScale(p.y, yDomain).toFixed(1)}`)
    .join(" ");
}

/**
 * Stacked area bands. `bands` are per-series values (NOT cumulative); non-finite
 * values contribute nothing and split the band into contiguous segments. Returns one
 * closed SVG path `d` per band, bottom band first.
 */
export function stackedBandPaths(xs: number[], bands: number[][], yDomain: [number, number]): string[] {
  const cum: number[] = xs.map(() => 0);
  const cumulative: number[][] = bands.map((band) => {
    const next: number[] = [];
    for (let i = 0; i < xs.length; i++) {
      const raw = band[i];
      const value = raw !== undefined && Number.isFinite(raw) ? raw : 0;
      // A non-finite sample is a GAP: this band's cumulative becomes NaN here and
      // NaN propagates to every later band at that index (NaN + value = NaN), so a
      // lower boundary never silently drops to zero and invents coverage.
      const prev = cum[i] ?? 0;
      const isGap = raw === undefined || !Number.isFinite(raw);
      cum[i] = isGap ? NaN : (Number.isFinite(prev) ? prev + value : NaN);
      next.push(cum[i] ?? NaN);
    }
    return next;
  });
  return cumulative.map((upper, bandIndex) => {
    const lower =
      bandIndex === 0
        ? xs.map(() => 0)
        : (cumulative[bandIndex - 1] ?? []);
    const firstX = xs[0];
    const lastX = xs[xs.length - 1];
    if (firstX === undefined || lastX === undefined) return "";
    const xDomain: [number, number] = [firstX, lastX];
    const segments: string[] = [];
    let open: { top: string; bottom: string }[] = [];
    const flush = () => {
      if (open.length > 1) {
        segments.push(bandPath(open.map((point) => point.top), open.map((point) => point.bottom)));
      } else if (open.length === 1) {
        // Single (non-adjacent) point: render a 3px-wide sliver spanning the band's
        // OWN lower→upper slice (never down to the baseline — zero-area stays zero,
        // lower bands are not covered).
        const px = (open[0]!.bottom.split(",")[0] ?? "0");
        const topY = open[0]!.top.split(",")[1] ?? "0";
        const bottomY = open[0]!.bottom.split(",")[1] ?? "0";
        segments.push(`M${px},${bottomY} L${px},${topY} L${Number(px) + 3},${topY} L${Number(px) + 3},${bottomY} Z`);
      }
      open = [];
    };
    for (let i = 0; i < xs.length; i++) {
      const up = upper[i];
      const low = lower[i];
      const x = xs[i];
      if (x !== undefined && up !== undefined && low !== undefined && Number.isFinite(up) && Number.isFinite(low)) {
        const px = xScale(x, xDomain).toFixed(1);
        open.push({
          top: `${px},${yScale(up, yDomain).toFixed(1)}`,
          bottom: `${px},${yScale(low, yDomain).toFixed(1)}`,
        });
      } else {
        flush();
      }
    }
    flush();
    return segments.join(" ");
  });
}

/** Closes one stacked band: top edge left→right, then BACK along the lower boundary —
 * each band fills only its own slice [lower, upper] and never occludes the bands below. */
function bandPath(topPoints: string[], bottomPoints: string[]): string {
  if (topPoints.length === 0 || bottomPoints.length === 0) return "";
  const reversed = [...bottomPoints].reverse();
  return `M${topPoints.join(" L")} L${reversed.join(" L")} Z`;
}
