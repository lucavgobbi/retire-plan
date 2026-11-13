import { describe, expect, it } from "vitest";
import { domainOf, stackedBandPaths, yScale } from "./svg";

/** Two positive stacked series at two x points — the minimal occlusion geometry. */
const TWO_SERIES = {
  xs: [0, 1],
  bands: [
    [100, 100], // bottom band: 100 everywhere
    [50, 50], // top band: 50 everywhere (cumulative upper 150)
  ],
};

describe("stackedBandPaths geometry", () => {
  it("confirms the occlusion bug before the fix: the upper band descends to the zero baseline", () => {
    const yDomain = domainOf([150]);
    const [bottomPath, topPath] = stackedBandPaths(TWO_SERIES.xs, TWO_SERIES.bands, yDomain);
    // The top band must fill ONLY its own slice [100, 150]; if its path anchors
    // at the zero baseline it paints over the bottom band (occlusion).
    expect(topPath).toBeTruthy();
    expect(topPath).not.toContain(formatY(0, yDomain)); // regression: touches baseline
    expect(topPath).toContain(formatY(100, yDomain)); // rides on the lower boundary
    expect(topPath).toContain(formatY(150, yDomain)); // reaches its own upper boundary
    expect(bottomPath).toContain(formatY(0, yDomain)); // bottom band still starts at zero
    expect(bottomPath).toContain(formatY(100, yDomain));
  });

  it("a zero middle series keeps later bands on their true lower boundary", () => {
    const yDomain = domainOf([200]);
    const [, zeroPath, topPath] = stackedBandPaths([0, 1], [[100, 100], [0, 0], [100, 100]], yDomain);
    // Zero band: degenerate (top == lower == 100), invisible but harmless.
    expect(zeroPath).toContain(formatY(100, yDomain));
    expect(zeroPath).not.toContain(formatY(0, yDomain));
    // Top band rides exactly on the cumulative 100 boundary, not the baseline.
    expect(topPath).toContain(formatY(100, yDomain));
    expect(topPath).toContain(formatY(200, yDomain));
    expect(topPath).not.toContain(formatY(0, yDomain));
  });

  it("a single isolated point renders a sliver within its own lower/upper slice", () => {
    const yDomain = domainOf([150]);
    // Second positive series with an isolated middle sample: its sliver must span
    // y(100)→y(150) — never down to the zero baseline (occlusion edge).
    const [, topPath] = stackedBandPaths([0, 1, 2], [[100, NaN, 100], [50, NaN, 50]], yDomain);
    const segments = topPath!.split("M").filter(Boolean);
    expect(segments.length).toBe(2); // two isolated points -> two slivers
    for (const segment of segments) {
      expect(segment).toContain(formatY(100, yDomain)); // lower boundary
      expect(segment).toContain(formatY(150, yDomain)); // upper boundary
      expect(segment).not.toContain(formatY(0, yDomain)); // no baseline anchor
    }
  });

  it("a zero-area single point invents no height", () => {
    const yDomain = domainOf([100]);
    const [, secondPath] = stackedBandPaths([0, 1, 2], [[100, NaN, 100], [0, NaN, 0]], yDomain);
    // Sliver spans its own zero-height slice (top == lower); nothing from the baseline.
    for (const segment of secondPath!.split("M").filter(Boolean)) {
      expect(segment).toContain(formatY(100, yDomain));
      expect(segment).not.toContain(formatY(0, yDomain));
    }
  });
});

function formatY(value: number, domain: [number, number]): string {
  return yScale(value, domain).toFixed(1); // mirrors the precision used inside stackedBandPaths
}
