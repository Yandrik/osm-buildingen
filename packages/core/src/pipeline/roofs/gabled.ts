import { clipRing, offsetRing } from '../../geom/polygon';
import { type Skeleton, straightSkeleton } from '../../geom/skeleton';
import { type Vec2, cross, dot, perp, sub } from '../../geom/vec2';
import type { RoofGeometry, Vec3In, WallSegment } from '../../types';
import { type ProfilePoint, buildSkeletonRoof } from './fromSkeleton';
import type { RoofContext } from './index';

/** Above this share of its oriented box a footprint counts as a rectangle. */
export const NEAR_RECTANGLE = 0.92;

/**
 * Edges that end a wing: their skeleton face is a triangle between two outer
 * corners, with the walls on either side running back roughly parallel. Those get
 * a gable wall. Neighbouring edges cannot both be gables, the shorter one wins.
 */
export function pickGableEnds(outer: readonly Vec2[], skeleton: Skeleton): number[] {
  const n = outer.length;
  const dirs = outer.map((a, i): Vec2 => {
    const b = outer[(i + 1) % n] as Vec2;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  });
  const candidates: { edge: number; mm: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (skeleton.faces[i]?.nodes.length !== 3) continue;
    const before = dirs[(i + n - 1) % n] as Vec2;
    const d = dirs[i] as Vec2;
    const after = dirs[(i + 1) % n] as Vec2;
    // Both corners turn inward by 30°–150° and the side walls are within 25° of parallel.
    if (cross(before, d) < 0.5 || cross(d, after) < 0.5 || dot(before, after) > -0.9) continue;
    const a = outer[i] as Vec2;
    const b = outer[(i + 1) % n] as Vec2;
    const mm = Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) * 1000);
    if (mm >= 1000) candidates.push({ edge: i, mm });
  }
  candidates.sort((p, q) => p.mm - q.mm || p.edge - q.edge);
  const taken = new Set<number>();
  for (const c of candidates) {
    if (!taken.has((c.edge + 1) % n) && !taken.has((c.edge + n - 1) % n)) taken.add(c.edge);
  }
  return [...taken].sort((p, q) => p - q);
}

/**
 * Gable ends of a (near-)rectangle: the walls across the ridge at either end of
 * the oriented box.
 */
function boxGableEnds(ctx: RoofContext): number[] {
  const { spec } = ctx;
  const outer = spec.footprint.outer;
  const n = outer.length;
  const axis = spec.roof.ridgeAxis;
  const center = spec.metrics.box.center;
  let half = 0;
  for (const p of outer) half = Math.max(half, Math.abs(dot(sub(p, center), axis)));
  const taken: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = outer[i] as Vec2;
    const b = outer[(i + 1) % n] as Vec2;
    const before = outer[(i + n - 1) % n] as Vec2;
    const after = outer[(i + 2) % n] as Vec2;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1) continue;
    const d: Vec2 = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    if (Math.abs(dot(d, axis)) > 0.5) continue;
    const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (Math.abs(dot(sub(mid, center), axis)) < half - Math.max(0.3, 0.05 * half)) continue;
    // Outer corners at both ends.
    if (cross(sub(a, before), d) <= 0 || cross(d, sub(after, b)) <= 0) continue;
    if (taken.includes((i + n - 1) % n)) continue;
    taken.push(i);
  }
  if (taken.length > 1 && taken[0] === 0 && taken[taken.length - 1] === n - 1) taken.pop();
  return taken;
}

/** The edges to close with a gable wall, or fewer than two if the footprint offers none. */
function gableEnds(ctx: RoofContext): number[] {
  const { spec } = ctx;
  const { box, rectangularity } = spec.metrics;
  const along = Math.abs(dot(spec.roof.ridgeAxis, box.axis)) > 0.5;
  if (rectangularity > NEAR_RECTANGLE || !along) return boxGableEnds(ctx);
  const skeleton = straightSkeleton(spec.footprint.outer);
  return skeleton ? pickGableEnds(spec.footprint.outer, skeleton) : [];
}

/** Lower part steep, upper part shallow; the kink sits `inset` of the way in and `rise` of the way up. */
const kinked =
  (inset: number, rise: number, minSlope: number) =>
  (maxTime: number, height: number): ProfilePoint[] => {
    const h = height * rise;
    const t = Math.min(maxTime * inset, h / minSlope);
    return [
      { t: 0, h: 0 },
      { t, h },
      { t: maxTime, h: height },
    ];
  };

/**
 * Half-hipped: gable walls up to 60 % of their height, the tip above replaced by a
 * small hip. Falls back to plain gabled.
 */
export function buildHalfHipped(ctx: RoofContext): RoofGeometry | null {
  if (ctx.spec.footprint.holes.length > 0) return null;
  const gables = gableEnds(ctx);
  return gables.length >= 2 ? buildSkeletonRoof(ctx, { gables, hipFrom: 0.6 }) : null;
}

