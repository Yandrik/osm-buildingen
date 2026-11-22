import { Rng, seedFrom } from '../../rng';
import { getStylePack } from '../../styles/registry';
import { type FacadeTile, type RowKind, type TileRole, evalCurve } from '../../styles/types';
import type {
  BuildingInput,
  FacadeCell,
  FacadeLayout,
  FacadeOpening,
  ResolvedSpec,
  WallContext,
  WallSegment,
} from '../../types';
import { GENERATOR_VERSION } from '../../version';
import { isBlocked } from '../context';
import { railSides } from '../platform';
import { type CellBalcony, placeBalconies } from './balconies';
import { DOWN, LEFT, RIGHT, type SolverProblem, UP, solve } from './solver';

/** Walls shorter than this get one cell that stays blank. */
const MIN_WALL = 1.2;
const MAX_ATTEMPTS = 8;
/**
 * Roles the solver may place on its own. Everything else is placed by the rules below;
 * balconies come after the solve (balconies.ts) so they line up storey by storey.
 */
const FREE_ROLES: readonly TileRole[] = ['blank', 'window'];

interface Cell extends FacadeCell {
  kind: RowKind;
  narrow: boolean;
  /** Index of a tile fixed before solving, or -1. */
  fixed: number;
  /** Set when a road passes through this cell: the openings, cell-local. */
  passage: FacadeOpening[] | null;
}

interface Tables {
  tiles: FacadeTile[];
  compat: Uint32Array[];
}

/** Tiles available on this building plus their compatibility masks. */
function buildTables(spec: ResolvedSpec): Tables {
  const style = getStylePack(spec.packId).types[spec.type];
  const tiles = style.tiles.filter((t) => !t.variant || t.variant === spec.facadeVariant);
  const n = tiles.length;
  const compat = [new Uint32Array(n), new Uint32Array(n), new Uint32Array(n), new Uint32Array(n)];
  for (let a = 0; a < n; a++) {
    const ta = tiles[a] as FacadeTile;
    for (let b = 0; b < n; b++) {
      const tb = tiles[b] as FacadeTile;
      // b to the right of a
      if ((style.sockets.h[ta.right] ?? []).includes(tb.left)) {
        (compat[RIGHT] as Uint32Array)[a] = ((compat[RIGHT] as Uint32Array)[a] as number) | (1 << b);
        (compat[LEFT] as Uint32Array)[b] = ((compat[LEFT] as Uint32Array)[b] as number) | (1 << a);
      }
      // b above a
      if ((style.sockets.v[ta.up] ?? []).includes(tb.down)) {
        (compat[UP] as Uint32Array)[a] = ((compat[UP] as Uint32Array)[a] as number) | (1 << b);
        (compat[DOWN] as Uint32Array)[b] = ((compat[DOWN] as Uint32Array)[b] as number) | (1 << a);
      }
    }
  }
  return { tiles, compat };
}

function buildCells(
  spec: ResolvedSpec,
  walls: WallSegment[],
  context: WallContext[],
): { cells: Cell[]; columns: number[] } {
  const cells: Cell[] = [];
  const columns: number[] = [];
  const levels = spec.levelHeights.length;
  // A part that starts above the ground (tower top, bridge) has no ground row.
  const grounded = spec.base < 0.5;
  walls.forEach((wall, w) => {
    const narrow = wall.length < MIN_WALL;
    const n = narrow ? 1 : Math.max(1, Math.round(wall.length / spec.bayWidth));
    columns.push(n);
    const width = wall.length / n;
    const ctx = context[w] as WallContext;
    let y = 0;
    for (let row = 0; row < levels; row++) {
      const height = spec.levelHeights[row] as number;
      const kind: RowKind =
        row === 0 && grounded ? 'ground' : row === levels - 1 && row > 0 ? 'top' : 'upper';
      for (let column = 0; column < n; column++) {
        const x = column * width;
        cells.push({
          wall: w,
          column,
          row,
          x,
          y,
          width,
          height,
          blocked: narrow || isBlocked(ctx, x, x + width, spec.base + y + height * 0.5),
          tile: '',
          kind,
          narrow,
          fixed: -1,
          passage: null,
          role: 'blank',
        });
      }
      y += height;
    }
  });
  return { cells, columns };
}

/** The columns an attached garage takes: `count` from one end of the sorted free columns. */
function garageCells(sorted: number[], fromLeft: boolean, count: number): number[] {
  return fromLeft ? sorted.slice(0, count) : sorted.slice(sorted.length - count);
}

/** Columns ordered from the middle outward: 2,1,3,0,4 for five columns. */
function centreOut(n: number, preferRight: boolean): number[] {
  const order: number[] = [];
  const mid = (n - 1) / 2;
  for (let c = 0; c < n; c++) order.push(c);
  return order.sort((a, b) => {
    const d = Math.abs(a - mid) - Math.abs(b - mid);
    if (Math.abs(d) > 1e-9) return d;
    return preferRight ? b - a : a - b;
  });
}

