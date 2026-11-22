import { clipRing } from '../../geom/polygon';
import { type Vec2, cross, dot, perp, sub } from '../../geom/vec2';
import type { RoofFace, RoofGeometry, Vec3In, WallSegment } from '../../types';
import type { RoofContext } from './index';

/** Strips per side of the ridge. */
const STRIPS = 4;

/**
 * Barrel roof: like a gabled roof, but the cross-section is an arc.
 * The footprint is cut into strips parallel to the ridge; each strip is a flat
 * face, so gable walls can follow the same piecewise-linear profile exactly.
 */
export function buildRound(ctx: RoofContext): RoofGeometry | null {
  const { spec, eave } = ctx;
  const outer = spec.footprint.outer;
  const axis = spec.roof.ridgeAxis;
  const side = perp(axis);
  const center = spec.metrics.box.center;
  let halfSpan = 0;
  for (const p of outer) halfSpan = Math.max(halfSpan, Math.abs(dot(sub(p, center), side)));
  if (halfSpan < 0.3 || spec.roof.height <= 0) return null;

  // Strip borders as distance from the ridge (0 .. halfSpan) with their heights on the arc.
  const borders: { d: number; h: number }[] = [];
  for (let k = 0; k <= STRIPS; k++) {
    const a = (k / STRIPS) * (Math.PI / 2);
    borders.push({ d: halfSpan * Math.sin(a), h: spec.roof.height * Math.cos(a) });
  }
  const heightAt = (p: Vec2): number => {
    const d = Math.min(halfSpan, Math.abs(dot(sub(p, center), side)));
    for (let k = 0; k < STRIPS; k++) {
      const lo = borders[k] as { d: number; h: number };
      const hi = borders[k + 1] as { d: number; h: number };
      if (d <= hi.d + 1e-9) return lo.h + ((hi.h - lo.h) * (d - lo.d)) / Math.max(1e-9, hi.d - lo.d);
    }
    return 0;
  };
  const lift = (p: Vec2): Vec3In => [p[0], p[1], eave + heightAt(p)];

  const faces: RoofFace[] = [];
  for (const sign of [1, -1]) {
    const n: Vec2 = [side[0] * sign, side[1] * sign];
    for (let k = 0; k < STRIPS; k++) {
      const lo = (borders[k] as { d: number }).d;
      const hi = (borders[k + 1] as { d: number }).d;
      // Keep the part of the footprint with lo <= distance <= hi on this side of the ridge.
      const from: Vec2 = [center[0] + n[0] * lo, center[1] + n[1] * lo];
      const to: Vec2 = [center[0] + n[0] * hi, center[1] + n[1] * hi];
      const strip = clipRing(clipRing(outer, from, n), to, [-n[0], -n[1]]);
      if (strip.length >= 3) faces.push({ points: strip.map(lift), kind: 'curved' });
    }
  }
  if (faces.length === 0) return null;

  return {
    faces,
    outline: [],
    heightAt,
    breaks(wall: WallSegment): number[] {
      // Every strip border the wall crosses is a kink in its top edge.
      const den = cross(wall.dir, axis);
      if (Math.abs(den) < 1e-9) return [];
      const out: number[] = [];
      for (const sign of [1, -1]) {
        for (let k = 0; k < STRIPS; k++) {
          const d = (borders[k] as { d: number }).d * sign;
          if (k === 0 && sign === -1) continue; // the ridge itself, already added
          const origin: Vec2 = [center[0] + side[0] * d, center[1] + side[1] * d];
          const t = cross(sub(origin, wall.a), axis) / den / wall.length;
          if (t > 0 && t < 1) out.push(t);
        }
      }
      return out;
    },
  };
}
