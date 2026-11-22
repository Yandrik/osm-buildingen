import { offsetRing } from '../../geom/polygon';
import type { RoofGeometry, Vec3In } from '../../types';
import { type RoofContext, noBreaks, zeroHeight } from './index';

/**
 * Flat roof. With an overhang (modern stations, pavilions) it is a slab reaching past
 * the walls; the slab edge is drawn from `outline` like the eaves of pitched roofs.
 */
export function buildFlat(ctx: RoofContext): RoofGeometry {
  const { spec, eave, overhang } = ctx;
  const lift = (ring: readonly (readonly [number, number])[]): Vec3In[] =>
    ring.map((p) => [p[0], p[1], eave]);
  const holes = spec.footprint.holes.map(lift);
  if (spec.roof.overhang > 0 && overhang.some((o) => o > 0)) {
    const outline = lift(offsetRing(spec.footprint.outer, overhang));
    return {
      faces: [{ points: outline, holes, kind: 'flat' }],
      outline,
      heightAt: zeroHeight,
      breaks: noBreaks,
    };
  }
  return {
    faces: [{ points: lift(spec.footprint.outer), holes, kind: 'flat' }],
    outline: [],
    heightAt: zeroHeight,
    breaks: noBreaks,
  };
}