/**
 * Stage 4. Lays out the facade grid, applies the rules plain adjacency cannot
 * express (door, garage doors, shop front, symmetry) and lets the solver fill the rest.
 * See plan/pipeline/04-facade-wfc.md.
 */
export function layoutFacade(
  input: BuildingInput,
  spec: ResolvedSpec,
  walls: WallSegment[],
  context: WallContext[],
): FacadeLayout {
  // Roofs on posts have no walls to lay out.
  if (spec.type === 'canopy') return { cells: [], streetWall: -1, attempts: 0, fallback: false };
  const { tiles, compat } = buildTables(spec);
  const { cells, columns } = buildCells(spec, walls, context);
  const rng = new Rng(seedFrom(GENERATOR_VERSION, 'facade', input.seed));
  const levels = spec.levelHeights.length;

  const firstCell: number[] = [];
  {
    let offset = 0;
    for (const n of columns) {
      firstCell.push(offset);
      offset += n * levels;
    }
  }
  const cellAt = (wall: number, row: number, column: number): number =>
    (firstCell[wall] as number) + row * (columns[wall] as number) + column;

  const byRole = (role: TileRole, kind: RowKind, width: number): number =>
    tiles.findIndex((t) => t.role === role && t.rows.includes(kind) && (t.minWidth ?? 0) <= width);

  const grounded = spec.base < 0.5;
  const blankGround = tiles.findIndex((t) => t.role === 'blank' && t.blockedOk && t.rows.includes('ground'));

  // --- Passages: ground cells a road runs through become arch cells. ---
  if (grounded && blankGround >= 0) {
    walls.forEach((_, w) => {
      for (const span of (context[w] as WallContext).passages) {
        for (let c = 0; c < (columns[w] as number); c++) {
          const cell = cells[cellAt(w, 0, c)] as Cell;
          // The tunnel behind is real, so every cell the span touches must open, narrow ones too.
          if (span.to <= cell.x + 1e-3 || span.from >= cell.x + cell.width - 1e-3) continue;
          const opening: FacadeOpening = {
            from: span.openFrom - cell.x,
            to: span.openTo - cell.x,
            height: span.height,
            flat: span.flat,
            endFrom: span.from >= cell.x - 1e-6,
            endTo: span.to <= cell.x + cell.width + 1e-6,
            capFrom: span.capFrom && span.from >= cell.x - 1e-6,
            capTo: span.capTo && span.to <= cell.x + cell.width + 1e-6,
          };
          if (cell.passage) cell.passage.push(opening);
          else cell.passage = [opening];
          cell.fixed = blankGround; // solved as plain wall, drawn as an arch
        }
      }
    });
  }

  // --- Street wall: best street score, else the longest open wall. ---
  let streetWall = -1;
  let bestScore = 0;
  // Stations: the main entrance faces the town, not the tracks (the platform side gets a roof).
  const rail = spec.type === 'station' ? railSides(input, walls) : [];
  walls.forEach((wall, w) => {
    const ctx = context[w] as WallContext;
    if (wall.length < MIN_WALL) return;
    const hasFreeGround = Array.from(
      { length: columns[w] as number },
      (_, c) => cells[cellAt(w, 0, c)] as Cell,
    ).some((c) => !c.blocked && c.fixed < 0);
    if (!hasFreeGround) return;
    // Without roads every streetScore is 0, so fall back to open length; courtyards last.
    const score =
      (ctx.streetScore * 1000 + wall.length * ctx.openFraction * (ctx.courtyard ? 0.1 : 1)) *
      (rail[w] ? 0.001 : 1);
    if (score > bestScore + 1e-9) {
      bestScore = score;
      streetWall = w;
    }
  });

  const fix = (index: number, tile: number): boolean => {
    const cell = cells[index] as Cell;
    if (tile < 0 || cell.blocked || cell.fixed >= 0) return false;
    cell.fixed = tile;
    return true;
  };

  // Entrances are only placed on grounded buildings that want one.
  const wantsEntrance = grounded && input.entrance !== false;
  if (streetWall >= 0 && wantsEntrance) {
    const n = columns[streetWall] as number;
    const free = centreOut(n, rng.fork('side').chance(0.5)).filter((c) => {
      const cell = cells[cellAt(streetWall, 0, c)] as Cell;
      return !cell.blocked && cell.fixed < 0;
    });
    const width = (cells[cellAt(streetWall, 0, 0)] as Cell).width;
    const kind: RowKind = 'ground';
    const glazedGround = spec.shop || spec.type === 'office' || spec.type === 'skyscraper';

    if (spec.type === 'garage') {
      const garage = byRole('garage', kind, width);
      const count = Math.max(1, Math.min(free.length, Math.round(n * 0.8)));
      let placed = 0;
      for (const c of free) if (placed < count && fix(cellAt(streetWall, 0, c), garage)) placed++;
      if (placed === 0 && free.length > 0)
        fix(cellAt(streetWall, 0, free[0] as number), byRole('door', kind, width));
    } else if (spec.type === 'industrial') {
      const dock = byRole('dock', kind, width);
      const docks = Math.max(1, Math.min(3, Math.floor(free.length / 3)));
      // Docks spread out, person door near one end.
      const sorted = [...free].sort((a, b) => a - b);
      for (let i = 0; i < docks; i++) {
        const c = sorted[Math.floor(((i + 0.5) * sorted.length) / docks)];
        if (c !== undefined) fix(cellAt(streetWall, 0, c), dock);
      }
      const doorTile = byRole('door', kind, width);
      for (const c of sorted) if (fix(cellAt(streetWall, 0, c), doorTile)) break;
    } else if (glazedGround) {
      const shop = byRole('shop', kind, width);
      const shopDoor = byRole('shopdoor', kind, width);
      const door = byRole('door', kind, width);
      const sorted = [...free].sort((a, b) => a - b);
      if (spec.shop) {
        // House entrance at one end (if there is room), shop door in the middle, glass elsewhere.
        const end = rng.fork('entrance').chance(0.5) ? sorted[0] : sorted[sorted.length - 1];
        if (spec.type !== 'store' && sorted.length >= 3 && end !== undefined)
          fix(cellAt(streetWall, 0, end), door);
        const middle = free.find((c) => (cells[cellAt(streetWall, 0, c)] as Cell).fixed < 0);
        if (middle !== undefined) fix(cellAt(streetWall, 0, middle), shopDoor >= 0 ? shopDoor : door);
      } else if (free.length > 0) {
        fix(cellAt(streetWall, 0, free[0] as number), door);
      }
      for (const c of sorted) fix(cellAt(streetWall, 0, c), shop);
    } else if (free.length > 0) {
      // Attached garage: one or two doors at one end of the street wall, entrance beside them.
      if (spec.attachedGarage && free.length >= 3) {
        const garage = byRole('garage', kind, width);
        const sorted = [...free].sort((a, b) => a - b);
        const fromLeft = rng.fork('garageSide').chance(0.5);
        const doors = sorted.length >= 5 && rng.fork('garageCount').chance(0.5) ? 2 : 1;
        for (let i = 0; i < doors; i++) {
          const c = fromLeft ? sorted[i] : sorted[sorted.length - 1 - i];
          if (c !== undefined) fix(cellAt(streetWall, 0, c), garage);
        }
        for (const c of [...garageCells(sorted, fromLeft, doors)]) free.splice(free.indexOf(c), 1);
      }
      // Plain entrance. Symmetric buildings take the exact middle; others may sit one bay off.
      const pick = spec.symmetric || free.length < 3 ? 0 : rng.fork('doorColumn').weightedIndex([3, 1, 1]);
      fix(
        cellAt(streetWall, 0, free[Math.min(pick, free.length - 1)] as number),
        byRole('door', kind, width),
      );
    }
  }

  // --- Stores: one roller door for deliveries on the most open wall that is not the front. ---
  if (spec.type === 'store' && streetWall >= 0 && wantsEntrance) {
    const front = walls[streetWall] as WallSegment;
    let service = -1;
    let best = 0;
    walls.forEach((wall, w) => {
      if (w === streetWall || wall.ring !== 0) return;
      if (wall.normal[0] * front.normal[0] + wall.normal[1] * front.normal[1] > 0.5) return;
      const open = wall.length * (context[w] as WallContext).openFraction;
      if (open > best + 1e-9) {
        best = open;
        service = w;
      }
    });
    if (service >= 0) {
      const roller = byRole('garage', 'ground', (cells[cellAt(service, 0, 0)] as Cell).width);
      for (const c of centreOut(columns[service] as number, rng.fork('serviceSide').chance(0.5)))
        if (fix(cellAt(service, 0, c), roller)) break;
    }
  }

  // --- Solver problem ---
  const cellCount = cells.length;
  const neighbours = new Int32Array(cellCount * 4).fill(-1);
  const domains = new Uint32Array(cellCount);
  const weights = tiles.map((t) => Math.max(0, evalCurve(t.weight, spec.era)));
  cells.forEach((cell, index) => {
    const n = columns[cell.wall] as number;
    if (cell.column > 0) neighbours[index * 4 + LEFT] = index - 1;
    if (cell.column < n - 1) neighbours[index * 4 + RIGHT] = index + 1;
    if (cell.row < levels - 1) neighbours[index * 4 + UP] = index + n;
    if (cell.row > 0) neighbours[index * 4 + DOWN] = index - n;
    if (cell.fixed >= 0) {
      domains[index] = 1 << cell.fixed;
      return;
    }
    let mask = 0;
    tiles.forEach((t, ti) => {
      if (!FREE_ROLES.includes(t.role)) return;
      if (!t.rows.includes(cell.kind)) return;
      if ((t.minWidth ?? 0) > cell.width) return;
      if (cell.blocked && !t.blockedOk) return;
      if (cell.narrow && t.role !== 'blank') return;
      mask |= 1 << ti;
    });
    domains[index] = mask;
  });
  const problem: SolverProblem = { cellCount, neighbours, tileCount: tiles.length, compat, domains, weights };

  let attempts = 0;
  let result = solve(problem, rng.fork('solve', 0));
  while (!result.ok && attempts < MAX_ATTEMPTS) {
    attempts++;
    result = solve(problem, rng.fork('solve', attempts));
  }
  const fallback = !result.ok;
  const blankFor = (cell: Cell): number => {
    const i = tiles.findIndex((t) => t.role === 'blank' && t.blockedOk && t.rows.includes(cell.kind));
    return i >= 0 ? i : 0;
  };
  const chosen = new Int32Array(cellCount);
  cells.forEach((cell, index) => {
    if (cell.fixed >= 0) chosen[index] = cell.fixed;
    else chosen[index] = fallback ? blankFor(cell) : (result.tiles[index] as number);
  });

  // --- Symmetry on the street wall: mirror whole columns where that stays valid. ---
  if (spec.symmetric && streetWall >= 0 && !fallback) {
    const n = columns[streetWall] as number;
    const fits = (dir: number, a: number, b: number): boolean =>
      (((compat[dir] as Uint32Array)[a] as number) & (1 << b)) !== 0;
    for (let c = 0; c < Math.floor(n / 2); c++) {
      const m = n - 1 - c;
      const before: number[] = [];
      let ok = true;
      for (let row = 0; row < levels && ok; row++) {
        const src = cellAt(streetWall, row, c);
        const dst = cellAt(streetWall, row, m);
        before.push(chosen[dst] as number);
        const target = cells[dst] as Cell;
        const source = cells[src] as Cell;
        if (target.fixed >= 0 || source.fixed >= 0) continue; // fixed cells stay as they are
        if (target.blocked !== source.blocked) ok = false;
        else chosen[dst] = chosen[src] as number;
      }
      // Check the mirrored column against its neighbours and within itself.
      for (let row = 0; row < levels && ok; row++) {
        const dst = cellAt(streetWall, row, m);
        const t = chosen[dst] as number;
        if (m > 0 && !fits(RIGHT, chosen[dst - 1] as number, t)) ok = false;
        if (m < n - 1 && !fits(RIGHT, t, chosen[dst + 1] as number)) ok = false;
        if (row > 0 && !fits(UP, chosen[dst - n] as number, t)) ok = false;
      }
      if (!ok)
        for (let row = 0; row < before.length; row++)
          chosen[cellAt(streetWall, row, m)] = before[row] as number;
    }
  }

  // --- Balconies: whole storeys at once, after the solve and the mirroring. ---
  const rowKinds: RowKind[] = [];
  for (let row = 0; row < levels; row++) rowKinds.push((cells[cellAt(0, row, 0)] as Cell).kind);
  const balconies: Map<number, CellBalcony> =
    spec.balcony && !fallback && cells.length > 0
      ? placeBalconies(
          spec.balcony,
          { cells, columns, rowKinds, cellAt },
          walls,
          context,
          tiles,
          chosen,
          streetWall,
          rng.fork('balconies'),
        )
      : new Map();

  const out: FacadeCell[] = cells.map((cell, index) => ({
    wall: cell.wall,
    column: cell.column,
    row: cell.row,
    x: cell.x,
    y: cell.y,
    width: cell.width,
    height: cell.height,
    blocked: cell.blocked,
    ...(cell.passage
      ? {
          tile: '#arch',
          role: 'arch' as const,
          params: {
            from: (cell.passage[0] as FacadeOpening).from,
            to: (cell.passage[0] as FacadeOpening).to,
            height: (cell.passage[0] as FacadeOpening).height,
          },
          openings: cell.passage,
        }
      : {
          tile: (tiles[chosen[index] as number] as FacadeTile).id,
          role: (tiles[chosen[index] as number] as FacadeTile).role,
          ...(balconies.has(index) ? { balcony: balconies.get(index) } : {}),
        }),
  }));
  return { cells: out, streetWall: wantsEntrance ? streetWall : -1, attempts, fallback };
}
