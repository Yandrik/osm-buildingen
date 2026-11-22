import type { Vec2 } from '@osm-buildingen/core';

/*
 * Small 2D helpers in local metres. Copied from packages/osm/src/geometry.ts
 * (internal there; candidate for a shared package) minus the OSM ring assembly,
 * plus `interiorPoint`.
 */

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function ringBox(ring: readonly Vec2[]): Box {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of ring) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

export const expandBox = (b: Box, d: number): Box => ({
  minX: b.minX - d,
  minY: b.minY - d,
  maxX: b.maxX + d,
  maxY: b.maxY + d,
});

export const boxesOverlap = (a: Box, b: Box): boolean =>
  a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

/** Signed area, positive for counter-clockwise rings. */
export function signedArea(ring: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i] as Vec2;
    const q = ring[(i + 1) % n] as Vec2;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Area centroid; falls back to the vertex mean for degenerate rings. */
export function ringCentroid(ring: readonly Vec2[]): Vec2 {
  // Relative to the first point to keep precision for rings far from the origin.
  const o = ring[0] ?? [0, 0];
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i] as Vec2;
    const q = ring[(i + 1) % n] as Vec2;
    const px = p[0] - o[0];
    const py = p[1] - o[1];
    const qx = q[0] - o[0];
    const qy = q[1] - o[1];
    const f = px * qy - qx * py;
    cx += (px + qx) * f;
    cy += (py + qy) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const p of ring) {
      sx += p[0];
      sy += p[1];
    }
    return ring.length ? [sx / ring.length, sy / ring.length] : [0, 0];
  }
  return [o[0] + cx / (3 * a), o[1] + cy / (3 * a)];
}

/** Even-odd point in ring test. Points exactly on the boundary may go either way. */
export function pointInRing(p: Vec2, ring: readonly Vec2[]): boolean {
  let inside = false;
  const x = p[0];
  const y = p[1];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i] as Vec2;
    const b = ring[j] as Vec2;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(
  p: Vec2,
  outer: readonly Vec2[],
  holes: readonly (readonly Vec2[])[],
): boolean {
  if (!pointInRing(p, outer)) return false;
  for (const h of holes) if (pointInRing(p, h)) return false;
  return true;
}

/** Squared distance from p to segment ab. */
export function pointSegmentDist2(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const ex = a[0] + t * dx - p[0];
  const ey = a[1] + t * dy - p[1];
  return ex * ex + ey * ey;
}

function orient(a: Vec2, b: Vec2, c: Vec2): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** True when the open segments cross at a single interior point (touching endpoints do not count). */
export function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Squared distance between segments ab and cd. */
export function segmentDist2(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segmentsCross(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDist2(a, c, d),
    pointSegmentDist2(b, c, d),
    pointSegmentDist2(c, a, b),
    pointSegmentDist2(d, a, b),
  );
}

/** Minimum distance between two ring boundaries. */
export function ringDistance(a: readonly Vec2[], b: readonly Vec2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, n = a.length; i < n; i++) {
    const p = a[i] as Vec2;
    const q = a[(i + 1) % n] as Vec2;
    for (let j = 0, m = b.length; j < m; j++) {
      const d2 = segmentDist2(p, q, b[j] as Vec2, b[(j + 1) % m] as Vec2);
      if (d2 < best) {
        best = d2;
        if (best === 0) return 0;
      }
    }
  }
  return Math.sqrt(best);
}

/** Distance between two outer rings as areas: 0 when they overlap or one contains the other. */
export function areaDistance(a: readonly Vec2[], b: readonly Vec2[]): number {
  if (a.length && b.length && (pointInRing(a[0] as Vec2, b) || pointInRing(b[0] as Vec2, a))) return 0;
  return ringDistance(a, b);
}

/** Minimum distance from an open polyline to a ring boundary. */
export function polylineRingDistance(line: readonly Vec2[], ring: readonly Vec2[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < line.length; i++) {
    const p = line[i] as Vec2;
    const q = line[i + 1] as Vec2;
    for (let j = 0, m = ring.length; j < m; j++) {
      const d2 = segmentDist2(p, q, ring[j] as Vec2, ring[(j + 1) % m] as Vec2);
      if (d2 < best) {
        best = d2;
        if (best === 0) return 0;
      }
    }
  }
  return Math.sqrt(best);
}

/**
 * Drops the closing point and consecutive duplicates (closer than 1 cm), and
 * removes spikes where the ring goes back on itself.
 */
