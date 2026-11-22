import type { Vec2 } from '@osm-buildingen/core';
import { pointInRing, ringCentroid, signedArea } from './geometry';
import { type DecodedTile, type PropertyValue, type TilePoint, featurePolygons } from './mvt';

/*
 * Stitching polygons that tile generators clip at tile borders.
 *
 * Coordinates here are "world units" with Y UP: X = tileX × extent + px,
 * Y = −(tileY × extent + py). Every tile of one zoom shares this frame, and
 * vertices are integers in it, so a building's pieces in two tiles meet
 * exactly on the border line.
 *
 * 1. Each polygon is clipped to its own tile square, but only on sides where
 *    the neighbouring tile is loaded too. That drops the copies in neighbour
 *    buffers (deduplication) and cuts crossing buildings exactly on the border.
 *    On sides without a loaded neighbour the buffer geometry is kept, so a
 *    building at the edge of the loaded area is as complete as the data allows.
 * 2. Pieces that have edges on the same border line, come from different tiles,
 *    overlap along the line and have equal properties are grouped (union-find).
 * 3. A group is merged by edge cancellation: border edges are split at every
 *    group vertex on that line, opposite edges cancel, the rest is re-linked
 *    into rings, and the vertices left on border lines in straight runs are
 *    removed. Clipping with Sutherland–Hodgman leaves zero-width bridges along
 *    the border for concave shapes; those cancel the same way.
 *
 * Limits: pieces whose border vertices differ by more than SNAP world units
 * (inconsistent simplification between tiles) leave small notches; buildings
 * that touch exactly along a tile border with equal properties are merged.
 */

/** OpenMapTiles `buffer_size: 4` for buildings, in units of a 4096 extent. */
const DEFAULT_BUFFER = 64;
/** Border vertices closer than this (world units) are treated as one. */
const SNAP = 1;
/** Vertices this close to the line through their neighbours are removed on border lines. */
const COLLINEAR = 0.6;

export interface WorldPolygon {
  /** Counter-clockwise, open. */
  outer: Vec2[];
  /** Clockwise, open. */
  holes: Vec2[][];
}

export interface StitchedPolygon extends WorldPolygon {
  properties: Record<string, PropertyValue>;
  /** MVT feature id when the polygon was the only one of its feature (generator-specific meaning). */
  featureId?: number;
  /** Tile keys (`z/x/y`) the polygon was assembled from, sorted. */
  tiles: string[];
  /** True when pieces from more than one tile were merged. */
  stitched: boolean;
  /** True when the polygon reaches the buffer edge on a side whose neighbour tile is not loaded. */
  truncated: boolean;
}

export interface StitchResult {
  polygons: StitchedPolygon[];
  /** Polygons read from the tiles (before clipping and merging). */
  read: number;
  /** Groups of pieces from several tiles that were merged into one. */
  merged: number;
}

/** A tile border used for clipping: the half-plane `axis` >= or <= `value`. */
export interface ClipLine {
  axis: 0 | 1;
  value: number;
  /** Keep points with coordinate >= value (else <=). */
  keepGreater: boolean;
}

interface Piece {
  polygon: WorldPolygon;
  properties: Record<string, PropertyValue>;
  featureId: number | undefined;
  tile: string;
  lines: ClipLine[];
  truncated: boolean;
  propsKey: string;
}

const lineKey = (axis: number, value: number): string => `${axis}:${value}`;

/** Stable text of a feature's properties, for "same building" checks across tiles. */
export function propertiesKey(p: Record<string, PropertyValue>): string {
  return Object.keys(p)
    .sort()
    .map((k) => `${k}=${String(p[k])}`)
    .join('\n');
}

/**
 * Collects all polygons of `layer` from the tiles, clipped and stitched across
 * tile borders. All tiles must have the same zoom; the result does not depend
 * on tile order. `extent` is the world-unit scale (layers with another extent
 * are rescaled).
 */
