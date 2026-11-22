import { pointInRing } from '../../geom/polygon';
import { straightSkeleton } from '../../geom/skeleton';
import { type Vec2, lineIntersection } from '../../geom/vec2';
import type { RoofFace, RoofGeometry, Vec3In, WallSegment } from '../../types';
import type { RoofContext } from './index';

/**
 * Roofs built from the straight skeleton: hipped, and with some edges held still
 * (gable ends) gabled. A profile with a kink gives mansard and gambrel.
 *
 * Every point carries the time at which the wavefront reached it instead of a
 * height. Time is the distance from the face's own edge, so it is linear on a face
 * and the overhang simply continues it below zero. Heights come from the profile
 * at the very end.
 */

/** Roof height above the eave against the inward distance from the wall. */
export interface ProfilePoint {
  t: number;
  h: number;
}

export interface SkeletonRoofOptions {
  /** Outer-ring edges that get a gable wall instead of a roof face. No two may be neighbours. */
  gables?: readonly number[];
  /**
   * Half-hipped: share (0..1) of each gable's height at which the wall stops and a
   * small hip takes over. Without it the gables run up to the ridge.
   */
  hipFrom?: number;
  /** Section through the roof, from (0, 0) to (maxTime, height). Default: a straight line. */
  profile?: (maxTime: number, height: number) => ProfilePoint[];
  /** Factor on the overhang from the context (mansards have none). */
  overhang?: number;
}

/** [east, north, time] */
type P3 = readonly [number, number, number];

/** A sharp corner's overhang would stick out this many times the overhang; beyond that it is cut off. */
const MITER_LIMIT = 2.5;

/** Where along an eave to test that it stays outside the footprint. */
const EAVE_SAMPLES = [0.02, 0.25, 0.5, 0.75, 0.98];

interface Corner {
  /** Points the face of the edge before the corner ends with. */
  end: P3[];
  /** Points the face of the edge after the corner starts with. */
  start: P3[];
  outline: P3[];
}

/** Wall under a gable end. */
interface GableWall {
  /** Top of the wall: [position along the edge 0..1, time]. */
  top: (readonly [number, number])[];
  /** Roof edge above the wall, where the roof runs out over it: one point over the peak, or two for a hipped tip. */
  rake: P3[];
  /** The tip is hipped off: the edge has a (small) roof face of its own. */
  hip: boolean;
}

interface Edge {
  a: Vec2;
  d: Vec2;
  /** Inward normal. */
  n: Vec2;
  length: number;
}

const offsetPoint = (e: Edge, o: number): Vec2 => [e.a[0] - e.n[0] * o, e.a[1] - e.n[1] * o];

/**
 * Velocity of the wavefront corner between two edges. The hip or valley above the
 * corner runs along it; walking it backwards continues that line out over the eave.
 */
function cornerVelocity(ea: Edge, eb: Edge): Vec2 {
  const cr = ea.d[0] * eb.d[1] - ea.d[1] * eb.d[0];
  const dt = ea.d[0] * eb.d[0] + ea.d[1] * eb.d[1];
  if (dt > 0) return [(ea.n[0] + eb.n[0]) / (1 + dt), (ea.n[1] + eb.n[1]) / (1 + dt)];
  const safe = Math.abs(cr) > 1e-6 ? cr : 1e-6;
  return [(eb.d[0] - ea.d[0]) / safe, (eb.d[1] - ea.d[1]) / safe];
}

/** Roof edge around one footprint corner, between the edges `ea` and `eb` with overhangs `oa`, `ob`. */
function corner(c: Vec2, ea: Edge, eb: Edge, oa: number, ob: number): Corner {
  const cr = ea.d[0] * eb.d[1] - ea.d[1] * eb.d[0];
  const [vx, vy] = cornerVelocity(ea, eb);
  const speed = Math.hypot(vx, vy);
  const onBisector = (o: number): P3 => [c[0] - vx * o, c[1] - vy * o, -o];
  const convex = cr > 1e-6;

  if (Math.abs(oa - ob) < 1e-6) {
    if (oa < 1e-6) {
      const p: P3 = [c[0], c[1], 0];
      return { end: [p], start: [p], outline: [p] };
    }
    if (convex && speed > MITER_LIMIT) {
      // Cut the tip off square to the bisector.
      const reach = MITER_LIMIT * oa;
      const tip: Vec2 = [c[0] - (vx / speed) * reach, c[1] - (vy / speed) * reach];
      const across: Vec2 = [-vy / speed, vx / speed];
      const pa = lineIntersection(offsetPoint(ea, oa), ea.d, tip, across);
      const pb = lineIntersection(offsetPoint(eb, ob), eb.d, tip, across);
      if (pa && pb) {
        const mid: P3 = [tip[0], tip[1], -reach / speed];
        const qa: P3 = [pa[0], pa[1], -oa];
        const qb: P3 = [pb[0], pb[1], -ob];
        return { end: [qa, mid], start: [mid, qb], outline: [qa, mid, qb] };
      }
    }
    const p = onBisector(oa);
    return { end: [p], start: [p], outline: [p] };
  }

  // Different overhangs (one side is usually 0 because a neighbour stands there): both
  // faces reach the bisector at the smaller overhang, the wider one has a corner of its own.
  const low = Math.min(oa, ob);
  const high = Math.max(oa, ob);
  const shared = onBisector(low);
  let own = onBisector(high);
  if (convex) {
    const wide = oa > ob ? ea : eb;
    const q = lineIntersection(offsetPoint(ea, oa), ea.d, offsetPoint(eb, ob), eb.d);
    own =
      q && Math.hypot(q[0] - c[0], q[1] - c[1]) <= 4 * high + 0.01
        ? [q[0], q[1], -high]
        : [c[0] - wide.n[0] * high, c[1] - wide.n[1] * high, -high];
  }
  return oa > ob
    ? { end: [own, shared], start: [shared], outline: [own, shared] }
    : { end: [shared], start: [shared, own], outline: [shared, own] };
}