export function cleanRing(points: readonly Vec2[]): Vec2[] {
  const out: Vec2[] = [];
  const same = (a: Vec2, b: Vec2): boolean => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && same(last, p)) continue;
    out.push(p);
  }
  while (out.length > 1 && same(out[0] as Vec2, out[out.length - 1] as Vec2)) out.pop();
  // A-B-A spikes (way doubling back) are zero-area slivers; drop the tip.
  let changed = true;
  while (changed && out.length >= 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const prev = out[(i - 1 + out.length) % out.length] as Vec2;
      const next = out[(i + 1) % out.length] as Vec2;
      if (same(prev, next)) {
        out.splice(i, 1);
        // Remove the now-duplicate neighbour as well.
        const j = i % out.length;
        out.splice(j, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/** Ring with the requested winding (counter-clockwise when `ccw`). */
export function withWinding(ring: Vec2[], ccw: boolean): Vec2[] {
  return signedArea(ring) > 0 === ccw ? ring : ring.slice().reverse();
}

/**
 * Clips a polyline to a box (Liang–Barsky per segment). Returns the pieces that
 * lie inside, each with at least two points.
 */
export function clipPolyline(line: readonly Vec2[], box: Box): Vec2[][] {
  const pieces: Vec2[][] = [];
  let current: Vec2[] | null = null;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as Vec2;
    const b = line[i + 1] as Vec2;
    const clipped = clipSegment(a, b, box);
    if (!clipped) {
      current = null;
      continue;
    }
    const [p, q, t0, t1] = clipped;
    if (current && t0 === 0) current.push(q);
    else {
      current = [p, q];
      pieces.push(current);
    }
    if (t1 < 1) current = null;
  }
  return pieces;
}

function clipSegment(a: Vec2, b: Vec2, box: Box): [Vec2, Vec2, number, number] | null {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-dx, a[0] - box.minX],
    [dx, box.maxX - a[0]],
    [-dy, a[1] - box.minY],
    [dy, box.maxY - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  const at = (t: number): Vec2 => (t === 0 ? a : t === 1 ? b : [a[0] + dx * t, a[1] + dy * t]);
  return [at(t0), at(t1), t0, t1];
}

/** Uniform grid over boxes, for neighbour and road lookups. */
export class GridIndex {
  private readonly cells = new Map<number, number[]>();
  private stamp: Uint32Array = new Uint32Array(0);
  private query = 0;

  constructor(private readonly size: number) {}

  private key(cx: number, cy: number): number {
    // Cell coordinates stay well inside ±2^20 for any town-sized area.
    return (cx + 0x100000) * 0x200000 + (cy + 0x100000);
  }

  insert(id: number, box: Box): void {
    if (id >= this.stamp.length) {
      const grown = new Uint32Array(Math.max(16, (id + 1) * 2));
      grown.set(this.stamp);
      this.stamp = grown;
    }
    const x0 = Math.floor(box.minX / this.size);
    const x1 = Math.floor(box.maxX / this.size);
    const y0 = Math.floor(box.minY / this.size);
    const y1 = Math.floor(box.maxY / this.size);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy);
        const cell = this.cells.get(k);
        if (cell) cell.push(id);
        else this.cells.set(k, [id]);
      }
    }
  }

  /** Ids whose cells overlap the box, each once, in ascending order. */
  search(box: Box): number[] {
    this.query++;
    const out: number[] = [];
    const x0 = Math.floor(box.minX / this.size);
    const x1 = Math.floor(box.maxX / this.size);
    const y0 = Math.floor(box.minY / this.size);
    const y1 = Math.floor(box.maxY / this.size);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const cell = this.cells.get(this.key(cx, cy));
        if (!cell) continue;
        for (const id of cell) {
          if (this.stamp[id] === this.query) continue;
          this.stamp[id] = this.query;
          out.push(id);
        }
      }
    }
    return out.sort((a, b) => a - b);
  }
}

/** A point inside the ring: the centroid if it is inside, else the centre of an inside ear. */
export function interiorPoint(ring: readonly Vec2[]): Vec2 {
  const c = ringCentroid(ring);
  if (pointInRing(c, ring)) return c;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[(i + n - 1) % n] as Vec2;
    const b = ring[i] as Vec2;
    const d = ring[(i + 1) % n] as Vec2;
    const p: Vec2 = [(a[0] + b[0] + d[0]) / 3, (a[1] + b[1] + d[1]) / 3];
    if (pointInRing(p, ring)) return p;
  }
  return c;
}
