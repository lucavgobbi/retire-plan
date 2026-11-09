import { describe, expect, it } from "vitest";
import { seededRandom } from "../../src/returns/seededRandom";

// Reference: mulberry32 — the engine's ONLY randomness source. No Math.random anywhere
// in the engine. Determinism law: identical seeds must produce identical streams.

describe("seededRandom (mulberry32)", () => {
  it("is reproducible: two instances with the same seed emit identical streams", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqB).toEqual(seqA);
  });

  it("different seeds emit different streams", () => {
    const seq = (seed: number) => {
      const r = seededRandom(seed);
      return Array.from({ length: 4 }, () => r());
    };
    expect(seq(1)).not.toEqual(seq(2));
  });

  it("every draw lies in [0, 1)", () => {
    const r = seededRandom(7);
    for (let i = 0; i < 2_000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
