import type { RoofGeometry, Vec3In } from '../../types';
import { type RoofContext, noBreaks, zeroHeight } from './index';

export function buildFlat(ctx: RoofContext): RoofGeometry {
  const { spec, eave } = ctx;
  const lift = (ring: readonly (readonly [number, number])[]): Vec3In[] =>
    ring.map((p) => [p[0], p[1], eave]);
  return {
    faces: [{ points: lift(spec.footprint.outer), holes: spec.footprint.holes.map(lift), kind: 'flat' }],
    outline: [],
    heightAt: zeroHeight,
    breaks: noBreaks,
  };
}
