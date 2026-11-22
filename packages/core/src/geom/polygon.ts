import earcut from 'earcut';
import {
  type Vec2,
  cross,
  distance,
  dot,
  lineIntersection,
  normalize,
  perp,
  pointSegment,
  sub,
} from './vec2';

/** Open ring: the first point is not repeated at the end. */
export type Ring = readonly Vec2[];

export interface Polygon {
  outer: Ring;
  holes?: readonly Ring[];
}

/** Signed area; positive for counter-clockwise rings. */
export function signedArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i] as Vec2;
    const q = ring[(i + 1) % n] as Vec2;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export const ringArea = (ring: Ring): number => Math.abs(signedArea(ring));

export function polygonArea(polygon: Polygon): number {
  let a = ringArea(polygon.outer);
  for (const h of polygon.holes ?? []) a -= ringArea(h);
  return a;
}

export function perimeter(ring: Ring): number {
  let l = 0;
  for (let i = 0, n = ring.length; i < n; i++) l += distance(ring[i] as Vec2, ring[(i + 1) % n] as Vec2);
  return l;
}

export function centroid(ring: Ring): Vec2 {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const p = ring[i] as Vec2;
    const q = ring[(i + 1) % n] as Vec2;
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
    a += f;
  }
  if (Math.abs(a) < 1e-12) return ring[0] ?? [0, 0];
  return [cx / (3 * a), cy / (3 * a)];
}

/**
 * Removes a repeated closing point, duplicate points and (nearly) collinear points,
 * and orients the ring: counter-clockwise if `ccw`, clockwise otherwise.
 */
export function cleanRing(ring: Ring, ccw: boolean, tolerance = 0.01): Vec2[] {
  let pts: Vec2[] = [];
  for (const p of ring) {
    const last = pts[pts.length - 1];
    if (!last || distance(last, p) > tolerance) pts.push([p[0], p[1]]);
  }
  while (pts.length > 1 && distance(pts[0] as Vec2, pts[pts.length - 1] as Vec2) <= tolerance) pts.pop();
  // Drop collinear points (repeat until stable; small rings only).
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    const out: Vec2[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[(i + n - 1) % n] as Vec2;
      const b = pts[i] as Vec2;
      const c = pts[(i + 1) % n] as Vec2;
      const d = pointSegment(b, a, c).distance;
      if (d < tolerance && dot(sub(b, a), sub(c, b)) > 0) changed = true;
      else out.push(b);
    }
    if (out.length >= 3) pts = out;
    else break;
  }
  if (signedArea(pts) < 0 === ccw) pts.reverse();
  return pts;
}

export function pointInRing(p: Vec2, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const a = ring[i] as Vec2;
    const b = ring[j] as Vec2;
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygon(p: Vec2, polygon: Polygon): boolean {
  if (!pointInRing(p, polygon.outer)) return false;
  for (const h of polygon.holes ?? []) if (pointInRing(p, h)) return false;
  return true;
}

/** Distance from a point to the boundary of a ring (0 when inside). */
export function distanceToRing(p: Vec2, ring: Ring): number {
  if (pointInRing(p, ring)) return 0;
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, n = ring.length; i < n; i++) {
    const d = pointSegment(p, ring[i] as Vec2, ring[(i + 1) % n] as Vec2).distance;
    if (d < best) best = d;
  }
  return best;
}

