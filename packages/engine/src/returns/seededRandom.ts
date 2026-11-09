/**
 * mulberry32 — the engine's single allowed randomness source.
 *
 * Determinism law: ALL randomness enters through an injected `Rand` function produced
 * here; `Math.random` is never used anywhere in the engine. Identical seeds always
 * produce identical streams, which is what makes Monte Carlo runs reproducible.
 */
export type Rand = () => number;

export function seededRandom(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