/** Gambrel: gabled with two pitches, the lower one steep. */
export function buildGambrel(ctx: RoofContext): RoofGeometry | null {
  if (ctx.spec.footprint.holes.length > 0) return null;
  const gables = gableEnds(ctx);
  return gables.length >= 2 ? buildSkeletonRoof(ctx, { gables, profile: kinked(0.45, 0.65, 1.2) }) : null;
}

/**
 * Mansard: hipped with two pitches, a steep skirt and a shallow top. No overhang;
 * the skirt would hang far down over the wall.
 */
export function buildMansard(ctx: RoofContext): RoofGeometry | null {
  return buildSkeletonRoof(ctx, { profile: kinked(0.3, 0.7, 2), overhang: 0 });
}

/**
 * Gabled roof for footprints with wings (L, T, U, ...): the straight skeleton with
 * the wing ends held still, so each wing gets its own ridge and gable wall, with
 * valleys and hips where wings meet.
 */
function buildWingGable(ctx: RoofContext): RoofGeometry | null {
  const { spec } = ctx;
  const outer = spec.footprint.outer;
  const skeleton = straightSkeleton(outer);
  if (!skeleton) {
    spec.notes.push('gabled roof: straight skeleton failed, single ridge on the box axis');
    return null;
  }
  const gables = pickGableEnds(outer, skeleton);
  if (gables.length < 2) {
    spec.notes.push('gabled roof: fewer than two wing ends, single ridge on the box axis');
    return null;
  }
  const roof = buildSkeletonRoof(ctx, { gables });
  if (!roof) spec.notes.push('gabled roof: skeleton with gable ends failed, single ridge on the box axis');
  return roof;
}

/**
 * Gabled roof. Rectangles (and an explicit ridge across the long side) get the
 * exact single ridge; other footprints get one ridge per wing if the skeleton
 * finds at least two gable ends, and the single ridge otherwise.
 */
export function buildGabled(ctx: RoofContext): RoofGeometry | null {
  const { spec } = ctx;
  const { box, rectangularity } = spec.metrics;
  const along = Math.abs(dot(spec.roof.ridgeAxis, box.axis)) > 0.5;
  if (rectangularity <= NEAR_RECTANGLE && along && spec.footprint.holes.length === 0) {
    const roof = buildWingGable(ctx);
    if (roof) return roof;
  }
  return buildBoxGable(ctx);
}

/**
 * Gabled roof with the ridge through the centre of the oriented box.
 * Height falls off linearly with the distance from the ridge line, so the result
 * is exact for rectangles and a reasonable "one big gable" for other outlines.
 */
function buildBoxGable(ctx: RoofContext): RoofGeometry | null {
  const { spec, eave, overhang } = ctx;
  const outer = spec.footprint.outer;
  const axis = spec.roof.ridgeAxis;
  const side = perp(axis);
  const center = spec.metrics.box.center;

  let halfSpan = 0;
  for (const p of outer) halfSpan = Math.max(halfSpan, Math.abs(dot(sub(p, center), side)));
  if (halfSpan < 0.3 || spec.roof.height <= 0) return null;

  const heightAt = (p: Vec2): number =>
    spec.roof.height * (1 - Math.abs(dot(sub(p, center), side)) / halfSpan);
  const lift = (p: Vec2): Vec3In => [p[0], p[1], eave + heightAt(p)];

  const outline2d = overhang.some((o) => o > 0) ? offsetRing(outer, overhang) : outer;
  const left = clipRing(outline2d, center, side);
  const right = clipRing(outline2d, center, [-side[0], -side[1]]);
  if (left.length < 3 || right.length < 3) return null;

  // Roof edge with the ridge ends inserted, so the rake has its peak.
  const outline: Vec3In[] = [];
  const n = outline2d.length;
  for (let i = 0; i < n; i++) {
    const a = outline2d[i] as Vec2;
    const b = outline2d[(i + 1) % n] as Vec2;
    outline.push(lift(a));
    const da = dot(sub(a, center), side);
    const db = dot(sub(b, center), side);
    if (da * db < -1e-9) {
      const t = da / (da - db);
      outline.push(lift([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]));
    }
  }

  return {
    faces: [
      { points: left.map(lift), kind: 'slope' },
      { points: right.map(lift), kind: 'slope' },
    ],
    outline,
    heightAt,
    breaks(wall: WallSegment): number[] {
      // Where the wall crosses the ridge line.
      const den = cross(wall.dir, axis);
      if (Math.abs(den) < 1e-9) return [];
      const t = cross(sub(center, wall.a), axis) / den / wall.length;
      return t > 0 && t < 1 ? [t] : [];
    },
  };
}