export interface Bounds2 {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function ringBounds(ring: Ring): Bounds2 {
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

function convexHull(points: Ring): Vec2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const hull: Vec2[] = [];
  for (let pass = 0; pass < 2; pass++) {
    const start = hull.length;
    for (const p of pass === 0 ? pts : [...pts].reverse()) {
      while (
        hull.length >= start + 2 &&
        cross(
          sub(hull[hull.length - 1] as Vec2, hull[hull.length - 2] as Vec2),
          sub(p, hull[hull.length - 1] as Vec2),
        ) <= 0
      ) {
        hull.pop();
      }
      hull.push(p);
    }
    hull.pop();
  }
  return hull;
}

/** Minimum-area enclosing rectangle. */
export interface OrientedBox {
  center: Vec2;
  /** Unit vector along the long side. */
  axis: Vec2;
  /** Unit vector along the short side (axis rotated 90° counter-clockwise). */
  side: Vec2;
  /** Half length along `axis`. */
  halfLength: number;
  /** Half length along `side`. */
  halfWidth: number;
}

export function orientedBox(ring: Ring): OrientedBox {
  const hull = convexHull(ring);
  let best: OrientedBox | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (let i = 0, n = hull.length; i < n; i++) {
    const u = normalize(sub(hull[(i + 1) % n] as Vec2, hull[i] as Vec2));
    const v = perp(u);
    let minU = Number.POSITIVE_INFINITY;
    let maxU = Number.NEGATIVE_INFINITY;
    let minV = Number.POSITIVE_INFINITY;
    let maxV = Number.NEGATIVE_INFINITY;
    for (const p of hull) {
      const pu = dot(p, u);
      const pv = dot(p, v);
      if (pu < minU) minU = pu;
      if (pu > maxU) maxU = pu;
      if (pv < minV) minV = pv;
      if (pv > maxV) maxV = pv;
    }
    const lu = maxU - minU;
    const lv = maxV - minV;
    // Quantise so that near-ties (squares, symmetric shapes) resolve the same way everywhere.
    const area = Math.round(lu * lv * 1000);
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      const center: Vec2 = [u[0] * cu + v[0] * cv, u[1] * cu + v[1] * cv];
      best =
        lu >= lv
          ? { center, axis: u, side: v, halfLength: lu / 2, halfWidth: lv / 2 }
          : { center, axis: v, side: [-u[0], -u[1]], halfLength: lv / 2, halfWidth: lu / 2 };
    }
  }
  if (!best) {
    const c = ring[0] ?? [0, 0];
    return { center: c, axis: [1, 0], side: [0, 1], halfLength: 0, halfWidth: 0 };
  }
  // Canonical direction: axis points east-ish (or north if exactly vertical).
  if (best.axis[0] < -1e-9 || (Math.abs(best.axis[0]) <= 1e-9 && best.axis[1] < 0)) {
    best = { ...best, axis: [-best.axis[0], -best.axis[1]], side: [-best.side[0], -best.side[1]] };
  }
  return best;
}

/**
 * Offsets each edge of a ring outward (positive) or inward (negative) by its own
 * distance and re-intersects neighbouring edges. Works for counter-clockwise rings;
 * meant for small offsets (overhangs, parapets), it does not resolve self-intersections.
 */
export function offsetRing(ring: Ring, distances: number | readonly number[]): Vec2[] {
  const n = ring.length;
  const dist = (i: number): number => (typeof distances === 'number' ? distances : (distances[i] ?? 0));
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const prev = ring[(i + n - 1) % n] as Vec2;
    const cur = ring[i] as Vec2;
    const next = ring[(i + 1) % n] as Vec2;
    const d0 = normalize(sub(cur, prev));
    const d1 = normalize(sub(next, cur));
    // Outward normal of a CCW ring edge with direction d is (d.y, -d.x).
    const o0 = dist((i + n - 1) % n);
    const o1 = dist(i);
    const p0: Vec2 = [prev[0] + d0[1] * o0, prev[1] - d0[0] * o0];
    const p1: Vec2 = [cur[0] + d1[1] * o1, cur[1] - d1[0] * o1];
    const hit = lineIntersection(p0, d0, p1, d1);
    if (hit && distance(hit, cur) < 4 * Math.max(Math.abs(o0), Math.abs(o1), 0.01) + 0.01) out.push(hit);
    else out.push([cur[0] + d1[1] * o1, cur[1] - d1[0] * o1]);
  }
  return out;
}

/** Clips a ring against the half-plane dot(p - origin, normal) >= 0 (Sutherland–Hodgman). */
export function clipRing(ring: Ring, origin: Vec2, normal: Vec2): Vec2[] {
  const out: Vec2[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i] as Vec2;
    const b = ring[(i + 1) % n] as Vec2;
    const da = dot(sub(a, origin), normal);
    const db = dot(sub(b, origin), normal);
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

/** Triangulates a polygon with holes. Returns indices into the concatenated point list. */
export function triangulate(outer: Ring, holes: readonly Ring[] = []): { points: Vec2[]; indices: number[] } {
  const points: Vec2[] = [];
  const flat: number[] = [];
  const holeIndices: number[] = [];
  for (const p of outer) {
    points.push(p);
    flat.push(p[0], p[1]);
  }
  for (const h of holes) {
    holeIndices.push(points.length);
    for (const p of h) {
      points.push(p);
      flat.push(p[0], p[1]);
    }
  }
  return { points, indices: earcut(flat, holeIndices, 2) };
}
