/**
 * Turns the buildings of one tile into generator inputs, grouped by ~200 m cells.
 *
 * Tags (height, levels, roof, colours, building parts) go through the OSM adapter's own
 * rules, so a building looks the same here as in the viewer. The full extract
 * (`data/osm/buildings`) has them; the Geofabrik free shapefile only has the building
 * value. Where height and levels are missing, dense Paris blocks get Haussmann-like
 * defaults (5-7 levels, mansard roofs, cream stone, zinc roofs) from the building
 * coverage of their cell.
 */
import type { BuildingInput, NeighbourInput, RoadInput, Vec2 } from '@osm-buildingen/core';
import {
  type Attributes,
  type Tags,
  classify,
  estimateHeight,
  partInput,
  readAttributes,
  skipReason,
  specialReason,
} from '@osm-buildingen/osm';
import { CELL, CELLS, lonLatToWorld, tileOrigin } from './frame';
import type { Line, OsmFeature, OsmTile, Poly, TaggedBuilding } from './osm-types';
import { hash2, ringArea } from './paint';
import { roadStyle } from './palette';

/** Landmarks the sim draws itself. */
export const CUSTOM_LANDMARKS = new Set([5013364]);

const PARIS_WALLS = ['#eadfc8', '#e4d6bb', '#efe6d3', '#ddd0b4', '#e8dac2', '#f0e8d8'];
const PARIS_ROOFS = ['#6f7c88', '#76838f', '#68737e'];
const CENTRE = lonLatToWorld(2.3488, 48.8534);
const NEIGHBOUR_DISTANCE = 3;

export interface CellInputs {
  cx: number;
  cy: number;
  inputs: BuildingInput[];
  /** Indices of inputs that stay at massing detail (landmarks: their shape comes from parts). */
  massingOnly: number[];
}

interface Building {
  b: TaggedBuilding;
  attrs: Attributes;
  special: string | undefined;
  box: [number, number, number, number];
  area: number;
  cx: number;
  cy: number;
}

type Height = (x: number, n: number) => number;

/** The free shapefile's buildings in the tagged form: only `building=*` and the name. */
export function shapefileBuildings(tile: OsmTile): TaggedBuilding[] {
  return (tile.buildings_a ?? []).map((f) => {
    const t: Tags = { building: typeof f.p?.type === 'string' ? f.p.type : 'yes' };
    if (f.n) t.name = f.n;
    return { id: f.id, t, g: f.g };
  });
}