export function stitchLayer(tiles: readonly DecodedTile[], layer: string, extent: number): StitchResult {
  const sorted = tiles.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const loaded = new Set(sorted.map((t) => `${t.x}/${t.y}`));
  const pieces: Piece[] = [];
  let read = 0;

  for (const tile of sorted) {
    const l = tile.layers[layer];
    if (!l) continue;
    const s = extent / l.extent;
    const ox = tile.x * extent;
    const oy = tile.y * extent;
    const has = (dx: number, dy: number): boolean => loaded.has(`${tile.x + dx}/${tile.y + dy}`);
    const lines: ClipLine[] = [];
    if (has(-1, 0)) lines.push({ axis: 0, value: ox, keepGreater: true });
    if (has(1, 0)) lines.push({ axis: 0, value: ox + extent, keepGreater: false });
    if (has(0, -1)) lines.push({ axis: 1, value: -oy, keepGreater: false });
    if (has(0, 1)) lines.push({ axis: 1, value: -(oy + extent), keepGreater: true });

    // Buffer width present in this layer, for the truncation test; at least the
    // OpenMapTiles building buffer (4 px of 256 = 64 / 4096), so sparse tiles are not misread.
    let buffer = (DEFAULT_BUFFER * l.extent) / 4096;
    for (const f of l.features) {
      for (const ring of f.geometry) {
        for (const p of ring) {
          buffer = Math.max(buffer, -p[0], -p[1], p[0] - l.extent, p[1] - l.extent);
        }
      }
    }
    buffer *= s;
    const edges = {
      west: has(-1, 0) ? null : ox - buffer + 0.5,
      east: has(1, 0) ? null : ox + extent + buffer - 0.5,
      north: has(0, -1) ? null : -oy + buffer - 0.5,
      south: has(0, 1) ? null : -(oy + extent) - buffer + 0.5,
    };
    const toWorld = (ring: readonly TilePoint[]): Vec2[] =>
      // y flips, so the MVT exterior (positive area with y down) becomes clockwise: reverse it.
      ring
        .map((p): Vec2 => [ox + p[0] * s, -(oy + p[1] * s)])
        .reverse();

    for (const f of l.features) {
      const polys = featurePolygons(f);
      for (const poly of polys) {
        read++;
        let outer = dedupe(toWorld(poly.outer));
        for (const line of lines) outer = clipRing(outer, line);
        if (outer.length < 3 || signedArea(outer) <= 0) continue;
        const holes: Vec2[][] = [];
        for (const h of poly.holes) {
          let hole = dedupe(toWorld(h));
          for (const line of lines) hole = clipRing(hole, line);
          if (hole.length >= 3 && signedArea(hole) < 0) holes.push(hole);
        }
        let truncated = false;
        for (const p of outer) {
          if (
            (edges.west !== null && p[0] <= edges.west) ||
            (edges.east !== null && p[0] >= edges.east) ||
            (edges.north !== null && p[1] >= edges.north) ||
            (edges.south !== null && p[1] <= edges.south)
          ) {
            truncated = true;
            break;
          }
        }
        pieces.push({
          polygon: { outer, holes },
          properties: f.properties,
          featureId: polys.length === 1 ? f.id : undefined,
          tile: `${tile.z}/${tile.x}/${tile.y}`,
          lines: lines.filter((line) => onLine([outer, ...holes], line)),
          truncated,
          propsKey: propertiesKey(f.properties),
        });
      }
    }
  }

  // --- Group pieces that continue across a border ------------------------------------
  const parent = pieces.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      const p = parent[parent[i] as number] as number;
      parent[i] = p;
      i = p;
    }
    return i;
  };
  const byLine = new Map<string, { piece: number; lo: number; hi: number }[]>();
  pieces.forEach((piece, i) => {
    for (const line of piece.lines) {
      const k = lineKey(line.axis, line.value);
      const list = byLine.get(k) ?? [];
      for (const [lo, hi] of borderIntervals(piece.polygon, line)) list.push({ piece: i, lo, hi });
      byLine.set(k, list);
    }
  });
  for (const list of byLine.values()) {
    for (let a = 0; a < list.length; a++) {
      const p = list[a] as { piece: number; lo: number; hi: number };
      for (let b = a + 1; b < list.length; b++) {
        const q = list[b] as { piece: number; lo: number; hi: number };
        const pp = pieces[p.piece] as Piece;
        const qq = pieces[q.piece] as Piece;
        if (pp.tile === qq.tile || pp.propsKey !== qq.propsKey) continue;
        if (Math.min(p.hi, q.hi) - Math.max(p.lo, q.lo) <= SNAP / 2) continue;
        const ra = find(p.piece);
        const rb = find(q.piece);
        if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
      }
    }
  }
  const groups = new Map<number, number[]>();
  pieces.forEach((_, i) => {
    const r = find(i);
    const g = groups.get(r);
    if (g) g.push(i);
    else groups.set(r, [i]);
  });

  // --- Merge ---------------------------------------------------------------------------
  const polygons: StitchedPolygon[] = [];
  let merged = 0;
  for (const members of groups.values()) {
    const group = members.map((i) => pieces[i] as Piece);
    const first = group[0] as Piece;
    const tilesOf = [...new Set(group.map((p) => p.tile))].sort();
    const truncated = group.some((p) => p.truncated);
    const lines = group.flatMap((p) => p.lines);
    if (group.length > 1) merged++;
    const shapes =
      lines.length === 0
        ? [first.polygon]
        : mergePolygons(
            group.map((p) => p.polygon),
            lines,
          );
    for (const shape of shapes) {
      const out: StitchedPolygon = {
        ...shape,
        properties: first.properties,
        tiles: tilesOf,
        stitched: tilesOf.length > 1,
        truncated,
      };
      if (group.length === 1 && first.featureId !== undefined) out.featureId = first.featureId;
      polygons.push(out);
    }
  }
  return { polygons, read, merged };
}

