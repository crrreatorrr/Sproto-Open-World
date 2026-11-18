import { fnv1a } from './hash';

/**
 * Seeded random streams (sfc32). Each stream is seeded from the world seed plus its own name, so
 * adding a stream never shifts the numbers another stream produces. The only randomness the sim
 * may use.
 */
export type RngState = [number, number, number, number];

export function seedStream(worldSeed: number, name: string): RngState {
  const a = fnv1a(`${worldSeed >>> 0}:${name}:a`);
  const b = fnv1a(`${worldSeed >>> 0}:${name}:b`);
  const c = fnv1a(`${worldSeed >>> 0}:${name}:c`);
  const s: RngState = [a, b, c, 1];
  // Warm up so similar seeds diverge.
  for (let i = 0; i < 12; i++) next(s);
  return s;
}

/** Next float in [0, 1). Mutates the state in place. */
export function next(s: RngState): number {
  let [a, b, c, d] = s;
  a >>>= 0;
  b >>>= 0;
  c >>>= 0;
  d >>>= 0;
  const t = (((a + b) >>> 0) + d) >>> 0;
  d = (d + 1) >>> 0;
  a = b ^ (b >>> 9);
  b = (c + (c << 3)) >>> 0;
  c = ((c << 21) | (c >>> 11)) >>> 0;
  c = (c + t) >>> 0;
  s[0] = a >>> 0;
  s[1] = b;
  s[2] = c;
  s[3] = d;
  return t / 4294967296;
}

/** Integer in [lo, hi]. */
export function range(s: RngState, lo: number, hi: number): number {
  return lo + Math.floor(next(s) * (hi - lo + 1));
}

export class Rng {
  readonly streams: Record<string, RngState> = {};
  constructor(readonly seed: number) {}

  stream(name: string): RngState {
    return (this.streams[name] ??= seedStream(this.seed, name));
  }

  float(name: string): number {
    return next(this.stream(name));
  }
}