/** Keeps the part of a polygon where `sign * (time - level) >= 0`. Time is linear along every side. */
function clipTime(points: readonly P3[], level: number, sign: number): P3[] {
  const out: P3[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const p = points[i] as P3;
    const q = points[(i + 1) % n] as P3;
    const dp = sign * (p[2] - level);
    const dq = sign * (q[2] - level);
    if (dp >= 0) out.push(p);
    if (dp >= 0 !== dq >= 0) {
      const k = dp / (dp - dq);
      out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k, level]);
    }
  }
  return out;
}

function area(points: readonly P3[]): number {
  let a = 0;
  for (let i = 0, n = points.length; i < n; i++) {
    const p = points[i] as P3;
    const q = points[(i + 1) % n] as P3;
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Drops repeated points. */
function tidy(points: readonly P3[]): P3[] {
  const out: P3[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-6) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0] as P3;
    const b = out[out.length - 1] as P3;
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-6) break;
    out.pop();
  }
  return out;
}

export function buildSkeletonRoof(ctx: RoofContext, options: SkeletonRoofOptions = {}): RoofGeometry | null {
  const { spec, eave } = ctx;
  const outer = spec.footprint.outer;
  const holes = spec.footprint.holes;
  const n = outer.length;
  if (n < 3 || spec.roof.height <= 0) return null;

  const gables = new Set(options.gables ?? []);
  for (const g of gables) if (gables.has((g + 1) % n)) return null;
  const never = outer.map((_, i) => (gables.has(i) ? Number.POSITIVE_INFINITY : 0));
  let skeleton = straightSkeleton(outer, holes, gables.size > 0 ? { delay: never } : {});
  if (!skeleton || skeleton.maxTime < 0.3) return null;

  const edges: Edge[] = outer.map((a, i) => {
    const b = outer[(i + 1) % n] as Vec2;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const d: Vec2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    return { a, d, n: [-d[1], d[0]], length };
  });
  const overhang = edges.map((_, i) => Math.max(0, ctx.overhang[i] ?? 0) * (options.overhang ?? 1));
  const tauOf = (g: number, p: Vec2): number => {
    const e = edges[g] as Edge;
    return ((p[0] - e.a[0]) * e.d[0] + (p[1] - e.a[1]) * e.d[1]) / e.length;
  };

  // --- Gable ends ---
  // The skeleton face of a gable edge has no area: its two ends and the point on the
  // edge where the neighbouring roof faces meet, the peak of the gable wall.
  if (options.hipFrom !== undefined && gables.size > 0) {
    // Half-hipped: the gable edges do start to move, once the wall is high enough.
    const delay = never.slice();
    for (const g of gables) {
      const face = skeleton.faces[g];
      if (!face || face.nodes.length !== 3) return null;
      delay[g] = (face.times[2] as number) * options.hipFrom;
    }
    skeleton = straightSkeleton(outer, holes, { delay });
    if (!skeleton) return null;
  }
  for (const face of skeleton.faces) if (face.nodes.length < 3) return null;

  const walls = new Map<number, GableWall>();
  let maxTime = skeleton.maxTime;
  for (const g of gables) {
    const face = skeleton.faces[g] as { nodes: number[]; points: Vec2[]; times: number[] };
    const e = edges[g] as Edge;
    const before = edges[(g + n - 1) % n] as Edge;
    const after = edges[(g + 1) % n] as Edge;
    const reachOut = overhang[g] as number;
    const last = face.nodes.length - 1;
    if (last === 2) {
      const p = face.points[2] as Vec2;
      const time = face.times[2] as number;
      const tau = tauOf(g, p);
      if (!(tau > 0.05 && tau < 0.95) || time < 0.05) return null;
      // The ridge runs on over the overhang, along the line where both neighbours are equally high.
      let ux = -(before.n[1] - after.n[1]);
      let uy = before.n[0] - after.n[0];
      const ul = Math.hypot(ux, uy);
      if (ul < 1e-6) return null;
      ux /= ul;
      uy /= ul;
      let outward = -(ux * e.n[0] + uy * e.n[1]);
      if (outward < 0) {
        ux = -ux;
        uy = -uy;
        outward = -outward;
      }
      if (outward < 0.3) return null; // the ridge runs along the gable wall
      const reach = reachOut / outward;
      const out: P3 = [
        p[0] + ux * reach,
        p[1] + uy * reach,
        time + reach * (before.n[0] * ux + before.n[1] * uy),
      ];
      if (out[2] > maxTime) maxTime = out[2];
      walls.set(g, {
        top: [
          [0, 0],
          [tau, time],
          [1, 0],
        ],
        rake: [out],
        hip: false,
      });
    } else {
      if (options.hipFrom === undefined) return null; // a gable wall with more than one peak
      // Hipped tip: the wall top is level between the points where the hip starts.
      const right = face.points[2] as Vec2;
      const left = face.points[last] as Vec2;
      const time = face.times[2] as number;
      const tauLeft = tauOf(g, left);
      const tauRight = tauOf(g, right);
      const onEdge = (p: Vec2): boolean =>
        Math.abs((p[0] - e.a[0]) * e.n[0] + (p[1] - e.a[1]) * e.n[1]) < 1e-3;
      if (
        !onEdge(left) ||
        !onEdge(right) ||
        Math.abs((face.times[last] as number) - time) > 1e-3 ||
        !(tauLeft > 0.02 && tauRight > tauLeft + 0.02 && tauRight < 0.98) ||
        time < 0.05
      )
        return null;
      const vl = cornerVelocity(before, e);
      const vr = cornerVelocity(e, after);
      const outLeft: P3 = [left[0] - vl[0] * reachOut, left[1] - vl[1] * reachOut, time - reachOut];
      const outRight: P3 = [right[0] - vr[0] * reachOut, right[1] - vr[1] * reachOut, time - reachOut];
      walls.set(g, {
        top: [
          [0, 0],
          [tauLeft, time],
          [tauRight, time],
          [1, 0],
        ],
        rake: [outLeft, outRight],
        hip: true,
      });
    }
  }

  // --- Roof edge ---
  let corners: Corner[] = [];
  for (let pass = 0; pass <= n; pass++) {
    corners = outer.map((c, i) => {
      const a = (i + n - 1) % n;
      const ea = edges[a] as Edge;
      const eb = edges[i] as Edge;
      const oa = overhang[a] as number;
      const ob = overhang[i] as number;
      if (!gables.has(a) && !gables.has(i)) return corner(c, ea, eb, oa, ob);
      // Next to a gable the eave runs on to the edge of the roof over the gable wall.
      const q = lineIntersection(offsetPoint(ea, oa), ea.d, offsetPoint(eb, ob), eb.d) ?? [
        c[0] - ea.n[0] * oa - eb.n[0] * ob,
        c[1] - ea.n[1] * oa - eb.n[1] * ob,
      ];
      const p: P3 = [q[0], q[1], gables.has(i) ? -oa : -ob];
      return gables.has(i) ? { end: [p], start: [], outline: [p] } : { end: [], start: [p], outline: [p] };
    });
    // In a notch narrower than the overhang the eave would turn inside out or reach
    // through the wall opposite. Such a wall gets no overhang.
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (gables.has(i) || (overhang[i] as number) === 0) continue;
      const from = (corners[i] as Corner).start;
      const to = (corners[(i + 1) % n] as Corner).end;
      const p = from[from.length - 1];
      const q = to[0];
      if (!p || !q) continue;
      const e = edges[i] as Edge;
      let bad = (q[0] - p[0]) * e.d[0] + (q[1] - p[1]) * e.d[1] < 0.02;
      for (const k of EAVE_SAMPLES) {
        if (bad) break;
        bad = pointInRing([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k], outer);
      }
      if (bad) {
        overhang[i] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }

  // --- Heights ---
  const profile = options.profile?.(maxTime, spec.roof.height) ?? [
    { t: 0, h: 0 },
    { t: maxTime, h: spec.roof.height },
  ];
  const first = profile[1];
  if (profile.length < 2 || !first || first.t <= 0) return null;
  const eaveSlope = first.h / first.t;
  const heightOf = (t: number): number => {
    if (t <= 0) return t * eaveSlope;
    for (let k = 1; k < profile.length; k++) {
      const p = profile[k - 1] as ProfilePoint;
      const q = profile[k] as ProfilePoint;
      if (t <= q.t) return p.h + ((q.h - p.h) * (t - p.t)) / (q.t - p.t);
    }
    return (profile[profile.length - 1] as ProfilePoint).h;
  };
  const lift = (p: P3): Vec3In => [p[0], p[1], eave + heightOf(p[2])];

  // --- Faces ---
  const faces: RoofFace[] = [];
  const nodes = skeleton.nodes;
  const nodePoint = (id: number): P3 => {
    const node = nodes[id] as { p: Vec2; time: number };
    return [node.p[0], node.p[1], node.time];
  };
  for (const face of skeleton.faces) {
    const wall = face.ring === 0 ? walls.get(face.edge) : undefined;
    if (wall && !wall.hip) continue;
    const inner = face.nodes.slice(2).map(nodePoint);
    let points: P3[];
    if (wall) {
      // The hip over a gable wall, run out to the roof edge at both ends.
      points = tidy([wall.rake[1] as P3, ...inner, wall.rake[0] as P3]);
    } else if (face.ring === 0) {
      // Next to a gable the face runs out over the wall, from the top of the wall
      // to the roof edge. (Only these two faces do; a third one may end in that point.)
      const after = walls.get((face.edge + 1) % n);
      const before = walls.get((face.edge + n - 1) % n);
      points = tidy([
        ...(corners[face.edge] as Corner).start,
        ...(corners[(face.edge + 1) % n] as Corner).end,
        ...(after ? [after.rake[0] as P3] : []),
        ...inner,
        ...(before ? [before.rake[before.rake.length - 1] as P3] : []),
      ]);
    } else points = tidy(face.nodes.map(nodePoint));
    // One piece per straight part of the profile.
    for (let k = 1; k < profile.length; k++) {
      let band: P3[] = points;
      if (k > 1) band = clipTime(band, (profile[k - 1] as ProfilePoint).t, 1);
      if (k < profile.length - 1) band = clipTime(band, (profile[k] as ProfilePoint).t, -1);
      band = tidy(band);
      if (band.length >= 3 && area(band) > 1e-6) faces.push({ points: band.map(lift), kind: 'slope' });
    }
  }
  if (faces.length === 0) return null;

  const outline: Vec3In[] = [];
  for (let i = 0; i < n; i++) {
    for (const p of (corners[i] as Corner).outline) outline.push(lift(p));
    for (const p of walls.get(i)?.rake ?? []) outline.push(lift(p));
  }

  // --- Walls under gable ends ---
  const timeOnWall = (wall: GableWall, tau: number): number => {
    for (let k = 1; k < wall.top.length; k++) {
      const p = wall.top[k - 1] as readonly [number, number];
      const q = wall.top[k] as readonly [number, number];
      if (tau <= q[0]) return q[0] > p[0] ? p[1] + ((q[1] - p[1]) * (tau - p[0])) / (q[0] - p[0]) : q[1];
    }
    return 0;
  };
  return {
    faces,
    // Without any overhang there is no roof edge to trim.
    outline: overhang.some((o) => o > 0) ? outline : [],
    heightAt(p: Vec2): number {
      for (const [g, wall] of walls) {
        const e = edges[g] as Edge;
        const along = (p[0] - e.a[0]) * e.d[0] + (p[1] - e.a[1]) * e.d[1];
        const off = (p[0] - e.a[0]) * e.n[0] + (p[1] - e.a[1]) * e.n[1];
        if (Math.abs(off) > 1e-4 || along < -1e-4 || along > e.length + 1e-4) continue;
        return Math.max(0, heightOf(timeOnWall(wall, Math.min(1, Math.max(0, along / e.length)))));
      }
      return 0;
    },
    breaks(segment: WallSegment): number[] {
      const wall = segment.ring === 0 ? walls.get(segment.index) : undefined;
      if (!wall) return [];
      const out: number[] = [];
      for (let k = 1; k < wall.top.length; k++) {
        const p = wall.top[k - 1] as readonly [number, number];
        const q = wall.top[k] as readonly [number, number];
        if (k > 1) out.push(p[0]);
        // The wall top follows the profile, so it also bends where the profile does.
        for (let j = 1; j < profile.length - 1; j++) {
          const t = (profile[j] as ProfilePoint).t;
          if ((t - p[1]) * (t - q[1]) < 0) out.push(p[0] + ((q[0] - p[0]) * (t - p[1])) / (q[1] - p[1]));
        }
      }
      return out;
    },
  };
}