export function buildingInputs(
  source: TaggedBuilding[],
  tile: OsmTile,
  tx: number,
  ty: number,
  height: Height,
): CellInputs[] {
  const origin = tileOrigin(tx, ty);
  const buildings: Building[] = [];
  for (const b of source) {
    if (skipReason(b.t) || CUSTOM_LANDMARKS.has(b.id)) continue;
    const outer = b.g[0];
    if (!outer || outer.length < 3) continue;
    const area = Math.abs(ringArea(outer));
    if (area < 4) continue;
    const box = ringBox(outer);
    const mx = (box[0] + box[2]) / 2;
    const my = (box[1] + box[3]) / 2;
    buildings.push({
      b,
      attrs: readAttributes(b.t),
      special: specialReason(b.t),
      box,
      area,
      cx: clampCell(Math.floor(mx / CELL)),
      cy: clampCell(Math.floor(my / CELL)),
    });
  }

  const coverage = new Float32Array(CELLS * CELLS);
  for (const b of buildings) coverage[b.cy * CELLS + b.cx] = (coverage[b.cy * CELLS + b.cx] ?? 0) + b.area;

  const bGrid = new Grid<Building>(50);
  for (const b of buildings) bGrid.add(b.box, b);
  const roads = (tile.roads ?? []).filter((r) => r.p?.tunnel !== 'T');
  const rGrid = new Grid<{ f: OsmFeature<Line>; box: [number, number, number, number] }>(80);
  for (const f of roads) {
    const box = ringBox(f.g);
    rGrid.add(box, { f, box });
  }

  const heightOf = (o: Building): number | undefined => {
    const own = estimateHeight(o.attrs);
    if (own !== undefined) return own;
    let max: number | undefined;
    for (const p of o.b.p ?? []) {
      const h = estimateHeight(readAttributes(p.t));
      if (h !== undefined && (max === undefined || h > max)) max = h;
    }
    return max;
  };

  const cells = new Map<number, CellInputs>();
  for (const b of buildings) {
    const ox = b.cx * CELL;
    const oy = b.cy * CELL;
    const local = (p: readonly [number, number]): Vec2 => [p[0] - ox, p[1] - oy];
    const polygon = (g: Poly): { outer: Vec2[]; holes?: Vec2[][] } => {
      const outer = (g[0] ?? []).map(local);
      const holes = g.slice(1).map((r) => r.map(local));
      return holes.length ? { outer, holes } : { outer };
    };

    const neighbours: NeighbourInput[] = [];
    for (const o of bGrid.query(b.box, NEIGHBOUR_DISTANCE)) {
      if (o === b || gap(o.box, b.box) > NEIGHBOUR_DISTANCE) continue;
      const nb: NeighbourInput = { footprint: { outer: (o.b.g[0] ?? []).map(local) } };
      const h = heightOf(o);
      if (h !== undefined) nb.height = h;
      neighbours.push(nb);
      if (neighbours.length >= 16) break;
    }
    const near: { r: RoadInput; d: number }[] = [];
    for (const { f, box } of rGrid.query(b.box, 40)) {
      const d = gap(box, b.box);
      if (d > 40) continue;
      const s = roadStyle(f.c);
      const kind = s.rank <= 1 ? 'path' : 'road';
      near.push({ r: { line: f.g.map(local), width: s.width, kind }, d });
    }
    near.sort((a, c) => a.d - c.d);

    let base = Number.POSITIVE_INFINITY;
    for (const [x, y] of b.b.g[0] ?? []) base = Math.min(base, height(x, y));
    if (!Number.isFinite(base)) base = 0;

    const cov = (coverage[b.cy * CELLS + b.cx] ?? 0) / (CELL * CELL);
    const wx = origin.e + (b.box[0] + b.box[2]) / 2;
    const wy = origin.n + (b.box[1] + b.box[3]) / 2;
    const distKm = Math.hypot(wx - CENTRE.e, wy - CENTRE.n) / 1000;
    const h = hash2(b.b.id, 7.3);
    const a = b.attrs;
    const tags = b.b.t;

    const input: BuildingInput = {
      footprint: polygon(b.b.g),
      style: { region: 'de', modernity: Math.min(0.7, 0.2 + distKm * 0.035) },
      seed: b.b.id,
      baseElevation: base,
      detail: 'massing',
    };
    if (neighbours.length) input.neighbours = neighbours;
    if (near.length) input.roads = near.slice(0, 6).map((n) => n.r);
    if (b.b.p?.length) input.parts = b.b.p.map((p) => partInput(polygon(p.g), readAttributes(p.t)));
    const shop = tags.shop !== undefined && tags.shop !== 'no' ? `shop=${tags.shop}` : undefined;
    const cls = b.special
      ? undefined
      : classify(tags, { area: b.area, levels: a.rawLevels, shopSource: shop, denseRow: false });
    let type = cls?.type;
    if (cls?.shop) input.shop = true;
    if (a.height !== undefined) input.height = a.height;
    if (a.levels !== undefined) input.levels = a.levels;
    if (a.minHeight !== undefined) input.minHeight = a.minHeight;
    if (a.roof) input.roof = { ...a.roof };
    if (a.colours) input.colours = { ...a.colours };
    if (a.year !== undefined) input.year = a.year;
    if (tags['addr:housenumber'] !== undefined) input.hasAddress = true;

    // Defaults only where the data says nothing about the size.
    const untagged = !b.special && !input.parts && a.height === undefined && a.levels === undefined;
    const haussmann =
      untagged && cov > 0.33 && distKm < 7.5 && b.area > 70 && (!type || type === 'apartments');
    if (haussmann) {
      type = 'apartments';
      input.levels = cov > 0.45 ? 6 + (h % 2) : 5 + (h % 3);
      input.roof = {
        shape: 'mansard',
        colour: PARIS_ROOFS[h % PARIS_ROOFS.length] as string,
        ...input.roof,
      };
      input.colours = { wall: PARIS_WALLS[(h >> 3) % PARIS_WALLS.length] as string, ...input.colours };
      input.shopProbability = 0.55;
    } else if (untagged && !type && cov > 0.25 && b.area > 120) {
      type = 'apartments';
      input.levels = 3 + (h % 4);
    }
    if (type) input.type = type;

    const key = b.cy * CELLS + b.cx;
    let cell = cells.get(key);
    if (!cell) cells.set(key, (cell = { cx: b.cx, cy: b.cy, inputs: [], massingOnly: [] }));
    if (b.special) cell.massingOnly.push(cell.inputs.length);
    cell.inputs.push(input);
  }
  return [...cells.values()];
}

function clampCell(v: number): number {
  return Math.max(0, Math.min(CELLS - 1, v));
}

export function ringBox(ring: readonly (readonly [number, number])[]): [number, number, number, number] {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function gap(a: readonly number[], b: readonly number[]): number {
  const dx = Math.max(0, (a[0] as number) - (b[2] as number), (b[0] as number) - (a[2] as number));
  const dy = Math.max(0, (a[1] as number) - (b[3] as number), (b[1] as number) - (a[3] as number));
  return Math.hypot(dx, dy);
}

/** Uniform grid over box-shaped items, for neighbour and road lookups inside one tile. */
export class Grid<T> {
  private readonly cells = new Map<number, T[]>();
  constructor(private readonly size: number) {}

  private key(i: number, j: number): number {
    return (i + 4096) * 8192 + (j + 4096);
  }

  add(box: readonly number[], item: T): void {
    const [i0, j0, i1, j1] = this.range(box, 0);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(item);
      }
    }
  }

  query(box: readonly number[], margin: number): Set<T> {
    const out = new Set<T>();
    const [i0, j0, i1, j1] = this.range(box, margin);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        for (const item of this.cells.get(this.key(i, j)) ?? []) out.add(item);
      }
    }
    return out;
  }

  private range(box: readonly number[], m: number): [number, number, number, number] {
    const s = this.size;
    const clamp = (v: number): number => Math.max(-4000, Math.min(4000, v));
    return [
      clamp(Math.floor(((box[0] as number) - m) / s)),
      clamp(Math.floor(((box[1] as number) - m) / s)),
      clamp(Math.floor(((box[2] as number) + m) / s)),
      clamp(Math.floor(((box[3] as number) + m) / s)),
    ];
  }
}
