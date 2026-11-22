import type { Vec2 } from '../../geom/vec2';
import type { FootprintMetrics, ResolvedSpec, RoofGeometry, RoofShape, WallSegment } from '../../types';
import { buildFlat } from './flat';
import { buildGabled } from './gabled';
import { buildHipped, canBuildHipped } from './hipped';
import { buildPyramidal } from './pyramidal';
import { buildSkillion } from './skillion';

export interface RoofContext {
  spec: ResolvedSpec;
  walls: WallSegment[];
  /** Overhang per outer-ring edge in metres (0 along blocked walls). */
  overhang: number[];
  /** Absolute height of the eave line above the ground. */
  eave: number;
}

/**
 * The shape that will actually be built for a wanted shape on this footprint.
 * Resolve uses this so the spec always names a shape the roof stage can deliver.
 */
export function supportedRoofShape(
  shape: RoofShape,
  metrics: FootprintMetrics,
  hasHoles: boolean,
): RoofShape {
  if (hasHoles) return 'flat';
  const aspect = metrics.box.halfWidth > 0 ? metrics.box.halfLength / metrics.box.halfWidth : 99;
  switch (shape) {
    case 'flat':
    case 'gabled':
    case 'skillion':
      return shape;
    case 'half-hipped':
    case 'gambrel':
      return 'gabled'; // not built yet
    case 'mansard':
      return supportedRoofShape('hipped', metrics, hasHoles); // not built yet
    case 'pyramidal':
      return metrics.rectangularity > 0.75 && aspect < 1.5
        ? 'pyramidal'
        : supportedRoofShape('hipped', metrics, hasHoles);
    case 'hipped':
      return canBuildHipped(metrics) ? 'hipped' : 'gabled';
  }
}

/** Stage 2b. Builds the roof for the resolved shape; falls back to flat if a builder gives up. */
export function buildRoof(ctx: RoofContext): RoofGeometry {
  const { spec } = ctx;
  let roof: RoofGeometry | null = null;
  switch (spec.roof.shape) {
    case 'gabled':
      roof = buildGabled(ctx);
      break;
    case 'skillion':
      roof = buildSkillion(ctx);
      break;
    case 'pyramidal':
      roof = buildPyramidal(ctx);
      break;
    case 'hipped':
      roof = buildHipped(ctx) ?? buildGabled(ctx);
      break;
    default:
      roof = null;
  }
  if (!roof) {
    if (spec.roof.shape !== 'flat') spec.notes.push(`roof builder for ${spec.roof.shape} failed, using flat`);
    roof = buildFlat(ctx);
  }
  return roof;
}

export const noBreaks = (): number[] => [];
export const zeroHeight = (_p: Vec2): number => 0;
