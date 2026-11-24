/**
 * Tree positions for the scene, from mapped trees and wooded areas. Runs in the
 * data worker; no DOM, no three.js, so it is tested in Node.
 *
 * OSM: `natural=tree` nodes, `natural=tree_row` ways (one tree every few metres),
 * and `landuse=forest` / `natural=wood` areas (ways and multipolygons). Vector
 * tiles (OpenMapTiles): `landcover` polygons of class `wood`; single trees are not
 * in that schema.
 *
 * Areas are filled on one global grid with a hashed jitter per cell, so a tree
 * keeps its place across reloads, overlapping areas do not double up, and the
 * buffered copies of a polygon in neighbouring vector tiles fall on the same cells.
 */
import type { Vec2 } from '@osm-buildingen/core';
import type { OsmData, Projection, Tags } from '@osm-buildingen/osm';
import { type DecodedTile, featurePolygons, worldToLatLon } from '@osm-buildingen/vector-tiles';

/** Grid step of the area fill, metres: one tree per ~120 m². */
export const FOREST_STEP = 11;
/** Spacing of trees along a `natural=tree_row`, metres. */
export const ROW_STEP = 8;
/** Upper bound on the number of trees, so a huge forest cannot stall the scene. */
export const MAX_TREES = 150_000;

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface TreeSet {
  /** x, y (local metres, x east, y north), scale; three floats per tree. */
  points: Float32Array;
  /** Trees mapped one by one (nodes and tree rows). */
  mapped: number;
  /** Trees placed inside wooded areas. */
  filled: number;
  /** True when `MAX_TREES` cut the fill short. */
  truncated: boolean;
}

/** Integer hash of a grid cell; stable across runs and platforms. */
function hashCell(i: number, j: number, salt: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ salt;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

const scaleAt = (x: number, y: number): number =>
  0.75 + (hashCell(Math.round(x * 10), Math.round(y * 10), 7) % 1000) / 1600;

type Segment = [number, number, number, number];

/**
 * Collects trees. Areas are given as loose segments: the even-odd crossing test
 * needs no ring assembly, so multipolygon members can come in any order and
 * direction as long as together they close.
 */
export class TreeCollector {
  private readonly out: number[] = [];
  private readonly cells = new Set<string>();
  private mapped = 0;
  private filled = 0;
  private truncated = false;

  constructor(private readonly clip: Rect | undefined) {}

  private inClip(x: number, y: number): boolean {
    const c = this.clip;
    return !c || (x >= c.minX && x <= c.maxX && y >= c.minY && y <= c.maxY);
  }

  private full(): boolean {
    if (this.out.length >= MAX_TREES * 3) this.truncated = true;
    return this.truncated;
  }

  addPoint(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !this.inClip(x, y) || this.full()) return;
    this.out.push(x, y, scaleAt(x, y));
    this.mapped++;
  }

  addRow(line: readonly Vec2[]): void {
    let carry = 0;
    for (let k = 1; k < line.length; k++) {
      const [ax, ay] = line[k - 1] as Vec2;
      const [bx, by] = line[k] as Vec2;
      const len = Math.hypot(bx - ax, by - ay);
      let t = carry;
      for (; t <= len; t += ROW_STEP) {
        const f = len > 0 ? t / len : 0;
        this.addPoint(ax + (bx - ax) * f, ay + (by - ay) * f);
      }
      carry = t - len;
    }
  }

  addArea(segments: readonly Segment[]): void {
    if (segments.length < 3) return;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const [ax, ay, bx, by] of segments) {
      minX = Math.min(minX, ax, bx);
      minY = Math.min(minY, ay, by);
      maxX = Math.max(maxX, ax, bx);
      maxY = Math.max(maxY, ay, by);
    }
    const c = this.clip;
    if (c) {
      minX = Math.max(minX, c.minX);
      minY = Math.max(minY, c.minY);
      maxX = Math.min(maxX, c.maxX);
      maxY = Math.min(maxY, c.maxY);
    }
    if (!(minX < maxX && minY < maxY)) return;

    const step = FOREST_STEP;
    const j0 = Math.floor(minY / step);
    const j1 = Math.floor(maxY / step);
    const i0 = Math.floor(minX / step);
    const i1 = Math.floor(maxX / step);
    // Edges bucketed per grid row, so each point only tests the edges of its row.
    const rows: Segment[][] = Array.from({ length: j1 - j0 + 1 }, () => []);
    for (const s of segments) {
      const lo = Math.max(j0, Math.floor(Math.min(s[1], s[3]) / step));
      const hi = Math.min(j1, Math.floor(Math.max(s[1], s[3]) / step));
      for (let j = lo; j <= hi; j++) rows[j - j0]?.push(s);
    }
    for (let j = j0; j <= j1; j++) {
      const edges = rows[j - j0] as Segment[];
      if (edges.length === 0) continue;
      for (let i = i0; i <= i1; i++) {
        const h = hashCell(i, j, 1);
        const x = (i + (h & 1023) / 1024) * step;
        const y = (j + ((h >>> 10) & 1023) / 1024) * step;
        if (!this.inClip(x, y) || !inside(edges, x, y)) continue;
        const key = `${i},${j}`;
        if (this.cells.has(key)) continue;
        if (this.full()) return;
        this.cells.add(key);
        this.out.push(x, y, scaleAt(x, y));
        this.filled++;
      }
    }
  }

  result(): TreeSet {
    return {
      points: new Float32Array(this.out),
      mapped: this.mapped,
      filled: this.filled,
      truncated: this.truncated,
    };
  }
}

