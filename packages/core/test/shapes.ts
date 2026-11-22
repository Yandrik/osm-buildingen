/** Footprints for the skeleton and roof tests: fixed shapes and seeded random families. */
import { signedArea } from '../src/geom/polygon';
import type { Vec2 } from '../src/geom/vec2';
import type { Rng } from '../src/rng';

export const rect = (w: number, d: number, x = 0, y = 0): Vec2[] => [
  [x, y],
  [x + w, y],
  [x + w, y + d],
  [x, y + d],
];

export function rotate(ring: readonly Vec2[], degrees: number): Vec2[] {
  const a = (degrees * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return ring.map((p): Vec2 => [p[0] * c - p[1] * s, p[0] * s + p[1] * c]);
}

const L: Vec2[] = [
  [0, 0],
  [12, 0],
  [12, 6],
  [6, 6],
  [6, 11],
  [0, 11],
];
const T: Vec2[] = [
  [0, 8],
  [5, 8],
  [5, 0],
  [11, 0],
  [11, 8],
  [16, 8],
  [16, 13],
  [0, 13],
];
const U: Vec2[] = [
  [0, 0],
  [5, 0],
  [5, 7],
  [11, 7],
  [11, 0],
  [16, 0],
  [16, 12],
  [0, 12],
];
const PLUS: Vec2[] = [
  [5, 0],
  [10, 0],
  [10, 5],
  [15, 5],
  [15, 10],
  [10, 10],
  [10, 15],
  [5, 15],
  [5, 10],
  [0, 10],
  [0, 5],
  [5, 5],
];
/** Like OSM "rectangles": a few centimetres off. */
const QUAD: Vec2[] = [
  [0, 0],
  [10.03, 0.12],
  [9.91, 7.96],
  [-0.08, 8.05],
];
const H: Vec2[] = [
  [0, 0],
  [5, 0],
  [5, 4],
  [13, 4],
  [13, 0],
  [18, 0],
  [18, 12],
  [13, 12],
  [13, 8],
  [5, 8],
  [5, 12],
  [0, 12],
];
/** L with points in the middle of walls and doubled corners. */
const MESSY_L: Vec2[] = [
  [0, 0],
  [4, 0],
  [8, 0],
  [12, 0],
  [12, 0.000001],
  [12, 3],
  [12, 6],
  [6.0005, 6],
  [6, 6],
  [6, 11],
  [3, 11],
  [0, 11],
  [0, 11],
  [0, 5.5],
];

export const FIXED_SHAPES: Record<string, Vec2[]> = {
  rectangle: rect(10, 8),
  square: rect(9, 9),
  L,
  T,
  U,
  plus: PLUS,
  H,
  rotatedL: rotate(L, 27),
  rotatedPlus: rotate(PLUS, 45),
  quad: QUAD,
  triangle: [
    [0, 0],
    [9, 1],
    [3, 8],
  ],
  messyL: MESSY_L,
  trapezoid: [
    [0, 0],
    [14, 0],
    [11, 7],
    [2, 7],
  ],
  staircase: [
    [0, 0],
    [12, 0],
    [12, 4],
    [9, 4],
    [9, 7],
    [6, 7],
    [6, 10],
    [0, 10],
  ],
};

export const COURTYARD: { outer: Vec2[]; holes: Vec2[][] } = {
  outer: rect(20, 18),
  holes: [[...rect(10, 8, 5, 5)].reverse()],
};

/**
 * Outline of the union of 2–3 axis-parallel rectangles, or null when the union is
 * not one simple ring (disconnected, or touching in a single corner).
 * `grid` > 0 snaps coordinates so that walls line up exactly, the degenerate case
 * real footprints are full of.
 */
export function randomRectilinear(rng: Rng, grid: number, keepCollinear = false): Vec2[] | null {
  const snap = (v: number): number => (grid > 0 ? Math.round(v / grid) * grid : v);
  const count = 2 + rng.int(2);
  const rects: [number, number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    const w = snap(rng.range(3, 14));
    const d = snap(rng.range(3, 14));
    const x = snap(rng.range(0, 12));
    const y = snap(rng.range(0, 12));
    if (w < 1 || d < 1) return null;
    rects.push([x, y, x + w, y + d]);
  }
  const xs = [...new Set(rects.flatMap((r) => [r[0], r[2]]))].sort((a, b) => a - b);
  const ys = [...new Set(rects.flatMap((r) => [r[1], r[3]]))].sort((a, b) => a - b);
  // Slivers thinner than this are not buildings and only test float noise.
  for (let i = 1; i < xs.length; i++) if ((xs[i] as number) - (xs[i - 1] as number) < 0.2) return null;
  for (let i = 1; i < ys.length; i++) if ((ys[i] as number) - (ys[i - 1] as number) < 0.2) return null;
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  const filled = (i: number, j: number): boolean => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return false;
    const cx = ((xs[i] as number) + (xs[i + 1] as number)) / 2;
    const cy = ((ys[j] as number) + (ys[j + 1] as number)) / 2;
    return rects.some((r) => cx > r[0] && cx < r[2] && cy > r[1] && cy < r[3]);
  };
  // Directed boundary edges, counter-clockwise around the filled cells.
  const next = new Map<string, [number, number]>();
  const key = (i: number, j: number): string => `${i},${j}`;
  let edges = 0;
  let pinched = false;
  const add = (i0: number, j0: number, i1: number, j1: number): void => {
    if (next.has(key(i0, j0))) pinched = true;
    next.set(key(i0, j0), [i1, j1]);
    edges++;
  };
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      if (!filled(i, j)) continue;
      if (!filled(i, j - 1)) add(i, j, i + 1, j);
      if (!filled(i + 1, j)) add(i + 1, j, i + 1, j + 1);
      if (!filled(i, j + 1)) add(i + 1, j + 1, i, j + 1);
      if (!filled(i - 1, j)) add(i, j + 1, i, j);
    }
  }
  if (pinched || edges === 0) return null;
  const start = next.keys().next().value as string;
  const ring: Vec2[] = [];
  let cur = start;
  let steps = 0;
  do {
    const [i, j] = cur.split(',').map(Number) as [number, number];
    ring.push([xs[i] as number, ys[j] as number]);
    const to = next.get(cur);
    if (!to) return null;
    cur = key(to[0], to[1]);
    steps++;
  } while (cur !== start && steps <= edges);
  if (steps !== edges) return null; // more than one ring
  if (keepCollinear) return ring;
  const out: Vec2[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i + ring.length - 1) % ring.length] as Vec2;
    const b = ring[i] as Vec2;
    const c = ring[(i + 1) % ring.length] as Vec2;
    if (Math.abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > 1e-9) out.push(b);
  }
  return out;
}

