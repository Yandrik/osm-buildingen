/** 2D point or vector in metres. x = east, y = north. */
export type Vec2 = readonly [number, number];

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec2, s: number): Vec2 => [a[0] * s, a[1] * s];
export const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const length = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const distance = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
/** Rotated 90° counter-clockwise. */
export const perp = (a: Vec2): Vec2 => [-a[1], a[0]];

export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [1, 0];
}

/** Distance from point p to segment ab, and the parameter t of the closest point. */
export function pointSegment(p: Vec2, a: Vec2, b: Vec2): { distance: number; t: number } {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const len2 = abx * abx + aby * aby;
  let t = len2 > 1e-18 ? ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return { distance: Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t)), t };
}

/** Intersection of the infinite lines p + s·d and q + u·e, or null if parallel. */
export function lineIntersection(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-12) return null;
  const s = cross(sub(q, p), e) / den;
  return [p[0] + d[0] * s, p[1] + d[1] * s];
}
