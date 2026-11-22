import { offsetRing } from '../../geom/polygon';
import { type Vec2, distance, dot, normalize, sub } from '../../geom/vec2';
import type { FootprintMetrics, RoofFace, RoofGeometry, Vec3In } from '../../types';
import { type RoofContext, noBreaks, zeroHeight } from './index';

/**
 * Whether a hipped roof can be built on this footprint.
 * Currently rectangles only; the straight skeleton (milestone 2) widens this.
 */
export function canBuildHipped(metrics: FootprintMetrics): boolean {
  return metrics.rectangularity > 0.92;
}

/** Hipped roof for (near-)rectangular footprints: two trapezoids and two triangles. */
export function buildHipped(ctx: RoofContext): RoofGeometry | null {
  const { spec, eave, overhang } = ctx;
  const outer = spec.footprint.outer;
  if (outer.length !== 4 || spec.roof.height <= 0) return null;
  const { center, axis, halfLength, halfWidth } = spec.metrics.box;
  if (halfWidth < 0.3) return null;

  const run = Math.max(0, halfLength - halfWidth);
  const ridge: [Vec2, Vec2] = [
    [center[0] - axis[0] * run, center[1] - axis[1] * run],
    [center[0] + axis[0] * run, center[1] + axis[1] * run],
  ];
  const top = eave + spec.roof.height;
  const maxOverhang = Math.max(0, ...overhang);
  const drop = (maxOverhang * spec.roof.height) / halfWidth;
  const ring2d = maxOverhang > 0 ? offsetRing(outer, overhang) : outer;
  const outline: Vec3In[] = ring2d.map((p) => [p[0], p[1], eave - drop]);
  const nearest = (p: Vec2): Vec3In => {
    const r = distance(p, ridge[0]) <= distance(p, ridge[1]) ? ridge[0] : ridge[1];
    return [r[0], r[1], top];
  };

  const faces: RoofFace[] = [];
  for (let i = 0; i < 4; i++) {
    const a = outline[i] as Vec3In;
    const b = outline[(i + 1) % 4] as Vec3In;
    const a2: Vec2 = [a[0], a[1]];
    const b2: Vec2 = [b[0], b[1]];
    const along = Math.abs(dot(normalize(sub(b2, a2)), axis)) > 0.7;
    if (along && run > 1e-3) faces.push({ points: [a, b, nearest(b2), nearest(a2)], kind: 'slope' });
    else faces.push({ points: [a, b, nearest([(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2])], kind: 'slope' });
  }
  return { faces, outline, heightAt: zeroHeight, breaks: noBreaks };
}
