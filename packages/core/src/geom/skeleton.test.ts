import { describe, expect, it } from 'vitest';
import {
  COURTYARD,
  FAMILIES,
  FIXED_SHAPES,
  type Family,
  randomFootprint,
  rect,
  rotate,
} from '../../test/shapes';
import { Rng } from '../rng';
import { pointInRing, signedArea } from './polygon';
import { type Skeleton, straightSkeleton } from './skeleton';
import type { Vec2 } from './vec2';

/**
 * Independent check of a skeleton: returns what is wrong with it, or null.
 * Faces must start with their edge, be counter-clockwise and planar (time equals the
 * distance from the edge) and tile the polygon: areas add up, and random points
 * inside lie in exactly one face.
 */
function problem(
  outer: readonly Vec2[],
  holes: readonly (readonly Vec2[])[],
  sk: Skeleton,
  rng: Rng,
  delay: readonly number[] = [],
): string | null {
  const rings = [outer, ...holes];
  const edges = rings.reduce((sum, r) => sum + r.length, 0);
  if (sk.faces.length !== edges) return `expected ${edges} faces, got ${sk.faces.length}`;
  let area = 0;
  let index = 0;
  let maxTime = 0;
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r] as readonly Vec2[];
    for (let e = 0; e < ring.length; e++, index++) {
      const face = sk.faces[index];
      if (!face || face.ring !== r || face.edge !== e) return `face ${index} is not for ring ${r} edge ${e}`;
      const a = ring[e] as Vec2;
      const b = ring[(e + 1) % ring.length] as Vec2;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (face.points.length === 0) {
        if (length > 1e-3) return `edge ${index} of length ${length} has no face`;
        continue;
      }
      if (face.points.length < 3 || face.points.length !== face.times.length) return `face ${index} is short`;
      const p0 = face.points[0] as Vec2;
      const p1 = face.points[1] as Vec2;
      if (Math.hypot(p0[0] - a[0], p0[1] - a[1]) > 1e-4 || Math.hypot(p1[0] - b[0], p1[1] - b[1]) > 1e-4)
        return `face ${index} does not start with its edge`;
      if (face.times[0] !== 0 || face.times[1] !== 0) return `face ${index}: edge is not at time 0`;
      const faceArea = signedArea(face.points);
      if (faceArea < -1e-6) return `face ${index} is clockwise (${faceArea})`;
      area += faceArea;
      const wait = delay[index] ?? 0;
      for (let k = 0; k < face.points.length; k++) {
        const p = face.points[k] as Vec2;
        const t = face.times[k] as number;
        if (!(t >= 0) || !Number.isFinite(p[0]) || !Number.isFinite(p[1]))
          return `face ${index} has a bad point`;
        const distance = (-(b[1] - a[1]) * (p[0] - a[0]) + (b[0] - a[0]) * (p[1] - a[1])) / length;
        if (Math.abs(distance - Math.max(0, t - wait)) > 1e-3)
          return `face ${index} is not planar: distance ${distance}, time ${t}`;
        if (t > maxTime) maxTime = t;
      }
    }
  }
  if (Math.abs(maxTime - sk.maxTime) > 1e-9) return `maxTime ${sk.maxTime} but highest point at ${maxTime}`;
  let expected = signedArea(outer);
  for (const h of holes) expected += signedArea(h);
  if (Math.abs(area - expected) > 0.005 * expected) return `faces cover ${area} of ${expected}`;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of outer) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  for (let k = 0; k < 60; k++) {
    const p: Vec2 = [rng.range(minX - 1, maxX + 1), rng.range(minY - 1, maxY + 1)];
    const inside = pointInRing(p, outer) && !holes.some((h) => pointInRing(p, h));
    let count = 0;
    for (const face of sk.faces) if (face.points.length >= 3 && pointInRing(p, face.points)) count++;
    if (count !== (inside ? 1 : 0)) return `point ${p} (inside: ${inside}) lies in ${count} faces`;
  }
  return null;
}

const sizes = (sk: Skeleton | null): number[] => (sk?.faces ?? []).map((f) => f.points.length);

