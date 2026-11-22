import { clipRing } from '../../geom/polygon';
import { type Vec2, dot, sub } from '../../geom/vec2';
import type { RoofFace, RoofGeometry, Vec3In, WallSegment } from '../../types';
import type { RoofContext } from './index';

/** Teeth are about this wide; the count is rounded so they divide the footprint evenly. */
const TOOTH = 6.5;
const MIN_TOOTH = 5;

/**
 * Sawtooth (shed) roof of factory halls: teeth one after another along the long
 * axis, each a long low slope and a short steep glazed face. All glazing faces the
 * same way, north where the footprint allows (as on real halls, for even light).
 *
 * Like the barrel roof, the footprint is cut into strips across the axis; every
 * strip is one planar face, so the walls along the axis follow the zigzag exactly.
 */
export function buildSawtooth(ctx: RoofContext): RoofGeometry | null {
  const { spec, eave } = ctx;
  const outer = spec.footprint.outer;
  const { box } = spec.metrics;
  const h = spec.roof.height;
  if (h <= 0 || box.halfLength < MIN_TOOTH / 2) return null;
  // Direction in which each tooth rises; the glass behind the peak faces this way.
  const run: Vec2 = box.axis[1] >= -1e-9 ? box.axis : [-box.axis[0], -box.axis[1]];
  const centre = box.center;
  const L = box.halfLength;
  const count = Math.max(1, Math.round((2 * L) / TOOTH));
  const width = (2 * L) / count;
  // Horizontal run of the glazed face: steep (about 75°) but not vertical, so it is still a roof face.
  const glass = Math.min(width * 0.3, Math.max(0.3, h * 0.27));
  const slope = width - glass;

  const along = (p: Vec2): number => dot(sub(p, centre), run);
  const heightAt = (p: Vec2): number => {
    const u = Math.min(2 * L, Math.max(0, along(p) + L));
    const x = u - Math.min(count - 1, Math.floor(u / width)) * width;
    return x <= slope ? (h * x) / slope : (h * (width - x)) / glass;
  };
  const lift = (p: Vec2): Vec3In => [p[0], p[1], eave + heightAt(p)];

  /** Strip borders along the axis, as offsets from the centre. */
  const borders: { u: number; glass: boolean }[] = [];
  for (let i = 0; i < count; i++) {
    borders.push({ u: -L + i * width, glass: false });
    borders.push({ u: -L + i * width + slope, glass: true });
  }
  borders.push({ u: L, glass: false });

  const faces: RoofFace[] = [];
  for (let k = 0; k + 1 < borders.length; k++) {
    const lo = borders[k] as { u: number; glass: boolean };
    const hi = borders[k + 1] as { u: number };
    const from: Vec2 = [centre[0] + run[0] * lo.u, centre[1] + run[1] * lo.u];
    const to: Vec2 = [centre[0] + run[0] * hi.u, centre[1] + run[1] * hi.u];
    // The first and last strips take everything beyond the box ends (rounding).
    const a = k === 0 ? outer : clipRing(outer, from, run);
    const strip = k + 2 === borders.length ? a : clipRing(a, to, [-run[0], -run[1]]);
    if (strip.length < 3) continue;
    // heightAt is continuous, so points on a strip border get the same height from both strips.
    const points = strip.map(lift);
    faces.push(lo.glass ? { points, kind: 'slope', material: 'glass' } : { points, kind: 'slope' });
  }
  if (faces.length === 0) return null;

  return {
    faces,
    outline: [],
    heightAt,
    breaks(wall: WallSegment): number[] {
      const ua = along(wall.a);
      const ub = along(wall.b);
      if (Math.abs(ub - ua) < 1e-9) return [];
      const out: number[] = [];
      for (const { u } of borders) {
        const t = (u - ua) / (ub - ua);
        if (t > 0 && t < 1) out.push(t);
      }
      return out;
    },
  };
}
