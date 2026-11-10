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
      const prev = cum[i] ?? 0;
      cum[i] = prev + value;
      next.push(cum[i] ?? 0);
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
    let open: string[] = [];
    const flush = () => {
      if (open.length > 1) {
        segments.push(closedPath(open, yDomain));
      } else if (open.length === 1 && open[0] !== undefined) {
        // Single (non-adjacent) point: render a 3px-wide sliver so the band is visible.
        const parts = open[0].split(",");
        const px = parts[0] ?? "0";
        const py = parts[1] ?? "0";
        const baseline = yScale(0, yDomain).toFixed(1);
        segments.push(`M${px},${baseline} L${px},${py} L${Number(px) + 3},${py} L${Number(px) + 3},${baseline} Z`);
      }
      open = [];
    };
    for (let i = 0; i < xs.length; i++) {
      const up = upper[i];
      const low = lower[i];
      const x = xs[i];
      if (x !== undefined && up !== undefined && low !== undefined && Number.isFinite(up) && Number.isFinite(low)) {
        open.push(`${xScale(x, xDomain).toFixed(1)},${yScale(up, yDomain).toFixed(1)}`);
      } else {
        flush();
      }
    }
    flush();
    return segments.join(" ");
  });
}

/** Builds a closed area: top points left→right, then back along the zero baseline. */
function closedPath(topPoints: string[], yDomain: [number, number]): string {
  const firstParts = topPoints[0]?.split(",");
  const lastParts = topPoints[topPoints.length - 1]?.split(",");
  if (!firstParts || !lastParts) return "";
  const baseline = yScale(0, yDomain).toFixed(1);
  return `M${firstParts[0]},${baseline} L${topPoints.join(" L")} L${lastParts[0]},${baseline} Z`;
}
