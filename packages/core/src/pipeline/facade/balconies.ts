import type { Rng } from '../../rng';
import type { FacadeTile, RowKind } from '../../styles/types';
import type { ResolvedBalcony, WallContext, WallSegment } from '../../types';

/** Cells narrower than this get no balcony: the door and slab would not fit. */
const MIN_CELL_WIDTH = 1.6;

/** What the balcony pass needs to know about a facade cell. */
export interface BalconyCell {
  wall: number;
  width: number;
  blocked: boolean;
  /** Index of a tile fixed before solving, or -1. */
  fixed: number;
}

export interface BalconyGrid {
  cells: readonly BalconyCell[];
  /** Columns per wall. */
  columns: readonly number[];
  /** Row kind per storey, bottom to top. */
  rowKinds: readonly RowKind[];
  cellAt: (wall: number, row: number, column: number) => number;
}

/** A balcony in front of the cell; `left`/`right`: it continues into that neighbour. */
export interface CellBalcony {
  left: boolean;
  right: boolean;
}

/** Runs of consecutive true entries as [first, length]. */
function runs(flags: readonly boolean[]): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  flags.forEach((f, i) => {
    if (f && start < 0) start = i;
    if (!f && start >= 0) {
      out.push([start, i - start]);
      start = -1;
    }
  });
  if (start >= 0) out.push([start, flags.length - start]);
  return out;
}

/** Spans [first, length] of the balconies on one wall, from its free columns. */
function wallSpans(free: readonly boolean[], b: ResolvedBalcony, rng: Rng): [number, number][] {
  const all = runs(free);
  if (all.length === 0) return [];
  if (b.layout === 'band') return all;
  if (b.layout === 'single') {
    // The run nearest the wall's middle, the balcony centred in it.
    const mid = (free.length - 1) / 2;
    const dist = (r: [number, number]): number => Math.max(0, r[0] - mid, mid - (r[0] + r[1] - 1));
    const run = [...all].sort((a, b2) => dist(a) - dist(b2) || b2[1] - a[1])[0] as [number, number];
    const k = Math.min(b.span, run[1]);
    const slack = run[1] - k;
    const lean = slack % 2 === 1 && rng.fork('lean').chance(0.5) ? 1 : 0;
    return [[run[0] + Math.floor(slack / 2) + lean, k]];
  }
  // Rhythm: span, one bay gap, span ... centred in each run.
  const out: [number, number][] = [];
  for (const [first, length] of all) {
    const k = Math.min(b.span, length);
    const count = Math.floor((length + 1) / (k + 1));
    const used = count * k + (count - 1);
    const start = first + Math.floor((length - used) / 2);
    for (let i = 0; i < count; i++) out.push([start + i * (k + 1), k]);
  }
  return out;
}

/**
 * Turns window cells into balconies after the solve. The walls and bays are chosen
 * once per wall and repeated on every upper storey, so balconies always stack;
 * several neighbouring bays may share one balcony. `chosen` is updated in place
 * (balcony doors); the returned map holds the slab for each covered cell.
 */
export function placeBalconies(
  b: ResolvedBalcony,
  grid: BalconyGrid,
  walls: readonly WallSegment[],
  context: readonly WallContext[],
  tiles: readonly FacadeTile[],
  chosen: Int32Array,
  streetWall: number,
  rng: Rng,
): Map<number, CellBalcony> {
  const placed = new Map<number, CellBalcony>();
  const door = tiles.findIndex((t) => t.role === 'balcony');
  if (door < 0) return placed;
  const { cells, columns, rowKinds, cellAt } = grid;
  const doorTile = tiles[door] as FacadeTile;
  const rows: number[] = [];
  rowKinds.forEach((kind, r) => {
    if (kind !== 'ground' && doorTile.rows.includes(kind)) rows.push(r);
  });
  if (rows.length === 0) return placed;

  const eligible = (index: number): boolean => {
    const cell = cells[index] as BalconyCell;
    const tile = tiles[chosen[index] as number];
    return !cell.blocked && cell.fixed < 0 && cell.width >= MIN_CELL_WIDTH && tile?.role === 'window';
  };
  // A column takes a balcony only if it can on every upper storey.
  const freeColumns = walls.map((_, w) =>
    Array.from({ length: columns[w] as number }, (_, c) => rows.every((r) => eligible(cellAt(w, r, c)))),
  );

  // First wall: weighted by free bays; the street side counts a bit less (balconies face the garden).
  const scores = freeColumns.map((free, w) => {
    const n = free.filter(Boolean).length;
    const ctx = context[w] as WallContext;
    return n * (w === streetWall ? 0.6 : 1) * (ctx.courtyard ? 0.5 : 1);
  });
  const first = rng.fork('wall').weightedIndex(scores);
  if (first < 0 || (scores[first] as number) <= 0) return placed;
  const chosenWalls = [first];
  if (b.secondWall) {
    const n0 = (walls[first] as WallSegment).normal;
    let best = -1;
    let bestScore = 0;
    scores.forEach((s, w) => {
      const n = (walls[w] as WallSegment).normal;
      if (w === first || s <= bestScore || n[0] * n0[0] + n[1] * n0[1] > -0.5) return;
      best = w;
      bestScore = s;
    });
    if (best >= 0) chosenWalls.push(best);
  }

  for (const w of chosenWalls) {
    const spans = wallSpans(freeColumns[w] as boolean[], b, rng.fork('spans', w));
    // Shared balconies keep windows between the doors: one door for two bays, then every second bay.
    const side = rng.fork('doors', w).chance(0.5) ? 1 : 0;
    for (const [start, length] of spans) {
      for (let i = 0; i < length; i++) {
        const isDoor = length === 1 || (length === 2 ? i === side : i % 2 === 1);
        for (const r of rows) {
          const index = cellAt(w, r, start + i);
          placed.set(index, { left: i > 0, right: i < length - 1 });
          if (isDoor) chosen[index] = door;
        }
      }
    }
  }
  return placed;
}
