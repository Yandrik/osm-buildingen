import type { Rng } from '../../rng';

/** Directions used for neighbour and compatibility tables. */
export const LEFT = 0;
export const RIGHT = 1;
export const UP = 2;
export const DOWN = 3;

export interface SolverProblem {
  cellCount: number;
  /** 4 entries per cell (LEFT, RIGHT, UP, DOWN): neighbour cell index or -1. */
  neighbours: Int32Array;
  tileCount: number;
  /** compat[direction][tile] = bitmask of tiles allowed in the neighbour in that direction. */
  compat: readonly Uint32Array[];
  /** Initial bitmask of allowed tiles per cell. */
  domains: Uint32Array;
  /** Weight per tile (same for every cell). */
  weights: readonly number[];
}

export interface SolverResult {
  /** Tile index per cell, or -1 where no tile could be placed. */
  tiles: Int32Array;
  ok: boolean;
}

function popcount(v: number): number {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Shrinks neighbours' domains until nothing changes. Returns false on a contradiction. */
function propagate(problem: SolverProblem, domains: Uint32Array, stack: number[]): boolean {
  const { neighbours, compat, tileCount } = problem;
  while (stack.length > 0) {
    const cell = stack.pop() as number;
    const domain = domains[cell] as number;
    for (let dir = 0; dir < 4; dir++) {
      const other = neighbours[cell * 4 + dir] as number;
      if (other < 0) continue;
      let allowed = 0;
      const table = compat[dir] as Uint32Array;
      for (let t = 0; t < tileCount; t++) if (domain & (1 << t)) allowed |= table[t] as number;
      const before = domains[other] as number;
      const after = before & allowed;
      if (after === before) continue;
      if (after === 0) return false;
      domains[other] = after;
      stack.push(other);
    }
  }
  return true;
}

/**
 * Wave function collapse on an arbitrary cell graph.
 * Deterministic: lowest option count first, ties by cell index, tile by weight from `rng`.
 * One pass, no backtracking; the caller restarts with another seed on failure.
 */
export function solve(problem: SolverProblem, rng: Rng): SolverResult {
  const { cellCount, tileCount, weights } = problem;
  const domains = problem.domains.slice();
  const tiles = new Int32Array(cellCount).fill(-1);

  const all: number[] = [];
  for (let c = cellCount - 1; c >= 0; c--) {
    if (domains[c] === 0) return { tiles, ok: false };
    all.push(c);
  }
  if (!propagate(problem, domains, all)) return { tiles, ok: false };

  const scratch = new Array<number>(tileCount).fill(0);
  for (;;) {
    let best = -1;
    let bestCount = 99;
    for (let c = 0; c < cellCount; c++) {
      if (tiles[c] !== -1) continue;
      const count = popcount(domains[c] as number);
      if (count < bestCount) {
        bestCount = count;
        best = c;
        if (count === 1) break;
      }
    }
    if (best < 0) break;

    const domain = domains[best] as number;
    let any = false;
    for (let t = 0; t < tileCount; t++) {
      const w = domain & (1 << t) ? (weights[t] as number) : 0;
      scratch[t] = w;
      if (w > 0) any = true;
    }
    // If every remaining option has weight 0, treat them as equally likely.
    if (!any) for (let t = 0; t < tileCount; t++) scratch[t] = domain & (1 << t) ? 1 : 0;
    const choice = rng.weightedIndex(scratch);
    if (choice < 0) return { tiles, ok: false };
    tiles[best] = choice;
    domains[best] = 1 << choice;
    if (!propagate(problem, domains, [best])) return { tiles, ok: false };
  }
  return { tiles, ok: true };
}