function dedupe<T extends Vec2>(ring: T[]): T[] {
  const out: T[] = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0] as T;
    const b = out[out.length - 1] as T;
    if (a[0] !== b[0] || a[1] !== b[1]) break;
    out.pop();
  }
  return out;
}

/** Sutherland–Hodgman against one axis-aligned half-plane; intersections are rounded to world units. */
export function clipRing(ring: readonly Vec2[], line: ClipLine): Vec2[] {
  const { axis, value, keepGreater } = line;
  const other = axis === 0 ? 1 : 0;
  const inside = (p: Vec2): boolean => (keepGreater ? p[axis] >= value : p[axis] <= value);
  const cut = (a: Vec2, b: Vec2): Vec2 => {
    const t = (value - a[axis]) / (b[axis] - a[axis]);
    const o = Math.round(a[other] + t * (b[other] - a[other]));
    return axis === 0 ? [value, o] : [o, value];
  };
  const out: Vec2[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const cur = ring[i] as Vec2;
    const prev = ring[(i + n - 1) % n] as Vec2;
    const ci = inside(cur);
    const pi = inside(prev);
    if (ci) {
      if (!pi) out.push(cut(prev, cur));
      out.push(cur);
    } else if (pi) out.push(cut(prev, cur));
  }
  return dedupe(out);
}

function onLine(rings: readonly (readonly Vec2[])[], line: ClipLine): boolean {
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i] as Vec2;
      const b = ring[(i + 1) % n] as Vec2;
      if (a[line.axis] === line.value && b[line.axis] === line.value) return true;
    }
  }
  return false;
}

/** [lo, hi] along the line of every outer-ring edge lying on it. */
function borderIntervals(polygon: WorldPolygon, line: ClipLine): [number, number][] {
  const other = line.axis === 0 ? 1 : 0;
  const out: [number, number][] = [];
  const ring = polygon.outer;
  for (let i = 0, n = ring.length; i < n; i++) {
    const a = ring[i] as Vec2;
    const b = ring[(i + 1) % n] as Vec2;
    if (a[line.axis] === line.value && b[line.axis] === line.value) {
      out.push([Math.min(a[other], b[other]), Math.max(a[other], b[other])]);
    }
  }
  return out;
}

interface Edge {
  a: Vec2;
  b: Vec2;
  used: boolean;
}

const pointKey = (p: Vec2): string => `${p[0]},${p[1]}`;

/**
 * Union of polygons that only meet along the given border lines (see the file
 * comment). Returns one polygon per resulting outer ring with its holes.
 */