function inside(edges: readonly Segment[], x: number, y: number): boolean {
  let odd = false;
  for (const [ax, ay, bx, by] of edges) {
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) odd = !odd;
  }
  return odd;
}

function ringSegments(points: readonly Vec2[], closed: boolean, out: Segment[]): void {
  for (let k = 1; k < points.length; k++) {
    const a = points[k - 1] as Vec2;
    const b = points[k] as Vec2;
    out.push([a[0], a[1], b[0], b[1]]);
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (closed && first && last && points.length > 2) out.push([last[0], last[1], first[0], first[1]]);
}

const isWood = (tags: Tags | undefined): boolean =>
  tags?.landuse === 'forest' || tags?.natural === 'wood' || tags?.landuse === 'wood';

export function osmTrees(osm: OsmData, proj: Projection, clip: Rect | undefined): TreeSet {
  const trees = new TreeCollector(clip);
  const nodes = new Map<number, Vec2>();
  for (const n of osm.nodes) {
    nodes.set(n.id, proj.project(n.lat, n.lon));
    if (n.tags?.natural === 'tree') {
      const p = nodes.get(n.id) as Vec2;
      trees.addPoint(p[0], p[1]);
    }
  }
  /** Way geometry, or null when a node is missing (cut off by the extract). */
  const geometry = (ids: readonly number[]): Vec2[] | null => {
    const out: Vec2[] = [];
    for (const id of ids) {
      const p = nodes.get(id);
      if (!p) return null;
      out.push(p);
    }
    return out;
  };
  const ways = new Map(osm.ways.map((w) => [w.id, w]));
  for (const w of osm.ways) {
    if (w.tags.natural === 'tree_row') {
      const line = geometry(w.nodes);
      if (line) trees.addRow(line);
    } else if (isWood(w.tags) && w.nodes.length > 3 && w.nodes[0] === w.nodes[w.nodes.length - 1]) {
      const ring = geometry(w.nodes);
      if (!ring) continue;
      const segments: Segment[] = [];
      ringSegments(ring, false, segments);
      trees.addArea(segments);
    }
  }
  for (const r of osm.relations) {
    if (r.tags.type !== 'multipolygon' || !isWood(r.tags)) continue;
    const segments: Segment[] = [];
    let complete = true;
    for (const m of r.members) {
      if (m.type !== 'way' || (m.role !== 'outer' && m.role !== 'inner' && m.role !== '')) continue;
      const w = ways.get(m.ref);
      const line = w ? geometry(w.nodes) : null;
      if (!line) {
        complete = false;
        break;
      }
      ringSegments(line, false, segments);
    }
    // A partial multipolygon has open rings; the crossing test would fill the wrong side.
    if (complete) trees.addArea(segments);
  }
  return trees.result();
}

export function tileTrees(
  tiles: readonly DecodedTile[],
  proj: Projection,
  clip: Rect | undefined,
  layer = 'landcover',
): TreeSet {
  const trees = new TreeCollector(clip);
  for (const tile of tiles) {
    const l = tile.layers[layer];
    if (!l) continue;
    const e = l.extent;
    const local = (p: readonly [number, number]): Vec2 => {
      const ll = worldToLatLon(tile.x * e + p[0], tile.y * e + p[1], tile.z, e);
      return proj.project(ll.lat, ll.lon);
    };
    for (const f of l.features) {
      if (f.properties.class !== 'wood') continue;
      for (const poly of featurePolygons(f)) {
        const segments: Segment[] = [];
        for (const ring of [poly.outer, ...poly.holes]) ringSegments(ring.map(local), true, segments);
        trees.addArea(segments);
      }
    }
  }
  return trees.result();
}