/** Points on an ellipse at sorted random angles. */
export function randomConvex(rng: Rng): Vec2[] {
  const n = 3 + rng.int(8);
  const rx = rng.range(4, 12);
  const ry = rng.range(4, 12);
  const angles: number[] = [];
  let a = rng.range(0, 1);
  for (let i = 0; i < n; i++) {
    angles.push(a);
    a += rng.range(0.4, 1.6);
  }
  const total = a - (angles[0] as number);
  const turn = rng.range(0, Math.PI);
  return rotate(
    angles.map((v): Vec2 => {
      const t = ((v - (angles[0] as number)) / total) * 2 * Math.PI;
      return [rx * Math.cos(t), ry * Math.sin(t)];
    }),
    (turn * 180) / Math.PI,
  );
}

/** Random radii at sorted random angles: star-shaped around the origin, so always simple. */
export function randomStar(rng: Rng): Vec2[] {
  const n = 5 + rng.int(10);
  const angles: number[] = [];
  let a = 0;
  for (let i = 0; i < n; i++) {
    angles.push(a);
    a += rng.range(0.5, 1.5);
  }
  return angles.map((v): Vec2 => {
    const t = (v / a) * 2 * Math.PI;
    const r = rng.range(4, 12);
    return [r * Math.cos(t), r * Math.sin(t)];
  });
}

export type Family = 'rectilinear' | 'rectilinear-grid' | 'rectilinear-rotated' | 'convex' | 'star';
export const FAMILIES: readonly Family[] = [
  'rectilinear',
  'rectilinear-grid',
  'rectilinear-rotated',
  'convex',
  'star',
];

/** A random footprint of the given family; always a counter-clockwise simple ring. */
export function randomFootprint(family: Family, rng: Rng): Vec2[] {
  for (;;) {
    let ring: Vec2[] | null;
    switch (family) {
      case 'rectilinear':
        ring = randomRectilinear(rng, 0);
        break;
      case 'rectilinear-grid':
        ring = randomRectilinear(rng, 1, rng.chance(0.3));
        break;
      case 'rectilinear-rotated': {
        const r = randomRectilinear(rng, rng.chance(0.5) ? 0.5 : 0);
        ring = r ? rotate(r, rng.range(0, 360)) : null;
        break;
      }
      case 'convex':
        ring = randomConvex(rng);
        break;
      case 'star':
        ring = randomStar(rng);
        break;
    }
    if (ring && ring.length >= 3 && signedArea(ring) > 1) return ring;
  }
}