export function mergePolygons(polygons: readonly WorldPolygon[], lines: readonly ClipLine[]): WorldPolygon[] {
  const unique = new Map<string, ClipLine>();
  for (const l of lines) unique.set(lineKey(l.axis, l.value), l);
  const borderLines = [...unique.values()];
  // Mutable copies: snapping moves vertices.
  let rings: [number, number][][] = polygons
    .flatMap((p) => [p.outer, ...p.holes])
    .map((r) => r.map((p): [number, number] => [p[0], p[1]]));

  // Snap nearly equal border vertices so that both sides use the same coordinates.
  const stops = new Map<string, number[]>();
  for (const line of borderLines) {
    const other = line.axis === 0 ? 1 : 0;
    const values: number[] = [];
    for (const ring of rings) for (const p of ring) if (p[line.axis] === line.value) values.push(p[other]);
    values.sort((x, y) => x - y);
    const snapped = new Map<number, number>();
    let anchor = Number.NEGATIVE_INFINITY;
    for (const v of values) {
      if (v - anchor > SNAP) anchor = v;
      snapped.set(v, anchor);
    }
    for (const ring of rings) {
      for (const p of ring) {
        if (p[line.axis] === line.value) p[other] = snapped.get(p[other]) ?? p[other];
      }
    }
    stops.set(
      lineKey(line.axis, line.value),
      [...new Set(snapped.values())].sort((x, y) => x - y),
    );
  }
  rings = rings.map(dedupe).filter((r) => r.length >= 2);

  // Directed edges, border edges split at every stop on their line; opposite edges cancel.
  const counts = new Map<string, Edge[]>();
  const add = (a: Vec2, b: Vec2): void => {
    if (a[0] === b[0] && a[1] === b[1]) return;
    const reverse = `${pointKey(b)}>${pointKey(a)}`;
    const rev = counts.get(reverse);
    if (rev && rev.length > 0) {
      rev.pop();
      return;
    }
    const key = `${pointKey(a)}>${pointKey(b)}`;
    const list = counts.get(key);
    if (list) list.push({ a, b, used: false });
    else counts.set(key, [{ a, b, used: false }]);
  };
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i] as Vec2;
      const b = ring[(i + 1) % n] as Vec2;
      const line = borderLines.find((l) => a[l.axis] === l.value && b[l.axis] === l.value);
      if (!line) {
        add(a, b);
        continue;
      }
      const other = line.axis === 0 ? 1 : 0;
      const lo = Math.min(a[other], b[other]);
      const hi = Math.max(a[other], b[other]);
      const inner = (stops.get(lineKey(line.axis, line.value)) ?? []).filter((v) => v > lo && v < hi);
      if (a[other] > b[other]) inner.reverse();
      let prev = a;
      for (const v of inner) {
        const p: Vec2 = line.axis === 0 ? [line.value, v] : [v, line.value];
        add(prev, p);
        prev = p;
      }
      add(prev, b);
    }
  }

  const edges: Edge[] = [];
  for (const list of counts.values()) edges.push(...list);
  const outgoing = new Map<string, Edge[]>();
  for (const e of edges) {
    const k = pointKey(e.a);
    const list = outgoing.get(k);
    if (list) list.push(e);
    else outgoing.set(k, [e]);
  }

  // Re-link: at a vertex with several exits take the sharpest left turn (interior stays on the left).
  const traced: Vec2[][] = [];
  for (const start of edges) {
    if (start.used) continue;
    const ring: Vec2[] = [];
    let cur: Edge = start;
    let closed = false;
    for (let guard = 0; guard <= edges.length; guard++) {
      cur.used = true;
      ring.push(cur.a);
      if (pointKey(cur.b) === pointKey(start.a)) {
        closed = true;
        break;
      }
      const exits = (outgoing.get(pointKey(cur.b)) ?? []).filter((e) => !e.used);
      if (exits.length === 0) break;
      const dx = cur.b[0] - cur.a[0];
      const dy = cur.b[1] - cur.a[1];
      let best = exits[0] as Edge;
      let bestTurn = Number.NEGATIVE_INFINITY;
      for (const e of exits) {
        const ex = e.b[0] - e.a[0];
        const ey = e.b[1] - e.a[1];
        let turn = Math.atan2(dx * ey - dy * ex, dx * ex + dy * ey);
        if (turn >= Math.PI - 1e-12) turn = -Math.PI; // going straight back is the last resort
        if (turn > bestTurn) {
          bestTurn = turn;
          best = e;
        }
      }
      cur = best;
    }
    if (closed && ring.length >= 3) traced.push(ring);
  }

  const cleaned = traced.map((r) => dropBorderCollinear(r, borderLines)).filter((r) => r.length >= 3);
  const outers = cleaned.filter((r) => signedArea(r) > 0).sort((a, b) => signedArea(a) - signedArea(b));
  const result: WorldPolygon[] = outers.map((outer) => ({ outer, holes: [] }));
  for (const hole of cleaned) {
    if (signedArea(hole) >= 0) continue;
    const c = ringCentroid(hole);
    // Smallest containing outer first (outers are sorted by area).
    const owner = result.find((p) => pointInRing(c, p.outer));
    owner?.holes.push(hole);
  }
  return result;
}

/** Removes vertices on border lines that lie (nearly) on the straight line between their neighbours. */
function dropBorderCollinear(ring: Vec2[], lines: readonly ClipLine[]): Vec2[] {
  const out = ring.slice();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const p = out[i] as Vec2;
      if (!lines.some((l) => p[l.axis] === l.value)) continue;
      const a = out[(i + out.length - 1) % out.length] as Vec2;
      const b = out[(i + 1) % out.length] as Vec2;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len === 0) continue;
      const dist = Math.abs(dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / len;
      const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (len * len);
      if (dist < COLLINEAR && t > 0 && t < 1) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}
