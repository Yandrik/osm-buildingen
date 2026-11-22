import type { FootprintMetrics, RoofGeometry } from '../../types';
import { buildSkeletonRoof } from './fromSkeleton';
import type { RoofContext } from './index';

/**
 * Whether a hipped roof is worth trying on this footprint. A cheap guess for the
 * resolve stage; the builder itself still returns null when the skeleton fails.
 */
export function canBuildHipped(metrics: FootprintMetrics): boolean {
  return metrics.box.halfWidth > 0.3;
}

/**
 * Hipped roof: one face per wall, all at the same pitch, meeting on the straight
 * skeleton of the footprint. On a rectangle that is two trapezoids and two triangles.
 * Works with courtyards.
 */
export function buildHipped(ctx: RoofContext): RoofGeometry | null {
  return buildSkeletonRoof(ctx);
}