describe('straightSkeleton: fixed shapes', () => {
  for (const [name, outer] of Object.entries(FIXED_SHAPES)) {
    it(`${name}`, () => {
      const sk = straightSkeleton(outer);
      expect(sk).not.toBeNull();
      expect(problem(outer, [], sk as Skeleton, new Rng(1))).toBeNull();
      expect(sk?.attempt).toBe(0);
    });
  }

  it('rectangle: two trapezoids and two triangles around a ridge', () => {
    const sk = straightSkeleton(rect(10, 8));
    expect(sizes(sk)).toEqual([4, 3, 4, 3]);
    expect(sk?.maxTime).toBeCloseTo(4, 9);
    expect(sk?.nodes.length).toBe(6);
    const ridge = sk?.nodes.filter((n) => n.time > 0).map((n) => n.p) ?? [];
    expect(ridge.map((p) => p[1])).toEqual([4, 4]);
    expect(ridge.map((p) => p[0]).sort((a, b) => a - b)).toEqual([4, 6]);
  });

  it('square: four triangles to one apex', () => {
    const sk = straightSkeleton(rect(9, 9));
    expect(sizes(sk)).toEqual([3, 3, 3, 3]);
    expect(sk?.nodes.length).toBe(5);
    expect(sk?.nodes[4]?.p).toEqual([4.5, 4.5]);
  });

  it('L: ridges at half the wing width, valley and hip on the diagonal', () => {
    const sk = straightSkeleton(FIXED_SHAPES.L as Vec2[]);
    expect(sk?.maxTime).toBeCloseTo(3, 9);
    expect(sizes(sk)).toEqual([4, 3, 4, 4, 3, 4]);
  });

  it('plus and H: everything meets at once and still comes out exact', () => {
    const plus = straightSkeleton(FIXED_SHAPES.plus as Vec2[]);
    expect(plus?.maxTime).toBeCloseTo(2.5, 9);
    expect(plus?.nodes.some((n) => Math.hypot(n.p[0] - 7.5, n.p[1] - 7.5) < 1e-9)).toBe(true);
    const h = straightSkeleton(FIXED_SHAPES.H as Vec2[]);
    expect(h?.maxTime).toBeCloseTo(2.5, 9);
  });

  it('rotation does not change the result', () => {
    const a = straightSkeleton(FIXED_SHAPES.T as Vec2[]);
    const b = straightSkeleton(rotate(FIXED_SHAPES.T as Vec2[], 33));
    expect(sizes(b)).toEqual(sizes(a));
    expect(b?.maxTime).toBeCloseTo(a?.maxTime ?? 0, 9);
  });

  it('points in the middle of walls and doubled points', () => {
    const outer = FIXED_SHAPES.messyL as Vec2[];
    const sk = straightSkeleton(outer);
    expect(sk?.maxTime).toBeCloseTo(3, 6);
    // The two edges between doubled points have no face, every other edge does.
    expect(sizes(sk).filter((n) => n === 0).length).toBe(2);
    expect(sk?.faces[3]?.points.length).toBe(0);
    expect(sk?.faces[11]?.points.length).toBe(0);
  });

  it('courtyard: hole edges get faces too', () => {
    const sk = straightSkeleton(COURTYARD.outer, COURTYARD.holes);
    expect(sk).not.toBeNull();
    expect(sizes(sk)).toEqual([4, 4, 4, 4, 4, 4, 4, 4]);
    expect(sk?.maxTime).toBeCloseTo(2.5, 9);
    expect(problem(COURTYARD.outer, COURTYARD.holes, sk as Skeleton, new Rng(2))).toBeNull();
  });

  it('a hole off centre', () => {
    const holes = [[...rect(3, 4, 2, 9)].reverse()];
    const outer = rect(16, 15);
    const sk = straightSkeleton(outer, holes);
    expect(sk).not.toBeNull();
    expect(problem(outer, holes, sk as Skeleton, new Rng(3))).toBeNull();
  });
});

describe('straightSkeleton: waiting edges', () => {
  it('gable ends: the face is a wall with its peak in the middle', () => {
    const outer = rect(10, 8);
    const delay = [0, Number.POSITIVE_INFINITY, 0, Number.POSITIVE_INFINITY];
    const sk = straightSkeleton(outer, [], { delay });
    expect(sizes(sk)).toEqual([4, 3, 4, 3]);
    expect(problem(outer, [], sk as Skeleton, new Rng(4), delay)).toBeNull();
    expect(sk?.faces[1]?.points[2]).toEqual([10, 4]);
    expect(sk?.faces[1]?.times[2]).toBeCloseTo(4, 9);
    expect(signedArea(sk?.faces[0]?.points ?? [])).toBeCloseTo(40, 9);
  });

  it('gable ends on an L: both wings', () => {
    const outer = FIXED_SHAPES.L as Vec2[];
    const delay = [0, Number.POSITIVE_INFINITY, 0, 0, Number.POSITIVE_INFINITY, 0];
    const sk = straightSkeleton(outer, [], { delay });
    expect(problem(outer, [], sk as Skeleton, new Rng(5), delay)).toBeNull();
    expect(sk?.faces[1]?.points[2]).toEqual([12, 3]);
    expect(sk?.faces[4]?.points[2]).toEqual([3, 11]);
  });

  it('a late start hips the tip of the gable', () => {
    const outer = rect(10, 8);
    const delay = [0, 2.4, 0, 2.4];
    const sk = straightSkeleton(outer, [], { delay });
    expect(problem(outer, [], sk as Skeleton, new Rng(6), delay)).toBeNull();
    // Wall up to time 2.4 between y = 2.4 and y = 5.6, then a triangle to the ridge.
    const face = sk?.faces[1];
    expect(face?.points.length).toBe(5);
    expect(face?.points[2]).toEqual([10, 5.6]);
    expect(face?.points[4]).toEqual([10, 2.4]);
    expect(face?.times[3]).toBeCloseTo(4, 9);
  });
});

