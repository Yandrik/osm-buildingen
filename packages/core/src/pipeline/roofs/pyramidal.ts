import { offsetRing } from '../../geom/polygon';
import { type Vec2, pointSegment } from '../../geom/vec2';
import type { RoofGeometry, Vec3In } from '../../types';
import { type RoofContext, noBreaks, zeroHeight } from './index';
import { radialCentre } from './radial';

/** All edges rise to one apex above the centre. Null when no point sees every edge from inside. */
export function buildPyramidal(ctx: RoofContext): RoofGeometry | null {
  const { spec, eave, overhang } = ctx;
  const outer = spec.footprint.outer;
  if (spec.roof.height <= 0) return null;
  const c = radialCentre(outer, spec.metrics.box.center);
  if (!c) return null;
  const apex: Vec3In = [c[0], c[1], eave + spec.roof.height];

  // Mean distance from the apex to the edges gives the slope used for the overhang drop.
  let mean = 0;
  const n = outer.length;
  for (let i = 0; i < n; i++) mean += pointSegment(c, outer[i] as Vec2, outer[(i + 1) % n] as Vec2).distance;
  mean /= n;
  if (mean < 0.3) return null;
  const maxOverhang = Math.max(0, ...overhang);
  const drop = (maxOverhang * spec.roof.height) / mean;

  const ring2d = maxOverhang > 0 ? offsetRing(outer, overhang) : outer;
  const outline: Vec3In[] = ring2d.map((p) => [p[0], p[1], eave - drop]);
  const faces = outline.map((p, i) => ({
    points: [p, outline[(i + 1) % outline.length] as Vec3In, apex],
    kind: 'slope' as const,
  }));
  return { faces, outline, heightAt: zeroHeight, breaks: noBreaks };
}
