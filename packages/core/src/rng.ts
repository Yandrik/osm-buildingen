/**
 * Hashing and seeded random numbers.
 *
 * Everything random in the generator goes through this file. `Math.random` must
 * never be used in core: output has to be a pure function of the input.
 */

/** Mixes a 32-bit integer (murmur3 finaliser). */
function mix(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Hashes a string to an unsigned 32-bit integer (FNV-1a, then mixed). */
export function hashString(text: string, seed = 0): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return mix(h);
}

/**
 * Combines any number of strings and numbers into one unsigned 32-bit seed.
 * Numbers are quantised to 1/1000 so tiny float differences cannot change a seed.
 */
export function seedFrom(...parts: readonly (string | number)[]): number {
  let h = 0x9e3779b9;
  for (const part of parts) {
    const v = typeof part === 'number' ? mix(Math.round(part * 1000) | 0) : hashString(part);
    h = mix((h ^ v) + 0x9e3779b9 + ((h << 6) >>> 0) + (h >>> 2));
  }
  return h >>> 0;
}

/** Small, fast seeded generator (sfc32). */
export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number) {
    this.a = mix(seed ^ 0x1234567);
    this.b = mix(seed + 0x9e3779b9);
    this.c = mix(seed ^ 0xdeadbeef);
    this.d = 1;
    for (let i = 0; i < 12; i++) this.nextUint();
  }

  /** Derives an independent generator for a named decision. */
  fork(...parts: readonly (string | number)[]): Rng {
    return new Rng(seedFrom(this.a, this.b, ...parts));
  }

  nextUint(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    return this.nextUint() / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty list');
    return items[this.int(items.length)] as T;
  }

  /** Index chosen in proportion to the weights. Returns -1 if all weights are zero. */
  weightedIndex(weights: readonly number[]): number {
    let total = 0;
    for (const w of weights) total += w > 0 ? w : 0;
    if (total <= 0) return -1;
    let r = this.next() * total;
    let last = -1;
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i] as number;
      if (w <= 0) continue;
      last = i;
      r -= w;
      if (r < 0) return i;
    }
    return last;
  }

  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const index = this.weightedIndex(entries.map((e) => e[1]));
    if (index < 0) throw new Error('Rng.weighted: no positive weight');
    return (entries[index] as readonly [T, number])[0];
  }

  /**
   * Roughly normal with mean 0 and standard deviation 1.
   * Sum of uniforms, so no transcendental functions are involved.
   */
  gauss(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * Math.sqrt(3);
  }
}
