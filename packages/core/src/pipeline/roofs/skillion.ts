import { offsetRing } from '../../geom/polygon';
import { type Vec2, dot } from '../../geom/vec2';
import type { RoofGeometry, Vec3In } from '../../types';
import { type RoofContext, noBreaks } from './index';

/** Single slope falling in `slopeDirection`. The low edge sits on the eave line. */
export function buildSkillion(ctx: RoofContext): RoofGeometry | null {
  const { spec, eave, overhang } = ctx;
  const outer = spec.footprint.outer;
  const d = spec.roof.slopeDirection;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const p of outer) {
    const v = dot(p, d);
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (hi - lo < 0.3 || spec.roof.height <= 0) return null;
  const heightAt = (p: Vec2): number => (spec.roof.height * (hi - dot(p, d))) / (hi - lo);
  const lift = (p: Vec2): Vec3In => [p[0], p[1], eave + heightAt(p)];
  const outline2d = overhang.some((o) => o > 0) ? offsetRing(outer, overhang) : outer;
  const points = outline2d.map(lift);
  return { faces: [{ points, kind: 'slope' }], outline: points, heightAt, breaks: noBreaks };
}