describe('straightSkeleton: bad input', () => {
  it('returns null instead of throwing', () => {
    const bowTie: Vec2[] = [
      [0, 0],
      [10, 8],
      [10, 0],
      [0, 8],
    ];
    expect(straightSkeleton(bowTie)).toBeNull();
    expect(straightSkeleton([...rect(10, 8)].reverse())).toBeNull();
    expect(straightSkeleton([])).toBeNull();
    expect(
      straightSkeleton([
        [0, 0],
        [1, 0],
      ]),
    ).toBeNull();
    expect(
      straightSkeleton([
        [0, 0],
        [5, 0],
        [Number.NaN, 4],
      ]),
    ).toBeNull();
    expect(
      straightSkeleton([
        [0, 0],
        [5, 0],
        [10, 0],
      ]),
    ).toBeNull();
    // Hole outside the outer ring, and a hole with the wrong orientation.
    expect(straightSkeleton(rect(10, 8), [[...rect(2, 2, 20, 20)].reverse()])).toBeNull();
    expect(straightSkeleton(rect(10, 8), [rect(2, 2, 4, 3)])).toBeNull();
    // A spike: the ring runs back along itself.
    expect(
      straightSkeleton([
        [0, 0],
        [10, 0],
        [10, 8],
        [5, 8],
        [5, 12],
        [5, 8],
        [0, 8],
      ]),
    ).toBeNull();
  });
});

/** Runs `count` random footprints of a family; returns how many had no skeleton. */
function sweep(count: number, seed: number, make: (rng: Rng) => { outer: Vec2[]; holes?: Vec2[][] }): number {
  const rng = new Rng(seed);
  const probe = new Rng(seed + 1);
  let missing = 0;
  for (let i = 0; i < count; i++) {
    const { outer, holes = [] } = make(rng);
    const sk = straightSkeleton(outer, holes);
    if (!sk) {
      missing++;
      continue;
    }
    const wrong = problem(outer, holes, sk, probe);
    if (wrong) throw new Error(`${wrong}\n${JSON.stringify({ outer, holes })}`);
  }
  return missing;
}

describe('straightSkeleton: random footprints', () => {
  const COUNT = 1000;
  // Share of footprints that may come back without a skeleton.
  const limit: Record<Family, number> = {
    rectilinear: 0.01,
    'rectilinear-grid': 0.01,
    'rectilinear-rotated': 0.01,
    convex: 0.01,
    star: 0.02,
  };
  for (const family of FAMILIES) {
    it(`${family}: valid whenever there is a result`, () => {
      const missing = sweep(COUNT, 1000 + FAMILIES.indexOf(family), (rng) => ({
        outer: randomFootprint(family, rng),
      }));
      expect(missing / COUNT).toBeLessThanOrEqual(limit[family]);
    });
  }

  it('walls a hair off the grid (the hard case: nearly simultaneous events)', () => {
    // Corner noise from 1 cm down to 0.1 nm, half of the footprints rotated.
    const missing = sweep(2000, 77, (rng) => {
      const ring = randomFootprint('rectilinear-grid', rng);
      const noise = 10 ** -rng.range(2, 10);
      const turn = rng.chance(0.5) ? rng.range(0, 360) : 0;
      return {
        outer: rotate(
          ring.map((p): Vec2 => [p[0] + rng.range(-noise, noise), p[1] + rng.range(-noise, noise)]),
          turn,
        ),
      };
    });
    expect(missing / 2000).toBeLessThanOrEqual(0.01);
  });

  it('rectangles with a rectangular courtyard', () => {
    const missing = sweep(500, 99, (rng) => {
      const w = rng.range(12, 30);
      const d = rng.range(12, 30);
      const hw = rng.range(2, w - 6);
      const hd = rng.range(2, d - 6);
      const hx = rng.range(2, w - hw - 2);
      const hy = rng.range(2, d - hd - 2);
      const turn = rng.range(0, 360);
      return {
        outer: rotate(rect(w, d), turn),
        holes: [rotate([...rect(hw, hd, hx, hy)].reverse(), turn)],
      };
    });
    expect(missing / 500).toBeLessThanOrEqual(0.01);
  });

  it('is deterministic', () => {
    const outer = randomFootprint('star', new Rng(5));
    expect(straightSkeleton(outer)).toEqual(straightSkeleton(outer));
  });
});
